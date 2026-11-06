import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useEnsureFocusedVisible } from '@/components/keyboard-scroll';
import { QuantityMatrix } from '@/features/catalog/QuantityMatrix';
import { BodyText, color, DatePicker, font } from '@/design-system';
import { matchProduct } from '@/lib/catalogSearch';
import { formatMoney } from '@/lib/money';
import { computeOrderTotals, formatPercentValue, parsePercentInput, type OrderDiscountInput } from '@/lib/orderTotals';
import { minorToInputText, parseMinorAmount } from '@/lib/quantity';
import { buildQuantityGrid, summarizeAxes, type GridVariant } from '@/lib/quantityGrid';
import type { AssortmentPattern, Customer, Product } from '@/models';
import {
  assortmentService,
  customerService,
  orderService,
  productService,
  type ActorContext,
  type OrderGroupInput,
  type VariantWithAttributes,
} from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

interface CatalogEntry {
  product: Product;
  variants: VariantWithAttributes[];
  gridVariants: GridVariant[];
  summary: string;
  thumb: string | null;
  singleVariantId: string | null;
}

/** Ekranın geçici sipariş durumu: adetler, birim fiyatlar, asorti bilgisi.
 * Kayıt `orderService.saveLines` ile tek adımda yapılır — müşteri seçmek artık
 * boş bir taslak sipariş OLUŞTURMAZ (eski "her +/− gerçek satır" modeli matris
 * girişiyle uyumsuz: her tuş vuruşu bir yazma olurdu). */
export function ManualDraftScreen({
  ctx,
  flash,
  onDone,
  orderId,
}: {
  ctx: ActorContext;
  flash: (message: string) => void;
  onDone: () => void;
  /** Verilirse mevcut siparişin kalemleri matrise geri yüklenir ve kayıt onu günceller. */
  orderId?: string | null;
}) {
  const editing = !!orderId;
  const currency = ctx.business.base_currency;
  const ensureVisible = useEnsureFocusedVisible();

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [assortments, setAssortments] = useState<AssortmentPattern[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [frequentIds, setFrequentIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<Record<string, { pattern: string; sets: number }>>({});
  const [orphanGroups, setOrphanGroups] = useState<OrderGroupInput[]>([]);
  const [custQuery, setCustQuery] = useState('');
  const [custOpen, setCustOpen] = useState(!editing);
  const [query, setQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // İskonto: tutar (minor) ya da yüzde; boş = iskonto yok. Brüt/iskonto/net ayrı saklanır.
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountText, setDiscountText] = useState('');
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null);
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);

  const reload = useCallback(async () => {
    const [c, products, patterns] = await Promise.all([
      customerService.list(ctx),
      productService.list(ctx, { includeInactive: true }),
      assortmentService.list(ctx, null),
    ]);
    setCustomers(c);
    setAssortments(patterns);

    let existingLines = orderId ? await orderService.lines(ctx, orderId) : [];
    const built: CatalogEntry[] = [];
    const known = new Set<string>();
    for (const product of products) {
      const variants = await productService.listVariantsWithAttributes(ctx, product.id, { includeInactive: true });
      variants.forEach((v) => known.add(v.variant.id));
      const usable = variants.filter((v) => v.variant.is_active === 1);
      const inOrder = variants.some((v) => existingLines.some((l) => l.variant_id === v.variant.id));
      if (product.is_active !== 1 && !inOrder) continue;
      if (usable.length === 0 && !inOrder) continue;
      const gridVariants: GridVariant[] = variants.map((v) => ({ id: v.variant.id, sku: v.variant.sku, axes: v.axes, active: v.variant.is_active === 1 }));
      const grid = buildQuantityGrid(gridVariants);
      built.push({
        product,
        variants,
        gridVariants,
        summary: summarizeAxes(grid),
        thumb: variants.find((v) => v.variant.image_uri)?.variant.image_uri ?? null,
        singleVariantId: grid.mode === 'single' ? (grid.cells[0]?.id ?? null) : null,
      });
    }
    built.sort((a, b) => a.product.name.localeCompare(b.product.name, 'tr'));
    setEntries(built);

    if (orderId) {
      const [order, groups] = await Promise.all([ctx.repository.orders.getById(orderId), orderService.lineGroups(ctx, orderId)]);
      if (order) {
        setCustomer(c.find((x) => x.id === order.customer_id) ?? null);
        setNote(order.note ?? '');
        if (order.discount_type) {
          setDiscountType(order.discount_type);
          setDiscountText(order.discount_type === 'percent' ? formatPercentValue(order.discount_value) : minorToInputText(order.discount_value));
        }
        setDeliveryDate(order.delivery_date ? new Date(order.delivery_date) : null);
        setAssortments(await assortmentService.list(ctx, order.customer_id));
        setFrequentIds((await orderService.frequentProducts(ctx, order.customer_id)).map((f) => f.product_id));
      }
      const q: Record<string, number> = {};
      const pr: Record<string, number> = {};
      for (const l of existingLines) {
        q[l.variant_id] = (q[l.variant_id] ?? 0) + l.quantity;
        pr[l.variant_id] = l.unit_price_minor;
      }
      setQuantities(q);
      setPrices(pr);
      const metaByProduct: Record<string, { pattern: string; sets: number }> = {};
      for (const g of groups) if (g.assortment_pattern && g.assortment_sets) metaByProduct[g.product_id] = { pattern: g.assortment_pattern, sets: g.assortment_sets };
      setMeta(metaByProduct);

      // Katalogda karşılığı olmayan (silinmiş ürün vb.) satırlar kaybolmasın.
      existingLines = existingLines.filter((l) => !known.has(l.variant_id));
      const orphans = new Map<string, OrderGroupInput>();
      for (const l of existingLines) {
        const variant = await ctx.repository.productVariants.getById(l.variant_id);
        if (!variant) continue;
        const g = orphans.get(variant.product_id) ?? { product_id: variant.product_id, lines: [] };
        g.lines.push({ variant_id: l.variant_id, quantity: l.quantity, unit_price_minor: l.unit_price_minor });
        orphans.set(variant.product_id, g);
      }
      setOrphanGroups([...orphans.values()]);
    }
  }, [ctx, orderId]);

  useReloadOnMount(reload);

  const entryByProduct = useMemo(() => new Map((entries ?? []).map((e) => [e.product.id, e])), [entries]);
  const productOfVariant = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries ?? []) for (const v of e.variants) map.set(v.variant.id, e.product.id);
    return map;
  }, [entries]);

  const priceOf = useCallback(
    (variantId: string): number => {
      if (prices[variantId] !== undefined) return prices[variantId];
      const entry = entryByProduct.get(productOfVariant.get(variantId) ?? '');
      const variant = entry?.variants.find((v) => v.variant.id === variantId)?.variant;
      return variant?.price_minor ?? entry?.product.base_price_minor ?? 0;
    },
    [prices, entryByProduct, productOfVariant],
  );

  const setQty = useCallback(
    (variantId: string, n: number) => {
      setQuantities((prev) => {
        const next = { ...prev };
        if (n > 0) next[variantId] = n;
        else delete next[variantId];
        return next;
      });
      const productId = productOfVariant.get(variantId);
      if (productId) {
        // Elle düzenleme, uygulanan asorti desenini artık doğru bir özet olmaktan çıkarır.
        setMeta((prev) => {
          if (!prev[productId]) return prev;
          const next = { ...prev };
          delete next[productId];
          return next;
        });
      }
    },
    [productOfVariant],
  );

  const pickCustomer = async (c: Customer) => {
    setCustomer(c);
    setCustOpen(false);
    setCustQuery('');
    const [freq, patterns] = await Promise.all([orderService.frequentProducts(ctx, c.id), assortmentService.list(ctx, c.id)]);
    setFrequentIds(freq.map((f) => f.product_id));
    setAssortments(patterns);
  };

  const createCustomerAndPick = async () => {
    const name = custQuery.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await customerService.create(ctx, { name });
      setCustomers((prev) => [...(prev ?? []), created]);
      await pickCustomer(created);
      flash(`${name} eklendi`);
    } finally {
      setBusy(false);
    }
  };

  const saveAssortment = async (pattern: string, scope: 'customer' | 'shared') => {
    try {
      await assortmentService.save(ctx, { pattern, customer_id: scope === 'customer' ? (customer?.id ?? null) : null });
      setAssortments(await assortmentService.list(ctx, customer?.id ?? null));
      flash('Asorti deseni kaydedildi');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Toplamlar, katalogdaki her ürünün varyantları üzerinden.
  const totals = useMemo(() => {
    const byProduct = new Map<string, { qty: number; amount: number }>();
    let qty = 0;
    let amount = 0;
    for (const [variantId, n] of Object.entries(quantities)) {
      const productId = productOfVariant.get(variantId);
      const line = n * priceOf(variantId);
      qty += n;
      amount += line;
      if (productId) {
        const t = byProduct.get(productId) ?? { qty: 0, amount: 0 };
        t.qty += n;
        t.amount += line;
        byProduct.set(productId, t);
      }
    }
    for (const g of orphanGroups) for (const l of g.lines) {
      qty += l.quantity;
      amount += l.quantity * l.unit_price_minor;
    }
    return { byProduct, qty, amount };
  }, [quantities, productOfVariant, priceOf, orphanGroups]);

  const discount: OrderDiscountInput | null = useMemo(() => {
    if (!discountText.trim()) return null;
    const value = discountType === 'percent' ? parsePercentInput(discountText) : parseMinorAmount(discountText);
    return value && value > 0 ? { type: discountType, value } : null;
  }, [discountText, discountType]);

  const orderTotals = useMemo(() => {
    try {
      return { totals: computeOrderTotals(totals.amount, discount), error: null as string | null };
    } catch (e) {
      return { totals: computeOrderTotals(totals.amount, null), error: e instanceof Error ? e.message : String(e) };
    }
  }, [totals.amount, discount]);

  const search = useMemo(() => {
    const map = new Map<string, { matched: boolean; focusVariantId: string | null }>();
    for (const e of entries ?? []) map.set(e.product.id, matchProduct(query, e.product, e.gridVariants));
    return map;
  }, [entries, query]);

  const visible = (entries ?? []).filter((e) => search.get(e.product.id)?.matched);
  const frequentSet = new Set(frequentIds);
  const frequentEntries = frequentIds
    .map((id) => entryByProduct.get(id))
    .filter((e): e is CatalogEntry => !!e && !!search.get(e.product.id)?.matched)
    .slice(0, 8);
  const restEntries = visible.filter((e) => !frequentSet.has(e.product.id) || !frequentEntries.includes(e));

  // Enter'a basınca klavye odağı sadece EN ÜSTTEKİ eşleşen ürünün hücresine gider
  // (birden çok ürün eşleşirse hepsi aynı anda odak isteyip sonuncusu kazanmasın).
  const focusOwner = [...frequentEntries, ...restEntries].find((e) => !!search.get(e.product.id)?.focusVariantId)?.product.id;

  const isExpanded = (e: CatalogEntry) => expandedOverride[e.product.id] ?? !!search.get(e.product.id)?.focusVariantId;

  const changeQuery = (text: string) => {
    setQuery(text);
    setFocusRequest(0);
    setExpandedOverride({});
  };

  const save = async () => {
    if (!customer) {
      setError('Önce müşteri seçin.');
      return;
    }
    if (totals.qty === 0) {
      setError('Siparişe en az bir adet girin.');
      return;
    }
    if (orderTotals.error) {
      setError(orderTotals.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const groups: OrderGroupInput[] = [];
      for (const e of entries ?? []) {
        const lines = e.variants
          .filter((v) => (quantities[v.variant.id] ?? 0) > 0)
          .map((v) => ({ variant_id: v.variant.id, quantity: quantities[v.variant.id], unit_price_minor: priceOf(v.variant.id) }));
        if (lines.length === 0) continue;
        const m = meta[e.product.id];
        groups.push({ product_id: e.product.id, assortment_pattern: m?.pattern ?? null, assortment_sets: m?.sets ?? null, lines });
      }
      groups.push(...orphanGroups);

      if (orderId) {
        await orderService.saveLines(ctx, orderId, groups, discount);
        await orderService.setNote(ctx, orderId, note.trim() || null);
        await orderService.setDeliveryDate(ctx, orderId, deliveryDate?.toISOString() ?? null);
        flash(`Sipariş güncellendi · ${formatMoney(orderTotals.totals.net_total_minor, currency)}`);
      } else {
        await orderService.createWithLines(
          ctx,
          { customer_id: customer.id, currency, note: note.trim() || null, delivery_date: deliveryDate?.toISOString() ?? null },
          groups,
          discount,
        );
        flash(`Taslak sipariş oluşturuldu · ${formatMoney(orderTotals.totals.net_total_minor, currency)}`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredCustomers = (customers ?? []).filter((c) => !custQuery || c.name.toLocaleLowerCase('tr').includes(custQuery.toLocaleLowerCase('tr')));

  const renderRow = (e: CatalogEntry) => (
    <CatalogProductRow
      key={e.product.id}
      entry={e}
      expanded={isExpanded(e)}
      onToggle={() => setExpandedOverride((prev) => ({ ...prev, [e.product.id]: !isExpanded(e) }))}
      totalQty={totals.byProduct.get(e.product.id)?.qty ?? 0}
      quantities={quantities}
      setQty={setQty}
      priceOf={priceOf}
      currency={currency}
      assortments={assortments}
      customerScope={!!customer}
      onSaveAssortment={saveAssortment}
      onAssortmentApplied={(pattern, sets) => setMeta((prev) => ({ ...prev, [e.product.id]: { pattern, sets } }))}
      focusVariantId={search.get(e.product.id)?.focusVariantId ?? null}
      focusRequest={focusOwner === e.product.id ? focusRequest : 0}
    />
  );

  return (
    <View>
      <Pressable onPress={() => !editing && setCustOpen((o) => !o)} style={styles.custHeader}>
        <Text style={[styles.custLabel, !customer && { color: color.dimmer }]}>{customer?.name ?? 'Müşteri seçin'}</Text>
        {!editing && <Text style={styles.caret}>{custOpen ? '▲' : '▼'}</Text>}
      </Pressable>

      {custOpen && !editing && (
        <View style={styles.custPanel}>
          <TextInput value={custQuery} onChangeText={setCustQuery} placeholder="Müşteri ara veya yeni ekle" placeholderTextColor={color.dimmer} style={styles.custInput} />
          {filteredCustomers.map((c) => (
            <Pressable key={c.id} onPress={() => void pickCustomer(c)} style={styles.custRow} disabled={busy}>
              <Text style={styles.custRowText}>{c.name}</Text>
            </Pressable>
          ))}
          {!!custQuery.trim() && (
            <Pressable onPress={() => void createCustomerAndPick()} style={styles.custRow} disabled={busy}>
              <Text style={[styles.custRowText, { color: color.accent }]}>+ &quot;{custQuery.trim()}&quot; olarak yeni müşteri ekle</Text>
            </Pressable>
          )}
        </View>
      )}

      <Pressable onPress={() => setShowDeliveryPicker((s) => !s)} style={styles.custHeader}>
        <Text style={[styles.custLabel, !deliveryDate && { color: color.dimmer }]}>
          {deliveryDate ? `Teslim: ${deliveryDate.toLocaleDateString('tr-TR')}` : 'Teslim tarihi seçin'}
        </Text>
        <Text style={styles.caret}>{showDeliveryPicker ? '▲' : '▼'}</Text>
      </Pressable>
      {showDeliveryPicker && (
        <View style={styles.deliveryPanel}>
          <DatePicker value={deliveryDate ?? new Date()} onChange={setDeliveryDate} />
        </View>
      )}

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={changeQuery}
          onSubmitEditing={() => (focusOwner ? setFocusRequest((n) => n + 1) : Keyboard.dismiss())}
          // Klavye kapanıp yeniden açılmasın: odak doğrudan eşleşen hücreye geçer.
          blurOnSubmit={false}
          returnKeyType="search"
          placeholder="Ürün ara — ad, SKU, renk, beden (örn. kırmızı 42)"
          placeholderTextColor={color.dimmer}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>

      {entries === null && (
        <BodyText muted style={{ paddingHorizontal: 18 }}>
          Yükleniyor…
        </BodyText>
      )}
      {entries?.length === 0 && (
        <BodyText muted style={{ paddingHorizontal: 18 }}>
          Henüz ürün/varyant yok — önce Ürünler ekranından ekleyin.
        </BodyText>
      )}
      {entries && entries.length > 0 && visible.length === 0 && (
        <BodyText muted style={{ paddingHorizontal: 18 }}>
          &quot;{query}&quot; ile eşleşen ürün yok.
        </BodyText>
      )}

      {frequentEntries.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Bu müşterinin sık aldıkları</Text>
          {frequentEntries.map(renderRow)}
        </>
      )}

      {restEntries.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{frequentEntries.length > 0 ? 'Tüm ürünler' : 'Katalog'}</Text>
          {restEntries.map(renderRow)}
        </>
      )}

      <Text style={styles.sectionLabel}>İskonto</Text>
      <View style={styles.discountPanel}>
        <View style={styles.discountRow}>
          {(['amount', 'percent'] as const).map((t) => (
            <Pressable key={t} onPress={() => setDiscountType(t)} style={[styles.discountChip, discountType === t && styles.discountChipOn]}>
              <Text style={[styles.discountChipText, discountType === t && styles.discountChipTextOn]}>{t === 'amount' ? `Tutar (${currency})` : 'Yüzde (%)'}</Text>
            </Pressable>
          ))}
          <TextInput
            value={discountText}
            onChangeText={setDiscountText}
            onFocus={() => setTimeout(ensureVisible, 60)}
            keyboardType="decimal-pad"
            placeholder={discountType === 'percent' ? '10' : '0.00'}
            placeholderTextColor={color.dimmer}
            style={styles.discountInput}
          />
        </View>
      </View>

      <Text style={styles.sectionLabel}>Sipariş Notu / Detaylar</Text>
      <View style={styles.notePanel}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Özel talimatlar, ölçü notları, teslimat detayları…"
          placeholderTextColor={color.dimmer}
          style={styles.noteInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      <View style={styles.totalRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.totalLabel}>{orderTotals.totals.discount_amount_minor > 0 ? 'Brüt' : 'Toplam'} · {totals.qty} adet</Text>
          {orderTotals.totals.discount_amount_minor > 0 && (
            <>
              <Text style={styles.totalSub}>
                İskonto{orderTotals.totals.discount_type === 'percent' ? ` (%${formatPercentValue(orderTotals.totals.discount_value)})` : ''}
              </Text>
              <Text style={styles.totalLabel}>Net</Text>
            </>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {orderTotals.totals.discount_amount_minor > 0 ? (
            <>
              <Text style={styles.totalGross}>{formatMoney(orderTotals.totals.gross_total_minor, currency)}</Text>
              <Text style={styles.totalSub}>−{formatMoney(orderTotals.totals.discount_amount_minor, currency)}</Text>
              <Text style={styles.totalValue}>{formatMoney(orderTotals.totals.net_total_minor, currency)}</Text>
            </>
          ) : (
            <Text style={styles.totalValue}>{formatMoney(orderTotals.totals.gross_total_minor, currency)}</Text>
          )}
        </View>
      </View>

      <Pressable onPress={() => void save()} style={[styles.finishBtn, (busy || !customer) && { opacity: 0.5 }]} disabled={busy || !customer}>
        <Text style={styles.finishText}>{busy ? '…' : editing ? 'Değişiklikleri kaydet' : 'Siparişi kaydet'}</Text>
      </Pressable>
    </View>
  );
}

/** Katalogda ürün başına TEK satır: küçük resim, ad, özet ("3 renk · 5 beden ·
 * 45,00 USD"), bu siparişteki toplam adet ve aç/kapa oku. Dokununca ürünün
 * matrisi açılır. Eksensiz üründe açılır panel yok — sayı kutusu satırın içinde. */
function CatalogProductRow({
  entry,
  expanded,
  onToggle,
  totalQty,
  quantities,
  setQty,
  priceOf,
  currency,
  assortments,
  customerScope,
  onSaveAssortment,
  onAssortmentApplied,
  focusVariantId,
  focusRequest,
}: {
  entry: CatalogEntry;
  expanded: boolean;
  onToggle: () => void;
  totalQty: number;
  quantities: Record<string, number>;
  setQty: (variantId: string, n: number) => void;
  priceOf: (variantId: string) => number;
  currency: string;
  assortments: AssortmentPattern[];
  customerScope: boolean;
  onSaveAssortment: (pattern: string, scope: 'customer' | 'shared') => Promise<void>;
  onAssortmentApplied: (pattern: string, sets: number) => void;
  focusVariantId: string | null;
  focusRequest: number;
}) {
  const { product } = entry;
  const ensureVisible = useEnsureFocusedVisible();
  const summary = [entry.summary, formatMoney(product.base_price_minor, product.currency)].filter(Boolean).join(' · ');
  const single = entry.singleVariantId;
  const active = totalQty > 0;

  return (
    <View style={[styles.catalogRow, active && styles.catalogRowActive]}>
      <Pressable onPress={single ? undefined : onToggle} style={styles.catalogHead}>
        {entry.thumb ? (
          <Image source={{ uri: entry.thumb }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Text style={styles.thumbInitial}>{product.name.slice(0, 1).toLocaleUpperCase('tr')}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.catalogName} numberOfLines={1}>
            {product.name}
          </Text>
          <Text style={styles.catalogMeta} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        {single ? (
          <TextInput
            value={(quantities[single] ?? 0) > 0 ? String(quantities[single]) : ''}
            onChangeText={(t) => setQty(single, parseInt(t.replace(/\D/g, ''), 10) || 0)}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={color.dimmer}
            style={styles.singleInput}
            onFocus={() => setTimeout(ensureVisible, 60)}
            selectTextOnFocus
          />
        ) : (
          <>
            {active && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{totalQty}</Text>
              </View>
            )}
            <Text style={styles.caret}>{expanded ? '▲' : '▼'}</Text>
          </>
        )}
      </Pressable>

      {expanded && !single && (
        <View style={styles.matrixBox}>
          <QuantityMatrix
            key={focusVariantId ?? 'none'}
            variants={entry.variants}
            quantities={quantities}
            onChange={setQty}
            unitPrice={priceOf}
            currency={currency}
            assortments={assortments}
            customerScope={customerScope}
            onSaveAssortment={onSaveAssortment}
            onAssortmentApplied={onAssortmentApplied}
            focusVariantId={focusVariantId}
            focusRequest={focusRequest}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  custHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: color.text },
  custLabel: { fontSize: 17, fontFamily: font.heading, color: color.text },
  caret: { fontSize: 12, color: color.dimmer },
  custPanel: { borderBottomWidth: 2, borderBottomColor: color.text, paddingBottom: 8 },
  deliveryPanel: { borderBottomWidth: 2, borderBottomColor: color.text, paddingBottom: 8, paddingHorizontal: 18, paddingTop: 8 },
  custInput: { fontFamily: font.body, fontSize: 14, color: color.text, paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  custRow: { paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: color.divider },
  custRowText: { fontSize: 14, color: color.text },

  searchWrap: { paddingHorizontal: 18, paddingTop: 12 },
  searchInput: { fontFamily: font.body, fontSize: 14, color: color.text, height: 42, paddingHorizontal: 12, borderWidth: 1, borderColor: color.divider, backgroundColor: color.surface },

  sectionLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontFamily: font.heading, color: color.dim, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },

  catalogRow: { borderBottomWidth: 1, borderBottomColor: color.divider },
  catalogRowActive: { backgroundColor: color.surface, borderLeftWidth: 3, borderLeftColor: color.accent },
  catalogHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 18 },
  thumb: { width: 44, height: 44, backgroundColor: color.neutral[200] },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbInitial: { fontSize: 18, fontFamily: font.heading, color: color.dim },
  catalogName: { fontSize: 14.5, fontWeight: '700', color: color.text },
  catalogMeta: { fontSize: 11.5, color: color.dimmer, marginTop: 2 },
  badge: { minWidth: 28, height: 24, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent },
  badgeText: { fontSize: 13, fontFamily: font.heading, color: color.bg },
  singleInput: { width: 64, height: 40, paddingVertical: 0, textAlign: 'center', textAlignVertical: 'center', fontFamily: font.bodySemiBold, fontSize: 15, color: color.text, borderWidth: 1, borderColor: color.divider, backgroundColor: color.bg },
  matrixBox: { paddingHorizontal: 18, paddingBottom: 14 },

  notePanel: { paddingHorizontal: 18 },
  noteInput: { fontFamily: font.body, fontSize: 14, color: color.text, minHeight: 90, borderWidth: 1, borderColor: color.divider, padding: 12 },

  error: { color: color.accentRamp[700], paddingHorizontal: 18, paddingTop: 8 },
  discountPanel: { paddingHorizontal: 18 },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  discountChip: { paddingHorizontal: 12, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  discountChipOn: { backgroundColor: color.text },
  discountChipText: { fontSize: 13, color: color.text },
  discountChipTextOn: { color: color.bg, fontFamily: font.heading },
  discountInput: { flex: 1, minWidth: 90, height: 40, paddingVertical: 0, paddingHorizontal: 10, fontFamily: font.bodySemiBold, fontSize: 15, color: color.text, borderWidth: 1, borderColor: color.divider },
  totalSub: { fontSize: 12.5, color: color.dim, fontFamily: font.mono },
  totalGross: { fontSize: 14, color: color.dim, fontFamily: font.mono },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, paddingHorizontal: 18, borderTopWidth: 2, borderTopColor: color.text, marginTop: 8 },
  totalLabel: { fontSize: 13, fontFamily: font.heading, color: color.dim },
  totalValue: { fontSize: 20, fontFamily: font.heading, color: color.text },
  finishBtn: { margin: 18, minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent },
  finishText: { fontFamily: font.heading, fontSize: 14, color: color.bg },
});
