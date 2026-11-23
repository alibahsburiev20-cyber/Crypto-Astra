// Проверка настоящего DOM: pay.html + pay.js в jsdom.
//
// Зачем: юнит-тесты проверяют сервер, но не ловят «маршрут есть, а кнопки нет» —
// именно так экран пополнения прожил без адреса. Здесь страница грузится как в
// браузере, запросы подменяются, и мы смотрим на итоговый текст в узле.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../client/pay.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../../client/pay.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../../../client/i18n.js', import.meta.url), 'utf8');

interface Handler {
  (url: string, init?: RequestInit): { status: number; body: unknown };
}

/**
 * jsdom не умеет модули внутри eval: снимаем export и import, оставляя код.
 * Проверяется тот же исходник, что уходит в браузер.
 */
const stripModule = (text: string): string => text
  .replace(/^import[^;]+;$/gm, '')
  .replace(/^export /gm, '');

function boot(handler: Handler, savedLang?: string) {
  const calls: string[] = [];
  const dom = new JSDOM(html, {
    url: 'https://play.example/pay.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  }) as typeof window.fetch;
  if (savedLang) window.localStorage.setItem('astra:lang', savedLang);
  window.eval(`${stripModule(i18n)}\n${stripModule(script)}`);
  return { dom, window, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('pay.html в браузерном DOM', () => {
  it('без сессии показывает приглашение войти, а не пустой блок', async () => {
    const { window } = boot(() => ({ status: 401, body: { error: 'no_session' } }), 'ru');
    await tick();
    expect(window.document.querySelector('[data-pay="address"]')?.textContent).toContain('Войдите');
  });

  it('с сессией выводит адрес пополнения и кнопку копирования', async () => {
    const { window, calls } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/address.json')) {
        return {
          status: 200,
          body: {
            ok: true, address: 'TXyz111111111111111111111111111111111', index: 7,
            created: true, network: 'mainnet', asset: 'USDT',
            contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          },
        };
      }
      if (url.endsWith('/pay/account.json')) return { status: 200, body: { ok: true, balanceMicro: 0, history: [], entitlements: [] } };
      return { status: 404, body: { error: 'not_found' } };
    });
    await tick();
    const address = window.document.querySelector('[data-pay="address"]')?.textContent ?? '';
    expect(address).toBe('TXyz111111111111111111111111111111111');
    expect(window.document.querySelector('[data-pay="copy-btn"]')?.hasAttribute('hidden')).toBe(false);
    expect(window.document.querySelector('[data-pay="deposit-note"]')?.textContent).toContain('USDT');
    // Адрес запрашивается один раз при загрузке страницы.
    expect(calls.filter((u) => u.endsWith('/pay/address.json'))).toHaveLength(1);
  });

  it('переводятся заголовки и кнопки на выбранном языке', async () => {
    const { window } = boot(() => ({ status: 401, body: { error: 'no_session' } }), 'de');
    await tick();
    expect(window.document.documentElement.lang).toBe('de');
    expect(window.document.querySelector('[data-i18n="deposit.title"]')?.textContent).toBe('Guthaben aufladen');
    expect(window.document.querySelector('[data-lang="de"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(window.document.querySelector('[data-lang="ru"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('503 signer_not_configured объясняет причину человеческим языком', async () => {
    const { window } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/address.json')) return { status: 503, body: { error: 'signer_not_configured' } };
      return { status: 404, body: { error: 'not_found' } };
    });
    await tick();
    const note = window.document.querySelector('[data-pay="deposit-note"]')?.textContent ?? '';
    expect(note).toContain('Signer');
    expect(window.document.querySelector('[data-pay="copy-btn"]')?.hasAttribute('hidden')).toBe(true);
  });
});
