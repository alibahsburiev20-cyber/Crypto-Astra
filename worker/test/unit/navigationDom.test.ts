import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as sim from '../../../client/arcade-sim.js';

/**
 * Раздел, прокрутка и шлюз «я человек» в настоящем DOM.
 *
 * Три правки из списка игрока («прыжки во Флоте», «вкладки скачут», «обновил
 * страницу — улетело на первую вкладку», «проверка на человека не работает») —
 * про поведение оболочки, а не про формулы. Строки в app.js тут тоже проверяются,
 * но только там, где jsdom физически не может увидеть эффект: у него нет
 * настоящей прокрутки и нет загрузки чужих скриптов.
 */

const ROOT = new URL('../../../client/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, ROOT), 'utf8');
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/arcade-dom.json', import.meta.url), 'utf8'),
) as { me: Record<string, unknown>; arcade: Record<string, any> };

const asScript = (text: string): string => text
  .replace(/^import[^;]+;$/gm, '')
  .replace(/^export default [A-Za-z0-9_$]+;$/gm, '')
  .replace(/^export /gm, '')
  // Динамический import в jsdom не работает: отдаём тот же модуль с диска.
  .replace("import('/arcade-sim.js')", 'Promise.resolve(window.__arcadeSim)');

interface Boot {
  window: any;
  doc: Document;
  problems: string[];
  calls: { path: string; body?: Record<string, any> }[];
}

async function boot(opts: {
  hash?: string;
  siteKey?: string | null;
  saved?: string | null;
  control?: string | null;
} = {}): Promise<Boot> {
  const problems: string[] = [];
  const vc = new VirtualConsole();
  vc.on('error', (m: unknown) => problems.push(`console.error: ${String(m)}`));
  vc.on('jsdomError', (e: unknown) => problems.push(`jsdom: ${String(e)}`));
  const dom = new JSDOM(read('index.html'), {
    url: `https://play.example/${opts.hash ? `#${opts.hash}` : ''}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  const calls: { path: string; body?: Record<string, any> }[] = [];

  (window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, any>) : undefined;
    calls.push({ path, body });
    let status = 200;
    let out: unknown = {};
    if (path.startsWith('/health')) out = { ok: true, now: Date.now() };
    else if (path.startsWith('/config')) out = { turnstile_site_key: opts.siteKey ?? null };
    else if (path.startsWith('/auth/refresh')) out = { access_token: 'test.test.test' };
    else if (path.startsWith('/me')) out = fixture.me;
    else if (path.startsWith('/arcade/start')) {
      out = {
        runId: 'run-1', game: 'breakout', seed: 20261117, runMs: 60000,
        endsAt: Date.now() + 60000, attempts: fixture.arcade.attempts,
      };
    } else if (path.startsWith('/arcade')) out = fixture.arcade;
    return {
      status, ok: status >= 200 && status < 300,
      headers: { get: () => null }, json: async () => out,
    };
  };
  // Спрайты в jsdom не грузятся, а запуск забега ждёт их загрузки.
  window.Image = class {
    onload = null;
    onerror = null;
    set src(_v) { setTimeout(() => this.onload && this.onload(), 0); }
  };
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
    get: (_t, k: string) => {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return () => {};
    },
    set: () => true,
  });
  // Что игрок оставил в прошлой сессии: раздел и тип управления аркадой.
  if (opts.saved !== undefined) {
    if (opts.saved === null) window.localStorage.removeItem('astra:view');
    else window.localStorage.setItem('astra:view', opts.saved);
  }
  if (opts.control !== undefined) {
    if (opts.control === null) window.localStorage.removeItem('astra:arcade-control');
    else window.localStorage.setItem('astra:arcade-control', opts.control);
  }
  window.__arcadeSim = sim;
  window.eval([read('welcome.js'), read('box-stage.js'), read('app.js')].map(asScript).join('\n'));
  // Дождаться бутстрапа: boot читает /health, /config, /auth/refresh и /me.
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  return { window, doc: window.document, problems, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

const q = (ctx: Boot, sel: string): Element | null => ctx.doc.querySelector(sel);
const qa = (ctx: Boot, sel: string): Element[] => Array.from(ctx.doc.querySelectorAll(sel));
const click = async (node: Element | null) => {
  expect(node, 'кнопка не найдена').toBeTruthy();
  (node as HTMLElement).click();
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
/** Прокрутить реальные таймеры: загрузка спрайтов и старт забега — асинхронные. */
const settle = async (ms = 60) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const byText = (ctx: Boot, sel: string, text: string) => qa(ctx, sel).find((n) => (n.textContent || '').includes(text)) || null;

describe('раздел переживает перезагрузку', () => {
  it('клик по вкладке пишет раздел в localStorage и в хэш', async () => {
    const ctx = await boot({ saved: null });
    expect(ctx.problems).toEqual([]);
    expect(q(ctx, '#game')?.hasAttribute('hidden')).toBe(false);
    await click(byText(ctx, '.side-item', 'Флот'));
    expect(ctx.window.localStorage.getItem('astra:view')).toBe('fleet');
    expect(ctx.window.location.hash).toBe('#fleet');
    expect(q(ctx, '.side-item.active')?.getAttribute('data-view')).toBe('fleet');
    expect(ctx.calls.filter((c) => c.path.startsWith('/me')).length).toBeGreaterThanOrEqual(2);
  });

  it('F5 на #fleet возвращает во «Флот», а не на «Обзор»', async () => {
    const ctx = await boot({ hash: 'fleet' });
    expect(q(ctx, '.side-item.active')?.getAttribute('data-view')).toBe('fleet');
    expect(q(ctx, '#panel h2')?.textContent).toBe('Флот');
  });

  it('без хэша раздел берётся из localStorage', async () => {
    const ctx = await boot({ saved: 'boxes' });
    expect(q(ctx, '.side-item.active')?.getAttribute('data-view')).toBe('boxes');
    // Хэш дописывается при восстановлении: ссылку можно скопировать из адресной строки.
    expect(ctx.window.location.hash).toBe('#boxes');
  });

  it('чужой или битый раздел в хэше не ломает старт', async () => {
    const ctx = await boot({ hash: 'not-a-view' });
    expect(q(ctx, '.side-item.active')?.getAttribute('data-view')).toBe('bridge');
    expect(q(ctx, '#panel')?.textContent).toContain('Claim');
    expect(ctx.problems).toEqual([]);
  });

  /**
   * Корень «прыжков» — миг, когда `#panel` пуст: высота страницы обнуляется, и
   * браузер обрезает прокрутку. В jsdom layout нет, поэтому ловим сам приём:
   * `replaceChildren` обязан всегда получать новый экран одним аргументом.
   */
  it('экран меняется одной операцией — без мгновения с пустым #panel', async () => {
    const ctx = await boot({ saved: null });
    const swaps: number[] = [];
    const proto = ctx.window.Element.prototype;
    const real = proto.replaceChildren;
    proto.replaceChildren = function patched(this: Element, ...kids: unknown[]) {
      if (this === ctx.doc.getElementById('panel')) swaps.push(kids.length);
      return (real as (...a: unknown[]) => unknown).apply(this, kids);
    };
    for (const name of ['fleet', 'boxes', 'flight', 'fleet']) {
      await click(q(ctx, `.side-item[data-view="${name}"]`));
      await settle();
    }
    expect(swaps.length).toBeGreaterThanOrEqual(3);
    for (const n of swaps) expect(n).toBe(1);
    expect(qa(ctx, '#panel > *')).toHaveLength(1);
    proto.replaceChildren = real;

    const app = read('app.js');
    // Позицию возвращаем, только если раздел не менялся: переход в другую вкладку
    // обязан начинаться с её заголовка, а не с середины списка.
    expect(app).toContain('const sameView = renderedView === null || renderedView === view;');
    expect(app).toContain('window.scrollTo(0, scrollKeep);');
    // «Прыжки вверх-вниз» в длинных разделах усиливаются спрайтами без размера:
    // высота резервируется через aspect-ratio, а не после загрузки PNG.
    expect(read('styles.css')).toContain('.sprite-thumb { width: 96px; aspect-ratio: 2 / 1;');
    expect(app).toContain("width: '96', height: '48', class: 'sprite-thumb'");
  });
});

describe('дальность и чертёж во «Флоте»', () => {
  it('радиус борта виден и в ангаре, и в верфи', async () => {
    const ctx = await boot({ saved: 'fleet' });
    const text = q(ctx, '#panel')?.textContent || '';
    expect(text).toMatch(/Scout[\s\S]*до 2 сект\./);
    expect(text).toMatch(/Flagship[\s\S]*до 5 сект\./);
  });

  it('флагман не «не продаётся и всё»: у него есть путь — чертёж', async () => {
    const ctx = await boot({ saved: 'fleet' });
    const flagship = byText(ctx, '#panel .block', 'Flagship');
    expect(flagship?.textContent).toContain('Нужен чертёж');
    const build = byText(ctx, '#panel .block button', 'Собрать из чертежа');
    expect(build, 'кнопка сборки без чертежа активна').toBeNull();
    // Кнопка уводит ровно туда, где чертёж делается, — а не в «когда-нибудь».
    await click(byText(ctx, '#panel button', 'К чертежу в «Крафт»'));
    expect(q(ctx, '.side-item.active')?.getAttribute('data-view')).toBe('craft');
    const card = byText(ctx, '#panel .craft-card', 'Чертёж Flagship');
    expect(card?.textContent).toContain('Квантовая пыль 0/6');
    expect(card?.textContent).toContain('900 ASTRA');
  });
});

describe('проверка «я человек»', () => {
  it('без site key блока проверки нет', async () => {
    const ctx = await boot({ saved: null, siteKey: null });
    expect(q(ctx, '.bonus-check')).toBeNull();
    expect(qa(ctx, 'script[src*="challenges.cloudflare.com"]')).toHaveLength(0);
  });

  it('со site key скрипт запрашивается, а не молчит', async () => {
    const ctx = await boot({ saved: null, siteKey: '0x4AAAAA-sitekey' });
    expect(q(ctx, '#panel #turnstile-claim')).toBeTruthy();
    // Скрипт ещё не ответил — состояние 'loading', и оно должно быть видно.
    expect(q(ctx, '.bonus-check')?.textContent).toContain('Загружаем проверку…');
    expect(qa(ctx, 'script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
  });

  it('зависшая загрузка проверки превращается в ошибку с кнопкой повтора', async () => {
    vi.useFakeTimers();
    const ctx = await boot({ saved: null, siteKey: '0x4AAAAA-sitekey' });
    // Скрипт Cloudflare в песочнице не отвечает вообще: ни onload, ни onerror.
    // Без таймаута так и висело — «Загружаем проверку…» и мёртвый Claim.
    await vi.advanceTimersByTimeAsync(13000);
    const block = q(ctx, '.bonus-check');
    expect(block?.className).toContain('is-error');
    expect(block?.textContent).toContain('не открылась');
    expect(byText(ctx, '.bonus-check button', 'Повторить проверку')).toBeTruthy();
  });

  it('слот проверки монтируется по факту разметки, а не по списку разделов', () => {
    const app = read('app.js');
    expect(app).toContain("if (bonusGateOn() && document.getElementById('turnstile-claim')) mountBonusGate();");
    expect(app).not.toContain("if (view === 'bridge' || view === 'boxes' || view === 'bonus') mountBonusGate();");
    // Перерисовка унесла iframe — виджет пересоздаётся, иначе слот пустой навсегда.
    expect(app).toContain('if (bonusWidget !== null && window.turnstile && !box.firstChild) {');
  });
});

describe('тип управления аркадой', () => {
  it('режим выбирается в каталоге и запоминается', async () => {
    const ctx = await boot({ saved: 'arcade' });
    expect(q(ctx, '.arcade-controls')).toBeTruthy();
    await click(byText(ctx, '.arcade-controls button', 'Тач'));
    expect(ctx.window.localStorage.getItem('astra:arcade-control')).toBe('touch');
    expect(q(ctx, '.arcade-control-btn.is-on')?.textContent).toBe('Тач');
    // Экранный крест появляется только когда он на что-то влияет — в забеге.
    expect(q(ctx, '.arcade-pad')).toBeNull();
  });

  it('режим доживает до забега: в тач-режиме на поле есть крестовина', async () => {
    const ctx = await boot({ saved: 'arcade', control: 'touch' });
    expect(qa(ctx, '#panel .arcade-tile button')[6]?.textContent).toBe('Играть');
    await click(qa(ctx, '#panel .arcade-tile button')[6]);
    await settle();
    expect(q(ctx, '#panel #arcade-canvas')).toBeTruthy();
    expect(qa(ctx, '.arcade-pad-dpad .arcade-pad-btn')).toHaveLength(4);
    // «Прыжок» в бегуне и «тап» в реакции — одна кнопка действия, её тут нет:
    // это «Разбор щита», где важно только движение.
    expect(q(ctx, '.arcade-pad-btn.is-action')).toBeNull();
    // Тап по экранным кнопкам не должен ронять забег: обработчик жив, поле на месте.
    for (const btn of qa(ctx, '.arcade-pad-dpad .arcade-pad-btn')) btn.dispatchEvent(new ctx.window.Event('pointerdown'));
    await settle();
    expect(q(ctx, '#panel #arcade-canvas')).toBeTruthy();
    expect(byText(ctx, '.arcade-running-bar button', 'Закончить')).toBeTruthy();
    expect(ctx.problems).toEqual([]);
    // Палец по полю управляет, а мышиный ввод в тач-режиме игнорируется.
    expect(read('app.js')).toContain('if (!arcadePointerAllowed(e)) return;');
    expect(read('app.js')).toContain("if (arcadeControl === 'touch') return type === 'touch' || type === 'pen';");
  });

  it('в режиме «Кнопки» указатель не управляет полем', async () => {
    const ctx = await boot({ saved: 'arcade', control: 'keys' });
    await click(qa(ctx, '#panel .arcade-tile button')[6]);
    await settle();
    expect(q(ctx, '#panel #arcade-canvas')).toBeTruthy();
    // С клавиатуры экранный крест не нужен — он только закрыл бы поле.
    expect(q(ctx, '.arcade-pad')).toBeNull();
    expect(q(ctx, '.arcade-controls')?.textContent).toContain('только клавиши');
    const app = read('app.js');
    expect(app).toContain("if (arcadeControl === 'mouse' || arcadeControl === 'touch') return;");
    expect(app).toContain('arcadeNudge(dir);');
  });
});
