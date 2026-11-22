import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderMinigameClient } from '../../../scripts/build-minigame.mjs';

// Экран «Арена» и кнопочные спрайты. Проверяем не «есть ли слово», а связки:
// пункт меню → вьюха → обработчики → общий модуль расчёта и собранный клиент.

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const has = (path: string) => existsSync(new URL(path, root));

const html = read('client/index.html');
const app = read('client/app.js');
const css = read('client/styles.css');

describe('арена: экран и навигация', () => {
  it('пункт «Арена» есть в сайдбаре и в доке', () => {
    expect(html).toContain('data-view="arena"');
    expect(html).toContain('/icons/ui/arena.png');
    expect(has('client/icons/ui/arena.png')).toBe(true);
  });

  it('вьюха подключена к роутеру и загрузке данных', () => {
    expect(app).toContain('function renderArena');
    expect(app).toContain("view === 'arena' ? renderArena()");
    expect(app).toContain("if (v === 'arena')");
    expect(app).toContain('async function loadArena');
  });

  it('забег идёт через сервер: старт, трасса, финиш', () => {
    expect(app).toContain("'/minigame/start'");
    expect(app).toContain("'/minigame/finish'");
    expect(app).toContain('run.xs.push');
    expect(app).toContain('stepMs: 40');
    expect(app).toContain('sim.makeField');
    expect(app).toContain('Idempotency-Key');
    expect(app).toContain('import(\'/minigame-sim.js\')');
  });

  it('управление работает мышью, пальцем и клавишами', () => {
    expect(app).toContain("addEventListener('pointermove'");
    expect(app).toContain("e.key === 'ArrowLeft'");
    expect(app).toContain('arenaMount');
    expect(css).toContain('.arena-canvas');
    expect(css).toContain('touch-action: none');
  });

  it('задания 25/50/100 и медали видны игроку', () => {
    expect(app).toContain('arenaTier');
    expect(app).toContain('медаль получена');
    expect(app).toContain('r.awards.map');
  });
});

describe('спрайты кнопок', () => {
  it('у каждой кнопки дока есть иконка', () => {
    const dock = html.slice(html.indexOf('<nav class="dock"'), html.indexOf('</nav>', html.indexOf('<nav class="dock"')));
    const buttons = dock.match(/<button /g) ?? [];
    const icons = dock.match(/class="dock-ico"/g) ?? [];
    expect(buttons.length).toBeGreaterThan(10);
    expect(icons.length).toBe(buttons.length);
  });

  it('у входа, регистрации и выхода есть иконки', () => {
    for (const icon of ['login', 'register', 'logout']) {
      expect(has(`client/icons/ui/${icon}.png`)).toBe(true);
      expect(html).toContain(`/icons/ui/${icon}.png`);
    }
    expect(css).toContain('.btn-ico');
    expect(css).toContain('.dock-ico');
  });

  it('все иконки — настоящие PNG, а не пустые файлы', () => {
    for (const name of ['arena', 'login', 'register', 'logout', 'play', 'claim', 'refresh', 'buy']) {
      const bytes = readFileSync(new URL(`client/icons/ui/${name}.png`, root)).subarray(0, 4);
      expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});

describe('общий модуль мини-игры', () => {
  it('браузерный файл совпадает со свежей сборкой', () => {
    const built = read('client/minigame-sim.js');
    expect(built).toBe(renderMinigameClient());
  });

  it('в нём есть то, чем пользуется клиент', () => {
    const built = read('client/minigame-sim.js');
    expect(built).toContain('export function makeField');
    expect(built).toContain('export const RUN_MS');
    expect(built).toContain('Сгенерировано scripts/build-minigame.mjs');
  });
});
