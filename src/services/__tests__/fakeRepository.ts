// In-memory Repository fake for unit tests (CLAUDE.md §8's "birim test
// iskeleti"). Implements the full `Repository` interface with plain arrays
// — no SQLite, so these tests run under plain `node`, not just inside the
// RN app. Deliberately minimal: enough behavior to exercise the service
// layer's business rules (last-owner, negative-stock, own-task-only), not a
// faithful SQL emulation (no real query semantics, no persistence).

import type {
  Account,
  Attribute,
  AttributeOption,
  AxisPreset,
  Business,
  Check,
  Customer,
  Employee,
  ExpenseEntry,
  Material,
  MaterialMovement,
  Order,
  AssortmentPattern,
  CariMovement,
  OrderLine,
  OrderLineGroup,
  Product,
  ProductVariant,
  Purchase,
  PurchaseLine,
  RevenueEntry,
  Shift,
  StockLevel,
  StockMovement,
  Task,
  UUID,
  VariantAttribute,
} from '../../models';
import type { NewRow, Repository } from '../../repository';

let counter = 0;
function id(): UUID {
  counter += 1;
  return `fake-${counter}`;
}
function now(): string {
  return new Date().toISOString();
}

export function createFakeRepository(): Repository {
  const employees: Employee[] = [];
  const businesses: Business[] = [];
  const products: Product[] = [];
  const variants: ProductVariant[] = [];
  const attributes: Attribute[] = [];
  const attributeOptions: AttributeOption[] = [];
  const variantAttributes: VariantAttribute[] = [];
  const axisPresets: AxisPreset[] = [];
  const stockMovements: StockMovement[] = [];
  const stockLevels: StockLevel[] = [];
  const tasks: Task[] = [];
  const shifts: Shift[] = [];
  const expenses: ExpenseEntry[] = [];
  const revenues: RevenueEntry[] = [];
  const checks: Check[] = [];
  const customers: Customer[] = [];
  const orders: Order[] = [];
  const orderLines: OrderLine[] = [];
  const orderLineGroups: OrderLineGroup[] = [];
  const assortmentPatterns: AssortmentPattern[] = [];
  const cariMovements: CariMovement[] = [];
  const accounts: Account[] = [];
  const purchases: Purchase[] = [];
  const purchaseLines: PurchaseLine[] = [];
  const materials: Material[] = [];
  const materialMovements: MaterialMovement[] = [];

  // İşlem: kasa + cari gibi çok tablolu yazmaların geri alınabilmesini test eder
  // (SqliteRepository'de gerçek BEGIN/COMMIT). Yalnızca finans/cari tabloları
  // yedeklenir; iç içe çağrı dıştakine katılır.
  let transactionDepth = 0;
  const transactional = [orders, revenues, expenses, checks, cariMovements, customers, accounts, orderLines, orderLineGroups, purchases, purchaseLines] as unknown as unknown[][];
  async function transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (transactionDepth > 0) return fn();
    const snapshots = transactional.map((arr) => structuredClone(arr));
    transactionDepth += 1;
    try {
      return await fn();
    } catch (e) {
      transactional.forEach((arr, i) => arr.splice(0, arr.length, ...snapshots[i]));
      throw e;
    } finally {
      transactionDepth -= 1;
    }
  }

  return {
    transaction,
    business: {
      async create(input: NewRow<Business, 'created_at' | 'allow_negative_stock' | 'last_backup_at'>) {
        const row: Business = {
          ...input,
          id: id(),
          created_at: now(),
          allow_negative_stock: input.allow_negative_stock ?? 0,
          last_backup_at: input.last_backup_at ?? null,
        };
        businesses.push(row);
        return row;
      },
      async getById(bid) {
        return businesses.find((b) => b.id === bid) ?? null;
      },
      async update(bid, patch) {
        const b = businesses.find((x) => x.id === bid);
        if (b) Object.assign(b, patch);
      },
    },
    employees: {
      async create(input) {
        const row: Employee = { ...input, id: id(), is_active: 1, created_at: now(), deleted_at: null, fcm_token: input.fcm_token ?? null };
        employees.push(row);
        return row;
      },
      async getById(eid) {
        return employees.find((e) => e.id === eid) ?? null;
      },
      async getByFirebaseUid(uid) {
        return employees.find((e) => e.firebase_uid === uid) ?? null;
      },
      async listByBusiness(bid, opts) {
        return employees.filter((e) => e.business_id === bid && (opts?.includeInactive || e.is_active));
      },
      async update(eid, patch) {
        const e = employees.find((x) => x.id === eid);
        if (e) Object.assign(e, patch);
      },
      async softDelete(eid) {
        const e = employees.find((x) => x.id === eid);
        if (e) {
          e.is_active = 0;
          e.deleted_at = now();
        }
      },
    },
    products: {
      async create(input) {
        const row: Product = {
          ...input,
          id: id(),
          is_active: 1,
          created_at: now(),
          deleted_at: null,
          category: input.category ?? null,
          description: input.description ?? null,
          unit: input.unit ?? 'adet',
          is_purchasable: input.is_purchasable ?? 1,
        };
        products.push(row);
        return row;
      },
      async getById(pid) {
        return products.find((p) => p.id === pid) ?? null;
      },
      async listByBusiness(bid, opts) {
        return products.filter((p) => p.business_id === bid && (opts?.includeInactive || p.is_active));
      },
      async update(pid, patch) {
        const p = products.find((x) => x.id === pid);
        if (p) Object.assign(p, patch);
      },
      async softDelete(pid) {
        const p = products.find((x) => x.id === pid);
        if (p) {
          p.is_active = 0;
          p.deleted_at = now();
        }
      },
    },
    productVariants: {
      async create(input) {
        const row: ProductVariant = {
          ...input,
          id: id(),
          is_active: 1,
          barcode: input.barcode ?? null,
          cost_price_minor: input.cost_price_minor ?? null,
          price_minor: input.price_minor ?? null,
          image_uri: input.image_uri ?? null,
        };
        variants.push(row);
        return row;
      },
      async getById(vid) {
        return variants.find((v) => v.id === vid) ?? null;
      },
      async listByProduct(pid, opts) {
        return variants.filter((v) => v.product_id === pid && (opts?.includeInactive || v.is_active));
      },
      async update(vid, patch) {
        const v = variants.find((x) => x.id === vid);
        if (v) Object.assign(v, patch);
      },
      async deactivate(vid) {
        const v = variants.find((x) => x.id === vid);
        if (v) v.is_active = 0;
      },
      async remove(vid) {
        const idx = variants.findIndex((x) => x.id === vid);
        if (idx >= 0) variants.splice(idx, 1);
      },
    },
    attributes: {
      async create(input) {
        const row: Attribute = {
          ...input,
          id: id(),
          created_at: now(),
          is_system: input.is_system ?? 0,
          unit_label: input.unit_label ?? null,
        };
        attributes.push(row);
        return row;
      },
      async getById(aid) {
        return attributes.find((a) => a.id === aid) ?? null;
      },
      async listByBusiness(bid) {
        return attributes.filter((a) => a.business_id === bid);
      },
    },
    attributeOptions: {
      async create(input) {
        const row: AttributeOption = {
          ...input,
          id: id(),
          sku_token: input.sku_token ?? null,
          swatch_hex: input.swatch_hex ?? null,
          position: input.position ?? 0,
        };
        attributeOptions.push(row);
        return row;
      },
      async listByAttribute(attributeId) {
        return attributeOptions.filter((o) => o.attribute_id === attributeId);
      },
      async getByValue(attributeId, value) {
        return attributeOptions.find((o) => o.attribute_id === attributeId && o.value === value) ?? null;
      },
    },
    variantAttributes: {
      async create(input) {
        const idx = variantAttributes.findIndex((va) => va.variant_id === input.variant_id && va.attribute_id === input.attribute_id);
        if (idx >= 0) variantAttributes[idx] = input;
        else variantAttributes.push(input);
        return input;
      },
      async listByVariant(variantId) {
        return variantAttributes.filter((va) => va.variant_id === variantId);
      },
      async listByProduct(productId) {
        const variantIds = new Set(variants.filter((v) => v.product_id === productId).map((v) => v.id));
        return variantAttributes.filter((va) => variantIds.has(va.variant_id));
      },
    },
    axisPresets: {
      async create(input) {
        const row: AxisPreset = {
          ...input,
          id: id(),
          created_at: now(),
          use_count: input.use_count ?? 0,
          last_used_at: input.last_used_at ?? null,
        };
        axisPresets.push(row);
        return row;
      },
      async listByBusiness(bid) {
        return axisPresets.filter((p) => p.business_id === bid);
      },
      async recordUse(pid) {
        const p = axisPresets.find((x) => x.id === pid);
        if (p) {
          p.use_count += 1;
          p.last_used_at = now();
        }
      },
    },
    stockMovements: {
      async create(input) {
        const row: StockMovement = { related_order_id: null, related_purchase_id: null, ...input, id: id(), created_at: now() };
        stockMovements.push(row);
        return row;
      },
      async getById(mid) {
        return stockMovements.find((m) => m.id === mid) ?? null;
      },
      async listByVariant(vid) {
        return stockMovements.filter((m) => m.variant_id === vid);
      },
      async listByBusiness(bid) {
        return stockMovements.filter((m) => m.business_id === bid);
      },
      async listByPurchase(pid) {
        return stockMovements.filter((m) => m.related_purchase_id === pid);
      },
      async listByOrder(oid) {
        return stockMovements.filter((m) => m.related_order_id === oid);
      },
    },
    stockLevels: {
      async get(vid) {
        return stockLevels.find((l) => l.variant_id === vid) ?? null;
      },
      async upsert(row) {
        const i = stockLevels.findIndex((l) => l.variant_id === row.variant_id);
        if (i >= 0) stockLevels[i] = row;
        else stockLevels.push(row);
      },
    },
    tasks: {
      async create(input) {
        const row: Task = { ...input, id: id(), status: 'todo', created_at: now(), deleted_at: null };
        tasks.push(row);
        return row;
      },
      async getById(tid) {
        return tasks.find((t) => t.id === tid) ?? null;
      },
      async listByBusiness(bid) {
        return tasks.filter((t) => t.business_id === bid && !t.deleted_at);
      },
      async listByAssignee(aid) {
        return tasks.filter((t) => t.assignee_id === aid && !t.deleted_at);
      },
      async updateStatus(tid, status) {
        const t = tasks.find((x) => x.id === tid);
        if (t) t.status = status;
      },
      async update(tid, patch) {
        const t = tasks.find((x) => x.id === tid);
        if (t) Object.assign(t, patch);
      },
      async softDelete(tid) {
        const t = tasks.find((x) => x.id === tid);
        if (t) t.deleted_at = now();
      },
    },
    shifts: {
      async create(input) {
        const row: Shift = { ...input, id: id() };
        shifts.push(row);
        return row;
      },
      async getById(sid) {
        return shifts.find((s) => s.id === sid) ?? null;
      },
      async listByEmployee(eid) {
        return shifts.filter((s) => s.employee_id === eid);
      },
      async listByBusiness(bid) {
        return shifts.filter((s) => s.business_id === bid);
      },
    },
    expenses: {
      async create(input) {
        const row: ExpenseEntry = {
          related_order_id: null,
          related_purchase_id: null,
          related_customer_id: null,
          related_employee_id: null,
          related_account_id: null,
          ...input,
          cari_excluded: input.cari_excluded ?? 0,
          id: id(),
          deleted_at: null,
        };
        expenses.push(row);
        return row;
      },
      async getById(eid) {
        return expenses.find((e) => e.id === eid) ?? null;
      },
      async listByPurchase(purchaseId) {
        return expenses.filter((e) => e.related_purchase_id === purchaseId && !e.deleted_at);
      },
      async listByBusiness(bid) {
        return expenses.filter((e) => e.business_id === bid && !e.deleted_at);
      },
      async update(eid, patch) {
        const e = expenses.find((x) => x.id === eid);
        if (e) Object.assign(e, patch);
      },
      async softDelete(eid) {
        const e = expenses.find((x) => x.id === eid);
        if (e) e.deleted_at = now();
      },
    },
    revenues: {
      async create(input) {
        const row: RevenueEntry = {
          related_order_id: null,
          related_customer_id: null,
          related_employee_id: null,
          related_account_id: null,
          ...input,
          category: input.category ?? null,
          cari_excluded: input.cari_excluded ?? 0,
          id: id(),
          deleted_at: null,
        };
        revenues.push(row);
        return row;
      },
      async getById(rid) {
        return revenues.find((r) => r.id === rid) ?? null;
      },
      async listByBusiness(bid) {
        return revenues.filter((r) => r.business_id === bid && !r.deleted_at);
      },
      async listByOrder(orderId) {
        return revenues.filter((r) => r.related_order_id === orderId && !r.deleted_at);
      },
      async update(rid, patch) {
        const r = revenues.find((x) => x.id === rid);
        if (r) Object.assign(r, patch);
      },
      async softDelete(rid) {
        const r = revenues.find((x) => x.id === rid);
        if (r) r.deleted_at = now();
      },
    },
    checks: {
      async create(input) {
        const row: Check = { ...input, id: id(), created_at: now(), deleted_at: null };
        checks.push(row);
        return row;
      },
      async getById(cid) {
        return checks.find((c) => c.id === cid) ?? null;
      },
      async listByBusiness(bid) {
        return checks.filter((c) => c.business_id === bid && !c.deleted_at);
      },
      async listPendingDueBefore(bid, isoDate) {
        return checks.filter((c) => c.business_id === bid && c.status === 'pending' && c.due_date <= isoDate && !c.deleted_at);
      },
      async getByRelatedEntry(entryId, entryType) {
        return checks.find((c) => c.related_entry_id === entryId && c.related_entry_type === entryType && !c.deleted_at) ?? null;
      },
      async updateStatus(cid, status) {
        const c = checks.find((x) => x.id === cid);
        if (c) c.status = status;
      },
      async softDelete(cid) {
        const c = checks.find((x) => x.id === cid);
        if (c) c.deleted_at = now();
      },
    },
    customers: {
      async create(input) {
        const row: Customer = { ...input, currency: input.currency ?? null, id: id(), is_active: 1, deleted_at: null };
        customers.push(row);
        return row;
      },
      async getById(cid) {
        return customers.find((c) => c.id === cid) ?? null;
      },
      async listByBusiness(bid, opts) {
        return customers.filter((c) => c.business_id === bid && (opts?.includeInactive || c.is_active));
      },
      async update(cid, patch) {
        const c = customers.find((x) => x.id === cid);
        if (c) Object.assign(c, patch);
      },
      async softDelete(cid) {
        const c = customers.find((x) => x.id === cid);
        if (c) {
          c.is_active = 0;
          c.deleted_at = now();
        }
      },
    },
    accounts: {
      async create(input) {
        const row: Account = { note: null, ...input, currency: input.currency ?? null, id: id(), is_active: 1, created_at: now(), deleted_at: null };
        accounts.push(row);
        return row;
      },
      async getById(aid) {
        return accounts.find((a) => a.id === aid) ?? null;
      },
      async listByBusiness(bid, opts) {
        return accounts.filter((a) => a.business_id === bid && (opts?.includeInactive || a.is_active));
      },
      async update(aid, patch) {
        const a = accounts.find((x) => x.id === aid);
        if (a) Object.assign(a, patch);
      },
      async softDelete(aid) {
        const a = accounts.find((x) => x.id === aid);
        if (a) {
          a.is_active = 0;
          a.deleted_at = now();
        }
      },
    },
    orders: {
      async create(input) {
        const row: Order = {
          ...input,
          id: id(),
          status: 'draft',
          note: input.note ?? null,
          delivery_date: input.delivery_date ?? null,
          gross_total_minor: input.gross_total_minor ?? 0,
          discount_type: input.discount_type ?? null,
          discount_value: input.discount_value ?? 0,
          discount_amount_minor: input.discount_amount_minor ?? 0,
          net_total_minor: input.net_total_minor ?? 0,
          created_at: now(),
          deleted_at: null,
        };
        orders.push(row);
        return row;
      },
      async getById(oid) {
        return orders.find((o) => o.id === oid) ?? null;
      },
      async listByBusiness(bid) {
        return orders.filter((o) => o.business_id === bid && !o.deleted_at);
      },
      async listByCustomer(cid) {
        return orders.filter((o) => o.customer_id === cid && !o.deleted_at);
      },
      async updateStatus(oid, status) {
        const o = orders.find((x) => x.id === oid);
        if (o) o.status = status;
      },
      async updateNote(oid, note) {
        const o = orders.find((x) => x.id === oid);
        if (o) o.note = note;
      },
      async updateDeliveryDate(oid, deliveryDate) {
        const o = orders.find((x) => x.id === oid);
        if (o) o.delivery_date = deliveryDate;
      },
      async updateTotals(oid, totals) {
        const o = orders.find((x) => x.id === oid);
        if (o) Object.assign(o, totals);
      },
      async softDelete(oid) {
        const o = orders.find((x) => x.id === oid);
        if (o) o.deleted_at = now();
      },
    },
    orderLines: {
      async create(input) {
        const row: OrderLine = { ...input, line_group_id: input.line_group_id ?? null, id: id() };
        orderLines.push(row);
        return row;
      },
      async removeByOrder(oid) {
        for (let i = orderLines.length - 1; i >= 0; i--) {
          if (orderLines[i].order_id === oid) orderLines.splice(i, 1);
        }
      },
      async countByVariant(vid) {
        return orderLines.filter((l) => l.variant_id === vid).length;
      },
      async listByOrder(oid) {
        return orderLines.filter((l) => l.order_id === oid);
      },
      async update(lid, patch) {
        const l = orderLines.find((x) => x.id === lid);
        if (l) Object.assign(l, patch);
      },
      async remove(lid) {
        const i = orderLines.findIndex((x) => x.id === lid);
        if (i >= 0) orderLines.splice(i, 1);
      },
    },
    cariMovements: {
      async create(input) {
        const stamp = now();
        const row: CariMovement = {
          ...input,
          exchange_rate: input.exchange_rate ?? null,
          source_id: input.source_id ?? null,
          reverses_id: input.reverses_id ?? null,
          reason: input.reason ?? null,
          id: id(),
          created_at: stamp,
          updated_at: stamp,
          deleted_at: null,
        };
        cariMovements.push(row);
        return row;
      },
      async getById(mid) {
        return cariMovements.find((m) => m.id === mid) ?? null;
      },
      async listByContact(contactType, contactId) {
        return cariMovements
          .filter((m) => m.contact_type === contactType && m.contact_id === contactId)
          .sort((a, b) => b.movement_date.localeCompare(a.movement_date) || b.created_at.localeCompare(a.created_at));
      },
      async listBySource(sourceType, sourceId) {
        return cariMovements.filter((m) => m.source_type === sourceType && m.source_id === sourceId);
      },
      async listByBusiness(bid) {
        return cariMovements.filter((m) => m.business_id === bid);
      },
    },
    orderLineGroups: {
      async create(input) {
        const row: OrderLineGroup = { ...input, assortment_pattern: input.assortment_pattern ?? null, assortment_sets: input.assortment_sets ?? null, id: id() };
        orderLineGroups.push(row);
        return row;
      },
      async listByOrder(oid) {
        return orderLineGroups.filter((g) => g.order_id === oid);
      },
      async removeByOrder(oid) {
        for (let i = orderLineGroups.length - 1; i >= 0; i--) {
          if (orderLineGroups[i].order_id === oid) orderLineGroups.splice(i, 1);
        }
      },
    },
    assortmentPatterns: {
      async create(input) {
        const row: AssortmentPattern = { ...input, customer_id: input.customer_id ?? null, created_at: now(), deleted_at: null, id: id() };
        assortmentPatterns.push(row);
        return row;
      },
      async listByBusiness(bid) {
        return assortmentPatterns.filter((a) => a.business_id === bid && !a.deleted_at);
      },
      async softDelete(aid) {
        const a = assortmentPatterns.find((x) => x.id === aid);
        if (a) a.deleted_at = now();
      },
    },
    purchases: {
      async create(input) {
        const createdAt = now();
        const row: Purchase = {
          status: 'draft',
          purchase_date: createdAt,
          is_received: 0,
          received_at: null,
          note: null,
          ...input,
          id: id(),
          created_at: createdAt,
          updated_at: createdAt,
          deleted_at: null,
        };
        purchases.push(row);
        return row;
      },
      async getById(pid) {
        return purchases.find((p) => p.id === pid) ?? null;
      },
      async listByBusiness(bid) {
        return purchases.filter((p) => p.business_id === bid && !p.deleted_at);
      },
      async listByAccount(aid) {
        return purchases.filter((p) => p.account_id === aid && !p.deleted_at);
      },
      async update(pid, patch) {
        const p = purchases.find((x) => x.id === pid);
        if (p) Object.assign(p, patch, { updated_at: now() });
      },
      async softDelete(pid) {
        const p = purchases.find((x) => x.id === pid);
        if (p) p.deleted_at = now();
      },
    },
    purchaseLines: {
      async create(input) {
        const row: PurchaseLine = { material_id: null, variant_id: null, line_group_id: null, note: null, ...input, id: id() };
        purchaseLines.push(row);
        return row;
      },
      async listByPurchase(pid) {
        return purchaseLines.filter((l) => l.purchase_id === pid);
      },
      async removeByPurchase(pid) {
        for (let i = purchaseLines.length - 1; i >= 0; i--) {
          if (purchaseLines[i].purchase_id === pid) purchaseLines.splice(i, 1);
        }
      },
      async countByVariant(vid) {
        return purchaseLines.filter((l) => l.variant_id === vid).length;
      },
    },
    materials: {
      async create(input) {
        const createdAt = now();
        const row: Material = {
          description: null,
          category: null,
          stock_quantity: 0,
          status: 'active',
          ...input,
          id: id(),
          created_at: createdAt,
          updated_at: createdAt,
          deleted_at: null,
        };
        materials.push(row);
        return row;
      },
      async getById(mid) {
        return materials.find((m) => m.id === mid) ?? null;
      },
      async listByBusiness(bid, opts) {
        return materials.filter((m) => m.business_id === bid && !m.deleted_at && (opts?.includeArchived || m.status === 'active'));
      },
      async update(mid, patch) {
        const m = materials.find((x) => x.id === mid);
        if (m) Object.assign(m, patch, { updated_at: now() });
      },
      async applyStockDelta(mid, delta) {
        const m = materials.find((x) => x.id === mid);
        if (m) m.stock_quantity += delta;
      },
    },
    materialMovements: {
      async create(input) {
        const row: MaterialMovement = { reason: null, related_purchase_id: null, ...input, id: id(), created_at: now() };
        materialMovements.push(row);
        return row;
      },
      async listByMaterial(mid) {
        return materialMovements.filter((m) => m.material_id === mid);
      },
      async listByPurchase(pid) {
        return materialMovements.filter((m) => m.related_purchase_id === pid);
      },
    },
  };
}
