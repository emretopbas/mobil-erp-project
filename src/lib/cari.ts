// Cari hesap (ön muhasebe) yön kuralı — tek yerde. Kaynak: kullanıcının
// "hangi işlem hangi tarafa yazılır" tablosu:
//
//   Müşteriye vadeli mal sattın            → Müşteri  → Borç
//   Müşteri ödeme yaptı / mal iade etti    → Müşteri  → Alacak
//   Fasoncudan/tedarikçiden mal aldın      → Fasoncu  → Alacak
//   Fasoncuya ödeme yaptın / mal iade ettin→ Fasoncu  → Borç
//
// Yani taraf, KARŞI TARAFIN carisine göre yazılır. Bakiye okunurken:
//   • Borç bakiye (+)   → karşı taraf sana borçlu
//   • Alacak bakiye (−) → sen karşı tarafa borçlusun
//
// Bakiye = Σ Borç − Σ Alacak. Pozitif = Borç bakiye, negatif = Alacak bakiye.
// Ekranlar bu işaretli tam sayıyı (minor unit) `formatCari` ile gösterir.

import type { CariDirection, CariMovement, CariMovementType, CurrencyCode, MinorUnitAmount } from '../models';
import { formatMoney } from './money';

export type CariSide = 'borc' | 'alacak';

export const cariSideLabel: Record<CariSide, string> = { borc: 'Borç', alacak: 'Alacak' };

/** Bir hareketin bakiyeye katkısı: Borç +, Alacak −. */
export function signedCari(side: CariSide, amountMinor: MinorUnitAmount): number {
  return side === 'borc' ? amountMinor : -amountMinor;
}

/** Bakiyenin tarafı; sıfır bakiye ne borç ne alacak → null. */
export function balanceSide(balanceMinor: number): CariSide | null {
  if (balanceMinor > 0) return 'borc';
  if (balanceMinor < 0) return 'alacak';
  return null;
}

/** "+140,00 USD" (Borç) / "−140,00 USD" (Alacak) / "0,00 USD". Her zaman
 * işaretli — kullanıcının istediği "+/−" gösterimi. */
export function formatCari(balanceMinor: MinorUnitAmount, currency: CurrencyCode): string {
  if (balanceMinor === 0) return formatMoney(0, currency);
  const sign = balanceMinor > 0 ? '+' : '−';
  return `${sign}${formatMoney(Math.abs(balanceMinor), currency)}`;
}

/** Bakiye etiketi: "Borç" / "Alacak" / "Kapalı". */
export function balanceLabel(balanceMinor: number): string {
  const side = balanceSide(balanceMinor);
  return side ? cariSideLabel[side] : 'Kapalı';
}

/** Biz karşı tarafa borçluyuz (Alacak bakiye, −). Ekranlar bakiyeyi bu durumda
 * kırmızı, aksi halde normal (siyah) yazar — açıklama cümlesi yok. */
export function weOwe(balanceMinor: number): boolean {
  return balanceMinor < 0;
}

// ─── Cari hareket defteri (cari_movement) yardımcıları ─────────────────

/** Veritabanı yönü ('debit'/'credit') ↔ arayüz yönü ('borc'/'alacak'). */
export function directionToSide(direction: CariDirection): CariSide {
  return direction === 'debit' ? 'borc' : 'alacak';
}

/** Hareketin bakiyeye katkısı (cari para biriminde): borç +, alacak −. */
export function signedMovement(m: Pick<CariMovement, 'side' | 'amount_in_cari_minor'>): number {
  return m.side === 'debit' ? m.amount_in_cari_minor : -m.amount_in_cari_minor;
}

/** Bakiye = Σ borç − Σ alacak — YALNIZCA hareketlerden. */
export function movementsBalance(movements: Pick<CariMovement, 'side' | 'amount_in_cari_minor'>[]): number {
  return movements.reduce((sum, m) => sum + signedMovement(m), 0);
}

/** Defter asla düzenlenmez/silinmez (append-only) — bir tahsilat/ödeme
 * silindiğinde orijinal hareket LİSTEDE KALIR, üstüne bir 'reversal' hareketi
 * eklenir (`reverses_id` ile orijinali işaret eder). Bu yüzden "silinebilir mi"
 * sorusu tek bir hareketin alanlarına bakarak cevaplanamaz — defterin TAMAMI
 * taranıp hangi hareketlerin zaten ters çevrilmiş olduğu bulunmalı. Ekranlar
 * bunu kullanıp zaten silinmiş bir kaydın üstünde ikinci kez "Sil" göstermez
 * (göstermezse ikinci tıklama `FinanceService.voidRevenue/voidExpense`'te
 * "Kayıt bulunamadı" ile patlardı — kayıt gerçekten soft-delete edilmiş olur). */
export function alreadyVoidedMovementIds(entries: Pick<CariMovement, 'id' | 'reverses_id'>[]): Set<string> {
  const ids = new Set<string>();
  for (const m of entries) if (m.reverses_id) ids.add(m.reverses_id);
  return ids;
}

export const cariMovementTypeLabel: Record<CariMovementType, string> = {
  shipment: 'Sevkiyat',
  collection: 'Tahsilat',
  payment: 'Ödeme',
  purchase: 'Satın alma',
  return_in: 'Müşteri iadesi',
  return_out: 'Tedarikçiye iade',
  discount_close: 'Bakiye kapatma',
  opening: 'Açılış bakiyesi',
  check_bounce: 'Karşılıksız çek',
  reversal: 'Düzeltme',
};

/** İşlem tutarını carinin para birimine çevirir. Para birimleri aynıysa kur
 * yok sayılır; farklıysa pozitif kur ZORUNLUDUR (1 işlem birimi = `rate` cari birimi). */
export function toCariAmount(amountMinor: number, currency: string, cariCurrency: string, rate?: number | null): { amountInCari: number; rate: number | null } {
  if (currency === cariCurrency) return { amountInCari: amountMinor, rate: null };
  if (!rate || !Number.isFinite(rate) || rate <= 0) throw new Error(`Kur gerekli: ${currency} → ${cariCurrency}.`);
  const amountInCari = Math.round(amountMinor * rate);
  if (amountInCari <= 0) throw new Error('Çevrilen tutar sıfır olamaz.');
  return { amountInCari, rate };
}

/** İade girilirken açık bakiye bilgisi (engellemez, hesabı değiştirmez): müşterinin
 * borç bakiyesi varsa iadenin ne kadarının onu kapatacağını ve kalanı söyler. */
export function returnBalanceNotice(balanceMinor: number, returnMinor: number): { closesMinor: number; refundMinor: number } | null {
  if (balanceMinor <= 0 || returnMinor <= 0) return null;
  const closesMinor = Math.min(balanceMinor, returnMinor);
  return { closesMinor, refundMinor: returnMinor - closesMinor };
}
