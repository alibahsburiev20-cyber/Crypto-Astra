// D1-заглушка на настоящем SQLite (node:sqlite).
//
// Денежный учёт проверять моками бессмысленно: половина гарантий живёт в схеме
// (UNIQUE, CHECK, триггеры), а мок их не знает. Здесь настоящая база в памяти с
// интерфейсом D1: `prepare().bind().run()/all()/first()` и транзакционный `batch`.
//
// Важно: `batch` в D1 атомарен — код на него опирается, поэтому заглушка тоже
// оборачивает пачку в BEGIN/COMMIT и откатывает всё при первой ошибке.
import { DatabaseSync } from 'node:sqlite';

export interface FakeD1 {
  db: D1Database;
  /** Сырой доступ для проверок в тестах. */
  raw: DatabaseSync;
}
 
export function makeD1(): FakeD1 {
  const raw = new DatabaseSync(':memory:');

  const exec = (sql: string, params: unknown[]) => {
    const st = raw.prepare(sql);
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
      const results = st.all(...(params as never[])) as Record<string, unknown>[];
      return { results, meta: { changes: 0, last_row_id: 0 } };
    }
    const info = st.run(...(params as never[]));
    return { results: [] as Record<string, unknown>[], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  };

  const prepare = (sql: string) => {
    const params: unknown[] = [];
    const api = {
      bind(...values: unknown[]) {
        params.push(...values);
        return api;
      },
      async all() {
        const { results } = exec(sql, params);
        return { results, success: true, meta: { changes: 0 } };
      },
      async first<T = Record<string, unknown>>(column?: string) {
        const { results } = exec(sql, params);
        const row = results[0] ?? null;
        if (!row) return null;
        return (column ? row[column] : row) as T | null;
      },
      async run() {
        const { meta } = exec(sql, params);
        return { success: true, meta };
      },
    };
    return api;
  };

  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    raw.exec('BEGIN');
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      raw.exec('COMMIT');
      return out;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  };

  const db = { prepare, batch, exec: (sql: string) => raw.exec(sql) } as unknown as D1Database;
  // Сырой доступ для тестов-«злых админов» (снять триггер, подменить строку).
  (db as unknown as { __raw: DatabaseSync }).__raw = raw;
  return { db, raw };
}
