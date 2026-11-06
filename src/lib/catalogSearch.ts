// Sipariş kataloğu araması — saf mantık (test: lib/__tests__/catalogSearch.test.ts).
// Sorgu boşlukla kelimelere bölünür; her kelime, ürün adı/SKU/kategorisinden
// VEYA (ürün alanlarında bulunmayan kelimeler) tek bir varyantın SKU'su /
// eksen değerlerinden bir kelimenin başıyla eşleşmelidir. Türkçe harfler
// normalleştirilir ("kirmizi" → "Kırmızı"). Varyant düzeyinde bir kelime
// eşleştiyse o varyant `focusVariantId` olarak döner ("kırmızı 42" → o hücre).

import type { GridVariant } from './quantityGrid';

const TR_MAP: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };

export function normalizeSearch(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[ışğüöçâîû]/g, (c) => TR_MAP[c] ?? c);
}

function wordsOf(text: string): string[] {
  return normalizeSearch(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '');
}

export interface SearchableProduct {
  name: string;
  sku: string;
  category?: string | null;
}

export interface SearchResult {
  matched: boolean;
  focusVariantId: string | null;
}

export function matchProduct(query: string, product: SearchableProduct, variants: GridVariant[]): SearchResult {
  const tokens = wordsOf(query);
  if (tokens.length === 0) return { matched: true, focusVariantId: null };

  const productWords = wordsOf(`${product.name} ${product.sku} ${product.category ?? ''}`);
  const remaining = tokens.filter((t) => !productWords.some((w) => w.startsWith(t)));
  if (remaining.length === 0) return { matched: true, focusVariantId: null };

  const fits = (v: GridVariant) => {
    const words = wordsOf(`${v.sku} ${v.axes.map((a) => a.valueLabel).join(' ')}`);
    return remaining.every((t) => words.some((w) => w.startsWith(t)));
  };
  const hit = variants.find((v) => v.active && fits(v)) ?? variants.find(fits);
  return hit ? { matched: true, focusVariantId: hit.id } : { matched: false, focusVariantId: null };
}
