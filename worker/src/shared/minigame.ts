// Мини-игра «Астероидный залп» — один и тот же расчёт на сервере и в браузере.
//
// Важно: счёт считает ТОЛЬКО сервер. Клиент присылает не «я собрал 40 кристаллов»,
// а трассу — пары «время → x корабля». Сервер сам строит препятствия из зерна и
// сам решает, во что игрок врезался. Подделать можно лишь идеальную трассу, но
// она обязана уважать максимальную скорость корабля, то есть фактически это игра.
//
// Модуль чистый: ни DOM, ни сети, ни времени. Поэтому его можно прогнать в тесте
// и отдать в браузер тем же кодом (сборка: scripts/build-minigame.mjs).

export const FIELD_W = 1000;
export const SHIP_HALF = 30;
/** Сколько длится забег. */
export const RUN_MS = 45_000;
/** Шаг серверного расчёта. */
export const TICK_MS = 50;
export const TICKS = RUN_MS / TICK_MS;
/** Максимальная скорость корабля, px в секунду. */
export const MAX_SPEED = 900;
/** Допуск на округление и сетевой джиттер при проверке трассы. */
export const SLACK_PX = 14;
export const ASTER_R = 34;
export const CRYSTAL_R = 28;
/** Со скольких очков забег считается победой. */
export const WIN_SCORE = 150;

export interface Asteroid {
  /** Момент, когда астероид пересекает линию корабля. */
  t: number;
  x: number;
  r: number;
  /** Скорость падения — только для отрисовки. */
  speed: number;
}

export interface Crystal {
  t: number;
  x: number;
  r: number;
}

export interface Field {
  seed: number;
  asteroids: Asteroid[];
  crystals: Crystal[];
}

export interface TracePoint {
  t: number;
  x: number;
}

export interface RunResult {
  ok: boolean;
  /** Причина отказа, если трассу принять нельзя. */
  error?: 'bad_trace' | 'too_fast' | 'short';
  score: number;
  hits: number;
  picks: number;
  win: boolean;
  /** Сколько тиков корабль реально провёл в игре. */
  ticks: number;
}

/** mulberry32: маленький, быстрый и одинаковый в любом движке. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(seed: number): number {
  const next = rng(seed);
  return Math.floor(next() * 0xffffffff) >>> 0;
}

/**
 * Поле строится только из зерна: сервер и клиент получают одинаковые астероиды
 * и кристаллы, не пересылая друг другу список объектов.
 */
export function makeField(seed: number): Field {
  const rand = rng(seedOf(seed));
  const asteroids: Asteroid[] = [];
  // Поток астероидов: первый на 4-й секунде, к концу всё плотнее. Тридцать с
  // небольшим камней на 45 секунд — это «напряжённо, но проходимо»: игрок
  // успевает и собирать кристаллы, и уходить.
  let t = 4000;
  while (t < RUN_MS - 800) {
    asteroids.push({
      t,
      x: 60 + rand() * (FIELD_W - 120),
      r: ASTER_R,
      speed: 0.32 + rand() * 0.22,
    });
    const gap = 760 + rand() * 460 - (t / RUN_MS) * 300;
    t += Math.max(430, gap);
  }
  // Кристаллы: ровный поток, чтобы был смысл двигаться, а не стоять в углу.
  const crystals: Crystal[] = [];
  let c = 1600;
  while (c < RUN_MS - 900) {
    crystals.push({ t: c, x: 50 + rand() * (FIELD_W - 100), r: CRYSTAL_R });
    c += 1100 + rand() * 700;
  }
  return { seed, asteroids, crystals };
}

/** Линейная интерполяция позиции корабля между двумя отсчётами трассы. */
export function shipXAt(points: TracePoint[], t: number): number | null {
  if (!points.length) return null;
  if (t <= points[0].t) return points[0].x;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.x;
      const k = (t - a.t) / span;
      return a.x + (b.x - a.x) * k;
    }
  }
  return points[points.length - 1].x;
}

/**
 * Проверка трассы: время по возрастанию, координаты в поле, скорость не больше
 * предела. Всё, что не проходит, — отказ без награды (попытка при этом тратится:
 * иначе можно перебирать трассы бесплатно).
 */
export function validateTrace(points: TracePoint[]): 'bad_trace' | 'too_fast' | 'short' | null {
  if (!Array.isArray(points) || points.length < 40 || points.length > 4000) return 'bad_trace';
  let prev: TracePoint | null = null;
  for (const p of points) {
    if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.x)) return 'bad_trace';
    if (p.x < 0 || p.x > FIELD_W) return 'bad_trace';
    if (prev) {
      const dt = p.t - prev.t;
      if (dt < 0) return 'bad_trace';
      // Шаг меньше тика — нормально (браузер шлёт чаще), но он не должен давать
      // права на «телепорт».
      const allowed = (MAX_SPEED * dt) / 1000 + SLACK_PX;
      if (Math.abs(p.x - prev.x) > allowed) return 'too_fast';
    }
    prev = p;
  }
  const last = points[points.length - 1];
  if (last.t < RUN_MS - 1500) return 'short';
  if (points[0].t > 2500) return 'short';
  return null;
}

/**
 * Компактная запись трассы: клиент шлёт только x (в десятых долях пикселя) и
 * шаг времени, а не тысячу объектов. 16 КБ лимита тела хватает с запасом,
 * и трасса остаётся честной: время восстанавливается по шагу.
 */
export function expandTrace(xs: unknown[], stepMs: number): TracePoint[] {
  const step = Math.min(200, Math.max(20, Math.floor(Number(stepMs) || 40)));
  return xs.slice(0, 2000).map((value, i) => ({ t: i * step, x: Number(value) / 10 }));
}

/**
 * Приведение трассы к «физически возможной».
 *
 * Браузер не идеален: кадр может подвиснуть, вкладка — уйти в фон, палец —
 * дёрнуться. Отбивать такой забег значит терять попытку игрока из-за его
 * телефона. Поэтому вместо отказа мы чиним трассу: время выравниваем,
 * координаты зажимаем в поле, а скорость — в предел корабля, хвост продлеваем
 * до конца забега. Подделать это нельзя: зажим только замедляет движение.
 */
export function sanitizeTrace(points: TracePoint[]): TracePoint[] {
  const clean: TracePoint[] = [];
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.x)) continue;
    clean.push({ t: Math.max(0, p.t), x: Math.min(FIELD_W, Math.max(0, p.x)) });
  }
  if (clean.length < 2) return clean;
  clean.sort((a, b) => a.t - b.t);

  const out: TracePoint[] = [];
  let prev: TracePoint | null = null;
  for (const p of clean) {
    if (prev && p.t - prev.t < 1) {
      // Два отсчёта в одну миллисекунду: оставляем последний, иначе появляется
      // «нулевой» интервал, в котором формально можно телепортироваться.
      out[out.length - 1] = { t: prev.t, x: p.x };
      prev = out[out.length - 1];
      continue;
    }
    if (prev) {
      const dt = p.t - prev.t;
      const allowed = (MAX_SPEED * dt) / 1000;
      const dx = p.x - prev.x;
      if (Math.abs(dx) > allowed) {
        const fixed: TracePoint = { t: p.t, x: prev.x + Math.sign(dx) * allowed };
        out.push(fixed);
        prev = fixed;
        continue;
      }
    }
    out.push(p);
    prev = p;
  }
  // Сдвигаем старт к нулю: клиент мог начать отсчёт не с первого кадра.
  const shift = out[0].t;
  if (shift > 0) {
    for (const p of out) p.t -= shift;
  }
  // Пересэмплируем на ровную сетку 40 мс. Так принимающая сторона получает
  // одинаковый формат независимо от того, как часто браузер успевал слать
  // отсчёты, а обрыв записи (вкладка ушла в фон) означает «корабль стоит».
  const first = out[0];
  const grid: TracePoint[] = [];
  for (let t = 0; t <= RUN_MS; t += 40) {
    const x = shipXAt(out, t);
    grid.push({ t, x: x === null ? first.x : x });
  }
  if (grid[grid.length - 1].t < RUN_MS) grid.push({ t: RUN_MS, x: grid[grid.length - 1].x });
  return grid;
}

/**
 * Пересчёт забега. Одинаково вызывается на сервере (для награды) и в браузере
 * (для подсказки «сколько уже набрал»), поэтому результат должен быть побитово
 * одинаковым при одинаковом входе.
 */
export function evaluate(seed: number, points: TracePoint[]): RunResult {
  const empty: RunResult = { ok: false, score: 0, hits: 0, picks: 0, win: false, ticks: 0 };
  const error = validateTrace(points);
  if (error) return { ...empty, error };

  const field = makeField(seed);
  let hits = 0;
  let picks = 0;
  for (const a of field.asteroids) {
    const x = shipXAt(points, a.t);
    if (x !== null && Math.abs(x - a.x) < a.r + SHIP_HALF) hits += 1;
  }
  for (const c of field.crystals) {
    const x = shipXAt(points, c.t);
    if (x !== null && Math.abs(x - c.x) < c.r + SHIP_HALF) picks += 1;
  }
  // Пробоина дороже кристалла: иначе выгодно «пробежать напролом».
  const score = Math.max(0, picks * 10 - hits * 15);
  return {
    ok: true,
    score,
    hits,
    picks,
    win: score >= WIN_SCORE,
    ticks: Math.round(points[points.length - 1].t / TICK_MS),
  };
}

/** Награда за забег: скромная, с суточным потолком на стороне мира. */
export function rewardFor(result: RunResult): { astra: number; points: number } {
  if (!result.ok) return { astra: 0, points: 0 };
  const astra = Math.max(1, Math.min(45, 4 + result.picks * 2 - result.hits * 2));
  const points = Math.max(0, result.picks + (result.win ? 20 : 4));
  return { astra, points };
}

/** Ступени «победи N раз» — витрина достижений мини-игры. */
export const WIN_TIERS: { wins: number; astra: number; medal: string; title: string }[] = [
  { wins: 25, astra: 300, medal: 'clash_25', title: 'Пилот пояса' },
  { wins: 50, astra: 600, medal: 'clash_50', title: 'Ас пояса' },
  { wins: 100, astra: 1200, medal: 'clash_100', title: 'Легенда пояса' },
];
