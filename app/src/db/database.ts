import {open, type DB} from '@op-engineering/op-sqlite';
import {SCHEMA_SQL, SCHEMA_VERSION} from './schema';

let db: DB | null = null;

export function getDb(): DB {
  if (!db) {
    db = open({name: 'uptime.sqlite'});
    db.executeSync('PRAGMA journal_mode = WAL');
    db.executeSync('PRAGMA foreign_keys = ON');
    for (const sql of SCHEMA_SQL) {
      db.executeSync(sql);
    }
    db.executeSync(`INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
  }
  return db;
}

/** Test seam: inject an in-memory or fake DB. */
export function setDb(instance: DB | null): void {
  db = instance;
}

export function getMeta(key: string): string | null {
  const res = getDb().executeSync('SELECT value FROM meta WHERE key = ?', [key]);
  const row = res.rows?.[0] as {value: string} | undefined;
  return row ? row.value : null;
}

export function setMeta(key: string, value: string | null): void {
  if (value === null) {
    getDb().executeSync('DELETE FROM meta WHERE key = ?', [key]);
  } else {
    getDb().executeSync('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', [key, value]);
  }
}
