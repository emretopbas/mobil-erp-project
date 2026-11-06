import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import {
  BodyText,
  Button,
  Card,
  CircleIconButton,
  color,
  Dialog,
  Divider,
  Field,
  font,
  Heading,
  Input,
  space,
  Tag,
  VariantQrCode,
} from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import { GhostVariantNotice } from '@/features/products/GhostVariantNotice';
import { VariantAxisWizard } from '@/features/products/VariantAxisWizard';
import { autoBarcodeFromSku } from '@/lib/barcode';
import { formatMoney } from '@/lib/money';
import { saveVariantImage } from '@/lib/variantImages';
import type { Product, ProductVariant } from '@/models';
import { type ActorContext, type VariantWithAttributes, hasPermission, productService, useActorContext, useSession } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

/** Ürün/Varyant (CLAUDE.md §9 step 5, §5.4; see product-schema.md for the
 * reorganized schema this screen now edits). Each product card manages its
 * own variants inline — small enough a catalog that a separate variant
 * screen isn't worth it yet. Cards are compact/collapsed by default (product
 * feedback): the always-visible header carries name+SKU, the first
 * variant's fotoğraf/karekod shortcut, price and category — editing and the
 * full variant list only appear once a card is expanded. */
export default function ProductsScreen() {
  const ctx = useActorContext();
  const { business } = useSession();
  const router = useRouter();
  const [products, setProducts] = useState<Product[] | null>(null);
  // Ürün+SKU'nun ötesinde varyant SKU/barkod/eksen-değeri üzerinden arama
  // yapabilmek için (§5: "kırmızı 42 araması doğru varyantı bulmalı") her
  // ürünün varyantları burada da (ProductCard'ın kendi yüklemesinden ayrı)
  // tutuluyor — küçük bir katalogda bu ekstra sorgu maliyeti önemsiz, bu
  // oturum boyunca kurulan "hepsini yükle, client'ta filtrele" deseniyle
  // aynı (bkz. ManualDraftScreen'in kataloğu).
  const [variantIndex, setVariantIndex] = useState<Map<string, VariantWithAttributes[]>>(new Map());
  const [search, setSearch] = useState('');
  const [showAllVariants, setShowAllVariants] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState(''); // major-unit string in the form; converted to minor on submit
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!ctx) return;
    const list = await productService.list(ctx, { includeInactive: true });
    setProducts(list);
    const entries = await Promise.all(list.map(async (p) => [p.id, await productService.listVariantsWithAttributes(ctx, p.id)] as const));
    setVariantIndex(new Map(entries));
  }, [ctx]);

  useReloadOnMount(reload);

  // Every category already in use across this business's products — shown
  // as tap-to-fill chips wherever a Kategori field appears (this form and
  // each card's "Ürünü düzenle"), so picking a category already used
  // elsewhere never means retyping it from scratch. Free text still works
  // for a genuinely new group.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products ?? []) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [products]);

  // Ürün adı/SKU'su VEYA herhangi bir varyantının SKU'su/barkodu/eksen
  // değeri eşleşirse ürün listede kalır ("kırmızı 42" araması gibi).
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return products ?? [];
    return (products ?? []).filter((p) => {
      if (p.name.toLocaleLowerCase('tr').includes(q) || p.sku.toLocaleLowerCase('tr').includes(q)) return true;
      const rows = variantIndex.get(p.id) ?? [];
      return rows.some(
        ({ variant: v, labels }) =>
          v.sku.toLocaleLowerCase('tr').includes(q) ||
          (v.barcode ?? '').toLocaleLowerCase('tr').includes(q) ||
          labels.some((l) => l.toLocaleLowerCase('tr').includes(q)),
      );
    });
  }, [products, variantIndex, search]);

  if (!ctx) return null;
  const canManage = hasPermission(ctx.employee.role, 'product', 'create');

  const submit = async () => {
    const priceMajor = Number(price.replace(',', '.'));
    if (!name.trim() || !sku.trim() || Number.isNaN(priceMajor)) return;
    setBusy(true);
    setError(null);
    try {
      await productService.create(ctx, {
        name: name.trim(),
        sku: sku.trim(),
        category: category.trim() || null,
        base_price_minor: Math.round(priceMajor * 100),
        currency: business?.base_currency ?? 'TRY',
      });
      setName('');
      setSku('');
      setCategory('');
      setPrice('');
      setShowForm(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleScreen title="Ürünler" subtitle="Ürün ve varyant kataloğu">
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      {canManage && <GhostVariantNotice ctx={ctx} onChanged={reload} />}
      {canManage && (
        <Button label={showForm ? 'Formu kapat' : '+ Yeni ürün'} variant={showForm ? 'secondary' : 'primary'} onPress={() => setShowForm((s) => !s)} />
      )}
      {showForm && canManage && (
        <Card style={styles.formCard}>
          <Field label="Ürün adı">
            <Input value={name} onChangeText={setName} placeholder="Örn. Deri Bot" />
          </Field>
          <Field label="SKU">
            <Input value={sku} onChangeText={setSku} autoCapitalize="characters" placeholder="BOT-001" />
          </Field>
          <Field label="Kategori (opsiyonel)">
            <Input value={category} onChangeText={setCategory} placeholder="Örn. Erkek Ayakkabı" />
          </Field>
          <CategoryChips categories={categories} onSelect={setCategory} />
          <Field label="Taban fiyat">
            <Input value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="1250.00" />
          </Field>
          <Button label={busy ? '…' : 'Ekle'} variant="primary" disabled={busy || !name.trim() || !sku.trim()} onPress={submit} />
        </Card>
      )}
      <Divider />
      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <Input value={search} onChangeText={setSearch} placeholder="Ürün, SKU, barkod veya eksen değeri ara…" />
        </View>
        <Button
          label={showAllVariants ? 'Varyantları gizle' : 'Varyantları göster'}
          variant="ghost"
          onPress={() => setShowAllVariants((s) => !s)}
        />
      </View>
      {products === null && <BodyText muted>Yükleniyor…</BodyText>}
      {products?.length === 0 && <BodyText muted>Henüz ürün eklenmedi.</BodyText>}
      {products && products.length > 0 && filteredProducts.length === 0 && <BodyText muted>Aramayla eşleşen ürün yok.</BodyText>}
      <View style={styles.list}>
        {filteredProducts.map((p) => (
          <ProductCard
            key={`${p.id}-${showAllVariants}`}
            ctx={ctx}
            product={p}
            canManage={canManage}
            categories={categories}
            initialExpanded={showAllVariants}
            onProductUpdated={reload}
          />
        ))}
      </View>
      <Button label="Stok hareketlerine git →" variant="ghost" onPress={() => router.push('/stock')} />
    </ModuleScreen>
  );
}

/** Existing-category tap-to-fill row — shared by the "Yeni ürün" form above
 * and each card's "Ürünü düzenle" form below. Free typing into the Kategori
 * field itself still works for a genuinely new group; this is purely a
 * shortcut for "same category as an existing product." */
function CategoryChips({ categories, onSelect }: { categories: string[]; onSelect: (category: string) => void }) {
  if (categories.length === 0) return null;
  return (
    <View style={styles.categoryChips}>
      {categories.map((c) => (
        <Tag key={c} label={c} variant="outline" onPress={() => onSelect(c)} />
      ))}
    </View>
  );
}

function ProductCard({
  ctx,
  product,
  canManage,
  categories,
  initialExpanded = false,
  onProductUpdated,
}: {
  ctx: ActorContext;
  product: Product;
  canManage: boolean;
  categories: string[];
  initialExpanded?: boolean;
  onProductUpdated: () => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [variants, setVariants] = useState<VariantWithAttributes[] | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(product.name);
  const [editSku, setEditSku] = useState(product.sku);
  const [editCategory, setEditCategory] = useState(product.category ?? '');
  const [editPrice, setEditPrice] = useState((product.base_price_minor / 100).toString());
  const [editPurchasable, setEditPurchasable] = useState(product.is_purchasable === 1);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [photoVariantId, setPhotoVariantId] = useState<string | null>(null);
  const [qrVariantId, setQrVariantId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await productService.listVariantsWithAttributes(ctx, product.id);
    setVariants(list);
  }, [ctx, product.id]);

  useReloadOnMount(reload);

  // Kartın kendi varyant listesini tazelemek yetmez — ProductsScreen'in
  // arama indeksi (`variantIndex`) de bu ürünün varyantlarını ayrıca
  // tutuyor (bkz. products.tsx başındaki not); bir varyant eklendiğinde/
  // değiştiğinde/silindiğinde arama sonuçlarının bayatlamaması için
  // `onProductUpdated` (screen'in reload'u) de tetiklenmeli. Mount
  // sırasındaki ilk yüklemede (useReloadOnMount) bu gerekmiyor — screen
  // zaten kendi ilk yüklemesini yapıyor.
  const reloadAndSync = useCallback(async () => {
    await reload();
    onProductUpdated();
  }, [reload, onProductUpdated]);

  // The header's fotoğraf/karekod shortcut targets this variant — the
  // first one (creation order), standing in for "the" variant on the many
  // products that only ever have one. Multi-variant products still get
  // every variant's own icons in the (collapsible) list below; this is
  // purely a convenience so a single-variant product never needs expanding
  // just to attach a photo or read its karekod.
  const primaryVariant = variants?.[0]?.variant ?? null;

  const submitEdit = async () => {
    const priceMajor = Number(editPrice.replace(',', '.'));
    if (!editName.trim() || !editSku.trim() || Number.isNaN(priceMajor)) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await productService.update(ctx, product.id, {
        name: editName.trim(),
        sku: editSku.trim(),
        category: editCategory.trim() || null,
        base_price_minor: Math.round(priceMajor * 100),
        is_purchasable: editPurchasable ? 1 : 0,
      });
      setShowEdit(false);
      onProductUpdated();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <Card>
      <View style={styles.headerRow}>
        <Pressable style={styles.headerMain} onPress={() => setExpanded((e) => !e)} hitSlop={4}>
          <View style={styles.nameRow}>
            <Text style={styles.productName} numberOfLines={1}>
              {product.name}
            </Text>
            <Text style={styles.productSku} numberOfLines={1}>
              {product.sku}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.price}>{formatMoney(product.base_price_minor, product.currency)}</Text>
            {!!product.category && <Tag label={product.category} variant="accent" />}
            {!product.is_active && <Tag label="Pasif" variant="outline" />}
          </View>
        </Pressable>
        {/* Fotoğraf/karekod ikonları ve aç/kapat oku aynı satırda, karta göre
         * dikey ortalanmış — CircleIconButton kendi Pressable'ını taşıdığı
         * için burada iç içe Pressable olmasın diye ok ayrı bir Text olarak
         * kalıyor, ikili Pressable çakışması riski yok. */}
        <View style={styles.headerRight}>
          {!!primaryVariant && (
            <>
              <CircleIconButton
                accessibilityLabel="Varyant fotoğrafı"
                icon="image-outline"
                imageUri={primaryVariant.image_uri}
                showAddBadge
                onPress={() => setPhotoVariantId(primaryVariant.id)}
              />
              <CircleIconButton accessibilityLabel="Karekod" icon="qr-code-outline" onPress={() => setQrVariantId(primaryVariant.id)} />
            </>
          )}
          <Text style={styles.caret} onPress={() => setExpanded((e) => !e)}>
            {expanded ? '▲' : '▼'}
          </Text>
        </View>
      </View>

      {expanded && (
        <>
          {canManage && (
            <View style={styles.actionRow}>
              <Button label={showEdit ? 'Düzenlemeyi kapat' : 'Ürünü düzenle'} variant="ghost" onPress={() => setShowEdit((s) => !s)} />
            </View>
          )}
          {canManage && showEdit && (
            <View style={styles.variantForm}>
              {!!editError && <BodyText style={styles.error}>{editError}</BodyText>}
              <Field label="Ürün adı">
                <Input value={editName} onChangeText={setEditName} placeholder="Örn. Deri Bot" />
              </Field>
              <Field label="SKU">
                <Input value={editSku} onChangeText={setEditSku} autoCapitalize="characters" placeholder="BOT-001" />
              </Field>
              <Field label="Kategori (opsiyonel)">
                <Input value={editCategory} onChangeText={setEditCategory} placeholder="Örn. Erkek Ayakkabı" />
              </Field>
              <CategoryChips categories={categories} onSelect={setEditCategory} />
              <Field label="Taban fiyat">
                <Input value={editPrice} onChangeText={setEditPrice} keyboardType="decimal-pad" placeholder="1250.00" />
              </Field>
              {/* Satın Almalar'daki "Ürünler" kataloğunda listelensin mi
               * (product feedback: "satın alınabilir olarak işaretlenmiş
               * ürünler"). Varsayılan açık. */}
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Satın alınabilir</Text>
                  <Text style={styles.switchHint}>Kapalıysa Satın Almalar kataloğunda görünmez.</Text>
                </View>
                <Switch value={editPurchasable} onValueChange={setEditPurchasable} trackColor={{ true: color.accent, false: color.divider }} thumbColor={color.bg} />
              </View>
              <Button
                label={editBusy ? '…' : 'Kaydet'}
                variant="primary"
                disabled={editBusy || !editName.trim() || !editSku.trim()}
                onPress={submitEdit}
              />
            </View>
          )}

          <Divider />
          <Heading level={5}>Varyantlar ({variants?.length ?? 0})</Heading>
          <>
            {variants && variants.length > 0 ? (
              <View style={styles.variantList}>
                {variants.map(({ variant: v, labels }) => (
                  <View key={v.id} style={styles.variantRow}>
                    <Pressable
                      style={styles.variantLabelWrap}
                      disabled={!canManage}
                      onPress={() => setEditingVariantId((id) => (id === v.id ? null : v.id))}>
                      <BodyText style={styles.variantLabel}>{[v.sku, ...labels].filter(Boolean).join(' · ')}</BodyText>
                    </Pressable>
                    <View style={styles.variantIcons}>
                      <CircleIconButton
                        accessibilityLabel="Varyant fotoğrafı"
                        icon="image-outline"
                        imageUri={v.image_uri}
                        showAddBadge
                        onPress={() => setPhotoVariantId(v.id)}
                      />
                      <CircleIconButton accessibilityLabel="Karekod" icon="qr-code-outline" onPress={() => setQrVariantId(v.id)} />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <BodyText muted>Henüz varyant eklenmedi.</BodyText>
            )}
            {canManage &&
              variants
                ?.filter((row) => row.variant.id === editingVariantId)
                .map((row) => (
                  <VariantEditForm
                    key={row.variant.id}
                    ctx={ctx}
                    variant={row.variant}
                    onDone={() => {
                      setEditingVariantId(null);
                      void reloadAndSync();
                    }}
                  />
                ))}

            {canManage && (
              <View style={styles.actionRow}>
                {/* Eksen SETİ (hangi attribute'lar kullanılıyor) stok
                 * hareketi olan bir varyant varsa kilitlenir, ama bu
                 * düğme her zaman açık — o kilit sadece sihirbazın Adım
                 * A'sında "+ Eksen ekle"/"Ekseni kaldır"ı gizler, aynı
                 * eksenlere (örn. Renk × Beden) yeni bir DEĞER eklemeyi
                 * asla engellemez (product feedback: "eksenler bir kere
                 * kurulduktan sonra değişmemeli ama aynı eksenlere ...
                 * yeni varyantlar ekleyebilmeliyim"). */}
                <Button label="+ Varyant ekle" variant="ghost" onPress={() => setShowWizard(true)} />
              </View>
            )}
          </>
        </>
      )}

      <VariantPhotoDialog
        ctx={ctx}
        canManage={canManage}
        variant={variants?.find((row) => row.variant.id === photoVariantId)?.variant ?? null}
        onClose={() => setPhotoVariantId(null)}
        onSaved={reloadAndSync}
      />
      <VariantQrDialog
        ctx={ctx}
        canManage={canManage}
        variant={variants?.find((row) => row.variant.id === qrVariantId)?.variant ?? null}
        onClose={() => setQrVariantId(null)}
        onSaved={reloadAndSync}
      />
      {canManage && (
        <VariantAxisWizard
          ctx={ctx}
          product={product}
          visible={showWizard}
          onClose={() => setShowWizard(false)}
          onCommitted={reloadAndSync}
        />
      )}
    </Card>
  );
}

/** Inline edit form for one variant, opened by tapping its SKU tag — real
 * `barcode`/`cost_price_minor` columns; a variant's own axis values
 * (`variant_attribute`) are set once at creation (Adım C) and not editable
 * here — §4 only defines "yeni değer ekle"/"değer sil" flows at the product
 * level, not a per-variant "change its color" flow. */
function VariantEditForm({ ctx, variant, onDone }: { ctx: ActorContext; variant: ProductVariant; onDone: () => void }) {
  const [sku, setSku] = useState(variant.sku);
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [costPrice, setCostPrice] = useState(variant.cost_price_minor != null ? (variant.cost_price_minor / 100).toString() : '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    if (!sku.trim()) return;
    setBusy(true);
    try {
      const costMajor = Number(costPrice.replace(',', '.'));
      await productService.updateVariant(ctx, variant.id, {
        sku: sku.trim(),
        barcode: barcode.trim() || null,
        cost_price_minor: costPrice.trim() && !Number.isNaN(costMajor) ? Math.round(costMajor * 100) : null,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await productService.deactivateVariant(ctx, variant.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  // §4 "Değer silme": stok hareketi olan bir varyant asla hard-delete
  // edilmez, arşivlenir — kullanıcıya hangisinin olduğunu göster.
  const remove = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await productService.archiveOrDeleteVariant(ctx, variant.id);
      if (result.archived) {
        setNotice(`Bu varyantın ${result.movementCount} stok hareketi var, arşivlendi.`);
        setTimeout(onDone, 900);
      } else {
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.variantForm}>
      {!!notice && <BodyText muted>{notice}</BodyText>}
      <Field label="Varyant SKU">
        <Input value={sku} onChangeText={setSku} autoCapitalize="characters" />
      </Field>
      <Field label="Barkod (opsiyonel)">
        <Input value={barcode} onChangeText={setBarcode} autoCapitalize="characters" placeholder="Örn. BOT-001-42-SIYAH" />
      </Field>
      {/* Barkod SKU değişse bile sabit kalır (kullanıcıyla üzerinde
       * anlaşılan davranış) — SKU'yu az önce değiştirdiyseniz barkodu ona
       * göre güncellemek için bu düğmeye elle basmanız gerekir. */}
      <Button label="SKU'dan ata" variant="ghost" disabled={!sku.trim()} onPress={() => setBarcode(autoBarcodeFromSku(sku))} />
      <Field label="Maliyet fiyatı (opsiyonel)">
        <Input value={costPrice} onChangeText={setCostPrice} keyboardType="decimal-pad" placeholder="800.00" />
      </Field>
      <View style={styles.actionRow}>
        <Button label={busy ? '…' : 'Kaydet'} variant="primary" disabled={busy || !sku.trim()} onPress={save} />
        <Button label="Pasif yap" variant="secondary" disabled={busy} onPress={deactivate} />
        <Button label="Sil" variant="secondary" disabled={busy} onPress={() => void remove()} />
      </View>
    </View>
  );
}

/** The image icon's dialog — two capture routes (CLAUDE.md feedback: "cihazdan
 * yükleme ve kamera ile fotoğraf çekme olarak iki ayrı opsiyon"), each asking
 * its own permission before launching. A picked/captured photo is copied into
 * persistent storage (`saveVariantImage`) before it's written to the variant,
 * never the picker's own cache-directory uri. */
function VariantPhotoDialog({
  ctx,
  canManage,
  variant,
  onClose,
  onSaved,
}: {
  ctx: ActorContext;
  canManage: boolean;
  variant: ProductVariant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'library' | 'camera') => {
    if (!variant) return;
    setError(null);
    const perm =
      source === 'library' ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(source === 'library' ? 'Galeri erişim izni verilmedi.' : 'Kamera erişim izni verilmedi.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.7, allowsEditing: true, aspect: [1, 1] };
    const result = source === 'library' ? await ImagePicker.launchImageLibraryAsync(options) : await ImagePicker.launchCameraAsync(options);
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    try {
      const uri = await saveVariantImage(result.assets[0].uri, variant.id);
      await productService.updateVariant(ctx, variant.id, { image_uri: uri });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog visible={!!variant} onRequestClose={onClose} title={variant ? `Fotoğraf · ${variant.sku}` : 'Fotoğraf'}>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      {!!variant?.image_uri && <Image source={{ uri: variant.image_uri }} style={styles.previewImage} contentFit="cover" />}
      {canManage ? (
        <View style={styles.actionRow}>
          <Button label={busy ? '…' : 'Kütüphaneden Seç'} variant="secondary" disabled={busy} onPress={() => pick('library')} />
          <Button label={busy ? '…' : 'Kamera ile Çek'} variant="secondary" disabled={busy} onPress={() => pick('camera')} />
        </View>
      ) : (
        !variant?.image_uri && <BodyText muted>Bu varyant için fotoğraf eklenmedi.</BodyText>
      )}
      <Button label="Kapat" variant="ghost" onPress={onClose} />
    </Dialog>
  );
}

/** The karekod icon's dialog — generates the QR live from the variant's
 * `barcode` string (nothing stored for it, unlike the photo above) so it's
 * always in sync; scanning it is meant for easy product lookup when building
 * a manual order. No barcode yet → offer to add one right here instead of a
 * dead end. */
function VariantQrDialog({
  ctx,
  canManage,
  variant,
  onClose,
  onSaved,
}: {
  ctx: ActorContext;
  canManage: boolean;
  variant: ProductVariant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog visible={!!variant} onRequestClose={onClose} title={variant ? `Karekod · ${variant.sku}` : 'Karekod'}>
      {variant && (
        <VariantQrDialogContent key={variant.id} ctx={ctx} canManage={canManage} variant={variant} onClose={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

function VariantQrDialogContent({
  ctx,
  canManage,
  variant,
  onClose,
  onSaved,
}: {
  ctx: ActorContext;
  canManage: boolean;
  variant: ProductVariant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveBarcode = async () => {
    if (!barcode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await productService.updateVariant(ctx, variant.id, { barcode: barcode.trim() });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.qrContent}>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      {variant.barcode ? (
        <>
          <VariantQrCode value={variant.barcode} />
          <BodyText muted>{variant.barcode}</BodyText>
        </>
      ) : (
        <>
          <BodyText muted>Bu varyant için barkod girilmemiş. Karekod oluşturmak için önce bir barkod ekleyin.</BodyText>
          {canManage && (
            <>
              <Field label="Barkod">
                <Input value={barcode} onChangeText={setBarcode} autoCapitalize="characters" placeholder="Örn. BOT-001-42-SIYAH" />
              </Field>
              <Button label="SKU'dan ata" variant="ghost" onPress={() => setBarcode(autoBarcodeFromSku(variant.sku))} />
              <Button label={busy ? '…' : 'Barkodu kaydet'} variant="primary" disabled={busy || !barcode.trim()} onPress={saveBarcode} />
            </>
          )}
        </>
      )}
      <Button label="Kapat" variant="ghost" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: '#ae1800' },
  formCard: { gap: space[3] },
  list: { gap: space[3] },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  headerMain: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], flexWrap: 'wrap' },
  productName: { fontSize: 16, fontFamily: font.heading, color: color.text, flexShrink: 1 },
  productSku: { fontSize: 16, fontFamily: font.body, color: color.dim },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  price: { fontSize: 14, fontFamily: font.bodySemiBold, color: color.text },
  // Fotoğraf/karekod ikonları + aç/kapat oku: aynı satır, `headerRow`'un
  // `alignItems: 'center'`i sayesinde kartın (iki satırlık) başlık bloğuna
  // göre dikey ortalanmış oluyor.
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  caret: { fontSize: 11, color: color.dimmer, paddingHorizontal: 2 },

  variantList: { gap: space[2] },
  variantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  variantLabelWrap: { flex: 1 },
  variantLabel: { fontSize: 14 },
  variantIcons: { flexDirection: 'row', gap: space[2] },
  variantForm: { gap: space[3], marginTop: space[2] },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  switchLabel: { fontSize: 14, color: color.text },
  switchHint: { fontSize: 11.5, color: color.dimmer, marginTop: 2 },
  previewImage: { width: '100%', height: 200, alignSelf: 'center' },
  qrContent: { alignItems: 'center', gap: space[3] },
});
