// Сгенерировано scripts/build-arcade.mjs из worker/src/shared/arcade.ts.
// Руками не править: сервер и браузер должны считать одинаково.
export const FIELD_W = 1000;
export const FIELD_H = 620;
export const SAMPLE_MS = 40;
export const MAX_SCORE = 600;
export const WIN_SCORE = 300;
export const INPUT_MAX = 2000;
export const ARCADE_GAMES = [
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
export const ARCADE_IDS = ARCADE_GAMES.map((g) => g.id);
export function arcadeMeta(id) {
    const want = String(id);
    return ARCADE_GAMES.find((g) => g.id === want) ?? null;
}
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seedOf(seed, salt) {
    const next = rng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
    return Math.floor(next() * 0xffffffff) >>> 0;
}
function outcome(score, detail, error) {
    const s = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
    return { ok: true, score: s, win: s >= WIN_SCORE, detail };
}
function fail(error) {
    return { ok: false, error, score: 0, win: false, detail: {} };
}
function intList(raw, min, max, cap) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > cap)
        return null;
    const out = [];
    for (const value of raw) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max)
            return null;
        out.push(n);
    }
    return out;
}
export const MAZE_COLS = 13;
export const MAZE_ROWS = 9;
const WALL = [1, 2, 4, 8];
const MOVE_DX = [0, 1, 0, -1];
const MOVE_DY = [-1, 0, 1, 0];
const MOVE_OPP = [2, 3, 0, 1];
export function makeMaze(seed, cols = MAZE_COLS, rows = MAZE_ROWS) {
    const rand = rng(seedOf(seed, 1));
    const mask = new Array(cols * rows).fill(15);
    const seen = new Array(cols * rows).fill(false);
    const stack = [0];
    seen[0] = true;
    while (stack.length) {
        const cur = stack[stack.length - 1];
        const cx = cur % cols;
        const cy = (cur - cx) / cols;
        const nexts = [];
        for (let d = 0; d < 4; d += 1) {
            const nx = cx + MOVE_DX[d];
            const ny = cy + MOVE_DY[d];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows)
                continue;
            if (seen[ny * cols + nx])
                continue;
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
export function solveMaze(g) {
    const start = 0;
    const goal = g.cols * g.rows - 1;
    const prev = new Array(g.cols * g.rows).fill(-1);
    const seen = new Array(g.cols * g.rows).fill(false);
    const queue = [start];
    seen[start] = true;
    for (let head = 0; head < queue.length; head += 1) {
        const cur = queue[head];
        if (cur === goal)
            break;
        const cx = cur % g.cols;
        const cy = (cur - cx) / g.cols;
        for (let d = 0; d < 4; d += 1) {
            if (g.mask[cur] & WALL[d])
                continue;
            const nx = cx + MOVE_DX[d];
            const ny = cy + MOVE_DY[d];
            if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows)
                continue;
            const nxt = ny * g.cols + nx;
            if (seen[nxt])
                continue;
            seen[nxt] = true;
            prev[nxt] = cur;
            queue.push(nxt);
        }
    }
    if (!seen[goal])
        return { steps: -1, path: [] };
    const path = [];
    for (let cur = goal; cur !== -1; cur = prev[cur])
        path.unshift(cur);
    return { steps: path.length - 1, path };
}
export function evaluateMaze(seed, moves) {
    const list = intList(moves, 0, 3, 400);
    if (!list)
        return fail('bad_trace');
    const g = makeMaze(seed);
    const ref = solveMaze(g);
    if (ref.steps < 0)
        return fail('bad_trace');
    let cur = 0;
    let x = 0;
    let y = 0;
    for (const d of list) {
        if (g.mask[cur] & WALL[d])
            return fail('bad_trace');
        x += MOVE_DX[d];
        y += MOVE_DY[d];
        cur = y * g.cols + x;
        if (cur === ref.path[ref.path.length - 1])
            break;
    }
    const last = ref.path[ref.path.length - 1];
    if (cur !== last)
        return fail('short');
    if (list.length < ref.steps)
        return fail('bad_trace');
    const extra = list.length - ref.steps;
    return outcome((ref.steps / (ref.steps + extra)) * MAX_SCORE, {
        steps: list.length, shortest: ref.steps, extra,
    });
}
function sudokuOk(board, i, v) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (let k = 0; k < 9; k += 1) {
        if (board[r * 9 + k] === v)
            return false;
        if (board[k * 9 + c] === v)
            return false;
    }
    const br = r - (r % 3);
    const bc = c - (c % 3);
    for (let dr = 0; dr < 3; dr += 1) {
        for (let dc = 0; dc < 3; dc += 1) {
            if (board[(br + dr) * 9 + bc + dc] === v)
                return false;
        }
    }
    return true;
}
function sudokuFill(board, pos, rand) {
    while (pos < 81 && board[pos] !== 0)
        pos += 1;
    if (pos >= 81)
        return true;
    const order = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
    }
    for (const v of order) {
        if (!sudokuOk(board, pos, v))
            continue;
        board[pos] = v;
        if (sudokuFill(board, pos + 1, rand))
            return true;
        board[pos] = 0;
    }
    return false;
}
function sudokuCount(board, limit, budget) {
    if (budget.n <= 0)
        return limit;
    let empty = -1;
    for (let i = 0; i < 81; i += 1) {
        if (board[i] === 0) {
            empty = i;
            break;
        }
    }
    if (empty < 0)
        return 1;
    let total = 0;
    for (let v = 1; v <= 9; v += 1) {
        if (budget.n <= 0)
            break;
        if (!sudokuOk(board, empty, v))
            continue;
        budget.n -= 1;
        board[empty] = v;
        total += sudokuCount(board, limit - total, budget);
        board[empty] = 0;
        if (total >= limit)
            break;
    }
    return total;
}
export function makeSudoku(seed) {
    const rand = rng(seedOf(seed, 2));
    const board = new Array(81).fill(0);
    sudokuFill(board, 0, rand);
    const solution = board.slice();
    const order = solution.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
    }
    let empty = 0;
    for (const i of order) {
        if (empty >= 46)
            break;
        const keep = board[i];
        board[i] = 0;
        const n = sudokuCount(board, 2, { n: 4000 });
        if (n === 1)
            empty += 1;
        else
            board[i] = keep;
    }
    return { grid: board, solution };
}
export function evaluateSudoku(seed, answers) {
    const list = intList(answers, 0, 9, 81);
    if (!list)
        return fail('bad_trace');
    const puzzle = makeSudoku(seed);
    if (list.length !== 81)
        return fail('short');
    let givenWrong = 0;
    let correct = 0;
    for (let i = 0; i < 81; i += 1) {
        const given = puzzle.grid[i];
        if (given !== 0) {
            if (list[i] !== 0 && list[i] !== given)
                givenWrong += 1;
            continue;
        }
        if (list[i] === puzzle.solution[i])
            correct += 1;
    }
    if (givenWrong > 0)
        return fail('bad_trace');
    const cells = 81 - puzzle.grid.filter((v) => v !== 0).length;
    return outcome((correct / cells) * MAX_SCORE, { correct, cells });
}
export const MEMORY_PAIRS = 10;
export const MEMORY_BEST_TURNS = 12;
export const MEMORY_MAX_TURNS = 24;
export function makeMemoryDeck(seed, pairs = MEMORY_PAIRS) {
    const rand = rng(seedOf(seed, 3));
    const deck = [];
    for (let i = 0; i < pairs; i += 1)
        deck.push(i, i);
    for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const t = deck[i];
        deck[i] = deck[j];
        deck[j] = t;
    }
    return deck;
}
export function evaluateMemory(seed, moves) {
    const list = intList(moves, 0, MEMORY_PAIRS * 2 - 1, 200);
    if (!list)
        return fail('bad_trace');
    const deck = makeMemoryDeck(seed);
    const solved = new Array(deck.length).fill(false);
    let pending = -1;
    let turns = 0;
    let matched = 0;
    for (const raw of list) {
        const i = raw;
        if (solved[i] || i === pending)
            return fail('bad_trace');
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
        if (matched === MEMORY_PAIRS)
            break;
    }
    if (matched === 0)
        return fail('short');
    const speed = Math.max(0, MEMORY_MAX_TURNS - turns) * 8;
    return outcome((matched * 400) / MEMORY_PAIRS + speed, { turns, matched, pairs: MEMORY_PAIRS });
}
export const SEQ_COLORS = 4;
export const SEQ_START = 3;
export const SEQ_LEVELS = 12;
export function makeSequence(seed) {
    const rand = rng(seedOf(seed, 4));
    const out = [];
    for (let i = 0; i < SEQ_START + SEQ_LEVELS; i += 1)
        out.push(Math.floor(rand() * SEQ_COLORS));
    return out;
}
export function evaluateSequence(seed, presses) {
    const list = intList(presses, 0, SEQ_COLORS - 1, 400);
    if (!list)
        return fail('bad_trace');
    const want = makeSequence(seed);
    let correct = 0;
    while (correct < list.length && correct < want.length && list[correct] === want[correct])
        correct += 1;
    if (correct < SEQ_START)
        return fail('short');
    const level = correct - SEQ_START;
    return outcome(correct * 40, { correct, level });
}
export const REACT_TARGETS = 8;
export const REACT_WINDOW = 260;
export const REACT_GAP = 150;
export function makeReactionTargets(seed) {
    const rand = rng(seedOf(seed, 5));
    const out = [];
    let t = 900;
    for (let i = 0; i < REACT_TARGETS; i += 1) {
        out.push({ at: Math.round(t), window: REACT_WINDOW });
        t += 1100 + rand() * 900;
    }
    return out;
}
export function reactionDuration(targets) {
    const last = targets[targets.length - 1];
    return last ? last.at + last.window + 600 : 1000;
}
export function evaluateReaction(seed, taps) {
    const list = intList(taps, 0, 60_000, REACT_TARGETS + 2);
    if (!list)
        return fail('bad_trace');
    const sorted = list.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i] - sorted[i - 1] < REACT_GAP)
            return fail('too_fast');
    }
    const targets = makeReactionTargets(seed);
    const used = new Array(sorted.length).fill(false);
    let hits = 0;
    let latency = 0;
    let misses = 0;
    for (const target of targets) {
        let best = -1;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (let i = 0; i < sorted.length; i += 1) {
            if (used[i])
                continue;
            const delta = sorted[i] - target.at;
            if (delta < 0 || delta > target.window)
                continue;
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
    if (hits === 0)
        return fail('short');
    const avg = Math.round(latency / hits);
    const speed = Math.max(0, 1 - avg / REACT_WINDOW) * 20;
    return outcome(hits * 60 + hits * speed - misses * 30, { hits, misses, avg_ms: avg });
}
export function samplesFor(runMs, stepMs = SAMPLE_MS) {
    return Math.floor(runMs / stepMs) + 1;
}
export function readAxis(values, stepMs, span, maxSpeed) {
    if (!Array.isArray(values) || values.length < 4 || values.length > INPUT_MAX)
        return null;
    const step = Math.min(200, Math.max(20, Math.floor(Number(stepMs) || SAMPLE_MS)));
    const raw = values.map((v) => Number(v) / 10);
    if (raw.some((v) => !Number.isFinite(v)))
        return null;
    const pts = [];
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
export function traceAt(points, t) {
    if (!points.length)
        return 0;
    if (t <= points[0].t)
        return points[0].v;
    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        if (t <= b.t) {
            const span = b.t - a.t;
            if (span <= 0)
                return b.v;
            return a.v + (b.v - a.v) * ((t - a.t) / span);
        }
    }
    return points[points.length - 1].v;
}
export function traceEnd(points) {
    return points.length ? points[points.length - 1].t : 0;
}
function covers(points, runMs) {
    return traceEnd(points) >= runMs - Math.max(1500, SAMPLE_MS * 6);
}
export const RUNNER_MS = 30_000;
export const RUNNER_SPEED = 520;
export const RUNNER_G = 2400;
export const RUNNER_JUMP_V = 900;
export const RUNNER_MAX_Y = Math.round((RUNNER_JUMP_V * RUNNER_JUMP_V) / (2 * RUNNER_G)) + 6;
export function makeRunnerTrack(seed) {
    const rand = rng(seedOf(seed, 6));
    const events = [];
    let t = 2600;
    let rock = 0;
    let drone = 0;
    let gem = 0;
    while (t < RUNNER_MS - 900) {
        const roll = rand();
        if (roll < 0.42 && rock < 10) {
            rock += 1;
            events.push({ t: Math.round(t), kind: 'rock', w: 44, y: 60 });
        }
        else if (roll < 0.7 && drone < 6) {
            drone += 1;
            events.push({ t: Math.round(t), kind: 'drone', w: 52, y: 150 });
        }
        else if (gem < 6) {
            gem += 1;
            events.push({ t: Math.round(t), kind: 'gem', w: 40, y: 112 });
        }
        else {
            events.push({ t: Math.round(t), kind: 'rock', w: 44, y: 60 });
            rock += 1;
        }
        t += 1050 + rand() * 700;
    }
    events.sort((a, b) => a.t - b.t);
    return { seed, runMs: RUNNER_MS, events };
}
export function evaluateRunner(seed, axis, stepMs) {
    const track = makeRunnerTrack(seed);
    const points = readAxis(axis, stepMs, RUNNER_MAX_Y, RUNNER_JUMP_V * 1.05);
    if (!points)
        return fail('bad_trace');
    if (!covers(points, track.runMs))
        return fail('short');
    let passed = 0;
    let gems = 0;
    let crashes = 0;
    for (const e of track.events) {
        const half = ((e.w / 2 + 22) / RUNNER_SPEED) * 1000;
        const from = Math.max(0, e.t - half);
        const to = e.t + half;
        if (e.kind === 'gem') {
            let got = false;
            for (let s = from; s <= to; s += SAMPLE_MS) {
                if (Math.abs(traceAt(points, s) - e.y) < 48) {
                    got = true;
                    break;
                }
            }
            if (got)
                gems += 1;
            continue;
        }
        let hit = false;
        for (let s = from; s <= to; s += SAMPLE_MS) {
            const y = traceAt(points, s);
            if (e.kind === 'rock' ? y < e.y - 6 : y > 88 && y < 210) {
                hit = true;
                break;
            }
        }
        if (hit)
            crashes += 1;
        else
            passed += 1;
    }
    return outcome(passed * 28 + gems * 26 - crashes * 80, {
        passed, gems, crashes, events: track.events.length,
    });
}
export const BRICK_COLS = 10;
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
export function makeBreakoutState(seed) {
    const rand = rng(seedOf(seed, 7));
    const bricks = new Array(BREAKOUT_BRICKS).fill(1);
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
function brickIndex(x, y) {
    if (y < BRICK_TOP || y > BRICK_TOP + BRICK_ROWS * BRICK_H)
        return -1;
    const col = Math.floor((x - 20) / BRICK_W);
    const row = Math.floor((y - BRICK_TOP) / BRICK_H);
    if (col < 0 || col >= BRICK_COLS || row < 0 || row >= BRICK_ROWS)
        return -1;
    return row * BRICK_COLS + col;
}
export function stepBreakout(s, dtMs, paddleX) {
    if (s.over)
        return s;
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
        if (dy < dx)
            s.vy = s.by < top ? -Math.abs(s.vy) : Math.abs(s.vy);
        else
            s.vx = s.bx < left + BRICK_W / 2 ? -Math.abs(s.vx) : Math.abs(s.vx);
    }
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
    if (s.destroyed >= BREAKOUT_BRICKS)
        s.over = true;
    return s;
}
export function replayBreakout(seed, axis, stepMs, runMs = BREAKOUT_MS) {
    const points = readAxis(axis, stepMs, FIELD_W, 1100);
    if (!points)
        return fail('bad_trace');
    if (!covers(points, runMs))
        return fail('short');
    const s = makeBreakoutState(seed);
    const total = Math.floor(runMs / BREAKOUT_STEP);
    for (let i = 0; i < total; i += 1) {
        stepBreakout(s, BREAKOUT_STEP, traceAt(points, i * BREAKOUT_STEP));
        if (s.over)
            break;
    }
    return outcome(s.destroyed * 15 - s.lost * 40, {
        destroyed: s.destroyed, bricks: BREAKOUT_BRICKS, lost: s.lost,
    });
}
export const SNAKE_COLS = 24;
export const SNAKE_ROWS = 15;
export const SNAKE_CELL = 40;
export const SNAKE_STEP = 150;
export const SNAKE_MS = 60_000;
export const SNAKE_START_LEN = 4;
const cellXY = (i) => [i % SNAKE_COLS, Math.floor(i / SNAKE_COLS)];
const cellAt = (x, y) => y * SNAKE_COLS + x;
export function makeSnakeState(seed) {
    const body = [];
    for (let i = 0; i < SNAKE_START_LEN; i += 1)
        body.push(cellAt(SNAKE_START_LEN - 1 - i, 7));
    const s = { step: 0, body, dir: 1, food: -1, eaten: 0, dead: false };
    s.food = spawnSnakeFood(seed, s);
    return s;
}
export function spawnSnakeFood(seed, s) {
    const free = [];
    for (let i = 0; i < SNAKE_COLS * SNAKE_ROWS; i += 1) {
        if (!s.body.includes(i))
            free.push(i);
    }
    if (!free.length)
        return -1;
    const rand = rng(seedOf(seed, 8 + s.eaten * 7));
    return free[Math.floor(rand() * free.length)];
}
export function stepSnake(s, dir, seed) {
    if (s.dead)
        return s;
    const want = Math.min(3, Math.max(0, Math.floor(Number(dir) || 0)));
    if (want !== MOVE_OPP[s.dir])
        s.dir = want;
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
    const occupied = grows ? s.body : s.body.slice(0, -1);
    if (occupied.includes(next)) {
        s.dead = true;
        return s;
    }
    s.body.unshift(next);
    if (grows) {
        s.eaten += 1;
        s.food = spawnSnakeFood(seed, s);
    }
    else {
        s.body.pop();
    }
    return s;
}
export function replaySnake(seed, dirs, runMs = SNAKE_MS) {
    if (!Array.isArray(dirs) || dirs.length < 4 || dirs.length > INPUT_MAX)
        return fail('bad_trace');
    const list = [];
    for (const value of dirs) {
        const n = Number(value);
        if (!Number.isFinite(n))
            return fail('bad_trace');
        list.push(Math.min(3, Math.max(0, Math.round(n))));
    }
    const need = Math.floor(runMs / SNAKE_STEP);
    if (list.length < need - 12)
        return fail('short');
    const s = makeSnakeState(seed);
    for (let i = 0; i < Math.min(list.length, need); i += 1) {
        stepSnake(s, list[i], seed);
        if (s.dead)
            break;
    }
    return outcome(s.eaten * 30, { eaten: s.eaten, length: s.body.length, steps: s.step });
}
export const AIM_MS = 25_000;
export const AIM_TARGETS = 14;
export const AIM_TTL = 900;
export const AIM_GAP = 120;
export const AIM_MIN_DIST = 32;
export const AIM_MAX_DIST = 58;
export function makeAimTargets(seed) {
    const rand = rng(seedOf(seed, 9));
    const out = [];
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
export function readShots(raw, cap) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > cap)
        return null;
    const out = [];
    for (const item of raw) {
        const o = item;
        const t = Number(o?.t);
        const x = Number(o?.x);
        const y = Number(o?.y);
        if (![t, x, y].every(Number.isFinite))
            return null;
        out.push({ t: Math.round(t), x: Math.round(Math.min(FIELD_W, Math.max(0, x))), y: Math.round(Math.min(FIELD_H, Math.max(0, y))) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
}
export function evaluateAim(seed, shots) {
    const list = readShots(shots, AIM_TARGETS + 4);
    if (!list)
        return fail('bad_trace');
    for (let i = 1; i < list.length; i += 1) {
        if (list[i].t - list[i - 1].t < AIM_GAP)
            return fail('too_fast');
    }
    const targets = makeAimTargets(seed);
    const used = new Array(list.length).fill(false);
    let hits = 0;
    for (const target of targets) {
        for (let i = 0; i < list.length; i += 1) {
            if (used[i])
                continue;
            const s = list[i];
            if (s.t < target.t || s.t > target.t + AIM_TTL)
                continue;
            if (Math.hypot(s.x - target.x, s.y - target.y) > target.r + 10)
                continue;
            used[i] = true;
            hits += 1;
            break;
        }
    }
    const fired = list.length;
    const misses = fired - hits;
    if (hits === 0)
        return fail('short');
    return outcome(hits * 45 - misses * 20, { hits, misses, fired, targets: AIM_TARGETS });
}
export const CATCH_MS = 45_000;
export const CATCH_LINE_Y = 520;
export const CATCH_HALF = 34;
export const CATCH_MAX_SPEED = 900;
export function makeCatchField(seed) {
    const rand = rng(seedOf(seed, 10));
    const items = [];
    let t = 1200;
    let cargo = 0;
    let debris = 0;
    while (t < CATCH_MS - 700) {
        const isCargo = !(rand() < 0.32 && debris < 10) || cargo >= 24;
        if (isCargo && cargo < 24) {
            cargo += 1;
            items.push({ t: Math.round(t), x: Math.round(70 + rand() * (FIELD_W - 140)), r: 26, kind: 'cargo' });
        }
        else if (debris < 10) {
            debris += 1;
            items.push({ t: Math.round(t), x: Math.round(70 + rand() * (FIELD_W - 140)), r: 34, kind: 'debris' });
        }
        t += 900 + rand() * 620;
    }
    items.sort((a, b) => a.t - b.t);
    return { seed, runMs: CATCH_MS, items };
}
export function evaluateCatch(seed, axis, stepMs) {
    const points = readAxis(axis, stepMs, FIELD_W, CATCH_MAX_SPEED);
    if (!points)
        return fail('bad_trace');
    const field = makeCatchField(seed);
    if (!covers(points, field.runMs))
        return fail('short');
    let picked = 0;
    let hits = 0;
    let missed = 0;
    for (const item of field.items) {
        const x = traceAt(points, item.t);
        const near = Math.abs(x - item.x);
        if (item.kind === 'cargo') {
            if (near < item.r + CATCH_HALF)
                picked += 1;
            else
                missed += 1;
        }
        else if (near < item.r + CATCH_HALF - 8)
            hits += 1;
    }
    return outcome(picked * 26 - hits * 60, { picked, hits, missed, cargo: 24 });
}
export function arcadeRunMs(id) {
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
export function evaluateArcade(id, seed, input) {
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
            return fail('bad_trace');
    }
}
export const XP_ARCADE_RUN = 3;
export const XP_ARCADE_WIN = 6;
export function arcadeXp(score, win) {
    const level = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
    return XP_ARCADE_RUN + Math.floor(level / 100) * 3 + (win ? XP_ARCADE_WIN : 0);
}
export const ARCADE_TIERS = [
    { wins: 10, xp: 60, medal: 'arcade_bronze', title: 'Кандидат в пилоты' },
    { wins: 30, xp: 150, medal: 'arcade_silver', title: 'Мастер аркады' },
    { wins: 75, xp: 300, medal: 'arcade_gold', title: 'Легенда десяти игр' },
];
export const ARCADE_ALL_TEN_MEDAL = 'arcade_all_ten';
export const ARCADE_ALL_TEN_XP = 200;
