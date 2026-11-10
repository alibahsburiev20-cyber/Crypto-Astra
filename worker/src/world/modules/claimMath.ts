import { CLAIM_DAILY_MAX, CLAIM_INTERVAL_MS, CLAIM_REWARD, DAY_MS } from '../../shared/constants';

export interface ClaimState { lastClaimAt: number; day: number; count: number }

export type ClaimDecision =
  | { ok: true; reward: number; next: ClaimState; nextClaimAt: number }
  | { ok: false; code: 'too_early' | 'daily_limit'; nextClaimAt: number };

// Чистая функция: время передаётся снаружи (серверное Date.now() внутри мира).
export function decideClaim(state: ClaimState | null, now: number): ClaimDecision {
  const day = Math.floor(now / DAY_MS);
  if (state && now - state.lastClaimAt < CLAIM_INTERVAL_MS) {
    return { ok: false, code: 'too_early', nextClaimAt: state.lastClaimAt + CLAIM_INTERVAL_MS };
  }
  const count = state && state.day === day ? state.count : 0;
  if (count >= CLAIM_DAILY_MAX) return { ok: false, code: 'daily_limit', nextClaimAt: (day + 1) * DAY_MS };
  return { ok: true, reward: CLAIM_REWARD, next: { lastClaimAt: now, day, count: count + 1 }, nextClaimAt: now + CLAIM_INTERVAL_MS };
}
