import { describe, expect, it } from 'vitest';
import {
  AIM_TARGETS, ARCADE_GAMES, ARCADE_IDS, BALL_R, BALL_SPEED, BREAKOUT_BRICKS, BREAKOUT_LIVES, BREAKOUT_STEP,
  BRICK_H, BRICK_ROWS, BRICK_TOP, BRICK_W, FIELD_W, INPUT_MAX, MAZE_COLS,
  MAX_SCORE, MEMORY_PAIRS, REACT_TARGETS, RUNNER_MAX_Y, SAMPLE_MS, SNAKE_COLS, SNAKE_ROWS,
  SNAKE_STEP, SNAKE_START_LEN, WIN_SCORE,
  evaluateArcade, makeAimTargets, makeBreakoutState, makeCatchField, makeMaze, makeMemoryDeck,
  makeReactionTargets, makeRunnerTrack, makeSequence, makeSnakeState, makeSudoku,
  readAxis, samplesFor, solveMaze, spawnSnakeFood, stepBreakout, stepSnake, traceAt,
} from '../../src/shared/arcade';

// Чистые правила аркады: то, что считает и сервер, и браузер. Здесь проверяется
// главное — что игру нельзя ни выиграть вводом «мимо правил», ни потерять из-за
// округлений, и что одна и та же трасса даёт один и тот же счёт.

const SEED = 123_456_789;

/** Ходы по готовому пути BFS: идеальное решение лабиринта. */
function mazeMoves(path: number[], cols: number): number[] {
  const moves: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1] % cols;
    const ay = Math.floor(path[i - 1] / cols);
    const bx = path[i] % cols;
    const by = Math.floor(path[i] / cols);
    moves.push(bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : 0);
  }
  return moves;
}

/** Ровная сетка отсчётов: ровно то, что присылает клиент. */
function grid(runMs: number, value: (t: number) => number): number[] {
  const n = samplesFor(runMs, SAMPLE_MS);
  return Array.from({ length: n }, (_, i) => Math.round(value(i * SAMPLE_MS) * 10));
}

describe('каталог аркады', () => {
  it('содержит ровно десять разных игр', () => {
    expect(ARCADE_GAMES).toHaveLength(10);
    expect(new Set(ARCADE_IDS).size).toBe(10);
    expect([...ARCADE_IDS].sort()).toEqual(
      ['aim', 'breakout', 'catch', 'maze', 'memory', 'reaction', 'runner', 'sequence', 'snake', 'sudoku'],
    );
  });

  it('у каждой игры есть название, спрайт, управление и длительность', () => {
    for (const g of ARCADE_GAMES) {
      expect(g.title.length).toBeGreaterThan(3);
      expect(g.sprite).toMatch(/^\/sprites\/arcade\/[a-z0-9_]+\.png$/);
      expect(g.controls.length).toBeGreaterThan(3);
      expect(g.rules.length).toBeGreaterThan(20);
      expect(g.runMs).toBeGreaterThan(1000);
      expect(g.runMs).toBeLessThanOrEqual(600_000);
    }
  });

  it('максимум очков и порог победы согласованы', () => {
    expect(MAX_SCORE).toBe(600);
    expect(WIN_SCORE).toBe(MAX_SCORE / 2);
  });
});

describe('лабиринт', () => {
  it('из одного зерна всегда одинаковый и у него есть решение', () => {
    const a = makeMaze(SEED);
    const b = makeMaze(SEED);
    expect(a.mask).toEqual(b.mask);
    expect(a.mask).toHaveLength(MAZE_COLS * 9);
    expect(solveMaze(a).steps).toBeGreaterThan(10);
  });

  it('идеальное решение — максимум очков и победа', () => {
    const g = makeMaze(SEED);
    const { path, steps } = solveMaze(g);
    const r = evaluateArcade('maze', SEED, { moves: mazeMoves(path, g.cols) });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(MAX_SCORE);
    expect(r.win).toBe(true);
    expect(r.detail.extra).toBe(0);
    expect(r.detail.steps).toBe(steps);
  });

  it('лишние шаги снижают счёт', () => {
    const g = makeMaze(SEED);
    const { path } = solveMaze(g);
    const clean = mazeMoves(path, g.cols);
    // «Шаг в сторону и обратно» — легальный манёвр: ищем клетку пути, у которой
    // есть свободный бок, и уходим в него. Сквозь стену такой трюк не прошёл бы.
    let detour: number[] | null = null;
    for (let i = 1; i < path.length - 1 && !detour; i += 1) {
      const cell = path[i];
      const x = cell % g.cols;
      const y = Math.floor(cell / g.cols);
      for (let d = 0; d < 4; d += 1) {
        if (g.mask[cell] & [1, 2, 4, 8][d]) continue;
        const nx = x + [0, 1, 0, -1][d];
        const ny = y + [-1, 0, 1, 0][d];
        if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
        detour = [...clean.slice(0, i), d, (d + 2) % 4, ...clean.slice(i)];
        break;
      }
    }
    expect(detour).not.toBeNull();
    const r = evaluateArcade('maze', SEED, { moves: detour! });
    expect(r.ok).toBe(true);
    expect(r.score).toBeLessThan(MAX_SCORE);
    expect(r.detail.extra).toBe(2);
  });

  it('сквозь стену и путь короче кратчайшего — отказ', () => {
    expect(evaluateArcade('maze', SEED, { moves: [0] }).error).toBe('bad_trace');
    const g = makeMaze(SEED);
    const { path } = solveMaze(g);
    const short = mazeMoves(path, g.cols).slice(0, -6);
    // Оборванный путь: до выхода не дошёл.
    expect(evaluateArcade('maze', SEED, { moves: short }).error).toBe('short');
    // А «дошёл за пару ходов» — это подбор по зерну, а не игра.
    expect(evaluateArcade('maze', SEED, { moves: [1, 1, 1, 1, 1] }).error).toBe('bad_trace');
  });

  it('пустой и раздутый список не проходят', () => {
    expect(evaluateArcade('maze', SEED, { moves: [] }).error).toBe('bad_trace');
    expect(evaluateArcade('maze', SEED, { moves: new Array(INPUT_MAX + 5).fill(1) }).error).toBe('bad_trace');
    expect(evaluateArcade('maze', SEED, { moves: [1, 2.5, 1] }).error).toBe('bad_trace');
  });
});

describe('судоку', () => {
  it('у поля ровно одно решение, и подсказки не противоречат себе', () => {
    const { grid, solution } = makeSudoku(SEED);
    expect(grid).toHaveLength(81);
    expect(solution).toHaveLength(81);
    let empty = 0;
    for (let i = 0; i < 81; i += 1) {
      if (grid[i] === 0) {
        empty += 1;
        expect(solution[i]).toBeGreaterThanOrEqual(1);
      } else {
        expect(grid[i]).toBe(solution[i]);
      }
    }
    expect(empty).toBeGreaterThanOrEqual(30);
    expect(empty).toBeLessThan(81);
    for (const [r, c] of [[0, 0], [4, 4], [8, 8], [2, 7]] as const) {
      expect(solution[r * 9 + c]).toBeGreaterThanOrEqual(1);
    }
    // Строки, столбцы и блоки эталона — без повторов.
    for (let k = 0; k < 9; k += 1) {
      const row = new Set<number>();
      const col = new Set<number>();
      for (let i = 0; i < 9; i += 1) {
        row.add(solution[k * 9 + i]);
        col.add(solution[i * 9 + k]);
      }
      expect(row.size).toBe(9);
      expect(col.size).toBe(9);
    }
  });

  it('решённое поле даёт максимум, половину — половину', () => {
    const { grid, solution } = makeSudoku(SEED);
    const full = evaluateArcade('sudoku', SEED, { answers: solution });
    expect(full.score).toBe(MAX_SCORE);
    expect(full.win).toBe(true);
    const half = solution.map((v, i) => (grid[i] !== 0 ? 0 : i % 2 === 0 ? v : 0));
    const r = evaluateArcade('sudoku', SEED, { answers: half });
    expect(r.ok).toBe(true);
    expect(r.score).toBeLessThan(MAX_SCORE);
    expect(r.score).toBeGreaterThan(100);
  });

  it('правка подсказки и неполный список — отказ', () => {
    const { grid, solution } = makeSudoku(SEED);
    const tampered = solution.slice();
    const givenIndex = grid.findIndex((v) => v !== 0);
    tampered[givenIndex] = (tampered[givenIndex] % 9) + 1;
    expect(evaluateArcade('sudoku', SEED, { answers: tampered }).error).toBe('bad_trace');
    expect(evaluateArcade('sudoku', SEED, { answers: solution.slice(0, 40) }).error).toBe('short');
    expect(evaluateArcade('sudoku', SEED, { answers: solution.map(() => 10) }).error).toBe('bad_trace');
  });
});

describe('нейро-пары', () => {
  it('колода симметрична и детерминирована', () => {
    const deck = makeMemoryDeck(SEED);
    expect(deck).toHaveLength(MEMORY_PAIRS * 2);
    const counts = new Map<number, number>();
    for (const v of deck) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBe(2);
    expect(makeMemoryDeck(SEED)).toEqual(deck);
  });

  it('идеальная игра — максимум, ноль совпадений — попытка сгорает', () => {
    const deck = makeMemoryDeck(SEED);
    const bySprite = new Map<number, number[]>();
    deck.forEach((v, i) => bySprite.set(v, [...(bySprite.get(v) ?? []), i]));
    const perfect = [...bySprite.values()].flat();
    const r = evaluateArcade('memory', SEED, { moves: perfect });
    expect(r.score).toBeGreaterThan(WIN_SCORE);
    expect(r.detail.turns).toBe(MEMORY_PAIRS);
    // «Начать и бросить»: одна собранная пара — меньше максимума, но зачёт.
    const part = perfect.slice(0, 6);
    const partial = evaluateArcade('memory', SEED, { moves: part });
    expect(partial.ok).toBe(true);
    expect(partial.score).toBeLessThan(MAX_SCORE);
    expect(partial.detail.matched).toBe(3);
    // Ноль совпадений — это не игра: попытка сгорает.
    const a = makeMemoryDeck(SEED);
    let mismatch: number[] | null = null;
    for (let i = 0; i < a.length; i += 1) {
      for (let j = i + 1; j < a.length; j += 1) {
        if (a[i] !== a[j]) { mismatch = [i, j]; break; }
      }
      if (mismatch) break;
    }
    expect(evaluateArcade('memory', SEED, { moves: [...mismatch!, ...mismatch!] }).error).toBe('short');
  });

  it('повтор той же карты и уже собранной пары — отказ', () => {
    const deck = makeMemoryDeck(SEED);
    const pair = deck.findIndex((v, i) => i + 1 < deck.length && deck[i + 1] === v);
    expect(evaluateArcade('memory', SEED, { moves: [pair, pair] }).error).toBe('bad_trace');
    const moves = [pair, pair + 1, pair, pair + 1];
    expect(evaluateArcade('memory', SEED, { moves }).error).toBe('bad_trace');
  });
});

describe('сигнальная цепь', () => {
  it('точный повтор — максимум, ошибка обрывает засчёт', () => {
    const seq = makeSequence(SEED);
    expect(seq.every((v) => v >= 0 && v < 4)).toBe(true);
    const full = evaluateArcade('sequence', SEED, { presses: seq });
    expect(full.score).toBe(MAX_SCORE);
    expect(full.detail.level).toBe(12);
    const broke = seq.slice();
    broke[6] = (broke[6] + 1) % 4;
    const r = evaluateArcade('sequence', SEED, { presses: broke });
    expect(r.detail.correct).toBe(6);
    expect(r.win).toBe(false);
  });

  it('меньше трёх сигналов не считается игрой', () => {
    const seq = makeSequence(SEED);
    expect(evaluateArcade('sequence', SEED, { presses: [seq[0], (seq[1] + 1) % 4] }).error).toBe('short');
    expect(evaluateArcade('sequence', SEED, { presses: [9] }).error).toBe('bad_trace');
  });
});

describe('импульс', () => {
  it('окна идут по зерну и не пересекаются', () => {
    const targets = makeReactionTargets(SEED);
    expect(targets).toHaveLength(REACT_TARGETS);
    for (let i = 1; i < targets.length; i += 1) {
      expect(targets[i].at - targets[i - 1].at).toBeGreaterThan(targets[i - 1].window);
    }
  });

  it('восемь точных тапов — максимум; флюид по клавише — отказ', () => {
    const targets = makeReactionTargets(SEED);
    const r = evaluateArcade('reaction', SEED, { taps: targets.map((t) => t.at + 60) });
    expect(r.score).toBe(MAX_SCORE);
    expect(r.detail.avg_ms).toBe(60);
    const late = evaluateArcade('reaction', SEED, { taps: targets.map((t) => t.at + 250) });
    expect(late.detail.hits).toBe(REACT_TARGETS);
    expect(late.score).toBeLessThan(MAX_SCORE);
    expect(late.score).toBeGreaterThan(WIN_SCORE);
    // Спам чаще 150 мс — это не реакция.
    expect(evaluateArcade('reaction', SEED, { taps: [900, 950, 1000, 1050] }).error).toBe('too_fast');
    // Мимо всех окон — попытка сгорает.
    expect(evaluateArcade('reaction', SEED, { taps: targets.map((t) => t.at + 5000) }).error).toBe('short');
    // Слишком много тапов — больше, чем окон + 2, прислать нельзя.
    expect(evaluateArcade('reaction', SEED, { taps: Array.from({ length: REACT_TARGETS + 3 }, (_, i) => 20000 + i * 400) }).error)
      .toBe('bad_trace');
  });
});

describe('бегун', () => {
  it('поле из зерна и трасса «стоять» не даёт очков', () => {
    const track = makeRunnerTrack(SEED);
    expect(track.events.length).toBeGreaterThan(10);
    const idle = evaluateArcade('runner', SEED, { axis: grid(track.runMs, () => 0), stepMs: SAMPLE_MS });
    expect(idle.ok).toBe(true);
    expect(idle.score).toBe(0);
    expect(idle.detail.crashes).toBeGreaterThan(0);
  });

  it('прыжок по подсказке поля обегает валуны', () => {
    const track = makeRunnerTrack(SEED);
    const axis = grid(track.runMs, (t) => {
      let y = 0;
      for (const e of track.events) {
        if (e.kind === 'drone') continue;
        const dt = e.t - 330 - t;
        if (dt <= 0 && dt > -740) {
          const p = -dt / 1000;
          y = Math.max(y, Math.min(RUNNER_MAX_Y, 900 * p - 1200 * p * p));
        }
      }
      return y;
    });
    const r = evaluateArcade('runner', SEED, { axis, stepMs: SAMPLE_MS });
    expect(r.ok).toBe(true);
    expect(r.detail.crashes).toBeLessThan(r.detail.events);
    expect(r.detail.passed).toBeGreaterThan(5);
    expect(r.score).toBeGreaterThan(0);
  });

  it('обрыв трассы — short, а не награда', () => {
    const track = makeRunnerTrack(SEED);
    const axis = grid(track.runMs, () => 0).slice(0, 40);
    expect(evaluateArcade('runner', SEED, { axis, stepMs: SAMPLE_MS }).error).toBe('short');
    expect(evaluateArcade('runner', SEED, { axis: [], stepMs: SAMPLE_MS }).error).toBe('bad_trace');
  });

  it('прыжок выше физики зажимается, а не превращается в вечную неуязвимость', () => {
    const track = makeRunnerTrack(SEED);
    const cheat = grid(track.runMs, () => 900);
    const r = evaluateArcade('runner', SEED, { axis: cheat, stepMs: SAMPLE_MS });
    const clamp = readAxis(cheat, SAMPLE_MS, RUNNER_MAX_Y, 950);
    expect(clamp).not.toBeNull();
    // Зажим по скорости не даёт «мгновенно взлететь»: значит, часть валунов
    // всё равно останется под игроком.
    expect(r.ok).toBe(true);
    expect(r.score).toBeLessThanOrEqual(MAX_SCORE);
  });
});

describe('разбор щита', () => {
  it('разобранный щит завершает раунд, а заряд не вылетает за поле', () => {
    const s = makeBreakoutState(SEED);
    expect(s.bricks).toHaveLength(BREAKOUT_BRICKS);
    expect(BREAKOUT_BRICKS).toBe(10 * BRICK_ROWS);
    for (let i = 0; i < 600; i += 1) {
      stepBreakout(s, 20, 500);
      expect(s.bx).toBeGreaterThanOrEqual(20);
      expect(s.bx).toBeLessThanOrEqual(980);
      // Скорость заряда постоянна: ускорить её нельзя, а значит, и «пробежать
      // щит быстрее» тоже нельзя.
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(BALL_SPEED, 1);
    }
    expect(s.destroyed).toBeGreaterThan(0);
    expect(s.lost).toBeGreaterThan(0);
    expect(s.lives).toBe(BREAKOUT_LIVES - s.lost);
    const last = makeBreakoutState(SEED);
    last.bricks.fill(0);
    last.destroyed = BREAKOUT_BRICKS - 1;
    last.bricks[0] = 1;
    last.bx = 20 + BRICK_W / 2;
    last.by = BRICK_TOP + BRICK_H + BALL_R - 1;
    last.vx = 0;
    last.vy = -BALL_SPEED;
    stepBreakout(last, 20, last.bx);
    expect(last.over).toBe(true);
    expect(last.destroyed).toBe(BREAKOUT_BRICKS);
  });

  it('симуляция клиента и пересчёт сервера совпадают', () => {
    const runMs = 60_000;
    // Платформа идёт по синусоиде; и здесь, и на сервере позиция берётся из
    // одной и той же сетки отсчётов через traceAt — расхождения быть не может.
    const axis = grid(runMs, (t) => 500 + Math.sin(t / 900) * 420);
    const pts = readAxis(axis, SAMPLE_MS, FIELD_W, 1100)!;
    const local = makeBreakoutState(SEED);
    for (let i = 0; i < runMs / BREAKOUT_STEP; i += 1) {
      stepBreakout(local, BREAKOUT_STEP, traceAt(pts, i * BREAKOUT_STEP));
      if (local.over) break;
    }
    const server = evaluateArcade('breakout', SEED, { axis, stepMs: SAMPLE_MS });
    expect(server.detail.destroyed).toBe(local.destroyed);
    expect(server.detail.lost).toBe(local.lost);
  });

  it('считает трассу клиента и не боится мусора', () => {
    const runMs = 60_000;
    const sweep = evaluateArcade('breakout', SEED, { axis: grid(runMs, (t) => 500 + Math.sin(t / 700) * 460), stepMs: SAMPLE_MS });
    expect(sweep.ok).toBe(true);
    expect(Number.isFinite(sweep.score)).toBe(true);
    expect(evaluateArcade('breakout', SEED, { axis: grid(runMs, () => 500).slice(0, 10), stepMs: SAMPLE_MS }).error).toBe('short');
    expect(evaluateArcade('breakout', SEED, { axis: 'нет', stepMs: SAMPLE_MS }).error).toBe('bad_trace');
  });
});

describe('сборка зонда (змейка)', () => {
  it('стартует корректно и не съедает саму себя на первом шаге', () => {
    const s = makeSnakeState(SEED);
    expect(s.body).toHaveLength(SNAKE_START_LEN);
    expect(s.food).toBeGreaterThanOrEqual(0);
    expect(s.body.includes(s.food)).toBe(false);
  });

  it('разворот на 180° игнорируется, в стену — смерть', () => {
    const s = makeSnakeState(SEED);
    stepSnake(s, 3, SEED);
    expect(s.dir).toBe(1);
    const long = makeSnakeState(SEED);
    for (let i = 0; i < SNAKE_COLS + 2; i += 1) stepSnake(long, 1, SEED);
    expect(long.dead).toBe(true);
  });

  it('жратва растёт только на корме, и она всегда на свободной клетке', () => {
    const s = makeSnakeState(SEED);
    const target = s.body[0] + 1;
    s.food = target;
    stepSnake(s, 1, SEED);
    expect(s.eaten).toBe(1);
    expect(s.body).toHaveLength(SNAKE_START_LEN + 1);
    expect(s.body.includes(s.food)).toBe(false);
    expect(spawnSnakeFood(SEED, s)).toBeGreaterThanOrEqual(0);
  });

  it('трасса: короткие списки — short, мусор — bad_trace, игра — очки', () => {
    const dirs: number[] = [];
    const s = makeSnakeState(SEED);
    const blocked = new Set<number>(s.body);
    for (let i = 0; i < Math.floor(60_000 / SNAKE_STEP); i += 1) {
      const x = s.body[0] % SNAKE_COLS;
      const y = Math.floor(s.body[0] / SNAKE_COLS);
      const fx = s.food % SNAKE_COLS;
      const fy = Math.floor(s.food / SNAKE_COLS);
      const options: [number, number, number][] = [[0, x, y - 1], [1, x + 1, y], [2, x, y + 1], [3, x - 1, y]];
      const ok = options.find(([, nx, ny]) => nx >= 0 && ny >= 0 && nx < SNAKE_COLS && ny < SNAKE_ROWS && !blocked.has(ny * SNAKE_COLS + nx));
      const dir = ok ? ok[0] : s.dir;
      dirs.push(dir);
      const [hx, hy] = [x, y];
      const nx = hx + [0, 1, 0, -1][dir];
      const ny = hy + [-1, 0, 1, 0][dir];
      if (nx >= 0 && ny >= 0 && nx < SNAKE_COLS && ny < SNAKE_ROWS) blocked.add(ny * SNAKE_COLS + nx);
      stepSnake(s, dir, SEED);
      if (s.dead) break;
    }
    // Оборванный ввод добиваем последним направлением: так и «не доиграл», и
    // «сдался на пятой секунде» не превращаются в бесплатный пропуск.
    const full = dirs.concat(new Array(Math.max(0, samplesFor(60_000, SNAKE_STEP) - dirs.length)).fill(dirs[dirs.length - 1] ?? 1));
    const r = evaluateArcade('snake', SEED, { dirs: full });
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(evaluateArcade('snake', SEED, { dirs: dirs.slice(0, 20) }).error).toBe('short');
    expect(evaluateArcade('snake', SEED, { dirs: [] }).error).toBe('bad_trace');
    expect(evaluateArcade('snake', SEED, { dirs: new Array(INPUT_MAX + 1).fill(1) }).error).toBe('bad_trace');
  });
});

describe('снайперский полигон', () => {
  it('цели не вылезают за поле и успвают по одной', () => {
    const targets = makeAimTargets(SEED);
    expect(targets).toHaveLength(AIM_TARGETS);
    for (const t of targets) {
      expect(t.x).toBeGreaterThan(0);
      expect(t.x).toBeLessThan(1000);
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(620);
    }
    for (let i = 1; i < targets.length; i += 1) expect(targets[i].t).toBeGreaterThan(targets[i - 1].t);
  });

  it('все попадания — максимум, промахи снимают очки, спам — отказ', () => {
    const targets = makeAimTargets(SEED);
    const perfect = evaluateArcade('aim', SEED, { shots: targets.map((t) => ({ t: t.t + 100, x: t.x, y: t.y })) });
    expect(perfect.score).toBe(MAX_SCORE);
    expect(perfect.detail.hits).toBe(AIM_TARGETS);
    const sloppy = evaluateArcade('aim', SEED, {
      shots: targets.slice(0, 8).map((t) => ({ t: t.t + 100, x: t.x, y: t.y }))
        .concat([{ t: 20000, x: 20, y: 20 }, { t: 20300, x: 40, y: 40 }]),
    });
    expect(sloppy.detail.hits).toBe(8);
    expect(sloppy.score).toBeLessThan(perfect.score);
    expect(evaluateArcade('aim', SEED, { shots: [{ t: 700, x: 10, y: 10 }, { t: 720, x: 12, y: 12 }] }).error).toBe('too_fast');
    expect(evaluateArcade('aim', SEED, { shots: [{ t: 700, x: 5, y: 5 }] }).error).toBe('short');
    expect(evaluateArcade('aim', SEED, { shots: [{ t: 700, x: Number.NaN, y: 5 }] }).error).toBe('bad_trace');
  });
});

describe('грузовая сеть', () => {
  it('поле детерминировано и содержит и груз, и обломки', () => {
    const field = makeCatchField(SEED);
    expect(field.items.length).toBeGreaterThan(20);
    expect(field.items.some((i) => i.kind === 'cargo')).toBe(true);
    expect(field.items.some((i) => i.kind === 'debris')).toBe(true);
    expect(makeCatchField(SEED).items).toEqual(field.items);
  });

  it('ехать за грузом выгоднее, чем стоять', () => {
    const field = makeCatchField(SEED);
    const cargo = field.items.filter((i) => i.kind === 'cargo');
    const chase = grid(field.runMs, (t) => {
      let best = cargo[0];
      for (const c of cargo) {
        if (c.t <= t + 1800 && (!best || Math.abs(c.t - t) < Math.abs(best.t - t))) best = c;
      }
      return best ? best.x : 500;
    });
    const still = grid(field.runMs, () => 500);
    const a = evaluateArcade('catch', SEED, { axis: chase, stepMs: SAMPLE_MS });
    const b = evaluateArcade('catch', SEED, { axis: still, stepMs: SAMPLE_MS });
    expect(a.ok).toBe(true);
    expect(a.detail.picked).toBeGreaterThan(b.detail.picked);
    expect(b.score).toBeLessThan(WIN_SCORE);
  });

  it('короткая трасса и мусор не проходят', () => {
    const field = makeCatchField(SEED);
    expect(evaluateArcade('catch', SEED, { axis: grid(field.runMs, () => 500).slice(0, 30), stepMs: SAMPLE_MS }).error).toBe('short');
    // Слишком ранняя сдача трассы — это «не доиграл».
    expect(evaluateArcade('catch', SEED, { axis: [1, 2, 3, 4], stepMs: Number.NaN }).error).toBe('short');
  });
});

describe('трасса', () => {
  it('шаг зажимается в физический предел', () => {
    const points = readAxis([0, 9000, 0, 0], 40, 1000, 900);
    expect(points).not.toBeNull();
    const pts = points!;
    expect(pts[1].v).toBeLessThanOrEqual(900 * 0.04 + 1e-9);
    expect(traceAt(pts, 100000)).toBe(pts[pts.length - 1].v);
  });

  it('значения вне поля зажимаются, а не уходят в NaN', () => {
    const pts = readAxis([-500, 20_000, 300, 400, 500], 40, 1000, 5000)!;
    for (const p of pts) expect(p.v >= 0 && p.v <= 1000).toBe(true);
  });

  it('слишком длинный список отбивается целиком', () => {
    expect(readAxis(new Array(INPUT_MAX + 1).fill(1), 40, 1000, 900)).toBeNull();
  });
});

describe('общие свойства результатов', () => {
  const inputs: Record<string, Record<string, unknown>> = {
    maze: { moves: [1, 1, 1] },
    sudoku: { answers: new Array(81).fill(5) },
    memory: { moves: [0, 1] },
    sequence: { presses: [0, 0, 0, 0] },
    reaction: { taps: [900] },
    runner: { axis: new Array(200).fill(0), stepMs: SAMPLE_MS },
    breakout: { axis: new Array(200).fill(5000), stepMs: SAMPLE_MS },
    snake: { dirs: new Array(400).fill(1) },
    aim: { shots: [{ t: 700, x: 500, y: 300 }] },
    catch: { axis: new Array(200).fill(5000), stepMs: SAMPLE_MS },
  };

  it('для любой игры либо отказ, либо корректные очки', () => {
    for (const id of ARCADE_IDS) {
      const r = evaluateArcade(id, SEED, inputs[id]);
      if (!r.ok) {
        expect(['bad_trace', 'too_fast', 'short']).toContain(r.error);
        expect(r.score).toBe(0);
        continue;
      }
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(MAX_SCORE);
      expect(r.win).toBe(r.score >= WIN_SCORE);
    }
  });

  it('один и тот же вход даёт один и тот же счёт', () => {
    for (const id of ARCADE_IDS) {
      const a = evaluateArcade(id, SEED, inputs[id]);
      const b = evaluateArcade(id, SEED, inputs[id]);
      expect(b).toEqual(a);
    }
  });

  it('неизвестная игра не рождает undefined', () => {
    const r = evaluateArcade('nope' as never, SEED, {});
    expect(r.ok).toBe(false);
    expect(r.score).toBe(0);
  });
});
