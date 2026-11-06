import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { BodyText, Button, color, DatePicker, Dialog, Field, font, Input, SegmentedControl, space, Tag } from '@/design-system';
import { QuantityMatrix } from '@/features/catalog/QuantityMatrix';
import { formatMoney } from '@/lib/money';
import { formatQuantity, minorToInputText, parseDecimal, parseMinorAmount } from '@/lib/quantity';
import type { Account, Material, Product } from '@/models';
import {
  accountService,
  materialService,
  productService,
  purchaseService,
  type ActorContext,
  type PurchaseLineInput,
  type VariantWithAttributes,
} from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

type CatalogFilter = 'all' | 'material' | 'product';

interface ProductEntry {
  product: Product;
  variants: VariantWithAttributes[];
}

interface MaterialDraft {
  qty: string;
  price: string;
}

const UNIT_SUGGESTIONS = ['adet', 'kg', 'm', 'm²', 'lt', 'top', 'rulo'];

/** Satın alma oluşturma/düzenleme ekranı (Satın Almalar şartnamesi §3): üstte
 * tedarikçi + tarih + "Teslim alındı" anahtarı, altında tek bir katalog —
 * Tümü / Malzemeler / Ürünler filtresi, arama, malzeme için satır içi
 * miktar+fiyat, ürün için matris, katalogda olmayan malzeme için satır içi
 * oluşturma. Sepet yerel durumda tutulur; "Kaydet" `purchaseService.save`'i
 * tek çağrıda yapar (başlık + satırlar + stok mutabakatı). */
export function PurchaseEditor({
  ctx,
  purchaseId,
  onCancel,
  onSaved,
}: {
  ctx: ActorContext;
  /** null ⇒ yeni satın alma. */
  purchaseId: string | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const currency = ctx.business.base_currency;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [productEntries, setProductEntries] = useState<ProductEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Düzenlenen satın almada, katalogda artık bulunamayan bir hedefe ait
   * satırlar (arşivlenmiş/silinmiş ürün) — kayıtta olduğu gibi geri yazılır,
   * yoksa düzenleme sessizce o satırları ve stoklarını geri alırdı. */
  const [orphans, setOrphans] = useState<PurchaseLineInput[]>([]);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState('');
  const [accountOpen, setAccountOpen] = useState(!purchaseId);
  const [date, setDate] = useState(() => new Date());
  const [showDate, setShowDate] = useState(false);
  const [isReceived, setIsReceived] = useState(true);
  const [note, setNote] = useState('');

  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [query, setQuery] = useState('');

  const [matDrafts, setMatDrafts] = useState<Record<string, MaterialDraft>>({});
  const [openMaterials, setOpenMaterials] = useState<Set<string>>(new Set());
  const [varQty, setVarQty] = useState<Record<string, number>>({});
  const [productPrice, setProductPrice] = useState<Record<string, string>>({});
  const [variantPrice, setVariantPrice] = useState<Record<string, string>>({});
  const [openProducts, setOpenProducts] = useState<Set<string>>(new Set());
  const [priceEditProducts, setPriceEditProducts] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [accs, mats, products] = await Promise.all([
      accountService.list(ctx),
      materialService.list(ctx, { includeArchived: true }),
      productService.list(ctx),
    ]);
    const entries: ProductEntry[] = [];
    for (const product of products) {
      entries.push({ product, variants: await productService.listVariantsWithAttributes(ctx, product.id, { includeInactive: true }) });
    }
    setAccounts(accs);
    setMaterials(mats);
    setProductEntries(entries);

    if (purchaseId) {
      const [all, lines] = await Promise.all([purchaseService.list(ctx), purchaseService.lines(ctx, purchaseId)]);
      const purchase = all.find((p) => p.id === purchaseId);
      if (purchase) {
        setAccountId(purchase.account_id);
        setDate(new Date(purchase.purchase_date));
        setIsReceived(purchase.is_received === 1);
        setNote(purchase.note ?? '');
      }
      const md: Record<string, MaterialDraft> = {};
      const vq: Record<string, number> = {};
      const pp: Record<string, string> = {};
      const vp: Record<string, string> = {};
      const productOfVariant = new Map<string, string>();
      for (const e of entries) for (const v of e.variants) productOfVariant.set(v.variant.id, e.product.id);
      const materialIds = new Set(mats.map((m) => m.id));
      const orphanLines: PurchaseLineInput[] = [];
      for (const l of lines) {
        if (l.line_type === 'material' && l.material_id && materialIds.has(l.material_id)) {
          md[l.material_id] = { qty: String(l.quantity).replace('.', ','), price: minorToInputText(l.unit_cost_minor) };
        } else if (l.line_type === 'product' && l.variant_id && productOfVariant.has(l.variant_id)) {
          const productId = productOfVariant.get(l.variant_id)!;
          vq[l.variant_id] = l.quantity;
          if (pp[productId] === undefined) pp[productId] = minorToInputText(l.unit_cost_minor);
          else if (pp[productId] !== minorToInputText(l.unit_cost_minor)) vp[l.variant_id] = minorToInputText(l.unit_cost_minor);
        } else {
          orphanLines.push({
            line_type: l.line_type,
            material_id: l.material_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            unit_cost_minor: l.unit_cost_minor,
            line_group_id: l.line_group_id,
            note: l.note,
          });
        }
      }
      setMatDrafts(md);
      setVarQty(vq);
      setProductPrice(pp);
      setVariantPrice(vp);
      setOrphans(orphanLines);
      setOpenMaterials(new Set(Object.keys(md)));
    }
    setLoaded(true);
  }, [ctx, purchaseId]);

  useReloadOnMount(reload);

  // ─── türetilmiş değerler ────────────────────────────────────────────────

  const productOfVariant = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of productEntries) for (const v of e.variants) map.set(v.variant.id, e.product.id);
    return map;
  }, [productEntries]);

  const unitMinorFor = useCallback(
    (variantId: string): number => {
      const override = variantPrice[variantId];
      if (override !== undefined && override.trim() !== '') return parseMinorAmount(override);
      const productId = productOfVariant.get(variantId);
      return productId ? parseMinorAmount(productPrice[productId] ?? '') : 0;
    },
    [variantPrice, productPrice, productOfVariant],
  );

  const materialQty = (id: string) => parseDecimal(matDrafts[id]?.qty ?? '');
  const productQty = (entry: ProductEntry) => entry.variants.reduce((s, v) => s + (varQty[v.variant.id] ?? 0), 0);

  const total = useMemo(() => {
    let sum = 0;
    for (const m of materials) {
      const d = matDrafts[m.id];
      if (d) sum += Math.round(parseDecimal(d.qty) * parseMinorAmount(d.price));
    }
    for (const [variantId, q] of Object.entries(varQty)) if (q > 0) sum += Math.round(q * unitMinorFor(variantId));
    for (const o of orphans) sum += Math.round(o.quantity * o.unit_cost_minor);
    return sum;
  }, [materials, matDrafts, varQty, unitMinorFor, orphans]);

  const q = query.trim().toLocaleLowerCase('tr');
  const matches = (...fields: (string | null | undefined)[]) => !q || fields.some((f) => (f ?? '').toLocaleLowerCase('tr').includes(q));

  const visibleMaterials = materials
    .filter((m) => m.status === 'active' || materialQty(m.id) > 0)
    .filter((m) => matches(m.name, m.description, m.category));
  const visibleProducts = productEntries
    .filter((e) => e.product.is_purchasable === 1 || productQty(e) > 0)
    .filter((e) => matches(e.product.name, e.product.description, e.product.sku, ...e.variants.map((v) => v.variant.sku)));

  type Row = { kind: 'material'; name: string; material: Material } | { kind: 'product'; name: string; entry: ProductEntry };
  const rows: Row[] = [
    ...(filter !== 'product' ? visibleMaterials.map((m): Row => ({ kind: 'material', name: m.name, material: m })) : []),
    ...(filter !== 'material' ? visibleProducts.map((e): Row => ({ kind: 'product', name: e.product.name, entry: e })) : []),
  ].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const trimmedQuery = query.trim();
  const canOfferCreate =
    filter !== 'product' && !!trimmedQuery && !materials.some((m) => m.name.toLocaleLowerCase('tr') === trimmedQuery.toLocaleLowerCase('tr'));

  const accountName = accounts.find((a) => a.id === accountId)?.name ?? null;
  const filteredAccounts = accounts.filter((a) => !accountQuery || a.name.toLocaleLowerCase('tr').includes(accountQuery.toLocaleLowerCase('tr')));

  // ─── eylemler ───────────────────────────────────────────────────────────

  const toggleIn = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const setMatDraft = (id: string, patch: Partial<MaterialDraft>) =>
    setMatDrafts((prev) => {
      const base: MaterialDraft = prev[id] ?? { qty: '', price: '' };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  const createAccountAndPick = async () => {
    const name = accountQuery.trim();
    if (!name) return;
    setBusy(true);
    try {
      const a = await accountService.create(ctx, { name });
      setAccounts((prev) => [...prev, a]);
      setAccountId(a.id);
      setAccountOpen(false);
      setAccountQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onMaterialCreated = (m: Material) => {
    setMaterials((prev) => [...prev, m]);
    setOpenMaterials((prev) => new Set(prev).add(m.id));
    setQuery(m.name);
    setCreateOpen(false);
  };

  const save = async () => {
    if (!accountId) {
      setError('Önce tedarikçi seçin.');
      setAccountOpen(true);
      return;
    }
    const lines: PurchaseLineInput[] = [...orphans];
    for (const m of materials) {
      const d = matDrafts[m.id];
      const qty = d ? parseDecimal(d.qty) : 0;
      if (qty > 0) lines.push({ line_type: 'material', material_id: m.id, quantity: qty, unit_cost_minor: parseMinorAmount(d.price) });
    }
    for (const e of productEntries) {
      for (const v of e.variants) {
        const qty = varQty[v.variant.id] ?? 0;
        if (qty > 0) {
          lines.push({ line_type: 'product', variant_id: v.variant.id, quantity: qty, unit_cost_minor: unitMinorFor(v.variant.id), line_group_id: e.product.id });
        }
      }
    }
    if (lines.length === 0) {
      setError('En az bir malzeme veya ürün miktarı girin.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await purchaseService.save(ctx, {
        id: purchaseId ?? undefined,
        account_id: accountId,
        purchase_date: date.toISOString(),
        is_received: isReceived,
        note: note.trim() || null,
        lines,
      });
      onSaved(isReceived ? 'Satın alma kaydedildi · stok işlendi' : 'Bekleyen satın alma kaydedildi');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // ─── render ─────────────────────────────────────────────────────────────

  return (
    <View>
      <Pressable onPress={() => setAccountOpen((o) => !o)} style={styles.header}>
        <Text style={[styles.headerLabel, !accountName && { color: color.dimmer }]}>{accountName ?? 'Tedarikçi seçin'}</Text>
        <Text style={styles.caret}>{accountOpen ? '▲' : '▼'}</Text>
      </Pressable>
      {accountOpen && (
        <View style={styles.panel}>
          <TextInput
            value={accountQuery}
            onChangeText={setAccountQuery}
            placeholder="Tedarikçi ara veya yeni ekle"
            placeholderTextColor={color.dimmer}
            style={styles.searchInput}
          />
          {filteredAccounts.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => {
                setAccountId(a.id);
                setAccountOpen(false);
              }}
              style={styles.pickRow}>
              <Text style={styles.pickText}>{a.name}</Text>
            </Pressable>
          ))}
          {!!accountQuery.trim() && !accounts.some((a) => a.name.toLocaleLowerCase('tr') === accountQuery.trim().toLocaleLowerCase('tr')) && (
            <Pressable onPress={() => void createAccountAndPick()} style={styles.pickRow} disabled={busy}>
              <Text style={[styles.pickText, { color: color.accent }]}>+ &quot;{accountQuery.trim()}&quot; olarak yeni tedarikçi ekle</Text>
            </Pressable>
          )}
        </View>
      )}

      <Pressable onPress={() => setShowDate((s) => !s)} style={styles.header}>
        <Text style={styles.headerLabel}>Tarih: {date.toLocaleDateString('tr-TR')}</Text>
        <Text style={styles.caret}>{showDate ? '▲' : '▼'}</Text>
      </Pressable>
      {showDate && (
        <View style={styles.panel}>
          <DatePicker value={date} onChange={setDate} />
        </View>
      )}

      <View style={[styles.header, { paddingVertical: 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>Teslim alındı</Text>
          <Text style={styles.toggleHint}>{isReceived ? 'Kaydedince miktarlar stoğa işlenir.' : 'Bekleyen satın alma — stok değişmez.'}</Text>
        </View>
        <Switch value={isReceived} onValueChange={setIsReceived} trackColor={{ true: color.accent, false: color.divider }} thumbColor={color.bg} />
      </View>

      <Text style={styles.sectionLabel}>Katalog</Text>
      <View style={styles.padded}>
        <SegmentedControl
          options={[
            { label: 'Tümü', value: 'all' },
            { label: 'Malzemeler', value: 'material' },
            { label: 'Ürünler', value: 'product' },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as CatalogFilter)}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Ad, tanım veya SKU ara"
          placeholderTextColor={color.dimmer}
          style={styles.catalogSearch}
        />
      </View>

      {!loaded && (
        <BodyText muted style={styles.padded}>
          Yükleniyor…
        </BodyText>
      )}

      {rows.map((row) => {
        if (row.kind === 'material') {
          const m = row.material;
          const draft = matDrafts[m.id];
          const qty = materialQty(m.id);
          const open = openMaterials.has(m.id);
          const unitMinor = draft ? parseMinorAmount(draft.price) : 0;
          return (
            <View key={`m-${m.id}`} style={[styles.catalogRow, qty > 0 && styles.catalogRowActive]}>
              <Pressable onPress={() => setOpenMaterials((s) => toggleIn(s, m.id))} style={styles.catalogHead}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.nameLine}>
                    <Text style={styles.catalogName}>{m.name}</Text>
                    {filter === 'all' && <Tag label="Malzeme" variant="neutral" />}
                  </View>
                  {!!m.description && (
                    <Text style={styles.catalogDesc} numberOfLines={1}>
                      {m.description.split('\n')[0]}
                    </Text>
                  )}
                  <Text style={styles.catalogMeta}>
                    {m.unit} · stok {formatQuantity(m.stock_quantity)}
                  </Text>
                </View>
                {qty > 0 ? <Tag label={`${formatQuantity(qty)} ${m.unit}`} variant="accent" /> : <Text style={styles.caret}>{open ? '▲' : '▼'}</Text>}
              </Pressable>
              {open && (
                <View style={styles.inlineForm}>
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <Field label="Miktar">
                        <Input value={draft?.qty ?? ''} onChangeText={(t) => setMatDraft(m.id, { qty: t })} keyboardType="decimal-pad" placeholder="0" />
                      </Field>
                    </View>
                    <Text style={styles.unitLabel}>{m.unit}</Text>
                  </View>
                  <Field label={`Birim fiyat (${currency}, opsiyonel)`}>
                    <Input value={draft?.price ?? ''} onChangeText={(t) => setMatDraft(m.id, { price: t })} keyboardType="decimal-pad" placeholder="0.00" />
                  </Field>
                  {qty > 0 && unitMinor > 0 && <Text style={styles.lineTotal}>Tutar: {formatMoney(Math.round(qty * unitMinor), currency)}</Text>}
                </View>
              )}
            </View>
          );
        }

        const { product, variants } = row.entry;
        const qty = productQty(row.entry);
        const open = openProducts.has(product.id);
        const shownVariants = variants.filter((v) => v.variant.is_active === 1 || (varQty[v.variant.id] ?? 0) > 0);
        const priceEdit = priceEditProducts.has(product.id);
        return (
          <View key={`p-${product.id}`} style={[styles.catalogRow, qty > 0 && styles.catalogRowActive]}>
            <Pressable onPress={() => setOpenProducts((s) => toggleIn(s, product.id))} style={styles.catalogHead}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameLine}>
                  <Text style={styles.catalogName}>{product.name}</Text>
                  {filter === 'all' && <Tag label="Ürün" variant="accent2" />}
                </View>
                <Text style={styles.catalogMeta}>
                  {product.sku} · {shownVariants.length} varyant
                </Text>
              </View>
              {qty > 0 ? <Tag label={`${formatQuantity(qty)} ${product.unit}`} variant="accent" /> : <Text style={styles.caret}>{open ? '▲' : '▼'}</Text>}
            </Pressable>
            {open && (
              <View style={styles.inlineForm}>
                <Field label={`Birim fiyat (${currency}, opsiyonel)`}>
                  <Input
                    value={productPrice[product.id] ?? ''}
                    onChangeText={(t) => setProductPrice((prev) => ({ ...prev, [product.id]: t }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                  />
                </Field>
                <QuantityMatrix
                  variants={shownVariants}
                  quantities={varQty}
                  onChange={(variantId, n) => setVarQty((prev) => ({ ...prev, [variantId]: n }))}
                  cellCaption={(variantId) => {
                    const minor = unitMinorFor(variantId);
                    return minor > 0 ? formatMoney(minor, currency) : null;
                  }}
                />
                {qty > 0 && (
                  <Pressable onPress={() => setPriceEditProducts((s) => toggleIn(s, product.id))} hitSlop={6}>
                    <Text style={styles.smallLink}>{priceEdit ? 'Varyant fiyatlarını gizle' : 'Varyant bazında fiyatı değiştir'}</Text>
                  </Pressable>
                )}
                {priceEdit &&
                  shownVariants
                    .filter((v) => (varQty[v.variant.id] ?? 0) > 0)
                    .map((v) => (
                      <View key={v.variant.id} style={styles.variantPriceRow}>
                        <Text style={styles.variantPriceLabel}>{v.axes.length > 0 ? v.axes.map((a) => a.valueLabel).join(' · ') : v.variant.sku}</Text>
                        <TextInput
                          value={variantPrice[v.variant.id] ?? ''}
                          onChangeText={(t) => setVariantPrice((prev) => ({ ...prev, [v.variant.id]: t }))}
                          keyboardType="decimal-pad"
                          placeholder={productPrice[product.id] || '0.00'}
                          placeholderTextColor={color.dimmer}
                          style={styles.variantPriceInput}
                        />
                      </View>
                    ))}
              </View>
            )}
          </View>
        );
      })}

      {loaded && rows.length === 0 && !canOfferCreate && (
        <BodyText muted style={styles.padded}>
          {filter === 'product' ? 'Satın alınabilir ürün yok — Ürünler ekranından bir ürünü "satın alınabilir" olarak işaretleyin.' : 'Eşleşen kalem yok.'}
        </BodyText>
      )}

      {canOfferCreate && (
        <Pressable onPress={() => setCreateOpen(true)} style={styles.createRow}>
          <Text style={styles.createText}>+ &quot;{trimmedQuery}&quot; adında yeni malzeme ekle</Text>
        </Pressable>
      )}

      <Text style={styles.sectionLabel}>Not</Text>
      <View style={styles.padded}>
        <Input value={note} onChangeText={setNote} placeholder="Tedarikçi notu, irsaliye no…" multiline />
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Toplam</Text>
        <Text style={styles.totalValue}>{formatMoney(total, currency)}</Text>
      </View>
      <Text style={[styles.toggleHint, styles.padded]}>Fiyatlar yalnızca bu kayda yazılır; stok maliyetini veya varyant maliyetini değiştirmez.</Text>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={[styles.padded, { gap: space[2], paddingVertical: 18 }]}>
        <Button label={busy ? '…' : isReceived ? 'Kaydet ve stoğa işle' : 'Bekleyen olarak kaydet'} variant="primary" disabled={busy || !loaded} onPress={() => void save()} />
        <Button label="Vazgeç" variant="ghost" disabled={busy} onPress={onCancel} />
      </View>

      <NewMaterialDialog
        ctx={ctx}
        visible={createOpen}
        initialName={trimmedQuery}
        onClose={() => setCreateOpen(false)}
        onCreated={onMaterialCreated}
      />
    </View>
  );
}

/** Katalogda olmayan malzemeyi ekrandan çıkmadan oluşturur (şartname §3):
 * ad (arama metniyle dolu), birim, opsiyonel tanım. `key` ile her açılışta
 * taze state — `VariantStockDialog` ile aynı dış/iç ayrımı. */
function NewMaterialDialog({
  ctx,
  visible,
  initialName,
  onClose,
  onCreated,
}: {
  ctx: ActorContext;
  visible: boolean;
  initialName: string;
  onClose: () => void;
  onCreated: (m: Material) => void;
}) {
  return (
    <Dialog visible={visible} onRequestClose={onClose} title="Yeni malzeme">
      {visible && <NewMaterialForm ctx={ctx} initialName={initialName} onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewMaterialForm({
  ctx,
  initialName,
  onClose,
  onCreated,
}: {
  ctx: ActorContext;
  initialName: string;
  onClose: () => void;
  onCreated: (m: Material) => void;
}) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await materialService.create(ctx, { name, unit, description });
      onCreated(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      <Field label="Ad">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="Birim">
        <Input value={unit} onChangeText={setUnit} placeholder="adet, kg, m, m²…" autoCapitalize="none" />
      </Field>
      <View style={styles.unitChips}>
        {UNIT_SUGGESTIONS.map((u) => (
          <Tag key={u} label={u} variant={unit === u ? 'accent' : 'outline'} onPress={() => setUnit(u)} />
        ))}
      </View>
      <Field label="Tanım (opsiyonel)">
        <Input value={description} onChangeText={setDescription} placeholder="Tedarikçi notu, kalite, ölçü, renk…" multiline />
      </Field>
      {!!error && <BodyText style={styles.errorInline}>{error}</BodyText>}
      <Button label={busy ? '…' : 'Ekle'} variant="primary" disabled={busy || !name.trim() || !unit.trim()} onPress={() => void submit()} />
      <Button label="Vazgeç" variant="ghost" disabled={busy} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: color.text },
  headerLabel: { fontSize: 16, fontFamily: font.heading, color: color.text },
  toggleHint: { fontSize: 11.5, color: color.dimmer, marginTop: 2 },
  caret: { fontSize: 12, color: color.dimmer },
  panel: { borderBottomWidth: 2, borderBottomColor: color.text, paddingBottom: 8, paddingHorizontal: 18, paddingTop: 8 },
  searchInput: { fontFamily: font.body, fontSize: 14, color: color.text, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.divider },
  pickRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.divider },
  pickText: { fontSize: 14, color: color.text },

  sectionLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  padded: { paddingHorizontal: 18 },
  catalogSearch: { fontFamily: font.body, fontSize: 14, color: color.text, marginTop: 10, paddingVertical: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: color.divider },

  catalogRow: { borderBottomWidth: 1, borderBottomColor: color.divider },
  catalogRowActive: { backgroundColor: color.surface },
  catalogHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 18 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  catalogName: { fontSize: 14.5, fontWeight: '700', color: color.text },
  catalogDesc: { fontSize: 12, color: color.dimmer },
  catalogMeta: { fontSize: 11.5, color: color.dimmer },
  inlineForm: { paddingHorizontal: 18, paddingBottom: 14, gap: space[3] },
  inlineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  unitLabel: { fontSize: 14, color: color.dim, paddingBottom: 12, minWidth: 34 },
  lineTotal: { fontSize: 12.5, fontFamily: font.mono, color: color.text },
  smallLink: { fontFamily: font.heading, fontSize: 12.5, color: color.accent },
  variantPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  variantPriceLabel: { flex: 1, fontSize: 13, color: color.text },
  variantPriceInput: { width: 100, height: 40, paddingHorizontal: 8, textAlign: 'right', fontSize: 14, color: color.text, borderWidth: 1, borderColor: color.divider },

  createRow: { paddingVertical: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  createText: { fontSize: 14, fontFamily: font.heading, color: color.accent },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, paddingHorizontal: 18, borderTopWidth: 2, borderTopColor: color.text, marginTop: 12 },
  totalLabel: { fontSize: 13, fontFamily: font.heading, color: color.dim },
  totalValue: { fontSize: 20, fontFamily: font.heading, color: color.text },
  error: { color: color.accentRamp[700], padding: 14, paddingHorizontal: 18 },
  errorInline: { color: color.accentRamp[700] },
  unitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
