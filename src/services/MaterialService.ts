// Malzeme (raw input) kaydı — Satın Almalar v2 (product feedback). Bilerek
// sade: ad, tanım, birim, kategori; eksen/varyant yok (bkz. entities.ts'deki
// `Material` yorumu). Yeni bir RBAC kaynağı yok: malzeme okuma/oluşturma/
// güncelleme mevcut `purchase` kaynağından geçiyor — malzemeler satın alma
// akışının bir parçası, ayrı bir yetki satırı gerektirmiyor (attribute'ların
// `product` kaynağına yaslanmasıyla aynı emsal). Stok miktarı burada
// DEĞİŞTİRİLEMEZ; sadece PurchaseService'in ters-kayıtlı defter akışıyla değişir.

import type { Material, UUID } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export class MaterialService {
  async list(ctx: ActorContext, opts?: { includeArchived?: boolean }): Promise<Material[]> {
    requirePermission(ctx.employee.role, 'purchase', 'read');
    return ctx.repository.materials.listByBusiness(ctx.employee.business_id, opts);
  }

  /** Satın alma ekranındaki "'…' adında yeni malzeme ekle" satır-içi formunun
   * çağırdığı yol — ad ve birim zorunlu, tanım/kategori opsiyonel. */
  async create(
    ctx: ActorContext,
    input: { name: string; unit: string; description?: string | null; category?: string | null },
  ): Promise<Material> {
    requirePermission(ctx.employee.role, 'purchase', 'create');
    const name = input.name.trim();
    const unit = input.unit.trim();
    if (!name) throw new Error('Malzeme adı zorunlu.');
    if (!unit) throw new Error('Birim zorunlu.');
    return ctx.repository.materials.create({
      business_id: ctx.employee.business_id,
      name,
      unit,
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
    });
  }

  async update(
    ctx: ActorContext,
    id: UUID,
    patch: Partial<Pick<Material, 'name' | 'description' | 'unit' | 'category'>>,
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'purchase', 'update');
    if (patch.name !== undefined && !patch.name.trim()) throw new Error('Malzeme adı zorunlu.');
    if (patch.unit !== undefined && !patch.unit.trim()) throw new Error('Birim zorunlu.');
    await ctx.repository.materials.update(id, patch);
  }

  /** Arşivlenen malzeme katalogdan düşer ama geçmiş satın almalarda okunabilir
   * kalır (hard delete yok, CLAUDE.md §8). */
  async archive(ctx: ActorContext, id: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'purchase', 'update');
    await ctx.repository.materials.update(id, { status: 'archived' });
  }
}

export const materialService = new MaterialService();
