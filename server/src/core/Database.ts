import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createLogger } from './logger.ts';

const log = createLogger('db');

/** Ordered, append-only schema migrations. Never edit an existing entry; add a new one. */
const MIGRATIONS: string[] = [
  `CREATE TABLE history (
     tag TEXT NOT NULL,
     ts INTEGER NOT NULL,
     value REAL,
     quality INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX ix_history_tag_ts ON history(tag, ts);
   CREATE TABLE alarm_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     alarm_id TEXT NOT NULL,
     tag TEXT NOT NULL,
     event TEXT NOT NULL,
     severity TEXT NOT NULL,
     message TEXT NOT NULL,
     value TEXT,
     user TEXT,
     comment TEXT
   );
   CREATE INDEX ix_alarm_events_ts ON alarm_events(ts);
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     user TEXT NOT NULL,
     action TEXT NOT NULL,
     target TEXT,
     details TEXT
   );
   CREATE INDEX ix_audit_ts ON audit(ts);
   CREATE TABLE kv (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

export type SqlParam = SQLInputValue;

/** Thin wrapper over the built-in node:sqlite driver (no native dependencies to compile). */
export class Database {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    let version = row?.version ?? 0;
    if (!row) this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    while (version < MIGRATIONS.length) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[version]);
        this.db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      });
      version++;
      log.info(`applied migration ${version}`);
    }
  }

  query<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getKv<T>(key: string): T | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setKv(key: string, value: unknown): void {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  close(): void {
    this.db.close();
  }
}
