import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useEnsureFocusedVisible } from '@/components/keyboard-scroll';
import { color, font, space } from '@/design-system';
import { formatMoney } from '@/lib/money';
import {
  activeCells,
  buildQuantityGrid,
  defaultTabSelection,
  formatPattern,
  isCellEditable,
  lineCells,
  parsePattern,
  planAssortment,
  sumQuantities,
  tabSelectionOf,
  type GridVariant,
  type TabSelection,
} from '@/lib/quantityGrid';
import type { AssortmentPattern } from '@/models';
import type { VariantWithAttributes } from '@/services';

/** Bir ürünün varyantlarına adet girme bileşeni — sipariş ve satın alma
 * ekranlarının ORTAK girişi (ileride sipariş onayı / NLP taslağı da bunu
 * kullanacak). Tek bileşen, eksen sayısına göre dört kip (lib/quantityGrid.ts):
 *   0 eksen → tek sayı kutusu · 1 eksen → yatay şerit · 2 eksen → matris ·
 *   3+ eksen → ilk iki eksen matris, kalanlar sekme.
 * Satır/sütun ataması değer sayısına göre otomatik (az değerli → sütun).
 * Etiket sütunu sabit, hücreler yatay kayar. Hücrelere doğrudan sayı yazılır
 * (klavyenin "ileri" tuşu bir sonraki hücreye geçer); satır/sütun/genel
 * toplamlar anlık. Hızlı doldurma: Hepsine N · satır/sütun başlığına dokun
 * (N ile doldur) veya uzun bas (değer gir) · Temizle · Asorti. Arşivli / hiç
 * oluşturulmamış kombinasyon hücreleri pasif ve soluk. */
export function QuantityMatrix({
  variants,
  quantities,
  onChange,
  cellCaption,
  unitPrice,
  currency,
  assortments,
  customerScope,
  onSaveAssortment,
  onAssortmentApplied,
  focusVariantId,
  focusRequest,
}: {
  variants: VariantWithAttributes[];
  /** variantId → adet (0/yok = girilmemiş). */
  quantities: Record<string, number>;
  /** Fonksiyonel state güncellemesiyle yazılmalı — toplu işlemler hücre başına çağırır. */
  onChange: (variantId: string, quantity: number) => void;
  /** Bir hücrenin adedinin altında gösterilen küçük yazı (Satın Almalar'da birim fiyat). */
  cellCaption?: (variantId: string) => string | null;
  /** Varyantın birim fiyatı (minor unit) — verilirse matrisin altında tutar gösterilir. */
  unitPrice?: (variantId: string) => number | null;
  currency?: string;
  /** Verilirse "Asorti" düğmesi görünür (kayıtlı desenler, müşteriye özel önce). */
  assortments?: AssortmentPattern[];
  /** Asorti panelinde "Bu müşteri için kaydet" düğmesi gösterilsin mi. */
  customerScope?: boolean;
  onSaveAssortment?: (pattern: string, scope: 'customer' | 'shared') => Promise<void>;
  /** Asorti uygulandıktan sonra çağrılır — sipariş grubunda desen/set adedi saklanır. */
  onAssortmentApplied?: (pattern: string, sets: number) => void;
  /** Bu varyantın hücresi vurgulanır ve sekmesi seçilir (arama: "kırmızı 42"). */
  focusVariantId?: string | null;
  /** > 0 olduğunda `focusVariantId` hücresine klavye odağı verilir (aramada
   * Enter'a basılınca) — yazarken odak çalınmaz. */
  focusRequest?: number;
}) {
  const gridVariants: GridVariant[] = useMemo(
    () => variants.map((v) => ({ id: v.variant.id, sku: v.variant.sku, axes: v.axes, active: v.variant.is_active === 1 })),
    [variants],
  );
  const grid = useMemo(() => buildQuantityGrid(gridVariants), [gridVariants]);

  const [tabOverride, setTabOverride] = useState<TabSelection>({});
  const focusVariant = focusVariantId ? gridVariants.find((v) => v.id === focusVariantId) : undefined;
  const tabs: TabSelection = { ...defaultTabSelection(grid), ...(focusVariant ? tabSelectionOf(grid, focusVariant) : {}), ...tabOverride };

  const [fill, setFill] = useState('1');
  const fillValue = Math.max(0, parseInt(fill, 10) || 0);
  const [focused, setFocused] = useState<string | null>(focusVariantId ?? null);
  const [showAsorti, setShowAsorti] = useState(false);
  const [sets, setSets] = useState('1');
  const [patternText, setPatternText] = useState('');
  const [asortiNote, setAsortiNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ axis: 'row' | 'col'; value: string; text: string } | null>(null);
  const inputs = useRef<Record<string, TextInput | null>>({});
  const ensureVisible = useEnsureFocusedVisible();

  const qtyOf = (id: string) => quantities[id] ?? 0;
  const parseQty = (text: string) => parseInt(text.replace(/\D/g, ''), 10) || 0;

  useEffect(() => {
    if (!focusVariantId || !focusRequest) return;
    const t = setTimeout(() => inputs.current[focusVariantId]?.focus(), 200);
    return () => clearTimeout(t);
  }, [focusVariantId, focusRequest]);

  const cellAt = (rowValue: string | null, colValue: string) => {
    if (!grid.colAxis) return undefined;
    const coords: Record<string, string> = { ...tabs, [grid.colAxis.attributeId]: colValue };
    if (grid.rowAxis && rowValue !== null) coords[grid.rowAxis.attributeId] = rowValue;
    return grid.find(coords);
  };

  const editableIds = (cells: GridVariant[]) => cells.filter((v) => isCellEditable(v, qtyOf(v.id))).map((v) => v.id);
  const activeIds = editableIds(activeCells(grid, tabs));

  /** Sırayla: satırlar yukarıdan aşağı, satır içinde soldan sağa — "ileri" tuşunun gezdiği sıra. */
  const navOrder: string[] = useMemo(() => {
    const order: string[] = [];
    if (grid.mode === 'matrix' || grid.mode === 'tabs') {
      for (const rv of grid.rowAxis?.values ?? []) {
        for (const cv of grid.colAxis?.values ?? []) {
          const v = cellAt(rv, cv);
          if (v && isCellEditable(v, quantities[v.id] ?? 0)) order.push(v.id);
        }
      }
    } else if (grid.mode === 'strip') {
      for (const cv of grid.colAxis?.values ?? []) {
        const v = cellAt(null, cv);
        if (v && isCellEditable(v, quantities[v.id] ?? 0)) order.push(v.id);
      }
    } else {
      for (const v of grid.cells) order.push(v.id);
    }
    for (const v of grid.stray) order.push(v.id);
    return order;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, tabs, quantities]);

  const focusNext = (id: string) => {
    const next = navOrder[navOrder.indexOf(id) + 1];
    if (next) inputs.current[next]?.focus();
    else Keyboard.dismiss();
  };

  const setMany = (ids: string[], n: number) => ids.forEach((id) => onChange(id, n));

  /** Başlığa dokunma: hepsi zaten `fillValue` ise temizler, değilse doldurur. */
  const fillLine = (ids: string[]) => {
    if (ids.length === 0) return;
    const allSet = fillValue > 0 && ids.every((id) => qtyOf(id) === fillValue);
    setMany(ids, allSet ? 0 : fillValue);
  };

  const openPrompt = (axis: 'row' | 'col', value: string) => setPrompt({ axis, value, text: fill });
  const applyPrompt = () => {
    if (!prompt) return;
    setMany(editableIds(lineCells(grid, tabs, prompt.axis, prompt.value)), parseQty(prompt.text));
    setPrompt(null);
  };

  const applyPattern = (text: string) => {
    const nums = parsePattern(text);
    if (!nums) {
      setAsortiNote('Desen geçersiz — örn. 1-2-2-2-1');
      return;
    }
    const setCount = Math.max(1, parseInt(sets, 10) || 1);
    const plan = planAssortment(grid, tabs, nums, setCount);
    if (!plan) return;
    const allowed = new Set(activeIds);
    for (const [id, n] of Object.entries(plan.changes)) if (allowed.has(id)) onChange(id, n);
    setAsortiNote(plan.exact ? null : `Desen ${nums.length} değerli; ${plan.axisName} ekseninde ${grid.axes.find((a) => a.name === plan.axisName)?.values.length} değer var — uyan kısmı uygulandı.`);
    onAssortmentApplied?.(formatPattern(nums), setCount);
  };

  const grandTotal = sumQuantities(gridVariants, quantities);
  const amount = unitPrice ? gridVariants.reduce((sum, v) => sum + qtyOf(v.id) * (unitPrice(v.id) ?? 0), 0) : null;

  const renderInput = (v: GridVariant, style: object, opts?: { placeholder?: string }) => {
    const q = qtyOf(v.id);
    const last = navOrder[navOrder.length - 1] === v.id;
    return (
      <TextInput
        ref={(r) => {
          inputs.current[v.id] = r;
        }}
        value={q > 0 ? String(q) : ''}
        onChangeText={(t) => onChange(v.id, parseQty(t))}
        onFocus={() => {
          setFocused(v.id);
          setTimeout(ensureVisible, 60);
        }}
        onBlur={() => setFocused((f) => (f === v.id ? null : f))}
        onSubmitEditing={() => focusNext(v.id)}
        editable={isCellEditable(v, q)}
        keyboardType="number-pad"
        returnKeyType={last ? 'done' : 'next'}
        blurOnSubmit={last}
        placeholder={opts?.placeholder ?? '·'}
        placeholderTextColor={color.dimmer}
        style={style}
        selectTextOnFocus
      />
    );
  };

  const renderCell = (v: GridVariant | undefined, key: string) => {
    if (!v) {
      return (
        <View key={key} style={[styles.cell, styles.cellVoid]}>
          <Text style={styles.voidText}>–</Text>
        </View>
      );
    }
    const q = qtyOf(v.id);
    const caption = q > 0 ? cellCaption?.(v.id) : null;
    return (
      <View key={key} style={[styles.cell, q > 0 && styles.cellFilled, !v.active && styles.cellArchived, focused === v.id && styles.cellFocus]}>
        {renderInput(v, styles.cellInput)}
        {!!caption && <Text style={styles.cellCaption}>{caption}</Text>}
      </View>
    );
  };

  const showToolbar = grid.mode !== 'single' && activeIds.length > 0;
  const rowAxis = grid.rowAxis;
  const colAxis = grid.colAxis;

  return (
    <View style={styles.wrap}>
      {grid.mode !== 'single' && (
        <Text style={styles.caption}>
          {grid.mode === 'strip' ? colAxis?.name : `${rowAxis?.name} × ${colAxis?.name}`}
        </Text>
      )}

      {grid.tabAxes.map((axis) => (
        <ScrollView key={axis.attributeId} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          <Text style={styles.tabAxisName}>{axis.name}</Text>
          {axis.values.map((value) => {
            const selected = tabs[axis.attributeId] === value;
            const sub = sumQuantities(
              grid.cells.filter((c) => c.axes.find((a) => a.attributeId === axis.attributeId)?.valueLabel === value),
              quantities,
            );
            return (
              <Pressable
                key={value}
                onPress={() => setTabOverride((prev) => ({ ...prev, [axis.attributeId]: value }))}
                style={[styles.tab, selected && styles.tabSelected]}>
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{sub > 0 ? `${value} · ${sub}` : value}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ))}

      {showToolbar && (
        <>
          <View style={styles.fillRow}>
            <Text style={styles.fillLabel}>Hepsine</Text>
            <TextInput value={fill} onChangeText={(t) => setFill(t.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.fillInput} selectTextOnFocus />
            <Pressable onPress={() => setMany(activeIds, fillValue)} style={styles.fillBtn} hitSlop={4}>
              <Text style={styles.fillBtnText}>Yaz</Text>
            </Pressable>
            {assortments && (
              <Pressable onPress={() => setShowAsorti((s) => !s)} style={[styles.fillBtn, showAsorti && styles.fillBtnOn]} hitSlop={4}>
                <Text style={[styles.fillBtnText, showAsorti && styles.fillBtnTextOn]}>Asorti</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setMany(activeIds, 0)} style={styles.fillBtn} hitSlop={4}>
              <Text style={styles.fillBtnText}>Temizle</Text>
            </Pressable>
          </View>

          {showAsorti && assortments && (
            <View style={styles.panel}>
              <View style={styles.panelRow}>
                <Text style={styles.fillLabel}>Koli / set</Text>
                <TextInput value={sets} onChangeText={(t) => setSets(t.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.fillInput} selectTextOnFocus />
                <Text style={styles.panelHint}>desen × set adedi</Text>
              </View>
              {assortments.length > 0 && (
                <View style={styles.chipRow}>
                  {assortments.map((p) => (
                    <Pressable key={p.id} onPress={() => applyPattern(p.pattern)} style={styles.chip}>
                      <Text style={styles.chipText}>
                        {p.pattern}
                        {p.customer_id ? ' · müşteri' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={styles.panelRow}>
                <TextInput
                  value={patternText}
                  onChangeText={setPatternText}
                  placeholder="Yeni desen: 1-2-2-2-1"
                  placeholderTextColor={color.dimmer}
                  style={styles.patternInput}
                  autoCapitalize="none"
                />
                <Pressable onPress={() => applyPattern(patternText)} style={styles.fillBtn} hitSlop={4}>
                  <Text style={styles.fillBtnText}>Uygula</Text>
                </Pressable>
              </View>
              {!!onSaveAssortment && !!parsePattern(patternText) && (
                <View style={styles.panelRow}>
                  <Text style={styles.panelHint}>Deseni kaydet:</Text>
                  {customerScope && (
                    <Pressable onPress={() => void onSaveAssortment(patternText, 'customer')} style={styles.chip}>
                      <Text style={styles.chipText}>Bu müşteri için</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => void onSaveAssortment(patternText, 'shared')} style={styles.chip}>
                    <Text style={styles.chipText}>Herkes için</Text>
                  </Pressable>
                </View>
              )}
              {!!asortiNote && <Text style={styles.panelHint}>{asortiNote}</Text>}
            </View>
          )}

          {(grid.mode === 'matrix' || grid.mode === 'tabs') && <Text style={styles.hint}>Başlığa dokun: Hepsine değeriyle doldur · uzun bas: değer gir.</Text>}

          {prompt && (
            <View style={styles.panelRow}>
              <Text style={styles.fillLabel}>“{prompt.value}” için adet</Text>
              <TextInput
                value={prompt.text}
                onChangeText={(t) => setPrompt((p) => (p ? { ...p, text: t.replace(/\D/g, '') } : p))}
                keyboardType="number-pad"
                style={styles.fillInput}
                autoFocus
                selectTextOnFocus
              />
              <Pressable onPress={applyPrompt} style={styles.fillBtn} hitSlop={4}>
                <Text style={styles.fillBtnText}>Uygula</Text>
              </Pressable>
              <Pressable onPress={() => setPrompt(null)} hitSlop={6}>
                <Text style={styles.panelHint}>İptal</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      {(grid.mode === 'matrix' || grid.mode === 'tabs') && rowAxis && colAxis && (
        <View style={styles.matrixWrap}>
          <View>
            <View style={styles.corner}>
              <Text style={styles.cornerText} numberOfLines={2}>
                {rowAxis.name}
              </Text>
            </View>
            {rowAxis.values.map((rv) => (
              <Pressable
                key={rv}
                style={styles.rowHead}
                onPress={() => fillLine(editableIds(lineCells(grid, tabs, 'row', rv)))}
                onLongPress={() => openPrompt('row', rv)}
                delayLongPress={350}>
                <Text style={styles.headText} numberOfLines={2}>
                  {rv}
                </Text>
              </Pressable>
            ))}
            <View style={styles.totalRowHead}>
              <Text style={styles.sumHead}>Σ</Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scroller}>
            <View>
              <View style={styles.row}>
                {colAxis.values.map((cv) => (
                  <Pressable
                    key={cv}
                    style={styles.headCell}
                    onPress={() => fillLine(editableIds(lineCells(grid, tabs, 'col', cv)))}
                    onLongPress={() => openPrompt('col', cv)}
                    delayLongPress={350}>
                    <Text style={styles.headText} numberOfLines={2}>
                      {cv}
                    </Text>
                  </Pressable>
                ))}
                <View style={styles.headCell}>
                  <Text style={styles.sumHead}>Σ</Text>
                </View>
              </View>

              {rowAxis.values.map((rv) => {
                const rowTotal = lineCells(grid, tabs, 'row', rv).reduce((s, v) => s + qtyOf(v.id), 0);
                return (
                  <View key={rv} style={styles.row}>
                    {colAxis.values.map((cv) => renderCell(cellAt(rv, cv), cv))}
                    <View style={styles.totalCell}>
                      <Text style={styles.totalText}>{rowTotal || ''}</Text>
                    </View>
                  </View>
                );
              })}

              <View style={styles.row}>
                {colAxis.values.map((cv) => {
                  const colTotal = lineCells(grid, tabs, 'col', cv).reduce((s, v) => s + qtyOf(v.id), 0);
                  return (
                    <View key={cv} style={styles.totalCell}>
                      <Text style={styles.totalText}>{colTotal || ''}</Text>
                    </View>
                  );
                })}
                <View style={styles.totalCell}>
                  <Text style={styles.grandText}>{sumQuantities(activeCells(grid, tabs), quantities) || ''}</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      )}

      {grid.mode === 'strip' && colAxis && (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={styles.row}>
              {colAxis.values.map((cv) => (
                <Pressable
                  key={cv}
                  style={styles.headCell}
                  onPress={() => fillLine(editableIds(lineCells(grid, tabs, 'col', cv)))}
                  onLongPress={() => openPrompt('col', cv)}
                  delayLongPress={350}>
                  <Text style={styles.headText} numberOfLines={2}>
                    {cv}
                  </Text>
                </Pressable>
              ))}
              <View style={styles.headCell}>
                <Text style={styles.sumHead}>Σ</Text>
              </View>
            </View>
            <View style={styles.row}>
              {colAxis.values.map((cv) => renderCell(cellAt(null, cv), cv))}
              <View style={styles.totalCell}>
                <Text style={styles.grandText}>{sumQuantities(grid.cells, quantities) || ''}</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      {grid.mode === 'single' &&
        grid.cells.map((v) => (
          <View key={v.id} style={styles.flatRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.flatLabel}>{v.sku}</Text>
              {cellCaption?.(v.id) ? <Text style={styles.flatSku}>{cellCaption(v.id)}</Text> : null}
            </View>
            {renderInput(v, styles.flatInput, { placeholder: '0' })}
          </View>
        ))}

      {grid.stray.length > 0 && (
        <View style={styles.flatList}>
          <Text style={styles.strayNote}>Eksenlere uymayan varyant{grid.stray.length > 1 ? 'lar' : ''}</Text>
          {grid.stray.map((v) => (
            <View key={v.id} style={[styles.flatRow, !v.active && styles.cellArchived]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.flatLabel}>{v.axes.length > 0 ? v.axes.map((a) => a.valueLabel).join(' · ') : v.sku}</Text>
                <Text style={styles.flatSku}>{v.sku}</Text>
              </View>
              {renderInput(v, styles.flatInput, { placeholder: '0' })}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.grandTotalLine}>
        Toplam: {grandTotal} adet
        {amount !== null && currency ? ` · Tutar: ${formatMoney(amount, currency)}` : ''}
      </Text>
    </View>
  );
}

const CELL_W = 60;
const ROW_H = 52;

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  caption: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim },
  hint: { fontSize: 11, color: color.dimmer },

  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabAxisName: { fontSize: 11, color: color.dim, marginRight: 2 },
  tab: { paddingHorizontal: 12, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.divider },
  tabSelected: { backgroundColor: color.text, borderColor: color.text },
  tabText: { fontSize: 12.5, color: color.text },
  tabTextSelected: { color: color.bg, fontFamily: font.heading },

  fillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  fillLabel: { fontSize: 12, color: color.dim },
  fillInput: { width: 48, height: 36, paddingVertical: 0, textAlign: 'center', textAlignVertical: 'center', fontFamily: font.bodySemiBold, fontSize: 14, color: color.text, borderWidth: 1, borderColor: color.divider },
  fillBtn: { height: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  fillBtnOn: { backgroundColor: color.text },
  fillBtnText: { fontSize: 12, fontFamily: font.heading, color: color.text },
  fillBtnTextOn: { color: color.bg },

  panel: { gap: 8, padding: 10, borderWidth: 1, borderColor: color.divider, backgroundColor: color.surface },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  panelHint: { fontSize: 11.5, color: color.dim },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  chipText: { fontSize: 12.5, fontFamily: font.heading, color: color.text },
  patternInput: { flex: 1, minWidth: 140, height: 36, paddingVertical: 0, paddingHorizontal: 8, fontFamily: font.bodySemiBold, fontSize: 14, color: color.text, borderWidth: 1, borderColor: color.divider, backgroundColor: color.bg },

  matrixWrap: { flexDirection: 'row' },
  scroller: { flex: 1 },
  row: { flexDirection: 'row' },
  corner: { width: 72, height: 40, justifyContent: 'center' },
  cornerText: { fontSize: 10, color: color.dim, textTransform: 'uppercase' },
  headCell: { width: CELL_W, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  headText: { fontSize: 11.5, color: color.text, textAlign: 'center' },
  sumHead: { fontSize: 12, color: color.dim, fontFamily: font.heading },
  rowHead: { width: 72, height: ROW_H, alignItems: 'flex-start', justifyContent: 'center', paddingRight: 4 },
  totalRowHead: { width: 72, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  cell: { width: CELL_W, height: ROW_H, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.divider },
  cellFilled: { backgroundColor: color.surface, borderColor: color.text },
  cellFocus: { borderColor: color.accent, borderWidth: 2 },
  cellArchived: { opacity: 0.45 },
  cellVoid: { backgroundColor: color.neutral[200], opacity: 0.6 },
  voidText: { fontSize: 13, color: color.dimmer },
  cellInput: { width: '100%', height: 30, padding: 0, textAlign: 'center', fontFamily: font.bodySemiBold, fontSize: 15, color: color.text },
  cellCaption: { fontSize: 9, color: color.dimmer, marginTop: -2 },
  totalCell: { width: CELL_W, height: 40, alignItems: 'center', justifyContent: 'center' },
  totalText: { fontSize: 13, color: color.dim, fontFamily: font.bodySemiBold },
  grandText: { fontSize: 14, color: color.text, fontFamily: font.heading },

  flatList: { gap: 2 },
  strayNote: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim },
  flatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.divider },
  flatLabel: { fontSize: 14, color: color.text },
  flatSku: { fontSize: 11, color: color.dimmer, marginTop: 2 },
  flatInput: { width: 72, height: 40, paddingVertical: 0, textAlign: 'center', textAlignVertical: 'center', fontFamily: font.bodySemiBold, fontSize: 15, color: color.text, borderWidth: 1, borderColor: color.divider },

  grandTotalLine: { fontSize: 12, color: color.dim, fontFamily: font.bodySemiBold },
});
