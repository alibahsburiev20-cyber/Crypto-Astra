// Миграции D1 обязаны быть идемпотентными.
//
// Прод деплоится из браузера, поэтому таблицы создаёт код (`ensurePaySchema`,
// `ensurePoolSchema`), а журнал `d1_migrations` может отставать: таблицы есть,
// записи о миграции нет. Агент, который придёт настраивать прод, увидит именно
// это и должен иметь право просто прогнать `migrations apply` — без «удалить и
// создать заново».
//
// Здесь два стража:
//   1) в каждом файле миграций каждый CREATE объявлен с `IF NOT EXISTS`;
//   2) повторный прогон файлов на живой базе не меняет схему и не теряет строки.
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { PAY_PARTIAL_INDEXES, PAY_STATEMENTS, PAY_TRIGGERS } from '../../src/pay/schema';

const DIR = new URL('../../migrations/d1/', import.meta.url);
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
/**
 * Рантайм создаёт только эти объекты. `0001–0005` в проде применены журналом.
 *
 * `0008` здесь не случайна: её прогоняет агент на уже живой базе, где таблицы
 * мог создать код, — значит и «все CREATE с IF NOT EXISTS», и «второй прогон
 * ничего не меняет» обязаны для неё выполняться на тех же правах.
 */
const SELF_HEALED = ['0006_pool.sql', '0007_astra_pay.sql', '0008_pay_addresses_chain.sql'];

function sqlOf(files: string[] = FILES): string {
  return files.map((f) => readFileSync(new URL(f, DIR), 'utf8')).join('\n');
}

/** Снимок схемы: имя + нормализованный SQL каждого объекта. */
function snapshot(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => {
      const row = r as { type: string; name: string; sql: string };
      // Текст DDL в миграции и в коде отличается только комментариями и
      // пробелом перед закрывающей скобкой — сравниваем структуру, не буквы.
      const sql = String(row.sql)
        .replace(/--[^\n]*/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+\)/g, ')')
        .trim();
      return `${row.type}|${row.name}|${sql}`;
    });
}

describe('миграции D1 идемпотентны', () => {
  it('каждый CREATE в файлах миграций — IF NOT EXISTS', () => {
    const offenders: string[] = [];
    for (const file of SELF_HEALED) {
      const text = readFileSync(new URL(file, DIR), 'utf8');
      for (const line of text.split('\n')) {
        if (!/^CREATE\s/i.test(line.trim())) continue;
        if (!/\bIF NOT EXISTS\b/i.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('повторный прогон не меняет схему и не теряет данные', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sqlOf(SELF_HEALED));
    const before = snapshot(db);

    db.exec(`INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
             VALUES ('pl_1', 'u1', 'USDT', 1000000, 'deposit', 's1', 'k1', '', 'h1', 1)`);

    // «Журнал отстал»: файлы прогоняются ещё раз на уже готовой базе.
    expect(() => db.exec(sqlOf(SELF_HEALED))).not.toThrow();

    expect(snapshot(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS c FROM pay_ledger').get()).toEqual({ c: 1 });
  });

  it('0008 на старой базе переносит строки, а второй прогон их не трогает', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sqlOf(['0006_pool.sql', '0007_astra_pay.sql']));
    db.prepare(`INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, active, last_scanned_ts, created_at)
                VALUES ('a1', 'u1', 'TTTT', '41aa', 7, 1, 12345, 999)`).run();

    db.exec(readFileSync(new URL('0008_pay_addresses_chain.sql', DIR), 'utf8'));
    const after = db.prepare('SELECT * FROM pay_addresses').all();
    expect(after).toEqual([{
      id: 'a1', user_id: 'u1', chain: 'tron', address: 'TTTT', hex: '41aa',
      derivation_index: 7, active: 1, last_scanned_ts: 12345, created_at: 999,
    }]);

    // «Агент запустил migrations apply второй раз»: схему и строки не меняем.
    const before = snapshot(db);
    db.exec(readFileSync(new URL('0008_pay_addresses_chain.sql', DIR), 'utf8'));
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare('SELECT * FROM pay_addresses').all()).toEqual(after);
  });

  it('код рантайма и миграции дают одну и ту же схему денег', () => {
    // Прод-путь: таблицы создал `ensurePaySchema`, потом доехали миграции.
    const runtimeFirst = new DatabaseSync(':memory:');
    for (const s of PAY_STATEMENTS) runtimeFirst.exec(s);
    for (const s of PAY_PARTIAL_INDEXES) runtimeFirst.exec(s);
    for (const s of PAY_TRIGGERS) runtimeFirst.exec(s);
    expect(() => runtimeFirst.exec(sqlOf(['0007_astra_pay.sql', '0008_pay_addresses_chain.sql']))).not.toThrow();

    // Эталон: только миграция.
    const migrationOnly = new DatabaseSync(':memory:');
    migrationOnly.exec(sqlOf(['0007_astra_pay.sql', '0008_pay_addresses_chain.sql']));

    const payOnly = (db: DatabaseSync) => snapshot(db).filter((line) => line.includes('|pay_'));
    expect(payOnly(runtimeFirst)).toEqual(payOnly(migrationOnly));
  });
});
