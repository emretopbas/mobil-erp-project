import type { Product, ProductVariant } from '@/models';
import { productService, type ActorContext, type VariantAxisAssignment } from '@/services';

/** Bir varyantın ürünü + eksen değerleri — sipariş satırlarını "ürün başına
 * sıkıştırılmış matris" olarak göstermek için (OrderLinesSummary). */
export interface IndexedVariant {
  product: Product;
  variant: ProductVariant;
  axes: VariantAxisAssignment[];
}

/** Arşivli/pasif ürün ve varyantlar DAHİL — eski bir siparişin satırı, sonradan
 * pasife alınmış bir varyanta bağlı olabilir. */
export async function loadVariantIndex(ctx: ActorContext): Promise<Map<string, IndexedVariant>> {
  const index = new Map<string, IndexedVariant>();
  const products = await productService.list(ctx, { includeInactive: true });
  for (const product of products) {
    for (const v of await productService.listVariantsWithAttributes(ctx, product.id, { includeInactive: true })) {
      index.set(v.variant.id, { product, variant: v.variant, axes: v.axes });
    }
  }
  return index;
}
