import { describe, expect, it } from 'vitest';
import { DAY_MS, EXPEDITION_KINDS, START_ASTRA, START_FUEL } from '../../src/shared/constants';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { collectExpedition, startExpedition } from '../../src/world/modules/expeditions';
import { createPlayer, getPlayerState } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;
const S = EXPEDITION_KINDS.short;
const setup = () => {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
};
const count = (sql: SqlStorage, table: string) => Number(sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).toArray()[0].c);

describe('startExpedition', () => {
  it('списывает топливо, отправляет корабль, ставит время окончания', () => {
    const { sql, tx } = setup();
    const r = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    expect(r.endsAt).toBe(T0 + S.durationMs);
    expect(getBalance(sql, 'p1', 'fuel')).toBe(START_FUEL - S.fuel);
    expect(getPlayerState(sql, 'p1').ships[0].status).toBe('away');
    expect(getPlayerState(sql, 'p1').expeditions.length).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });
  it('повтор с тем же ключом не создаёт вторую экспедицию', () => {
    const { sql, tx } = setup();
    const a = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    const b = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0 + 1000));
    expect(b).toEqual(a);
    expect(count(sql, 'expeditions')).toBe(1);
    expect(getBalance(sql, 'p1', 'fuel')).toBe(START_FUEL - S.fuel);
  });
  it('занятый корабль — отказ', () => {
    const { sql, tx } = setup();
    tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    expect(() => tx(() => startExpedition(sql, 'p1', 'k2', { kind: 'short' }, T0 + 1))).toThrow(/no_idle_ship/);
    const shipId = String(getPlayerState(sql, 'p1').ships[0].id);
    expect(() => tx(() => startExpedition(sql, 'p1', 'k3', { kind: 'short', shipId }, T0 + 1))).toThrow(/ship_busy/);
  });
  it('без топлива — отказ, ничего не меняется', () => {
    const { sql, tx } = setup();
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'fuel', delta: -START_FUEL, reason: 'test' }, T0));
    expect(() => tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0))).toThrow(/insufficient_funds/);
    expect(getPlayerState(sql, 'p1').ships[0].status).toBe('idle');
    expect(count(sql, 'expeditions')).toBe(0);
  });
  it('неизвестный тип и неизвестный игрок — ошибка', () => {
    const { sql, tx } = setup();
    expect(() => tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'bogus' as never }, T0))).toThrow(/bad_expedition_kind/);
    expect(() => tx(() => startExpedition(sql, 'ghost', 'k2', { kind: 'short' }, T0))).toThrow(/player_not_found/);
  });
});

describe('collectExpedition', () => {
  it('раньше срока — отказ без изменений, потом срабатывает', () => {
    const { sql, tx } = setup();
    const s = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    const early = tx(() => collectExpedition(sql, 'p1', 'c1', s.id, T0 + 1000, () => 0));
    expect(early.ok).toBe(false);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA);
    expect(getPlayerState(sql, 'p1').ships[0].status).toBe('away');
    const done = tx(() => collectExpedition(sql, 'p1', 'c2', s.id, s.endsAt, () => 0));
    expect(done.ok).toBe(true);
  });
  it('награда в пределах диапазона, корабль возвращается, ledger сходится', () => {
    for (const [rng, expected] of [[0, S.rewardMin], [0.9999999, S.rewardMax], [1, S.rewardMax]] as const) {
      const { sql, tx } = setup();
      const s = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
      const r = tx(() => collectExpedition(sql, 'p1', 'c1', s.id, s.endsAt, () => rng));
      expect(r.ok && r.reward).toBe(expected);
      expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + expected);
      expect(getPlayerState(sql, 'p1').ships[0].status).toBe('idle');
      expect(getPlayerState(sql, 'p1').expeditions.length).toBe(0);
      expect(verifyLedger(sql).ok).toBe(true);
    }
  });
  it('повтор с тем же ключом возвращает тот же ответ, с другим — already_collected', () => {
    const { sql, tx } = setup();
    const s = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    const a = tx(() => collectExpedition(sql, 'p1', 'c1', s.id, s.endsAt, () => 0.5));
    const again = tx(() => collectExpedition(sql, 'p1', 'c1', s.id, s.endsAt + 5, () => 0.1));
    expect(again).toEqual(a);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + (a.ok ? a.reward : 0));
    expect(() => tx(() => collectExpedition(sql, 'p1', 'c2', s.id, s.endsAt + 5))).toThrow(/already_collected/);
  });
  it('50 попыток с разными ключами дают ровно одну награду', () => {
    const { sql, tx } = setup();
    const s = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    let ok = 0;
    for (let i = 0; i < 50; i++) {
      try { if (tx(() => collectExpedition(sql, 'p1', `c${i}`, s.id, s.endsAt, () => 0)).ok) ok++; } catch { /* already_collected */ }
    }
    expect(ok).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });
  it('чужая или несуществующая экспедиция — expedition_not_found', () => {
    const { sql, tx } = setup();
    tx(() => createPlayer(sql, 'p2', T0));
    const s = tx(() => startExpedition(sql, 'p1', 'k1', { kind: 'short' }, T0));
    expect(() => tx(() => collectExpedition(sql, 'p2', 'c1', s.id, s.endsAt))).toThrow(/expedition_not_found/);
    expect(() => tx(() => collectExpedition(sql, 'p1', 'c2', 'nope', s.endsAt))).toThrow(/expedition_not_found/);
  });
});
