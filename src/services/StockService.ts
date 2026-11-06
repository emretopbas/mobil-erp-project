// Stok giriş/çıkış (CLAUDE.md §5.1). This is where the negative-stock guard
// lives — the Repository's StockMovement/StockLevel methods are dumb CRUD
// (see repository/types.ts's own note), so `on_hand` is recomputed here and
// the guard runs before any 'out' movement is allowed to write.

import type { StockLevel, StockMovement, StockMovementType, UUID } from '../models';
import { isLowStock } from '../lib/stockMatrix';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';
import { notifyLowStock } from './NotificationService';

export class NegativeStockError extends Error {
  constructor(public readonly onHand: number, public readonly requested: number) {
    super(`Stok yetersiz: mevcut ${onHand}, istenen çıkış ${requested}. Negatif stoka izin verilmiyor.`);
    this.name = 'NegativeStockError';
  }
}

export interface RecordMovementInput {
  variant_id: UUID;
  type: StockMovementType;
  quantity: number; // always a positive count; direction comes from `type`
  reason?: string | null;
  note?: string | null;
  related_order_id?: UUID | null;
  related_purchase_id?: UUID | null;
  /** Overrides the business's `allow_negative_stock` setting for just this
   * call, in either direction — leave unset to use the business default
   * (§5.1: "işletme ayarıyla negatife izin ver açılabilir"). */
  allowNegative?: boolean;
}

export class StockService {
  async recordMovement(ctx: ActorContext, input: RecordMovementInput): Promise<StockMovement> {
    requirePermission(ctx.employee.role, 'stockMovement', 'create');
    if (input.quantity <= 0) throw new Error('quantity must be a positive integer');

    const level = await ctx.repository.stockLevels.get(input.variant_id);
    const currentOnHand = level?.on_hand ?? 0;
    const threshold = level?.low_stock_threshold ?? 0;

    const delta = signedDelta(input.type, input.quantity);
    const nextOnHand = currentOnHand + delta;

    const allowNegative = input.allowNegative ?? ctx.business.allow_negative_stock === 1;
    if (input.type === 'out' && nextOnHand < 0 && !allowNegative) {
      throw new NegativeStockError(currentOnHand, input.quantity);
    }

    const movement = await ctx.repository.stockMovements.create({
      business_id: ctx.employee.business_id,
      variant_id: input.variant_id,
      type: input.type,
      quantity: input.quantity,
      reason: input.reason ?? null,
      note: input.note ?? null,
      related_order_id: input.related_order_id ?? null,
      related_purchase_id: input.related_purchase_id ?? null,
      created_by: ctx.employee.id,
    });

    await ctx.repository.stockLevels.upsert({
      variant_id: input.variant_id,
      on_hand: nextOnHand,
      low_stock_threshold: threshold,
      reorder_quantity: level?.reorder_quantity ?? 0,
    });

    // §5.1: "on_hand <= low_stock_threshold olduğunda FCM bildirimi
    // tetiklenir." Real push delivery needs a backend trigger that doesn't
    // exist yet (see NotificationService.ts's header) — this still fires
    // the hook every time the condition is true, logging the event.
    //
    // `isLowStock()` (lib/stockMatrix.ts, product feedback) requires
    // threshold > 0 — the default is 0, and a brand-new variant with no
    // movements yet (on_hand=0, threshold=0) must never be flagged "low
    // stock" just because 0 <= 0 happens to be true. Only a MANUALLY set
    // threshold (stock screen's "Düşük stok eşiği" field) turns this on;
    // same rule the stock screens use to decide what to show as low.
    if (isLowStock(nextOnHand, threshold)) {
      void notifyLowStock(ctx.employee.business_id, input.variant_id, nextOnHand, threshold);
    }

    return movement;
  }

  async getLevel(ctx: ActorContext, variantId: UUID): Promise<StockLevel | null> {
    requirePermission(ctx.employee.role, 'stockMovement', 'read');
    return ctx.repository.stockLevels.get(variantId);
  }

  async setLowStockThreshold(ctx: ActorContext, variantId: UUID, threshold: number): Promise<void> {
    requirePermission(ctx.employee.role, 'stockMovement', 'update');
    const level = await ctx.repository.stockLevels.get(variantId);
    await ctx.repository.stockLevels.upsert({
      variant_id: variantId,
      on_hand: level?.on_hand ?? 0,
      low_stock_threshold: threshold,
      reorder_quantity: level?.reorder_quantity ?? 0,
    });
  }

  /** How much to reorder once the low-stock threshold is hit — a reorder
   * policy value alongside the threshold (§4 doesn't name a purchasing
   * workflow yet, but the field costs nothing to capture now). */
  async setReorderQuantity(ctx: ActorContext, variantId: UUID, quantity: number): Promise<void> {
    requirePermission(ctx.employee.role, 'stockMovement', 'update');
    const level = await ctx.repository.stockLevels.get(variantId);
    await ctx.repository.stockLevels.upsert({
      variant_id: variantId,
      on_hand: level?.on_hand ?? 0,
      low_stock_threshold: level?.low_stock_threshold ?? 0,
      reorder_quantity: quantity,
    });
  }

  async history(ctx: ActorContext, variantId: UUID): Promise<StockMovement[]> {
    requirePermission(ctx.employee.role, 'stockMovement', 'read');
    return ctx.repository.stockMovements.listByVariant(variantId);
  }

  async businessLedger(ctx: ActorContext): Promise<StockMovement[]> {
    requirePermission(ctx.employee.role, 'stockMovement', 'read');
    return ctx.repository.stockMovements.listByBusiness(ctx.employee.business_id);
  }
}

function signedDelta(type: StockMovementType, quantity: number): number {
  switch (type) {
    case 'in':
      return quantity;
    case 'out':
      return -quantity;
    case 'adjustment':
      // An adjustment's `quantity` is itself signed (a correction can go
      // either way) — everywhere else quantity is a positive magnitude, but
      // adjustment is the one type where the sign carries the direction.
      return quantity;
  }
}

export const stockService = new StockService();
