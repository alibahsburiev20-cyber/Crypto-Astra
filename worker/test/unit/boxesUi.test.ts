import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOXES, BOX_ORDER } from '../../src/shared/gameData';

// Клиент «Боксов»: пункт в меню и доке, спрайты нужного размера, экран ходит в
// /boxes и /boxes/open, а тексты отказов переведены. Без этих проверок легко
// получить кнопку без маршрута или картинку без файла.

const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/index.html', root), 'utf8');
const app = readFileSync(new URL('client/app.js', root), 'utf8');
const css = readFileSync(new URL('client/styles.css', root), 'utf8');
const file = (path: string) => new URL(`client/${path}`, root);

describe('клиент боксов (этап 5)', () => {
  it('раздел «Боксы» есть в меню и в доке', () => {
    expect((html.match(/data-view="boxes"/g) ?? []).length).toBe(2);
    expect(html).toContain('/icons/nav/boxes.png');
  });

  it('экран запрашивает /boxes и открывает через /boxes/open', () => {
    expect(app).toContain("authed('/boxes')");
    expect(app).toContain("'/boxes/open'");
    expect(app).toContain('function renderBoxes');
    expect(app).toContain('function doOpenBox');
    expect(app).toContain("if (v === 'boxes') loadBoxes();");
  });

  it('все коды ошибок боксов переведены', () => {
    for (const code of ['bad_box', 'box_cooldown', 'insufficient_funds', 'world_frozen']) {
      expect(app).toContain(`${code}:`);
    }
  });

  it('в журнале есть причины боксов', () => {
    expect(app).toContain('box_purchase:');
    expect(app).toContain('box_open:');
  });

  it('спрайты существуют, 128 px и не тяжелее 40 КБ', () => {
    for (const id of BOX_ORDER) {
      const path = `sprites/boxes/${id}.png`;
      const buf = readFileSync(file(path));
      expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(buf.readUInt32BE(16), path).toBe(128);
      expect(buf.readUInt32BE(20), path).toBe(128);
      expect(statSync(file(path)).size, path).toBeLessThan(40 * 1024);
      // Путь отдаёт сервер (`sprite`), клиент только подставляет его — поэтому
      // имя файла обязано совпадать с id из каталога.
      expect(app).toContain('b.sprite');
      expect(readFileSync(new URL('worker/src/world/modules/boxes.ts', root), 'utf8'))
        .toContain('`/sprites/boxes/${id}.png`');
    }
    const nav = readFileSync(file('icons/nav/boxes.png'));
    expect(nav.readUInt32BE(16)).toBe(64);
    expect(nav.readUInt32BE(20)).toBe(64);
    expect(statSync(file('icons/nav/boxes.png')).size).toBeLessThan(40 * 1024);
  });

  it('карточки показывают цену, таймер и состав', () => {
    expect(css).toContain('.box-grid');
    expect(css).toContain('.box-card.is-locked');
    expect(app).toContain('data-open-box');
    expect(app).toContain('data-until');
    // Цена и границы выдач приходят из каталога, а не пишутся руками.
    for (const id of BOX_ORDER) expect(BOXES[id].units[1]).toBeGreaterThan(BOXES[id].units[0]);
  });
});
