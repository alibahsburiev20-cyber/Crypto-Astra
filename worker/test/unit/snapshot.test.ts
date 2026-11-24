import { describe, expect, it } from 'vitest';
import { verifySnapshot, type LedgerRow, type Snapshot } from '../../../scripts/lib/verifySnapshot';
import { DAY_MS } from '../../src/shared/constants';
import { claim } from '../../src/world/modules/claim';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

function snapshotOf(sql: SqlStorage): Snapshot {
  const ledger = sql.exec('SELECT * FROM ledger ORDER BY seq').toArray().map((r) => ({
    seq: Number(r.seq), player_id: String(r.player_id), asset: String(r.asset), delta: Number(r.delta),
    reason: String(r.reason), source_ref: r.source_ref == null ? null : String(r.source_ref),
    idem_key: r.idem_key == null ? null : String(r.idem_key), created_at: Number(r.created_at),
    prev_hash: String(r.prev_hash), hash: String(r.hash),
  })) as LedgerRow[];
  const balances = sql.exec('SELECT player_id, asset, amount FROM balances').toArray().map((r) => ({
    player_id: String(r.player_id), asset: String(r.asset), amount: Number(r.amount),
  }));
  const assets = [
    ...sql.exec('SELECT player_id, resource, amount FROM resources').toArray()
      .map((r) => ({ player_id: String(r.player_id), asset: `res:${String(r.resource)}`, amount: Number(r.amount) })),
    ...sql.exec('SELECT id, xp FROM players').toArray()
      .map((r) => ({ player_id: String(r.id), asset: 'xp', amount: Number(r.xp) })),
    ...sql.exec('SELECT id, player_id, durability FROM ships').toArray()
      .map((r) => ({ player_id: String(r.player_id), asset: `dur:${String(r.id)}`, amount: Number(r.durability) })),
  ];
  return { world_id: 'w-test', ledger, balances, assets };
}

describe('проверка снимка мира', () => {
  it('сходится на настоящем Ledger после Claim', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => claim(sql, 'p1', 'k1', T0));
    const report = verifySnapshot(snapshotOf(sql));
    expect(report.ok).toBe(true);
    // start_bonus ASTRA, start_bonus топливо, ship_delivery прочность, Claim,
    // и Claim теперь пишет ещё и опыт — пятая запись.
    expect(report.rows).toBe(5);
    expect(report.head?.seq).toBe(5);
  });

  it('находит подмену записи', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const snap = snapshotOf(sql);
    snap.ledger[0].delta = 999;
    const report = verifySnapshot(snap);
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toContain('hash');
  });

  it('находит расхождение баланса', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const snap = snapshotOf(sql);
    snap.balances![0].amount += 1;
    const report = verifySnapshot(snap);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('ledger'))).toBe(true);
  });
});
