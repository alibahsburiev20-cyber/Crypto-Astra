// Мини-обёртка над node:sqlite, похожая на SqlStorage Durable Object.
// Нужна, чтобы гонять логику мира (ledger, баланс, claim) в обычном Node без Workers.
import { DatabaseSync } from 'node:sqlite';
import { WORLD_SCHEMA } from '../../src/world/schema';

export function makeWorld() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(q: string, ...b: unknown[]) {
      const st = db.prepare(q);
      const rows: Record<string, unknown>[] = /^\s*(SELECT|PRAGMA)/i.test(q) ? (st.all(...(b as never[])) as never) : (st.run(...(b as never[])), []);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  } as unknown as SqlStorage;
  // Аналог ctx.storage.transactionSync: при исключении всё откатывается.
  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  for (const s of WORLD_SCHEMA) db.exec(s);
  return { db, sql, tx };
}
