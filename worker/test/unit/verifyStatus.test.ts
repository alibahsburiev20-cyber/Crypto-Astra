import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { runLedgerVerify, verifyStatus } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

describe('verifyStatus', () => {
  it('до первой сверки отдаёт null/null, а не нули', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    expect(verifyStatus(sql)).toEqual({ at: null, ok: null });
  });

  it('после успешной сверки пишет время и ok=true', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => runLedgerVerify(sql, T0 + 1000));
    expect(verifyStatus(sql)).toEqual({ at: T0 + 1000, ok: true });
  });

  it('при расхождении Ledger отдаёт ok=false', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    // Портим цепочку в обход applyDelta: баланс больше не сходится с журналом.
    sql.exec(`UPDATE balances SET amount = amount + 500 WHERE player_id = 'p1' AND asset = 'astra'`);
    tx(() => runLedgerVerify(sql, T0 + 2000));
    expect(verifyStatus(sql)).toEqual({ at: T0 + 2000, ok: false });
  });
});
