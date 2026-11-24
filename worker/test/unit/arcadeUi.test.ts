import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderArcadeClient } from '../../../scripts/build-arcade.mjs';
import { ARCADE_GAMES } from '../../src/shared/arcade';

// Экран «Аркада»: связки, а не слова. Пункт меню → вьюха → общий модуль →
// собранный браузерный файл → серверные маршруты. Если разойдётся хотя бы одно
// звено, игрок увидит пустой экран или «кнопка не работает», поэтому здесь
// проверяется именно цепочка целиком.

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const has = (path: string) => existsSync(new URL(path, root));

const html = read('client/index.html');
const app = read('client/app.js');
const css = read('client/styles.css');
const bundle = read('client/arcade-sim.js');

describe('аркада: экран и навигация', () => {
  it('пункт «Аркада» есть в сайдбаре и в доке', () => {
    expect((html.match(/data-view="arcade"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('/icons/nav/arcade.png');
    expect(has('client/icons/nav/arcade.png')).toBe(true);
    expect(has('client/icons/ui/arcade.png')).toBe(true);
  });

  it('вьюха подключена в render, в setView и в перевешивание цикла', () => {
    expect(app).toContain("view === 'arcade' ? renderArcade()");
    expect(app).toContain("if (v === 'arcade') { arcadeResult = null; if (!arcadeData) loadArcade(); }");
    expect(app).toContain("if (view === 'arcade') arcadeMount();");
    expect(app).toContain('function renderArcade(');
  });

  it('браузер ходит только на объявленные сервером маршруты', () => {
    expect(app).toContain("authed('/arcade')");
    expect(app).toContain("authed('/arcade/start'");
    expect(app).toContain("authed('/arcade/finish'");
    // У записи обязан быть ключ повторения — иначе оборванная сеть удвоит награду.
    const finish = app.slice(app.indexOf("authed('/arcade/finish'"));
    expect(finish.slice(0, 400)).toContain("'Idempotency-Key'");
    const start = app.slice(app.indexOf("authed('/arcade/start'"));
    expect(start.slice(0, 400)).toContain("'Idempotency-Key'");
  });

  it('счёт не приходит от клиента: в теле финиша нет ни score, ни очков', () => {
    const submit = app.slice(app.indexOf('async function arcadeSubmit('), app.indexOf('// ── Цикл canvas-игр'));
    expect(submit).toBeTruthy();
    expect(submit).not.toMatch(/score\s*:/);
    expect(submit).toContain('runId');
  });

  it('у нового кода ошибки есть человеческий текст', () => {
    const block = app.slice(app.indexOf('const ERRORS = {'), app.indexOf('};', app.indexOf('const ERRORS = {')));
    expect(block).toContain("bad_game: 'Такой игры в аркаде нет — обнови страницу'");
    // Остальные коды аркада переиспользует у арены: они обязаны остаться.
    for (const code of ['bad_trace', 'too_fast', 'short', 'run_expired', 'run_not_found', 'daily_limit']) {
      expect(block).toContain(`${code}:`);
    }
  });

  it('разметка собирается без innerHTML — данные не попадают в HTML-строку', () => {
    const arcade = app.slice(app.indexOf('// ── Аркада: десять мини-игр'), app.indexOf('function renderMissions()'));
    expect(arcade.length).toBeGreaterThan(4000);
    expect(arcade).not.toContain('innerHTML');
    expect(arcade).not.toContain('document.write');
    expect(css).toContain('.arcade-catalog');
    expect(css).toContain('.arcade-grid9');
    expect(css).toContain('.arcade-card');
  });
});

describe('аркада: спрайты', () => {
  it('у каждой игры каталога есть свой PNG, и он настоящий', () => {
    expect(ARCADE_GAMES.length).toBe(10);
    for (const g of ARCADE_GAMES) {
      const rel = `client${g.sprite}`;
      expect(has(rel), rel).toBe(true);
      const bytes = readFileSync(new URL(rel, root)).subarray(0, 8);
      expect([...bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      expect(statSync(new URL(rel, root)).size).toBeLessThan(400 * 1024);
      // Прозрачный фон у спрайтов — по правилу docs/SPRITES.md.
      expect(g.sprite.startsWith('/sprites/arcade/')).toBe(true);
    }
  });

  it('медали и фон раздела на месте', () => {
    for (const name of ['medal_arcade_bronze', 'medal_arcade_silver', 'medal_arcade_gold', 'medal_arcade_week', 'medal_arcade_all']) {
      expect(has(`client/sprites/arcade/${name}.png`), name).toBe(true);
    }
    expect(has('client/sprites/bg/arcade.png')).toBe(true);
    expect(css).toContain("url('/sprites/bg/arcade.png')");
  });

  it('каждый спрайт, который рисует клиент, лежит в репозитории', () => {
    const section = app.slice(app.indexOf('const ARCADE_SPRITES'), app.indexOf('let arcadeData'));
    const refs = [...section.matchAll(/'\/sprites\/[^']+'/g)].map((m) => m[0].slice(1, -1));
    expect(refs.length).toBeGreaterThan(20);
    for (const rel of refs) expect(has(`client${rel}`), rel).toBe(true);
    // Имена спрайтов каталога совпадают с id игр: меньше шансов разойтись.
    for (const g of ARCADE_GAMES) {
      expect(g.sprite).toBe(`/sprites/arcade/${g.id}.png`);
    }
  });
});

describe('аркада: общий модуль в браузере', () => {
  it('client/arcade-sim.js совпадает со свежей сборкой', () => {
    expect(bundle).toBe(renderArcadeClient());
  });

  it('в файле есть баннер генератора и точки входа клиента', () => {
    expect(bundle).toContain('Сгенерировано scripts/build-arcade.mjs');
    for (const name of ['ARCADE_GAMES', 'evaluateArcade', 'makeMaze', 'makeSudoku', 'makeMemoryDeck']) {
      expect(bundle).toContain(name);
    }
  });

  it('клиент зовёт только те функции, которые модуль экспортирует', () => {
    const exported = new Set<string>();
    for (const m of bundle.matchAll(/export (?:function|const) ([A-Za-z0-9_]+)/g)) exported.add(m[1]);
    const called = new Set<string>();
    const arcadeSection = app.slice(app.indexOf('// ── Аркада: десять мини-игр'), app.indexOf('function renderMissions()'));
    // Комментарии вырезаем: в них встречается имя файла /arcade-sim.js, и «sim.»
    // из текста комментария не должен притворяться вызовом API.
    const code = arcadeSection.replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/\bsim\.([A-Za-z0-9_]+)\s*[(.]/g)) called.add(m[1]);
    expect(called.size).toBeGreaterThan(5);
    const missing = [...called].filter((name) => !exported.has(name));
    expect(missing, `нет экспорта: ${missing.join(', ')}`).toEqual([]);
  });

  it('правила считаются на сервере: мир импортирует evaluateArcade', () => {
    const world = read('worker/src/world/modules/arcade.ts');
    expect(world).toContain('evaluateArcade');
    expect(world).toContain('withIdempotency');
    expect(world).toContain('ARCADE_DAILY_XP_CAP');
    // И никакого влияния на экономику: мир для аркады не трогает балансы.
    expect(world).not.toContain('applyDelta');
  });
});
