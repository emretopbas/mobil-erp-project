// Sipariş (manuel) — CLAUDE.md §4/§5.5. Faz 1 only ever produces
// `source: 'manual'` orders (see OrderIngestionService's stub for the Faz 2
// seam).
//
// Para ve sipariş durumu bilerek ayrı: hiçbir durum geçişi kendiliğinden
// gelir kaydı yazmaz. MÜŞTERİ BAKİYESİ ise artık siparişlerden hesaplanmaz —
// tek kaynak `cari_movement` defteridir (bkz. CariService.ts):
//   • borç, sipariş oluşturulunca DEĞİL sevkiyatta (`shipped`) doğar ve NET
//     tutarı (brüt − iskonto) yazar; sevk edilmemiş / iptal edilmiş sipariş
//     bakiyeye hiç girmez,
//   • sevk edilmiş sipariş iptal edilir ya da sevkiyattan geri alınırsa eski
//     hareket düzenlenmez, ters hareket eklenir (`syncOrderShipment`),
//   • tahsilat siparişlere dağıtılmaz; müşteri carisinden doğrudan düşer
//     (FinanceService.createRevenue, üç ekrandan da aynı kayıt tipi).

import type { Order, OrderLine, OrderLineGroup, UUID } from '../models';
import { computeOrderTotals, type OrderDiscountInput } from '../lib/orderTotals';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';
import { cariService } from './CariService';
import { stockService } from './StockService';

/** Matristen gelen tek bir sipariş satırı: her zaman TEK varyant. */
export interface OrderLineInput {
  variant_id: UUID;
  quantity: number;
  unit_price_minor: number;
}

/** Bir ürünün matris girişi → tek `OrderLineGroup` + varyant bazlı satırlar.
 * Asorti ile girildiyse desen ve set adedi grupta saklanır. */
export interface OrderGroupInput {
  product_id: UUID;
  assortment_pattern?: string | null;
  assortment_sets?: number | null;
  lines: OrderLineInput[];
}

/** Bir müşterinin geçmiş siparişlerinde en çok geçen ürünler. */
export interface FrequentProduct {
  product_id: UUID;
  orderCount: number;
  totalQuantity: number;
}

export class OrderService {
  /** Sipariş satırlarını matris gruplarıyla BİRLİKTE, toptan değiştirir
   * (düzenleme = yeniden yaz; satırlar alt veri, `purchaseLines` ile aynı
   * mantık). Yalnızca >0 adetli hücreler satıra dönüşür; her satır tek bir
   * varyanttır, `line_group_id` aynı ürünün satırlarını bağlar. Sevk edilmiş
   * siparişte (stok zaten düşmüş) reddedilir. */
  async saveLines(ctx: ActorContext, orderId: UUID, groups: OrderGroupInput[], discount?: OrderDiscountInput | null): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    const order = await ctx.repository.orders.getById(orderId);
    if (!order || order.deleted_at) throw new Error('Order not found');
    if (order.status === 'shipped') throw new Error('Sevk edilmiş siparişin kalemleri değiştirilemez.');

    const prepared: OrderGroupInput[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
      const lines = group.lines.filter((l) => l.quantity > 0);
      if (lines.length === 0) continue;
      for (const line of lines) {
        if (!Number.isInteger(line.quantity)) throw new Error('Adet tam sayı olmalı.');
        if (!Number.isInteger(line.unit_price_minor) || line.unit_price_minor < 0) throw new Error('Birim fiyat geçersiz.');
        if (seen.has(line.variant_id)) throw new Error('Aynı varyant siparişte iki kez yer alamaz.');
        seen.add(line.variant_id);
        const variant = await ctx.repository.productVariants.getById(line.variant_id);
        if (!variant || variant.product_id !== group.product_id) throw new Error('Varyant bu ürüne ait değil.');
      }
      prepared.push({ ...group, lines });
    }

    // İskonto: verilmediyse (undefined) mevcut iskonto korunur, null kaldırır.
    const effective: OrderDiscountInput | null =
      discount === undefined ? (order.discount_type ? { type: order.discount_type, value: order.discount_value } : null) : discount;
    const gross = prepared.reduce((sum, g) => sum + g.lines.reduce((s2, l) => s2 + l.quantity * l.unit_price_minor, 0), 0);
    const totals = computeOrderTotals(gross, effective);

    await ctx.repository.transaction(async () => {
      await ctx.repository.orderLines.removeByOrder(orderId);
      await ctx.repository.orderLineGroups.removeByOrder(orderId);
      for (const group of prepared) {
        const row = await ctx.repository.orderLineGroups.create({
          order_id: orderId,
          product_id: group.product_id,
          assortment_pattern: group.assortment_pattern ?? null,
          assortment_sets: group.assortment_sets ?? null,
        });
        for (const line of group.lines) {
          await ctx.repository.orderLines.create({ order_id: orderId, ...line, line_group_id: row.id });
        }
      }
      await ctx.repository.orders.updateTotals(orderId, totals);
    });
  }

  /** Yeni sipariş + matris satırları tek adımda. */
  async createWithLines(
    ctx: ActorContext,
    input: { customer_id: UUID; currency: string; note?: string | null; delivery_date?: string | null },
    groups: OrderGroupInput[],
    discount?: OrderDiscountInput | null,
  ): Promise<Order> {
    return ctx.repository.transaction(async () => {
      const order = await this.create(ctx, input);
      await this.saveLines(ctx, order.id, groups, discount);
      return (await ctx.repository.orders.getById(order.id)) ?? order;
    });
  }

  async lineGroups(ctx: ActorContext, orderId: UUID): Promise<OrderLineGroup[]> {
    requirePermission(ctx.employee.role, 'order', 'read');
    return ctx.repository.orderLineGroups.listByOrder(orderId);
  }

  /** "Bu müşterinin sık aldıkları": müşterinin (silinmemiş) siparişlerinde
   * ürün başına kaç farklı siparişte geçtiği, eşitlikte toplam adede göre. */
  async frequentProducts(ctx: ActorContext, customerId: UUID): Promise<FrequentProduct[]> {
    requirePermission(ctx.employee.role, 'order', 'read');
    const orders = await ctx.repository.orders.listByCustomer(customerId);
    const productOfVariant = new Map<string, string | null>();
    const stats = new Map<string, FrequentProduct>();
    for (const order of orders) {
      const inThisOrder = new Set<string>();
      for (const line of await ctx.repository.orderLines.listByOrder(order.id)) {
        if (!productOfVariant.has(line.variant_id)) {
          productOfVariant.set(line.variant_id, (await ctx.repository.productVariants.getById(line.variant_id))?.product_id ?? null);
        }
        const productId = productOfVariant.get(line.variant_id);
        if (!productId) continue;
        const entry = stats.get(productId) ?? { product_id: productId, orderCount: 0, totalQuantity: 0 };
        if (!inThisOrder.has(productId)) {
          entry.orderCount += 1;
          inThisOrder.add(productId);
        }
        entry.totalQuantity += line.quantity;
        stats.set(productId, entry);
      }
    }
    return [...stats.values()].sort((a, b) => b.orderCount - a.orderCount || b.totalQuantity - a.totalQuantity);
  }

  async create(
    ctx: ActorContext,
    input: { customer_id: UUID; currency: string; note?: string | null; delivery_date?: string | null },
  ): Promise<Order> {
    requirePermission(ctx.employee.role, 'order', 'create');
    return ctx.repository.orders.create({
      business_id: ctx.employee.business_id,
      customer_id: input.customer_id,
      source: 'manual', // Faz 1 — see OrderIngestionService for the Faz 2 seam
      currency: input.currency,
      note: input.note ?? null,
      delivery_date: input.delivery_date ?? null,
      created_by: ctx.employee.id,
    });
  }

  async list(ctx: ActorContext): Promise<Order[]> {
    requirePermission(ctx.employee.role, 'order', 'read');
    return ctx.repository.orders.listByBusiness(ctx.employee.business_id);
  }

  async lines(ctx: ActorContext, orderId: UUID): Promise<OrderLine[]> {
    requirePermission(ctx.employee.role, 'order', 'read');
    return ctx.repository.orderLines.listByOrder(orderId);
  }

  /** Advances the order's stage. The one cross-module rule here: being
   * `shipped` keeps each line's variant deducted from stock (real `out`
   * `StockMovement`s tagged `related_order_id`) — the goods have actually
   * left, same reasoning as §5.5's "onaylanınca otomatik oluşturulabilir"
   * for revenue on confirm. `reconcileShipmentStock` is idempotent (same
   * diff-against-booked pattern as `PurchaseService.reconcileStock`), so
   * this covers draft→shipped (books the deduction), shipped→anything-else
   * (an owner/manager un-shipping a mistake books it back in), and a
   * repeated 'shipped' write (no-op) with one code path. */
  async setStatus(ctx: ActorContext, orderId: UUID, status: Order['status']): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    const order = await ctx.repository.orders.getById(orderId);
    if (!order) throw new Error('Order not found');
    const willShip = status === 'shipped';
    if (willShip || order.status === 'shipped') requirePermission(ctx.employee.role, 'stockMovement', 'create');

    // Durum + stok + cari borç birlikte: stok yetmezse (NegativeStockError)
    // sevkiyat da, cari borç da geri alınır.
    await ctx.repository.transaction(async () => {
      await ctx.repository.orders.updateStatus(orderId, status);
      await this.reconcileShipmentStock(ctx, orderId, willShip);
      await cariService.syncOrderShipment(ctx, orderId);
    });
  }

  /** Bir siparişin sevkiyatla ilgili stok hareketlerini (`related_order_id`
   * ile etiketli) istenen duruma eşitler — yalnızca FARKI yazar, var olan
   * hiçbir hareketi değiştirmez (`PurchaseService.reconcileStock` ile aynı
   * desen). `desiredShipped=false` tüm sevkiyat miktarını tersine çevirir —
   * siparişi sevkiyattan geri almak ya da sevk edilmiş bir siparişi silmek
   * için kullanılır. */
  private async reconcileShipmentStock(ctx: ActorContext, orderId: UUID, desiredShipped: boolean): Promise<void> {
    // Her iki harita da aynı yönde: envantere etkisi (giriş +, çıkış −).
    // Sevk edilmiş bir satır stoğu AZALTIR, yani −quantity ile katkı yapar.
    const lines = desiredShipped ? await ctx.repository.orderLines.listByOrder(orderId) : [];
    const desired = new Map<UUID, number>();
    for (const l of lines) desired.set(l.variant_id, (desired.get(l.variant_id) ?? 0) - l.quantity);

    const moves = await ctx.repository.stockMovements.listByOrder(orderId);
    const booked = new Map<UUID, number>();
    for (const m of moves) {
      const signed = m.type === 'out' ? -m.quantity : m.quantity; // in / adjustment carry their own sign
      booked.set(m.variant_id, (booked.get(m.variant_id) ?? 0) + signed);
    }

    for (const variantId of new Set([...desired.keys(), ...booked.keys()])) {
      const want = desired.get(variantId) ?? 0;
      const have = booked.get(variantId) ?? 0;
      const diff = want - have;
      if (diff === 0) continue;
      await stockService.recordMovement(ctx, {
        variant_id: variantId,
        type: diff < 0 ? 'out' : 'in',
        quantity: Math.abs(diff),
        reason: diff < 0 ? 'order_shipped' : 'order_shipment_reversed',
        related_order_id: orderId,
        // Bir düzeltme her zaman geçmeli — sevk edilmiş malın bir kısmı
        // zaten satılmış/kullanılmış olabilir; bunu engellemek silinemez
        // bir sipariş yaratır (PurchaseService.reconcileStock ile aynı gerekçe).
        allowNegative: true,
      });
    }
  }

  /** Free-text order note/details (e.g. special instructions) — editable any
   * time the order itself is, same RBAC gate as every other order edit. */
  async setNote(ctx: ActorContext, orderId: UUID, note: string | null): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    await ctx.repository.orders.updateNote(orderId, note);
  }

  /** Promised hand-off/ship date — a plan, not a status transition (same
   * split as everywhere else here: `setStatus()` never touches this, this
   * never touches `status`). Editable any time the order itself is. */
  async setDeliveryDate(ctx: ActorContext, orderId: UUID, deliveryDate: string | null): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    await ctx.repository.orders.updateDeliveryDate(orderId, deliveryDate);
  }

  /** Removes one line from a still-editable (draft) order — a real
   * `orderLines.remove`, not a soft delete (§4/§8's audit trail is for
   * top-level entities; a draft's line items are freely editable child
   * data, same reasoning as `updateLineQuantity`). */
  async removeLine(ctx: ActorContext, lineId: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    await ctx.repository.orderLines.remove(lineId);
  }

  /** Discards an order — used both for the queue Approval screen's "Reddet"
   * and the Siparişler list's delete action. `delete` (not `update`) per
   * the RBAC matrix — now restricted to owner/manager for 'order' (product
   * feedback: only they may delete made sales/orders, purchases, and
   * entered payments). Sevk edilmiş bir siparişi silmek stoğu da (ters
   * hareketle) geri alır — `reconcileShipmentStock` zaten sevk edilmemiş
   * siparişte no-op. */
  async softDelete(ctx: ActorContext, orderId: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'delete');
    const order = await ctx.repository.orders.getById(orderId);
    if (order?.status === 'shipped') requirePermission(ctx.employee.role, 'stockMovement', 'create');
    await ctx.repository.transaction(async () => {
      await ctx.repository.orders.softDelete(orderId);
      await this.reconcileShipmentStock(ctx, orderId, false);
      // Sevk edilmişti ise borç ters hareketle kapanır (eski hareket düzenlenmez).
      await cariService.syncOrderShipment(ctx, orderId);
    });
  }

  /** Confirms the order — a pure status change (draft → confirmed), same as
   * every other stage transition in `setStatus()`. Deliberately does NOT
   * touch money in any way (see this file's header comment): shipping an
   * order and getting paid for it are two separate real-world events on two
   * separate timelines, and conflating them here was a bug, not a feature. */
  async confirm(ctx: ActorContext, orderId: UUID): Promise<void> {
    requirePermission(ctx.employee.role, 'order', 'update');
    const order = await ctx.repository.orders.getById(orderId);
    if (!order) throw new Error('Order not found');
    await ctx.repository.transaction(async () => {
      await ctx.repository.orders.updateStatus(orderId, 'confirmed');
      await cariService.syncOrderShipment(ctx, orderId);
    });
  }
}

export const orderService = new OrderService();
