// Migrations for the local SQLite database (CLAUDE.md §4). Each entry is a
// numbered, one-way step; the runner (client.ts) applies whichever ones
// haven't run yet, tracked in `_migrations`. Never edit a migration that has
// shipped — add a new one instead, same as any other SQLite/libSQL project.
//
// FKs use `ON DELETE RESTRICT` implicitly (SQLite's default) — this schema
// never hard-deletes (§4/§8), so cascading deletes are never the right
// behavior here; a row goes inactive via `is_active`/`deleted_at`, not gone.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE business (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_currency TEXT NOT NULL,
        plan_tier TEXT NOT NULL CHECK (plan_tier IN ('solo','team')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE employee (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        firebase_uid TEXT,
        display_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        role TEXT NOT NULL CHECK (role IN ('owner','manager','production','sales','viewer')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_employee_business ON employee(business_id);
      CREATE UNIQUE INDEX idx_employee_firebase_uid ON employee(firebase_uid) WHERE firebase_uid IS NOT NULL;

      CREATE TABLE product (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        name TEXT NOT NULL,
        sku TEXT NOT NULL,
        base_price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_product_business ON product(business_id);
      CREATE UNIQUE INDEX idx_product_business_sku ON product(business_id, sku);

      CREATE TABLE product_variant (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES product(id),
        attributes TEXT NOT NULL DEFAULT '{}',
        sku TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
      );
      CREATE INDEX idx_variant_product ON product_variant(product_id);
      CREATE UNIQUE INDEX idx_variant_sku ON product_variant(sku);

      -- Append-only ledger — no UPDATE/DELETE in the Repository contract (§5.1).
      CREATE TABLE stock_movement (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        variant_id TEXT NOT NULL REFERENCES product_variant(id),
        type TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
        quantity INTEGER NOT NULL,
        reason TEXT,
        note TEXT,
        related_order_id TEXT,
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_stock_movement_business ON stock_movement(business_id);
      CREATE INDEX idx_stock_movement_variant ON stock_movement(variant_id, created_at);

      -- Fast-access running balance (§4 note). Kept in sync by the service
      -- layer on every stock_movement insert — not derived by a trigger, so
      -- the negative-stock guard (§5.1) can run in application code first.
      CREATE TABLE stock_level (
        variant_id TEXT PRIMARY KEY REFERENCES product_variant(id),
        on_hand INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE task (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        title TEXT NOT NULL,
        description TEXT,
        assignee_id TEXT NOT NULL REFERENCES employee(id),
        status TEXT NOT NULL CHECK (status IN ('todo','in_progress','done')),
        due_date TEXT,
        related_order_id TEXT,
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_task_business ON task(business_id);
      CREATE INDEX idx_task_assignee ON task(assignee_id);

      CREATE TABLE shift (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        employee_id TEXT NOT NULL REFERENCES employee(id),
        date TEXT NOT NULL,
        note TEXT
      );
      CREATE INDEX idx_shift_business ON shift(business_id);
      CREATE INDEX idx_shift_employee ON shift(employee_id, date);

      CREATE TABLE expense_entry (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        category TEXT NOT NULL CHECK (category IN ('raw_material','rent','labor','shipping','other')),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        related_order_id TEXT,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','credit_card','check')),
        created_by TEXT NOT NULL REFERENCES employee(id),
        deleted_at TEXT
      );
      CREATE INDEX idx_expense_business ON expense_entry(business_id, date);

      CREATE TABLE revenue_entry (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        source TEXT NOT NULL CHECK (source IN ('order','manual')),
        related_order_id TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','credit_card','check')),
        created_by TEXT NOT NULL REFERENCES employee(id),
        deleted_at TEXT
      );
      CREATE INDEX idx_revenue_business ON revenue_entry(business_id, date);

      CREATE TABLE check_entry (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        direction TEXT NOT NULL CHECK (direction IN ('received','issued')),
        related_entry_id TEXT NOT NULL,
        related_entry_type TEXT NOT NULL CHECK (related_entry_type IN ('ExpenseEntry','RevenueEntry')),
        check_number TEXT,
        bank_name TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','cleared','bounced','cashed')),
        note TEXT,
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_check_business ON check_entry(business_id);
      CREATE INDEX idx_check_due_date ON check_entry(due_date) WHERE status = 'pending';

      -- Faz 2 seed tables — manual entry only in Faz 1 (source always 'manual').
      CREATE TABLE customer (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        name TEXT NOT NULL,
        primary_channel TEXT,
        contact_ref TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        deleted_at TEXT
      );
      CREATE INDEX idx_customer_business ON customer(business_id);

      CREATE TABLE "order" (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        customer_id TEXT NOT NULL REFERENCES customer(id),
        status TEXT NOT NULL CHECK (status IN ('draft','confirmed','in_production','ready','shipped')),
        source TEXT NOT NULL CHECK (source IN ('manual','nlp')),
        currency TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_order_business ON "order"(business_id);
      CREATE INDEX idx_order_customer ON "order"(customer_id);

      CREATE TABLE order_line (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES "order"(id),
        variant_id TEXT NOT NULL REFERENCES product_variant(id),
        quantity INTEGER NOT NULL,
        unit_price_minor INTEGER NOT NULL
      );
      CREATE INDEX idx_order_line_order ON order_line(order_id);
    `,
  },
  {
    // §7.2: "FCM: cihaz token'ı Employee ile eşlenir." No column for this
    // existed in the §4 schema table as written — the spec's own §7
    // integration notes require it, so this migration adds it rather than
    // treating the §4 table as the final word.
    version: 2,
    name: 'employee_fcm_token',
    sql: `ALTER TABLE employee ADD COLUMN fcm_token TEXT;`,
  },
  {
    // §5.1: "işletme ayarıyla negatife izin ver açılabilir." Same situation
    // as migration 2 — the setting is named in the business rules but has
    // no column in §4's table.
    version: 3,
    name: 'business_allow_negative_stock',
    // No CHECK constraint here (unlike other 0/1 columns in migration 1) —
    // SQLite's ALTER TABLE ADD COLUMN doesn't reliably support adding one;
    // 0/1 is enforced in application code instead (see StockService).
    sql: `ALTER TABLE business ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // §7.3/§9 step 8: BackupService needs somewhere to record when the last
    // encrypted backup succeeded (surfaced in the Profil screen). Same
    // "named in the spec's prose, not in §4's literal table" situation as
    // migrations 2 and 3.
    version: 4,
    name: 'business_last_backup_at',
    sql: `ALTER TABLE business ADD COLUMN last_backup_at TEXT;`,
  },
  {
    // Manual draft order screen needs a free-text place for order-specific
    // notes/details (e.g. "sol ayak 1 numara büyük olsun") — not in §4's
    // literal table, same situation as migrations 2-4.
    version: 5,
    name: 'order_note',
    sql: `ALTER TABLE "order" ADD COLUMN note TEXT;`,
  },
  {
    // Shift picker UX: pick a start hour + "tam mesai (8s) / yarım mesai
    // (4s)" instead of typing a free-text date string. §5.3 only names
    // "tarih + not" but doesn't forbid a duration — same "spec's prose
    // doesn't have a column for it yet" situation as migrations 2-5.
    // Defaults existing rows to a full 8-hour shift.
    version: 6,
    name: 'shift_duration_hours',
    sql: `ALTER TABLE shift ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 8;`,
  },
  {
    // Product/variant schema reorganized for real ERP use — see
    // product-schema.md at the repo root for the full rationale (category,
    // cost price for margin reporting, barcode, structured size/color,
    // per-variant price override, and business_id denormalized onto
    // product_variant so it's indexable/queryable like every other child
    // table already is).
    //
    // At the user's explicit direction, this is a destructive reset rather
    // than a backfill migration: everything downstream of the old
    // product/product_variant shape (movements, levels, order lines,
    // orders, customers, tasks, shifts, finance entries) is wiped instead
    // of being coerced into the new columns — there's nothing but test
    // data on any device this runs on, and hand-writing migration logic to
    // preserve it isn't worth the complexity it'd add for Faz 2. `business`
    // and `employee` (tenant/auth identity) are deliberately left alone so
    // nobody has to sign in or re-create the business again.
    version: 7,
    name: 'product_schema_v2_reset',
    sql: `
      DELETE FROM order_line;
      DELETE FROM stock_movement;
      DELETE FROM stock_level;
      DELETE FROM "order";
      DELETE FROM customer;
      DELETE FROM task;
      DELETE FROM shift;
      DELETE FROM expense_entry;
      DELETE FROM revenue_entry;
      DELETE FROM check_entry;
      DELETE FROM product_variant;
      DELETE FROM product;

      DROP TABLE product_variant;
      DROP TABLE product;

      CREATE TABLE product (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        name TEXT NOT NULL,
        sku TEXT NOT NULL,
        category TEXT,
        description TEXT,
        unit TEXT NOT NULL DEFAULT 'adet',
        base_price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_product_business ON product(business_id);
      CREATE INDEX idx_product_category ON product(business_id, category);
      CREATE UNIQUE INDEX idx_product_business_sku ON product(business_id, sku);

      CREATE TABLE product_variant (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES product(id),
        business_id TEXT NOT NULL REFERENCES business(id),
        sku TEXT NOT NULL,
        barcode TEXT,
        size TEXT,
        color TEXT,
        attributes TEXT NOT NULL DEFAULT '{}',
        cost_price_minor INTEGER,
        price_minor INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
      );
      CREATE INDEX idx_variant_product ON product_variant(product_id);
      CREATE UNIQUE INDEX idx_variant_business_sku ON product_variant(business_id, sku);
      CREATE UNIQUE INDEX idx_variant_barcode ON product_variant(business_id, barcode) WHERE barcode IS NOT NULL;

      ALTER TABLE stock_level ADD COLUMN reorder_quantity INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // General ledger linking (product feedback): a Gelir/Gider entry on the
    // Money screen needs to be attributable to *someone* the same way an
    // order line is attributable to a customer — a subcontractor paid for
    // materials, a customer's payment that isn't tied to any one order, an
    // employee reimbursement. `account` is a new, deliberately minimal
    // entity for the third case: any external party that's neither an
    // existing `customer` (order-bound) nor an `employee` (auth/RBAC-bound)
    // — a supplier, a subcontractor, a landlord. `revenue_entry` and
    // `expense_entry` each get three new nullable FKs, at most one of which
    // is ever set on a given row (enforced in FinanceService, not a DB
    // constraint — same "business rules live in the service layer" split as
    // everywhere else in this schema).
    version: 8,
    name: 'finance_entry_party_links',
    sql: `
      CREATE TABLE account (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        name TEXT NOT NULL,
        note TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_account_business ON account(business_id);

      ALTER TABLE revenue_entry ADD COLUMN related_customer_id TEXT REFERENCES customer(id);
      ALTER TABLE revenue_entry ADD COLUMN related_employee_id TEXT REFERENCES employee(id);
      ALTER TABLE revenue_entry ADD COLUMN related_account_id TEXT REFERENCES account(id);

      ALTER TABLE expense_entry ADD COLUMN related_customer_id TEXT REFERENCES customer(id);
      ALTER TABLE expense_entry ADD COLUMN related_employee_id TEXT REFERENCES employee(id);
      ALTER TABLE expense_entry ADD COLUMN related_account_id TEXT REFERENCES account(id);
    `,
  },
  {
    // Purchasing module (product feedback): the mirror of Order/OrderLine
    // for materials/stock bought FROM a subcontractor or supplier (an
    // `account` row) instead of sold TO a customer. `purchase.status`
    // reaching 'received' is the buying-side equivalent of an order
    // reaching 'shipped' — it moves stock (an 'in' StockMovement per line)
    // — and, same as Order, never books money on its own; a Purchase's
    // payments are recorded separately via ExpenseEntry.related_purchase_id.
    version: 9,
    name: 'purchasing_module',
    sql: `
      CREATE TABLE purchase (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        account_id TEXT NOT NULL REFERENCES account(id),
        status TEXT NOT NULL CHECK (status IN ('draft','ordered','received')),
        currency TEXT NOT NULL,
        note TEXT,
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_purchase_business ON purchase(business_id);
      CREATE INDEX idx_purchase_account ON purchase(account_id);

      CREATE TABLE purchase_line (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL REFERENCES purchase(id),
        variant_id TEXT NOT NULL REFERENCES product_variant(id),
        quantity INTEGER NOT NULL,
        unit_cost_minor INTEGER NOT NULL
      );
      CREATE INDEX idx_purchase_line_purchase ON purchase_line(purchase_id);

      ALTER TABLE expense_entry ADD COLUMN related_purchase_id TEXT REFERENCES purchase(id);
      ALTER TABLE stock_movement ADD COLUMN related_purchase_id TEXT REFERENCES purchase(id);
    `,
  },
  {
    // Variant photo (product feedback): a variant's existing `barcode`
    // already gets a generated karekod for scan-to-add in manual orders
    // (rendered on the fly from the barcode string, nothing to store for
    // that half); this is the other half — one photo per variant, stored as
    // a file copied into the persistent document directory (never the cache
    // dir — CLAUDE.md §3/§8) and referenced here by its `file://` URI. Doubles
    // as the thumbnail for a future customer-facing teklif sayfası.
    version: 10,
    name: 'product_variant_image',
    sql: `
      ALTER TABLE product_variant ADD COLUMN image_uri TEXT;
    `,
  },
  {
    // Order delivery date (product feedback): a promised hand-off/ship date,
    // separate from `status` (CLAUDE.md's money/status-decoupling reasoning
    // extends here too — an order can be confirmed today and due in three
    // weeks; the date is a plan, not a status transition). Date-only, no
    // time-of-day — same DatePicker already used for Mesai's shift date
    // (tasks.tsx), stored as an ISO date string picked at local midnight.
    version: 11,
    name: 'order_delivery_date',
    sql: `ALTER TABLE "order" ADD COLUMN delivery_date TEXT;`,
  },
  {
    // Eksen tabanlı (attribute-based) varyant sistemi — product feedback.
    // `size`/`color` stop being privileged columns and become just two
    // seed rows in a generic `attribute` table the user can extend
    // (Materyal, Boy (cm), Kaplama, ...), so a variant's identity is a
    // combination of arbitrary axes instead of a hardcoded pair.
    //
    // Single forward migration, same precedent as v7 ("product_schema_v2_reset"):
    // this runner has no rollback mechanism for ANY migration (see the
    // header comment at the top of this file), so — unlike the spec's own
    // 7-reversible-steps proposal — this does the seed → backfill → unique
    // index → column drop in one transaction. Real (non-destructive)
    // backfill this time, not a wipe: only two known legacy columns
    // (`size`, `color`), translated 1:1 into the new tables below before
    // being dropped.
    //
    // `attribute.business_id`/`axis_preset.business_id` seed one row PER
    // EXISTING business (not a single hardcoded id) so this is correct
    // whether the device has one business or, eventually, several. New
    // businesses created after this migration get the same two seed
    // attributes from SessionProvider.createBusiness() instead — this
    // migration only back-fills businesses that already existed.
    version: 12,
    name: 'variant_axis_system',
    sql: `
      CREATE TABLE attribute (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        data_type TEXT NOT NULL CHECK (data_type IN ('option','number','text')),
        unit_label TEXT,
        is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_attribute_business_code ON attribute(business_id, code);

      CREATE TABLE attribute_option (
        id TEXT PRIMARY KEY,
        attribute_id TEXT NOT NULL REFERENCES attribute(id),
        value TEXT NOT NULL,
        label TEXT NOT NULL,
        sku_token TEXT,
        swatch_hex TEXT,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX idx_attribute_option_value ON attribute_option(attribute_id, value);

      CREATE TABLE variant_attribute (
        variant_id TEXT NOT NULL REFERENCES product_variant(id),
        attribute_id TEXT NOT NULL REFERENCES attribute(id),
        option_id TEXT REFERENCES attribute_option(id),
        value_text TEXT,
        value_number REAL,
        PRIMARY KEY (variant_id, attribute_id)
      );
      CREATE INDEX idx_variant_attribute_attribute ON variant_attribute(attribute_id);

      CREATE TABLE axis_preset (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        name TEXT NOT NULL,
        definition TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_axis_preset_business ON axis_preset(business_id);

      -- Seed the two system axes for every business that already exists —
      -- one attribute row per business per axis, ids derived deterministically
      -- from the business id so this migration stays idempotent-in-spirit
      -- (re-running it, harmless in practice since migrations only run once,
      -- would still not collide with itself mid-run).
      INSERT INTO attribute (id, business_id, code, name, data_type, unit_label, is_system, created_at)
        SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
               id, 'color', 'Renk', 'option', NULL, 1, datetime('now')
        FROM business;
      INSERT INTO attribute (id, business_id, code, name, data_type, unit_label, is_system, created_at)
        SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
               id, 'size', 'Beden', 'option', NULL, 1, datetime('now')
        FROM business;

      -- Backfill: every distinct existing color/size value becomes an
      -- attribute_option row under that business's new 'color'/'size'
      -- attribute.
      INSERT INTO attribute_option (id, attribute_id, value, label, sku_token, swatch_hex, position)
        SELECT lower(hex(randomblob(16))), a.id, pv.color, pv.color, pv.color, NULL, 0
        FROM (SELECT DISTINCT business_id, color FROM product_variant WHERE color IS NOT NULL) pv
        JOIN attribute a ON a.business_id = pv.business_id AND a.code = 'color';
      INSERT INTO attribute_option (id, attribute_id, value, label, sku_token, swatch_hex, position)
        SELECT lower(hex(randomblob(16))), a.id, pv.size, pv.size, pv.size, NULL, 0
        FROM (SELECT DISTINCT business_id, size FROM product_variant WHERE size IS NOT NULL) pv
        JOIN attribute a ON a.business_id = pv.business_id AND a.code = 'size';

      -- variant_attribute rows linking each existing variant to its
      -- color/size option (only where that column was set).
      INSERT INTO variant_attribute (variant_id, attribute_id, option_id, value_text, value_number)
        SELECT pv.id, a.id, ao.id, NULL, NULL
        FROM product_variant pv
        JOIN attribute a ON a.business_id = pv.business_id AND a.code = 'color'
        JOIN attribute_option ao ON ao.attribute_id = a.id AND ao.value = pv.color
        WHERE pv.color IS NOT NULL;
      INSERT INTO variant_attribute (variant_id, attribute_id, option_id, value_text, value_number)
        SELECT pv.id, a.id, ao.id, NULL, NULL
        FROM product_variant pv
        JOIN attribute a ON a.business_id = pv.business_id AND a.code = 'size'
        JOIN attribute_option ao ON ao.attribute_id = a.id AND ao.value = pv.size
        WHERE pv.size IS NOT NULL;

      -- variant_key: 'color' sorts before 'size' alphabetically, so a
      -- variant with both is always "color=<x>|size=<y>", never the reverse.
      ALTER TABLE product_variant ADD COLUMN variant_key TEXT NOT NULL DEFAULT '';
      UPDATE product_variant SET variant_key =
        CASE
          WHEN color IS NOT NULL AND size IS NOT NULL THEN 'color=' || color || '|size=' || size
          WHEN color IS NOT NULL THEN 'color=' || color
          WHEN size IS NOT NULL THEN 'size=' || size
          ELSE ''
        END;

      -- The only DB-level guarantee that a combination can't be created
      -- twice within one product (spec §2/§7-8). If pre-existing test data
      -- happens to already contain a duplicate (size,color) pair on one
      -- product — nothing prevented that under the old schema — this
      -- statement fails loudly and the migration aborts; that pair must be
      -- deduplicated by hand before the app can start, same "test data
      -- only, safe to fix by hand or reset" situation migration 7 already
      -- established.
      CREATE UNIQUE INDEX idx_variant_key ON product_variant(product_id, variant_key);

      ALTER TABLE product_variant DROP COLUMN size;
      ALTER TABLE product_variant DROP COLUMN color;
    `,
  },
  {
    // Satın Almalar v2 — malzeme + ürün alımı (product feedback). Three
    // things change:
    //  1. `material` (+ its append-only `material_movement` ledger): a plain,
    //     axis-free table for raw inputs — deliberately NOT a flag on
    //     `product` (spec §6). `stock_quantity` is REAL (2,5 m²).
    //  2. `purchase` gains a real purchase_date + is_received/received_at
    //     ("Teslim alındı" toggle) — `status` stays (its CHECK can't be
    //     altered in place) and is kept in sync by PurchaseService.
    //  3. `purchase_line` is REBUILT (SQLite can't drop NOT NULL on
    //     variant_id in place): it now buys either a material or a variant,
    //     carries a REAL quantity, a unit snapshot, a stored line_total and
    //     a line_group_id for matrix-entered product lines. Nothing
    //     references purchase_line, so the rebuild is safe. Existing rows
    //     are carried over as 'product' lines.
    //
    // `product.is_purchasable` defaults to 1 so every existing product keeps
    // appearing in the purchase catalog until the user switches it off.
    version: 13,
    name: 'purchasing_materials_v2',
    sql: `
      CREATE TABLE material (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        name TEXT NOT NULL,
        description TEXT,
        unit TEXT NOT NULL,
        category TEXT,
        stock_quantity REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_material_business ON material(business_id);

      CREATE TABLE material_movement (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        material_id TEXT NOT NULL REFERENCES material(id),
        quantity REAL NOT NULL,
        reason TEXT,
        related_purchase_id TEXT REFERENCES purchase(id),
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_material_movement_material ON material_movement(material_id);
      CREATE INDEX idx_material_movement_purchase ON material_movement(related_purchase_id);

      ALTER TABLE product ADD COLUMN is_purchasable INTEGER NOT NULL DEFAULT 1 CHECK (is_purchasable IN (0,1));

      ALTER TABLE purchase ADD COLUMN purchase_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE purchase ADD COLUMN is_received INTEGER NOT NULL DEFAULT 0 CHECK (is_received IN (0,1));
      ALTER TABLE purchase ADD COLUMN received_at TEXT;
      ALTER TABLE purchase ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE purchase SET
        purchase_date = created_at,
        updated_at = created_at,
        is_received = CASE WHEN status = 'received' THEN 1 ELSE 0 END,
        received_at = CASE WHEN status = 'received' THEN created_at ELSE NULL END;

      CREATE TABLE purchase_line_v2 (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL REFERENCES purchase(id),
        line_type TEXT NOT NULL CHECK (line_type IN ('material','product')),
        material_id TEXT REFERENCES material(id),
        variant_id TEXT REFERENCES product_variant(id),
        quantity REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'adet',
        unit_cost_minor INTEGER NOT NULL DEFAULT 0,
        line_total_minor INTEGER NOT NULL DEFAULT 0,
        line_group_id TEXT,
        note TEXT,
        CHECK (
          (line_type = 'material' AND material_id IS NOT NULL AND variant_id IS NULL) OR
          (line_type = 'product' AND variant_id IS NOT NULL AND material_id IS NULL)
        )
      );
      INSERT INTO purchase_line_v2 (id, purchase_id, line_type, material_id, variant_id, quantity, unit, unit_cost_minor, line_total_minor, line_group_id, note)
        SELECT pl.id, pl.purchase_id, 'product', NULL, pl.variant_id, pl.quantity,
               COALESCE((SELECT p.unit FROM product_variant pv JOIN product p ON p.id = pv.product_id WHERE pv.id = pl.variant_id), 'adet'),
               pl.unit_cost_minor,
               CAST(ROUND(pl.quantity * pl.unit_cost_minor) AS INTEGER),
               NULL, NULL
        FROM purchase_line pl;
      DROP TABLE purchase_line;
      ALTER TABLE purchase_line_v2 RENAME TO purchase_line;
      CREATE INDEX idx_purchase_line_purchase ON purchase_line(purchase_id);
    `,
  },
  {
    // Manuel sipariş — ürün odaklı matris girişi (product feedback). Bir
    // sipariş satırı hâlâ DAİMA tek bir varyanttır; matris sadece arayüzdür.
    // Aynı matristen (= aynı ürün) üretilen satırlar ortak bir
    // `order_line.line_group_id` taşır → sipariş düzenlenirken matris geri
    // açılır, özet/çıktılarda ürün bazında gruplanır. Asorti ile girildiyse
    // desen + set adedi `order_line_group` üzerinde saklanır ("3 koli
    // asorti"). `assortment_pattern` kayıtlı desenlerdir ("1-2-2-2-1");
    // customer_id doluysa müşteriye özel, boşsa işletme geneli.
    // Mevcut order_line satırları line_group_id'siz kalır (NULL) — okuma
    // tarafı bunları ürün bazında kendisi gruplar.
    version: 14,
    name: 'order_matrix_groups',
    sql: `
      ALTER TABLE order_line ADD COLUMN line_group_id TEXT;

      CREATE TABLE order_line_group (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES "order"(id),
        product_id TEXT NOT NULL REFERENCES product(id),
        assortment_pattern TEXT,
        assortment_sets INTEGER
      );
      CREATE INDEX idx_order_line_group_order ON order_line_group(order_id);

      CREATE TABLE assortment_pattern (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        customer_id TEXT REFERENCES customer(id),
        name TEXT NOT NULL,
        pattern TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_assortment_pattern_business ON assortment_pattern(business_id);
    `,
  },
  {
    // Cari hesap düzeltmesi — TEK defter (product feedback). Bakiye artık
    // siparişlerden / birden çok tablonun toplamından değil, yalnızca
    // `cari_movement`'tan hesaplanır: Σ borç − Σ alacak. Bu migration:
    //  1. cari_movement tablosunu (append-only) kurar,
    //  2. siparişe brüt/iskonto/net üçlüsünü ekler (mevcut siparişler için
    //     brüt = net = kalemlerin toplamı, iskonto 0),
    //  3. müşteri/hesaba (opsiyonel) ana para birimi, gelire kategori, gelir/
    //     giderlere "cari dışı" onayı ekler,
    //  4. mevcut veriyi deftere GEÇİRİR: sevk edilmiş siparişler → borç,
    //     müşteriye/hesaba bağlı gelir-gider → alacak/borç, teslim alınmış
    //     satın almalar → alacak, karşılıksız çekler → borç.
    // Carisi olmayan eski gelir/giderler "eşleştirme bekliyor" kalır
    // (cari_excluded = 0): kullanıcı bir cari atar ya da "Cari dışı" onaylar.
    // Çalışana bağlı kayıtlar cari değildir → otomatik cari dışı.
    version: 15,
    name: 'cari_ledger',
    sql: `
      ALTER TABLE "order" ADD COLUMN gross_total_minor INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE "order" ADD COLUMN discount_type TEXT CHECK (discount_type IN ('amount','percent'));
      ALTER TABLE "order" ADD COLUMN discount_value INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE "order" ADD COLUMN discount_amount_minor INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE "order" ADD COLUMN net_total_minor INTEGER NOT NULL DEFAULT 0;
      UPDATE "order" SET gross_total_minor = COALESCE((SELECT SUM(quantity * unit_price_minor) FROM order_line WHERE order_id = "order".id), 0);
      UPDATE "order" SET net_total_minor = gross_total_minor;

      ALTER TABLE customer ADD COLUMN currency TEXT;
      ALTER TABLE account ADD COLUMN currency TEXT;
      ALTER TABLE revenue_entry ADD COLUMN category TEXT;
      ALTER TABLE revenue_entry ADD COLUMN cari_excluded INTEGER NOT NULL DEFAULT 0 CHECK (cari_excluded IN (0,1));
      ALTER TABLE expense_entry ADD COLUMN cari_excluded INTEGER NOT NULL DEFAULT 0 CHECK (cari_excluded IN (0,1));

      -- Sipariş/satın alma ödemeleri de doğrudan cariyi taşısın (tek bağlantı biçimi).
      UPDATE revenue_entry SET related_customer_id = (SELECT customer_id FROM "order" WHERE id = revenue_entry.related_order_id)
        WHERE related_order_id IS NOT NULL AND related_customer_id IS NULL AND related_account_id IS NULL AND related_employee_id IS NULL;
      UPDATE expense_entry SET related_account_id = (SELECT account_id FROM purchase WHERE id = expense_entry.related_purchase_id)
        WHERE related_purchase_id IS NOT NULL AND related_customer_id IS NULL AND related_account_id IS NULL AND related_employee_id IS NULL;
      UPDATE revenue_entry SET cari_excluded = 1 WHERE related_employee_id IS NOT NULL;
      UPDATE expense_entry SET cari_excluded = 1 WHERE related_employee_id IS NOT NULL;

      CREATE TABLE cari_movement (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES business(id),
        contact_type TEXT NOT NULL CHECK (contact_type IN ('customer','account')),
        contact_id TEXT NOT NULL,
        movement_date TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('shipment','collection','payment','purchase','return_in','return_out','discount_close','opening','check_bounce','reversal')),
        side TEXT NOT NULL CHECK (side IN ('debit','credit')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL,
        exchange_rate REAL,
        amount_in_cari_minor INTEGER NOT NULL CHECK (amount_in_cari_minor > 0),
        source_type TEXT NOT NULL CHECK (source_type IN ('order','cash_entry','check','purchase','return','manual')),
        source_id TEXT,
        reverses_id TEXT,
        reason TEXT,
        created_by TEXT NOT NULL REFERENCES employee(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_cari_contact ON cari_movement(contact_type, contact_id);
      CREATE INDEX idx_cari_source ON cari_movement(source_type, source_id);
      CREATE INDEX idx_cari_business ON cari_movement(business_id);

      -- Göç: sevk edilmiş siparişler → müşteri BORÇ (net tutar).
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), o.business_id, 'customer', o.customer_id, o.created_at, 'shipment', 'debit', o.net_total_minor, o.currency, NULL, o.net_total_minor, 'order', o.id, o.created_by, o.created_at, o.created_at
        FROM "order" o WHERE o.status = 'shipped' AND o.deleted_at IS NULL AND o.net_total_minor > 0;

      -- Müşteriye bağlı gelir → ALACAK (tahsilat); müşteriye bağlı gider → BORÇ (ödeme/iade).
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), r.business_id, 'customer', r.related_customer_id, r.date, 'collection', 'credit', r.amount_minor, r.currency, NULL, r.amount_minor, 'cash_entry', r.id, r.created_by, r.date, r.date
        FROM revenue_entry r WHERE r.deleted_at IS NULL AND r.related_customer_id IS NOT NULL AND r.amount_minor > 0;
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), e.business_id, 'customer', e.related_customer_id, e.date, 'payment', 'debit', e.amount_minor, e.currency, NULL, e.amount_minor, 'cash_entry', e.id, e.created_by, e.date, e.date
        FROM expense_entry e WHERE e.deleted_at IS NULL AND e.related_customer_id IS NOT NULL AND e.amount_minor > 0;

      -- Hesaba (tedarikçi/fasoncu) bağlı gider → BORÇ (ödeme); gelir → ALACAK.
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), e.business_id, 'account', e.related_account_id, e.date, 'payment', 'debit', e.amount_minor, e.currency, NULL, e.amount_minor, 'cash_entry', e.id, e.created_by, e.date, e.date
        FROM expense_entry e WHERE e.deleted_at IS NULL AND e.related_account_id IS NOT NULL AND e.amount_minor > 0;
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), r.business_id, 'account', r.related_account_id, r.date, 'collection', 'credit', r.amount_minor, r.currency, NULL, r.amount_minor, 'cash_entry', r.id, r.created_by, r.date, r.date
        FROM revenue_entry r WHERE r.deleted_at IS NULL AND r.related_account_id IS NOT NULL AND r.amount_minor > 0;

      -- Teslim alınmış satın almalar → hesap ALACAK (net toplam).
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), p.business_id, 'account', p.account_id, p.purchase_date, 'purchase', 'credit', t.total, p.currency, NULL, t.total, 'purchase', p.id, p.created_by, p.purchase_date, p.purchase_date
        FROM purchase p JOIN (SELECT purchase_id, SUM(line_total_minor) AS total FROM purchase_line GROUP BY purchase_id) t ON t.purchase_id = p.id
        WHERE p.is_received = 1 AND p.deleted_at IS NULL AND t.total > 0;

      -- Karşılıksız çıkmış müşteri çekleri → müşteri yeniden BORÇLANIR.
      INSERT INTO cari_movement (id, business_id, contact_type, contact_id, movement_date, type, side, amount_minor, currency, exchange_rate, amount_in_cari_minor, source_type, source_id, created_by, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), c.business_id, 'customer', r.related_customer_id, c.due_date, 'check_bounce', 'debit', c.amount_minor, c.currency, NULL, c.amount_minor, 'check', c.id, c.created_by, c.due_date, c.due_date
        FROM check_entry c JOIN revenue_entry r ON r.id = c.related_entry_id AND c.related_entry_type = 'RevenueEntry'
        WHERE c.status = 'bounced' AND c.deleted_at IS NULL AND r.deleted_at IS NULL AND r.related_customer_id IS NOT NULL AND c.amount_minor > 0;
    `,
  },
];
