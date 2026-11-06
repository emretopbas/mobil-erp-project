// Central money formatter (CLAUDE.md §8: "Bir merkezi formatMoney(amountMinor,
// currency) yardımcısı kullan; UI hiçbir yerde ham tam sayıyı göstermez.").
// Every amount is stored as an integer minor unit (kuruş/cent) — this is the
// ONLY place that divides by 100 and applies locale formatting. No screen
// should do `amount / 100` itself.

import type { CurrencyCode, MinorUnitAmount } from '../models';

export function formatMoney(amountMinor: MinorUnitAmount, currency: CurrencyCode): string {
  const major = amountMinor / 100;
  const formatted = major.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'TRY' ? `${formatted} ₺` : `${formatted} ${currency}`;
}
