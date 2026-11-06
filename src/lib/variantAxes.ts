// Eksen tabanlı (attribute-based) varyant sistemi — saf mantık. Hem
// ProductService (kaydetme) hem VariantAxisWizard (önizleme/canlı sayaç) bu
// dosyayı kullanır; DB'ye dokunan hiçbir şey burada yok, tamamen test
// edilebilir saf fonksiyonlar.

import type { AttributeDataType } from '../models';

const TURKISH_TRANSLITERATION: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
  Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u',
};

/** "Boy (cm)" → 'boy_cm', "Kaplama" → 'kaplama'. Used to derive a new custom
 * `Attribute.code` from its user-entered `name` — never re-run on an
 * existing attribute (its `code` is fixed once created, same "SKU renamed
 * doesn't retouch the barcode" precedent as `autoBarcodeFromSku`). */
export function slugifyAttributeCode(name: string): string {
  const transliterated = name.replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => TURKISH_TRANSLITERATION[ch] ?? ch);
  return transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'eksen';
}

/** One axis' pool of chosen values going into the cartesian product — the
 * shape `VariantAxisWizard`'s Adım A hands off to Adım B. `optionId` is set
 * for `data_type: 'option'` values (an existing or about-to-be-created
 * `AttributeOption`); `text`/`number` axes carry their raw value instead. */
export interface AxisValue {
  label: string; // display, e.g. "Kırmızı" or "42"
  canonicalValue: string; // what variant_key embeds, e.g. "KIRMIZI" or "42"
  optionId?: string; // existing AttributeOption id, if already known
  skuToken?: string; // falls back to canonicalValue when absent
}

export interface Axis {
  attributeId: string;
  code: string;
  dataType: AttributeDataType;
  values: AxisValue[];
}

/** One cell of the cartesian product — one value picked per axis. */
export interface Combination {
  /** `code -> AxisValue`, in the same order as the `axes` array that
   * produced it (NOT alphabetical — that ordering only matters for
   * `canonicalVariantKey`'s string, not for iteration/display order).
   * `dataType` rides along from the source `Axis` so a caller (ProductService)
   * can decide `option_id` vs `value_text` vs `value_number` without a
   * second lookup. */
  picks: { code: string; attributeId: string; dataType: AttributeDataType; value: AxisValue }[];
}

const MAX_COMBINATIONS_HARD_CAP = 5000;

/** Kartezyen çarpım. Şartname §3'ün "4+ ekseni engelleme, sadece uyar"
 * kuralı burada uygulanmıyor — bu saf fonksiyon hiçbir şeyi reddetmez,
 * uyarı metnini UI (VariantAxisWizard) canlı sayaç üzerinden gösterir. Tek
 * sert sınır, donmayı önleyen bir üst sınır (bkz. `MAX_COMBINATIONS_HARD_CAP`) —
 * bu da UI'da değil burada, çünkü bir donma riski performans meselesi,
 * görünürlük meselesi değil. */
export function cartesianProduct(axes: Axis[]): Combination[] {
  if (axes.length === 0) return [];
  const total = axes.reduce((n, a) => n * Math.max(a.values.length, 1), 1);
  if (total > MAX_COMBINATIONS_HARD_CAP) {
    throw new Error(`${total} kombinasyon çok fazla (üst sınır ${MAX_COMBINATIONS_HARD_CAP}) — eksen sayısını veya değer sayısını azaltın.`);
  }
  let combos: Combination[] = [{ picks: [] }];
  for (const axis of axes) {
    if (axis.values.length === 0) continue;
    const next: Combination[] = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ picks: [...combo.picks, { code: axis.code, attributeId: axis.attributeId, dataType: axis.dataType, value }] });
      }
    }
    combos = next;
  }
  return combos;
}

/** Kanonik `variant_key`: `code`'a göre alfabetik sıralı `code=value`
 * çiftleri, `|` ile birleşik. Eksensiz kombinasyon → boş string. Migration
 * 12'nin SQL'de yaptığı hesaplamayla AYNI sonucu üretir (bkz. db/schema.ts) —
 * ikisi birbirinden bağımsız yazıldı, davranışları kasıtlı olarak
 * eşleştirildi; biri değişirse diğeri de değişmeli. */
export function canonicalVariantKey(combination: Combination): string {
  return [...combination.picks]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => `${p.code}=${p.value.canonicalValue}`)
    .join('|');
}

/** "36'dan 46'ya, 1 artışla" → 11 değer. `step<=0` veya üretilecek değer
 * sayısı çok büyükse (donma riski) hata fırlatır — UI bunu bir form
 * hatası olarak gösterir. */
export function generateNumericRange(from: number, to: number, step: number): number[] {
  if (step <= 0) throw new Error('Artış miktarı sıfırdan büyük olmalı.');
  if (to < from) throw new Error('Bitiş değeri başlangıçtan küçük olamaz.');
  const count = Math.floor((to - from) / step) + 1;
  if (count > 1000) throw new Error(`${count} değer çok fazla — aralığı veya adımı gözden geçirin.`);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    // Kayan nokta birikim hatasını önlemek için her adımda from'dan yeniden hesapla.
    const v = from + i * step;
    values.push(Math.round(v * 1e6) / 1e6);
  }
  return values;
}

/** Sayısal bir değeri variant_key/canonicalValue için kanonik biçime
 * getirir — sondaki sıfırları/nokta atar (120.0 → "120", 0.5 → "0.5"). */
export function canonicalNumberString(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** Sayısal değerleri (Boy (cm) gibi) sayı olarak, diğerlerini Türkçe
 * alfabetik sıralar — "9" ile "10" karışmasın diye salt string sort değil.
 * Hem stok ekranının matris gruplaması (lib/stockMatrix.ts) hem
 * ProductService.getProductAxes'in önceden-doldurulmuş eksen değerleri aynı
 * sırayı kullanır. */
export function compareAxisValues(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a.trim() !== '' && b.trim() !== '') return na - nb;
  return a.localeCompare(b, 'tr');
}

/** `{sku}-{color}-{size}` → gerçek değerlerle değiştirir. Karşılığı olmayan
 * bir `{token}` olduğu gibi bırakılır (kullanıcı şablonu elden düzenleyip
 * kaydedebilir, sonuçtaki `{...}` görünürlüğü hatayı belli eder). */
export function renderSkuTemplate(template: string, base: { sku: string }, combination: Combination): string {
  let result = template.replace(/\{sku\}/g, base.sku);
  for (const pick of combination.picks) {
    const token = pick.value.skuToken ?? pick.value.canonicalValue;
    result = result.replace(new RegExp(`\\{${pick.code}\\}`, 'g'), token);
  }
  return result;
}
