import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Клиентская часть сезона: раздел должен быть в обоих меню, спрайты — на месте,
// а экран не может остаться заглушкой «скоро».

const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/index.html', root), 'utf8');
const app = readFileSync(new URL('client/app.js', root), 'utf8');
const css = readFileSync(new URL('client/styles.css', root), 'utf8');

const sprite = (path: string) => new URL(`client/${path}`, root);

describe('клиент сезона (этап 3)', () => {
  it('раздел «Сезон» есть в боковом меню и в доке, а не в списке «скоро»', () => {
    const views = html.match(/data-view="season"/g) ?? [];
    expect(views.length).toBe(2);
    expect(html).not.toContain('data-soon="Сезон"');
    expect(html).toContain('/icons/nav/season.png');
  });

  it('экран сезона запрашивает /season и рисует рейтинг, призы и прошлые сезоны', () => {
    expect(app).toContain('async function loadSeason');
    expect(app).toContain("authed('/season')");
    expect(app).toContain('function renderSeason');
    expect(app).toContain("view === 'season' ? renderSeason()");
    expect(app).toContain('Награды за сезон');
    expect(app).toContain('Прошлые сезоны');
    expect(app).toContain('/icons/season/trophy.png');
    expect(app).toContain('/icons/season/medal_${rank}.png');
  });

  it('на мостике виден сезон и переход в рейтинг', () => {
    expect(app).toContain('Сезон ${season.number}');
    expect(app).toContain("setView('season')");
  });

  it('спрайты сезона на месте и не тяжелее лимита', () => {
    const files = ['icons/nav/season.png', 'icons/season/trophy.png', 'icons/season/medal_1.png', 'icons/season/medal_2.png', 'icons/season/medal_3.png'];
    for (const file of files) {
      const path = sprite(file);
      const bytes = statSync(path).size;
      expect(bytes).toBeGreaterThan(1000);
      expect(bytes).toBeLessThan(120 * 1024);
      const head = readFileSync(path).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('стили сезона есть, док рассчитан на девять разделов', () => {
    expect(css).toContain('.season-hero');
    expect(css).toContain('.rating-row.is-me');
    expect(css).toContain('repeat(9, 1fr)');
  });
});
