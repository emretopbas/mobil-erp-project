// Adet ızgarası (lib/quantityGrid.ts) — kipler, satır/sütun ataması, asorti.
// Çalıştırma: `node scripts/run-ts-tests.mjs quantityGrid`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeCells,
  buildQuantityGrid,
  defaultTabSelection,
  formatPattern,
  isCellEditable,
  lineCells,
  parsePattern,
  planAssortment,
  summarizeAxes,
  tabSelectionOf,
  type GridVariant,
} from '../quantityGrid.ts';
import { matchProduct, normalizeSearch } from '../catalogSearch.ts';

const RENK = { attributeId: 'a-renk', attributeName: 'Renk' };
const BEDEN = { attributeId: 'a-beden', attributeName: 'Beden' };
const MAT = { attributeId: 'a-mat', attributeName: 'Materyal' };

let seq = 0;
function variant(axes: [typeof RENK, string][], active = true): GridVariant {
  seq += 1;
  return {
    id: `v${seq}`,
    sku: `SKU-${axes.map(([, v]) => v).join('-')}`,
    axes: axes.map(([a, valueLabel]) => ({ ...a, valueLabel })),
    active,
  };
}

const colors = ['Kırmızı', 'Siyah', 'Mavi'];
const sizes = ['38', '39', '40', '41', '42'];
const shoe = () => colors.flatMap((c) => sizes.map((s) => variant([[RENK, c], [BEDEN, s]])));

test('eksensiz ürün: tek kip, tek hücre', () => {
  const v = { id: 'x', sku: 'X', axes: [], active: true };
  const grid = buildQuantityGrid([v]);
  assert.equal(grid.mode, 'single');
  assert.deepEqual(grid.cells, [v]);
  assert.equal(summarizeAxes(grid), '');
});

test('tek eksen: şerit kipi, değerler doğal sırada', () => {
  const grid = buildQuantityGrid(['42', '38', '40'].map((s) => variant([[BEDEN, s]])));
  assert.equal(grid.mode, 'strip');
  assert.deepEqual(grid.colAxis?.values, ['38', '40', '42']);
  assert.equal(grid.rowAxis, null);
});

test('iki eksen: az değerli eksen sütuna, çok değerli satıra (3 renk × 5 beden)', () => {
  const grid = buildQuantityGrid(shoe());
  assert.equal(grid.mode, 'matrix');
  assert.equal(grid.rowAxis?.name, 'Beden');
  assert.equal(grid.colAxis?.name, 'Renk');
  assert.equal(summarizeAxes(grid), '5 beden · 3 renk');
});

test('değer sayısı eşitse eksen adına göre alfabetik ilki satır olur (sabit sonuç)', () => {
  const vs = ['Kırmızı', 'Siyah'].flatMap((c) => ['S', 'M'].map((s) => variant([[RENK, c], [BEDEN, s]])));
  const a = buildQuantityGrid(vs);
  const b = buildQuantityGrid([...vs].reverse());
  assert.equal(a.rowAxis?.name, 'Beden');
  assert.equal(b.rowAxis?.name, 'Beden');
});

test('yerleşim eksen sayısına değil değer sayısına bağlı: renk çok, beden az ise renk satır', () => {
  const many = ['A', 'B', 'C', 'D', 'E'];
  const vs = many.flatMap((c) => ['S', 'M'].map((s) => variant([[RENK, c], [BEDEN, s]])));
  const grid = buildQuantityGrid(vs);
  assert.equal(grid.rowAxis?.name, 'Renk');
  assert.equal(grid.colAxis?.name, 'Beden');
});

test('3 eksen: en az değerli eksen sekme, kalan ikisi matris; her sekmenin hücreleri ayrı', () => {
  const vs = ['Deri', 'Kumaş'].flatMap((m) => colors.flatMap((c) => sizes.map((s) => variant([[MAT, m], [RENK, c], [BEDEN, s]]))));
  const grid = buildQuantityGrid(vs);
  assert.equal(grid.mode, 'tabs');
  assert.deepEqual(grid.tabAxes.map((a) => a.name), ['Materyal']);
  assert.equal(grid.rowAxis?.name, 'Beden');
  const deri = { 'a-mat': 'Deri' };
  const kumas = { 'a-mat': 'Kumaş' };
  assert.equal(activeCells(grid, deri).length, 15);
  assert.equal(activeCells(grid, kumas).length, 15);
  assert.notEqual(activeCells(grid, deri)[0].id, activeCells(grid, kumas)[0].id);
  assert.deepEqual(defaultTabSelection(grid), { 'a-mat': grid.tabAxes[0].values[0] });
  assert.deepEqual(tabSelectionOf(grid, vs[20]), { 'a-mat': 'Kumaş' });
});

test('find: koordinattan varyant; olmayan kombinasyon undefined', () => {
  const vs = shoe().filter((v) => !(v.axes[0].valueLabel === 'Mavi' && v.axes[1].valueLabel === '42'));
  const grid = buildQuantityGrid(vs);
  assert.ok(grid.find({ 'a-renk': 'Siyah', 'a-beden': '40' }));
  assert.equal(grid.find({ 'a-renk': 'Mavi', 'a-beden': '42' }), undefined);
});

test('eksenli üründeki eksensiz hayalet varyant hücreye oturmaz, stray listesinde kalır', () => {
  const ghost: GridVariant = { id: 'ghost', sku: '25770-1', axes: [], active: true };
  const grid = buildQuantityGrid([ghost, ...shoe()]);
  assert.equal(grid.mode, 'matrix');
  assert.deepEqual(grid.stray.map((v) => v.id), ['ghost']);
  assert.equal(grid.cells.length, 15);
});

test('arşivli hücre: adet yoksa kapalı, adet varsa temizlenebilsin diye açık', () => {
  const archived = variant([[BEDEN, '40']], false);
  assert.equal(isCellEditable(archived, 0), false);
  assert.equal(isCellEditable(archived, 3), true);
  assert.equal(isCellEditable(variant([[BEDEN, '41']]), 0), true);
});

test('lineCells: satır ve sütunun hücreleri', () => {
  const grid = buildQuantityGrid(shoe());
  assert.equal(lineCells(grid, {}, 'col', 'Siyah').length, 5);
  assert.equal(lineCells(grid, {}, 'row', '40').length, 3);
});

test('parsePattern / formatPattern', () => {
  assert.deepEqual(parsePattern('1-2-2-2-1'), [1, 2, 2, 2, 1]);
  assert.deepEqual(parsePattern('1, 2 2/2 1'), [1, 2, 2, 2, 1]);
  assert.equal(parsePattern(''), null);
  assert.equal(parsePattern('a-b'), null);
  assert.equal(parsePattern('0-0'), null);
  assert.equal(formatPattern([1, 2, 2, 2, 1]), '1-2-2-2-1');
});

test('asorti 1-2-2-2-1: beden ekseni boyunca her renk için doldurur (3 koli)', () => {
  const vs = shoe();
  const grid = buildQuantityGrid(vs);
  const plan = planAssortment(grid, {}, [1, 2, 2, 2, 1], 3);
  assert.ok(plan);
  assert.equal(plan.axisName, 'Beden');
  assert.equal(plan.exact, true);
  assert.equal(Object.keys(plan.changes).length, 15);
  for (const v of vs) {
    const size = v.axes.find((a) => a.attributeId === 'a-beden')!.valueLabel;
    const expected = [1, 2, 2, 2, 1][sizes.indexOf(size)] * 3;
    assert.equal(plan.changes[v.id], expected);
  }
});

test('asorti uzunluğu hiçbir eksenle uyuşmazsa çok değerli eksen kullanılır, exact=false', () => {
  const grid = buildQuantityGrid(shoe());
  const plan = planAssortment(grid, {}, [1, 1, 1, 1], 1);
  assert.ok(plan);
  assert.equal(plan.exact, false);
  assert.equal(plan.axisName, 'Beden');
  assert.equal(Object.keys(plan.changes).length, 12); // ilk 4 beden × 3 renk
});

test('asorti sekmeli üründe sadece aktif sekmeye uygulanır', () => {
  const vs = ['Deri', 'Kumaş'].flatMap((m) => colors.flatMap((c) => sizes.map((s) => variant([[MAT, m], [RENK, c], [BEDEN, s]]))));
  const grid = buildQuantityGrid(vs);
  const plan = planAssortment(grid, { 'a-mat': 'Kumaş' }, [1, 2, 2, 2, 1], 1);
  assert.ok(plan);
  assert.equal(Object.keys(plan.changes).length, 15);
  assert.ok(Object.keys(plan.changes).every((id) => vs.find((v) => v.id === id)!.axes[0].valueLabel === 'Kumaş'));
});

test('arama: Türkçe karakter normalleştirme', () => {
  assert.equal(normalizeSearch('KIRMIZI Şık'), 'kirmizi sik');
});

test('arama "kırmızı 42": ürünü bulur ve doğru hücreyi odaklar', () => {
  const vs = shoe();
  const target = vs.find((v) => v.axes[0].valueLabel === 'Kırmızı' && v.axes[1].valueLabel === '42')!;
  const r = matchProduct('kırmızı 42', { name: '25770', sku: '25770' }, vs);
  assert.equal(r.matched, true);
  assert.equal(r.focusVariantId, target.id);
});

test('arama: ürün adı eşleşirse odak yok; eşleşmeyen sorgu ürünü eler', () => {
  const vs = shoe();
  assert.deepEqual(matchProduct('25770', { name: '25770', sku: 'X' }, vs), { matched: true, focusVariantId: null });
  assert.equal(matchProduct('yeşil', { name: '25770', sku: 'X' }, vs).matched, false);
  assert.deepEqual(matchProduct('  ', { name: 'a', sku: 'b' }, vs), { matched: true, focusVariantId: null });
});

test('arama: ürün adı + varyant kelimesi birlikte ("25770 siyah")', () => {
  const vs = shoe();
  const r = matchProduct('25770 siyah', { name: '25770', sku: 'X' }, vs);
  assert.equal(r.matched, true);
  assert.equal(vs.find((v) => v.id === r.focusVariantId)!.axes[0].valueLabel, 'Siyah');
});
