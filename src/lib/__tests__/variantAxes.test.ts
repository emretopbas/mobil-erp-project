// Eksen tabanlı varyant sistemi — saf mantık testleri (CLAUDE.md §8: "Her
// modül için birim test iskeleti"). Bu dosya sınıf/constructor kullanmıyor,
// bu yüzden diğer __tests__ dosyalarının aksine (bkz. StockService.test.ts'in
// başlık yorumu) doğrudan `node --test` ile de çalışır.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalVariantKey,
  cartesianProduct,
  generateNumericRange,
  renderSkuTemplate,
  slugifyAttributeCode,
  type Axis,
} from '../variantAxes.ts';

function v(label: string, canonicalValue = label.toUpperCase(), skuToken?: string) {
  return { label, canonicalValue, skuToken };
}

test('cartesianProduct: 4 renk × 8 beden = 32 kombinasyon', () => {
  const colors: Axis = {
    attributeId: 'a-color',
    code: 'color',
    dataType: 'option',
    values: ['Kırmızı', 'Mavi', 'Siyah', 'Beyaz'].map((l) => v(l)),
  };
  const sizes: Axis = {
    attributeId: 'a-size',
    code: 'size',
    dataType: 'option',
    values: ['36', '37', '38', '39', '40', '41', '42', '43'].map((l) => v(l)),
  };
  const combos = cartesianProduct([colors, sizes]);
  assert.equal(combos.length, 32);
  // Her kombinasyon tam olarak 2 pick taşımalı (renk + beden).
  for (const c of combos) assert.equal(c.picks.length, 2);
});

test('cartesianProduct: tek eksen → eksen değeri kadar kombinasyon', () => {
  const axis: Axis = { attributeId: 'a1', code: 'material', dataType: 'text', values: [v('Çelik'), v('Alüminyum')] };
  const combos = cartesianProduct([axis]);
  assert.equal(combos.length, 2);
});

test('cartesianProduct: eksen yok → boş dizi (kullanıcı "varyant yok" seçmiş demektir)', () => {
  assert.deepEqual(cartesianProduct([]), []);
});

test('cartesianProduct: çok büyük kombinasyon sayısında hata fırlatır', () => {
  const axes: Axis[] = Array.from({ length: 6 }, (_, i) => ({
    attributeId: `a${i}`,
    code: `axis${i}`,
    dataType: 'text' as const,
    values: Array.from({ length: 10 }, (_, j) => v(`v${j}`)),
  }));
  assert.throws(() => cartesianProduct(axes));
});

test('canonicalVariantKey: alfabetik sıralama (material < length_cm ise material önce)', () => {
  // Şartnamenin kendi örneği: material=STEEL|length_cm=120
  const key = canonicalVariantKey({
    picks: [
      { code: 'length_cm', attributeId: 'a2', dataType: 'number', value: v('120') },
      { code: 'material', attributeId: 'a1', dataType: 'option', value: v('Çelik', 'STEEL') },
    ],
  });
  assert.equal(key, 'length_cm=120|material=STEEL');
});

test('canonicalVariantKey: eksensiz kombinasyon → boş string', () => {
  assert.equal(canonicalVariantKey({ picks: [] }), '');
});

test('canonicalVariantKey: tek eksen', () => {
  const key = canonicalVariantKey({ picks: [{ code: 'color', attributeId: 'a1', dataType: 'option', value: v('Kırmızı', 'KIRMIZI') }] });
  assert.equal(key, 'color=KIRMIZI');
});

test('generateNumericRange: 36-46, adım 1 → 11 değer', () => {
  const values = generateNumericRange(36, 46, 1);
  assert.equal(values.length, 11);
  assert.deepEqual(values, [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]);
});

test('generateNumericRange: kesirli adım (0.5-3mm, adım 0.5)', () => {
  const values = generateNumericRange(0.5, 3, 0.5);
  assert.deepEqual(values, [0.5, 1, 1.5, 2, 2.5, 3]);
});

test('generateNumericRange: step<=0 reddedilir', () => {
  assert.throws(() => generateNumericRange(1, 10, 0));
  assert.throws(() => generateNumericRange(1, 10, -1));
});

test('generateNumericRange: to < from reddedilir', () => {
  assert.throws(() => generateNumericRange(10, 1, 1));
});

test('renderSkuTemplate: {sku}-{color}-{size} şablonu', () => {
  const result = renderSkuTemplate('{sku}-{color}-{size}', { sku: 'BOT-001' }, {
    picks: [
      { code: 'color', attributeId: 'a1', dataType: 'option', value: v('Siyah', 'SIYAH', 'SYH') },
      { code: 'size', attributeId: 'a2', dataType: 'option', value: v('42', '42') },
    ],
  });
  assert.equal(result, 'BOT-001-SYH-42');
});

test('renderSkuTemplate: karşılığı olmayan token olduğu gibi kalır', () => {
  const result = renderSkuTemplate('{sku}-{material}', { sku: 'X-1' }, { picks: [] });
  assert.equal(result, 'X-1-{material}');
});

test('slugifyAttributeCode: Türkçe karakterler transliterasyonla dönüştürülür', () => {
  assert.equal(slugifyAttributeCode('Kaplama'), 'kaplama');
  assert.equal(slugifyAttributeCode('Boy (cm)'), 'boy_cm');
  assert.equal(slugifyAttributeCode('Çelik Kalınlığı'), 'celik_kalinligi');
});
