// Eksen (attribute) yönetimi — eksen tabanlı varyant sistemi §2/§3. Yeni bir
// RBAC kaynağı yok: eksen/değer/preset yazma işlemleri mevcut `product`
// kaynağının create/update yetkisinden geçiyor (ürünü nasıl yapılandırdığının
// bir parçası, ayrı bir yetki satırı gerektirmiyor).

import type { Attribute, AttributeDataType, AttributeOption, AxisPreset } from '../models';
import { slugifyAttributeCode } from '../lib/variantAxes';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export interface AttributeWithOptions extends Attribute {
  options: AttributeOption[];
}

export class AttributeService {
  /** Business'ın tüm eksenleri + her birinin değerleri, tek çağrıda —
   * VariantAxisWizard'ın Adım A'sının hem "hazır eksenler" listesi hem
   * "bu eksende hangi değerler var" öneri listesi bunu kullanır (§3'ün
   * "değer önerisi" ayrı bir motor gerektirmiyor: attribute_option zaten
   * business genelinde paylaşılan/tekil). */
  async list(ctx: ActorContext): Promise<AttributeWithOptions[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    const attributes = await ctx.repository.attributes.listByBusiness(ctx.employee.business_id);
    const withOptions = await Promise.all(
      attributes.map(async (a) => ({ ...a, options: await ctx.repository.attributeOptions.listByAttribute(a.id) })),
    );
    return withOptions;
  }

  /** Yeni, kullanıcı tanımlı eksen — code, name'den `slugifyAttributeCode`
   * ile üretilir ve bir daha değişmez (mevcut SKU/barkod ayrımıyla aynı
   * "isim sonradan değişse de makine kodu sabit kalır" ilkesi). */
  async createAttribute(
    ctx: ActorContext,
    input: { name: string; data_type: AttributeDataType; unit_label?: string | null },
  ): Promise<Attribute> {
    requirePermission(ctx.employee.role, 'product', 'create');
    return ctx.repository.attributes.create({
      business_id: ctx.employee.business_id,
      code: slugifyAttributeCode(input.name),
      name: input.name.trim(),
      data_type: input.data_type,
      unit_label: input.unit_label ?? null,
    });
  }

  /** Bir eksene yeni değer ekler — zaten varsa (aynı `value`) mevcut olanı
   * döner, ikinci bir kopya oluşturmaz (`UNIQUE(attribute_id, value)` DB
   * seviyesinde de garanti eder; bu metot önce bakıp gereksiz bir hata
   * fırlatmayı önlüyor). */
  async addOption(
    ctx: ActorContext,
    attributeId: string,
    input: { value: string; label: string; sku_token?: string | null; swatch_hex?: string | null; position?: number },
  ): Promise<AttributeOption> {
    requirePermission(ctx.employee.role, 'product', 'create');
    const existing = await ctx.repository.attributeOptions.getByValue(attributeId, input.value);
    if (existing) return existing;
    return ctx.repository.attributeOptions.create({
      attribute_id: attributeId,
      value: input.value,
      label: input.label,
      sku_token: input.sku_token ?? null,
      swatch_hex: input.swatch_hex ?? null,
      position: input.position ?? 0,
    });
  }

  async savePreset(ctx: ActorContext, input: { name: string; definition: string }): Promise<AxisPreset> {
    requirePermission(ctx.employee.role, 'product', 'create');
    return ctx.repository.axisPresets.create({
      business_id: ctx.employee.business_id,
      name: input.name.trim(),
      definition: input.definition,
    });
  }

  async listPresets(ctx: ActorContext): Promise<AxisPreset[]> {
    requirePermission(ctx.employee.role, 'product', 'read');
    return ctx.repository.axisPresets.listByBusiness(ctx.employee.business_id);
  }

  /** Bir preset uygulandığında çağrılır — sadece use_count/last_used_at'i
   * günceller, VariantAxisWizard'ın Adım A'yı `definition`'dan doldurması
   * bu servisin dışında (saf UI state). */
  async applyPreset(ctx: ActorContext, presetId: string): Promise<void> {
    requirePermission(ctx.employee.role, 'product', 'read');
    await ctx.repository.axisPresets.recordUse(presetId);
  }
}

export const attributeService = new AttributeService();
