import { describe, expect, it } from 'vitest';
import { ensureArchiveSchema, ensurePoolSchema, resetD1BootstrapForTests } from '../../src/db/bootstrap';
import {
  POOL_FEE_BP, addPoolEntry, parsePoolEntry, poolAll, poolLatest, poolReport, summarizePool,
} from '../../src/pool/accounting';

// Пул — деньги, поэтому тесты проверяют арифметику и защиту от двойного учёта,
// а не «красивость» отчёта. D1 подменяется маленькой моделью: реальные запросы
// всё равно проверяются e2e против wrangler dev.

interface Row {
  id: string; kind: string; amount: number; currency: string; ref: string;
  note: string; season_id: string | null; created_at: number;
}

function fakeDb(seed: Row[] = []) {
  const rows = [...seed];
  const statement = (sql: string, params: unknown[]) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const all = async <T,>() => {
      if (q.includes('GROUP BY currency, kind')) {
        const acc = new Map<string, { currency: string; kind: string; total: number }>();
        for (const r of rows) {
          const key = `${r.currency}|${r.kind}`;
          const cur = acc.get(key) ?? { currency: r.currency, kind: r.kind, total: 0 };
          cur.total += r.amount;
          acc.set(key, cur);
        }
        return { results: [...acc.values()] as T[] };
      }
      if (q.includes('FROM pool_entries ORDER BY')) {
        const limit = Number(params[0] ?? 10);
        const sorted = [...rows].sort((a, b) => b.created_at - a.created_at);
        return { results: sorted.slice(0, limit) as T[] };
      }
      throw new Error(`неизвестный SELECT: ${q}`);
    };
    const first = async <T,>() => {
      if (q.includes('WHERE ref = ?')) {
        return (rows.find((r) => r.ref === params[0]) ? { one: 1 } : null) as T | null;
      }
      throw new Error(`неизвестный first: ${q}`);
    };
    const run = async () => {
      if (q.startsWith('INSERT INTO pool_entries')) {
        const [id, kind, amount, currency, ref, note, seasonId, createdAt] = params as [
          string, string, number, string, string, string, string | null, number,
        ];
        if (rows.some((r) => r.ref === ref)) throw new Error('UNIQUE constraint failed: pool_entries.ref');
        rows.push({ id, kind, amount, currency, ref, note, season_id: seasonId, created_at: createdAt });
        return { success: true, meta: { changes: 1 }, results: [] };
      }
      throw new Error(`неизвестный INSERT: ${q}`);
    };
    return { all, first, run };
  };
  return {
    rows,
    prepare(sql: string) {
      const plain = statement(sql, []);
      return { ...plain, bind: (...params: unknown[]) => statement(sql, params) };
    },
  } as unknown as D1Database & { rows: Row[] };
}

describe('учёт пула (5.1)', () => {
  it('считает взносы, резерв 20 % и остаток по правилам', () => {
    const totals = summarizePool([
      { kind: 'in', amount: 100_000, currency: 'EUR' },
      { kind: 'in', amount: 25_550, currency: 'EUR' },
      { kind: 'out', amount: 40_000, currency: 'EUR' },
      { kind: 'ops', amount: 12_000, currency: 'EUR' },
    ]);
    expect(totals).toHaveLength(1);
    const t = totals[0];
    expect(t.in).toBe(125_550);
    expect(t.feeReserved).toBe(Math.floor((125_550 * POOL_FEE_BP) / 10_000));
    expect(t.prizeFund).toBe(125_550 - t.feeReserved);
    expect(t.prizes).toBe(40_000);
    expect(t.ops).toBe(12_000);
    // Остаток на счетах — это деньги, а не «фонд минус резерв».
    expect(t.balance).toBe(125_550 - 40_000 - 12_000);
    expect(t.available).toBe(t.prizeFund - 40_000);
  });

  it('валюты не складывает: у каждой свой итог', () => {
    const totals = summarizePool([
      { kind: 'in', amount: 10_000, currency: 'USD' },
      { kind: 'in', amount: 5_000, currency: 'EUR' },
    ]);
    expect(totals.map((t) => t.currency)).toEqual(['EUR', 'USD']);
    expect(totals[1].in).toBe(10_000);
  });

  it('пустой пул — это нули, а не ошибка', () => {
    expect(summarizePool([])).toEqual([]);
  });

  it('проверяет тело записи и публичную заметку', () => {
    const ok = parsePoolEntry({ kind: 'in', amount: 1500, currency: 'eur', ref: 'pay_1-abc', note: '  взнос   за март  ' });
    expect(ok).toEqual({ kind: 'in', amount: 1500, currency: 'EUR', ref: 'pay_1-abc', note: 'взнос за март', seasonId: null });

    expect(() => parsePoolEntry({ kind: 'hack', amount: 1, currency: 'EUR', ref: 'abc' })).toThrowError(/bad_pool_kind/);
    expect(() => parsePoolEntry({ kind: 'in', amount: 0, currency: 'EUR', ref: 'abc' })).toThrowError(/bad_pool_amount/);
    expect(() => parsePoolEntry({ kind: 'in', amount: 1.5, currency: 'EUR', ref: 'abc' })).toThrowError(/bad_pool_amount/);
    expect(() => parsePoolEntry({ kind: 'in', amount: 10, currency: 'BTC', ref: 'abc' })).toThrowError(/bad_pool_currency/);
    expect(() => parsePoolEntry({ kind: 'in', amount: 10, currency: 'EUR', ref: 'x' })).toThrowError(/bad_pool_ref/);
    expect(() => parsePoolEntry({ kind: 'in', amount: 10, currency: 'EUR', ref: 'a b' })).toThrowError(/bad_pool_ref/);

    const longNote = parsePoolEntry({ kind: 'in', amount: 10, currency: 'EUR', ref: 'abc', note: 'x'.repeat(400) });
    expect(longNote.note).toHaveLength(200);
  });

  it('повторный платёж с тем же ref не удваивает отчёт', async () => {
    const db = fakeDb();
    const input = parsePoolEntry({ kind: 'in', amount: 4900, currency: 'EUR', ref: 'pay-42', note: 'первый' });
    await addPoolEntry(db, input, 1000);
    await expect(addPoolEntry(db, input, 2000)).rejects.toThrowError(/pool_ref_exists/);
    expect(db.rows).toHaveLength(1);
    const totals = summarizePool(db.rows.map((r) => ({ kind: r.kind as 'in', amount: r.amount, currency: r.currency })));
    expect(totals[0].in).toBe(4900);
  });

  it('публичный отчёт не отдаёт ref и id, админский — отдаёт', async () => {
    const db = fakeDb();
    await addPoolEntry(db, parsePoolEntry({ kind: 'in', amount: 3000, currency: 'USD', ref: 'pay-secret-7' }), 5000);
    const report = await poolReport(db, 6000);
    expect(report.payoutsEnabled).toBe(false);
    expect(report.currency).toBe('USD');
    expect(JSON.stringify(report.latest)).not.toContain('pay-secret-7');
    expect(report.totals[0]).toMatchObject({ currency: 'USD', in: 3000 });

    const admin = await poolAll(db, 10);
    expect(admin[0].ref).toBe('pay-secret-7');

    const latest = await poolLatest(db, 5);
    expect(latest).toHaveLength(1);
    expect(latest[0].note).toBe('');
  });
});

describe('само-лечение схемы D1', () => {
  it('создаёт таблицы пула один раз за изолят, даже при нескольких запросах', async () => {
    resetD1BootstrapForTests();
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          async run() {
            calls.push(sql.replace(/\s+/g, ' ').trim());
            return { success: true };
          },
          bind() { return this; },
          async all() { return { results: [] }; },
          async first() { return null; },
        };
      },
    } as unknown as D1Database;

    const [a, b] = await Promise.all([ensurePoolSchema(db), ensurePoolSchema(db)]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls.filter((c) => c.startsWith('CREATE TABLE IF NOT EXISTS pool_entries'))).toHaveLength(1);
    expect(calls.some((c) => c.includes('idx_pool_entries'))).toBe(true);
    // После успеха повторный вызов не делает DDL.
    await ensurePoolSchema(db);
    expect(calls.filter((c) => c.startsWith('CREATE TABLE IF NOT EXISTS pool_entries'))).toHaveLength(1);
  });

  it('после ошибки пробует снова, а не залипает на false', async () => {
    resetD1BootstrapForTests();
    let fail = true;
    const db = {
      prepare() {
        return {
          async run() {
            if (fail) throw new Error('D1 недоступна');
            return { success: true };
          },
        };
      },
    } as unknown as D1Database;

    expect(await ensurePoolSchema(db)).toBe(false);
    fail = false;
    expect(await ensurePoolSchema(db)).toBe(true);
  });

  it('архив этапа 3 тоже создаёт свои таблицы', async () => {
    resetD1BootstrapForTests();
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        return { async run() { calls.push(sql); return { success: true }; } };
      },
    } as unknown as D1Database;
    expect(await ensureArchiveSchema(db)).toBe(true);
    expect(calls.join(' ')).toContain('season_history');
    expect(calls.join(' ')).toContain('world_snapshots');
  });
});
