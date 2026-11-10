import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { decideClaim, type ClaimState } from './claimMath';
import { playerExists } from './players';

export type ClaimResult =
  | { ok: true; reward: number; balance: number; nextClaimAt: number }
  | { ok: false; code: 'too_early' | 'daily_limit'; nextClaimAt: number };

// Вызывать внутри транзакции мира. Время — только серверное (now приходит из мира).
export function claim(sql: SqlStorage, playerId: string, idemKey: string, now: number): ClaimResult {
  return withIdempotency<ClaimResult>(sql, playerId, 'claim', idemKey, {}, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    const row = sql.exec('SELECT last_claim_at, day, count FROM claim_state WHERE player_id = ?', playerId).toArray()[0];
    const state: ClaimState | null = row ? { lastClaimAt: Number(row.last_claim_at), day: Number(row.day), count: Number(row.count) } : null;
    const d = decideClaim(state, now);
    if (!d.ok) return { value: { ok: false, code: d.code, nextClaimAt: d.nextClaimAt }, store: false };

    sql.exec(
      `INSERT INTO claim_state (player_id, last_claim_at, day, count) VALUES (?, ?, ?, ?)
       ON CONFLICT (player_id) DO UPDATE SET last_claim_at = excluded.last_claim_at, day = excluded.day, count = excluded.count`,
      playerId, d.next.lastClaimAt, d.next.day, d.next.count,
    );
    const balance = applyDelta(sql, { playerId, asset: 'astra', delta: d.reward, reason: 'claim', idemKey }, now);
    return { value: { ok: true, reward: d.reward, balance, nextClaimAt: d.nextClaimAt }, store: true };
  });
}
