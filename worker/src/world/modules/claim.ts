import { XP } from '../../shared/gameData';
import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { decideClaim, type ClaimState } from './claimMath';
import { applyXp } from './progress';
import { levelFromXp } from './expeditionMath';
import { playerExists } from './players';

export type ClaimResult =
  | { ok: true; reward: number; balance: number; nextClaimAt: number; xp: number }
  | { ok: false; code: 'too_early' | 'daily_limit'; nextClaimAt: number };

// Вызывать внутри транзакции мира. Время — только серверное (now приходит из мира).
export function claim(sql: SqlStorage, playerId: string, idemKey: string, now: number): ClaimResult {
  return withIdempotency<ClaimResult>(sql, playerId, 'claim', idemKey, {}, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
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
    // Claim теперь даёт опыт: даже на суточном максимуме (96 клеймов) это +96 XP,
    // то есть «заходить по таймеру» видно по уровню, но рейсы оно не перебивает.
    // В ответе — начисленный опыт (дельта), а не суммарный: клиент показывает
    // «+1 XP» над кнопкой, и число должно быть про это действие.
    applyXp(sql, { playerId, delta: XP.claim, reason: 'claim', idemKey }, now, levelFromXp);
    return { value: { ok: true, reward: d.reward, balance, nextClaimAt: d.nextClaimAt, xp: XP.claim }, store: true };
  });
}

/**
 * Авто-клейм для Premium: сервер сам забирает готовый бонус при заходе.
 * Ключ идемпотентности выводится из времени, поэтому повторный заход в ту же
 * секунду не начислит дважды, а пропущенный бонус не «сгорает» молча: он
 * начисляется при следующем визите.
 */
export function autoClaim(sql: SqlStorage, playerId: string, now: number): ClaimResult | null {
  const row = sql.exec('SELECT last_claim_at, day, count FROM claim_state WHERE player_id = ?', playerId).toArray()[0];
  const state: ClaimState | null = row ? { lastClaimAt: Number(row.last_claim_at), day: Number(row.day), count: Number(row.count) } : null;
  if (!decideClaim(state, now).ok) return null;
  try {
    const res = claim(sql, playerId, `premium-auto:${now}`, now);
    return res;
  } catch (e) {
    // Авто-клейм — удобство: его сбой не должен ломать открытие игры.
    console.error('auto claim failed', e);
    return null;
  }
}
