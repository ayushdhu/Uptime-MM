// Jest stand-in for the native op-sqlite binding: the same executeSync(sql, params)
// surface, backed by sql.js (SQLite compiled to wasm) in memory.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js');

let SQL: any = null;

export async function initForTests(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
}

export function open(_opts: {name: string}) {
  if (!SQL) {
    throw new Error('call initForTests() in beforeAll');
  }
  const db = new SQL.Database();
  return {
    executeSync(sql: string, params: unknown[] = []) {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH')) {
        const stmt = db.prepare(sql);
        stmt.bind(params.map(normalize));
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return {rows, rowsAffected: 0};
      }
      db.run(sql, params.map(normalize));
      return {rows: [], rowsAffected: db.getRowsModified()};
    },
    close() {
      db.close();
    },
  };
}

function normalize(v: unknown): unknown {
  if (v === undefined) {
    return null;
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  return v;
}

export type DB = ReturnType<typeof open>;
