import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { verifyLedger } from '../../src/world/ledger';
import { backfillProgressLedger } from '../../src/world/migrate';
import { levelFromXp } from '../../src/world/modules/expeditionMath';
import { createPlayer } from '../../src/world/modules/players';
import { applyDurability, applyXp, getDurability, getXp } from '../../src/world/modules/progress';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
}

function shipId(sql: SqlStorage): string {
  return String(sql.exec('SELECT id FROM ships LIMIT 1').toArray()[0].id);
}

describe('опыт и прочность в журнале (срез 2 этапа 2)', () => {
  it('новый игрок сразу сходится: прочность корабля в журнале', () => {
    const { sql } = world();
    expect(getDurability(sql, shipId(sql))).toBe(100);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('опыт пишется в журнал и поднимает уровень', () => {
    const { sql, tx } = world();
    tx(() => applyXp(sql, { playerId: 'p1', delta: 250, reason: 'expedition_reward', sourceRef: 'e1' }, T0 + 1000, levelFromXp));
    expect(getXp(sql, 'p1')).toBe(250);
    const row = sql.exec(`SELECT asset, delta FROM ledger WHERE asset = 'xp'`).toArray();
    expect(String(row[0].asset)).toBe('xp');
    expect(Number(row[0].delta)).toBe(250);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('износ списывает прочность через журнал', () => {
    const { sql, tx } = world();
    const id = shipId(sql);
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: -15, reason: 'expedition_wear' }, T0 + 1000));
    expect(getDurability(sql, id)).toBe(85);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('износ больше остатка списывает только то, что есть', () => {
    const { sql, tx } = world();
    const id = shipId(sql);
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: -30, reason: 'expedition_wear' }, T0 + 1000));
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: -90, reason: 'expedition_wear' }, T0 + 2000));
    expect(getDurability(sql, id)).toBe(0);
    // в журнале −30 и −70, а не −30 и −90
    const deltas = sql.exec(`SELECT delta FROM ledger WHERE asset = ? ORDER BY seq`, `dur:${id}`).toArray().map((r) => Number(r.delta));
    expect(deltas).toEqual([100, -30, -70]);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('ремонт возвращает прочность и тоже пишется в журнал', () => {
    const { sql, tx } = world();
    const id = shipId(sql);
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: -25, reason: 'expedition_wear' }, T0 + 1000));
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: 25, reason: 'repair', sourceRef: id }, T0 + 2000));
    expect(getDurability(sql, id)).toBe(100);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('подмена прочности в обход журнала ловится сверкой', () => {
    const { sql } = world();
    const id = shipId(sql);
    sql.exec('UPDATE ships SET durability = 12 WHERE id = ?', id);
    const report = verifyLedger(sql);
    expect(report.ok).toBe(false);
    expect(report.mismatches[0]).toMatchObject({ asset: `dur:${id}`, ledger: 100, balance: 12 });
  });

  it('подмена опыта в обход журнала ловится сверкой', () => {
    const { sql } = world();
    sql.exec(`UPDATE players SET xp = 999 WHERE id = 'p1'`);
    const report = verifyLedger(sql);
    expect(report.ok).toBe(false);
    expect(report.mismatches[0]).toMatchObject({ asset: 'xp', ledger: 0, balance: 999 });
  });

  it('старый мир с опытом и прочностью без журнала получает обратную заливку', () => {
    const { sql, tx } = makeWorld();
    // Мир до среза 2: опыт и прочность есть, записей в журнале нет.
    const id = 'ship-legacy';
    tx(() => {
      sql.exec('INSERT INTO players (id, level, xp, created_at) VALUES (?, 3, 620, ?)', 'p1', T0);
      sql.exec(`INSERT INTO ships (id, player_id, type, durability, status) VALUES (?, 'p1', 'scout', 64, 'idle')`, id);
    });
    expect(verifyLedger(sql).ok).toBe(false);
    tx(() => backfillProgressLedger(sql, T0 + 1000));
    const report = verifyLedger(sql);
    expect(report.ok).toBe(true);
    const xp = sql.exec(`SELECT delta FROM ledger WHERE asset = 'xp'`).toArray();
    expect(Number(xp[0].delta)).toBe(620);
    const dur = sql.exec('SELECT delta FROM ledger WHERE asset = ?', `dur:${id}`).toArray();
    expect(Number(dur[0].delta)).toBe(64);
  });

  it('повторная заливка прогресса ничего не дублирует', () => {
    const { sql, tx } = makeWorld();
    tx(() => {
      sql.exec('INSERT INTO players (id, level, xp, created_at) VALUES (?, 2, 300, ?)', 'p1', T0);
      sql.exec(`INSERT INTO ships (id, player_id, type, durability, status) VALUES ('s1', 'p1', 'scout', 90, 'idle')`);
    });
    tx(() => backfillProgressLedger(sql, T0 + 1000));
    tx(() => backfillProgressLedger(sql, T0 + 2000));
    expect(Number(sql.exec(`SELECT COUNT(*) AS c FROM ledger WHERE asset = 'xp'`).toArray()[0].c)).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });
});
