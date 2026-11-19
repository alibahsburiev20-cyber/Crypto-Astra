import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { getBalance } from '../../src/world/balances';
import { migrateLegacyExpeditions, migratePassClaimsSeason } from '../../src/world/migrate';
import { createPlayer } from '../../src/world/modules/players';
import { WORLD_SCHEMA } from '../../src/world/schema';
import { verifyLedger } from '../../src/world/ledger';

const T0 = 86_400_000 * 10;

function legacyWorld() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(q: string, ...b: unknown[]) {
      const st = db.prepare(q);
      const rows: Record<string, unknown>[] = /^\s*(SELECT|PRAGMA)/i.test(q) ? (st.all(...(b as never[])) as never) : (st.run(...(b as never[])), []);
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  } as unknown as SqlStorage;
  const old = WORLD_SCHEMA.filter((s) => !s.includes('expeditions'));
  for (const s of old) db.exec(s);
  db.exec(`CREATE TABLE expeditions (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL, ship_id TEXT NOT NULL,
    kind TEXT NOT NULL, sector INTEGER NOT NULL DEFAULT 1,
    started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', reward_astra INTEGER, collected_at INTEGER)`);
  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return { sql, tx };
}

describe('переход со старой таблицы рейсов', () => {
  it('возвращает топливо и создаёт таблицу с планетой', () => {
    const { sql, tx } = legacyWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const ship = String(sql.exec('SELECT id FROM ships').toArray()[0].id);
    sql.exec(`UPDATE ships SET status = 'away' WHERE id = ?`, ship);
    sql.exec(`INSERT INTO expeditions (id, player_id, ship_id, kind, sector, started_at, ends_at, status) VALUES ('e1', 'p1', ?, 'short', 1, ?, ?, 'active')`, ship, T0, T0 + 1000);
    tx(() => {
      migrateLegacyExpeditions(sql, T0 + 10);
      for (const stmt of WORLD_SCHEMA) sql.exec(stmt);
    });
    expect(getBalance(sql, 'p1', 'fuel')).toBe(4);
    expect(String(sql.exec('SELECT status FROM ships').toArray()[0].status)).toBe('idle');
    const cols = sql.exec('PRAGMA table_info(expeditions)').toArray().map((c) => String(c.name));
    expect(cols).toContain('planet');
    expect(sql.exec('SELECT COUNT(*) AS c FROM expeditions').toArray()[0].c).toBe(0);
    expect(verifyLedger(sql).ok).toBe(true);
  });
  it('старая таблица Pass без сезона пересоздаётся и сохраняет отметки', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE pass_claims (
      player_id TEXT NOT NULL, level INTEGER NOT NULL, claimed_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, level))`);
    db.exec("INSERT INTO pass_claims VALUES ('p1', 3, 1000)");
    const sql = {
      exec(q: string, ...b: unknown[]) {
        const st = db.prepare(q);
        const rows: Record<string, unknown>[] = /^\s*(SELECT|PRAGMA)/i.test(q) ? (st.all(...(b as never[])) as never) : (st.run(...(b as never[])), []);
        return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
      },
    } as unknown as SqlStorage;

    migratePassClaimsSeason(sql);
    migratePassClaimsSeason(sql); // повторный запуск ничего не ломает

    const cols = sql.exec('PRAGMA table_info(pass_claims)').toArray().map((c) => String(c.name));
    expect(cols).toContain('season_id');
    const rows = sql.exec('SELECT player_id, level, season_id FROM pass_claims').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ player_id: 'p1', level: 3, season_id: '' });
  });
});
