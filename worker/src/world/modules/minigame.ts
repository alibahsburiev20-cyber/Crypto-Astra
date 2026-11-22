import { DAY_MS, utcDay } from '../../shared/constants';
import {
  RUN_MS, WIN_TIERS, evaluate, makeField, rewardFor, sanitizeTrace, type RunResult, type TracePoint,
} from '../../shared/minigame';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { playerExists } from './players';

// Мини-игра (этап 13). Правила простые и проверяемые:
//   • попытки — по 5 в сутки, Premium добавляет +2 (маршрут спрашивает его у D1);
//   • счёт считает сервeр по трассе, а не клиент;
//   • награда скромная и с суточным потолком, чтобы забеги не заменили игру;
//   • победы 25/50/100 — медали, каждая выдаётся один раз на игрока.

/** Базовое число попыток в сутки. */
export const RUNS_BASE = 5;
/** Сколько добавляет Premium. */
export const RUNS_PREMIUM = 2;
/** Суточные потолки награды за мини-игру. */
export const DAILY_ASTRA_CAP = 150;
export const DAILY_POINTS_CAP = 400;
/** Запас времени на загрузку трассы после конца забега. */
export const FINISH_GRACE_MS = 90_000;

export interface AttemptsView {
  used: number;
  limit: number;
  left: number;
  premium: boolean;
}

function dayRow(sql: SqlStorage, playerId: string, day: number) {
  const row = sql.exec(
    'SELECT runs, wins, astra, points FROM minigame_daily WHERE player_id = ? AND day = ?',
    playerId, day,
  ).toArray()[0];
  return row
    ? { runs: Number(row.runs), wins: Number(row.wins), astra: Number(row.astra), points: Number(row.points) }
    : { runs: 0, wins: 0, astra: 0, points: 0 };
}

function totalWins(sql: SqlStorage, playerId: string): number {
  const row = sql.exec(
    `SELECT COUNT(*) AS n FROM minigame_runs
      WHERE player_id = ? AND status = 'finished' AND win = 1`,
    playerId,
  ).toArray()[0];
  return row ? Number(row.n) : 0;
}

function bestScore(sql: SqlStorage, playerId: string): number {
  const row = sql.exec(
    `SELECT MAX(score) AS s FROM minigame_runs WHERE player_id = ? AND status = 'finished'`,
    playerId,
  ).toArray()[0];
  return row && row.s != null ? Number(row.s) : 0;
}

/** Просроченные забеги закрываем: они не должны держать «занятую» попытку вечно. */
function expireStale(sql: SqlStorage, playerId: string, now: number): void {
  sql.exec(
    `UPDATE minigame_runs SET status = 'expired'
      WHERE player_id = ? AND status = 'running' AND ends_at < ?`,
    playerId, now,
  );
}

export function attemptsView(sql: SqlStorage, playerId: string, now: number, premium: boolean): AttemptsView {
  const limit = RUNS_BASE + (premium ? RUNS_PREMIUM : 0);
  const used = dayRow(sql, playerId, utcDay(now)).runs;
  return { used, limit, left: Math.max(0, limit - used), premium };
}

export interface StartResult {
  runId: string;
  seed: number;
  endsAt: number;
  attempts: AttemptsView;
}

export function startRun(
  sql: SqlStorage, playerId: string, idemKey: string, now: number, premium: boolean,
): StartResult {
  return withIdempotency<StartResult>(sql, playerId, 'minigame_start', idemKey, { premium }, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    expireStale(sql, playerId, now);

    const day = utcDay(now);
    const attempts = attemptsView(sql, playerId, now, premium);
    if (attempts.left <= 0) {
      // Ответ не запоминаем: через сутки попытки появятся снова.
      return { value: { runId: '', seed: 0, endsAt: 0, attempts }, store: false };
    }

    const runId = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    const endsAt = now + RUN_MS + FINISH_GRACE_MS;
    sql.exec(
      `INSERT INTO minigame_runs (id, player_id, seed, started_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, 'running')`,
      runId, playerId, seed, now, endsAt,
    );
    sql.exec(
      `INSERT INTO minigame_daily (player_id, day, runs, wins, astra, points) VALUES (?, ?, 1, 0, 0, 0)
       ON CONFLICT (player_id, day) DO UPDATE SET runs = runs + 1`,
      playerId, day,
    );

    return {
      value: { runId, seed, endsAt, attempts: attemptsView(sql, playerId, now, premium) },
      store: true,
    };
  });
}

export interface EarnedAward {
  wins: number;
  title: string;
  medal: string;
  astra: number;
}

export type FinishResult =
  | {
    ok: true;
    result: RunResult;
    rewards: { astra: number; points: number; capped: boolean };
    awards: EarnedAward[];
    attempts: AttemptsView;
    wins: number;
    best: number;
  }
  | { ok: false; error: 'run_not_found' | 'run_expired' | 'bad_trace' | 'too_fast' | 'short'; attempts: AttemptsView };

export function finishRun(
  sql: SqlStorage,
  playerId: string,
  idemKey: string,
  input: { runId: string; trace: TracePoint[] },
  now: number,
  premium: boolean,
): FinishResult {
  return withIdempotency<FinishResult>(sql, playerId, 'minigame_finish', idemKey, input, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    const attempts = attemptsView(sql, playerId, now, premium);

    const run = sql.exec(
      `SELECT seed, ends_at, status FROM minigame_runs WHERE id = ? AND player_id = ?`,
      input.runId, playerId,
    ).toArray()[0];
    if (!run) return { value: { ok: false, error: 'run_not_found', attempts }, store: true };
    if (String(run.status) !== 'running') {
      return { value: { ok: false, error: 'run_expired', attempts }, store: true };
    }
    if (now > Number(run.ends_at)) {
      sql.exec(`UPDATE minigame_runs SET status = 'expired' WHERE id = ?`, input.runId);
      return { value: { ok: false, error: 'run_expired', attempts }, store: true };
    }

    // Трассу чиним, а не отбиваем: подтормозивший телефон не должен стоить
    // игроку попытки. Зажим скорости при этом сохраняет защиту от телепорта.
    const result = evaluate(Number(run.seed), sanitizeTrace(input.trace));
    if (!result.ok) {
      // Кривая трасса — попытка сгорает, награды нет. Иначе можно бесконечно
      // подбирать трассу, отправляя мусор.
      sql.exec(`UPDATE minigame_runs SET status = 'expired', score = 0, hits = 0, picks = 0, win = 0 WHERE id = ?`, input.runId);
      return { value: { ok: false, error: result.error ?? 'bad_trace', attempts }, store: true };
    }

    const day = utcDay(now);
    const today = dayRow(sql, playerId, day);
    const base = rewardFor(result);
    // Потолок считаем по фактически выданному сегодня, а не по «сколько могли бы».
    const astra = Math.max(0, Math.min(base.astra, DAILY_ASTRA_CAP - today.astra));
    const points = Math.max(0, Math.min(base.points, DAILY_POINTS_CAP - today.points));
    const capped = astra < base.astra || points < base.points;

    sql.exec(
      `UPDATE minigame_runs SET status = 'finished', score = ?, hits = ?, picks = ?, win = ?, astra = ?
        WHERE id = ?`,
      result.score, result.hits, result.picks, result.win ? 1 : 0, astra, input.runId,
    );
    if (astra > 0) applyDelta(sql, { playerId, asset: 'astra', delta: astra, reason: 'minigame', sourceRef: input.runId, idemKey }, now);
    if (points > 0) applyDelta(sql, { playerId, asset: 'points', delta: points, reason: 'minigame', sourceRef: input.runId, idemKey }, now);
    sql.exec(
      `INSERT INTO minigame_daily (player_id, day, runs, wins, astra, points) VALUES (?, ?, 0, ?, ?, ?)
       ON CONFLICT (player_id, day) DO UPDATE SET wins = wins + excluded.wins,
         astra = astra + excluded.astra, points = points + excluded.points`,
      playerId, day, result.win ? 1 : 0, astra, points,
    );

    const wins = totalWins(sql, playerId);
    const awards: EarnedAward[] = [];
    for (const tier of WIN_TIERS) {
      if (wins < tier.wins) continue;
      const already = sql.exec(
        'SELECT 1 FROM minigame_awards WHERE player_id = ? AND award = ?',
        playerId, tier.medal,
      ).toArray().length;
      if (already) continue;
      sql.exec(
        'INSERT INTO minigame_awards (player_id, award, wins, at) VALUES (?, ?, ?, ?)',
        playerId, tier.medal, tier.wins, now,
      );
      // Медальная награда не входит в суточный потолок мини-игры: это разовое
      // достижение, а не фарм.
      applyDelta(sql, { playerId, asset: 'astra', delta: tier.astra, reason: 'minigame_award', sourceRef: tier.medal, idemKey }, now);
      awards.push({ wins: tier.wins, title: tier.title, medal: tier.medal, astra: tier.astra });
    }

    return {
      value: {
        ok: true,
        result,
        rewards: { astra, points, capped },
        awards,
        attempts: attemptsView(sql, playerId, now, premium),
        wins,
        best: bestScore(sql, playerId),
      },
      store: true,
    };
  });
}

/** Короткая сводка для мостика: не тянем весь экран на каждый /me. */
export function minigameBrief(sql: SqlStorage, playerId: string, now: number, premium: boolean) {
  const attempts = attemptsView(sql, playerId, now, premium);
  const wins = totalWins(sql, playerId);
  const next = WIN_TIERS.find((t) => wins < t.wins) ?? null;
  return { attempts, wins, best: bestScore(sql, playerId), nextTier: next ? { wins: next.wins, title: next.title } : null };
}

/** Полный экран «Арена»: попытки, победы, ступени, медали и последние забеги. */
export function minigameView(sql: SqlStorage, playerId: string, now: number, premium: boolean) {
  const attempts = attemptsView(sql, playerId, now, premium);
  const wins = totalWins(sql, playerId);
  const day = dayRow(sql, playerId, utcDay(now));
  const medals = new Set(
    sql.exec('SELECT award FROM minigame_awards WHERE player_id = ?', playerId).toArray()
      .map((r) => String(r.award)),
  );
  const recent = sql.exec(
    `SELECT score, picks, hits, win, astra, started_at FROM minigame_runs
      WHERE player_id = ? AND status = 'finished' ORDER BY started_at DESC LIMIT 8`,
    playerId,
  ).toArray().map((r) => ({
    score: Number(r.score), picks: Number(r.picks), hits: Number(r.hits),
    win: Number(r.win) === 1, astra: Number(r.astra), at: Number(r.started_at),
  }));
  return {
    attempts,
    wins,
    best: bestScore(sql, playerId),
    tiers: WIN_TIERS.map((t) => ({
      wins: t.wins, title: t.title, astra: t.astra, medal: t.medal,
      awarded: medals.has(t.medal), progress: Math.min(t.wins, wins),
    })),
    today: { runs: day.runs, wins: day.wins, astra: day.astra, points: day.points, astraCap: DAILY_ASTRA_CAP },
    caps: { astra: DAILY_ASTRA_CAP, points: DAILY_POINTS_CAP },
    field: { width: 1000, runMs: RUN_MS },
    balance: getBalance(sql, playerId, 'astra'),
    recent,
  };
}

/** Чистая функция для тестов: сколько попыток останется после premium-бонуса. */
export function attemptsLimit(premium: boolean): number {
  return RUNS_BASE + (premium ? RUNS_PREMIUM : 0);
}

/** День в UTC — тем же способом, что и остальные суточные лимиты. */
export function dayOf(now: number): number {
  return Math.floor(now / DAY_MS);
}

export { makeField };
