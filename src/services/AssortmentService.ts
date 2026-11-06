// Kayıtlı asorti desenleri ("1-2-2-2-1"). `customer_id` doluysa o müşteriye
// özel (bir müşteri hep aynı asortiyi ister), boşsa işletme geneli. RBAC:
// sipariş kaynağına bağlı — desenler sipariş girişinin yardımcı verisi.

import type { AssortmentPattern, UUID } from '../models';
import { formatPattern, parsePattern } from '../lib/quantityGrid';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export class AssortmentService {
  /** Müşteri verilirse önce o müşterinin kendi desenleri, sonra işletme geneli;
   * verilmezse yalnızca işletme geneli. */
  async list(ctx: ActorContext, customerId?: UUID | null): Promise<AssortmentPattern[]> {
    requirePermission(ctx.employee.role, 'order', 'read');
    const all = await ctx.repository.assortmentPatterns.listByBusiness(ctx.employee.business_id);
    const own = customerId ? all.filter((p) => p.customer_id === customerId) : [];
    const shared = all.filter((p) => p.customer_id === null);
    return [...own, ...shared];
  }

  /** Aynı kapsamda (müşteri/genel) aynı desen zaten varsa yenisini açmaz. */
  async save(ctx: ActorContext, input: { pattern: string; name?: string; customer_id?: UUID | null }): Promise<AssortmentPattern> {
    requirePermission(ctx.employee.role, 'order', 'create');
    const nums = parsePattern(input.pattern);
    if (!nums) throw new Error('Asorti deseni geçersiz — örn. 1-2-2-2-1');
    const pattern = formatPattern(nums);
    const customerId = input.customer_id ?? null;
    const all = await ctx.repository.assortmentPatterns.listByBusiness(ctx.employee.business_id);
    const existing = all.find((p) => p.pattern === pattern && p.customer_id === customerId);
    if (existing) return existing;
    return ctx.repository.assortmentPatterns.create({
      business_id: ctx.employee.business_id,
      customer_id: customerId,
      name: input.name?.trim() || pattern,
      pattern,
    });
  }

  async remove(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    await ctx.repository.assortmentPatterns.softDelete(id);
  }
}

export const assortmentService = new AssortmentService();
