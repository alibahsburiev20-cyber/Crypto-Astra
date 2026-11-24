import { utcDay } from '../../shared/constants';
import {
  ARCADE_ALL_TEN_MEDAL, ARCADE_ALL_TEN_XP, ARCADE_GAMES, ARCADE_TIERS, MAX_SCORE,
  arcadeMeta, arcadeRunMs, arcadeXp, evaluateArcade,
  type ArcadeError, type ArcadeId, type ArcadeInput, type ArcadeOutcome,
} from '../../shared/arcade';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { playerExists } from './players';
import { publicIdentity } from './identity';
import { applyXp } from './progress';
import { weekStartOf } from './minigame';
import { levelFromXp } from './expeditionMath';

// Аркада (этап 18): десять мини-игр на одном наборе правил.
//
//   • попытки — общий суточный пул на все десять игр, Premium добавляет +4;
//   • счёт считает сервер по зерну и входам игрока (общий модуль arcade.ts),
//     поэтому «я собрал 600 очков» прислать нельзя;
//   • награда — только опыт: ASTRA, очки и ресурсы аркада не трогает, чтобы
//     десять новых игр не стали ещё одним источником валюты;
//   • суточный потолок опыта держит гринд, медали — разовые факты;
//   • кривой или физически невозможный вход сжигает попытку: иначе по ней
//     можно было бы подбирать правильные ответы.

/** Суточный пул попыток на все игры. */
export const ARCADE_RUNS_BASE = 10;
export const ARCADE_RUNS_PREMIUM = 4;
/** Потолок опыта за день: 10 забегов по ~20 XP выбирается не всегда, и это нормально. */
export const ARCADE_DAILY_XP_CAP = 200;
/** Запас на то, чтобы дослать ответ после конца раунда (судоку думает долго). */
export const ARCADE_FINISH_GRACE_MS = 120_000;
/** Недельная цель: 15 побед за календарную неделю (UTC). */
export const ARCADE_WEEKLY_WINS = 15;
export const ARCADE_WEEKLY_XP = 120;

export interface ArcadeAttempts {
  used: number;
  limit: number;
  left: number;
  premium: boolean;
}

export interface ArcadeAward {
  medal: string;
  title: string;
  xp: number;
  /** Сколько побед требовалось (для недельной цели — сама цель). */
  need: number;
}

export interface ArcadeStart {
  runId: string;
  game: ArcadeId | '';
  seed: number;
  endsAt: number;
  runMs: number;
  attempts: ArcadeAttempts;
  error?: 'daily_limit' | 'bad_game';
}

export type ArcadeFinish =
  | {
    ok: true;
    game: ArcadeId;
    result: ArcadeOutcome;
    rewards: { xp: number; capped: boolean };
    awards: ArcadeAward[];
    attempts: ArcadeAttempts;
    wins: number;
    best: number;
  }
  | { ok: false; error: 'run_not_found' | 'run_expired' | ArcadeError; attempts: ArcadeAttempts };

export function attemptsLimit(premium: boolean): number {
  return ARCADE_RUNS_BASE + (premium ? ARCADE_RUNS_PREMIUM : 0);
}

function dayRow(sql: SqlStorage, playerId: string, day: number): { runs: number; wins: number; xp: number } {
  const row = sql.exec(
    'SELECT runs, wins, xp FROM arcade_daily WHERE player_id = ? AND day = ?',
    playerId, day,
  ).toArray()[0];
  return row
    ? { runs: Number(row.runs), wins: Number(row.wins), xp: Number(row.xp) }
    : { runs: 0, wins: 0, xp: 0 };
}

function countWhere(sql: SqlStorage, playerId: string, where: string, args: (string | number)[]): number {
  const row = sql.exec(`SELECT COUNT(*) AS n FROM arcade_runs WHERE player_id = ? AND ${where}`, playerId, ...args)
    .toArray()[0];
  return row ? Number(row.n) : 0;
}

function bestScore(sql: SqlStorage, playerId: string): number {
  const row = sql.exec(
    `SELECT MAX(score) AS s FROM arcade_runs WHERE player_id = ? AND status = 'finished'`,
    playerId,
  ).toArray()[0];
  return row && row.s != null ? Number(row.s) : 0;
}

/** Сводка по каждой игре каталога: победы, лучший счёт и число забегов. */
export function perGameStats(sql: SqlStorage, playerId: string) {
  const rows = sql.exec(
    `SELECT game, COUNT(*) AS runs, SUM(win) AS wins, MAX(score) AS best
       FROM arcade_runs WHERE player_id = ? AND status = 'finished' GROUP BY game`,
    playerId,
  ).toArray();
  const byGame = new Map<string, { runs: number; wins: number; best: number }>();
  for (const r of rows) {
    byGame.set(String(r.game), {
      runs: Number(r.runs),
      wins: Number(r.wins ?? 0),
      best: r.best == null ? 0 : Number(r.best),
    });
  }
  return ARCADE_GAMES.map((g) => ({
    id: g.id,
    title: g.title,
    kind: g.kind,
    controls: g.controls,
    rules: g.rules,
    sprite: g.sprite,
    runMs: g.runMs,
    winScore: MAX_SCORE / 2,
    runs: byGame.get(g.id)?.runs ?? 0,
    wins: byGame.get(g.id)?.wins ?? 0,
    best: byGame.get(g.id)?.best ?? 0,
  }));
}

/** В этой таблице игрок победил хотя бы раз? Нужно для медали «десять игр». */
function winGames(sql: SqlStorage, playerId: string): string[] {
  return sql.exec(
    `SELECT DISTINCT game FROM arcade_runs WHERE player_id = ? AND status = 'finished' AND win = 1`,
    playerId,
  ).toArray().map((r) => String(r.game));
}

function weeklyWins(sql: SqlStorage, playerId: string, now: number): number {
  return countWhere(sql, playerId, `status = 'finished' AND win = 1 AND started_at >= ?`, [weekStartOf(now)]);
}

/** Просроченные забеги закрываем: они не должны вечно держать занятую попытку. */
function expireStale(sql: SqlStorage, playerId: string, now: number): void {
  sql.exec(
    `UPDATE arcade_runs SET status = 'expired'
      WHERE player_id = ? AND status = 'running' AND ends_at < ?`,
    playerId, now,
  );
}

/** Только числа и короткие ключи: detail уходит и в D1, и в браузер. */
function detailJson(detail: Record<string, number>): string {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(detail).slice(0, 12)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key.slice(0, 16)] = Math.max(-1_000_000, Math.min(1_000_000, Math.round(n)));
  }
  return JSON.stringify(out);
}

function parseDetail(raw: unknown): Record<string, number> {
  try {
    const obj = JSON.parse(String(raw ?? '{}')) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj).slice(0, 12)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k.slice(0, 16)] = Math.round(n);
    }
    return out;
  } catch {
    return {};
  }
}

export function attemptsView(sql: SqlStorage, playerId: string, now: number, premium: boolean): ArcadeAttempts {
  const limit = attemptsLimit(premium);
  const used = dayRow(sql, playerId, utcDay(now)).runs;
  return { used, limit, left: Math.max(0, limit - used), premium };
}

export function startArcade(
  sql: SqlStorage, playerId: string, idemKey: string, game: string, now: number, premium: boolean,
): ArcadeStart {
  return withIdempotency<ArcadeStart>(sql, playerId, 'arcade_start', idemKey, { game }, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    const meta = arcadeMeta(game);
    if (!meta) {
      // Отказ не запоминаем: тот же ключ с нормальной игрой обязан пройти.
      return {
        value: {
          runId: '', game: '', seed: 0, endsAt: 0, runMs: 0,
          attempts: attemptsView(sql, playerId, now, premium), error: 'bad_game',
        },
        store: false,
      };
    }
    expireStale(sql, playerId, now);
    const attempts = attemptsView(sql, playerId, now, premium);
    if (attempts.left <= 0) {
      return {
        value: {
          runId: '', game: meta.id, seed: 0, endsAt: 0, runMs: arcadeRunMs(meta.id),
          attempts, error: 'daily_limit',
        },
        store: false,
      };
    }

    const runId = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    const runMs = arcadeRunMs(meta.id);
    const endsAt = now + runMs + ARCADE_FINISH_GRACE_MS;
    sql.exec(
      `INSERT INTO arcade_runs (id, player_id, game, seed, started_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'running')`,
      runId, playerId, meta.id, seed, now, endsAt,
    );
    sql.exec(
      `INSERT INTO arcade_daily (player_id, day, runs, wins, xp) VALUES (?, ?, 1, 0, 0)
       ON CONFLICT (player_id, day) DO UPDATE SET runs = runs + 1`,
      playerId, utcDay(now),
    );
    return {
      value: {
        runId, game: meta.id, seed, endsAt, runMs,
        attempts: attemptsView(sql, playerId, now, premium),
      },
      store: true,
    };
  });
}

/** Медаль «все десять игр» и недельная цель: и то, и другое выдаётся один раз. */
function grantAward(
  sql: SqlStorage, playerId: string, award: ArcadeAward, idemKey: string, now: number, out: ArcadeAward[],
): void {
  if (sql.exec('SELECT 1 FROM arcade_awards WHERE player_id = ? AND award = ?', playerId, award.medal).toArray().length) return;
  sql.exec('INSERT INTO arcade_awards (player_id, award, at) VALUES (?, ?, ?)', playerId, award.medal, now);
  // Разовое достижение не входит в суточный потолок: это факт, а не фарм.
  applyXp(sql, { playerId, delta: award.xp, reason: 'arcade_award', sourceRef: award.medal, idemKey }, now, levelFromXp);
  out.push(award);
}

export function finishArcade(
  sql: SqlStorage,
  playerId: string,
  idemKey: string,
  input: { runId: string } & ArcadeInput,
  now: number,
  premium: boolean,
): ArcadeFinish {
  return withIdempotency<ArcadeFinish>(sql, playerId, 'arcade_finish', idemKey, input, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    const attempts = attemptsView(sql, playerId, now, premium);

    const run = sql.exec(
      `SELECT game, seed, ends_at, status FROM arcade_runs WHERE id = ? AND player_id = ?`,
      input.runId, playerId,
    ).toArray()[0];
    if (!run) return { value: { ok: false, error: 'run_not_found', attempts }, store: true };
    if (String(run.status) !== 'running') {
      return { value: { ok: false, error: 'run_expired', attempts }, store: true };
    }
    if (now > Number(run.ends_at)) {
      sql.exec(`UPDATE arcade_runs SET status = 'expired' WHERE id = ?`, input.runId);
      return { value: { ok: false, error: 'run_expired', attempts }, store: true };
    }
    const game = arcadeMeta(String(run.game))?.id;
    if (!game) {
      sql.exec(`UPDATE arcade_runs SET status = 'expired' WHERE id = ?`, input.runId);
      return { value: { ok: false, error: 'bad_trace', attempts }, store: true };
    }

    const result = evaluateArcade(game, Number(run.seed), input);
    if (!result.ok) {
      // Попытка сгорает, награды нет: перебор ответов должен что-то стоить.
      sql.exec(
        `UPDATE arcade_runs SET status = 'expired', score = 0, win = 0, xp = 0, detail = '{}' WHERE id = ?`,
        input.runId,
      );
      return { value: { ok: false, error: result.error ?? 'bad_trace', attempts }, store: true };
    }

    const day = utcDay(now);
    const today = dayRow(sql, playerId, day);
    const base = arcadeXp(result.score, result.win);
    const xp = Math.max(0, Math.min(base, ARCADE_DAILY_XP_CAP - today.xp));
    sql.exec(
      `UPDATE arcade_runs SET status = 'finished', score = ?, win = ?, xp = ?, detail = ? WHERE id = ?`,
      result.score, result.win ? 1 : 0, xp, detailJson(result.detail), input.runId,
    );
    if (xp > 0) {
      applyXp(sql, { playerId, delta: xp, reason: 'arcade', sourceRef: input.runId, idemKey }, now, levelFromXp);
      sql.exec(
        `INSERT INTO arcade_daily (player_id, day, runs, wins, xp) VALUES (?, ?, 0, ?, ?)
         ON CONFLICT (player_id, day) DO UPDATE SET xp = xp + excluded.xp, wins = wins + excluded.wins`,
        playerId, day, result.win ? 1 : 0, xp,
      );
    } else {
      sql.exec(
        `INSERT INTO arcade_daily (player_id, day, runs, wins, xp) VALUES (?, ?, 0, ?, 0)
         ON CONFLICT (player_id, day) DO UPDATE SET wins = wins + excluded.wins`,
        playerId, day, result.win ? 1 : 0,
      );
    }

    const wins = countWhere(sql, playerId, `status = 'finished' AND win = 1`, []);
    const awards: ArcadeAward[] = [];
    for (const tier of ARCADE_TIERS) {
      if (wins < tier.wins) continue;
      grantAward(sql, playerId, { medal: tier.medal, title: tier.title, xp: tier.xp, need: tier.wins }, idemKey, now, awards);
    }
    if (winGames(sql, playerId).length >= ARCADE_GAMES.length) {
      grantAward(sql, playerId, {
        medal: ARCADE_ALL_TEN_MEDAL, title: 'Десять игр — десять побед', xp: ARCADE_ALL_TEN_XP, need: ARCADE_GAMES.length,
      }, idemKey, now, awards);
    }
    if (weeklyWins(sql, playerId, now) >= ARCADE_WEEKLY_WINS) {
      grantAward(sql, playerId, {
        medal: `arcade_week_${weekStartOf(now)}`, title: 'Неделя в аркаде', xp: ARCADE_WEEKLY_XP, need: ARCADE_WEEKLY_WINS,
      }, idemKey, now, awards);
    }

    return {
      value: {
        ok: true,
        game,
        result,
        rewards: { xp, capped: xp < base },
        awards,
        attempts: attemptsView(sql, playerId, now, premium),
        wins,
        best: bestScore(sql, playerId),
      },
      store: true,
    };
  });
}

/** Лидерборд аркады: победы, затем лучший счёт. Не пересекается с ареной. */
export function arcadeLeaderboard(sql: SqlStorage, playerId: string, now: number, limit = 10) {
  const rows = sql.exec(
    `SELECT player_id, COUNT(*) AS wins, MAX(score) AS best
       FROM arcade_runs WHERE status = 'finished' AND win = 1
      GROUP BY player_id ORDER BY wins DESC, best DESC LIMIT ?`,
    limit,
  ).toArray();
  return rows.map((r, i) => {
    const who = publicIdentity(sql, String(r.player_id), now);
    return {
      rank: i + 1,
      label: who.label,
      frame: who.frame,
      premium: who.premium,
      wins: Number(r.wins),
      best: Number(r.best),
      isMe: String(r.player_id) === playerId,
    };
  });
}

/** Короткая сводка для мостика: аркада видна, но экран не тянет весь каталог. */
export function arcadeBrief(sql: SqlStorage, playerId: string, now: number, premium: boolean) {
  const attempts = attemptsView(sql, playerId, now, premium);
  return {
    attempts,
    wins: countWhere(sql, playerId, `status = 'finished' AND win = 1`, []),
    best: bestScore(sql, playerId),
  };
}

/** Полный экран «Аркада»: каталог, попытки, ступени, неделя, лидерборд, история. */
export function arcadeView(sql: SqlStorage, playerId: string, now: number, premium: boolean) {
  const attempts = attemptsView(sql, playerId, now, premium);
  const day = dayRow(sql, playerId, utcDay(now));
  const wins = countWhere(sql, playerId, `status = 'finished' AND win = 1`, []);
  const medals = new Set(
    sql.exec('SELECT award FROM arcade_awards WHERE player_id = ?', playerId).toArray().map((r) => String(r.award)),
  );
  const recent = sql.exec(
    `SELECT game, score, win, xp, detail, started_at FROM arcade_runs
      WHERE player_id = ? AND status = 'finished' ORDER BY started_at DESC LIMIT 10`,
    playerId,
  ).toArray().map((r) => ({
    game: String(r.game),
    score: Number(r.score),
    win: Number(r.win) === 1,
    xp: Number(r.xp),
    detail: parseDetail(r.detail),
    at: Number(r.started_at),
  }));
  const weekStart = weekStartOf(now);
  return {
    attempts,
    wins,
    best: bestScore(sql, playerId),
    games: perGameStats(sql, playerId),
    tiers: ARCADE_TIERS.map((t) => ({
      wins: t.wins, title: t.title, xp: t.xp, medal: t.medal, awarded: medals.has(t.medal),
    })),
    allTen: {
      need: ARCADE_GAMES.length,
      have: winGames(sql, playerId).length,
      awarded: medals.has(ARCADE_ALL_TEN_MEDAL),
      xp: ARCADE_ALL_TEN_XP,
    },
    weekly: {
      wins: weeklyWins(sql, playerId, now),
      target: ARCADE_WEEKLY_WINS,
      xp: ARCADE_WEEKLY_XP,
      awarded: medals.has(`arcade_week_${weekStart}`),
    },
    today: { runs: day.runs, wins: day.wins, xp: day.xp, xpCap: ARCADE_DAILY_XP_CAP },
    leaderboard: arcadeLeaderboard(sql, playerId, now),
    recent,
    caps: { xp: ARCADE_DAILY_XP_CAP },
    winScore: MAX_SCORE / 2,
    maxScore: MAX_SCORE,
  };
}
