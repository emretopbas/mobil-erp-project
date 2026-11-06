// Generic CRUD helper backing SqliteRepository — one instance per table.
// Row types already match their SQLite representation 1:1 (see
// models/common.ts's naming note), so this needs no serialize/deserialize
// step: a TRow going in is exactly a TRow coming back out.

import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

// TRow is intentionally just `object`, not `Record<string, unknown>`: every
// row type here is a plain interface (models/entities.ts) with no index
// signature, and requiring one would make every entity type carry dead
// boilerplate just to satisfy this generic. The indexed reads below go
// through `asRecord`, one narrow, explicit cast at the boundary instead.
export class SqliteTable<TRow extends object> {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly table: string,
    private readonly idColumn: keyof TRow & string = 'id' as keyof TRow & string,
  ) {}

  async insert(row: TRow): Promise<void> {
    const record = asRecord(row);
    const cols = Object.keys(record);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${placeholders})`;
    await this.db.runAsync(sql, cols.map((c) => record[c] as SQLiteBindValue));
  }

  async getById(id: string): Promise<TRow | null> {
    const row = await this.db.getFirstAsync<TRow>(
      `SELECT * FROM ${this.table} WHERE ${this.idColumn} = ?`,
      [id],
    );
    return row ?? null;
  }

  /** `where`, if given, is a raw SQL fragment with `?` placeholders — callers
   * own composing it (this stays a thin CRUD layer, not a query builder). */
  async list(where?: string, params: SQLiteBindValue[] = []): Promise<TRow[]> {
    const sql = `SELECT * FROM ${this.table}${where ? ` WHERE ${where}` : ''}`;
    return this.db.getAllAsync<TRow>(sql, params);
  }

  async update(id: string, patch: Partial<TRow>): Promise<void> {
    const record = asRecord(patch);
    const cols = Object.keys(record);
    if (cols.length === 0) return;
    const setClause = cols.map((c) => `${c} = ?`).join(', ');
    const sql = `UPDATE ${this.table} SET ${setClause} WHERE ${this.idColumn} = ?`;
    await this.db.runAsync(sql, [...cols.map((c) => record[c] as SQLiteBindValue), id]);
  }
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
