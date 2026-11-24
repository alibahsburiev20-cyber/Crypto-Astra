// Аркада в настоящем DOM: client/index.html + client/app.js в jsdom.
//
// Зачем, если есть arcadeUi.test.ts со строками: строки доказывают, что код
// написан, но не что экран открывается. Претензия владельца была ровно такой —
// «не могу открыть аркаду»: пункт есть, а экрана нет. Здесь приложение стартует
// целиком, мы кликаем «Аркаду», нажимаем «Играть», проходим лабиринт стрелками и
// смотрим, что появилось в DOM. Считает сервер — поэтому ответы /arcade/start и
// /arcade/finish готовит настоящий общий модуль (evaluateArcade), а не заглушка:
// клиенту нечем «договориться» с тестом.
//
// Данные /me и /arcade — снимок ответов живого воркера (fixtures/arcade-dom.json),
// чтобы расхождение формата ответа сервера тоже было видно.
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import * as sim from '../../../client/arcade-sim.js';
import { ARCADE_GAMES, evaluateArcade, makeMaze, solveMaze } from '../../src/shared/arcade';

const SEED = 20261117;
const ROOT = new URL('../../../client/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, ROOT), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('../fixtures/arcade-dom.json', import.meta.url), 'utf8')) as {
  me: Record<string, unknown>;
  arcade: Record<string, any>;
  arcadeAfter: Record<string, any>;
};

/**
 * jsdom не умеет `import`/`export` внутри eval (приём тот же, что в payPageDom),
 * поэтому модульность снимаем. Динамический import('/arcade-sim.js') меняем на
 * уже импортированный модуль с диска — файл тот же, что грузит браузер.
 */
const asScript = (text: string): string => text
  .replace(/^import[^;]+;$/gm, '')
  .replace(/^export default [A-Za-z0-9_$]+;$/gm, '')
  .replace(/^export /gm, '')
  .replace("import('/arcade-sim.js')", 'Promise.resolve(window.__arcadeSim)');

/** Холст в jsdom без нативного canvas: рисование подменяем «честным словом». */
function fakeContext() {
  const noop = () => {};
  return new Proxy({}, {
    get: (_t, k: string) => {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      return noop;
    },
    set: () => true,
  });
}

interface Call { path: string; body: Record<string, any> | undefined; headers: Record<string, string> }

async function boot(opts: { failArcade?: boolean } = {}) {
  const problems: string[] = [];
  const vc = new VirtualConsole();
  vc.on('error', (m: unknown) => problems.push(`console.error: ${String(m)}`));
  vc.on('jsdomError', (e: unknown) => problems.push(`jsdom: ${String(e)}`));
  const dom = new JSDOM(read('index.html'), {
    url: 'https://play.example/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  const calls: Call[] = [];
  // Спрайты в jsdom не грузятся, а arcadeStartRun ждёт загрузки арта.
  (window as any).Image = class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
  };
  (window.HTMLCanvasElement as any).prototype.getContext = () => fakeContext();
  // Ключи повторения живут в sessionStorage: чистим, чтобы тесты не наследовали
  // состояние друг у друга.
  window.sessionStorage.clear();

  let game = 'maze';
  let entries = 0;
  // Ответ раздела зависит от того, был ли засчитан победный забег: клиент обязан
  // перерисовать счётчики, а не показывать старые нули.
  let won = false;

  const answer = (path: string, body?: Record<string, any>): { status: number; body: unknown } => {
    if (path.startsWith('/health')) return { status: 200, body: { ok: true, now: Date.now() } };
    if (path.startsWith('/config')) return { status: 200, body: { turnstile_site_key: null } };
    if (path.startsWith('/auth/refresh')) return { status: 200, body: { access_token: 'test.test.test' } };
    if (path.startsWith('/me')) return { status: 200, body: fixture.me };
    if (path.startsWith('/arcade/start')) {
      game = String(body?.game);
      const meta = ARCADE_GAMES.find((g) => g.id === game);
      if (!meta) return { status: 400, body: { error: 'bad_game' } };
      return {
        status: 200,
        body: {
          runId: 'run-1', game, seed: SEED, runMs: meta.runMs,
          endsAt: Date.now() + meta.runMs, attempts: fixture.arcade.attempts,
        },
      };
    }
    if (path.startsWith('/arcade/finish')) {
      // Вердикт считает общий модуль — как на сервере.
      const verdict = evaluateArcade(game, SEED, body as never);
      if (verdict.ok && verdict.win) won = true;
      return {
        status: verdict.ok ? 200 : 409,
        body: verdict.ok
          ? {
            ok: true, game, result: verdict,
            rewards: { xp: verdict.win ? 27 : 3, capped: false }, awards: [],
            attempts: { ...fixture.arcade.attempts, used: 1, left: 9 },
            wins: verdict.win ? 1 : 0, best: verdict.score,
          }
          : { error: verdict.error },
      };
    }
    if (path.startsWith('/arcade')) {
      entries += 1;
      // «Повторить» обязан чинить экран: падает только первая попытка зайти в раздел.
      if (opts.failArcade && entries === 1) return { status: 500, body: { error: 'internal' } };
      return { status: 200, body: won ? fixture.arcadeAfter : fixture.arcade };
    }
    return { status: 200, body: {} };
  };

  (window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : undefined;
    calls.push({ path, body, headers });
    const res = answer(path, body);
    return {
      status: res.status, ok: res.status >= 200 && res.status < 300,
      headers: { get: () => null }, json: async () => res.body,
    };
  };
  (window as any).__arcadeSim = sim;
  window.eval([read('welcome.js'), read('box-stage.js'), read('app.js')].map(asScript).join('\n'));
  return { dom, window, calls, problems };
}

type Boot = Awaited<ReturnType<typeof boot>>;

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** Клавиша, которой клиент двигает героя в лабиринте. */
function press(ctx: Boot, key: string) {
  ctx.window.dispatchEvent(new (ctx.window as any).KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const KEY_OF = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

/** Идеальный путь по тому же зерну: единственный способ выиграть — пройти. */
function perfectMoves(seed: number): number[] {
  const g = makeMaze(seed >>> 0);
  const { path, steps } = solveMaze(g);
  const moves: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1] % g.cols;
    const ay = Math.floor(path[i - 1] / g.cols);
    const bx = path[i] % g.cols;
    const by = Math.floor(path[i] / g.cols);
    moves.push(bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : 0);
  }
  if (moves.length !== steps) throw new Error('решатель лабиринта разошёлся с полем');
  return moves;
}

/** Направление из стартовой клетки, которое упирается в стену (правило то же, что в клиенте). */
function wallMove(seed: number): number {
  const g = makeMaze(seed >>> 0);
  const d = [0, 1, 2, 3].find((x) => (g.mask[0] & [1, 2, 4, 8][x]) !== 0);
  if (d === undefined) throw new Error('в стартовой клетке нет стен');
  return d;
}

const q = (ctx: Boot, sel: string) => ctx.window.document.querySelector(sel);
const qa = (ctx: Boot, sel: string) => Array.from(ctx.window.document.querySelectorAll(sel));
const byText = (ctx: Boot, sel: string, text: string) =>
  qa(ctx, sel).find((n) => n.textContent === text) as HTMLElement | undefined;

let last: Boot | null = null;

afterEach(() => {
  // Окно закрываем: иначе rAF игрового цикла крутится до конца таймаута файла.
  last?.dom.window.close();
  last = null;
});

async function openArcade(opts: { failArcade?: boolean } = {}): Promise<Boot> {
  const ctx = await boot(opts);
  last = ctx;
  await tick();
  (ctx.window.document.querySelector('[data-view="arcade"]') as HTMLElement).click();
  await tick();
  return ctx;
}

/** Нажать «Играть» на плитке с индексом index (0 — лабиринт, 1 — судоку). */
async function openRun(ctx: Boot, index = 0) {
  const btn = qa(ctx, '#panel .arcade-tile button')[index] as HTMLButtonElement;
  expect(btn.textContent).toBe('Играть');
  btn.click();
  await tick();
}

describe('аркада в браузерном DOM', () => {
  it('приложение стартует без ошибок и открывает каталог из десяти игр', async () => {
    const ctx = await openArcade();
    expect(ctx.problems).toEqual([]);
    expect(q(ctx, '#panel .arena-hero h2')?.textContent).toBe('Десять мини-игр');
    expect(qa(ctx, '#panel .arcade-tile')).toHaveLength(10);
    for (const img of qa(ctx, '#panel .arcade-tile-art') as HTMLImageElement[]) {
      expect(img.getAttribute('src')).toMatch(/^\/sprites\/arcade\/[a-z0-9_]+\.png$/);
    }
    expect(ctx.calls.filter((c) => c.path === '/arcade')).toHaveLength(1);
    // Новичок: ни одной победы, поэтому полосы ступеней пустые.
    const fills = qa(ctx, '#panel .arena-tier .level-bar-fill') as HTMLElement[];
    expect(fills).toHaveLength(3);
    for (const fill of fills) expect(fill.style.width).toBe('0%');
  });

  it('кнопка «Играть» просит забег у сервера с ключом повторения', async () => {
    const ctx = await openArcade();
    await openRun(ctx);
    const start = ctx.calls.find((c) => c.path === '/arcade/start');
    expect(start?.body).toEqual({ game: 'maze' });
    expect(String(start?.headers['Idempotency-Key']).length).toBeGreaterThan(8);
    // Поле уже на экране: canvas есть, забег идёт — висит кнопка «Закончить».
    expect(q(ctx, '#panel #arcade-canvas')).toBeTruthy();
    expect(byText(ctx, '.arcade-running-bar .ghost', 'Закончить')).toBeTruthy();
    // Табло показывает местный прогресс (шаги), но не очки: очки считает сервер.
    expect(q(ctx, '[data-arcade-score]')?.textContent).not.toMatch(/очк|600/);
  });

  it('проход лабиринта стрелками сдаёт ходы и показывает вердикт сервера', async () => {
    const moves = perfectMoves(SEED);
    const ctx = await openArcade();
    await openRun(ctx);
    for (const d of moves) press(ctx, KEY_OF[d]);
    await tick(80);
    const finish = ctx.calls.find((c) => c.path === '/arcade/finish');
    expect(finish?.body?.moves).toEqual(moves);
    // Клиент отправляет ввод, а не очки: полей score/win в теле нет.
    expect(finish?.body?.score).toBeUndefined();
    expect(finish?.body?.win).toBeUndefined();
    const card = q(ctx, '#panel .arena-result');
    expect(card?.textContent).toContain('Победа · 600 очков');
    expect(card?.textContent).toContain(`шагов ${moves.length} из ${moves.length}`);
    expect(card?.textContent).toContain('+27 XP');
    // Экран остаётся на игре: карточка рядом с полем, а не вместо него.
    expect(q(ctx, '#panel .arcade-open-head h3')?.textContent).toBe('Кристальный блокпост');
    // «К каталогу» ведёт обратно к плиткам — уже со свежим «лучший счёт 600».
    (byText(ctx, '#panel button', 'К каталогу') as HTMLElement).click();
    await tick();
    expect(qa(ctx, '#panel .arcade-tile')).toHaveLength(10);
    expect(q(ctx, '#panel .arcade-tile-meta')?.textContent).toContain('лучший счёт 600');
    expect(ctx.problems).toEqual([]);
  });

  it('упор в стену обрывает забег: ввод уходит, очков нет', async () => {
    const blocked = wallMove(SEED);
    const ctx = await openArcade();
    await openRun(ctx);
    press(ctx, KEY_OF[blocked]);
    await tick(80);
    const finish = ctx.calls.find((c) => c.path === '/arcade/finish');
    expect(finish?.body?.moves).toEqual([blocked]);
    // Сервер такой ввод не засчитывает — и это тот же модуль, что в воркере.
    expect(evaluateArcade('maze', SEED, { moves: [blocked] } as never).ok).toBe(false);
    const card = q(ctx, '#panel .arena-result') ?? q(ctx, '#panel .error');
    expect(card?.textContent).toContain('попытка сгорела');
    // Забег закрыт: второй «сдать» клиент уже не шлёт.
    expect(ctx.calls.filter((c) => c.path === '/arcade/finish')).toHaveLength(1);
  });

  it('поле судоку строится из серверного зерна, а не из догадок клиента', async () => {
    const ctx = await openArcade();
    await openRun(ctx, 1);
    const cells = qa(ctx, '#panel .arcade-cell');
    expect(cells).toHaveLength(81);
    const given = cells.filter((c) => c.classList.contains('is-given'));
    expect(given.length).toBeGreaterThan(0);
    expect(given.length).toBeLessThan(81);
    // Данные клетки не кликабельны — их нельзя «починить» с клавиатуры.
    expect(given[0].hasAttribute('disabled')).toBe(true);
    expect(qa(ctx, '#panel .arcade-digit')).toHaveLength(10);
    // Живая подсказка: цифра ставится в выбранную пустую клетку.
    (cells.find((c) => !c.hasAttribute('disabled')) as HTMLElement).click();
    await tick();
    (q(ctx, '#panel .arcade-digit') as HTMLElement).click();
    await tick();
    const mine = qa(ctx, '#panel .arcade-cell').filter(
      (c) => !c.hasAttribute('disabled') && c.textContent === '1',
    );
    expect(mine).toHaveLength(1);
    // Сданное поле — снова вердикт сервера: уходят цифры, а не «мой результат».
    (byText(ctx, '.arcade-running-bar .ghost', 'Сдать результат') as HTMLElement).click();
    await tick(80);
    const body = ctx.calls.find((c) => c.path === '/arcade/finish')?.body;
    expect(Array.isArray(body?.answers)).toBe(true);
    expect(body?.answers).toHaveLength(81);
    expect(body?.score).toBeUndefined();
  });

  it('если сервер не ответил — экран объясняет причину и не долбит повторами', async () => {
    const ctx = await openArcade({ failArcade: true });
    expect(ctx.problems).toEqual([]);
    expect(q(ctx, '#panel')?.textContent).toContain('Аркада сейчас не отвечает');
    expect(q(ctx, '#panel .error')?.textContent).toBe('Ошибка сервера, попробуйте позже');
    expect(byText(ctx, '#panel button', 'Повторить')).toBeTruthy();
    // Ровно один запрос на раздел: без флага загрузки это был бы бесконечный цикл.
    await tick(160);
    expect(ctx.calls.filter((c) => c.path === '/arcade')).toHaveLength(1);
    // «Повторить» чинит экран, когда сервер снова отвечает.
    (byText(ctx, '#panel button', 'Повторить') as HTMLElement).click();
    await tick(80);
    expect(qa(ctx, '#panel .arcade-tile')).toHaveLength(10);
  });
});
