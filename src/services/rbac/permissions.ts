// RBAC permission matrix (CLAUDE.md §5.4). This is the single source of
// truth for "who can do what" — every guarded service in `src/services/`
// calls `requirePermission()` before touching the repository. The UI may
// also call `hasPermission()` to hide buttons, but per §5.4/§8 ("Yetki
// kontrolü her zaman service layer'da") that's a convenience, never the
// actual gate — a service method must re-check even if the UI already did.

import type { EmployeeRole } from '../../models';

export type Resource =
  | 'product'
  | 'stockMovement'
  | 'order'
  | 'purchase' // Purchase/PurchaseLine — not in CLAUDE.md's §5.4 table (added for
  // the purchasing module; see its row below for the reasoning)
  | 'task'
  | 'employee'
  | 'finance' // ExpenseEntry, RevenueEntry, Check (§5.6 — one gate for all three)
  | 'cari' // cari defter: bakiye/hareket okuma, iade girişi (cari_movement)
  | 'cariClose' // `cari.close_balance` — küsurat/bakiye kapatma, ayrı yetki
  | 'report'
  | 'settings';

export type Action = 'create' | 'read' | 'update' | 'delete';

/**
 * - 'crud'  → all four actions allowed unconditionally.
 * - 'read'  → only `read` allowed.
 * - 'own'   → `read` allowed unconditionally; `create`/`update`/`delete`
 *             allowed only when the caller passes `isOwn: true` (the row is
 *             assigned to/owned by the calling employee). Only `task`
 *             assignment uses this level (§5.3: "yalnızca kendi görevlerinin
 *             durumunu değiştirebilir").
 * - 'none'  → nothing allowed.
 */
type PermissionLevel = 'crud' | 'read' | 'own' | 'none';

// Transcribed directly from the §5.4 table. Keep the row order matching the
// spec's table order so a diff against CLAUDE.md is easy to eyeball.
const MATRIX: Record<Resource, Record<EmployeeRole, PermissionLevel>> = {
  product: { owner: 'crud', manager: 'crud', production: 'read', sales: 'read', viewer: 'read' },
  stockMovement: { owner: 'crud', manager: 'crud', production: 'crud', sales: 'read', viewer: 'read' },
  order: { owner: 'crud', manager: 'crud', production: 'read', sales: 'crud', viewer: 'read' },
  // Not in §5.4's literal table — added for the purchasing module (buying
  // materials from a subcontractor/supplier). Mirrors `stockMovement`, not
  // `order`: a small producer team's production staff are the ones who
  // actually order and receive materials day to day, same reasoning §5.1
  // gives stockMovement's production:'crud'; sales has no reason to touch
  // purchasing, same as it has no reason to touch stock movements.
  purchase: { owner: 'crud', manager: 'crud', production: 'crud', sales: 'read', viewer: 'read' },
  task: { owner: 'crud', manager: 'crud', production: 'own', sales: 'own', viewer: 'read' },
  employee: { owner: 'crud', manager: 'crud', production: 'none', sales: 'none', viewer: 'none' },
  finance: { owner: 'crud', manager: 'crud', production: 'none', sales: 'none', viewer: 'none' },
  // Spec says production/sales get "kısıtlı" (limited/restricted) reports,
  // not full read — there's no report *data* yet to restrict (§9 step 6 is
  // still pending), so this is modeled as plain 'read' for now. Whoever
  // builds the actual report queries should narrow what production/sales
  // see at the query level, not loosen this back to 'crud'.
  // Cari defter: bakiyeyi sipariş görebilen herkes okur (müşteri ekranı
  // bakiyesi eskiden `order:read` ile açılıyordu); iade girişi/yazma yalnızca
  // owner/manager. Bakiye KAPATMA ayrı bir izin: geriye dönük küsurat silmek
  // izi silmeye yakın bir işlem, herkese açılmaz.
  cari: { owner: 'crud', manager: 'crud', production: 'read', sales: 'read', viewer: 'read' },
  cariClose: { owner: 'crud', manager: 'crud', production: 'none', sales: 'none', viewer: 'none' },
  report: { owner: 'crud', manager: 'crud', production: 'read', sales: 'read', viewer: 'read' },
  settings: { owner: 'crud', manager: 'none', production: 'none', sales: 'none', viewer: 'none' },
};

// product feedback: "sahibi, yönetici" roles should be the only ones who can
// delete already-made sales/orders and purchases — 'order' and 'purchase'
// otherwise stay 'crud' for sales/production (placing orders / receiving
// materials is still their job day to day), this narrows just the delete
// action on top of that base level. `finance` (gelir/gider/ödeme kayıtları)
// needs no entry here — production/sales/viewer already sit at 'none' for
// the whole resource, so deleting a payment is already owner/manager-only.
const DELETE_RESTRICTED_TO_OWNER_MANAGER: Partial<Record<Resource, true>> = {
  order: true,
  purchase: true,
};

export class PermissionError extends Error {
  constructor(
    public readonly role: EmployeeRole,
    public readonly resource: Resource,
    public readonly action: Action,
  ) {
    super(`Role "${role}" is not allowed to ${action} "${resource}"`);
    this.name = 'PermissionError';
  }
}

export function hasPermission(
  role: EmployeeRole,
  resource: Resource,
  action: Action,
  opts: { isOwn?: boolean } = {},
): boolean {
  if (action === 'delete' && DELETE_RESTRICTED_TO_OWNER_MANAGER[resource] && role !== 'owner' && role !== 'manager') {
    return false;
  }
  const level = MATRIX[resource][role];
  switch (level) {
    case 'crud':
      return true;
    case 'read':
      return action === 'read';
    case 'own':
      return action === 'read' ? true : opts.isOwn === true;
    case 'none':
      return false;
  }
}

/** Throws `PermissionError` instead of returning false — the shape every
 * guarded service method wants at its top. */
export function requirePermission(
  role: EmployeeRole,
  resource: Resource,
  action: Action,
  opts: { isOwn?: boolean } = {},
): void {
  if (!hasPermission(role, resource, action, opts)) {
    throw new PermissionError(role, resource, action);
  }
}
