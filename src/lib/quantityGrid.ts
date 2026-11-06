// Ürün varyantlarını adet girişi için bir "ızgara"ya dönüştüren saf mantık —
// sipariş ve satın alma ekranlarının ortak QuantityMatrix bileşeni bunun
// üstüne çizilir (features/catalog/QuantityMatrix.tsx). Ekran/RN'den bağımsız,
// `node --test` ile test edilir (lib/__tests__/quantityGrid.test.ts).
//
// Eksen sayısına göre dört kip:
//   0 eksen  → 'single' : tek bir sayı kutusu
//   1 eksen  → 'strip'  : tek satırlık yatay şerit (başlıkta değerler)
//   2 eksen  → 'matrix' : satır × sütun
//   3+ eksen → 'tabs'   : en çok değerli iki eksen matris, kalanlar sekme
//
// Satır/sütun ataması "renk her zaman satır" gibi sabit bir kurala bağlı
// DEĞİL: değer sayısı az olan eksen sütuna gider (dar ekranda yatay taşmayı
// azaltır), eşitlikte eksen adına göre alfabetik ilki satır olur — her
// render'da aynı sonuç.

import { compareAxisValues } from './variantAxes';

export interface GridAxisAssignment {
  attributeId: string;
  attributeName: string;
  valueLabel: string;
}

export interface GridVariant {
  id: string;
  sku: string;
  axes: GridAxisAssignment[];
  /** false: arşivlenmiş varyant — hücresi pasif/soluk gösterilir. */
  active: boolean;
}

export interface GridAxis {
  attributeId: string;
  name: string;
  values: string[];
}

export type GridMode = 'single' | 'strip' | 'matrix' | 'tabs';

export interface QuantityGrid {
  mode: GridMode;
  /** Tüm eksenler, eksen adına göre sıralı. */
  axes: GridAxis[];
  /** 'matrix'/'tabs': satır ekseni. 'strip'/'single': null. */
  rowAxis: GridAxis | null;
  /** 'matrix'/'tabs': sütun ekseni; 'strip': tek eksen; 'single': null. */
  colAxis: GridAxis | null;
  /** 'tabs': sekme eksenleri (matrise girmeyenler). */
  tabAxes: GridAxis[];
  /** Izgaraya oturan varyantlar (hücre sahibi). */
  cells: GridVariant[];
  /** Hiçbir hücreye oturmayanlar (eksen seti farklı / eksenli üründeki
   * eksensiz "hayalet" varyant) — kaybolmasın diye düz listede gösterilir. */
  stray: GridVariant[];
  /** Koordinatlara ({attributeId: valueLabel}) karşılık gelen varyant. */
  find(coords: Record<string, string>): GridVariant | undefined;
}

export type TabSelection = Record<string, string>;

const cellKey = (pairs: [string, string][]) =>
  [...pairs]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, value]) => `${id}=${value}`)
    .join('|');

const axisSetKey = (v: GridVariant) => v.axes.map((a) => a.attributeId).sort().join('|');

export function buildQuantityGrid(variants: GridVariant[]): QuantityGrid {
  const withAxes = variants.filter((v) => v.axes.length > 0);

  if (withAxes.length === 0) {
    return { mode: 'single', axes: [], rowAxis: null, colAxis: null, tabAxes: [], cells: variants.slice(0, 1), stray: variants.slice(1), find: () => variants[0] };
  }

  // Eksen seti: en sık geçen attribute kümesi.
  const setCounts = new Map<string, number>();
  for (const v of withAxes) setCounts.set(axisSetKey(v), (setCounts.get(axisSetKey(v)) ?? 0) + 1);
  let bestKey = '';
  let bestCount = -1;
  for (const [key, count] of setCounts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  const cells = withAxes.filter((v) => axisSetKey(v) === bestKey);
  const stray = variants.filter((v) => !cells.includes(v));

  const byAttribute = new Map<string, { name: string; values: Set<string> }>();
  for (const v of cells) {
    for (const a of v.axes) {
      let entry = byAttribute.get(a.attributeId);
      if (!entry) {
        entry = { name: a.attributeName, values: new Set() };
        byAttribute.set(a.attributeId, entry);
      }
      entry.values.add(a.valueLabel);
    }
  }
  const axes: GridAxis[] = [...byAttribute.entries()]
    .map(([attributeId, e]) => ({ attributeId, name: e.name, values: [...e.values].sort(compareAxisValues) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const index = new Map<string, GridVariant>();
  for (const v of cells) {
    const key = cellKey(v.axes.map((a) => [a.attributeId, a.valueLabel]));
    if (!index.has(key)) index.set(key, v);
  }
  const find = (coords: Record<string, string>) => index.get(cellKey(Object.entries(coords)));

  if (axes.length === 1) {
    return { mode: 'strip', axes, rowAxis: null, colAxis: axes[0], tabAxes: [], cells, stray, find };
  }

  // Matris eksenleri: en çok değerli iki eksen; kalanlar sekme.
  const byCount = [...axes].sort((a, b) => b.values.length - a.values.length || a.name.localeCompare(b.name, 'tr'));
  const [rowAxis, colAxis] = byCount.slice(0, 2); // çok değerli → satır, az değerli → sütun; eşitlikte ada göre ilki satır
  const tabAxes = axes.filter((a) => a !== rowAxis && a !== colAxis);

  return { mode: tabAxes.length > 0 ? 'tabs' : 'matrix', axes, rowAxis, colAxis, tabAxes, cells, stray, find };
}

/** Sekme eksenlerinin varsayılan seçimi (ilk değerler). */
export function defaultTabSelection(grid: QuantityGrid): TabSelection {
  const sel: TabSelection = {};
  for (const axis of grid.tabAxes) sel[axis.attributeId] = axis.values[0];
  return sel;
}

/** Bir varyantın koordinatlarından, sekme eksenlerine düşen kısım. */
export function tabSelectionOf(grid: QuantityGrid, variant: GridVariant): TabSelection {
  const sel: TabSelection = {};
  for (const axis of grid.tabAxes) {
    const a = variant.axes.find((x) => x.attributeId === axis.attributeId);
    if (a) sel[axis.attributeId] = a.valueLabel;
  }
  return sel;
}

/** Şu anki sekme seçimine ait, ızgaraya oturan varyantlar. */
export function activeCells(grid: QuantityGrid, tabs: TabSelection): GridVariant[] {
  if (grid.mode === 'single') return grid.cells;
  return grid.cells.filter((v) => grid.tabAxes.every((axis) => v.axes.find((a) => a.attributeId === axis.attributeId)?.valueLabel === tabs[axis.attributeId]));
}

/** Bir satırın (rowAxis değeri) ya da sütunun (colAxis değeri) hücreleri. */
export function lineCells(grid: QuantityGrid, tabs: TabSelection, axis: 'row' | 'col', value: string): GridVariant[] {
  const target = axis === 'row' ? grid.rowAxis : grid.colAxis;
  if (!target) return [];
  return activeCells(grid, tabs).filter((v) => v.axes.find((a) => a.attributeId === target.attributeId)?.valueLabel === value);
}

/** Bu varyantın hücresi girişe açık mı: arşivliyse yalnızca içinde adet
 * varsa (temizlenebilsin diye) açık. */
export function isCellEditable(variant: GridVariant, currentQty: number): boolean {
  return variant.active || currentQty > 0;
}

export function sumQuantities(variants: GridVariant[], quantities: Record<string, number>): number {
  return variants.reduce((sum, v) => sum + (quantities[v.id] ?? 0), 0);
}

// ─── Asorti ───────────────────────────────────────────────────────────

/** "1-2-2-2-1" → [1,2,2,2,1]. Ayırıcılar: - , / boşluk. Geçersizse null. */
export function parsePattern(text: string): number[] | null {
  const parts = text
    .trim()
    .split(/[-,/\s]+/)
    .filter((p) => p !== '');
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(parseInt(p, 10));
  }
  return nums.some((n) => n > 0) ? nums : null;
}

export function formatPattern(nums: number[]): string {
  return nums.join('-');
}

export interface AssortmentPlan {
  /** variantId → yeni adet (yalnızca desenin kapsadığı hücreler). */
  changes: Record<string, number>;
  /** Desenin boyunca uygulandığı eksen. */
  axisName: string;
  /** Desen uzunluğu eksenin değer sayısıyla birebir uyuşuyor mu. */
  exact: boolean;
}

/** Deseni matrisin sayıları ekseninde uygular: uzunluğu desenle uyuşan
 * eksen seçilir (ikisi de uyuşursa sütun ekseni; hiçbiri uyuşmazsa daha
 * çok değerli olan, eksik/fazla kısım için `exact:false`). Her satır (veya
 * sütun) desen × set adedi ile doldurulur. Şerit kipinde tek eksen boyunca. */
export function planAssortment(grid: QuantityGrid, tabs: TabSelection, pattern: number[], sets: number): AssortmentPlan | null {
  if (grid.mode === 'single' || !grid.colAxis) return null;
  const candidates = [grid.colAxis, grid.rowAxis].filter((a): a is GridAxis => a !== null);
  const along =
    candidates.find((a) => a.values.length === pattern.length) ??
    [...candidates].sort((a, b) => b.values.length - a.values.length)[0];
  const exact = along.values.length === pattern.length;
  const changes: Record<string, number> = {};
  for (const v of activeCells(grid, tabs)) {
    const value = v.axes.find((a) => a.attributeId === along.attributeId)?.valueLabel;
    if (value === undefined) continue;
    const i = along.values.indexOf(value);
    if (i < 0 || i >= pattern.length) continue;
    changes[v.id] = pattern[i] * Math.max(1, sets);
  }
  return { changes, axisName: along.name, exact };
}

/** "3 renk · 5 beden" — katalog satırının özeti. Eksensiz üründe boş. */
export function summarizeAxes(grid: QuantityGrid): string {
  return grid.axes.map((a) => `${a.values.length} ${a.name.toLocaleLowerCase('tr')}`).join(' · ');
}
