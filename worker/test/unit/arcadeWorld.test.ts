import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { ARCADE_GAMES, MAX_SCORE, WIN_SCORE, makeMaze, solveMaze } from '../../src/shared/arcade';
import { getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { setFrozen } from '../../src/world/modules/adminWorld';
import { getXp } from '../../src/world/modules/progress';
import { createPlayer } from '../../src/world/modules/players';
import {
  ARCADE_DAILY_XP_CAP, ARCADE_WEEKLY_WINS, arcadeView, attemptsLimit, finishArcade,
  perGameStats, startArcade,
} from '../../src/world/modules/arcade';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 20 + 3_600_000;
const SEED_START = 987_654_321;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
}

/** Идеальный проход лабиринта по зерну забега: единственный способ выиграть — сыграть. */
function perfectMoves(seed: number): number[] {
  const g = makeMaze(seed);
  const { path, steps } = solveMaze(g);
  const moves: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1] % g.cols;
    const ay = Math.floor(path[i - 1] / g.cols);
    const bx = path[i] % g.cols;
    const by = Math.floor(path[i] / g.cols);
    moves.push(bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : 0);
  }
  expect(steps).toBe(moves.length);
  return moves;
}

/**
 * Победа, записанная напрямую: нужны для проверки медалей и недельной цели,
 * где важна сама арифметика наград, а не то, как игрок до неё дошёл.
 */
function seedWin(w: ReturnType<typeof world>, game: string, now: number): void {
  w.sql.exec(
    `INSERT INTO arcade_runs (id, player_id, game, seed, started_at, ends_at, status, score, win, xp, detail)
     VALUES (?, 'p1', ?, 1, ?, ?, 'finished', 600, 1, 0, '{}')`,
    key('seed'), game, now, now + 1000,
  );
}

function seedWins(w: ReturnType<typeof world>, n: number, now: number, game = 'maze'): void {
  for (let i = 0; i < n; i += 1) seedWin(w, game, now + i);
}

let counter = 0;
function key(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Полный цикл одной попытки: старт → победа в лабиринте. */
function winMaze(w: ReturnType<typeof world>, now: number, premium = false) {
  const start = w.tx(() => startArcade(w.sql, 'p1', key('start'), 'maze', now, premium));
  expect(start.runId).not.toBe('');
  const runId = start.runId;
  const seed = start.seed;
  const finish = w.tx(() => finishArcade(w.sql, 'p1', key('fin'), { runId, moves: perfectMoves(seed) }, now, premium));
  return { start, runId, finish };
}

describe('аркада: попытки', () => {
  it('премиум добавляет попытки, но не меняет правила игр', () => {
    expect(attemptsLimit(false)).toBe(10);
    expect(attemptsLimit(true)).toBe(14);
  });

  it('старт тратит попытку и выдаёт зерно', () => {
    const w = world();
    const r = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'snake', T0, false));
    expect(r.runId).toBeTruthy();
    expect(r.game).toBe('snake');
    expect(Number.isInteger(r.seed)).toBe(true);
    expect(r.runMs).toBeGreaterThan(1000);
    expect(r.endsAt).toBeGreaterThan(T0 + r.runMs - 1);
    expect(r.attempts).toMatchObject({ used: 1, limit: 10, left: 9 });
    const view = w.tx(() => arcadeView(w.sql, 'p1', T0, false));
    expect(view.attempts.used).toBe(1);
  });

  it('неизвестная игра не сжигает попытку и не запоминается', () => {
    const w = world();
    const k = key('s');
    const bad = w.tx(() => startArcade(w.sql, 'p1', k, 'chess', T0, false));
    expect(bad).toMatchObject({ runId: '', error: 'bad_game' });
    expect(w.tx(() => arcadeView(w.sql, 'p1', T0, false)).attempts.used).toBe(0);
    // Тот же ключ с нормальной игрой обязан пройти: отказа в кэше нет.
    const good = w.tx(() => startArcade(w.sql, 'p1', k, 'maze', T0, false));
    expect(good.runId).not.toBe('');
  });

  it('суточный пул кончается на десятной игре и обнуляется на следующий день', () => {
    const w = world();
    for (let i = 0; i < 10; i += 1) {
      const r = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'aim', T0, false));
      expect(r.runId).not.toBe('');
    }
    const blocked = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'aim', T0, false));
    expect(blocked).toMatchObject({ runId: '', error: 'daily_limit' });
    expect(blocked.attempts).toMatchObject({ used: 10, left: 0 });
    const tomorrow = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'aim', T0 + DAY_MS, false));
    expect(tomorrow.runId).not.toBe('');
    expect(tomorrow.attempts).toMatchObject({ used: 1, limit: 10 });
  });

  it('повтор запроса с тем же ключом не добавляет попытку', () => {
    const w = world();
    const k = key('s');
    const a = w.tx(() => startArcade(w.sql, 'p1', k, 'memory', T0, false));
    const b = w.tx(() => startArcade(w.sql, 'p1', k, 'memory', T0, false));
    expect(b).toEqual(a);
    expect(w.tx(() => arcadeView(w.sql, 'p1', T0, false)).attempts.used).toBe(1);
  });

  it('тот же ключ с другим телом — конфликт, а не тихий повтор', () => {
    const w = world();
    const k = key('s');
    w.tx(() => startArcade(w.sql, 'p1', k, 'memory', T0, false));
    expect(() => w.tx(() => startArcade(w.sql, 'p1', k, 'snake', T0, false))).toThrow(/idempotency_key_reused/);
  });

  it('замороженный мир не даёт начать забег', () => {
    const w = world();
    w.tx(() => setFrozen(w.sql, true));
    expect(() => w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', T0, false))).toThrow(/world_frozen/);
  });

  it('несданная попытка сгорает по дедлайну и не возвращается', () => {
    const w = world();
    const r = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', T0, false));
    const late = T0 + r.runMs + 120_001;
    const again = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', late, false));
    expect(again.attempts.used).toBe(2);
    const finish = w.tx(() => finishArcade(w.sql, 'p1', key('f'), { runId: r.runId, moves: perfectMoves(r.seed) }, late, false));
    expect(finish.ok).toBe(false);
    if (!finish.ok) expect(finish.error).toBe('run_expired');
  });
});

describe('аркада: зачёт результата', () => {
  it('победа даёт опыт, победу в статистике и ни одной ASTRA', () => {
    const w = world();
    const before = getBalance(w.sql, 'p1', 'astra');
    const xpBefore = getXp(w.sql, 'p1');
    const { finish } = winMaze(w, T0);
    expect(finish.ok).toBe(true);
    if (!finish.ok) return;
    expect(finish.result.score).toBe(MAX_SCORE);
    expect(finish.result.win).toBe(true);
    expect(finish.rewards.xp).toBeGreaterThan(0);
    expect(getXp(w.sql, 'p1')).toBe(xpBefore + finish.rewards.xp);
    expect(getBalance(w.sql, 'p1', 'astra')).toBe(before);
    expect(getBalance(w.sql, 'p1', 'points')).toBe(0);
    const row = w.sql.exec('SELECT game, score, win, xp, status FROM arcade_runs').toArray()[0];
    expect(row).toMatchObject({ game: 'maze', score: MAX_SCORE, win: 1, status: 'finished' });
    expect(Number(row.xp)).toBe(finish.rewards.xp);
    expect(verifyLedger(w.sql).ok).toBe(true);
  });

  it('кривой ввод сжигает попытку и не даёт очков', () => {
    const w = world();
    const r = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', T0, false));
    const finish = w.tx(() => finishArcade(w.sql, 'p1', key('f'), { runId: r.runId, moves: [0, 0, 0] }, T0, false));
    expect(finish.ok).toBe(false);
    if (!finish.ok) expect(finish.error).toBe('bad_trace');
    expect(getXp(w.sql, 'p1')).toBe(0);
    const row = w.sql.exec('SELECT status, score FROM arcade_runs').toArray()[0];
    expect(row).toMatchObject({ status: 'expired', score: 0 });
    // Попытка не вернулась: перебирать ответы бесплатно нельзя.
    expect(w.tx(() => arcadeView(w.sql, 'p1', T0, false)).attempts.left).toBe(9);
  });

  it('повторный финиш того же забега не платит дважды', () => {
    const w = world();
    const start = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', T0, false));
    const moves = perfectMoves(start.seed);
    const k = key('f');
    const first = w.tx(() => finishArcade(w.sql, 'p1', k, { runId: start.runId, moves }, T0, false));
    const xp = getXp(w.sql, 'p1');
    expect(first.ok).toBe(true);
    // Тот же ключ — тот же ответ без начислений; другой ключ — отказ «забег закрыт».
    const replay = w.tx(() => finishArcade(w.sql, 'p1', k, { runId: start.runId, moves }, T0, false));
    expect(replay).toEqual(first);
    expect(getXp(w.sql, 'p1')).toBe(xp);
    const other = w.tx(() => finishArcade(w.sql, 'p1', key('f'), { runId: start.runId, moves }, T0, false));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error).toBe('run_expired');
    expect(getXp(w.sql, 'p1')).toBe(xp);
  });

  it('чужой runId не находится', () => {
    const w = world();
    const r = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', T0, false));
    w.tx(() => createPlayer(w.sql, 'p2', T0));
    const other = w.tx(() => finishArcade(w.sql, 'p2', key('f'), { runId: r.runId, moves: [1] }, T0, false));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error).toBe('run_not_found');
  });

  it('суточный потолок опыта останавливает гринд, а не игру', () => {
    const w = world();
    let left = ARCADE_DAILY_XP_CAP;
    let capped = false;
    for (let i = 0; i < 10 && !capped; i += 1) {
      const { finish } = winMaze(w, T0);
      if (!finish.ok) throw new Error('finish failed');
      left -= finish.rewards.xp;
      capped = finish.rewards.capped;
    }
    expect(capped).toBe(true);
    expect(left).toBeLessThanOrEqual(0);
    const day = w.tx(() => arcadeView(w.sql, 'p1', T0, false)).today;
    expect(day.xp).toBe(ARCADE_DAILY_XP_CAP);
    expect(day.runs).toBe(8);
  });

  it('ступени побед выдают медаль один раз', () => {
    const w = world();
    // Девять побед «из прошлого»: медали считается по фактическим строкам забегов.
    seedWins(w, 9, T0);
    const first = winMaze(w, T0);
    expect(first.finish.ok).toBe(true);
    if (!first.finish.ok) return;
    expect(first.finish.awards.map((a) => a.medal)).toContain('arcade_bronze');
    expect(first.finish.wins).toBe(10);
    // Следующая победа той же ступени — уже без медали и без опыта.
    const second = winMaze(w, T0 + DAY_MS);
    expect(second.finish.ok).toBe(true);
    if (!second.finish.ok) return;
    expect(second.finish.awards).toHaveLength(0);
    const rows = w.sql.exec("SELECT award FROM arcade_awards WHERE player_id = 'p1'").toArray();
    expect(rows.map((r) => String(r.award))).toEqual(['arcade_bronze']);
  });

  it('медаль «десять игр» — когда победил в каждой игре каталога', () => {
    const w = world();
    const others = ARCADE_GAMES.map((g) => g.id).filter((id) => id !== 'maze');
    for (const game of others) seedWin(w, game, T0);
    // Девять игр выиграно, десятой не хватает: медали нет — её выдаёт ровно
    // последняя победа, а не «почти все».
    expect(w.sql.exec('SELECT 1 FROM arcade_awards').toArray()).toHaveLength(0);
    expect(w.sql.exec("SELECT 1 FROM arcade_awards").toArray()).toHaveLength(0);
    const start = w.tx(() => startArcade(w.sql, 'p1', key('s'), 'maze', T0, false));
    const finish = w.tx(() => finishArcade(
      w.sql, 'p1', key('f'), { runId: start.runId, moves: perfectMoves(start.seed) }, T0, false,
    ));
    expect(finish.ok).toBe(true);
    if (!finish.ok) return;
    expect(finish.awards.some((a) => a.medal === 'arcade_all_ten')).toBe(true);
    const view = w.tx(() => arcadeView(w.sql, 'p1', T0, false));
    expect(view.allTen).toMatchObject({ need: 10, have: 10, awarded: true });
    // Повторная победа в десятой игре медаль не выдаёт второй раз.
    const again = winMaze(w, T0 + DAY_MS);
    if (!again.finish.ok) throw new Error('finish failed');
    expect(again.finish.awards.every((a) => a.medal !== 'arcade_all_ten')).toBe(true);
  });

  it('недельная цель выдаётся один раз на неделю', () => {
    const w = world();
    seedWins(w, ARCADE_WEEKLY_WINS - 1, T0);
    const first = winMaze(w, T0);
    expect(first.finish.ok).toBe(true);
    if (!first.finish.ok) return;
    const week = first.finish.awards.find((a) => a.medal.startsWith('arcade_week_'));
    expect(week).toBeTruthy();
    // Ещё одна победа в той же неделе — без награды.
    const same = winMaze(w, T0 + DAY_MS);
    if (!same.finish.ok) throw new Error('finish failed');
    expect(same.finish.awards.filter((a) => a.medal.startsWith('arcade_week_'))).toHaveLength(0);
    // Новая неделя: счёт побед обнуляется, и цель нужно закрывать заново.
    const nextWeek = T0 + 8 * DAY_MS;
    const fresh = winMaze(w, nextWeek);
    if (!fresh.finish.ok) throw new Error('finish failed');
    expect(fresh.finish.awards.filter((a) => a.medal.startsWith('arcade_week_'))).toHaveLength(0);
    seedWins(w, ARCADE_WEEKLY_WINS - 1, nextWeek);
    const done = winMaze(w, nextWeek + 60_000);
    if (!done.finish.ok) throw new Error('finish failed');
    const second = done.finish.awards.find((a) => a.medal.startsWith('arcade_week_'));
    expect(second).toBeTruthy();
    expect(second!.medal).not.toBe(week!.medal);
    const view = w.tx(() => arcadeView(w.sql, 'p1', nextWeek, false));
    expect(view.weekly.awarded).toBe(true);
  });
});

describe('аркада: экран', () => {
  it('каталог описан целиком и знает счёт каждой игры', () => {
    const w = world();
    winMaze(w, T0);
    const view = w.tx(() => arcadeView(w.sql, 'p1', T0, false));
    expect(view.games).toHaveLength(10);
    const maze = view.games.find((g) => g.id === 'maze');
    expect(maze).toMatchObject({ runs: 1, wins: 1, best: MAX_SCORE });
    expect(maze?.winScore).toBe(WIN_SCORE);
    expect(view.maxScore).toBe(MAX_SCORE);
    expect(view.caps.xp).toBe(ARCADE_DAILY_XP_CAP);
    expect(view.recent[0].detail.steps).toBeGreaterThan(0);
    for (const g of view.games) {
      expect(g.sprite).toMatch(/^\/sprites\/arcade\//);
      expect(g.controls.length).toBeGreaterThan(0);
    }
  });

  it('статистика не смешивает игры, а лидерборд пуст, пока никто не побеждал', () => {
    const w = world();
    winMaze(w, T0);
    const stats = w.tx(() => perGameStats(w.sql, 'p1'));
    expect(stats.find((g) => g.id === 'snake')?.runs).toBe(0);
    expect(stats.find((g) => g.id === 'maze')?.wins).toBe(1);
    expect(w.tx(() => arcadeView(w.sql, 'p2', T0, false)).games.every((g) => g.runs === 0)).toBe(true);
    w.tx(() => createPlayer(w.sql, 'p2', T0));
    const board = w.tx(() => arcadeView(w.sql, 'p2', T0, false)).leaderboard;
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ wins: 1, best: MAX_SCORE, isMe: false, rank: 1 });
    expect(typeof board[0].label).toBe('string');
  });
});
