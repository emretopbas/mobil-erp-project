// SyncService (CLAUDE.md §6, §9 step 9): "Turso push/pull; Faz 1'de takım
// katmanı için temel implementasyon veya stub (solo'da no-op)." Solo tier
// (the only plan this app can create today — see SessionProvider) always
// gets `NoopSyncService`. A real `TursoSyncService` for the team tier isn't
// built — that needs the user to actually provision a Turso database (an
// external account/credential, not something to invent a default for), and
// nothing in the app can create a `plan_tier: 'team'` Business yet anyway.
// This interface exists so that whenever that lands, nothing that calls
// `getSyncService()` needs to change.

import type { Business } from '../models';

export interface SyncService {
  /** Push local writes to the remote (no-op for solo). */
  push(): Promise<void>;
  /** Pull remote writes into the local embedded replica (no-op for solo). */
  pull(): Promise<void>;
  isSyncing(): boolean;
}

export class NoopSyncService implements SyncService {
  async push(): Promise<void> {
    // Solo tier has no remote — nothing to push.
  }
  async pull(): Promise<void> {
    // Solo tier has no remote — nothing to pull.
  }
  isSyncing(): boolean {
    return false;
  }
}

/** `plan_tier` is always `'solo'` in this app today (§3: "Solo katman devre
 * dışı [senkron]... Takım / Ücretli" isn't reachable — nothing upgrades a
 * Business to `'team'` yet), so this always returns the no-op. The branch
 * exists so the call site is already correct once a team tier exists. */
export function getSyncService(business: Business): SyncService {
  if (business.plan_tier === 'team') {
    // TODO(Faz 1 team tier): construct a real TursoSyncService here once
    // Turso provisioning + credentials exist. Until then, degrade to no-op
    // rather than throwing — a team-tier business without sync configured
    // should still work locally, just without cross-device sync.
    return new NoopSyncService();
  }
  return new NoopSyncService();
}
