import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { runLedgerVerify, verifyStatus, verifyStreak } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

describe('verifyStatus', () => {
  it('до первой сверки отдаёт null/null, а не нули', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    expect(verifyStatus(sql, T0)).toEqual({ at: null, ok: null, streak: 0 });
  });

  it('после успешной сверки пишет время, ok=true и день в историю', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => runLedgerVerify(sql, T0 + 1000));
    expect(verifyStatus(sql, T0 + 1000)).toEqual({ at: T0 + 1000, ok: true, streak: 1 });
  });

  it('при расхождении Ledger отдаёт ok=false и не даёт стрика', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    // Портим цепочку в обход applyDelta: баланс больше не сходится с журналом.
    sql.exec(`UPDATE balances SET amount = amount + 500 WHERE player_id = 'p1' AND asset = 'astra'`);
    tx(() => runLedgerVerify(sql, T0 + 2000));
    expect(verifyStatus(sql, T0 + 2000)).toEqual({ at: T0 + 2000, ok: false, streak: 0 });
  });

  it('семь суток подряд дают стрик 7 — это и закрывает гейт 1', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    for (let d = 0; d < 7; d += 1) tx(() => runLedgerVerify(sql, T0 + d * DAY_MS + 1000));
    expect(verifyStatus(sql, T0 + 6 * DAY_MS + 1000).streak).toBe(7);
  });

  it('повторная сверка в тот же день не накручивает стрик', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    for (let i = 0; i < 5; i += 1) tx(() => runLedgerVerify(sql, T0 + i * 60_000));
    expect(verifyStatus(sql, T0).streak).toBe(1);
  });
});

describe('verifyStreak', () => {
  const day = (d: number, ok = true) => ({ day: d, ok });

  it('пустая история — ноль', () => {
    expect(verifyStreak([], 100)).toBe(0);
  });

  it('считает с сегодняшнего дня', () => {
    expect(verifyStreak([day(100), day(99), day(98)], 100)).toBe(3);
  });

  it('если сегодняшней сверки ещё нет, считает со вчерашней', () => {
    expect(verifyStreak([day(99), day(98)], 100)).toBe(2);
  });

  it('пропущенный день обнуляет счёт', () => {
    expect(verifyStreak([day(100), day(98), day(97)], 100)).toBe(1);
  });

  it('расхождение обнуляет счёт', () => {
    expect(verifyStreak([day(100), day(99, false), day(98)], 100)).toBe(1);
  });
});
