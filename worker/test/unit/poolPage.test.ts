import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Публичный отчёт пула (5.2) — страница для игрока, рекламной сети и поисковика.
// Проверяем не «красоту», а обязательные свойства: отчёт берётся с сервера,
// обещаний прибыли нет, выплаты честно помечены как выключенные.

const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/pool.html', root), 'utf8');
const js = readFileSync(new URL('client/pool.js', root), 'utf8');
const index = readFileSync(new URL('client/index.html', root), 'utf8');
const css = readFileSync(new URL('client/styles.css', root), 'utf8');

describe('страница «Astra Pool» (срез 5.2)', () => {
  it('открывается без входа и берёт числа с /pool', () => {
    expect(html).toContain('/pool.js');
    expect(js).toContain("fetch('/pool.json'");
    // Данные не считаются в браузере: только форматирование.
    expect(js).not.toContain('summarizePool');
    expect(js).toContain('Intl.NumberFormat');
  });

  it('честно помечает, что выплат нет и пул может быть пустым', () => {
    expect(html).toContain('Выплаты игрокам: выключены');
    expect(html).toContain('Пока операций нет');
    expect(html).toContain('Не инвестиция');
    expect(html).toContain('гейта 4');
    expect(js).toContain('payoutsEnabled');
    expect(js).toContain('Выплаты игрокам: выключены');
  });

  it('на странице есть правила и дисклеймер про ASTRA', () => {
    expect(html).toContain('Куда идут 20 %');
    expect(html).toContain('ASTRA — не деньги');
    expect(html).toContain('внутриигровая валюта');
    expect(html).toContain('выплат нет');
  });

  it('в игру ведёт ссылка, а старая заглушка «скоро» убрана', () => {
    expect(index).toContain('href="/pool.html"');
    expect(index).toContain('Прозрачность пула');
    expect(index).toContain('/icons/nav/pool.png');
    expect(index).not.toContain('data-soon="Astra Pool"');
  });

  it('страница и таблица имеют стили и спрайт нужного размера', () => {
    for (const cls of ['.pool-grid', '.pool-card', '.pool-table', '.pool-rules', '.pool-rule']) {
      expect(css).toContain(cls);
    }
    const png = readFileSync(new URL('client/icons/nav/pool.png', root));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(64);
  });

  it('форматтеры не обещают курс и не складывают валюты', () => {
    expect(js).toContain('multi');
    expect(js).toContain('несколько валют');
    expect(html).toContain('<code>/pool.json</code>');
  });
});
