// Ondalıklı miktar/fiyat girişi için küçük saf yardımcılar — Satın Almalar'da
// malzeme miktarı ondalıklı (2,5 m²) ve Türkçe klavye ondalık ayırıcı olarak
// virgül verir. Para değeri gösterimi yine `formatMoney` (lib/money.ts)'den
// geçer; burası sadece kullanıcı girdisini sayıya çevirir.

/** "2,5" / "2.5" / " 2 " → 2.5 / 2.5 / 2; boş ya da geçersiz → 0. */
export function parseDecimal(text: string): number {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Kullanıcının girdiği birim fiyatı (ana birim, örn. "12,50") → minor unit
 * (1250). Boş/geçersiz → 0 (fiyat opsiyonel). */
export function parseMinorAmount(text: string): number {
  return Math.round(parseDecimal(text) * 100);
}

/** Minor unit → düzenlenebilir metin ("1250" → "12.5"); 0 → "" (alan boş
 * görünsün, fiyat girilmemiş sayılsın). */
export function minorToInputText(minor: number): string {
  return minor > 0 ? String(minor / 100) : '';
}

/** 2.5 → "2,5", 10 → "10" — üç ondalığa kadar, gereksiz sıfırsız. */
export function formatQuantity(n: number): string {
  return n.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
}
