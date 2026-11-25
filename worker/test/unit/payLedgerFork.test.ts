// Журнал не ветвится: гонка двух начислений и как она выглядит в базе.
//
// Проверяется не «красивый хеш», а то, что два параллельных начисления дают
// линейную цепочку. Раньше оба читали одну и ту же голову и писали две записи с
// одним `prev_hash`; сверка потом видела «цепь порвана» и поднимала стоп-флаг
// выплат на пустом месте.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { PAY_CHAIN_INDEXES, ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { appendPayLedger, creditDeposit, isLedgerForkError, payLedgerHead } from '../../src/pay/ledger';

const T0 = 1_700_000_000_000;

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  return db;
}

const entry = (n: number) => ({
  userId: 'u1',
  delta: 1_000_000 * (n + 1),
  reason: 'deposit' as const,
  sourceRef: `tx_${n}:0`,
  idemKey: `dep:tx_${n}:0`,
  createdAt: T0 + n,
});

async function chain(db: D1Database) {
  const rows = await db.prepare('SELECT prev_hash, hash FROM pay_ledger ORDER BY created_at ASC, rowid ASC')
    .all<{ prev_hash: string; hash: string }>();
  return (rows.results ?? []) as Array<{ prev_hash: string; hash: string }>;
}

describe('цепочка журнала', () => {
  it('индекс на `prev_hash` входит в само-залечиваемую схему', () => {
    expect(PAY_CHAIN_INDEXES.join(' ')).toContain('ux_pay_ledger_prev');
  });

  it('вторая запись на то же место цепи отклоняется базой', async () => {
    const db = await freshDb();
    const head = await payLedgerHead(db);
    await db.prepare(
      `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
       VALUES ('a', 'u1', 'USDT', 1, 'deposit', 's', 'k1', ?, 'h1', ?)`,
    ).bind(head, T0).run();

    let error: unknown = null;
    try {
      await db.prepare(
        `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
         VALUES ('b', 'u1', 'USDT', 2, 'deposit', 's', 'k2', ?, 'h2', ?)`,
      ).bind(head, T0 + 1).run();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(isLedgerForkError(error)).toBe(true);
    // Чужая ошибка (не про форк) не должна молча считаться «место занято».
    expect(isLedgerForkError(new Error('no such table: pay_ledger'))).toBe(false);
  });

  it('два начисления одновременно — цепь остаётся линейной', async () => {
    const db = await freshDb();
    const head = await payLedgerHead(db);
    const [a, b] = await Promise.all([appendPayLedger(db, entry(0)), appendPayLedger(db, entry(1))]);
    expect(a.duplicated).toBe(false);
    expect(b.duplicated).toBe(false);

    const list = await chain(db);
    expect(list.length).toBe(2);
    // Разных `prev_hash` не бывает: то есть ни одна запись не «вторит» чужому месту.
    expect(new Set(list.map((r) => r.prev_hash)).size).toBe(2);
    // И вторая запись стоит после первой, а не рядом с ней.
    expect(list[1].prev_hash).toBe(list[0].hash);
    expect(list[0].prev_hash).toBe(head);
  });

  it('два зачисленных депозита дают два звена цепи, а не два «последних»', async () => {
    // Настоящую параллельность `db.batch` здесь не воспроизвести: фейковая D1
    // не умеет вложенные транзакции («cannot start a transaction within a
    // transaction»), тогда как боевой D1 исполняет их отдельно. Поэтому
    // последовательный прогон: он проверяет, что путь с повтором не ломает
    // обычный сценарий, а сам повтор покрыт тестом `appendPayLedger` выше.
    const db = await freshDb();
    const make = (n: number) => ({
      txid: n.toString(16).padStart(64, '0'),
      eventIndex: 0,
      userId: 'u1',
      address: '0x' + '11'.repeat(20),
      amountMicro: 5_000_000,
      confirmations: 15,
    });

    const first = await creditDeposit(db, make(1) as never, T0);
    const second = await creditDeposit(db, make(2) as never, T0 + 1);
    expect(first.credited && second.credited).toBe(true);
    expect(second.duplicated).toBe(false);
    expect(second.balanceMicro).toBe(10_000_000);

    const list = await chain(db);
    expect(list.length).toBe(2);
    expect(new Set(list.map((r) => r.prev_hash)).size).toBe(2);
  });

  it('повтор той же операции не создаёт вторую запись и не ломает цепь', async () => {
    const db = await freshDb();
    const first = await appendPayLedger(db, entry(3));
    const again = await appendPayLedger(db, entry(3));
    expect(again.duplicated).toBe(true);
    expect(again.hash).toBe(first.hash);
    const rows = await db.prepare('SELECT COUNT(*) AS c FROM pay_ledger').first<number>('c');
    expect(Number(rows)).toBe(1);
  });
});
