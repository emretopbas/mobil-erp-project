// Ondalıklı miktar/fiyat girişi yardımcıları (lib/quantity.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatQuantity, minorToInputText, parseDecimal, parseMinorAmount } from '../quantity.ts';

test('parseDecimal: virgül ve nokta ondalık ayırıcıyı kabul eder, geçersiz/boş → 0', () => {
  assert.equal(parseDecimal('2,5'), 2.5);
  assert.equal(parseDecimal('2.5'), 2.5);
  assert.equal(parseDecimal('  10 '), 10);
  assert.equal(parseDecimal(''), 0);
  assert.equal(parseDecimal('abc'), 0);
});

test('parseMinorAmount: ana birim metni → minor unit (kayan nokta kayması yok)', () => {
  assert.equal(parseMinorAmount('12,50'), 1250);
  assert.equal(parseMinorAmount('0.1'), 10);
  assert.equal(parseMinorAmount('19.99'), 1999);
  assert.equal(parseMinorAmount(''), 0);
});

test('minorToInputText: 0 boş görünür, diğerleri ana birim', () => {
  assert.equal(minorToInputText(0), '');
  assert.equal(minorToInputText(1250), '12.5');
});

test('formatQuantity: 3 ondalığa kadar, gereksiz sıfırsız', () => {
  assert.equal(formatQuantity(10), '10');
  assert.equal(formatQuantity(2.5), '2,5');
  assert.equal(formatQuantity(0.75), '0,75');
});
