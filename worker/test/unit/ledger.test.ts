import { describe, expect, it } from 'vitest';
import { CLAIM_INTERVAL_MS, CLAIM_REWARD, DAY_MS, START_ASTRA, START_FUEL, WORLD_CAPACITY } from '../../src/shared/constants';
import { applyDelta, getBalance } from '../../src/world/balances';
import { withIdempotency } from '../../src/world/idempotency';
import { verifyLedger } from '../../src/world/ledger';
import { claim } from '../../src/world/modules/claim';
import { createPlayer, getPlayerState } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;
const count = (sql: SqlStorage, table: string) => Number(sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).toArray()[0].c);

describe('createPlayer', () => {
  it('выдаёт Scout, 500 ASTRA, 3 топлива и пишет ledger', () => {
    const { sql, tx } = makeWorld();
    expect(tx(() => createPlayer(sql, 'p1', T0)).created).toBe(true);
    const s = getPlayerState(sql, 'p1');
    expect(s.balances).toEqual({ astra: START_ASTRA, fuel: START_FUEL, points: 0 });
    expect(s.ships.length).toBe(1);
    expect(count(sql, 'ledger')).toBe(2);
    expect(verifyLedger(sql).ok).toBe(true);
  });
  it('повторный вызов ничего не меняет', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    expect(tx(() => createPlayer(sql, 'p1', T0 + 1)).created).toBe(false);
    expect(count(sql, 'ledger')).toBe(2);
  });
  it('мир не принимает больше 100 игроков', () => {
    const { sql, tx } = makeWorld();
    for (let i = 0; i < WORLD_CAPACITY; i++) tx(() => createPlayer(sql, `p${i}`, T0));
    expect(() => tx(() => createPlayer(sql, 'extra', T0))).toThrow(/world_full/);
    expect(count(sql, 'players')).toBe(WORLD_CAPACITY);
  });
});

describe('claim', () => {
  it('начисляет награду, повтор с тем же ключом возвращает тот же ответ', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const a = tx(() => claim(sql, 'p1', 'k1', T0));
    const b = tx(() => claim(sql, 'p1', 'k1', T0 + 5000));
    expect(a.ok).toBe(true);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + CLAIM_REWARD);
  });
  it('другой ключ раньше интервала — отказ, баланс не меняется', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => claim(sql, 'p1', 'k1', T0));
    const r = tx(() => claim(sql, 'p1', 'k2', T0 + 1000));
    expect(r.ok).toBe(false);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + CLAIM_REWARD);
  });
  it('через 15 минут снова начисляет', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => claim(sql, 'p1', 'k1', T0));
    expect(tx(() => claim(sql, 'p1', 'k2', T0 + CLAIM_INTERVAL_MS)).ok).toBe(true);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + CLAIM_REWARD * 2);
  });
  it('1000 запросов подряд дают ровно одно начисление', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    let okCount = 0;
    for (let i = 0; i < 1000; i++) if (tx(() => claim(sql, 'p1', `k${i}`, T0)).ok) okCount++;
    expect(okCount).toBe(1);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + CLAIM_REWARD);
    expect(verifyLedger(sql).ok).toBe(true);
  });
  it('неизвестный игрок — ошибка', () => {
    const { sql, tx } = makeWorld();
    expect(() => tx(() => claim(sql, 'ghost', 'k', T0))).toThrow(/player_not_found/);
  });
});

describe('idempotency', () => {
  it('тот же ключ с другим телом — отказ', () => {
    const { sql, tx } = makeWorld();
    tx(() => withIdempotency(sql, 'p1', 'r', 'k', { a: 1 }, T0, () => ({ value: 1, store: true })));
    expect(() => tx(() => withIdempotency(sql, 'p1', 'r', 'k', { a: 2 }, T0, () => ({ value: 2, store: true })))).toThrow(/idempotency_key_reused/);
  });
  it('без ключа — отказ', () => {
    const { sql, tx } = makeWorld();
    expect(() => tx(() => withIdempotency(sql, 'p1', 'r', '', {}, T0, () => ({ value: 1, store: true })))).toThrow(/idempotency_key_required/);
  });
});

describe('ledger', () => {
  it('нельзя уйти в минус, операция откатывается целиком', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const before = count(sql, 'ledger');
    expect(() => tx(() => applyDelta(sql, { playerId: 'p1', asset: 'astra', delta: -(START_ASTRA + 1), reason: 'test' }, T0))).toThrow(/insufficient_funds/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA);
    expect(count(sql, 'ledger')).toBe(before);
  });
  it('триггеры запрещают UPDATE и DELETE', () => {
    const { db, sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    expect(() => db.exec('UPDATE ledger SET delta = 999 WHERE seq = 1')).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM ledger WHERE seq = 1')).toThrow(/append-only/);
  });
  it('подмена старой записи (в обход триггера) ломает цепочку', () => {
    const { db, sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => claim(sql, 'p1', 'k1', T0));
    db.exec('DROP TRIGGER ledger_no_update');
    db.exec('UPDATE ledger SET delta = 999 WHERE seq = 1');
    const r = verifyLedger(sql);
    expect(r.ok).toBe(false);
    expect(r.brokenAtSeq).toBe(1);
  });
  it('сверка находит расхождение balances и ledger', () => {
    const { db, sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    db.exec(`UPDATE balances SET amount = amount + 1 WHERE player_id = 'p1' AND asset = 'astra'`);
    const r = verifyLedger(sql);
    expect(r.ok).toBe(false);
    expect(r.mismatches.length).toBe(1);
    expect(r.mismatches[0].balance - r.mismatches[0].ledger).toBe(1);
  });
});
