// The Repository interface (CLAUDE.md §3/§6): the ONLY way UI or services
// touch data. `SqliteRepository` (sqlite/SqliteRepository.ts) implements
// this for the solo/local tier; a future `TursoSyncRepository` implements
// the same interface for the team tier — callers never know which one
// they're holding.
//
// What's deliberately NOT here: business-rule enforcement (negative-stock
// guard, RBAC, last-owner protection, auto-creating a RevenueEntry when an
// order confirms). Per §5/§8 ("Yetki kontrolü her zaman service layer'da"),
// this is a plain CRUD layer — those rules belong in a service layer that
// sits in front of it (not built yet; see progress.md).

import type {
  Account,
  AssortmentPattern,
  Attribute,
  CariContactType,
  CariMovement,
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
  TaskStatus,
  UUID,
  VariantAttribute,
} from '../models';

export interface Repository {
  business: BusinessRepository;
  employees: EmployeeRepository;
  products: ProductRepository;
  productVariants: ProductVariantRepository;
  attributes: AttributeRepository;
  attributeOptions: AttributeOptionRepository;
  variantAttributes: VariantAttributeRepository;
  axisPresets: AxisPresetRepository;
  stockMovements: StockMovementRepository;
  stockLevels: StockLevelRepository;
  tasks: TaskRepository;
  shifts: ShiftRepository;
  expenses: ExpenseRepository;
  revenues: RevenueRepository;
  checks: CheckRepository;
  customers: CustomerRepository;
  orders: OrderRepository;
  orderLines: OrderLineRepository;
  orderLineGroups: OrderLineGroupRepository;
  assortmentPatterns: AssortmentPatternRepository;
  cariMovements: CariMovementRepository;
  accounts: AccountRepository;
  purchases: PurchaseRepository;
  purchaseLines: PurchaseLineRepository;
  materials: MaterialRepository;
  materialMovements: MaterialMovementRepository;
  /** Tek işlem içinde çalıştırır: `fn` hata fırlatırsa içindeki TÜM yazmalar
   * geri alınır (kasa hareketi + cari hareketi ya ikisi de yazılır ya hiçbiri).
   * İç içe çağrı yeni işlem açmaz, dıştakine katılır. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export type NewRow<T, Optional extends keyof T = never> = Omit<T, 'id' | Optional> &
  Partial<Pick<T, Optional>>;

export interface BusinessRepository {
  create(input: NewRow<Business, 'created_at' | 'allow_negative_stock' | 'last_backup_at'>): Promise<Business>;
  getById(id: UUID): Promise<Business | null>;
  update(id: UUID, patch: Partial<Pick<Business, 'name' | 'base_currency' | 'plan_tier' | 'allow_negative_stock' | 'last_backup_at'>>): Promise<void>;
}

export interface EmployeeRepository {
  create(input: NewRow<Employee, 'created_at' | 'is_active' | 'deleted_at' | 'fcm_token'>): Promise<Employee>;
  getById(id: UUID): Promise<Employee | null>;
  getByFirebaseUid(uid: string): Promise<Employee | null>;
  listByBusiness(businessId: UUID, opts?: { includeInactive?: boolean }): Promise<Employee[]>;
  update(id: UUID, patch: Partial<Pick<Employee, 'display_name' | 'email' | 'phone' | 'role' | 'firebase_uid' | 'fcm_token'>>): Promise<void>;
  /** Sets is_active=0 + deleted_at=now. The last-owner guard (§5.2: "en az 1
   * owner her zaman aktif kalmalı") is a service-layer check BEFORE calling
   * this — this method itself does not enforce it. */
  softDelete(id: UUID): Promise<void>;
}

export interface ProductRepository {
  create(input: NewRow<Product, 'created_at' | 'is_active' | 'deleted_at' | 'category' | 'description' | 'unit' | 'is_purchasable'>): Promise<Product>;
  getById(id: UUID): Promise<Product | null>;
  listByBusiness(businessId: UUID, opts?: { includeInactive?: boolean }): Promise<Product[]>;
  update(
    id: UUID,
    patch: Partial<Pick<Product, 'name' | 'sku' | 'category' | 'description' | 'unit' | 'base_price_minor' | 'currency' | 'is_purchasable'>>,
  ): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface ProductVariantRepository {
  create(
    input: NewRow<ProductVariant, 'is_active' | 'barcode' | 'cost_price_minor' | 'price_minor' | 'image_uri'>,
  ): Promise<ProductVariant>;
  getById(id: UUID): Promise<ProductVariant | null>;
  listByProduct(productId: UUID, opts?: { includeInactive?: boolean }): Promise<ProductVariant[]>;
  update(
    id: UUID,
    patch: Partial<Pick<ProductVariant, 'attributes' | 'sku' | 'barcode' | 'cost_price_minor' | 'price_minor' | 'image_uri' | 'variant_key'>>,
  ): Promise<void>;
  /** No `deleted_at` column on this table (§4) — deactivation is the only
   * soft-delete shape it has. Used as the "archive" outcome of §4's "değer
   * silme" flow when the variant has stock-movement history. */
  deactivate(id: UUID): Promise<void>;
  /** Real `DELETE` — same pattern as `orderLines.remove`/`purchaseLines.remove`.
   * Only ever called by `ProductService.archiveOrDeleteVariant` after
   * confirming the variant has NO stock-movement history; calling this on a
   * variant that does would silently orphan its stock ledger, so this
   * repository method itself does not check — that guard lives in the
   * service layer per §8's "yetki kontrolü/iş kuralları service layer'da". */
  remove(id: UUID): Promise<void>;
}

export interface AttributeRepository {
  create(input: NewRow<Attribute, 'created_at' | 'is_system' | 'unit_label'>): Promise<Attribute>;
  getById(id: UUID): Promise<Attribute | null>;
  listByBusiness(businessId: UUID): Promise<Attribute[]>;
}

export interface AttributeOptionRepository {
  create(input: NewRow<AttributeOption, 'sku_token' | 'swatch_hex' | 'position'>): Promise<AttributeOption>;
  listByAttribute(attributeId: UUID): Promise<AttributeOption[]>;
  /** Looks up an existing option by its canonical `value` — the
   * `UNIQUE(attribute_id, value)` lookup `AttributeService.addOption` uses
   * to decide "reuse" vs. "create". */
  getByValue(attributeId: UUID, value: string): Promise<AttributeOption | null>;
}

export interface VariantAttributeRepository {
  /** Upsert-by-(variant_id, attribute_id) — the primary key IS that pair,
   * so `create` always overwrites any prior row for the same variant+axis
   * rather than erroring, matching how a variant's axis values are set
   * once at creation and never edited after (see §4's "eksen yapısını
   * değiştirme kilitlenir" — there is no "change this variant's color"
   * flow to begin with). */
  create(input: VariantAttribute): Promise<VariantAttribute>;
  listByVariant(variantId: UUID): Promise<VariantAttribute[]>;
  /** Every VariantAttribute row across every variant of one product, in one
   * query — what `ProductService.listVariantsWithAttributes` joins against
   * to avoid an N+1 per-variant round trip. */
  listByProduct(productId: UUID): Promise<VariantAttribute[]>;
}

export interface AxisPresetRepository {
  create(input: NewRow<AxisPreset, 'created_at' | 'use_count' | 'last_used_at'>): Promise<AxisPreset>;
  listByBusiness(businessId: UUID): Promise<AxisPreset[]>;
  /** Bumps `use_count`/`last_used_at` — called by `AttributeService.applyPreset`. */
  recordUse(id: UUID): Promise<void>;
}

export interface StockMovementRepository {
  /** Append-only ledger (§5.1: "değiştirilemez log"). No update/delete
   * method exists on this repository — a correction is a new `adjustment`
   * row via `create`, never a mutation of an existing one. */
  create(input: NewRow<StockMovement, 'created_at' | 'related_order_id' | 'related_purchase_id'>): Promise<StockMovement>;
  getById(id: UUID): Promise<StockMovement | null>;
  listByVariant(variantId: UUID): Promise<StockMovement[]>;
  listByBusiness(businessId: UUID): Promise<StockMovement[]>;
  /** Every movement tagged `related_purchase_id` = this purchase — what
   * `PurchaseService` diffs against to decide how much stock a purchase
   * has already booked (mirrors `materialMovements.listByPurchase`). */
  listByPurchase(purchaseId: UUID): Promise<StockMovement[]>;
  /** Every movement tagged `related_order_id` = this order — what
   * `OrderService` diffs against to decide how much stock a shipment has
   * already booked (same pattern as `listByPurchase`). */
  listByOrder(orderId: UUID): Promise<StockMovement[]>;
}

export interface StockLevelRepository {
  /** Keyed by `variant_id`, not a generated id — 1:1 with ProductVariant. */
  get(variantId: UUID): Promise<StockLevel | null>;
  /** Insert-or-update. The service layer recomputes `on_hand` from the
   * ledger and calls this — this method does not read stock_movement
   * itself, keeping the negative-stock guard (§5.1) entirely in that layer. */
  upsert(row: StockLevel): Promise<void>;
}

export interface TaskRepository {
  create(input: NewRow<Task, 'created_at' | 'status' | 'deleted_at'>): Promise<Task>;
  getById(id: UUID): Promise<Task | null>;
  listByBusiness(businessId: UUID): Promise<Task[]>;
  listByAssignee(assigneeId: UUID): Promise<Task[]>;
  updateStatus(id: UUID, status: TaskStatus): Promise<void>;
  update(id: UUID, patch: Partial<Pick<Task, 'title' | 'description' | 'assignee_id' | 'due_date'>>): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface ShiftRepository {
  create(input: NewRow<Shift>): Promise<Shift>;
  getById(id: UUID): Promise<Shift | null>;
  listByEmployee(employeeId: UUID): Promise<Shift[]>;
  listByBusiness(businessId: UUID): Promise<Shift[]>;
}

export interface ExpenseRepository {
  create(
    input: NewRow<
      ExpenseEntry,
      | 'deleted_at'
      | 'related_order_id'
      | 'related_purchase_id'
      | 'related_customer_id'
      | 'related_employee_id'
      | 'related_account_id'
      | 'cari_excluded'
    >,
  ): Promise<ExpenseEntry>;
  getById(id: UUID): Promise<ExpenseEntry | null>;
  listByBusiness(businessId: UUID, opts?: { from?: string; to?: string }): Promise<ExpenseEntry[]>;
  /** Payments recorded against one purchase (the purchase-balance feature)
   * — every ExpenseEntry with `related_purchase_id` = this purchase. */
  listByPurchase(purchaseId: UUID): Promise<ExpenseEntry[]>;
  update(
    id: UUID,
    patch: Partial<Pick<ExpenseEntry, 'category' | 'amount_minor' | 'currency' | 'date' | 'note' | 'payment_method' | 'related_customer_id' | 'related_account_id' | 'cari_excluded'>>,
  ): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface RevenueRepository {
  create(
    input: NewRow<
      RevenueEntry,
      'deleted_at' | 'related_order_id' | 'related_customer_id' | 'related_employee_id' | 'related_account_id' | 'category' | 'cari_excluded'
    >,
  ): Promise<RevenueEntry>;
  getById(id: UUID): Promise<RevenueEntry | null>;
  listByBusiness(businessId: UUID, opts?: { from?: string; to?: string }): Promise<RevenueEntry[]>;
  /** Payments recorded against one order (the customer-balance feature) —
   * every RevenueEntry with `related_order_id` = this order, oldest first. */
  listByOrder(orderId: UUID): Promise<RevenueEntry[]>;
  update(
    id: UUID,
    patch: Partial<Pick<RevenueEntry, 'amount_minor' | 'currency' | 'date' | 'note' | 'payment_method' | 'category' | 'related_customer_id' | 'related_account_id' | 'cari_excluded'>>,
  ): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface AccountRepository {
  create(input: NewRow<Account, 'created_at' | 'is_active' | 'deleted_at' | 'note' | 'currency'>): Promise<Account>;
  getById(id: UUID): Promise<Account | null>;
  listByBusiness(businessId: UUID, opts?: { includeInactive?: boolean }): Promise<Account[]>;
  update(id: UUID, patch: Partial<Pick<Account, 'name' | 'note'>>): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface CheckRepository {
  create(input: NewRow<Check, 'created_at' | 'deleted_at'>): Promise<Check>;
  getById(id: UUID): Promise<Check | null>;
  listByBusiness(businessId: UUID): Promise<Check[]>;
  /** For the "yaklaşan vadeler" reminder/report (§5.6). */
  listPendingDueBefore(businessId: UUID, isoDate: string): Promise<Check[]>;
  /** The Check row (if any) linked to one ExpenseEntry/RevenueEntry — at
   * most one per entry (§5.6: a check-paid entry gets exactly one Check
   * created alongside it). Used to show a payment's cash-out/due date and
   * cleared/bounced status without listing every check in the business. */
  getByRelatedEntry(entryId: UUID, entryType: Check['related_entry_type']): Promise<Check | null>;
  updateStatus(id: UUID, status: Check['status']): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface CustomerRepository {
  create(input: NewRow<Customer, 'is_active' | 'deleted_at' | 'currency'>): Promise<Customer>;
  getById(id: UUID): Promise<Customer | null>;
  listByBusiness(businessId: UUID, opts?: { includeInactive?: boolean }): Promise<Customer[]>;
  update(id: UUID, patch: Partial<Pick<Customer, 'name' | 'primary_channel' | 'contact_ref'>>): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface OrderRepository {
  create(
    input: NewRow<
      Order,
      'created_at' | 'status' | 'deleted_at' | 'note' | 'delivery_date' | 'gross_total_minor' | 'discount_type' | 'discount_value' | 'discount_amount_minor' | 'net_total_minor'
    >,
  ): Promise<Order>;
  getById(id: UUID): Promise<Order | null>;
  listByBusiness(businessId: UUID): Promise<Order[]>;
  listByCustomer(customerId: UUID): Promise<Order[]>;
  updateStatus(id: UUID, status: Order['status']): Promise<void>;
  updateNote(id: UUID, note: string | null): Promise<void>;
  updateDeliveryDate(id: UUID, deliveryDate: string | null): Promise<void>;
  /** Brüt/iskonto/net üçlüsünü birlikte yazar (`OrderService.saveLines`). */
  updateTotals(
    id: UUID,
    totals: Pick<Order, 'gross_total_minor' | 'discount_type' | 'discount_value' | 'discount_amount_minor' | 'net_total_minor'>,
  ): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface OrderLineRepository {
  /** A draft order's line items are freely editable pre-confirmation — this
   * is compositional child data, not an audited business record on its own,
   * so unlike the entities above it gets a real `remove`, not a soft delete. */
  create(input: NewRow<OrderLine, 'line_group_id'>): Promise<OrderLine>;
  listByOrder(orderId: UUID): Promise<OrderLine[]>;
  update(id: UUID, patch: Partial<Pick<OrderLine, 'quantity' | 'unit_price_minor'>>): Promise<void>;
  remove(id: UUID): Promise<void>;
  /** `OrderService.saveLines` replaces an order's lines wholesale (like
   * `purchaseLines.removeByPurchase`). */
  removeByOrder(orderId: UUID): Promise<void>;
  /** Bir varyanta bağlı sipariş satırı var mı — hayalet default varyant
   * temizliğinde "kullanılmış mı" kararı için. */
  countByVariant(variantId: UUID): Promise<number>;
}

export interface OrderLineGroupRepository {
  create(input: NewRow<OrderLineGroup, 'assortment_pattern' | 'assortment_sets'>): Promise<OrderLineGroup>;
  listByOrder(orderId: UUID): Promise<OrderLineGroup[]>;
  removeByOrder(orderId: UUID): Promise<void>;
}

/** Cari defter: yalnızca EKLENİR — güncelleme/silme yolu bilerek yok
 * (düzeltme daima yeni ters hareketle). */
export interface CariMovementRepository {
  create(
    input: NewRow<CariMovement, 'created_at' | 'updated_at' | 'deleted_at' | 'exchange_rate' | 'source_id' | 'reverses_id' | 'reason'>,
  ): Promise<CariMovement>;
  getById(id: UUID): Promise<CariMovement | null>;
  /** Tarihe göre yeniden eskiye. */
  listByContact(contactType: CariContactType, contactId: UUID): Promise<CariMovement[]>;
  listBySource(sourceType: CariMovement['source_type'], sourceId: UUID): Promise<CariMovement[]>;
  listByBusiness(businessId: UUID): Promise<CariMovement[]>;
}

export interface AssortmentPatternRepository {
  create(input: NewRow<AssortmentPattern, 'created_at' | 'deleted_at' | 'customer_id'>): Promise<AssortmentPattern>;
  /** Business-wide patterns AND every customer's own — callers filter. */
  listByBusiness(businessId: UUID): Promise<AssortmentPattern[]>;
  softDelete(id: UUID): Promise<void>;
}

export interface PurchaseRepository {
  create(input: NewRow<Purchase, 'created_at' | 'updated_at' | 'status' | 'purchase_date' | 'is_received' | 'received_at' | 'deleted_at' | 'note'>): Promise<Purchase>;
  getById(id: UUID): Promise<Purchase | null>;
  listByBusiness(businessId: UUID): Promise<Purchase[]>;
  listByAccount(accountId: UUID): Promise<Purchase[]>;
  /** Bumps `updated_at` itself — callers only pass the fields that changed. */
  update(
    id: UUID,
    patch: Partial<Pick<Purchase, 'account_id' | 'purchase_date' | 'note' | 'status' | 'is_received' | 'received_at'>>,
  ): Promise<void>;
  softDelete(id: UUID): Promise<void>;
}

export interface PurchaseLineRepository {
  create(input: NewRow<PurchaseLine, 'material_id' | 'variant_id' | 'line_group_id' | 'note'>): Promise<PurchaseLine>;
  listByPurchase(purchaseId: UUID): Promise<PurchaseLine[]>;
  /** A purchase's lines are compositional child data (like `orderLines`),
   * so `PurchaseService.save` replaces them wholesale on every save — a real
   * `DELETE`, not a soft delete. Stock is never derived from these rows
   * directly (it goes through the movement ledgers), so replacing them
   * cannot desync stock. */
  removeByPurchase(purchaseId: UUID): Promise<void>;
  /** Bir varyanta bağlı satın alma satırı var mı (hayalet default varyant temizliği). */
  countByVariant(variantId: UUID): Promise<number>;
}

export interface MaterialRepository {
  create(
    input: NewRow<Material, 'created_at' | 'updated_at' | 'stock_quantity' | 'status' | 'deleted_at' | 'description' | 'category'>,
  ): Promise<Material>;
  getById(id: UUID): Promise<Material | null>;
  /** Archived materials are hidden from the purchase catalog by default. */
  listByBusiness(businessId: UUID, opts?: { includeArchived?: boolean }): Promise<Material[]>;
  update(id: UUID, patch: Partial<Pick<Material, 'name' | 'description' | 'unit' | 'category' | 'status'>>): Promise<void>;
  /** Atomic `stock_quantity = stock_quantity + delta` — the ONLY way
   * `stock_quantity` changes (there is no "set to N" method on purpose;
   * a correction is a reverse delta paired with a `MaterialMovement`). */
  applyStockDelta(id: UUID, delta: number): Promise<void>;
}

export interface MaterialMovementRepository {
  /** Append-only, same contract as `StockMovementRepository`. */
  create(input: NewRow<MaterialMovement, 'created_at' | 'reason' | 'related_purchase_id'>): Promise<MaterialMovement>;
  listByMaterial(materialId: UUID): Promise<MaterialMovement[]>;
  listByPurchase(purchaseId: UUID): Promise<MaterialMovement[]>;
}
