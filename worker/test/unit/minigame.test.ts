import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import {
  MAX_SPEED, RUN_MS, WIN_SCORE, evaluate, makeField, rewardFor, sanitizeTrace, validateTrace, type TracePoint,
} from '../../src/shared/minigame';
import { applyDelta, getBalance } from '../../src/world/balances';
import { createPlayer } from '../../src/world/modules/players';
import {
  DAILY_ASTRA_CAP, RUNS_BASE, RUNS_PREMIUM, attemptsLimit, attemptsView, finishRun, minigameView,
  startRun,
} from '../../src/world/modules/minigame';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10 + 3_600_000;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
}

/** Ровная трасса: стоим на месте. Самая простая валидная запись забега. */
function steady(x = 500, step = 100): TracePoint[] {
  const out: TracePoint[] = [];
  for (let t = 0; t <= RUN_MS; t += step) out.push({ t, x });
  return out;
}

/**
 * Жадный игрок: едет к следующему кристаллу с максимальной скоростью. Такой
 * бот не мудрит с уклонениями, но именно он проверяет, что победа в принципе
 * достижима, а трасса проходит валидацию.
 */
function chaser(seed: number): TracePoint[] {
  const field = makeField(seed);
  const out: TracePoint[] = [];
  let x = 500;
  let ci = 0;
  for (let t = 0; t <= RUN_MS; t += 50) {
    while (ci < field.crystals.length && field.crystals[ci].t <= t) ci += 1;
    const target = ci < field.crystals.length ? field.crystals[ci].x : x;
    const stepMax = (MAX_SPEED * 50) / 1000;
    x += Math.max(-stepMax, Math.min(stepMax, target - x));
    out.push({ t, x: Math.round(x * 10) / 10 });
  }
  return out;
}

describe('мини-игра: расчёт поля и трассы', () => {
  it('поле строится из зерна одинаково', () => {
    expect(JSON.stringify(makeField(42))).toBe(JSON.stringify(makeField(42)));
    expect(JSON.stringify(makeField(42))).not.toBe(JSON.stringify(makeField(43)));
    const field = makeField(7);
    expect(field.asteroids.length).toBeGreaterThan(20);
    expect(field.crystals.length).toBeGreaterThan(15);
    for (const a of field.asteroids) expect(a.x).toBeGreaterThanOrEqual(0);
    for (const c of field.crystals) expect(c.x).toBeLessThanOrEqual(1000);
  });

  it('слишком короткая трасса не засчитывается', () => {
    expect(evaluate(1, steady()).ok).toBe(true);
    expect(evaluate(1, [{ t: 0, x: 100 }, { t: 5000, x: 120 }]).error).toBe('bad_trace');
    const half = steady().filter((p) => p.t < RUN_MS - 5000);
    expect(evaluate(1, half).error).toBe('short');
  });

  it('телепорт и выход за поле отбиваются', () => {
    const teleport: TracePoint[] = [{ t: 0, x: 0 }, { t: 100, x: 900 }, ...steady(900).slice(2)];
    expect(validateTrace(teleport)).toBe('too_fast');
    expect(validateTrace(steady(-5))).toBe('bad_trace');
    expect(validateTrace(steady(1001))).toBe('bad_trace');
    expect(validateTrace(steady(900))).toBe(null);
  });

  it('счёт — из попаданий и сборов, а не из чисел клиента', () => {
    const seed = 123;
    const result = evaluate(seed, steady(500));
    expect(result.ok).toBe(true);
    expect(result.score).toBe(Math.max(0, result.picks * 10 - result.hits * 15));
    expect(result.win).toBe(result.score >= WIN_SCORE);
  });

  it('победа достижима честной трассой', () => {
    // Не в любом поле выходит идеальный забег, поэтому ищем удачное зерно.
    let wins = 0;
    let picks = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const r = evaluate(seed, chaser(seed));
      expect(r.ok).toBe(true);
      if (r.win) wins += 1;
      picks += r.picks;
    }
    // Собирать кристаллы выгодно, но не гарантирует победу: часть полей
    // проходится только с уклонением. Оба факта проверяем.
    expect(picks / 12).toBeGreaterThan(20);
    expect(wins).toBeGreaterThan(0);
    expect(wins).toBeLessThan(12);
  });

  it('награда не отрицательная и не бесконечная', () => {
    expect(rewardFor({ ok: false, score: 0, hits: 0, picks: 0, win: false, ticks: 0 })).toEqual({ astra: 0, points: 0 });
    const top = rewardFor({ ok: true, score: 900, hits: 0, picks: 60, win: true, ticks: 900 });
    expect(top.astra).toBe(45);
    const bad = rewardFor({ ok: true, score: 0, hits: 9, picks: 0, win: false, ticks: 900 });
    expect(bad.astra).toBeGreaterThanOrEqual(1);
    expect(bad.points).toBeGreaterThanOrEqual(0);
  });
});

describe('мини-игра: попытки и награды в мире', () => {
  it('попытки кончаются и Premium добавляет две', () => {
    expect(attemptsLimit(false)).toBe(RUNS_BASE);
    expect(attemptsLimit(true)).toBe(RUNS_BASE + RUNS_PREMIUM);

    const { sql, tx } = world();
    for (let i = 0; i < RUNS_BASE; i += 1) {
      const r = tx(() => startRun(sql, 'p1', `k${i}`, T0 + i, false));
      expect(r.runId).toBeTruthy();
    }
    const denied = tx(() => startRun(sql, 'p1', 'k-last', T0 + 100, false));
    expect(denied.runId).toBe('');
    expect(attemptsView(sql, 'p1', T0 + 100, false).left).toBe(0);

    // Премиум-игроку в тот же день доступны ещё две.
    const premium = tx(() => startRun(sql, 'p1', 'k-prem', T0 + 200, true));
    expect(premium.runId).toBeTruthy();
    expect(premium.attempts.limit).toBe(RUNS_BASE + RUNS_PREMIUM);
  });

  it('забег закрывается, награда начисляется, повтор не платит дважды', () => {
    const { sql, tx } = world();
    const start = tx(() => startRun(sql, 'p1', 'run-1', T0, false));
    const before = getBalance(sql, 'p1', 'astra');
    const trace = steady(500);
    const first = tx(() => finishRun(sql, 'p1', 'fin-1', { runId: start.runId, trace }, T0 + RUN_MS, false));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.rewards.astra).toBeGreaterThanOrEqual(1);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before + first.rewards.astra);

    const again = tx(() => finishRun(sql, 'p1', 'fin-1', { runId: start.runId, trace }, T0 + RUN_MS + 5, false));
    expect(again).toEqual(first);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before + first.rewards.astra);
  });

  it('просроченный забег не приносит награды', () => {
    const { sql, tx } = world();
    const start = tx(() => startRun(sql, 'p1', 'run-2', T0, false));
    const late = tx(() => finishRun(sql, 'p1', 'fin-2', { runId: start.runId, trace: steady() }, T0 + RUN_MS + 10 * 60_000, false));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toBe('run_expired');
  });

  it('мусорная трасса не платит, но попытку не возвращает', () => {
    const { sql, tx } = world();
    const start = tx(() => startRun(sql, 'p1', 'run-3', T0, false));
    const before = getBalance(sql, 'p1', 'astra');
    const junk = [{ t: Number.NaN, x: 0 }, { t: 10, x: Number.POSITIVE_INFINITY }] as unknown as TracePoint[];
    const res = tx(() => finishRun(sql, 'p1', 'fin-3', { runId: start.runId, trace: junk }, T0 + 1000, false));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('bad_trace');
    expect(getBalance(sql, 'p1', 'astra')).toBe(before);
    expect(attemptsView(sql, 'p1', T0 + 1000, false).used).toBe(1);
  });

  it('суточный потолок останавливает фарм', () => {
    const { sql, tx } = world();
    // Уже выбрано 150 ASTRA из мини-игры сегодня.
    sql.exec(
      'INSERT INTO minigame_daily (player_id, day, runs, wins, astra, points) VALUES (?, ?, 0, 0, ?, 0)',
      'p1', 10, DAILY_ASTRA_CAP,
    );
    const start = tx(() => startRun(sql, 'p1', 'run-4', T0, false));
    const before = getBalance(sql, 'p1', 'astra');
    const res = tx(() => finishRun(sql, 'p1', 'fin-4', { runId: start.runId, trace: steady() }, T0 + RUN_MS, false));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rewards.astra).toBe(0);
    expect(res.rewards.capped).toBe(true);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before);
  });

  it('медаль за 25 побед выдаётся один раз', () => {
    const { sql, tx } = world();
    // Двадцать четыре победы уже в истории.
    for (let i = 0; i < 25; i += 1) {
      sql.exec(
        `INSERT INTO minigame_runs (id, player_id, seed, started_at, ends_at, status, score, hits, picks, win, astra)
         VALUES (?, 'p1', 1, ?, ?, 'finished', 200, 0, 20, 1, 10)`,
        `old-${i}`, T0 - i * 1000, T0 + 1000,
      );
    }
    const start = tx(() => startRun(sql, 'p1', 'run-5', T0, false));
    const res = tx(() => finishRun(sql, 'p1', 'fin-5', { runId: start.runId, trace: steady() }, T0 + RUN_MS, false));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.wins).toBeGreaterThanOrEqual(25);
    const award = res.awards.find((a) => a.wins === 25);
    expect(award?.title).toBe('Пилот пояса');

    // Следующий забег: медаль повторно не выдаётся.
    const start2 = tx(() => startRun(sql, 'p1', 'run-6', T0 + 60_000, false));
    const res2 = tx(() => finishRun(sql, 'p1', 'fin-6', { runId: start2.runId, trace: steady() }, T0 + 60_000 + RUN_MS, false));
    if (!res2.ok) return;
    expect(res2.awards.some((a) => a.wins === 25)).toBe(false);
  });

  it('экран арены показывает попытки, ступени и историю', () => {
    const { sql, tx } = world();
    const start = tx(() => startRun(sql, 'p1', 'run-7', T0, false));
    tx(() => finishRun(sql, 'p1', 'fin-7', { runId: start.runId, trace: steady() }, T0 + RUN_MS, false));
    const view = minigameView(sql, 'p1', T0 + RUN_MS, false);
    expect(view.attempts.used).toBe(1);
    expect(view.recent.length).toBe(1);
    expect(view.tiers.map((t) => t.wins)).toEqual([25, 50, 100]);
    expect(view.field.width).toBe(1000);
  });

  it('журнал мира сходится после мини-игры', () => {
    const { sql, tx } = world();
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'astra', delta: 100, reason: 'seed' }, T0));
    const start = tx(() => startRun(sql, 'p1', 'run-8', T0, false));
    tx(() => finishRun(sql, 'p1', 'fin-8', { runId: start.runId, trace: steady() }, T0 + RUN_MS, false));
    const flow = sql.exec(`SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE asset = 'astra'`).toArray()[0];
    expect(Number(flow.s)).toBe(getBalance(sql, 'p1', 'astra'));
  });
});

describe('мини-игра: сервер принимает «живую», а не идеальную трассу', () => {
  it('рывок на 700 px чинится зажимом скорости, а не отказом', () => {
    const jitter: TracePoint[] = [];
    for (let t = 0; t <= RUN_MS; t += 40) jitter.push({ t, x: 500 });
    jitter[300] = { t: jitter[300].t, x: 1200 };
    const fixed = sanitizeTrace(jitter);
    expect(validateTrace(fixed)).toBe(null);
    expect(evaluate(42, fixed).ok).toBe(true);

    // Порванная запись (вкладка ушла в фон) продлевается до конца забега.
    const cut = jitter.slice(0, 200);
    const padded = sanitizeTrace(cut);
    expect(padded[padded.length - 1].t).toBe(RUN_MS);
    expect(evaluate(42, padded).ok).toBe(true);
  });

  it('старт не с нуля сдвигается, координаты зажимаются в поле', () => {
    const late = steady(500).map((p) => ({ t: p.t + 1800, x: p.x }));
    const fixed = sanitizeTrace(late);
    expect(fixed[0].t).toBe(0);
    const wild = sanitizeTrace([{ t: 0, x: -50 }, { t: 100, x: 5000 }, { t: 45_000, x: 400 }]);
    expect(wild.every((p) => p.x >= 0 && p.x <= 1000)).toBe(true);
    expect(validateTrace(wild)).toBe(null);
  });

  it('забег «как у живого игрока» (60 fps + джиттер) засчитывается', () => {
    const seed = 5;
    const field = makeField(seed);
    const points: TracePoint[] = [];
    let t = 0;
    let x = 500;
    let ci = 0;
    // Кадры по 12–34 мс, отсчёт каждые ~40 мс: ровно то, что делает браузер.
    let frame = 0;
    while (t <= RUN_MS) {
      const dt = 12 + ((frame * 7919) % 23);
      frame += 1;
      t += dt;
      while (ci < field.crystals.length && field.crystals[ci].t <= t) ci += 1;
      const target = ci < field.crystals.length ? field.crystals[ci].x : x;
      const stepMax = (MAX_SPEED * dt) / 1000;
      x += Math.max(-stepMax, Math.min(stepMax, target - x));
      if (frame % 2 === 0) points.push({ t: Math.round(t), x: Math.round(x * 10) / 10 });
    }
    const result = evaluate(seed, sanitizeTrace(points));
    expect(result.ok).toBe(true);
    expect(result.picks).toBeGreaterThan(10);
  });

  it('забег с рывком всё равно закрывается в мире и не теряет попытку зря', () => {
    const { sql, tx } = world();
    const start = tx(() => startRun(sql, 'p1', 'run-9', T0, false));
    const trace = steady(500);
    trace[100] = { t: trace[100].t, x: 1000 };
    const res = tx(() => finishRun(sql, 'p1', 'fin-9', { runId: start.runId, trace }, T0 + RUN_MS, false));
    expect(res.ok).toBe(true);
  });
});
