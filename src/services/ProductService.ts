// Ürün / varyant (CLAUDE.md §5's implicit product rules + §5.4's matrix row).
// No special business rules beyond the RBAC gate itself — negative-stock
// logic lives in StockService, not here.
//
// Eksen tabanlı (attribute-based) varyant sistemi (product feedback): a
// variant's identity is a `Combination` of arbitrary `Attribute` axes
// (see lib/variantAxes.ts), not hardcoded size/color columns. The methods
// below (previewCombinations/commitVariants/createDefaultVariant/
// archiveOrDeleteVariant/canEditAxes/getProductAxes/listVariantsWithAttributes)
// are the ones that flow: `previewCombinations` and `commitVariants` are the SAME
// code path whether this is the first time variants are generated for a
// product or a later "sonradan değer ekleme" — `previewCombinations` always
// diffs against every already-existing `variant_key` (active or archived),
// so "asla yeniden üretme, sadece eksikleri ekle" falls out of that one
// diff, never a second parallel implementation.

import type { CurrencyCode, MinorUnitAmount, Product, ProductVariant, UUID, VariantAttribute } from '../models';
import type { Axis, AxisValue, Combination } from '../lib/variantAxes';
import { canonicalNumberString, canonicalVariantKey, cartesianProduct, compareAxisValues } from '../lib/variantAxes';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';
import { stockService } from './StockService';

/** One row's worth of Adım C detail for one new combination, keyed by that
 * combination's `variant_key` (`canonicalVariantKey(combo)`) in the `Map`
 * `commitVariants` takes. */
export interface VariantDetails {
  sku: string;
  barcode?: string | null;
  cost_price_minor?: MinorUnitAmount | null;
  price_minor?: MinorUnitAmount | null;
  /** A positive quantity books a real opening 'in' StockMovement via
   * StockService — no separate "opening stock" concept is invented, this
   * reuses the same ledger every other stock change goes through. */
  opening_stock?: number;
  image_uri?: string | null;
}

/** One axis assignment resolved to a display label — the structured form
 * `VariantWithAttributes.axes` carries, used wherever a caller needs to know
 * WHICH attribute a label belongs to (e.g. the stock screen's matrix
 * grouping — `lib/stockMatrix.ts`), not just a flat joined string. */
export interface VariantAxisAssignment {
  attributeId: string;
  attributeName: string;
  valueLabel: string;
}

/** One variant with its axis values already resolved to display labels —
 * what `listVariantsWithAttributes` returns, avoiding an N+1 per-variant
 * query from the UI (products.tsx renders `labels.join(' · ')` where the
 * old flat `[sku,size,color]` used to be; the stock screen's matrix table
 * uses the structured `axes` instead). */
export interface VariantWithAttributes {
  variant: ProductVariant;
  labels: string[];
  axes: VariantAxisAssignment[];
}

/** Bir ürünün eksensiz ("default", `variant_key=''`) varyantı ve ne kadar
 * kullanıldığı. `inUse`: stok hareketi, sipariş satırı ya da satın alma satırı
 * var — bu durumda varyant silinemez, bir kombinasyona dönüştürülmelidir. */
export interface DefaultVariantUsage {
  variant: ProductVariant;
  movementCount: number;
  orderLineCount: number;
  purchaseLineCount: number;
  inUse: boolean;
}

/** `cleanupGhostDefaultVariants` sonucu: hareketsizler silindi, kullanılmış
 * olanlar (stok/sipariş/alım geçmişi) raporlanır. */
export interface GhostCleanupReport {
  removed: { productId: UUID; productName: string; sku: string }[];
  kept: { productId: UUID; productName: string; usage: DefaultVariantUsage }[];
}

export class ProductService {
  async create(
    ctx: ActorContext,
    input: {
      name: string;
      sku: string;
      category?: string | null;
      description?: string | null;
      unit?: string;
      base_price_minor: MinorUnitAmount;
      currency: CurrencyCode;
    },
  ): Promise<Product> {
    requirePermission(ctx.employee.role, 'product', 'create');
    return ctx.repository.products.create({
      business_id: ctx.employee.business_id,
      ...input,
      category: input.category ?? null,
      description: input.description ?? null,
      unit: input.unit ?? 'adet',
    });
  }

  async list(ctx: ActorContext, opts?: { includeInactive?: boolean }): Promise<Product[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    return ctx.repository.products.listByBusiness(ctx.employee.business_id, opts);
  }

  async update(
    ctx: ActorContext,
    id: UUID,
    patch: Partial<Pick<Product, 'name' | 'sku' | 'category' | 'description' | 'unit' | 'base_price_minor' | 'currency' | 'is_purchasable'>>,
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'product', 'update');
    await ctx.repository.products.update(id, patch);
  }

  async softDelete(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'product', 'delete');
    await ctx.repository.products.softDelete(id);
  }

  async listVariants(ctx: ActorContext, productId: UUID, opts?: { includeInactive?: boolean }): Promise<ProductVariant[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    return ctx.repository.productVariants.listByProduct(productId, opts);
  }

  async updateVariant(
    ctx: ActorContext,
    id: UUID,
    patch: Partial<Pick<ProductVariant, 'attributes' | 'sku' | 'barcode' | 'cost_price_minor' | 'price_minor' | 'image_uri'>>,
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'product', 'update');
    await ctx.repository.productVariants.update(id, patch);
  }

  /** Eksensiz ("varyant yok") ürün için tek varyant — `variant_key=''`
   * onun "default" olduğunu belirtir, ayrı bir `is_default` kolonu yok
   * (bkz. ProductVariant.variant_key'in doc yorumu). */
  async createDefaultVariant(ctx: ActorContext, productId: UUID, sku: string): Promise<ProductVariant> {
    requirePermission(ctx.employee.role, 'product', 'create');
    const existing = await ctx.repository.productVariants.listByProduct(productId, { includeInactive: true });
    if (existing.some((v) => v.variant_key !== '')) {
      throw new Error('Bu üründe zaten eksenli varyantlar var — eksensiz (varsayılan) varyant eklenemez.');
    }
    return ctx.repository.productVariants.create({
      product_id: productId,
      business_id: ctx.employee.business_id,
      attributes: '{}',
      sku,
      variant_key: '',
    });
  }

  /** Bir üründe halihazırda `axes`'in kartezyen çarpımından hangi
   * kombinasyonların YENİ (henüz `variant_key`'i yok — is_active durumundan
   * bağımsız, arşivlenmiş bir varyant bile slotunu korur) hangilerinin ZATEN
   * VAR olduğunu döner. VariantAxisWizard'ın Adım B'si bunu hem ilk
   * varyant üretiminde (hepsi "yeni") hem "sonradan değer ekleme" akışında
   * (bazıları "var olan", grid'de kilitli gösterilir) çağırır — aynı
   * fonksiyon, iki senaryo. */
  async previewCombinations(ctx: ActorContext, productId: UUID, axes: Axis[]): Promise<{ new: Combination[]; existing: Combination[] }> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const combos = cartesianProduct(axes);
    const existingVariants = await ctx.repository.productVariants.listByProduct(productId, { includeInactive: true });
    const existingKeys = new Set(existingVariants.map((v) => v.variant_key));
    const fresh: Combination[] = [];
    const already: Combination[] = [];
    for (const combo of combos) {
      (existingKeys.has(canonicalVariantKey(combo)) ? already : fresh).push(combo);
    }
    return { new: fresh, existing: already };
  }

  /** Adım C'nin "Kaydet"i — sadece gerçekten yeni kombinasyonlar için
   * ProductVariant + VariantAttribute satırları yazar (`combinations`,
   * `previewCombinations().new`'dan gelmeli; zaten var olan bir
   * `variant_key`'i tekrar yazmaya çalışmak `UNIQUE(product_id,variant_key)`
   * index'ine çarpar). Var olan hiçbir varyantın SKU/fiyat/stoğu bu metotla
   * DEĞİŞTİRİLEMEZ — sadece INSERT, hiç UPDATE yok (§4: "Var olan
   * varyantların SKU'su, fiyatı, stoğu, barkodu asla dokunulmaz"). */
  async commitVariants(
    ctx: ActorContext,
    productId: UUID,
    combinations: Combination[],
    details: Map<string, VariantDetails>,
    opts?: { convertDefaultToKey?: string },
  ): Promise<ProductVariant[]> {
    requirePermission(ctx.employee.role, 'product', 'create');
    const created: ProductVariant[] = [];

    // Bir ürüne İLK KEZ eksen eklenirken var olan eksensiz default varyant:
    // hareketsizse silinir; stok/sipariş/alım geçmişi varsa seçilen
    // kombinasyona DÖNÜŞTÜRÜLÜR (variant_key güncellenir) — eksenli üründe
    // `variant_key=''` varyantı asla kalmaz.
    let convertedKey: string | null = null;
    if (combinations.length > 0) {
      const usage = await this.defaultVariantUsage(ctx, productId);
      if (usage) {
        if (usage.inUse) {
          const target = combinations.find((c) => canonicalVariantKey(c) === opts?.convertDefaultToKey);
          if (!target) throw new Error('Mevcut varsayılan varyantın stok/sipariş geçmişi var — hangi kombinasyona dönüştürüleceğini seçin.');
          await this.attachCombination(ctx, usage.variant.id, target);
          convertedKey = canonicalVariantKey(target);
        } else {
          await ctx.repository.productVariants.remove(usage.variant.id);
        }
      }
    }

    for (const combo of combinations) {
      const key = canonicalVariantKey(combo);
      if (key === convertedKey) continue;
      const detail = details.get(key);
      if (!detail) throw new Error(`"${key}" kombinasyonu için detay girilmedi.`);
      const variant = await ctx.repository.productVariants.create({
        product_id: productId,
        business_id: ctx.employee.business_id,
        attributes: '{}',
        sku: detail.sku,
        variant_key: key,
        barcode: detail.barcode ?? null,
        cost_price_minor: detail.cost_price_minor ?? null,
        price_minor: detail.price_minor ?? null,
        image_uri: detail.image_uri ?? null,
      });
      for (const pick of combo.picks) {
        await ctx.repository.variantAttributes.create({
          variant_id: variant.id,
          attribute_id: pick.attributeId,
          option_id: pick.dataType === 'option' ? (pick.value.optionId ?? null) : null,
          value_text: pick.dataType === 'text' ? pick.value.canonicalValue : null,
          value_number: pick.dataType === 'number' ? Number(pick.value.canonicalValue) : null,
        });
      }
      if (detail.opening_stock && detail.opening_stock > 0) {
        await stockService.recordMovement(ctx, { variant_id: variant.id, type: 'in', quantity: detail.opening_stock, reason: 'opening_stock' });
      }
      created.push(variant);
    }
    return created;
  }

  /** Varyantı bir kombinasyona bağlar: `variant_key` + her eksen için
   * `variant_attribute`. Default varyant dönüşümünün adımı. */
  private async attachCombination(ctx: ActorContext, variantId: UUID, combo: Combination): Promise<void> {
    const key = canonicalVariantKey(combo);
    const variant = await ctx.repository.productVariants.getById(variantId);
    if (!variant) throw new Error('Varyant bulunamadı.');
    const all = await ctx.repository.productVariants.listByProduct(variant.product_id, { includeInactive: true });
    if (all.some((v) => v.id !== variantId && v.variant_key === key)) throw new Error('Bu kombinasyon zaten var.');
    await ctx.repository.productVariants.update(variantId, { variant_key: key });
    for (const pick of combo.picks) {
      await ctx.repository.variantAttributes.create({
        variant_id: variantId,
        attribute_id: pick.attributeId,
        option_id: pick.dataType === 'option' ? (pick.value.optionId ?? null) : null,
        value_text: pick.dataType === 'text' ? pick.value.canonicalValue : null,
        value_number: pick.dataType === 'number' ? Number(pick.value.canonicalValue) : null,
      });
    }
  }

  private async defaultVariantUsage(ctx: ActorContext, productId: UUID): Promise<DefaultVariantUsage | null> {
    const variants = await ctx.repository.productVariants.listByProduct(productId, { includeInactive: true });
    const variant = variants.find((v) => v.variant_key === '');
    if (!variant) return null;
    const [movements, orderLineCount, purchaseLineCount] = await Promise.all([
      ctx.repository.stockMovements.listByVariant(variant.id),
      ctx.repository.orderLines.countByVariant(variant.id),
      ctx.repository.purchaseLines.countByVariant(variant.id),
    ]);
    const movementCount = movements.length;
    return { variant, movementCount, orderLineCount, purchaseLineCount, inUse: movementCount > 0 || orderLineCount > 0 || purchaseLineCount > 0 };
  }

  /** Ürünün eksensiz default varyantı + kullanım durumu (yoksa null) —
   * VariantAxisWizard, eksen eklerken dönüştürme sorusunu göstermek için. */
  async getDefaultVariantUsage(ctx: ActorContext, productId: UUID): Promise<DefaultVariantUsage | null> {
    requirePermission(ctx.employee.role, 'product', 'read');
    return this.defaultVariantUsage(ctx, productId);
  }

  /** Eksenli varyantları OLAN ama yanında eksensiz default varyantı da
   * bulunan ürünler (hayalet varyant, spec §5) — sadece tarar, dokunmaz. */
  async findGhostDefaultVariants(ctx: ActorContext): Promise<{ productId: UUID; productName: string; usage: DefaultVariantUsage }[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const products = await ctx.repository.products.listByBusiness(ctx.employee.business_id, { includeInactive: true });
    const result: { productId: UUID; productName: string; usage: DefaultVariantUsage }[] = [];
    for (const product of products) {
      const variants = await ctx.repository.productVariants.listByProduct(product.id, { includeInactive: true });
      if (!variants.some((v) => v.variant_key !== '')) continue;
      const usage = await this.defaultVariantUsage(ctx, product.id);
      if (usage) result.push({ productId: product.id, productName: product.name, usage });
    }
    return result;
  }

  /** Tek seferlik düzeltme (spec §5): hayalet default varyantlardan HAREKETSİZ
   * olanları siler, kullanılmış olanları rapor eder (dönüştürme için
   * `convertGhostDefaultVariant`). */
  async cleanupGhostDefaultVariants(ctx: ActorContext): Promise<GhostCleanupReport> {
    requirePermission(ctx.employee.role, 'product', 'delete');
    const report: GhostCleanupReport = { removed: [], kept: [] };
    for (const ghost of await this.findGhostDefaultVariants(ctx)) {
      if (ghost.usage.inUse) {
        report.kept.push(ghost);
      } else {
        await ctx.repository.productVariants.remove(ghost.usage.variant.id);
        report.removed.push({ productId: ghost.productId, productName: ghost.productName, sku: ghost.usage.variant.sku });
      }
    }
    return report;
  }

  /** Kullanılmış bir hayalet default varyantın dönüşebileceği kombinasyonlar:
   * ürünün mevcut eksenlerinin çarpımından henüz varyantı OLMAYANLAR. */
  async ghostConversionCandidates(ctx: ActorContext, productId: UUID): Promise<Combination[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const axes = await this.getProductAxes(ctx, productId);
    if (axes.length === 0) return [];
    return (await this.previewCombinations(ctx, productId, axes)).new;
  }

  /** Hayalet default varyantı seçilen kombinasyona dönüştürür (stok geçmişi
   * korunur, `variant_key` güncellenir). */
  async convertGhostDefaultVariant(ctx: ActorContext, variantId: UUID, combo: Combination): Promise<void> {
    requirePermission(ctx.employee.role, 'product', 'update');
    const variant = await ctx.repository.productVariants.getById(variantId);
    if (!variant || variant.variant_key !== '') throw new Error('Bu varyant eksensiz bir default varyant değil.');
    await this.attachCombination(ctx, variantId, combo);
  }

  /** Her varyantın eksen değerlerini görünen etikete çözer, tek toplu
   * sorguda (`variantAttributes.listByProduct` + `attributes.listByBusiness` +
   * her attribute'un option'ları) — products.tsx'in varyant satırı artık
   * `[sku,size,color]` yerine bunu render ediyor. */
  async listVariantsWithAttributes(ctx: ActorContext, productId: UUID, opts?: { includeInactive?: boolean }): Promise<VariantWithAttributes[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const [variants, variantAttrs, attributes] = await Promise.all([
      ctx.repository.productVariants.listByProduct(productId, opts),
      ctx.repository.variantAttributes.listByProduct(productId),
      ctx.repository.attributes.listByBusiness(ctx.employee.business_id),
    ]);
    const attributeById = new Map(attributes.map((a) => [a.id, a]));
    const optionLabelById = new Map<string, string>();
    for (const a of attributes) {
      for (const o of await ctx.repository.attributeOptions.listByAttribute(a.id)) optionLabelById.set(o.id, o.label);
    }
    const byVariant = new Map<string, VariantAttribute[]>();
    for (const va of variantAttrs) {
      const list = byVariant.get(va.variant_id) ?? [];
      list.push(va);
      byVariant.set(va.variant_id, list);
    }
    return variants.map((variant) => {
      const attrs = byVariant.get(variant.id) ?? [];
      const axes: VariantAxisAssignment[] = [];
      for (const va of attrs) {
        const attribute = attributeById.get(va.attribute_id);
        if (!attribute) continue;
        const valueLabel = va.option_id ? (optionLabelById.get(va.option_id) ?? null) : va.value_text !== null ? va.value_text : va.value_number !== null ? String(va.value_number) : null;
        if (valueLabel !== null) axes.push({ attributeId: va.attribute_id, attributeName: attribute.name, valueLabel });
      }
      return { variant, labels: axes.map((a) => a.valueLabel), axes };
    });
  }

  /** Üründeki HERHANGİ bir varyantta stok hareketi varsa eksen SETİ (hangi
   * attribute'ların kullanıldığı) kilitlenir (§4: "Ürünün herhangi bir
   * varyantında stok hareketi oluştuktan sonra eksen ekleme/çıkarma
   * kilitlenir"). Bu SADECE yeni bir eksen eklemeyi/var olan bir ekseni
   * kaldırmayı engeller — aynı eksene (örn. Renk) yeni bir DEĞER eklemek
   * (örn. Siyah) bundan etkilenmez, `previewCombinations`/`commitVariants`
   * zaten sadece eksik kombinasyonları oluşturur (product feedback:
   * "eksenler bir kere kurulduktan sonra değişmemeli ama aynı eksenlere ...
   * yeni varyantlar ekleyebilmeliyim" — VariantAxisWizard bu bayrağı sadece
   * "+ Eksen ekle"/"Ekseni kaldır" kontrollerini gizlemek için kullanır,
   * "+ Varyant ekle" düğmesinin kendisini asla gizlemez). */
  async canEditAxes(ctx: ActorContext, productId: UUID): Promise<boolean> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const variants = await ctx.repository.productVariants.listByProduct(productId, { includeInactive: true });
    for (const v of variants) {
      const movements = await ctx.repository.stockMovements.listByVariant(v.id);
      if (movements.length > 0) return false;
    }
    return true;
  }

  /** Ürünün halihazırda kullandığı eksenler + o eksenlerde bugüne kadar
   * kullanılmış değerler — VariantAxisWizard'ın Adım A'sını "Renk: Kırmızı,
   * Mavi, Yeşil" gibi önceden doldurmak için, kullanıcı her seferinde aynı
   * eksenleri sıfırdan yeniden kurmak zorunda kalmasın diye (bkz.
   * `canEditAxes`'in doc yorumu). Eksensiz (default, `variant_key===''`)
   * varyantların hiç `variant_attribute` satırı olmadığından bu listeye
   * katkısı olmaz. */
  async getProductAxes(ctx: ActorContext, productId: UUID): Promise<Axis[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const [variantAttrs, attributes] = await Promise.all([
      ctx.repository.variantAttributes.listByProduct(productId),
      ctx.repository.attributes.listByBusiness(ctx.employee.business_id),
    ]);
    const attributeById = new Map(attributes.map((a) => [a.id, a]));
    const optionById = new Map<string, { value: string; label: string; sku_token: string | null }>();
    for (const a of attributes) {
      for (const o of await ctx.repository.attributeOptions.listByAttribute(a.id)) optionById.set(o.id, o);
    }

    const byAttribute = new Map<string, Map<string, AxisValue>>();
    for (const va of variantAttrs) {
      const attribute = attributeById.get(va.attribute_id);
      if (!attribute) continue;
      let value: AxisValue | null = null;
      if (va.option_id) {
        const option = optionById.get(va.option_id);
        if (option) value = { label: option.label, canonicalValue: option.value, optionId: va.option_id, skuToken: option.sku_token ?? undefined };
      } else if (va.value_text !== null) {
        value = { label: va.value_text, canonicalValue: va.value_text };
      } else if (va.value_number !== null) {
        const canonical = canonicalNumberString(va.value_number);
        value = { label: attribute.unit_label ? `${canonical} ${attribute.unit_label}` : canonical, canonicalValue: canonical };
      }
      if (!value) continue;
      let bucket = byAttribute.get(va.attribute_id);
      if (!bucket) {
        bucket = new Map();
        byAttribute.set(va.attribute_id, bucket);
      }
      bucket.set(value.canonicalValue, value);
    }

    const axes: Axis[] = [];
    for (const [attributeId, values] of byAttribute) {
      const attribute = attributeById.get(attributeId);
      if (!attribute) continue;
      axes.push({
        attributeId,
        code: attribute.code,
        dataType: attribute.data_type,
        values: [...values.values()].sort((a, b) => compareAxisValues(a.label, b.label)),
      });
    }
    axes.sort((a, b) => (attributeById.get(a.attributeId)?.name ?? '').localeCompare(attributeById.get(b.attributeId)?.name ?? '', 'tr'));
    return axes;
  }

  /** §4'ün "Değer silme" ayrımı: stok hareketi olan bir varyant asla
   * hard-delete edilmez, sadece arşivlenir (mevcut `deactivate()` — bugünkü
   * "Pasif yap" ile aynı mekanizma); hiç stok hareketi yoksa gerçekten
   * silinir. Hangisinin olduğunu döner ki UI "3 stok hareketi var,
   * arşivlenecek" mesajını gösterebilsin. */
  async archiveOrDeleteVariant(ctx: ActorContext, id: UUID): Promise<{ archived: boolean; movementCount: number }> {
    requirePermission(ctx.employee.role, 'product', 'delete');
    const movements = await ctx.repository.stockMovements.listByVariant(id);
    if (movements.length > 0) {
      await ctx.repository.productVariants.deactivate(id);
      return { archived: true, movementCount: movements.length };
    }
    await ctx.repository.productVariants.remove(id);
    return { archived: false, movementCount: 0 };
  }

  /** Manuel "Pasif yap" — kullanıcının elle "artık bunu taşımıyorum"
   * demesi, `archiveOrDeleteVariant`'ın stok-geçmişi güdümlü arşivleme
   * kararından ayrı, doğrudan çağrılan bir eylem (VariantEditForm'daki
   * "Pasif yap" düğmesi). */
  async deactivateVariant(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'product', 'delete');
    await ctx.repository.productVariants.deactivate(id);
  }
}

export const productService = new ProductService();
