import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupForStockMatrix, isLowStock, type StockVariantRow } from '../stockMatrix.ts';
import type { ProductVariant } from '../../models/entities.ts';

function variant(id: string, variant_key: string): ProductVariant {
  return {
    id,
    product_id: 'p1',
    business_id: 'b1',
    sku: id,
    barcode: null,
    attributes: '{}',
    variant_key,
    cost_price_minor: null,
    price_minor: null,
    image_uri: null,
    is_active: 1,
  };
}

function row(id: string, variant_key: string, axes: StockVariantRow['axes']): StockVariantRow {
  return { variant: variant(id, variant_key), axes, level: null };
}

test('groupForStockMatrix: 2 eksenli varyantlar (renk×beden) matris olur', () => {
  const rows: StockVariantRow[] = [
    row('v1', 'color=KIRMIZI|size=42', [
      { attributeId: 'a-color', attributeName: 'Renk', valueLabel: 'Kırmızı' },
      { attributeId: 'a-size', attributeName: 'Beden', valueLabel: '42' },
    ]),
    row('v2', 'color=KIRMIZI|size=43', [
      { attributeId: 'a-color', attributeName: 'Renk', valueLabel: 'Kırmızı' },
      { attributeId: 'a-size', attributeName: 'Beden', valueLabel: '43' },
    ]),
    row('v3', 'color=MAVI|size=42', [
      { attributeId: 'a-color', attributeName: 'Renk', valueLabel: 'Mavi' },
      { attributeId: 'a-size', attributeName: 'Beden', valueLabel: '42' },
    ]),
  ];
  const { matrix, rest } = groupForStockMatrix(rows);
  assert.ok(matrix);
  assert.equal(rest.length, 0);
  // 'Beden' < 'Renk' alfabetik olarak, satır ekseni Beden olmalı.
  assert.equal(matrix!.rowAttributeName, 'Beden');
  assert.equal(matrix!.colAttributeName, 'Renk');
  assert.deepEqual(matrix!.rowValues, ['42', '43']);
  assert.deepEqual(matrix!.colValues, ['Kırmızı', 'Mavi']);
  assert.equal(matrix!.cellFor('42', 'Kırmızı')?.variant.id, 'v1');
  assert.equal(matrix!.cellFor('43', 'Kırmızı')?.variant.id, 'v2');
  assert.equal(matrix!.cellFor('42', 'Mavi')?.variant.id, 'v3');
  assert.equal(matrix!.cellFor('43', 'Mavi'), undefined);
});

test('groupForStockMatrix: default (0 eksen) varyant matrise girmez, rest içinde kalır', () => {
  const rows: StockVariantRow[] = [
    row('default', '', []),
    row('v1', 'color=KIRMIZI|size=42', [
      { attributeId: 'a-color', attributeName: 'Renk', valueLabel: 'Kırmızı' },
      { attributeId: 'a-size', attributeName: 'Beden', valueLabel: '42' },
    ]),
  ];
  const { matrix, rest } = groupForStockMatrix(rows);
  assert.ok(matrix);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].variant.id, 'default');
});

test('groupForStockMatrix: tek eksenli ürün → matris yok, hepsi rest', () => {
  const rows: StockVariantRow[] = [
    row('v1', 'material=STEEL', [{ attributeId: 'a-mat', attributeName: 'Materyal', valueLabel: 'Çelik' }]),
    row('v2', 'material=ALU', [{ attributeId: 'a-mat', attributeName: 'Materyal', valueLabel: 'Alüminyum' }]),
  ];
  const { matrix, rest } = groupForStockMatrix(rows);
  assert.equal(matrix, null);
  assert.equal(rest.length, 2);
});

test('groupForStockMatrix: sayısal eksen değerleri string değil sayı olarak sıralanır (9 < 10)', () => {
  const rows: StockVariantRow[] = [
    row('v1', 'length_cm=10|material=STEEL', [
      { attributeId: 'a-len', attributeName: 'Boy (cm)', valueLabel: '10' },
      { attributeId: 'a-mat', attributeName: 'Materyal', valueLabel: 'Çelik' },
    ]),
    row('v2', 'length_cm=9|material=STEEL', [
      { attributeId: 'a-len', attributeName: 'Boy (cm)', valueLabel: '9' },
      { attributeId: 'a-mat', attributeName: 'Materyal', valueLabel: 'Çelik' },
    ]),
  ];
  const { matrix } = groupForStockMatrix(rows);
  assert.ok(matrix);
  // 'Boy (cm)' < 'Materyal' alfabetik olduğundan satır ekseni Boy (cm).
  assert.deepEqual(matrix!.rowValues, ['9', '10']);
});

test('isLowStock: eşik 0 iken (manuel ayarlanmamış) hiçbir zaman düşük stok değil', () => {
  assert.equal(isLowStock(0, 0), false);
  assert.equal(isLowStock(5, 0), false);
});

test('isLowStock: eşik manuel >0 ayarlanınca onHand<=threshold doğru çalışır', () => {
  assert.equal(isLowStock(3, 5), true);
  assert.equal(isLowStock(5, 5), true);
  assert.equal(isLowStock(6, 5), false);
});
