import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeOrderTotals, formatPercentValue, parsePercentInput } from '../orderTotals.ts';
import { toCariAmount } from '../cari.ts';

test('iskontosuz: brüt = net', () => {
  assert.deepEqual(computeOrderTotals(30000), { gross_total_minor: 30000, discount_type: null, discount_value: 0, discount_amount_minor: 0, net_total_minor: 30000 });
});

test('%10 iskonto: brüt, iskonto ve net ayrı ayrı', () => {
  const t = computeOrderTotals(30000, { type: 'percent', value: 1000 });
  assert.deepEqual([t.gross_total_minor, t.discount_type, t.discount_value, t.discount_amount_minor, t.net_total_minor], [30000, 'percent', 1000, 3000, 27000]);
});

test('yüzde iskonto kuruşa yuvarlanır; tutar iskontosu aynen', () => {
  assert.equal(computeOrderTotals(999, { type: 'percent', value: 333 }).discount_amount_minor, 33);
  assert.equal(computeOrderTotals(10000, { type: 'amount', value: 2500 }).net_total_minor, 7500);
});

test('iskonto brüt tutarı ya da %100\'ü aşamaz; sıfır değer iskonto sayılmaz', () => {
  assert.throws(() => computeOrderTotals(1000, { type: 'amount', value: 1001 }));
  assert.throws(() => computeOrderTotals(1000, { type: 'percent', value: 10001 }));
  assert.equal(computeOrderTotals(1000, { type: 'amount', value: 0 }).discount_type, null);
});

test('yüzde giriş/gösterim', () => {
  assert.equal(parsePercentInput('10'), 1000);
  assert.equal(parsePercentInput('%12,5'), 1250);
  assert.equal(parsePercentInput('abc'), null);
  assert.equal(formatPercentValue(1000), '10');
  assert.equal(formatPercentValue(1250), '12,5');
});

test('kur: aynı para biriminde kur yok sayılır, farklıysa zorunlu', () => {
  assert.deepEqual(toCariAmount(500, 'USD', 'USD', 7), { amountInCari: 500, rate: null });
  assert.deepEqual(toCariAmount(100000, 'TRY', 'USD', 0.03), { amountInCari: 3000, rate: 0.03 });
  assert.throws(() => toCariAmount(100, 'TRY', 'USD'), /Kur gerekli/);
});
