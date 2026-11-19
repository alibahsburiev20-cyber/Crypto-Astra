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

  it('лендинг с картинками: спрайты кораблей, планет и ресурсов', () => {
    expect(html).toContain('/sprites/ships/scout.png');
    expect(html).toContain('/icons/planets/ferra.png');
    expect(html).toContain('/icons/resources/circuit.png');
    expect(html).toContain('Командуй базой на краю галактики');
    // Секции, которые нужны модерации и человеку, а не только форме входа.
    expect(html).toContain('Ваш флот');
    expect(html).toContain('Частые вопросы');
  });

  it('регистрация открывается кнопкой, а не висит формой на странице', () => {
    const opens = html.match(/data-open-auth="register"/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('id="auth-overlay"');
    expect(html).toContain('id="auth-close"');
    expect(app).toContain('function openAuth');
    expect(app).toContain('function closeAuth');
    expect(app).toContain("show('landing')");
  });

  it('в статическом HTML нет плашки «мир заморожен»', () => {
    // Модератор и поисковик читают страницу без выполнения скрипта: строка
    // «мир заморожен» на живой странице выглядит как сломанная игра.
    expect(html).not.toContain('Мир заморожен');
    expect(app).toContain("id: 'frozen'");
  });

  it('блок описания скрывается на игровом экране', () => {
    expect(app).toContain("landing.hidden = which === 'game'");
  });
});
