// Sipariş toplamı: brüt → iskonto → net (saf mantık, test: orderTotals.test.ts).
// Sevkiyatta cariye NET tutar borç yazılır; brüt/iskonto ayrı saklanır ki
// ileride "verilen toplam iskonto" raporu yapılabilsin.

import type { MinorUnitAmount, OrderDiscountType } from '../models';

/** `value`: tutarda minor unit, yüzdede yüzde × 100 (1000 = %10,00). */
export interface OrderDiscountInput {
  type: OrderDiscountType;
  value: number;
}

export interface OrderTotals {
  gross_total_minor: MinorUnitAmount;
  discount_type: OrderDiscountType | null;
  discount_value: number;
  discount_amount_minor: MinorUnitAmount;
  net_total_minor: MinorUnitAmount;
}

export function computeOrderTotals(grossMinor: MinorUnitAmount, discount?: OrderDiscountInput | null): OrderTotals {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) throw new Error('Brüt tutar geçersiz.');
  if (!discount || discount.value === 0) {
    return { gross_total_minor: grossMinor, discount_type: null, discount_value: 0, discount_amount_minor: 0, net_total_minor: grossMinor };
  }
  if (!Number.isInteger(discount.value) || discount.value < 0) throw new Error('İskonto geçersiz.');
  let amount: number;
  if (discount.type === 'percent') {
    if (discount.value > 10000) throw new Error('İskonto yüzdesi %100\'ü aşamaz.');
    amount = Math.round((grossMinor * discount.value) / 10000);
  } else {
    amount = discount.value;
  }
  if (amount > grossMinor) throw new Error('İskonto brüt tutarı aşamaz.');
  return {
    gross_total_minor: grossMinor,
    discount_type: discount.type,
    discount_value: discount.value,
    discount_amount_minor: amount,
    net_total_minor: grossMinor - amount,
  };
}

/** Form metninden ("10", "10,5", "%10") yüzde değeri (×100). */
export function parsePercentInput(text: string): number | null {
  const n = Number(text.replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Yüzde × 100 → "10" / "10,5" gösterimi. */
export function formatPercentValue(value: number): string {
  const n = value / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',').replace(/0+$/, '');
}
