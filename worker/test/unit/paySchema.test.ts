import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  PAY_CHAIN_INDEXES, PAY_PARTIAL_INDEXES, PAY_SCHEMA_VERSION, PAY_STATEMENTS, PAY_TABLES, PAY_TRIGGERS,
  PAY_ADDRESSES_REBUILD, ensurePaySchema, resetPaySchemaForTests, upgradePayAddressChains,
} from '../../src/pay/schema';
import { d1From } from '../helpers/d1';

// Схема денежного контура проверяется настоящим SQLite (node:sqlite), а не
// моком: ошибка в DDL стоит дорого, а поймать её нужно до первой копейки.
// Главное здесь — инварианты: один адрес на пару «игрок + сеть», один открытый
// счёт, одно событие блокчейна, append-only журналы, защита от двойного учёта.

/**
 * Миграции применяются порядком, как их применяет `wrangler d1 migrations apply`:
 * 0007 создаёт таблицы «как было», 0008 перестраивает `pay_addresses` под
 * колонку `chain`. Сверять код с одной только 0007 было бы неправильно:
 * расхождение «до/после» и есть предмет этой миграции.
 */
const MIGRATION_DIR = '../../migrations/d1/';
const MIGRATION_0007 = MIGRATION_DIR + '0007_astra_pay.sql';
const MIGRATIONS = [MIGRATION_0007, MIGRATION_DIR + '0008_pay_addresses_chain.sql'];

function migrationSql(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

function fromMigration(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) db.exec(migrationSql(name));
  return db;
}

/** База «как до миграции 0008»: только 0007, `user_id UNIQUE` на всю таблицу. */
function fromMigrationBefore(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(migrationSql(MIGRATION_0007));
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

/** D1-обёртка над готовой базой: так тест видит «прод до миграции 0008». */
function d1Over(db: DatabaseSync): D1Database {
  return d1From(db).db;
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
  it('миграция создаёт ровно 15 таблиц', () => {
    const db = fromMigration();
    expect(tables(db)).toEqual([...PAY_TABLES].sort());
    // 2 — это «у адреса есть сеть» (`pay_addresses.chain`).
    expect(PAY_SCHEMA_VERSION).toBe(2);
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

  it('у игрока один адрес на сеть и один открытый счёт', () => {
    const db = fromMigration();
    const addr = db.prepare(`INSERT INTO pay_addresses
      (id, user_id, chain, address, hex, derivation_index, created_at)
      VALUES (?, 'u1', ?, ?, ?, ?, ?)`);
    addr.run('a1', 'tron', 'TAddr1', '41aa', 0, T0);
    // Та же сеть, тот же игрок — нельзя: игрок увидел бы два адреса и перевёл
    // деньги на «не тот», а зачтение пошло бы по обоим.
    expect(() => addr.run('a2', 'tron', 'TAddr2', '41bb', 1, T0)).toThrow(/UNIQUE/);
    expect(() => addr.run('a3', 'tron', 'TAddr3', '41cc', 0, T0)).toThrow(/UNIQUE/);
    // Другая сеть — можно: это и есть переезд. Индекс при этом обязан
    // отличаться (один индекс семени = один адрес), адрес тоже уникален.
    addr.run('a4', 'bsc', '0x' + 'aa'.repeat(20), 'aa'.repeat(20), 1, T0);
    expect(() => addr.run('a5', 'bsc', '0x' + 'bb'.repeat(20), 'bb'.repeat(20), 1, T0))
      .toThrow(/UNIQUE/);
    const chains = db.prepare("SELECT chain FROM pay_addresses WHERE user_id = 'u1' ORDER BY chain")
      .all().map((r) => String((r as { chain: string }).chain));
    expect(chains).toEqual(['bsc', 'tron']);
    // Мусор вместо имени сети — отказ, а не «запишем как есть».
    expect(() => addr.run('a6', 'solana', 'SAddr', 'ff', 2, T0)).toThrow(/CHECK/);

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

/**
 * D1-заглушка: считает запросы, DDL проходит успешно.
 *
 * `first()` отвечает так, будто база уже актуальной формы (колонка `chain`
 * есть, строк ноль) — иначе этот тест проверял бы не последовательность DDL, а
 * то, как заглушка умеет делать вид, что она SQLite.
 */
function countingDb() {
  const seen: string[] = [];
  const statement = (sql: string) => ({
    bind() { return statement(sql); },
    run: async () => ({ success: true, meta: { changes: 0 } }),
    first: async () => ({ n: 0, chain: 'tron' }),
    all: async () => ({ results: [] }),
  });
  const db = {
    prepare(sql: string) {
      seen.push(sql);
      return statement(sql);
    },
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      const out: unknown[] = [];
      for (const st of statements) { out.push(await st.run()); }
      return out;
    },
  } as unknown as D1Database;
  return { db, seen };
}

describe('перестройка pay_addresses под сеть (миграция 0008 в коде)', () => {
  it('пустая база «до» получает колонку chain', async () => {
    const raw = fromMigrationBefore();
    expect(columns(raw, 'pay_addresses')).not.toContain('chain');
    await upgradePayAddressChains(d1Over(raw));
    expect(columns(raw, 'pay_addresses')).toEqual([
      'id', 'user_id', 'chain', 'address', 'hex', 'derivation_index', 'active', 'last_scanned_ts', 'created_at',
    ]);
    // Идемпотентность: второй прогон ничего не меняет (DDL в проде применяется
    // на живую базу, и «применилось дважды» не должно стоить данных).
    const indexes = () => raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pay_addresses' ORDER BY name",
    ).all().map((r) => String((r as { name: string }).name));
    const before = indexes();
    await upgradePayAddressChains(d1Over(raw));
    expect(indexes()).toEqual(before);
    expect(before).toContain('ux_pay_addresses_user_chain');
  });

  it('миграция 0008 на непустой базе сохраняет строки и берёт метку сети из формата', () => {
    // Именно так выглядит база, где игроки уже были: перестройка обязана донести
    // каждую строку до новой схемы с той же цепью, иначе «переезд» = «потеря
    // адресов». SQL-миграция это делать умеет (в отличие от кодового пути,
    // который на непустой старой базе останавливается).
    const raw = fromMigrationBefore();
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
                 VALUES ('a1', 'u1', 'TAddr1', '41aa', 0, ?)`).run(T0);
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
                 VALUES ('a2', 'u2', ?, ?, 1, ?)`).run('0x' + 'cc'.repeat(20), 'cc'.repeat(20), T0);
    raw.exec(migrationSql(MIGRATION_DIR + '0008_pay_addresses_chain.sql'));
    const rows = raw.prepare('SELECT user_id, chain, derivation_index FROM pay_addresses ORDER BY derivation_index')
      .all() as Array<{ user_id: string; chain: string; derivation_index: number }>;
    expect(rows).toEqual([
      { user_id: 'u1', chain: 'tron', derivation_index: 0 },
      { user_id: 'u2', chain: 'bsc', derivation_index: 1 },
    ]);
    // Старого ограничения «один адрес на игрока» как не бывало, а индексы
    // по-прежнему не повторяются.
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
                 VALUES ('a3', 'u1', 'bsc', ?, ?, 2, ?)`).run('0x' + 'dd'.repeat(20), 'dd'.repeat(20), T0);
    expect(() => raw.prepare(`INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
      VALUES ('a4', 'u1', 'tron', 'TAddr9', '41ee', 3, ?)`).run(T0)).toThrow(/UNIQUE/);
  });

  it('непустая старая база перестраивается кодом: строки и курсоры на месте', async () => {
    // Ровно состояние прода после деплоя этапа 1: адресов уже два, колонки ещё
    // нет. Ждать, пока кто-то доберётся до терминала и прогонит 0008, значит
    // «приём стоит неизвестно сколько», поэтому перенос делает сам код.
    const raw = fromMigrationBefore();
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, active, last_scanned_ts, created_at)
                 VALUES ('a1', 'u1', 'TAddr1', '41aa', 0, 1, 12345, ?)`).run(T0);
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, active, last_scanned_ts, created_at)
                 VALUES ('a2', 'u2', ?, ?, 1, 0, 0, ?)`).run('0x' + 'cc'.repeat(20), 'cc'.repeat(20), T0);

    await upgradePayAddressChains(d1Over(raw));

    expect(columns(raw, 'pay_addresses')).toContain('chain');
    expect(raw.prepare('SELECT user_id, chain, address, active, last_scanned_ts, derivation_index FROM pay_addresses ORDER BY derivation_index')
      .all()).toEqual([
      { user_id: 'u1', chain: 'tron', address: 'TAddr1', active: 1, last_scanned_ts: 12345, derivation_index: 0 },
      { user_id: 'u2', chain: 'bsc', address: '0x' + 'cc'.repeat(20), active: 0, last_scanned_ts: 0, derivation_index: 1 },
    ]);
    // Снятая с обслуживания строка (`active = 0`) осталась снятой: перестройка
    // не имеет права «вернуть в оборот» чужой адрес.
  });

  it('адрес неизвестной формы = отказ, и база остаётся как была', async () => {
    // «Что-то в колонке address, но не T… и не 0x…» — это ручная правка или
    // битая миграция. Придумывать ему сеть нельзя, а молча перестроить таблицу
    // вокруг мусора — значит потом искать, куда делась строка.
    const raw = fromMigrationBefore();
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
                 VALUES ('a1', 'u1', 'TAddr1', '41aa', 0, ?)`).run(T0);
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
                 VALUES ('a2', 'u2', 'SOL111', 'ff', 1, ?)`).run(T0);

    await expect(upgradePayAddressChains(d1Over(raw))).rejects.toThrow(/миграцию 0008/);
    expect(columns(raw, 'pay_addresses')).not.toContain('chain');
    expect(raw.prepare('SELECT COUNT(*) AS c FROM pay_addresses').get()).toEqual({ c: 2 });
  });

  it('актуальная база — no-op: таблицы и строки не трогаются', async () => {
    const raw = fromMigration();
    raw.prepare(`INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
                 VALUES ('a1', 'u1', 'tron', 'TAddr1', '41aa', 0, ?)`).run(T0);
    const before = raw.prepare('SELECT * FROM pay_addresses').all();
    await upgradePayAddressChains(d1Over(raw));
    expect(raw.prepare('SELECT * FROM pay_addresses').all()).toEqual(before);
  });

  it('перестройка кодом даёт ту же форму таблицы, что миграция', async () => {
    const raw = fromMigrationBefore();
    for (const sql of PAY_ADDRESSES_REBUILD) raw.exec(sql);
    expect(columns(raw, 'pay_addresses')).toEqual(columns(fromMigration(), 'pay_addresses'));
  });
});

describe('ensurePaySchema', () => {
  it('создаёт таблицы, индексы и триггеры и не повторяет работу', async () => {
    resetPaySchemaForTests();
    const { db, seen } = countingDb();
    expect(await ensurePaySchema(db)).toBe(true);
    // +2: `pay_addresses` поднимается и проверяется до общего списка (иначе DDL
    // с `chain` падает на старой базе), поэтому отдельный прогон DDL этой таблицы
    // плюс проба «есть ли колонка chain» — два запроса сверх списка.
    const total = PAY_STATEMENTS.length + PAY_PARTIAL_INDEXES.length
      + PAY_CHAIN_INDEXES.length + PAY_TRIGGERS.length + 2;
    expect(seen).toHaveLength(total);
    expect(seen.some((s) => s.includes('pay_ledger_no_update'))).toBe(true);
    // Индекс против ветвления журнала — отдельной группой: он создаётся с
    // try/catch, чтобы уже существующий форк в проде не обрубил весь контур.
    expect(seen.some((s) => s.includes('ux_pay_ledger_prev'))).toBe(true);

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
