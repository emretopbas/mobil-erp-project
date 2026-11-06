// SqliteRepository — the Faz 1 / solo-tier implementation of Repository
// (types.ts). A future TursoSyncRepository implements the same interface
// for the team tier (CLAUDE.md §3); nothing outside this file should know
// which one it's holding.

import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '../../db/client';
import type {
  Account,
  AssortmentPattern,
  Attribute,
  AttributeOption,
  AxisPreset,
  Business,
  CariMovement,
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
  VariantAttribute,
} from '../../models';
import { newId, nowIso } from '../id';
import { SqliteTable } from './table';
import type {
  AccountRepository,
  AssortmentPatternRepository,
  AttributeOptionRepository,
  AttributeRepository,
  AxisPresetRepository,
  BusinessRepository,
  CariMovementRepository,
  CheckRepository,
  CustomerRepository,
  EmployeeRepository,
  ExpenseRepository,
  MaterialMovementRepository,
  MaterialRepository,
  OrderLineGroupRepository,
  OrderLineRepository,
  OrderRepository,
  ProductRepository,
  ProductVariantRepository,
  PurchaseLineRepository,
  PurchaseRepository,
  Repository,
  RevenueRepository,
  ShiftRepository,
  StockLevelRepository,
  StockMovementRepository,
  TaskRepository,
  VariantAttributeRepository,
} from '../types';

export class SqliteRepository implements Repository {
  readonly business: BusinessRepository;
  readonly employees: EmployeeRepository;
  readonly products: ProductRepository;
  readonly productVariants: ProductVariantRepository;
  readonly attributes: AttributeRepository;
  readonly attributeOptions: AttributeOptionRepository;
  readonly variantAttributes: VariantAttributeRepository;
  readonly axisPresets: AxisPresetRepository;
  readonly stockMovements: StockMovementRepository;
  readonly stockLevels: StockLevelRepository;
  readonly tasks: TaskRepository;
  readonly shifts: ShiftRepository;
  readonly expenses: ExpenseRepository;
  readonly revenues: RevenueRepository;
  readonly checks: CheckRepository;
  readonly customers: CustomerRepository;
  readonly orders: OrderRepository;
  readonly orderLines: OrderLineRepository;
  readonly orderLineGroups: OrderLineGroupRepository;
  readonly assortmentPatterns: AssortmentPatternRepository;
  readonly cariMovements: CariMovementRepository;
  readonly transaction: Repository['transaction'];
  readonly accounts: AccountRepository;
  readonly purchases: PurchaseRepository;
  readonly purchaseLines: PurchaseLineRepository;
  readonly materials: MaterialRepository;
  readonly materialMovements: MaterialMovementRepository;

  private constructor(db: SQLiteDatabase) {
    let transactionDepth = 0;
    this.transaction = async <T,>(fn: () => Promise<T>): Promise<T> => {
      if (transactionDepth > 0) return fn();
      let result: T;
      transactionDepth += 1;
      try {
        await db.withTransactionAsync(async () => {
          result = await fn();
        });
      } finally {
        transactionDepth -= 1;
      }
      return result!;
    };

    const businessTable = new SqliteTable<Business>(db, 'business');
    this.business = {
      async create(input) {
        const row: Business = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          allow_negative_stock: input.allow_negative_stock ?? 0,
          last_backup_at: input.last_backup_at ?? null,
          ...input,
        };
        await businessTable.insert(row);
        return row;
      },
      getById: (id) => businessTable.getById(id),
      update: (id, patch) => businessTable.update(id, patch),
    };

    const employeeTable = new SqliteTable<Employee>(db, 'employee');
    this.employees = {
      async create(input) {
        const row: Employee = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          is_active: input.is_active ?? 1,
          deleted_at: input.deleted_at ?? null,
          fcm_token: input.fcm_token ?? null,
          ...input,
        };
        await employeeTable.insert(row);
        return row;
      },
      getById: (id) => employeeTable.getById(id),
      getByFirebaseUid: async (uid) => {
        const rows = await employeeTable.list('firebase_uid = ?', [uid]);
        return rows[0] ?? null;
      },
      listByBusiness: (businessId, opts) =>
        employeeTable.list(
          opts?.includeInactive ? 'business_id = ?' : 'business_id = ? AND is_active = 1',
          [businessId],
        ),
      update: (id, patch) => employeeTable.update(id, patch),
      softDelete: (id) => employeeTable.update(id, { is_active: 0, deleted_at: nowIso() }),
    };

    const productTable = new SqliteTable<Product>(db, 'product');
    this.products = {
      async create(input) {
        const row: Product = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          is_active: input.is_active ?? 1,
          deleted_at: input.deleted_at ?? null,
          category: input.category ?? null,
          description: input.description ?? null,
          unit: input.unit ?? 'adet',
          is_purchasable: input.is_purchasable ?? 1,
          ...input,
        };
        await productTable.insert(row);
        return row;
      },
      getById: (id) => productTable.getById(id),
      listByBusiness: (businessId, opts) =>
        productTable.list(
          opts?.includeInactive ? 'business_id = ?' : 'business_id = ? AND is_active = 1',
          [businessId],
        ),
      update: (id, patch) => productTable.update(id, patch),
      softDelete: (id) => productTable.update(id, { is_active: 0, deleted_at: nowIso() }),
    };

    const variantTable = new SqliteTable<ProductVariant>(db, 'product_variant');
    this.productVariants = {
      async create(input) {
        const row: ProductVariant = {
          id: newId(),
          is_active: input.is_active ?? 1,
          barcode: input.barcode ?? null,
          cost_price_minor: input.cost_price_minor ?? null,
          price_minor: input.price_minor ?? null,
          image_uri: input.image_uri ?? null,
          ...input,
        };
        await variantTable.insert(row);
        return row;
      },
      getById: (id) => variantTable.getById(id),
      listByProduct: (productId, opts) =>
        variantTable.list(
          opts?.includeInactive ? 'product_id = ?' : 'product_id = ? AND is_active = 1',
          [productId],
        ),
      update: (id, patch) => variantTable.update(id, patch),
      deactivate: (id) => variantTable.update(id, { is_active: 0 }),
      remove: async (id) => {
        await db.runAsync('DELETE FROM product_variant WHERE id = ?', [id]);
      },
    };

    const attributeTable = new SqliteTable<Attribute>(db, 'attribute');
    this.attributes = {
      async create(input) {
        const row: Attribute = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          is_system: input.is_system ?? 0,
          unit_label: input.unit_label ?? null,
          ...input,
        };
        await attributeTable.insert(row);
        return row;
      },
      getById: (id) => attributeTable.getById(id),
      listByBusiness: (businessId) => attributeTable.list('business_id = ?', [businessId]),
    };

    const attributeOptionTable = new SqliteTable<AttributeOption>(db, 'attribute_option');
    this.attributeOptions = {
      async create(input) {
        const row: AttributeOption = {
          id: newId(),
          sku_token: input.sku_token ?? null,
          swatch_hex: input.swatch_hex ?? null,
          position: input.position ?? 0,
          ...input,
        };
        await attributeOptionTable.insert(row);
        return row;
      },
      listByAttribute: (attributeId) => attributeOptionTable.list('attribute_id = ?', [attributeId]),
      getByValue: async (attributeId, value) => {
        const rows = await attributeOptionTable.list('attribute_id = ? AND value = ?', [attributeId, value]);
        return rows[0] ?? null;
      },
    };

    const variantAttributeTable = new SqliteTable<VariantAttribute>(db, 'variant_attribute', 'variant_id');
    this.variantAttributes = {
      async create(input) {
        // Upsert-by-(variant_id, attribute_id) — table.ts's generic
        // insert()/update() are id-keyed by a single column, which doesn't
        // fit this table's composite PK, so this goes around it with a
        // plain REPLACE (same effect: PK conflict overwrites in place).
        await db.runAsync(
          'INSERT OR REPLACE INTO variant_attribute (variant_id, attribute_id, option_id, value_text, value_number) VALUES (?, ?, ?, ?, ?)',
          [input.variant_id, input.attribute_id, input.option_id, input.value_text, input.value_number],
        );
        return input;
      },
      listByVariant: (variantId) => variantAttributeTable.list('variant_id = ?', [variantId]),
      listByProduct: (productId) =>
        db.getAllAsync<VariantAttribute>(
          'SELECT va.* FROM variant_attribute va JOIN product_variant pv ON pv.id = va.variant_id WHERE pv.product_id = ?',
          [productId],
        ),
    };

    const axisPresetTable = new SqliteTable<AxisPreset>(db, 'axis_preset');
    this.axisPresets = {
      async create(input) {
        const row: AxisPreset = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          use_count: input.use_count ?? 0,
          last_used_at: input.last_used_at ?? null,
          ...input,
        };
        await axisPresetTable.insert(row);
        return row;
      },
      listByBusiness: (businessId) => axisPresetTable.list('business_id = ?', [businessId]),
      recordUse: async (id) => {
        const preset = await axisPresetTable.getById(id);
        if (!preset) return;
        await axisPresetTable.update(id, { use_count: preset.use_count + 1, last_used_at: nowIso() });
      },
    };

    const stockMovementTable = new SqliteTable<StockMovement>(db, 'stock_movement');
    this.stockMovements = {
      async create(input) {
        const row: StockMovement = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          related_order_id: input.related_order_id ?? null,
          related_purchase_id: input.related_purchase_id ?? null,
          ...input,
        };
        await stockMovementTable.insert(row);
        return row;
      },
      getById: (id) => stockMovementTable.getById(id),
      listByVariant: (variantId) =>
        stockMovementTable.list('variant_id = ? ORDER BY created_at ASC', [variantId]),
      listByBusiness: (businessId) =>
        stockMovementTable.list('business_id = ? ORDER BY created_at DESC', [businessId]),
      listByPurchase: (purchaseId) =>
        stockMovementTable.list('related_purchase_id = ? ORDER BY created_at ASC', [purchaseId]),
      listByOrder: (orderId) =>
        stockMovementTable.list('related_order_id = ? ORDER BY created_at ASC', [orderId]),
      // No update/delete method exists here — see StockMovementRepository's
      // doc comment in types.ts.
    };

    const stockLevelTable = new SqliteTable<StockLevel>(db, 'stock_level', 'variant_id');
    this.stockLevels = {
      get: (variantId) => stockLevelTable.getById(variantId),
      async upsert(row) {
        const existing = await stockLevelTable.getById(row.variant_id);
        if (existing) {
          await stockLevelTable.update(row.variant_id, row);
        } else {
          await stockLevelTable.insert(row);
        }
      },
    };

    const taskTable = new SqliteTable<Task>(db, 'task');
    this.tasks = {
      async create(input) {
        const row: Task = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          status: input.status ?? 'todo',
          deleted_at: input.deleted_at ?? null,
          ...input,
        };
        await taskTable.insert(row);
        return row;
      },
      getById: (id) => taskTable.getById(id),
      listByBusiness: (businessId) => taskTable.list('business_id = ? AND deleted_at IS NULL', [businessId]),
      listByAssignee: (assigneeId) => taskTable.list('assignee_id = ?', [assigneeId]),
      updateStatus: (id, status) => taskTable.update(id, { status }),
      update: (id, patch) => taskTable.update(id, patch),
      softDelete: (id) => taskTable.update(id, { deleted_at: nowIso() }),
    };

    const shiftTable = new SqliteTable<Shift>(db, 'shift');
    this.shifts = {
      async create(input) {
        const row: Shift = { id: newId(), ...input };
        await shiftTable.insert(row);
        return row;
      },
      getById: (id) => shiftTable.getById(id),
      listByEmployee: (employeeId) => shiftTable.list('employee_id = ? ORDER BY date DESC', [employeeId]),
      listByBusiness: (businessId) => shiftTable.list('business_id = ? ORDER BY date DESC', [businessId]),
    };

    const expenseTable = new SqliteTable<ExpenseEntry>(db, 'expense_entry');
    this.expenses = {
      async create(input) {
        const row: ExpenseEntry = {
          id: newId(),
          deleted_at: input.deleted_at ?? null,
          related_order_id: input.related_order_id ?? null,
          related_purchase_id: input.related_purchase_id ?? null,
          related_customer_id: input.related_customer_id ?? null,
          related_employee_id: input.related_employee_id ?? null,
          related_account_id: input.related_account_id ?? null,
          ...input,
          cari_excluded: input.cari_excluded ?? 0,
        };
        await expenseTable.insert(row);
        return row;
      },
      getById: (id) => expenseTable.getById(id),
      listByPurchase: (purchaseId) => expenseTable.list('related_purchase_id = ? AND deleted_at IS NULL ORDER BY date ASC', [purchaseId]),
      // deleted_at IS NULL — a voided/soft-deleted gider must not keep
      // counting toward Money's Bu Ay Gider/Net, Son Kayıtlar, or category
      // breakdowns (same rule Order/Purchase already apply to themselves).
      listByBusiness: (businessId, opts) => {
        if (opts?.from && opts?.to) {
          return expenseTable.list('business_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date DESC', [
            businessId,
            opts.from,
            opts.to,
          ]);
        }
        return expenseTable.list('business_id = ? AND deleted_at IS NULL ORDER BY date DESC', [businessId]);
      },
      update: (id, patch) => expenseTable.update(id, patch),
      softDelete: (id) => expenseTable.update(id, { deleted_at: nowIso() }),
    };

    const revenueTable = new SqliteTable<RevenueEntry>(db, 'revenue_entry');
    this.revenues = {
      async create(input) {
        const row: RevenueEntry = {
          id: newId(),
          deleted_at: input.deleted_at ?? null,
          related_order_id: input.related_order_id ?? null,
          related_customer_id: input.related_customer_id ?? null,
          related_employee_id: input.related_employee_id ?? null,
          related_account_id: input.related_account_id ?? null,
          ...input,
          category: input.category ?? null,
          cari_excluded: input.cari_excluded ?? 0,
        };
        await revenueTable.insert(row);
        return row;
      },
      getById: (id) => revenueTable.getById(id),
      // deleted_at IS NULL — mirrors the expense fix above: a voided gelir
      // must drop out of Money's totals/Son Kayıtlar just like a voided
      // gider does.
      listByBusiness: (businessId, opts) => {
        if (opts?.from && opts?.to) {
          return revenueTable.list('business_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date DESC', [
            businessId,
            opts.from,
            opts.to,
          ]);
        }
        return revenueTable.list('business_id = ? AND deleted_at IS NULL ORDER BY date DESC', [businessId]);
      },
      listByOrder: (orderId) => revenueTable.list('related_order_id = ? AND deleted_at IS NULL ORDER BY date ASC', [orderId]),
      update: (id, patch) => revenueTable.update(id, patch),
      softDelete: (id) => revenueTable.update(id, { deleted_at: nowIso() }),
    };

    const checkTable = new SqliteTable<Check>(db, 'check_entry');
    this.checks = {
      async create(input) {
        const row: Check = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          deleted_at: input.deleted_at ?? null,
          ...input,
        };
        await checkTable.insert(row);
        return row;
      },
      getById: (id) => checkTable.getById(id),
      // deleted_at IS NULL — a check tied to a voided gelir/gider entry
      // must not keep showing as pending/upcoming-due.
      listByBusiness: (businessId) => checkTable.list('business_id = ? AND deleted_at IS NULL ORDER BY due_date ASC', [businessId]),
      listPendingDueBefore: (businessId, isoDate) =>
        checkTable.list("business_id = ? AND status = 'pending' AND due_date <= ? AND deleted_at IS NULL ORDER BY due_date ASC", [
          businessId,
          isoDate,
        ]),
      async getByRelatedEntry(entryId, entryType) {
        const rows = await checkTable.list('related_entry_id = ? AND related_entry_type = ? AND deleted_at IS NULL', [entryId, entryType]);
        return rows[0] ?? null;
      },
      updateStatus: (id, status) => checkTable.update(id, { status }),
      softDelete: (id) => checkTable.update(id, { deleted_at: nowIso() }),
    };

    const customerTable = new SqliteTable<Customer>(db, 'customer');
    this.customers = {
      async create(input) {
        const row: Customer = {
          id: newId(),
          is_active: input.is_active ?? 1,
          deleted_at: input.deleted_at ?? null,
          ...input,
          currency: input.currency ?? null,
        };
        await customerTable.insert(row);
        return row;
      },
      getById: (id) => customerTable.getById(id),
      listByBusiness: (businessId, opts) =>
        customerTable.list(
          opts?.includeInactive ? 'business_id = ?' : 'business_id = ? AND is_active = 1',
          [businessId],
        ),
      update: (id, patch) => customerTable.update(id, patch),
      softDelete: (id) => customerTable.update(id, { is_active: 0, deleted_at: nowIso() }),
    };

    const accountTable = new SqliteTable<Account>(db, 'account');
    this.accounts = {
      async create(input) {
        const row: Account = {
          id: newId(),
          note: input.note ?? null,
          is_active: input.is_active ?? 1,
          created_at: input.created_at ?? nowIso(),
          deleted_at: input.deleted_at ?? null,
          ...input,
          currency: input.currency ?? null,
        };
        await accountTable.insert(row);
        return row;
      },
      getById: (id) => accountTable.getById(id),
      listByBusiness: (businessId, opts) =>
        accountTable.list(
          opts?.includeInactive ? 'business_id = ?' : 'business_id = ? AND is_active = 1',
          [businessId],
        ),
      update: (id, patch) => accountTable.update(id, patch),
      softDelete: (id) => accountTable.update(id, { is_active: 0, deleted_at: nowIso() }),
    };

    const orderTable = new SqliteTable<Order>(db, '"order"');
    this.orders = {
      async create(input) {
        const row: Order = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          status: input.status ?? 'draft',
          note: input.note ?? null,
          delivery_date: input.delivery_date ?? null,
          deleted_at: input.deleted_at ?? null,
          ...input,
          gross_total_minor: input.gross_total_minor ?? 0,
          discount_type: input.discount_type ?? null,
          discount_value: input.discount_value ?? 0,
          discount_amount_minor: input.discount_amount_minor ?? 0,
          net_total_minor: input.net_total_minor ?? 0,
        };
        await orderTable.insert(row);
        return row;
      },
      getById: (id) => orderTable.getById(id),
      // deleted_at IS NULL — soft-deleted (rejected draft) orders must not
      // resurface in any listing (Bugün queue, Workflow, Siparişler screen).
      listByBusiness: (businessId) => orderTable.list('business_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', [businessId]),
      listByCustomer: (customerId) => orderTable.list('customer_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', [customerId]),
      updateStatus: (id, status) => orderTable.update(id, { status }),
      updateNote: (id, note) => orderTable.update(id, { note }),
      updateDeliveryDate: (id, deliveryDate) => orderTable.update(id, { delivery_date: deliveryDate }),
      updateTotals: (id, totals) => orderTable.update(id, totals),
      softDelete: (id) => orderTable.update(id, { deleted_at: nowIso() }),
    };

    const orderLineTable = new SqliteTable<OrderLine>(db, 'order_line');
    this.orderLines = {
      async create(input) {
        const row: OrderLine = { id: newId(), ...input, line_group_id: input.line_group_id ?? null };
        await orderLineTable.insert(row);
        return row;
      },
      listByOrder: (orderId) => orderLineTable.list('order_id = ?', [orderId]),
      update: (id, patch) => orderLineTable.update(id, patch),
      remove: async (id) => {
        await db.runAsync('DELETE FROM order_line WHERE id = ?', [id]);
      },
      removeByOrder: async (orderId) => {
        await db.runAsync('DELETE FROM order_line WHERE order_id = ?', [orderId]);
      },
      countByVariant: async (variantId) => {
        const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM order_line WHERE variant_id = ?', [variantId]);
        return row?.n ?? 0;
      },
    };

    const cariTable = new SqliteTable<CariMovement>(db, 'cari_movement');
    this.cariMovements = {
      async create(input) {
        const stamp = input.created_at ?? nowIso();
        const row: CariMovement = {
          id: newId(),
          ...input,
          exchange_rate: input.exchange_rate ?? null,
          source_id: input.source_id ?? null,
          reverses_id: input.reverses_id ?? null,
          reason: input.reason ?? null,
          created_at: stamp,
          updated_at: input.updated_at ?? stamp,
          deleted_at: null,
        };
        await cariTable.insert(row);
        return row;
      },
      getById: (id) => cariTable.getById(id),
      listByContact: (contactType, contactId) =>
        cariTable.list('contact_type = ? AND contact_id = ? AND deleted_at IS NULL ORDER BY movement_date DESC, created_at DESC', [contactType, contactId]),
      listBySource: (sourceType, sourceId) =>
        cariTable.list('source_type = ? AND source_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [sourceType, sourceId]),
      listByBusiness: (businessId) => cariTable.list('business_id = ? AND deleted_at IS NULL ORDER BY movement_date DESC, created_at DESC', [businessId]),
    };

    const orderLineGroupTable = new SqliteTable<OrderLineGroup>(db, 'order_line_group');
    this.orderLineGroups = {
      async create(input) {
        const row: OrderLineGroup = {
          id: newId(),
          ...input,
          assortment_pattern: input.assortment_pattern ?? null,
          assortment_sets: input.assortment_sets ?? null,
        };
        await orderLineGroupTable.insert(row);
        return row;
      },
      listByOrder: (orderId) => orderLineGroupTable.list('order_id = ?', [orderId]),
      removeByOrder: async (orderId) => {
        await db.runAsync('DELETE FROM order_line_group WHERE order_id = ?', [orderId]);
      },
    };

    const assortmentPatternTable = new SqliteTable<AssortmentPattern>(db, 'assortment_pattern');
    this.assortmentPatterns = {
      async create(input) {
        const row: AssortmentPattern = {
          id: newId(),
          ...input,
          created_at: input.created_at ?? nowIso(),
          deleted_at: input.deleted_at ?? null,
          customer_id: input.customer_id ?? null,
        };
        await assortmentPatternTable.insert(row);
        return row;
      },
      listByBusiness: (businessId) => assortmentPatternTable.list('business_id = ? AND deleted_at IS NULL ORDER BY created_at', [businessId]),
      softDelete: (id) => assortmentPatternTable.update(id, { deleted_at: nowIso() }),
    };

    const purchaseTable = new SqliteTable<Purchase>(db, 'purchase');
    this.purchases = {
      async create(input) {
        const createdAt = input.created_at ?? nowIso();
        const row: Purchase = {
          id: newId(),
          created_at: createdAt,
          updated_at: input.updated_at ?? createdAt,
          status: input.status ?? 'draft',
          purchase_date: input.purchase_date ?? createdAt,
          is_received: input.is_received ?? 0,
          received_at: input.received_at ?? null,
          note: input.note ?? null,
          deleted_at: input.deleted_at ?? null,
          ...input,
        };
        await purchaseTable.insert(row);
        return row;
      },
      getById: (id) => purchaseTable.getById(id),
      listByBusiness: (businessId) => purchaseTable.list('business_id = ? AND deleted_at IS NULL ORDER BY purchase_date DESC, created_at DESC', [businessId]),
      listByAccount: (accountId) => purchaseTable.list('account_id = ? AND deleted_at IS NULL ORDER BY purchase_date DESC, created_at DESC', [accountId]),
      update: (id, patch) => purchaseTable.update(id, { ...patch, updated_at: nowIso() }),
      softDelete: (id) => purchaseTable.update(id, { deleted_at: nowIso(), updated_at: nowIso() }),
    };

    const purchaseLineTable = new SqliteTable<PurchaseLine>(db, 'purchase_line');
    this.purchaseLines = {
      async create(input) {
        const row: PurchaseLine = {
          id: newId(),
          material_id: input.material_id ?? null,
          variant_id: input.variant_id ?? null,
          line_group_id: input.line_group_id ?? null,
          note: input.note ?? null,
          ...input,
        };
        await purchaseLineTable.insert(row);
        return row;
      },
      listByPurchase: (purchaseId) => purchaseLineTable.list('purchase_id = ?', [purchaseId]),
      removeByPurchase: async (purchaseId) => {
        await db.runAsync('DELETE FROM purchase_line WHERE purchase_id = ?', [purchaseId]);
      },
      countByVariant: async (variantId) => {
        const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM purchase_line WHERE variant_id = ?', [variantId]);
        return row?.n ?? 0;
      },
    };

    const materialTable = new SqliteTable<Material>(db, 'material');
    this.materials = {
      async create(input) {
        const createdAt = input.created_at ?? nowIso();
        const row: Material = {
          id: newId(),
          description: input.description ?? null,
          category: input.category ?? null,
          stock_quantity: input.stock_quantity ?? 0,
          status: input.status ?? 'active',
          created_at: createdAt,
          updated_at: input.updated_at ?? createdAt,
          deleted_at: input.deleted_at ?? null,
          ...input,
        };
        await materialTable.insert(row);
        return row;
      },
      getById: (id) => materialTable.getById(id),
      listByBusiness: (businessId, opts) =>
        materialTable.list(
          opts?.includeArchived ? 'business_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE' : "business_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY name COLLATE NOCASE",
          [businessId],
        ),
      update: (id, patch) => materialTable.update(id, { ...patch, updated_at: nowIso() }),
      applyStockDelta: async (id, delta) => {
        await db.runAsync('UPDATE material SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?', [delta, nowIso(), id]);
      },
    };

    const materialMovementTable = new SqliteTable<MaterialMovement>(db, 'material_movement');
    this.materialMovements = {
      async create(input) {
        const row: MaterialMovement = {
          id: newId(),
          created_at: input.created_at ?? nowIso(),
          reason: input.reason ?? null,
          related_purchase_id: input.related_purchase_id ?? null,
          ...input,
        };
        await materialMovementTable.insert(row);
        return row;
      },
      listByMaterial: (materialId) => materialMovementTable.list('material_id = ? ORDER BY created_at ASC', [materialId]),
      listByPurchase: (purchaseId) => materialMovementTable.list('related_purchase_id = ? ORDER BY created_at ASC', [purchaseId]),
    };
  }

  static async create(): Promise<SqliteRepository> {
    const db = await getDb();
    return new SqliteRepository(db);
  }
}
