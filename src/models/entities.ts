// Entity models — direct TypeScript mirror of the schema in CLAUDE.md §4.
// See common.ts for the naming/money/time/soft-delete conventions these
// follow.

import type {
  AttributeDataType,
  CariContactType,
  CariDirection,
  CariMovementType,
  CariSourceType,
  CheckDirection,
  CheckStatus,
  CurrencyCode,
  EmployeeRole,
  EntryRelatedType,
  ExpenseCategory,
  ISODateString,
  MaterialStatus,
  MinorUnitAmount,
  OrderDiscountType,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PlanTier,
  PurchaseLineType,
  PurchaseStatus,
  RevenueCategory,
  RevenueSource,
  StockMovementType,
  TaskStatus,
  UUID,
} from './common';

export interface Business {
  id: UUID;
  name: string;
  base_currency: CurrencyCode;
  plan_tier: PlanTier;
  created_at: ISODateString;
  /** §5.1: "işletme ayarıyla negatife izin ver açılabilir" — the one
   * business-wide setting the spec names explicitly; not in the §4 schema
   * table as written, added via db/schema.ts migration 3 the same way
   * `employee.fcm_token` was added for §7.2. Defaults to 0 (spec's default:
   * negative stock blocked). */
  allow_negative_stock: 0 | 1;
  /** §9 step 8 / §7.3: when `BackupService.backupNow()` last succeeded for
   * this business. Same "spec names it, §4's table doesn't have a column for
   * it" situation as `allow_negative_stock` — added via migration 4. Null
   * until the first backup runs. */
  last_backup_at: ISODateString | null;
}

export interface Employee {
  id: UUID;
  business_id: UUID;
  firebase_uid: string | null; // bound once an invite is accepted
  display_name: string;
  email: string | null;
  phone: string | null;
  role: EmployeeRole;
  is_active: 0 | 1;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
  /** FCM device token (§7.2: "cihaz token'ı Employee ile eşlenir") — not in
   * the §4 schema table as written, added via db/schema.ts migration 2 to
   * satisfy §7's own integration requirement. Null until the device
   * registers one (see services/NotificationService.ts). Single-device only
   * for now — a real multi-device model would need its own table. */
  fcm_token: string | null;
}

export interface Product {
  id: UUID;
  business_id: UUID;
  name: string;
  sku: string;
  /** Free-text grouping for catalog/reporting (e.g. "Erkek Ayakkabı",
   * "Hammadde") — see product-schema.md. Not a normalized entity yet; a
   * dedicated Category table is a documented future step, not built now. */
  category: string | null;
  description: string | null;
  /** Unit of measure — "adet" (piece) by default; matters once raw
   * materials (meters of leather, etc.) get tracked, not just finished
   * goods. */
  unit: string;
  base_price_minor: MinorUnitAmount;
  currency: CurrencyCode;
  /** Satın alma ekranının "Ürünler" kataloğunda listelenir mi (product
   * feedback: "satın alınabilir olarak işaretlenmiş ürünler"). Varsayılan 1 —
   * mevcut ürünler migration'dan sonra da alınabilir kalır, kullanıcı
   * gerekirse ürün düzenleme formundan kapatır. */
  is_purchasable: 0 | 1;
  is_active: 0 | 1;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
}

export interface ProductVariant {
  id: UUID;
  product_id: UUID;
  /** Denormalized from `product.business_id` — see product-schema.md's
   * rationale (every other child table already carries `business_id`
   * directly; this was the one exception, which meant "list this
   * business's variants" needed a join everywhere it came up). */
  business_id: UUID;
  sku: string;
  barcode: string | null;
  /** JSON-encoded escape hatch for anything beyond the attribute-axis
   * system below, e.g. {"heel_height":"3cm"} — stored as TEXT in SQLite;
   * parse/stringify at the repository boundary. */
  attributes: string;
  /** Canonical signature of this variant's `VariantAttribute` combination —
   * `attribute.code`-sorted `code=value` pairs joined by `|` (e.g.
   * `color=KIRMIZI|size=42`), computed by `canonicalVariantKey()` in
   * lib/variantAxes.ts. Empty string for the single "no axes chosen"
   * default variant a product gets when the user skips variant setup
   * entirely (§1/§4 of the eksen-tabanlı varyant sistemi spec) — that empty
   * string doubles as the `is_default` flag the spec names separately, so
   * no extra column exists for it. `UNIQUE(product_id, variant_key)` is the
   * ONLY mechanism guaranteeing a combination can't be created twice —
   * never re-derive/re-check this by hand elsewhere. */
  variant_key: string;
  /** COGS — what this variant costs to make/source. Nullable: not always
   * known at creation time. Enables a future margin report without another
   * migration; no such report exists yet (§9 step 6 doesn't call for one). */
  cost_price_minor: MinorUnitAmount | null;
  /** Overrides `product.base_price_minor` for this specific variant when
   * set (e.g. a larger size costs more) — null means "use the product's
   * price," not "free." */
  price_minor: MinorUnitAmount | null;
  /** `file://` URI into the app's persistent document directory (never
   * cache — CLAUDE.md §3/§8), copied there from whatever the picker/camera
   * handed back. Null = no photo yet, renders as a "+" placeholder. Doubles
   * as the thumbnail for a future customer-facing teklif sayfası; the
   * variant's `barcode` is the other visual aid — its karekod is generated
   * on the fly from the string, nothing stored for that half. */
  image_uri: string | null;
  /** Manual "no longer carried" toggle AND the "archive" outcome of §4's
   * "değer silme" flow (a variant with stock-movement history is
   * deactivated, never hard-deleted — see `ProductService.archiveOrDeleteVariant`).
   * A variant with no stock history at all gets a real `DELETE` instead
   * (`ProductVariantRepository.remove`), so this flag never needs a third
   * state. */
  is_active: 0 | 1;
}

/** A user- or system-defined variant axis (CLAUDE.md-adjacent eksen-tabanlı
 * varyant sistemi spec §2) — Renk/Beden ship as `is_system=1` seed rows
 * (seeded once per business, see SessionProvider.createBusiness and
 * db/schema.ts migration 12's backfill for existing businesses); anything
 * else ("Materyal", "Boy (cm)", "Kaplama"...) is created ad hoc by a user
 * via AttributeService.createAttribute and is immediately reusable across
 * every product in the business — there is no per-product attribute copy. */
export interface Attribute {
  id: UUID;
  business_id: UUID;
  /** Machine code, e.g. 'color', 'material', 'length_cm' — `slugifyAttributeCode(name)`
   * at creation time. Drives `variant_key`'s alphabetical ordering. */
  code: string;
  /** User-facing label, e.g. "Renk", "Materyal", "Boy (cm)". */
  name: string;
  data_type: AttributeDataType;
  /** Free-text unit suffix for `data_type: 'number'` axes only (e.g. "cm",
   * "gr") — deliberately not a normalized `unit` table/FK; the spec's own
   * examples already inline the unit into `name` ("Boy (cm)"), so this is
   * just an optional display hint for the range-generator step, not load-
   * bearing anywhere else. */
  unit_label: string | null;
  is_system: 0 | 1;
  created_at: ISODateString;
}

/** One reusable value for an `option`-type `Attribute` (e.g. "Kırmızı" under
 * Renk). Shared across every product in the business that uses this
 * attribute — adding a new option here is what makes a value available (and
 * suggested) on every future product, not a per-product copy. */
export interface AttributeOption {
  id: UUID;
  attribute_id: UUID;
  /** Canonical/machine value, e.g. 'KIRMIZI' — what `variant_key` embeds. */
  value: string;
  /** Display label, e.g. "Kırmızı". */
  label: string;
  /** Short token substituted into a SKU template (e.g. `{sku}-{color}-{size}`) —
   * defaults to `value` if the user never sets a shorter one. */
  sku_token: string | null;
  /** Swatch preview color for a color-like axis — null for every other
   * axis. */
  swatch_hex: string | null;
  position: number;
}

/** One axis value assigned to one variant — `option_id` for `data_type:
 * 'option'` axes, `value_text`/`value_number` for 'text'/'number' axes (at
 * most one of the three is ever set for a given row; enforced in
 * ProductService, not a DB constraint — same "business rules live in the
 * service layer" split as ExpenseEntry/RevenueEntry's related_* triples). */
export interface VariantAttribute {
  variant_id: UUID;
  attribute_id: UUID;
  option_id: UUID | null;
  value_text: string | null;
  value_number: number | null;
}

/** A saved, reusable axis set (spec §2/§3's "Hazır setler" — "Ayakkabı
 * numarası 36-46", "Konfeksiyon S-XXL") — `definition` is the JSON shape
 * `VariantAxisWizard` itself builds ([{attribute_id, values}]), replayed
 * verbatim into Adım A on one tap. `use_count`/`last_used_at` are bumped by
 * `AttributeService.applyPreset` purely for a future "most used first"
 * sort — nothing reads them yet beyond that intent. */
export interface AxisPreset {
  id: UUID;
  business_id: UUID;
  name: string;
  definition: string;
  use_count: number;
  last_used_at: ISODateString | null;
  created_at: ISODateString;
}

export interface StockMovement {
  id: UUID;
  business_id: UUID;
  variant_id: UUID;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  note: string | null;
  related_order_id: UUID | null;
  /** Set when this movement is the stock-intake side of a Purchase being
   * marked 'received' (mirrors `related_order_id`'s shipped-side link). */
  related_purchase_id: UUID | null;
  created_by: UUID; // employee_id
  created_at: ISODateString;
  // No update/delete in the Repository contract — §5.1: "değiştirilemez log";
  // a correction is a new adjustment row, never a mutation of this one.
}

export interface StockLevel {
  variant_id: UUID; // primary key, 1:1 with ProductVariant
  on_hand: number;
  low_stock_threshold: number;
  /** How much to reorder once `on_hand` hits the threshold — a reorder
   * policy value, not yet consumed by any purchasing workflow (none exists
   * in Faz 1), but cheap to capture now alongside the threshold it pairs
   * with. */
  reorder_quantity: number;
}

export interface Task {
  id: UUID;
  business_id: UUID;
  title: string;
  description: string | null;
  assignee_id: UUID; // employee_id
  status: TaskStatus;
  due_date: ISODateString | null;
  related_order_id: UUID | null;
  created_by: UUID;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
}

export interface Shift {
  id: UUID;
  business_id: UUID;
  employee_id: UUID;
  date: ISODateString;
  /** Hours the shift runs — 8 (tam mesai) or 4 (yarım mesai) by convention,
   * but stored as a plain integer rather than an enum since nothing else
   * constrains it (§5.3 explicitly keeps Shift "basit"). */
  duration_hours: number;
  note: string | null;
}

export interface ExpenseEntry {
  id: UUID;
  business_id: UUID;
  category: ExpenseCategory;
  amount_minor: MinorUnitAmount;
  currency: CurrencyCode;
  date: ISODateString;
  note: string | null;
  related_order_id: UUID | null;
  /** Set when this expense is a payment against a specific Purchase (the
   * PurchaseService.recordPayment() path) — mirrors RevenueEntry's
   * `related_order_id`, just on the buying side. */
  related_purchase_id: UUID | null;
  // At most one of these three is ever set (FinanceService enforces it) —
  // who this money went to, when it's not already implied by
  // `related_order_id`/`related_purchase_id`: an existing Customer, an
  // Employee, or a generic `Account` (supplier/subcontractor/other third
  // party).
  related_customer_id: UUID | null;
  related_employee_id: UUID | null;
  related_account_id: UUID | null;
  /** 1: kullanıcı bu kaydın carisi olmadığını bilinçli onayladı ("Cari dışı"). */
  cari_excluded: 0 | 1;
  payment_method: PaymentMethod;
  created_by: UUID;
  deleted_at: ISODateString | null;
}

export interface RevenueEntry {
  id: UUID;
  business_id: UUID;
  source: RevenueSource;
  related_order_id: UUID | null;
  related_customer_id: UUID | null;
  related_employee_id: UUID | null;
  related_account_id: UUID | null;
  /** Cari dışı gelirin kategorisi (faiz, hurda …); carili kayıtta null. */
  category: RevenueCategory | null;
  cari_excluded: 0 | 1;
  amount_minor: MinorUnitAmount;
  currency: CurrencyCode;
  date: ISODateString;
  note: string | null;
  payment_method: PaymentMethod;
  created_by: UUID;
  deleted_at: ISODateString | null;
}

/** A third-party ledger entry point that's neither a `Customer` (order-bound)
 * nor an `Employee` (auth/RBAC-bound) — a supplier, a subcontractor, a
 * landlord. Deliberately minimal: just enough to name who a Gelir/Gider
 * entry belongs to and add up a running balance for them (§8's "karmaşık
 * muhasebe YOK" — no invoices, no owed-vs-paid distinction, just a ledger). */
export interface Account {
  id: UUID;
  business_id: UUID;
  name: string;
  note: string | null;
  /** Carinin ana para birimi; null ⇒ işletmenin ana para birimi. */
  currency: CurrencyCode | null;
  is_active: 0 | 1;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
}

export interface Check {
  id: UUID;
  business_id: UUID;
  direction: CheckDirection;
  related_entry_id: UUID;
  related_entry_type: EntryRelatedType;
  check_number: string | null;
  bank_name: string | null;
  amount_minor: MinorUnitAmount;
  currency: CurrencyCode;
  issue_date: ISODateString;
  due_date: ISODateString;
  status: CheckStatus;
  note: string | null;
  created_by: UUID;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
}

// ─── Faz 2 seed models — Faz 1 populates these via manual entry ONLY.
// `Order.source` is always 'manual' in Faz 1; 'nlp' is a value this app
// never produces yet (see OrderIngestionService in services/).

export interface Customer {
  id: UUID;
  business_id: UUID;
  name: string;
  primary_channel: string | null; // Faz 2 channel key; unused in Faz 1
  contact_ref: string | null;
  /** Carinin ana para birimi; null ⇒ işletmenin ana para birimi. */
  currency: CurrencyCode | null;
  is_active: 0 | 1;
  deleted_at: ISODateString | null;
}

export interface Order {
  id: UUID;
  business_id: UUID;
  customer_id: UUID;
  status: OrderStatus;
  source: OrderSource;
  currency: CurrencyCode;
  note: string | null;
  /** Promised hand-off/ship date — date-only (no time-of-day), picked with
   * the same `DatePicker` as Mesai's shift date. Independent of `status`:
   * setting or changing it never books money or moves stock, same
   * money/status-decoupling reasoning as everything else in OrderService. */
  delivery_date: ISODateString | null;
  /** Sipariş toplamı: brüt → iskonto → net ayrı saklanır (ileride "verilen
   * toplam iskonto" raporu için). Sevkiyatta cariye NET tutar borç yazılır.
   * `discount_value`: tutarda minor unit, yüzdede yüzde × 100 (1000 = %10). */
  gross_total_minor: MinorUnitAmount;
  discount_type: OrderDiscountType | null;
  discount_value: number;
  discount_amount_minor: MinorUnitAmount;
  net_total_minor: MinorUnitAmount;
  created_by: UUID;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
}

export interface OrderLine {
  id: UUID;
  order_id: UUID;
  variant_id: UUID;
  quantity: number;
  unit_price_minor: MinorUnitAmount;
  /** Aynı ürün matrisinden gelen satırların ortak grubu (`OrderLineGroup`).
   * NULL: matris öncesi eski satırlar — okuma tarafı bunları ürün bazında
   * kendisi gruplar. */
  line_group_id: UUID | null;
}

/** Bir siparişteki tek bir ürünün matris girişi. Satırlar hâlâ varyant
 * bazlıdır; grup sadece "bu satırlar aynı matristen geldi" bilgisini ve
 * (asorti ile girildiyse) kullanılan deseni/set adedini taşır. */
export interface OrderLineGroup {
  id: UUID;
  order_id: UUID;
  product_id: UUID;
  /** "1-2-2-2-1" gibi; asortisiz girişte NULL. */
  assortment_pattern: string | null;
  assortment_sets: number | null;
}

/** Kayıtlı asorti deseni. `customer_id` doluysa o müşteriye özel. */
export interface AssortmentPattern {
  id: UUID;
  business_id: UUID;
  customer_id: UUID | null;
  name: string;
  pattern: string;
  created_at: ISODateString;
  deleted_at: ISODateString | null;
}

// ─── Purchasing (materials/stock bought from a subcontractor or supplier —
// an `Account`, never a `Customer`) — the mirror image of Order/OrderLine
// above: money going OUT for goods coming IN, instead of goods out for
// money in. Same money/status decoupling as Order: `setStatus()` never
// touches money, `recordPayment()` never touches status (see
// PurchaseService.ts's header).

export interface Purchase {
  id: UUID;
  business_id: UUID;
  account_id: UUID; // the supplier/subcontractor — an Account, not a Customer
  /** Legacy 3-stage column (migration 9's CHECK can't be altered without a
   * table rebuild). `is_received` below is the source of truth; PurchaseService
   * keeps `status` in sync as 'received' | 'draft' so old rows/consumers
   * still read sensibly. New code never writes 'ordered'. */
  status: PurchaseStatus;
  /** Şartname §2'nin `purchase_date`'i — kullanıcının seçtiği alım tarihi
   * (`created_at`'ten ayrı: dünkü bir alım bugün girilebilir). */
  purchase_date: ISODateString;
  /** Şartname §4: 1 iken kayıt stoğa işlenmiştir (miktar kadar giriş),
   * 0 iken "bekleyen satın alma" — stok değişmez. */
  is_received: 0 | 1;
  received_at: ISODateString | null;
  currency: CurrencyCode;
  note: string | null;
  created_by: UUID;
  created_at: ISODateString;
  updated_at: ISODateString;
  deleted_at: ISODateString | null;
}

/** A purchase line buys EITHER a `Material` (`line_type: 'material'`,
 * `material_id` set, `variant_id` null) OR a product variant (`'product'`,
 * tersi) — migration 13'ün CHECK'i bunu DB seviyesinde garanti eder.
 * `unit_cost_minor` şartnamenin `unit_price`'ı (mevcut sütun adı korundu);
 * fiyat SADECE bu kayıtta saklanır, hiçbir stok/maliyet alanına yansımaz
 * (şartname §1 "Fiyat stoğa yansımaz"). */
export interface PurchaseLine {
  id: UUID;
  purchase_id: UUID;
  line_type: PurchaseLineType;
  material_id: UUID | null;
  variant_id: UUID | null;
  /** REAL — malzemeler ondalıklı (2,5 m²); ürün satırlarında tam sayı. */
  quantity: number;
  /** Satır anındaki birimin kopyası ("adet", "kg", "m²") — malzeme/ürün sonradan
   * birimini değiştirse de geçmiş satın alma okunabilir kalır. */
  unit: string;
  unit_cost_minor: MinorUnitAmount;
  /** `Math.round(quantity × unit_cost_minor)` — yazım anında hesaplanıp
   * saklanır (şartname §2), tutarlar ondalıklı miktarlarda kuruş
   * kaymasın diye her okumada yeniden çarpılmaz. */
  line_total_minor: MinorUnitAmount;
  /** Bir ürünün matrisinden gelen satırları gruplar (değer: product id). */
  line_group_id: UUID | null;
  note: string | null;
}

/** Sade bir girdi kaydı (deri, taban, kutu…) — bilerek eksen/varyant
 * yapısı YOK (şartname §1: malzeme fire verir, eksenlerle izlemek
 * yanıltıcı bir kesinlik üretir). Farklı renk/ölçü = ayrı kayıt. Ürün
 * tablosuna bayrakla karıştırılmadı, ayrı ve sade tablo. */
export interface Material {
  id: UUID;
  business_id: UUID;
  name: string;
  description: string | null;
  /** Serbest metin birim ("adet", "kg", "m", "m²", "lt", "top", "rulo") —
   * `Product.unit` ile aynı gerekçeyle normalize edilmiş bir tablo değil. */
  unit: string;
  /** Serbest metin kategori — `Product.category` ile aynı mevcut sistem. */
  category: string | null;
  /** REAL, ondalıklı. Sadece PurchaseService'in ters-kayıtlı
   * `MaterialMovement` akışıyla değişir. */
  stock_quantity: number;
  status: MaterialStatus;
  created_at: ISODateString;
  updated_at: ISODateString;
  deleted_at: ISODateString | null;
}

/** Malzeme stoğunun değiştirilemez defteri (`StockMovement`'ın malzeme
 * karşılığı) — `quantity` İŞARETLİ bir delta (+ giriş, − ters kayıt/çıkış),
 * çünkü malzemede in/out/adjustment ayrımına ihtiyaç yok. Teslim alınmış bir
 * satın alma düzenlenince/silinince stok değeri üzerine yazılmaz, buraya
 * ters bir satır eklenir (şartname §4). */
export interface MaterialMovement {
  id: UUID;
  business_id: UUID;
  material_id: UUID;
  quantity: number;
  reason: string | null;
  related_purchase_id: UUID | null;
  created_by: UUID;
  created_at: ISODateString;
}

/** Cari hareket defteri — bakiyenin TEK kaynağı: Σ borç − Σ alacak
 * (`amount_in_cari_minor` üzerinden, carinin kendi para biriminde). Kayıtlar
 * yalnızca eklenir; düzeltme daima yeni (ters) hareketle yapılır — bu tabloda
 * UPDATE/DELETE yolu yoktur. `amount_minor` daima pozitiftir, yön `side`'dadır. */
export interface CariMovement {
  id: UUID;
  business_id: UUID;
  contact_type: CariContactType;
  contact_id: UUID;
  movement_date: ISODateString;
  type: CariMovementType;
  side: CariDirection;
  amount_minor: MinorUnitAmount;
  currency: CurrencyCode;
  /** İşlem para birimi cari para biriminden farklıysa: 1 işlem birimi = kaç cari birimi. */
  exchange_rate: number | null;
  amount_in_cari_minor: MinorUnitAmount;
  source_type: CariSourceType;
  source_id: UUID | null;
  /** 'reversal' hareketi hangi hareketi düzeltiyor (bilgi amaçlı). */
  reverses_id: UUID | null;
  reason: string | null;
  created_by: UUID;
  created_at: ISODateString;
  updated_at: ISODateString;
  deleted_at: ISODateString | null;
}
