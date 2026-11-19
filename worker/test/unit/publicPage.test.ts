import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Публичная страница — вход для рекламной сети и поисковика. Они смотрят сайт без
// регистрации, поэтому описание игры должно быть в статическом HTML, а не в JS.
const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/index.html', root), 'utf8');
const app = readFileSync(new URL('client/app.js', root), 'utf8');

describe('публичная страница (гейт 2)', () => {
  it('описание игры есть в статическом HTML, не только в скрипте', () => {
    expect(html).toContain('id="landing"');
    expect(html).toContain('Crypto Astra — бесплатная браузерная космическая экономическая игра');
    expect(html).toContain('<meta name="description"');
    // Ключевые правила видны до входа.
    expect(html).toContain('Claim');
    expect(html).toContain('налог 5 %');
  });

  it('дисклеймер ASTRA стоит и на публичной странице', () => {
    expect(html).toContain('внутриигровая валюта');
    expect(html).toContain('выплат нет');
  });

  it('место под подтверждение владения сайтом размечено', () => {
    expect(html).toContain('site-verification');
  });

  it('реклама подписана и не обещает награду', () => {
    // Сеть требует, чтобы реклама отличалась от игры, и запрещает платить за клики.
    expect(app).toContain("'Реклама'");
    expect(app).toContain("class: 'ad-label'");
  });

  it('блок описания скрывается на игровом экране', () => {
    expect(app).toContain("landing.hidden = which === 'game'");
  });
});
