// Shared enums and value types used across the schema (CLAUDE.md §4).
//
// Naming: fields stay in the snake_case CLAUDE.md itself uses for the schema
// (`business_id`, `created_at`, …) rather than translating to camelCase at
// this layer — the spec defines the columns that way, so the model is a
// direct 1:1 mirror of it. No mapping layer between "domain shape" and "DB
// row shape" exists on purpose: less code, and one less place these two can
// drift apart.
//
// Money (§8): every amount is an integer **minor unit** (kuruş/cent) plus an
// ISO 4217 `currency` code. Never a float. Display formatting (÷100 + locale
// format) belongs in the UI layer via a shared `formatMoney` helper — not
// built yet, not this file's job.
//
// Time: every timestamp is UTC, stored as an ISO 8601 string
// (`new Date().toISOString()`), localized only at display time.
//
// Soft delete (§4): no hard deletes. Tables carry `deleted_at: string | null`
// and/or `is_active: 0 | 1`. SQLite has no boolean type — `is_active` is
// typed `0 | 1` here, matching what actually comes back from a query, not
// wrapped into a `boolean` the DB doesn't really store.

export type UUID = string;
export type ISODateString = string;
export type CurrencyCode = string; // ISO 4217, e.g. "EUR", "TRY", "USD"
export type MinorUnitAmount = number; // integer minor unit — never a float

export type PlanTier = 'solo' | 'team';

export type EmployeeRole = 'owner' | 'manager' | 'production' | 'sales' | 'viewer';

export type StockMovementType = 'in' | 'out' | 'adjustment';

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type ExpenseCategory = 'raw_material' | 'rent' | 'labor' | 'shipping' | 'other';

export type RevenueSource = 'order' | 'manual';

/** Cari dışı gelir kalemi kategorisi (faiz, hurda satışı, kira geliri …). */
export type RevenueCategory = 'interest' | 'scrap_sale' | 'rent_income' | 'other';

// ─── Cari defter (cari_movement) ───────────────────────────────────────
export type CariContactType = 'customer' | 'account';
/** Veritabanında borç/alacak kalır: 'debit' = Borç (+), 'credit' = Alacak (−). */
export type CariDirection = 'debit' | 'credit';
export type CariMovementType =
  | 'shipment'
  | 'collection'
  | 'payment'
  | 'purchase'
  | 'return_in'
  | 'return_out'
  | 'discount_close'
  | 'opening'
  | 'check_bounce'
  | 'reversal';
export type CariSourceType = 'order' | 'cash_entry' | 'check' | 'purchase' | 'return' | 'manual';
export type OrderDiscountType = 'amount' | 'percent';

// 'deposit' (kapora/avans) added for the customer-balance feature — an
// advance/partial payment tag, distinct from *how* it was physically paid
// (which itself is still cash/card/check underneath in the common case, but
// tagging it as a deposit up front is what lets a balance view explain "why"
// a payment exists, not just "how").
export type PaymentMethod = 'cash' | 'credit_card' | 'check' | 'deposit';

export type CheckDirection = 'received' | 'issued';

export type CheckStatus = 'pending' | 'cleared' | 'bounced' | 'cashed';

export type OrderStatus = 'draft' | 'confirmed' | 'in_production' | 'ready' | 'shipped';

/** A Purchase's lifecycle — deliberately simpler than Order's five stages:
 * a small producer team buying materials from a subcontractor/supplier
 * doesn't need a production pipeline on the *buying* side, just "still
 * deciding/being drafted" → "sent to the supplier" → "materials arrived
 * (stock goes up)". */
export type PurchaseStatus = 'draft' | 'ordered' | 'received';

/** What a `PurchaseLine` buys — a `Material` (sade, eksensiz girdi) or a
 * product `ProductVariant` (mevcut varyant sistemiyle alınan ticari mal).
 * Bkz. entities.ts'in `PurchaseLine` yorumu. */
export type PurchaseLineType = 'material' | 'product';

export type MaterialStatus = 'active' | 'archived';

export type OrderSource = 'manual' | 'nlp'; // 'nlp' is a Faz 2 value; never produced in Faz 1

export type EntryRelatedType = 'ExpenseEntry' | 'RevenueEntry';

/** An `Attribute`'s value shape — 'option' (a fixed, reusable list of
 * `AttributeOption` rows, e.g. Renk/Beden), 'number' (a bare numeric value,
 * e.g. Boy (cm)), or 'text' (free text, e.g. a one-off note-like axis). */
export type AttributeDataType = 'option' | 'number' | 'text';
