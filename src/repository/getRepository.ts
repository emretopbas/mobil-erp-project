import { SqliteRepository } from './sqlite/SqliteRepository';
import type { Repository } from './types';

let repoPromise: Promise<Repository> | null = null;

/** App-wide Repository singleton. Swapping the solo tier for
 * TursoSyncRepository (team tier, CLAUDE.md §3) later only changes this one
 * function — nothing that calls `getRepository()` needs to know. */
export function getRepository(): Promise<Repository> {
  if (!repoPromise) {
    repoPromise = SqliteRepository.create();
  }
  return repoPromise;
}

/** Forgets the cached Repository (which holds table wrappers bound to a
 * specific, now-stale `SQLiteDatabase` handle) so the next `getRepository()`
 * call builds a fresh one against a freshly-opened db connection. The one
 * real caller: `BackupService.restoreLatest()` replaces the on-disk SQLite
 * file out from under any already-open handle — closing the raw db
 * connection (`closeDbConnection()` in db/client.ts) isn't enough on its
 * own, since this singleton would otherwise keep handing out a Repository
 * still wired to the connection that got closed. */
export function resetRepository(): void {
  repoPromise = null;
}
