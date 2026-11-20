import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  PAY_PARTIAL_INDEXES, PAY_SCHEMA_VERSION, PAY_STATEMENTS, PAY_TABLES, PAY_TRIGGERS,
  ensurePaySchema, resetPaySchemaForTests,
} from '../../src/pay/schema';

// Схема денежного контура проверяется настоящим SQLite (node:sqlite), а не
// моком: ошибка в DDL стоит дорого, а поймать её нужно до первой копейки.
// Главное здесь — инварианты: один адрес на игрока, один открытый счёт, одно
// событие блокчейна, append-only журналы, защита от двойного учёта.

const MIGRATION = new URL('../../migrations/d1/0007_astra_pay.sql', import.meta.url);

function fromMigration(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  return db;
}

function fromCode(times = 1): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (let i = 0; i < times; i += 1) {
    for (const s of PAY_STATEMENTS) db.exec(s);
    for (const s of PAY_PARTIAL_INDEXES) db.exec(s);
    for (const s of PAY_TRIGGERS) db.exec(s);
  }
  return db;
}

function tables(db: DatabaseSync): string[] {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pay_%' ORDER BY name")
    .all().map((r) => String((r as { name: string }).name));
}

function columns(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map((r) => String((r as { name: string }).name));
}

const T0 = 1_700_000_000_000;

describe('схема pay_*', () => {
  it('миграция создаёт ровно 14 таблиц', () => {
    const db = fromMigration();
    expect(tables(db)).toEqual([...PAY_TABLES].sort());
    expect(PAY_SCHEMA_VERSION).toBe(1);
  });

  it('код и миграция не расходятся по колонкам', () => {
    const a = fromMigration();
    const b = fromCode();
    for (const table of PAY_TABLES) expect(columns(b, table)).toEqual(columns(a, table));
  });

  it('повторное применение идемпотентно', () => {
    const db = fromCode(3);
    expect(tables(db)).toEqual([...PAY_TABLES].sort());
  });

  it('pay_ledger и pay_audit_log нельзя изменить или удалить', () => {
    const db = fromMigration();
    db.prepare(`INSERT INTO pay_ledger (id, user_id, delta, reason, idem_key, created_at)
                VALUES ('l1', 'u1', 1000000, 'deposit', 'dep:1', ?)`).run(T0);
    expect(() => db.prepare("UPDATE pay_ledger SET delta = 5 WHERE id = 'l1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM pay_ledger WHERE id = 'l1'").run())
      .toThrow(/append-only/);

    db.prepare(`INSERT INTO pay_audit_log (id, actor, action, created_at) VALUES ('a1', 'admin', 'ok', ?)`).run(T0);
    expect(() => db.prepare("DELETE FROM pay_audit_log WHERE id = 'a1'").run())
      .toThrow(/append-only/);
  });

  it('одна и та же операция не попадает в Ledger дважды', () => {
    const db = fromMigration();
    const insert = db.prepare(`INSERT INTO pay_ledger (id, user_id, delta, reason, idem_key, created_at)
                               VALUES (?, 'u1', 1000000, 'deposit', 'dep:tx1:0', ?)`);
    insert.run('l1', T0);
    expect(() => insert.run('l2', T0)).toThrow(/UNIQUE/);
  });

  it('сумма строго положительная и целая, нулевая дельта запрещена', () => {
    const db = fromMigration();
    expect(() => db.prepare(`INSERT INTO pay_deposits
      (id, txid, event_index, user_id, address, amount_micro, created_at)
      VALUES ('d1', 'tx', 0, 'u1', 'TAddr', 0, ?)`).run(T0)).toThrow(/CHECK/);
    expect(() => db.prepare(`INSERT INTO pay_ledger (id, user_id, delta, reason, idem_key, created_at)
      VALUES ('l1', 'u1', 0, 'adjust', 'k', ?)`).run(T0)).toThrow(/CHECK/);
  });

  it('одно событие блокчейна — одна строка', () => {
    const db = fromMigration();
    const insert = db.prepare(`INSERT INTO pay_deposits
      (id, txid, event_index, user_id, address, amount_micro, created_at)
      VALUES (?, 'tx1', 0, 'u1', 'TAddr', 1000000, ?)`);
    insert.run('d1', T0);
    expect(() => insert.run('d2', T0)).toThrow(/UNIQUE/);
  });

  it('у игрока один адрес и один открытый счёт', () => {
    const db = fromMigration();
    const addr = db.prepare(`INSERT INTO pay_addresses
      (id, user_id, address, hex, derivation_index, created_at) VALUES (?, 'u1', ?, ?, ?, ?)`);
    addr.run('a1', 'TAddr1', '41aa', 0, T0);
    expect(() => addr.run('a2', 'TAddr2', '41bb', 1, T0)).toThrow(/UNIQUE/);
    expect(() => addr.run('a3', 'TAddr3', '41cc', 0, T0)).toThrow(/UNIQUE/);

    const inv = db.prepare(`INSERT INTO pay_invoices
      (id, user_id, amount_micro, address, created_at, expires_at) VALUES (?, 'u1', 1000000, 'TAddr1', ?, ?)`);
    inv.run('i1', T0, T0 + 900_000);
    expect(() => inv.run('i2', T0, T0 + 900_000)).toThrow(/UNIQUE/);
    db.prepare("UPDATE pay_invoices SET status = 'paid' WHERE id = 'i1'").run();
    inv.run('i2', T0, T0 + 900_000); // новый счёт после закрытия старого — можно
  });

  it('в пуле USDT одновременно открыт только один цикл', () => {
    const db = fromMigration();
    const insert = db.prepare(`INSERT INTO pay_pool_cycles
      (id, period_start, period_end, created_at) VALUES (?, ?, ?, ?)`);
    insert.run('c1', T0, T0 + 86400000, T0);
    expect(() => insert.run('c2', T0, T0 + 86400000, T0)).toThrow(/UNIQUE/);
    db.prepare("UPDATE pay_pool_cycles SET status = 'closed', closed_at = ? WHERE id = 'c1'").run(T0);
    insert.run('c2', T0, T0 + 86400000, T0);
  });

  it('цикл пула не уходит в минус', () => {
    const db = fromMigration();
    expect(() => db.prepare(`INSERT INTO pay_pool_cycles
      (id, period_start, period_end, reserved, created_at)
      VALUES ('c1', ?, ?, -1, ?)`).run(T0, T0 + 1, T0)).toThrow(/CHECK/);
  });

  it('выплата идемпотентна по idem_key, txid уникален, попытки нумеруются', () => {
    const db = fromMigration();
    const w = db.prepare(`INSERT INTO pay_withdrawals
      (id, user_id, address, amount_micro, idem_key, created_at) VALUES (?, 'u1', 'TAddr', 1000000, ?, ?)`);
    w.run('w1', 'wd:1', T0);
    expect(() => w.run('w2', 'wd:1', T0)).toThrow(/UNIQUE/);
    w.run('w3', 'wd:3', T0);
    db.prepare("UPDATE pay_withdrawals SET txid = 'tx1' WHERE id = 'w1'").run();
    expect(() => db.prepare("UPDATE pay_withdrawals SET txid = 'tx1' WHERE id = 'w3'").run())
      .toThrow(/UNIQUE/);

    const p = db.prepare(`INSERT INTO pay_payouts (id, withdrawal_id, attempt) VALUES (?, 'w1', ?)`);
    p.run('p1', 1);
    expect(() => p.run('p2', 1)).toThrow(/UNIQUE/);
    p.run('p3', 2);
  });

  it('неизвестное состояние не сохраняется', () => {
    const db = fromMigration();
    expect(() => db.prepare(`INSERT INTO pay_withdrawals
      (id, user_id, address, amount_micro, status, idem_key, created_at)
      VALUES ('w1', 'u1', 'TAddr', 1, 'done', 'wd:1', ?)`).run(T0)).toThrow(/CHECK/);
  });
});

/** D1-заглушка: считает запросы, DDL проходит успешно. */
function countingDb() {
  const seen: string[] = [];
  const db = {
    prepare(sql: string) {
      return { run: async () => { seen.push(sql); return { success: true }; } };
    },
  } as unknown as D1Database;
  return { db, seen };
}

describe('ensurePaySchema', () => {
  it('создаёт таблицы, индексы и триггеры и не повторяет работу', async () => {
    resetPaySchemaForTests();
    const { db, seen } = countingDb();
    expect(await ensurePaySchema(db)).toBe(true);
    const total = PAY_STATEMENTS.length + PAY_PARTIAL_INDEXES.length + PAY_TRIGGERS.length;
    expect(seen).toHaveLength(total);
    expect(seen.some((s) => s.includes('pay_ledger_no_update'))).toBe(true);

    expect(await ensurePaySchema(db)).toBe(true);
    expect(seen).toHaveLength(total); // промис запомнен на изолят
  });

  it('ошибка не залипает: следующий вызов пробует снова', async () => {
    resetPaySchemaForTests();
    let calls = 0;
    const broken = {
      prepare() {
        calls += 1;
        return { run: async () => { throw new Error('D1 недоступна'); } };
      },
    } as unknown as D1Database;
    expect(await ensurePaySchema(broken)).toBe(false);
    expect(calls).toBe(1);
    expect(await ensurePaySchema(broken)).toBe(false);
    expect(calls).toBe(2);
  });
});
