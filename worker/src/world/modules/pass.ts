import { PASS_LEVELS, PASS_REWARDS, PASS_SLOT_LEVEL, PASS_THRESHOLDS } from '../../shared/constants';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { ensureSeason } from './season';

// Astra Pass (этап 4) — бесплатный трек за очки сезона. Платного трека нет:
// продажа Pass невозможна без решения по деньгам и юристу, поэтому здесь только
// награды за игру. Уровни считаются по очкам текущего сезона и сгорают вместе
// с ними при закрытии — это честно: Pass привязан к сезону, а не к аккаунту.
// Поэтому отметки о наградах хранятся вместе с `season_id`: в новом сезоне очки
// обнулились, и те же уровни можно пройти снова. Второй слот крафта и бейджи —
// исключение: они остаются у игрока навсегда, это купленный игрой прогресс.

export function levelForPoints(points: number): number {
  let level = 0;
  for (const threshold of PASS_THRESHOLDS) {
    if (points >= threshold) level += 1;
    else break;
  }
  return Math.min(level, PASS_LEVELS);
}

/** Забранные уровни текущего сезона. */
export function claimedLevels(sql: SqlStorage, playerId: string, seasonId: string): number[] {
  return sql.exec(
    'SELECT level FROM pass_claims WHERE player_id = ? AND season_id = ? ORDER BY level',
    playerId, seasonId,
  ).toArray().map((r) => Number(r.level));
}

/** Косметика за все сезоны: знаки и титул не сгорают. */
export function permanentBadges(sql: SqlStorage, playerId: string): string[] {
  return sql.exec(
    `SELECT DISTINCT level FROM pass_claims WHERE player_id = ? AND level IN (5, 7, 9, 10)
      ORDER BY level`,
    playerId,
  ).toArray().map((r) => PASS_REWARDS[Number(r.level)]?.label ?? '');
}

/**
 * Второй слот крафта открывает забранная награда 3 уровня, а не просто очки.
 * Проверка по всем сезонам: слот остаётся, даже когда очки обнулились.
 */
export function craftSlotsFor(sql: SqlStorage, playerId: string): number {
  const has = sql.exec(
    'SELECT 1 FROM pass_claims WHERE player_id = ? AND level = ?',
    playerId, PASS_SLOT_LEVEL,
  ).toArray().length > 0;
  return has ? 2 : 1;
}

/** Сезон, к которому относится текущий прогресс. Создаётся, если ещё нет. */
function seasonOf(sql: SqlStorage, now: number): string {
  return ensureSeason(sql, now).id;
}

export interface PassLevelView {
  level: number;
  threshold: number;
  label: string;
  kind: 'astra' | 'slot' | 'badge' | 'title';
  unlocked: boolean;
  claimed: boolean;
  ready: boolean;
}

export function passView(sql: SqlStorage, playerId: string, now: number) {
  const points = getBalance(sql, playerId, 'points');
  const level = levelForPoints(points);
  const claimed = new Set(claimedLevels(sql, playerId, seasonOf(sql, now)));
  const levels: PassLevelView[] = PASS_THRESHOLDS.map((threshold, i) => {
    const n = i + 1;
    const reward = PASS_REWARDS[n];
    const unlocked = points >= threshold;
    const isClaimed = claimed.has(n);
    return {
      level: n, threshold, label: reward.label, kind: reward.kind,
      unlocked, claimed: isClaimed, ready: unlocked && !isClaimed,
    };
  });
  const next = levels.find((l) => !l.unlocked) ?? null;
  return {
    points,
    level,
    next,
    levels,
    slotActive: craftSlotsFor(sql, playerId) > 1,
    // Косметика: знаки и титул видны в профиле и в карточке гильдии и не сгорают.
    badges: permanentBadges(sql, playerId),
    ready: levels.filter((l) => l.ready).length,
  };
}

export interface ClaimPassResult {
  level: number;
  astra: number;
  label: string;
  balance: number;
  slotActive: boolean;
}

export function claimPass(sql: SqlStorage, playerId: string, idemKey: string, level: number, now: number): ClaimPassResult {
  return withIdempotency(sql, playerId, 'pass:claim', idemKey, { level }, now, () => {
    assertPlayable(sql);
    if (!Number.isInteger(level) || level < 1 || level > PASS_LEVELS) throw new ApiError(400, 'bad_pass_level');
    const threshold = PASS_THRESHOLDS[level - 1];
    const points = getBalance(sql, playerId, 'points');
    if (points < threshold) throw new ApiError(409, 'pass_locked');
    const seasonId = seasonOf(sql, now);
    const already = sql.exec(
      'SELECT 1 FROM pass_claims WHERE player_id = ? AND level = ? AND season_id = ?',
      playerId, level, seasonId,
    ).toArray().length > 0;
    if (already) throw new ApiError(409, 'pass_claimed');
    sql.exec('INSERT INTO pass_claims (player_id, level, season_id, claimed_at) VALUES (?, ?, ?, ?)',
      playerId, level, seasonId, now);
    const reward = PASS_REWARDS[level];
    const astra = reward.kind === 'astra' ? (reward.astra ?? 0) : 0;
    if (astra > 0) {
      applyDelta(sql, { playerId, asset: 'astra', delta: astra, reason: 'pass_reward', sourceRef: `pass:${level}` }, now);
    }
    return {
      value: { level, astra, label: reward.label, balance: getBalance(sql, playerId, 'astra'), slotActive: craftSlotsFor(sql, playerId) > 1 },
      store: true,
    };
  });
}
