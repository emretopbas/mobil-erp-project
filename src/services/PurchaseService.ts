// Satın alma (purchasing) — the buying-side mirror of OrderService.ts: a
// small producer/B2B team buying materials AND trade goods FROM a supplier
// (an `Account`, never a `Customer`) instead of selling TO a customer.
//
// Satın Almalar v2 (product feedback) rules encoded here:
//  - A purchase is saved as a whole (`save`): header + lines, then stock is
//    reconciled. "Teslim alındı" (`is_received`) decides whether stock moves.
//  - Stock is NEVER overwritten. `reconcileStock` diffs what the purchase
//    SHOULD have booked (its lines, if received) against what it HAS booked
//    (the `related_purchase_id`-tagged ledger rows) and writes only the
//    difference — a positive diff is a giriş, a negative one a ters kayıt.
//    That single mechanism covers first receipt, un-receiving, editing a
//    received purchase, and deleting one; there is no second code path.
//  - Only QUANTITY reaches stock. `unit_cost_minor`/`line_total_minor` live
//    on the purchase line and touch no stock, average-cost or
//    `variant.cost_price_minor` field (spec §1 "Fiyat stoğa yansımaz").
//  - Money/status decoupling as before: `recordPayment()` never touches
//    receipt state, and receiving never books money.

import type { Check, ExpenseEntry, Material, PaymentMethod, Purchase, PurchaseLine, PurchaseLineType, UUID } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';
import { cariService } from './CariService';
import { financeService } from './FinanceService';
import { stockService } from './StockService';

interface PurchaseCheckDetails {
  due_date: string;
  issue_date?: string;
  check_number?: string | null;
  bank_name?: string | null;
}

/** One payment recorded against a purchase — mirrors OrderService's
 * `OrderPayment`, just on the expense side. */
export interface PurchasePayment {
  entry: ExpenseEntry;
  check: Check | null;
}

export interface PurchaseBalance {
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  currency: string;
}

/** One line as the editor hands it to `save` — `unit` is resolved by the
 * service from the material/product itself, never trusted from the UI. */
export interface PurchaseLineInput {
  line_type: PurchaseLineType;
  /** Set iff `line_type === 'material'`. */
  material_id?: UUID | null;
  /** Set iff `line_type === 'product'`. */
  variant_id?: UUID | null;
  quantity: number;
  /** Optional in the UI (blank = 0) — stored for the record only. */
  unit_cost_minor: number;
  /** Groups the lines of one product's matrix (value: product id). */
  line_group_id?: UUID | null;
  note?: string | null;
}

export interface SavePurchaseInput {
  /** Omit to create; set to edit (a received purchase's stock is corrected
   * through reverse/diff movements, never overwritten). */
  id?: UUID;
  account_id: UUID;
  /** ISO date string. */
  purchase_date: string;
  is_received: boolean;
  note?: string | null;
  lines: PurchaseLineInput[];
}

const EPS = 1e-9;
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export class PurchaseService {
  async list(ctx: ActorContext): Promise<Purchase[]> {
    requirePermission(ctx.employee.role, 'purchase', 'read');
    return ctx.repository.purchases.listByBusiness(ctx.employee.business_id);
  }

  async lines(ctx: ActorContext, purchaseId: UUID): Promise<PurchaseLine[]> {
    requirePermission(ctx.employee.role, 'purchase', 'read');
    return ctx.repository.purchaseLines.listByPurchase(purchaseId);
  }

  /** Creates or edits a purchase in one call, then reconciles stock and the
   * supplier's cari (teslim alınmış alım → hesap ALACAK), all in one
   * transaction. See the file header for the stock rules. */
  async save(ctx: ActorContext, input: SavePurchaseInput): Promise<Purchase> {
    return ctx.repository.transaction(() => this.saveTx(ctx, input));
  }

  private async saveTx(ctx: ActorContext, input: SavePurchaseInput): Promise<Purchase> {
    requirePermission(ctx.employee.role, 'purchase', input.id ? 'update' : 'create');
    if (input.lines.length === 0) throw new Error('En az bir kalem ekleyin.');

    let existing: Purchase | null = null;
    if (input.id) {
      existing = await ctx.repository.purchases.getById(input.id);
      if (!existing || existing.deleted_at) throw new Error('Purchase not found');
    }
    // Fail BEFORE any write if this save would touch stock but the actor may
    // not — otherwise lines would already be replaced when the permission
    // check fires halfway through.
    if (input.is_received || existing?.is_received === 1) requirePermission(ctx.employee.role, 'stockMovement', 'create');

    const prepared = await this.prepareLines(ctx, input.lines);

    let purchase: Purchase;
    if (existing) {
      await ctx.repository.purchases.update(existing.id, {
        account_id: input.account_id,
        purchase_date: input.purchase_date,
        note: input.note ?? null,
      });
      purchase = existing;
    } else {
      purchase = await ctx.repository.purchases.create({
        business_id: ctx.employee.business_id,
        account_id: input.account_id,
        currency: ctx.business.base_currency,
        purchase_date: input.purchase_date,
        note: input.note ?? null,
        created_by: ctx.employee.id,
      });
    }

    await ctx.repository.purchaseLines.removeByPurchase(purchase.id);
    for (const line of prepared) {
      await ctx.repository.purchaseLines.create({ purchase_id: purchase.id, ...line });
    }

    await this.applyReceivedState(ctx, purchase.id, input.is_received);
    await cariService.syncPurchaseReceipt(ctx, purchase.id);
    const saved = await ctx.repository.purchases.getById(purchase.id);
    if (!saved) throw new Error('Purchase not found');
    return saved;
  }

  /** "Teslim alındı" toggle on an existing purchase (the list's action on a
   * bekleyen satın alma, or un-receiving a mistaken one). */
  async setReceived(ctx: ActorContext, purchaseId: UUID, received: boolean): Promise<void> {
    requirePermission(ctx.employee.role, 'purchase', 'update');
    requirePermission(ctx.employee.role, 'stockMovement', 'create');
    const purchase = await ctx.repository.purchases.getById(purchaseId);
    if (!purchase || purchase.deleted_at) throw new Error('Purchase not found');
    await ctx.repository.transaction(async () => {
      await this.applyReceivedState(ctx, purchaseId, received);
      await cariService.syncPurchaseReceipt(ctx, purchaseId);
    });
  }

  /** Deleting a received purchase writes reverse movements first (stock goes
   * back to what it was), then soft-deletes — never a silent stock rewrite. */
  async softDelete(ctx: ActorContext, purchaseId: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'purchase', 'delete');
    const purchase = await ctx.repository.purchases.getById(purchaseId);
    if (!purchase || purchase.deleted_at) return;
    if (purchase.is_received === 1) requirePermission(ctx.employee.role, 'stockMovement', 'create');
    await ctx.repository.transaction(async () => {
      if (purchase.is_received === 1) await this.reconcileStock(ctx, purchase, false);
      await ctx.repository.purchases.softDelete(purchaseId);
      // Alacak ters hareketle kapanır (eski hareket silinmez/düzenlenmez).
      await cariService.syncPurchaseReceipt(ctx, purchaseId);
    });
  }

  /** Records a payment against a purchase — the "ödeme ekle" action, mirrors
   * the unified cash entry: `related_purchase_id` is only a reference (it
   * feeds this purchase's own Toplam/Ödenen line below); the payment lands on
   * the supplier's cari as a Borç movement through FinanceService, same record
   * type as a payment entered from the Money or Hesaplar screens. */
  async recordPayment(
    ctx: ActorContext,
    purchaseId: UUID,
    input: { amount_minor: number; payment_method: PaymentMethod; date?: string; note?: string | null; check?: PurchaseCheckDetails },
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'purchase', 'update');
    requirePermission(ctx.employee.role, 'finance', 'create');
    if (input.amount_minor <= 0) throw new Error('Ödeme tutarı sıfırdan büyük olmalı.');
    const purchase = await ctx.repository.purchases.getById(purchaseId);
    if (!purchase) throw new Error('Purchase not found');
    if (input.payment_method === 'check' && !input.check) {
      throw new Error('recordPayment() with payment_method="check" requires check details (at least due_date) — §5.6.');
    }
    await financeService.createExpense(ctx, {
      category: 'raw_material',
      amount_minor: input.amount_minor,
      currency: purchase.currency,
      date: input.date ?? new Date().toISOString(),
      payment_method: input.payment_method,
      note: input.note ?? null,
      related_purchase_id: purchaseId,
      check: input.payment_method === 'check' ? { direction: 'issued', ...input.check! } : undefined,
    });
  }

  async payments(ctx: ActorContext, purchaseId: UUID): Promise<PurchasePayment[]> {
    requirePermission(ctx.employee.role, 'purchase', 'read');
    const expenses = await ctx.repository.expenses.listByPurchase(purchaseId);
    const result: PurchasePayment[] = [];
    for (const entry of expenses) {
      const check = entry.payment_method === 'check' ? await ctx.repository.checks.getByRelatedEntry(entry.id, 'ExpenseEntry') : null;
      result.push({ entry, check });
    }
    return result;
  }

  async balance(ctx: ActorContext, purchaseId: UUID): Promise<PurchaseBalance> {
    requirePermission(ctx.employee.role, 'purchase', 'read');
    const purchase = await ctx.repository.purchases.getById(purchaseId);
    if (!purchase) throw new Error('Purchase not found');
    const [lines, expenses] = await Promise.all([
      ctx.repository.purchaseLines.listByPurchase(purchaseId),
      ctx.repository.expenses.listByPurchase(purchaseId),
    ]);
    const totalMinor = lines.reduce((sum, l) => sum + l.line_total_minor, 0);
    const paidMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);
    return { totalMinor, paidMinor, balanceMinor: totalMinor - paidMinor, currency: purchase.currency };
  }

  // ─── internals ────────────────────────────────────────────────────────

  /** Validates every line and resolves its unit snapshot + stored total. */
  private async prepareLines(ctx: ActorContext, inputs: PurchaseLineInput[]): Promise<Omit<PurchaseLine, 'id' | 'purchase_id'>[]> {
    const materialCache = new Map<UUID, Material>();
    const out: Omit<PurchaseLine, 'id' | 'purchase_id'>[] = [];
    for (const l of inputs) {
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new Error('Miktar sıfırdan büyük olmalı.');
      if (!Number.isFinite(l.unit_cost_minor) || l.unit_cost_minor < 0) throw new Error('Birim fiyat negatif olamaz.');
      const unitCost = Math.round(l.unit_cost_minor);
      const quantity = round6(l.quantity);
      let unit: string;
      if (l.line_type === 'material') {
        if (!l.material_id || l.variant_id) throw new Error('Malzeme satırı yalnızca material_id taşımalı.');
        let material = materialCache.get(l.material_id);
        if (!material) {
          material = (await ctx.repository.materials.getById(l.material_id)) ?? undefined;
          if (!material || material.business_id !== ctx.employee.business_id) throw new Error('Malzeme bulunamadı.');
          materialCache.set(l.material_id, material);
        }
        unit = material.unit;
      } else {
        if (!l.variant_id || l.material_id) throw new Error('Ürün satırı yalnızca variant_id taşımalı.');
        if (!Number.isInteger(quantity)) throw new Error('Ürün miktarı tam sayı olmalı.');
        const variant = await ctx.repository.productVariants.getById(l.variant_id);
        if (!variant || variant.business_id !== ctx.employee.business_id) throw new Error('Varyant bulunamadı.');
        const product = await ctx.repository.products.getById(variant.product_id);
        unit = product?.unit ?? 'adet';
      }
      out.push({
        line_type: l.line_type,
        material_id: l.line_type === 'material' ? (l.material_id ?? null) : null,
        variant_id: l.line_type === 'product' ? (l.variant_id ?? null) : null,
        quantity,
        unit,
        unit_cost_minor: unitCost,
        line_total_minor: Math.round(quantity * unitCost),
        line_group_id: l.line_group_id ?? null,
        note: l.note ?? null,
      });
    }
    return out;
  }

  /** Flips the receipt flag (+ received_at + the legacy `status` mirror) and
   * reconciles stock. Idempotent: calling it with the current state writes
   * nothing new because the diff is zero. */
  private async applyReceivedState(ctx: ActorContext, purchaseId: UUID, received: boolean): Promise<void> {
    const purchase = await ctx.repository.purchases.getById(purchaseId);
    if (!purchase) throw new Error('Purchase not found');
    const nextReceivedAt = received ? (purchase.is_received === 1 ? purchase.received_at : new Date().toISOString()) : null;
    await ctx.repository.purchases.update(purchaseId, {
      is_received: received ? 1 : 0,
      received_at: nextReceivedAt,
      status: received ? 'received' : 'draft',
    });
    await this.reconcileStock(ctx, purchase, received);
  }

  /** The one stock rule: write `desired − booked` per target, never an
   * absolute value. `desiredReceived=false` ⇒ desired is empty ⇒ everything
   * this purchase ever booked is reversed. */
  private async reconcileStock(ctx: ActorContext, purchase: Purchase, desiredReceived: boolean): Promise<void> {
    const lines = desiredReceived ? await ctx.repository.purchaseLines.listByPurchase(purchase.id) : [];
    const desiredVariants = new Map<UUID, number>();
    const desiredMaterials = new Map<UUID, number>();
    for (const l of lines) {
      if (l.line_type === 'material' && l.material_id) desiredMaterials.set(l.material_id, round6((desiredMaterials.get(l.material_id) ?? 0) + l.quantity));
      if (l.line_type === 'product' && l.variant_id) desiredVariants.set(l.variant_id, round6((desiredVariants.get(l.variant_id) ?? 0) + l.quantity));
    }

    const [stockMoves, materialMoves] = await Promise.all([
      ctx.repository.stockMovements.listByPurchase(purchase.id),
      ctx.repository.materialMovements.listByPurchase(purchase.id),
    ]);
    const bookedVariants = new Map<UUID, number>();
    for (const m of stockMoves) {
      const signed = m.type === 'out' ? -m.quantity : m.quantity; // in / adjustment carry their own sign
      bookedVariants.set(m.variant_id, round6((bookedVariants.get(m.variant_id) ?? 0) + signed));
    }
    const bookedMaterials = new Map<UUID, number>();
    for (const m of materialMoves) {
      bookedMaterials.set(m.material_id, round6((bookedMaterials.get(m.material_id) ?? 0) + m.quantity));
    }

    for (const variantId of new Set([...desiredVariants.keys(), ...bookedVariants.keys()])) {
      const desired = desiredVariants.get(variantId) ?? 0;
      const booked = bookedVariants.get(variantId) ?? 0;
      const diff = round6(desired - booked);
      if (Math.abs(diff) < EPS) continue;
      await stockService.recordMovement(ctx, {
        variant_id: variantId,
        type: diff > 0 ? 'in' : 'out',
        quantity: Math.abs(diff),
        reason: reasonFor(desired, booked),
        related_purchase_id: purchase.id,
        // A correction must always go through — reversing a receipt whose
        // goods were already sold on may legitimately push on_hand below
        // zero; blocking it would make an erroneous purchase undeletable.
        allowNegative: true,
      });
    }

    for (const materialId of new Set([...desiredMaterials.keys(), ...bookedMaterials.keys()])) {
      const desired = desiredMaterials.get(materialId) ?? 0;
      const booked = bookedMaterials.get(materialId) ?? 0;
      const diff = round6(desired - booked);
      if (Math.abs(diff) < EPS) continue;
      await ctx.repository.materialMovements.create({
        business_id: ctx.employee.business_id,
        material_id: materialId,
        quantity: diff,
        reason: reasonFor(desired, booked),
        related_purchase_id: purchase.id,
        created_by: ctx.employee.id,
      });
      await ctx.repository.materials.applyStockDelta(materialId, diff);
    }
  }
}

function reasonFor(desired: number, booked: number): string {
  if (booked === 0) return 'purchase_received';
  if (desired === 0) return 'purchase_reversed';
  return 'purchase_adjusted';
}

export const purchaseService = new PurchaseService();
