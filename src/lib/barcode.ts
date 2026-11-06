// Auto-assigned barkod format (product feedback): a variant's own SKU, used
// as-is — not a fabricated EAN/GS1-style number. This app has no real GS1
// company prefix, and a made-up "869…" code would *look* like an officially
// registered retail barcode without being one — misleading at best, a real
// collision risk against an actually-registered product at worst. The SKU
// already carries this business's own guaranteed-unique numbering
// (idx_variant_business_sku in schema.ts) and reads meaningfully off a
// printed label or a scanned karekod, so it needs no transformation.
//
// Deliberately NOT kept in sync with a later SKU rename (discussed with the
// user): a barcode already printed on a physical label must stay valid even
// after the SKU changes in the system. Call this again explicitly — the
// "SKU'dan ata" button next to every barkod field — to resync by hand.
export function autoBarcodeFromSku(sku: string): string {
  return sku.trim();
}
