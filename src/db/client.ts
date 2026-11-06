// Opens and migrates the local SQLite database.
//
// Persistence (CLAUDE.md §3/§8): `expo-sqlite`'s `openDatabaseAsync` stores
// the file under `FileSystem.documentDirectory + 'SQLite/'` — the device's
// persistent data directory, not the cache directory. A normal "clear cache"
// never touches it; only "clear app data" or an uninstall does. That's the
// exact guarantee the spec asks for, and it's expo-sqlite's default with no
// extra configuration — nothing here points it anywhere else.

import * as SQLite from 'expo-sqlite';

import { migrations } from './schema';

// Exported so BackupService can locate the exact on-disk file it needs to
// read/replace (under Paths.document + 'SQLite/', expo-sqlite's fixed
// convention) without duplicating this literal.
export const DATABASE_NAME = 'erp.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // WAL improves concurrent read/write behavior; FK enforcement matches the
  // REFERENCES constraints in schema.ts (off by default in SQLite).
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
  );

  const applied = await db.getAllAsync<{ version: number }>('SELECT version FROM _migrations');
  const appliedVersions = new Set(applied.map((row) => row.version));

  const pending = migrations
    .filter((m) => !appliedVersions.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, new Date().toISOString()],
      );
    });
  }
}

/** Closes and forgets the cached connection so the next getDb() call
 * re-opens (and re-migrates, harmlessly, since applied migrations are
 * skipped). Two real callers: tests, and `BackupService.restoreLatest()` —
 * which overwrites the on-disk SQLite file and must not leave a stale
 * handle (WAL segments, cached schema) pointing at the file it just
 * replaced. */
export async function closeDbConnection(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.closeAsync();
    dbPromise = null;
  }
}

/** @deprecated Use `closeDbConnection()` — same function, kept under this
 * name only so existing test imports don't need to change. */
export const _resetDbConnectionForTests = closeDbConnection;
