// Аркада: десять мини-игр в одном модуле.
//
// Как и «Астероидный залп», это общий код сервера и браузера: поле строится из
// зерна, а результат считает ТОЛЬКО сервер по трассе/ответам игрока. Отсюда три
// правила, которые соблюдаются в каждой из десяти игр:
//
//   1. Никакого времени, DOM и сети — чистые функции. Поэтому один и тот же файл
//      работает в воркере, в тесте и в браузере (сборка: scripts/build-arcade.mjs).
//   2. Счёт нормализован: 0…600 очков, победа — с 300. Игрок не присылает «я
//      набрал 600», он присылает ходы, а очки считаются здесь.
//   3. Вход всегда подозрителен: списки обрезаются по длине, координаты зажимаются
//      в поле, скорость — в физический предел, невозможный результат (например,
//      проход лабиринта короче кратчайшего пути) — отказ.
//
// Игры:
//   логика  — лабиринт, судоку, пары, сигнальная цепь, реакция;
//   экшн    — бегун, арканоид, змейка, снайпер, грузовая сеть.
// Намеренно берём правила, знакомые любому (labyrinth / sudoku / memory / Simon /
// reaction test / runner / Breakout / Snake / aim trainer / catch): механика
// проверена временем, а честность держится на серверном пересчёте.

export const FIELD_W = 1000;
export const FIELD_H = 620;
/** Шаг серверной сетки отсчётов (как в арене: время = индекс × шаг). */
export const SAMPLE_MS = 40;
/** normalization: максимум очков за игру и порог победы. */
export const MAX_SCORE = 600;
export const WIN_SCORE = 300;
/** Сколько элементов клиент имеет право прислать по любому списку. */
export const INPUT_MAX = 2000;

export type ArcadeId =
  | 'maze' | 'sudoku' | 'memory' | 'sequence' | 'reaction'
  | 'runner' | 'breakout' | 'snake' | 'aim' | 'catch';

/** Причина отказа: тот же набор, что у арены, чтобы клиенту хватало одной таблицы. */
export type ArcadeError = 'bad_trace' | 'too_fast' | 'short';

export interface ArcadeOutcome {
  ok: boolean;
  error?: ArcadeError;
  score: number;
  win: boolean;
  /** Что показать игроку после зачёта: только числа и короткие строки. */
  detail: Record<string, number>;
}

export interface ArcadeMeta {
  id: ArcadeId;
  title: string;
  kind: 'logic' | 'action';
  /** Длительность раунда; у головоломок — «на сколько зерна хватает». */
  runMs: number;
  /** Управление: одна строка в подсказке на экране. */
  controls: string;
  rules: string;
  /** Иконка-спрайт (PNG) — та же каталожная структура, что и у остального арта. */
  sprite: string;
}

/** Каталог — источник истины для мира, маршрута и клиента. */
export const ARCADE_GAMES: ArcadeMeta[] = [
  {
    id: 'maze', title: 'Кристальный блокпост', kind: 'logic', runMs: 180_000,
    controls: 'Стрелки или WASD', rules: 'Выйти из лабиринта кратчайшим путём: чем меньше лишних шагов, тем выше счёт.',
    sprite: '/sprites/arcade/maze.png',
  },
  {
    id: 'sudoku', title: 'Кубическая раскладка', kind: 'logic', runMs: 600_000,
    controls: 'Клик по клетке, затем цифра 1…9', rules: 'Судоку 9×9: строки, столбцы и блоки по 3×3 без повторов. Считаем верно закрытые клетки.',
    sprite: '/sprites/arcade/sudoku.png',
  },
  {
    id: 'memory', title: 'Нейро-пары', kind: 'logic', runMs: 240_000,
    controls: 'Клик по карте', rules: 'Десять пар кристаллов. Открывай по две: совпало — пара закрыта.',
    sprite: '/sprites/arcade/memory.png',
  },
  {
    id: 'sequence', title: 'Сигнальная цепь', kind: 'logic', runMs: 180_000,
    controls: 'Клик по четырём узлам', rules: 'Повтори последовательность узлов: каждый уровень добавляет один сигнал.',
    sprite: '/sprites/arcade/sequence.png',
  },
  {
    id: 'reaction', title: 'Импульс', kind: 'logic', runMs: 20_000,
    controls: 'Пробел или клик по полю', rules: 'Восемь импульсов: нажми, пока маяк горит. Важна и точность, и задержка.',
    sprite: '/sprites/arcade/reaction.png',
  },
  {
    id: 'runner', title: 'Обход пояса', kind: 'action', runMs: 30_000,
    controls: 'Пробел — прыжок', rules: 'Прыгай через валуны и не лезь под дронов. Сбор груза приветствуется.',
    sprite: '/sprites/arcade/runner.png',
  },
  {
    id: 'breakout', title: 'Разбор щита', kind: 'action', runMs: 60_000,
    controls: 'Мышь или палец по полю', rules: 'Платформа отбивает заряд и разбирает щит. Три жизни, потолок и борта пружинят.',
    sprite: '/sprites/arcade/breakout.png',
  },
  {
    id: 'snake', title: 'Сборка зонда', kind: 'action', runMs: 60_000,
    controls: 'Стрелки или WASD', rules: 'Змейка из четырёх сегментов: собирай фракции, не врезайся в себя и в борт.',
    sprite: '/sprites/arcade/snake.png',
  },
  {
    id: 'aim', title: 'Снайперский полигон', kind: 'action', runMs: 25_000,
    controls: 'Мышь, клик по цели', rules: 'Четырнадцать целей вспыхивают на мгновение. Промах дешевле, чем молчание, но бьёт по точности.',
    sprite: '/sprites/arcade/aim.png',
  },
  {
    id: 'catch', title: 'Грузовая сеть', kind: 'action', runMs: 45_000,
    controls: 'Мышь или палец по полю', rules: 'Хват груз на линии ловушки и уходи от обломков. Пустой захват очков не даёт.',
    sprite: '/sprites/arcade/catch.png',
  },
];

export const ARCADE_IDS: ArcadeId[] = ARCADE_GAMES.map((g) => g.id);

export function arcadeMeta(id: unknown): ArcadeMeta | null {
  const want = String(id) as ArcadeId;
  return ARCADE_GAMES.find((g) => g.id === want) ?? null;
}

/** Линейный конгруэнтный генератор mulberry32: быстрый и одинаковый в любом движке. */
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

/** Вторичное зерно: у каждой игры свой поток, чтобы наборы не совпадали. */
function seedOf(seed: number, salt: number): number {
  const next = rng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
  return Math.floor(next() * 0xffffffff) >>> 0;
}

/** Итог в нормализованные очки 0…600 и флаг победы. */
function outcome(score: number, detail: Record<string, number>, error?: ArcadeError): ArcadeOutcome {
  const s = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
  return { ok: true, score: s, win: s >= WIN_SCORE, detail };
}

function fail(error: ArcadeError): ArcadeOutcome {
  return { ok: false, error, score: 0, win: false, detail: {} };
}

/** Числа из JSON: только целые в диапазоне, иначе отказ. */
function intList(raw: unknown, min: number, max: number, cap: number): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > cap) return null;
  const out: number[] = [];
  for (const value of raw as unknown[]) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) return null;
    out.push(n);
  }
  return out;
}

// ── 1. Лабиринт «Кристальный блокпост» ──────────────────────────────────────
// Классический «совершенный» лабиринт: DFS с долблением стен, поэтому между
// любой парой клеток ровно один путь. Отсюда важное для честности свойство:
// кратчайший путь (BFS) — абсолютный минимум ходов. Кто пришлёт короче, тот
// не играл, а гадал, и такой ответ отвергается.

export const MAZE_COLS = 13;
export const MAZE_ROWS = 9;
/** Стены клетки: биты N, E, S, W. */
const WALL = [1, 2, 4, 8];
/** 0 — вверх, 1 — вправо, 2 — вниз, 3 — влево. */
const MOVE_DX = [0, 1, 0, -1];
const MOVE_DY = [-1, 0, 1, 0];
const MOVE_OPP = [2, 3, 0, 1];

export interface MazeGrid {
  cols: number;
  rows: number;
  /** По одному байту маски стен на клетку, порядок — слева направо, сверху вниз. */
  mask: number[];
}

export function makeMaze(seed: number, cols = MAZE_COLS, rows = MAZE_ROWS): MazeGrid {
  const rand = rng(seedOf(seed, 1));
  const mask = new Array<number>(cols * rows).fill(15);
  const seen = new Array<boolean>(cols * rows).fill(false);
  const stack: number[] = [0];
  seen[0] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    const nexts: number[] = [];
    for (let d = 0; d < 4; d += 1) {
      const nx = cx + MOVE_DX[d];
      const ny = cy + MOVE_DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen[ny * cols + nx]) continue;
      nexts.push(d);
    }
    if (!nexts.length) {
      stack.pop();
      continue;
    }
    const d = nexts[Math.floor(rand() * nexts.length)];
    const nxt = (cy + MOVE_DY[d]) * cols + (cx + MOVE_DX[d]);
    mask[cur] &= ~WALL[d];
    mask[nxt] &= ~WALL[MOVE_OPP[d]];
    seen[nxt] = true;
    stack.push(nxt);
  }
  return { cols, rows, mask };
}

/** Кратчайший путь (BFS) в лабиринте. В «совершенном» лабиринте он единственный. */
export function solveMaze(g: MazeGrid): { steps: number; path: number[] } {
  const start = 0;
  const goal = g.cols * g.rows - 1;
  const prev = new Array<number>(g.cols * g.rows).fill(-1);
  const seen = new Array<boolean>(g.cols * g.rows).fill(false);
  const queue = [start];
  seen[start] = true;
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur === goal) break;
    const cx = cur % g.cols;
    const cy = (cur - cx) / g.cols;
    for (let d = 0; d < 4; d += 1) {
      if (g.mask[cur] & WALL[d]) continue;
      const nx = cx + MOVE_DX[d];
      const ny = cy + MOVE_DY[d];
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const nxt = ny * g.cols + nx;
      if (seen[nxt]) continue;
      seen[nxt] = true;
      prev[nxt] = cur;
      queue.push(nxt);
    }
  }
  if (!seen[goal]) return { steps: -1, path: [] };
  const path: number[] = [];
  for (let cur = goal; cur !== -1; cur = prev[cur]) path.unshift(cur);
  return { steps: path.length - 1, path };
}

export function evaluateMaze(seed: number, moves: unknown): ArcadeOutcome {
  const list = intList(moves, 0, 3, 400);
  if (!list) return fail('bad_trace');
  const g = makeMaze(seed);
  const ref = solveMaze(g);
  if (ref.steps < 0) return fail('bad_trace');
  let cur = 0;
  let x = 0;
  let y = 0;
  for (const d of list) {
    // Стена на пути — значит, игрок «шёл сквозь блок». Это отказ, а не шаг.
    if (g.mask[cur] & WALL[d]) return fail('bad_trace');
    x += MOVE_DX[d];
    y += MOVE_DY[d];
    cur = y * g.cols + x;
    if (cur === ref.path[ref.path.length - 1]) break;
  }
  const last = ref.path[ref.path.length - 1];
  if (cur !== last) return fail('short');
  // Кратчайший путь короче не бывает: короткая трасса = подбор по зерну.
  if (list.length < ref.steps) return fail('bad_trace');
  const extra = list.length - ref.steps;
  return outcome((ref.steps / (ref.steps + extra)) * MAX_SCORE, {
    steps: list.length, shortest: ref.steps, extra,
  });
}

// ── 2. Кубическая раскладка (судоку) ────────────────────────────────────────
// Полное поле собирается бэктрекингом по перемешанным кандидатам, затем клетки
// выкапываются только тогда, когда решение остаётся единственным. Поэтому
// «сверить ответ с эталоном» — корректная проверка: второго решения нет.

export interface SudokuPuzzle {
  /** 81 число: 0 — пусто, иначе подсказка. */
  grid: number[];
  /** Единственно верное заполнение. */
  solution: number[];
}

function sudokuOk(board: number[], i: number, v: number): boolean {
  const r = Math.floor(i / 9);
  const c = i % 9;
  for (let k = 0; k < 9; k += 1) {
    if (board[r * 9 + k] === v) return false;
    if (board[k * 9 + c] === v) return false;
  }
  const br = r - (r % 3);
  const bc = c - (c % 3);
  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      if (board[(br + dr) * 9 + bc + dc] === v) return false;
    }
  }
  return true;
}

function sudokuFill(board: number[], pos: number, rand: () => number): boolean {
  while (pos < 81 && board[pos] !== 0) pos += 1;
  if (pos >= 81) return true;
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (const v of order) {
    if (!sudokuOk(board, pos, v)) continue;
    board[pos] = v;
    if (sudokuFill(board, pos + 1, rand)) return true;
    board[pos] = 0;
  }
  return false;
}

/** Счёт решений с потолком: если узел превышен, поле считается «слишком сложным». */
function sudokuCount(board: number[], limit: number, budget: { n: number }): number {
  if (budget.n <= 0) return limit;
  let empty = -1;
  for (let i = 0; i < 81; i += 1) {
    if (board[i] === 0) { empty = i; break; }
  }
  if (empty < 0) return 1;
  let total = 0;
  for (let v = 1; v <= 9; v += 1) {
    if (budget.n <= 0) break;
    if (!sudokuOk(board, empty, v)) continue;
    budget.n -= 1;
    board[empty] = v;
    total += sudokuCount(board, limit - total, budget);
    board[empty] = 0;
    if (total >= limit) break;
  }
  return total;
}

export function makeSudoku(seed: number): SudokuPuzzle {
  const rand = rng(seedOf(seed, 2));
  const board = new Array<number>(81).fill(0);
  sudokuFill(board, 0, rand);
  const solution = board.slice();
  const order = solution.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  // Выкапываем до 46 пустых: дальше перебор решает слишком быстро, и поле
  // начинает выглядеть «случайным», а не головоломкой.
  let empty = 0;
  for (const i of order) {
    if (empty >= 46) break;
    const keep = board[i];
    board[i] = 0;
    const n = sudokuCount(board, 2, { n: 4000 });
    if (n === 1) empty += 1;
    else board[i] = keep;
  }
  return { grid: board, solution };
}

export function evaluateSudoku(seed: number, answers: unknown): ArcadeOutcome {
  const list = intList(answers, 0, 9, 81);
  if (!list) return fail('bad_trace');
  const puzzle = makeSudoku(seed);
  if (list.length !== 81) return fail('short');
  let givenWrong = 0;
  let correct = 0;
  for (let i = 0; i < 81; i += 1) {
    const given = puzzle.grid[i];
    if (given !== 0) {
      // Подсказки меняются только читером: «0» (пропустить) или верное число.
      if (list[i] !== 0 && list[i] !== given) givenWrong += 1;
      continue;
    }
    if (list[i] === puzzle.solution[i]) correct += 1;
  }
  if (givenWrong > 0) return fail('bad_trace');
  // Нормируем по числу пустых клеток, а не по 81: иначе полностью решённая
  // головоломка с 46 пустыми никогда не дотянула бы до максимума.
  const cells = 81 - puzzle.grid.filter((v) => v !== 0).length;
  return outcome((correct / cells) * MAX_SCORE, { correct, cells });
}

// ── 3. Нейро-пары ───────────────────────────────────────────────────────────
// Колода из 20 карт (10 пар). Клиент присылает порядок кликов, сервер сам
// «переворачивает» карты: совпадение считается по индексу рисунка, а не по тому,
// что игрок написал в ответе.

export const MEMORY_PAIRS = 10;
/** Ниже этого числа ходов не оценить: 10 пар в лучшем случае — 10 ходов. */
export const MEMORY_BEST_TURNS = 12;
export const MEMORY_MAX_TURNS = 24;

export function makeMemoryDeck(seed: number, pairs = MEMORY_PAIRS): number[] {
  const rand = rng(seedOf(seed, 3));
  const deck: number[] = [];
  for (let i = 0; i < pairs; i += 1) deck.push(i, i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  return deck;
}

export function evaluateMemory(seed: number, moves: unknown): ArcadeOutcome {
  const list = intList(moves, 0, MEMORY_PAIRS * 2 - 1, 200);
  if (!list) return fail('bad_trace');
  const deck = makeMemoryDeck(seed);
  const solved = new Array<boolean>(deck.length).fill(false);
  let pending = -1;
  let turns = 0;
  let matched = 0;
  for (const raw of list) {
    const i = raw;
    if (solved[i] || i === pending) return fail('bad_trace');
    if (pending < 0) {
      pending = i;
      continue;
    }
    turns += 1;
    if (deck[pending] === deck[i]) {
      solved[pending] = true;
      solved[i] = true;
      matched += 1;
    }
    pending = -1;
    if (matched === MEMORY_PAIRS) break;
  }
  // Раскрыть хотя бы одну пару — уже забег; ноль совпадений означает, что
  // игрок поле не собирал, и попытка сгорает.
  if (matched === 0) return fail('short');
  const speed = Math.max(0, MEMORY_MAX_TURNS - turns) * 8;
  return outcome((matched * 400) / MEMORY_PAIRS + speed, { turns, matched, pairs: MEMORY_PAIRS });
}

// ── 4. Сигнальная цепь (Simon) ───────────────────────────────────────────────
// Уровень N требует повторить 3 + N сигналов. Клиент присылает всю свою
// последовательность нажатий; засчитывается только префикс, совпавший с эталоном.

export const SEQ_COLORS = 4;
export const SEQ_START = 3;
export const SEQ_LEVELS = 12;

export function makeSequence(seed: number): number[] {
  const rand = rng(seedOf(seed, 4));
  const out: number[] = [];
  for (let i = 0; i < SEQ_START + SEQ_LEVELS; i += 1) out.push(Math.floor(rand() * SEQ_COLORS));
  return out;
}

export function evaluateSequence(seed: number, presses: unknown): ArcadeOutcome {
  const list = intList(presses, 0, SEQ_COLORS - 1, 400);
  if (!list) return fail('bad_trace');
  const want = makeSequence(seed);
  let correct = 0;
  while (correct < list.length && correct < want.length && list[correct] === want[correct]) correct += 1;
  // Один сигнал — минимум 3 совпадения (стартовый набор). Меньше — игрок не
  // дожил и до первого уровня: это «short», попытка сгорает без очков.
  if (correct < SEQ_START) return fail('short');
  const level = correct - SEQ_START;
  return outcome(correct * 40, { correct, level });
}

// ── 5. Импульс (реакция) ────────────────────────────────────────────────────
// Восемь окон по 260 мс. Чтобы нельзя было выиграть «стрельбой по клавише»,
// сервер требует: тапы не чаще, чем раз в 150 мс, и их не больше числа окон + 2.

export const REACT_TARGETS = 8;
export const REACT_WINDOW = 260;
export const REACT_GAP = 150;

export interface ReactionTarget {
  at: number;
  window: number;
}

export function makeReactionTargets(seed: number): ReactionTarget[] {
  const rand = rng(seedOf(seed, 5));
  const out: ReactionTarget[] = [];
  let t = 900;
  for (let i = 0; i < REACT_TARGETS; i += 1) {
    out.push({ at: Math.round(t), window: REACT_WINDOW });
    t += 1100 + rand() * 900;
  }
  return out;
}

export function reactionDuration(targets: ReactionTarget[]): number {
  const last = targets[targets.length - 1];
  return last ? last.at + last.window + 600 : 1000;
}

export function evaluateReaction(seed: number, taps: unknown): ArcadeOutcome {
  const list = intList(taps, 0, 60_000, REACT_TARGETS + 2);
  if (!list) return fail('bad_trace');
  const sorted = list.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] < REACT_GAP) return fail('too_fast');
  }
  const targets = makeReactionTargets(seed);
  const used = new Array<boolean>(sorted.length).fill(false);
  let hits = 0;
  let latency = 0;
  let misses = 0;
  for (const target of targets) {
    let best = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < sorted.length; i += 1) {
      if (used[i]) continue;
      const delta = sorted[i] - target.at;
      if (delta < 0 || delta > target.window) continue;
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        best = i;
      }
    }
    if (best < 0) {
      misses += 1;
      continue;
    }
    used[best] = true;
    hits += 1;
    latency += Math.abs(bestDelta);
  }
  if (hits === 0) return fail('short');
  const avg = Math.round(latency / hits);
  // 60 очков за попадание, до 20 сверху — за то, насколько рано игрок нажал,
  // и −30 за пропущенное окно. «Просто кликать всё время» так не работает:
  // тапы вне окон считаются промахами.
  const speed = Math.max(0, 1 - avg / REACT_WINDOW) * 20;
  return outcome(hits * 60 + hits * speed - misses * 30, { hits, misses, avg_ms: avg });
}

// ── Общий транспорт для экшн-игр: трасса ────────────────────────────────────
//
// Формат тот же, что придуман для арены: клиент шлёт ряд целых (координата ×10)
// по ровной сетке шага. Время восстанавливается по шагу, поэтому «я простоял
// 40 секунд» и «я прошёл 40 секунд» — разные трассы, а телепорт физически
// невозможен: скорость зажимается в предел.

export interface TracePoint {
  t: number;
  v: number;
}

export function samplesFor(runMs: number, stepMs = SAMPLE_MS): number {
  return Math.floor(runMs / stepMs) + 1;
}

export function readAxis(values: unknown, stepMs: unknown, span: number, maxSpeed: number): TracePoint[] | null {
  if (!Array.isArray(values) || values.length < 4 || values.length > INPUT_MAX) return null;
  const step = Math.min(200, Math.max(20, Math.floor(Number(stepMs) || SAMPLE_MS)));
  const raw = (values as unknown[]).map((v) => Number(v) / 10);
  if (raw.some((v) => !Number.isFinite(v))) return null;
  const pts: TracePoint[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const want = Math.min(span, Math.max(0, raw[i]));
    if (!pts.length) {
      pts.push({ t: 0, v: want });
      continue;
    }
    const prev = pts[pts.length - 1];
    const allowed = (maxSpeed * (i * step - prev.t)) / 1000;
    const dx = want - prev.v;
    pts.push({ t: i * step, v: Math.abs(dx) > allowed ? prev.v + Math.sign(dx) * allowed : want });
  }
  return pts;
}

/** Позиция на трассе в момент t: линейная интерполяция, хвост — «стоит». */
export function traceAt(points: TracePoint[], t: number): number {
  if (!points.length) return 0;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      return a.v + (b.v - a.v) * ((t - a.t) / span);
    }
  }
  return points[points.length - 1].v;
}

export function traceEnd(points: TracePoint[]): number {
  return points.length ? points[points.length - 1].t : 0;
}

/** Трасса должна доживать до конца раунда: иначе забег не доигран. */
function covers(points: TracePoint[], runMs: number): boolean {
  return traceEnd(points) >= runMs - Math.max(1500, SAMPLE_MS * 6);
}

// ── 6. Обход пояса (раннер) ─────────────────────────────────────────────────
// Игрок стоит на месте, мир бежит: у препятствия есть момент, когда оно на
// линии игрока. Валуны требуют прыжка, дроны — наоборот, не отрываться от земли,
// груз висит в воздухе. Физика прыжка одна на сервере и в браузере.

export const RUNNER_MS = 30_000;
export const RUNNER_SPEED = 520;
export const RUNNER_G = 2400;
export const RUNNER_JUMP_V = 900;
/** Полная высота прыжка: v²/(2g) ≈ 169 px. Выше — уже читерство. */
export const RUNNER_MAX_Y = Math.round((RUNNER_JUMP_V * RUNNER_JUMP_V) / (2 * RUNNER_G)) + 6;

export interface RunnerEvent {
  /** Момент, когда объект на линии игрока. */
  t: number;
  kind: 'rock' | 'drone' | 'gem';
  w: number;
  y: number;
}

export interface RunnerTrack {
  seed: number;
  runMs: number;
  events: RunnerEvent[];
}

export function makeRunnerTrack(seed: number): RunnerTrack {
  const rand = rng(seedOf(seed, 6));
  const events: RunnerEvent[] = [];
  let t = 2600;
  let rock = 0;
  let drone = 0;
  let gem = 0;
  while (t < RUNNER_MS - 900) {
    const roll = rand();
    if (roll < 0.42 && rock < 10) {
      rock += 1;
      events.push({ t: Math.round(t), kind: 'rock', w: 44, y: 60 });
    } else if (roll < 0.7 && drone < 6) {
      drone += 1;
      events.push({ t: Math.round(t), kind: 'drone', w: 52, y: 150 });
    } else if (gem < 6) {
      gem += 1;
      events.push({ t: Math.round(t), kind: 'gem', w: 40, y: 112 });
    } else {
      events.push({ t: Math.round(t), kind: 'rock', w: 44, y: 60 });
      rock += 1;
    }
    t += 1050 + rand() * 700;
  }
  events.sort((a, b) => a.t - b.t);
  return { seed, runMs: RUNNER_MS, events };
}

/** Позиция по трассе в вёрстах «высота над землёй» с физикой прыжка. */
export function evaluateRunner(seed: number, axis: unknown, stepMs: unknown): ArcadeOutcome {
  const track = makeRunnerTrack(seed);
  const points = readAxis(axis, stepMs, RUNNER_MAX_Y, RUNNER_JUMP_V * 1.05);
  if (!points) return fail('bad_trace');
  if (!covers(points, track.runMs)) return fail('short');
  let passed = 0;
  let gems = 0;
  let crashes = 0;
  for (const e of track.events) {
    // Сколько миллисекунд объект «на линии игрока»: ширина объекта плюс ширина
    // корабля, делённая на скорость прокрутки.
    const half = ((e.w / 2 + 22) / RUNNER_SPEED) * 1000;
    const from = Math.max(0, e.t - half);
    const to = e.t + half;
    if (e.kind === 'gem') {
      // Груз берётся в любой момент окна: за это игрок и любит прыжки с места.
      let got = false;
      for (let s = from; s <= to; s += SAMPLE_MS) {
        if (Math.abs(traceAt(points, s) - e.y) < 48) { got = true; break; }
      }
      if (got) gems += 1;
      continue;
    }
    let hit = false;
    for (let s = from; s <= to; s += SAMPLE_MS) {
      const y = traceAt(points, s);
      // Валуны сидят на земле (нужен прыжок), дроны висят над ней (нужно не
      // прыгать). Отсюда настоящий выбор, а не «держи кнопку».
      if (e.kind === 'rock' ? y < e.y - 6 : y > 88 && y < 210) { hit = true; break; }
    }
    if (hit) crashes += 1;
    else passed += 1;
  }
  return outcome(passed * 28 + gems * 26 - crashes * 80, {
    passed, gems, crashes, events: track.events.length,
  });
}

// ── 7. Разбор щита (арканоид) ────────────────────────────────────────────────
// Симуляция с фиксированным шагом 20 мс: и клиент, и сервер крутят одну и ту же
// `stepBreakout`, поэтому отскоки не «расходятся». Платформа задаёт угол заряда,
// значит управление реально влияет на разбор щита.

export const BRICK_COLS = 10;
// Четыре ряда — это 40 кирпичей: за 60 секунд реально разобрать половину, а
// весь щит остаётся задачей для терпеливых.
export const BRICK_ROWS = 4;
export const BRICK_W = (FIELD_W - 40) / BRICK_COLS;
export const BRICK_H = 36;
export const BRICK_TOP = 90;
export const PADDLE_Y = 560;
export const PADDLE_HALF = 62;
export const BALL_R = 9;
export const BALL_SPEED = 460;
export const BREAKOUT_STEP = 20;
export const BREAKOUT_MS = 60_000;
export const BREAKOUT_LIVES = 3;
export const BREAKOUT_BRICKS = BRICK_COLS * BRICK_ROWS;

export interface BreakoutState {
  t: number;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  /** 1 — кирпич на месте, 0 — разобран. Индекс = row * BRICK_COLS + col. */
  bricks: number[];
  destroyed: number;
  lives: number;
  lost: number;
  over: boolean;
}

export function makeBreakoutState(seed: number): BreakoutState {
  const rand = rng(seedOf(seed, 7));
  const bricks = new Array<number>(BREAKOUT_BRICKS).fill(1);
  // Направление — из зерна, а модуль скорости всегда BALL_SPEED: иначе «быстрый
  // старт» давал бы больше очков за тот же время.
  const angle = -0.62 + rand() * 1.24;
  const dx = Math.cos(angle);
  const dy = -Math.abs(Math.sin(angle)) - 0.35;
  const len = Math.hypot(dx, dy) || 1;
  return {
    t: 0,
    bx: 500 + Math.round((rand() - 0.5) * 60),
    by: PADDLE_Y - 60,
    vx: (dx / len) * BALL_SPEED,
    vy: (dy / len) * BALL_SPEED,
    bricks,
    destroyed: 0,
    lives: BREAKOUT_LIVES,
    lost: 0,
    over: false,
  };
}

function brickIndex(x: number, y: number): number {
  if (y < BRICK_TOP || y > BRICK_TOP + BRICK_ROWS * BRICK_H) return -1;
  const col = Math.floor((x - 20) / BRICK_W);
  const row = Math.floor((y - BRICK_TOP) / BRICK_H);
  if (col < 0 || col >= BRICK_COLS || row < 0 || row >= BRICK_ROWS) return -1;
  return row * BRICK_COLS + col;
}

/** Шаг на dt мс. Меняет состояние на месте: так дешевле и клиенту, и серверу. */
export function stepBreakout(s: BreakoutState, dtMs: number, paddleX: number): BreakoutState {
  if (s.over) return s;
  const k = dtMs / 1000;
  s.t += dtMs;
  s.bx += s.vx * k;
  s.by += s.vy * k;
  if (s.bx < BALL_R + 20) {
    s.bx = BALL_R + 20;
    s.vx = Math.abs(s.vx);
  }
  if (s.bx > FIELD_W - BALL_R - 20) {
    s.bx = FIELD_W - BALL_R - 20;
    s.vx = -Math.abs(s.vx);
  }
  if (s.by < BALL_R + 20) {
    s.by = BALL_R + 20;
    s.vy = Math.abs(s.vy);
  }
  // Кирпичи: проверка по центру заряда и по трём соседям, чтобы не «проскакивать».
  const idx = brickIndex(s.bx, s.by - BALL_R);
  if (idx >= 0 && s.bricks[idx]) {
    const col = idx % BRICK_COLS;
    const row = (idx - col) / BRICK_COLS;
    const left = 20 + col * BRICK_W;
    const top = BRICK_TOP + row * BRICK_H;
    const dx = Math.min(s.bx - left + BALL_R, left + BRICK_W - s.bx + BALL_R);
    const dy = Math.min(Math.abs(s.by - top), Math.abs(s.by - (top + BRICK_H)));
    s.bricks[idx] = 0;
    s.destroyed += 1;
    if (dy < dx) s.vy = s.by < top ? -Math.abs(s.vy) : Math.abs(s.vy);
    else s.vx = s.bx < left + BRICK_W / 2 ? -Math.abs(s.vx) : Math.abs(s.vx);
  }
  // Платформа. Угол отскока зависит от того, куда попал заряд: без этого щит
  // разбивался бы сам, а управление было бы декорацией.
  if (s.vy > 0 && s.by + BALL_R >= PADDLE_Y && s.by + BALL_R <= PADDLE_Y + 22) {
    const off = (s.bx - paddleX) / PADDLE_HALF;
    if (Math.abs(off) <= 1.05) {
      s.by = PADDLE_Y - BALL_R;
      const k = Math.max(-0.72, Math.min(0.72, off * 0.6));
      const vx = BALL_SPEED * k;
      s.vx = vx;
      s.vy = -Math.sqrt(BALL_SPEED * BALL_SPEED - vx * vx);
    }
  }
  if (s.by - BALL_R > FIELD_H) {
    s.lives -= 1;
    s.lost += 1;
    if (s.lives <= 0) {
      s.lives = 0;
      s.over = true;
      return s;
    }
    s.bx = paddleX;
    s.by = PADDLE_Y - 60;
    s.vx = 120;
    s.vy = -Math.sqrt(BALL_SPEED * BALL_SPEED - 120 * 120);
  }
  if (s.destroyed >= BREAKOUT_BRICKS) s.over = true;
  return s;
}

export function replayBreakout(seed: number, axis: unknown, stepMs: unknown, runMs = BREAKOUT_MS): ArcadeOutcome {
  const points = readAxis(axis, stepMs, FIELD_W, 1100);
  if (!points) return fail('bad_trace');
  if (!covers(points, runMs)) return fail('short');
  const s = makeBreakoutState(seed);
  const total = Math.floor(runMs / BREAKOUT_STEP);
  for (let i = 0; i < total; i += 1) {
    stepBreakout(s, BREAKOUT_STEP, traceAt(points, i * BREAKOUT_STEP));
    if (s.over) break;
  }
  return outcome(s.destroyed * 15 - s.lost * 40, {
    destroyed: s.destroyed, bricks: BREAKOUT_BRICKS, lost: s.lost,
  });
}

// ── 8. Сборка зонда (змейка) ────────────────────────────────────────────────
// Поле 24×15, шаг 150 мс, еда появляется из того же зерна на свободных клетках.
// Клиент присылает направление на каждом шаге (можно повторять предыдущее),
// разворот на 180° игнорируется — так трасса остаётся легальной даже после
// случайного двойного нажатия.

export const SNAKE_COLS = 24;
export const SNAKE_ROWS = 15;
export const SNAKE_CELL = 40;
export const SNAKE_STEP = 150;
export const SNAKE_MS = 60_000;
export const SNAKE_START_LEN = 4;

export interface SnakeState {
  step: number;
  /** Индексы клеток: 0 — голова. */
  body: number[];
  dir: number;
  food: number;
  eaten: number;
  dead: boolean;
}

const cellXY = (i: number): [number, number] => [i % SNAKE_COLS, Math.floor(i / SNAKE_COLS)];
const cellAt = (x: number, y: number): number => y * SNAKE_COLS + x;

export function makeSnakeState(seed: number): SnakeState {
  const body: number[] = [];
  for (let i = 0; i < SNAKE_START_LEN; i += 1) body.push(cellAt(SNAKE_START_LEN - 1 - i, 7));
  const s: SnakeState = { step: 0, body, dir: 1, food: -1, eaten: 0, dead: false };
  s.food = spawnSnakeFood(seed, s);
  return s;
}

/** Корм из детерминированного списка свободных клеток. */
export function spawnSnakeFood(seed: number, s: SnakeState): number {
  const free: number[] = [];
  for (let i = 0; i < SNAKE_COLS * SNAKE_ROWS; i += 1) {
    if (!s.body.includes(i)) free.push(i);
  }
  if (!free.length) return -1;
  const rand = rng(seedOf(seed, 8 + s.eaten * 7));
  return free[Math.floor(rand() * free.length)];
}

/** Один шаг змейки. dir: 0 вверх, 1 вправо, 2 вниз, 3 влево. */
export function stepSnake(s: SnakeState, dir: number, seed: number): SnakeState {
  if (s.dead) return s;
  const want = Math.min(3, Math.max(0, Math.floor(Number(dir) || 0)));
  // Разворот запрещён: это не ошибка игрока, а шум ввода.
  if (want !== MOVE_OPP[s.dir]) s.dir = want;
  const [hx, hy] = cellXY(s.body[0]);
  const nx = hx + MOVE_DX[s.dir];
  const ny = hy + MOVE_DY[s.dir];
  s.step += 1;
  if (nx < 0 || ny < 0 || nx >= SNAKE_COLS || ny >= SNAKE_ROWS) {
    s.dead = true;
    return s;
  }
  const next = cellAt(nx, ny);
  const grows = next === s.food;
  // Хвост уходит с последней клетки, поэтому в неё врезаться можно.
  const occupied = grows ? s.body : s.body.slice(0, -1);
  if (occupied.includes(next)) {
    s.dead = true;
    return s;
  }
  s.body.unshift(next);
  if (grows) {
    s.eaten += 1;
    s.food = spawnSnakeFood(seed, s);
  } else {
    s.body.pop();
  }
  return s;
}

export function replaySnake(seed: number, dirs: unknown, runMs = SNAKE_MS): ArcadeOutcome {
  if (!Array.isArray(dirs) || dirs.length < 4 || dirs.length > INPUT_MAX) return fail('bad_trace');
  const list: number[] = [];
  for (const value of dirs as unknown[]) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fail('bad_trace');
    list.push(Math.min(3, Math.max(0, Math.round(n))));
  }
  const need = Math.floor(runMs / SNAKE_STEP);
  if (list.length < need - 12) return fail('short');
  const s = makeSnakeState(seed);
  for (let i = 0; i < Math.min(list.length, need); i += 1) {
    stepSnake(s, list[i], seed);
    if (s.dead) break;
  }
  return outcome(s.eaten * 30, { eaten: s.eaten, length: s.body.length, steps: s.step });
}

// ── 9. Снайперский полигон ───────────────────────────────────────────────────
// Цели вспыхивают на 900 мс. Стрельба «наугад» не работает: тапы обязаны быть
// не чаще раза в 120 мс и их не больше, чем целей + 4, а промах снимает очки.

export const AIM_MS = 25_000;
export const AIM_TARGETS = 14;
export const AIM_TTL = 900;
export const AIM_GAP = 120;
export const AIM_MIN_DIST = 32;
export const AIM_MAX_DIST = 58;

export interface AimTarget {
  t: number;
  x: number;
  y: number;
  r: number;
}

export function makeAimTargets(seed: number): AimTarget[] {
  const rand = rng(seedOf(seed, 9));
  const out: AimTarget[] = [];
  let t = 700;
  for (let i = 0; i < AIM_TARGETS; i += 1) {
    out.push({
      t: Math.round(t),
      x: Math.round(120 + rand() * (FIELD_W - 240)),
      y: Math.round(90 + rand() * (FIELD_H - 200)),
      r: Math.round(AIM_MIN_DIST + rand() * (AIM_MAX_DIST - AIM_MIN_DIST)),
    });
    t += (AIM_MS - 1600) / AIM_TARGETS * (0.7 + rand() * 0.6);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export interface AimShot {
  t: number;
  x: number;
  y: number;
}

export function readShots(raw: unknown, cap: number): AimShot[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > cap) return null;
  const out: AimShot[] = [];
  for (const item of raw as unknown[]) {
    const o = item as { t?: unknown; x?: unknown; y?: unknown };
    const t = Number(o?.t);
    const x = Number(o?.x);
    const y = Number(o?.y);
    if (![t, x, y].every(Number.isFinite)) return null;
    out.push({ t: Math.round(t), x: Math.round(Math.min(FIELD_W, Math.max(0, x))), y: Math.round(Math.min(FIELD_H, Math.max(0, y))) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function evaluateAim(seed: number, shots: unknown): ArcadeOutcome {
  const list = readShots(shots, AIM_TARGETS + 4);
  if (!list) return fail('bad_trace');
  for (let i = 1; i < list.length; i += 1) {
    if (list[i].t - list[i - 1].t < AIM_GAP) return fail('too_fast');
  }
  const targets = makeAimTargets(seed);
  const used = new Array<boolean>(list.length).fill(false);
  let hits = 0;
  for (const target of targets) {
    for (let i = 0; i < list.length; i += 1) {
      if (used[i]) continue;
      const s = list[i];
      if (s.t < target.t || s.t > target.t + AIM_TTL) continue;
      if (Math.hypot(s.x - target.x, s.y - target.y) > target.r + 10) continue;
      used[i] = true;
      hits += 1;
      break;
    }
  }
  const fired = list.length;
  const misses = fired - hits;
  if (hits === 0) return fail('short');
  return outcome(hits * 45 - misses * 20, { hits, misses, fired, targets: AIM_TARGETS });
}

// ── 10. Грузовая сеть (ловушка) ──────────────────────────────────────────────
// Груз падает на линию захвата; крюк обязан успеть приехать. Обломки на той же
// линии — штраф. Поле строится из зерна, поэтому «просто стоять в центре» не
// даёт 600 очков: поток разбросан по всей ширине.

export const CATCH_MS = 45_000;
export const CATCH_LINE_Y = 520;
export const CATCH_HALF = 34;
export const CATCH_MAX_SPEED = 900;

export interface CatchItem {
  t: number;
  x: number;
  r: number;
  kind: 'cargo' | 'debris';
}

export interface CatchField {
  seed: number;
  runMs: number;
  items: CatchItem[];
}

export function makeCatchField(seed: number): CatchField {
  const rand = rng(seedOf(seed, 10));
  const items: CatchItem[] = [];
  let t = 1200;
  let cargo = 0;
  let debris = 0;
  while (t < CATCH_MS - 700) {
    const isCargo = !(rand() < 0.32 && debris < 10) || cargo >= 24;
    if (isCargo && cargo < 24) {
      cargo += 1;
      items.push({ t: Math.round(t), x: Math.round(70 + rand() * (FIELD_W - 140)), r: 26, kind: 'cargo' });
    } else if (debris < 10) {
      debris += 1;
      items.push({ t: Math.round(t), x: Math.round(70 + rand() * (FIELD_W - 140)), r: 34, kind: 'debris' });
    }
    t += 900 + rand() * 620;
  }
  items.sort((a, b) => a.t - b.t);
  return { seed, runMs: CATCH_MS, items };
}

export function evaluateCatch(seed: number, axis: unknown, stepMs: unknown): ArcadeOutcome {
  const points = readAxis(axis, stepMs, FIELD_W, CATCH_MAX_SPEED);
  if (!points) return fail('bad_trace');
  const field = makeCatchField(seed);
  if (!covers(points, field.runMs)) return fail('short');
  let picked = 0;
  let hits = 0;
  let missed = 0;
  for (const item of field.items) {
    const x = traceAt(points, item.t);
    const near = Math.abs(x - item.x);
    if (item.kind === 'cargo') {
      if (near < item.r + CATCH_HALF) picked += 1;
      else missed += 1;
    } else if (near < item.r + CATCH_HALF - 8) hits += 1;
  }
  return outcome(picked * 26 - hits * 60, { picked, hits, missed, cargo: 24 });
}

// ── Диспетчер ───────────────────────────────────────────────────────────────

/**
 * Что клиент имеет право прислать по игре. Лишние поля игнорируются: один
 * маршрут обслуживает десять игр, и раздувать контракт десятью схемами незачем.
 *   moves   — лабиринт, пары;
 *   answers — судоку;
 *   presses — сигнальная цепь;
 *   taps    — реакция;
 *   axis    — раннер, арканоид, ловушка (позиция ×10 по сетке stepMs);
 *   dirs    — змейка (направление на каждом шаге);
 *   shots   — снайпер ({t,x,y}).
 */
export interface ArcadeInput {
  moves?: unknown;
  answers?: unknown;
  presses?: unknown;
  taps?: unknown;
  axis?: unknown;
  stepMs?: unknown;
  dirs?: unknown;
  shots?: unknown;
}

/** Сколько длится раунд: мир по этому числу ставит дедлайн забега. */
export function arcadeRunMs(id: ArcadeId): number {
  switch (id) {
    case 'maze': return 180_000;
    case 'sudoku': return 600_000;
    case 'memory': return 240_000;
    case 'sequence': return 180_000;
    case 'reaction': return 20_000;
    case 'runner': return RUNNER_MS;
    case 'breakout': return BREAKOUT_MS;
    case 'snake': return SNAKE_MS;
    case 'aim': return AIM_MS;
    case 'catch': return CATCH_MS;
  }
}

/** Главный вход: и для сервера (награда), и для браузера (живой подсчёт). */
export function evaluateArcade(id: ArcadeId, seed: number, input: ArcadeInput): ArcadeOutcome {
  switch (id) {
    case 'maze': return evaluateMaze(seed, input.moves);
    case 'sudoku': return evaluateSudoku(seed, input.answers);
    case 'memory': return evaluateMemory(seed, input.moves);
    case 'sequence': return evaluateSequence(seed, input.presses);
    case 'reaction': return evaluateReaction(seed, input.taps);
    case 'runner': return evaluateRunner(seed, input.axis, input.stepMs);
    case 'breakout': return replayBreakout(seed, input.axis, input.stepMs);
    case 'snake': return replaySnake(seed, input.dirs);
    case 'aim': return evaluateAim(seed, input.shots);
    case 'catch': return evaluateCatch(seed, input.axis, input.stepMs);
    default:
      // Сюда не должен попасть ни один вызов: id приходит из CHECK в таблице.
      // Но `undefined` в награду превратился бы в NaN в SQL, поэтому лучше отказ.
      return fail('bad_trace');
  }
}

/** Базовый опыт за засчитанный забег и надбавка за победу. */
export const XP_ARCADE_RUN = 3;
export const XP_ARCADE_WIN = 6;

/**
 * Сколько опыта даёт забег. Намеренно только опыт: ASTRA, очки и ресурсы аркада
 * не трогает — экономика игры остаётся задачей рейсов, крафта и маркета.
 * 600 очков — это шесть «сотен», то есть максимум 21 XP за забег и +6 за победу.
 */
export function arcadeXp(score: number, win: boolean): number {
  const level = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
  return XP_ARCADE_RUN + Math.floor(level / 100) * 3 + (win ? XP_ARCADE_WIN : 0);
}

/**
 * Ступени побед: медаль выдаётся один раз на игрока и не входит в суточный
 * потолок. Награда — опыт: ASTRA аркада не раздаёт вовсе, чтобы десять игр не
 * стали ещё одним способом печатать валюту в обход рейсов и маркета.
 */
export const ARCADE_TIERS: { wins: number; xp: number; medal: string; title: string }[] = [
  { wins: 10, xp: 60, medal: 'arcade_bronze', title: 'Кандидат в пилоты' },
  { wins: 30, xp: 150, medal: 'arcade_silver', title: 'Мастер аркады' },
  { wins: 75, xp: 300, medal: 'arcade_gold', title: 'Легенда десяти игр' },
];

/** Медаль «десять игр»: по одной победе в каждой игре каталога. */
export const ARCADE_ALL_TEN_MEDAL = 'arcade_all_ten';
export const ARCADE_ALL_TEN_XP = 200;
