import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { verifyLedger } from '../../src/world/ledger';
import { backfillResourceLedger } from '../../src/world/migrate';
import { addResource, applyResourceDelta, getResource } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
}

describe('ресурсы в Ledger (срез 1 этапа 2)', () => {
  it('начисление ресурса пишется в журнал как res:<имя>', () => {
    const { sql, tx } = world();
    tx(() => addResource(sql, 'p1', 'iron_ore', 5, T0 + 1000, 'exp-1'));
    const rows = sql.exec(`SELECT asset, delta, reason FROM ledger WHERE asset LIKE 'res:%'`).toArray();
    expect(rows.length).toBe(1);
    expect(String(rows[0].asset)).toBe('res:iron_ore');
    expect(Number(rows[0].delta)).toBe(5);
    expect(String(rows[0].reason)).toBe('resource_gain');
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(5);
  });

  it('после начисления журнал сходится с остатками', () => {
    const { sql, tx } = world();
    tx(() => addResource(sql, 'p1', 'silicon', 3, T0 + 1000));
    tx(() => addResource(sql, 'p1', 'helium3', 2, T0 + 2000));
    const report = verifyLedger(sql);
    expect(report.ok).toBe(true);
    expect(report.mismatches).toEqual([]);
  });

  it('списание уменьшает остаток и тоже попадает в журнал', () => {
    const { sql, tx } = world();
    tx(() => addResource(sql, 'p1', 'iron_ore', 10, T0 + 1000));
    tx(() => applyResourceDelta(sql, { playerId: 'p1', resource: 'iron_ore', delta: -4, reason: 'craft' }, T0 + 2000));
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(6);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('списать больше, чем есть, нельзя', () => {
    const { sql, tx } = world();
    tx(() => addResource(sql, 'p1', 'iron_ore', 1, T0 + 1000));
    expect(() => tx(() => applyResourceDelta(sql, { playerId: 'p1', resource: 'iron_ore', delta: -5, reason: 'craft' }, T0 + 2000)))
      .toThrow(/insufficient_resources/);
  });

  it('подмена остатка в обход журнала ловится сверкой', () => {
    const { sql, tx } = world();
    tx(() => addResource(sql, 'p1', 'iron_ore', 5, T0 + 1000));
    sql.exec(`UPDATE resources SET amount = 99 WHERE player_id = 'p1' AND resource = 'iron_ore'`);
    const report = verifyLedger(sql);
    expect(report.ok).toBe(false);
    expect(report.mismatches[0]).toMatchObject({ asset: 'res:iron_ore', ledger: 5, balance: 99 });
  });

  it('старый мир с ресурсами без журнала получает обратную заливку', () => {
    const { sql, tx } = makeWorld();
    // Мир до среза 1: ресурсы лежат, записей в журнале нет.
    tx(() => {
      sql.exec('INSERT INTO players (id, level, xp, created_at) VALUES (?, 1, 0, ?)', 'p1', T0);
    });
    sql.exec(`INSERT INTO resources (player_id, resource, amount) VALUES ('p1', 'ice', 7)`);
    expect(verifyLedger(sql).ok).toBe(false);
    tx(() => backfillResourceLedger(sql, T0 + 1000));
    const report = verifyLedger(sql);
    expect(report.ok).toBe(true);
    const row = sql.exec(`SELECT delta, reason, source_ref FROM ledger WHERE asset = 'res:ice'`).toArray();
    expect(Number(row[0].delta)).toBe(7);
    expect(String(row[0].reason)).toBe('migration');
  });

  it('повторная заливка ничего не дублирует', () => {
    const { sql, tx } = makeWorld();
    tx(() => {
      sql.exec('INSERT INTO players (id, level, xp, created_at) VALUES (?, 1, 0, ?)', 'p1', T0);
    });
    sql.exec(`INSERT INTO resources (player_id, resource, amount) VALUES ('p1', 'ice', 4)`);
    tx(() => backfillResourceLedger(sql, T0 + 1000));
    tx(() => backfillResourceLedger(sql, T0 + 2000));
    const rows = sql.exec(`SELECT COUNT(*) AS c FROM ledger WHERE asset = 'res:ice'`).toArray();
    expect(Number(rows[0].c)).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });
});
