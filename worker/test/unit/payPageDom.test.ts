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
  (url: string, init?: RequestInit): { status: number; body: unknown; text?: string; bytes?: Uint8Array };
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
    const { status, body, text, bytes } = handler(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
      // QR приходит не JSON’ом, а картинкой — для него нужны отдельные каналы.
      text: async () => text ?? '',
      arrayBuffer: async () => bytes ?? new Uint8Array(0),
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

  it('QR и ссылка на эксплорер появляются вместе с адресом', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);
    const { window, calls } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/address.json')) {
        return {
          status: 200,
          body: {
            ok: true, address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', index: 1, created: true,
            network: 'mainnet', chain: 'bsc', networkLabel: 'BNB Smart Chain (BEP-20)', asset: 'USDT',
            contract: '0x55d398326f99059ff775485246999027b3197955', decimals: 18, confirmations: 15,
            explorer: { name: 'BscScan', addressUrl: 'https://bscscan.com/address/0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' },
          },
        };
      }
      if (url.endsWith('/pay/qr')) return { status: 200, body: null, bytes: png };
      if (url.endsWith('/pay/account.json')) return { status: 200, body: { ok: true, balanceMicro: 0, history: [], entitlements: [] } };
      return { status: 404, body: { error: 'not_found' } };
    }, 'ru');
    await tick();
    const box = window.document.querySelector('[data-pay="qr-box"]')!;
    const img = window.document.querySelector('[data-pay="qr"]') as HTMLImageElement;
    expect(box.hasAttribute('hidden')).toBe(false);
    // Картинка встраивается data:-ссылкой: маршрут закрыт Bearer-токеном, а `<img>`
    // заголовок Authorization не отправляет.
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    const decoded = Buffer.from((img.getAttribute('src') ?? '').split(',')[1]!, 'base64');
    expect([...decoded]).toEqual([...png]);
    expect(img.getAttribute('alt')).toContain('QR');
    const link = window.document.querySelector('[data-pay="explorer"]')!;
    expect(link.getAttribute('href')).toBe('https://bscscan.com/address/0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
    expect(link.textContent).toContain('BscScan');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(calls.some((u) => u.endsWith('/pay/qr'))).toBe(true);
  });

  it('QR не открылся — адрес на экране, блока с картинкой нет', async () => {
    const { window } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/address.json')) {
        return { status: 200, body: { ok: true, address: 'TXyz1', decimals: 6, explorer: { name: 'Tronscan', addressUrl: 'https://tronscan.org/#/address/TXyz1' } } };
      }
      if (url.endsWith('/pay/qr')) return { status: 500, body: { error: 'boom' }, text: '' };
      if (url.endsWith('/pay/account.json')) return { status: 200, body: { ok: true, balanceMicro: 0, history: [], entitlements: [] } };
      return { status: 404, body: { error: 'not_found' } };
    }, 'ru');
    await tick();
    expect(window.document.querySelector('[data-pay="address"]')?.textContent).toBe('TXyz1');
    expect(window.document.querySelector('[data-pay="qr-box"]')?.hasAttribute('hidden')).toBe(true);
    // Ссылка на эксплорер — не часть картинки: она остаётся.
    expect(window.document.querySelector('[data-pay="explorer"]')?.hasAttribute('hidden')).toBe(false);
  });

  it('перевод в истории получает ссылку на сеть, остальные строки — нет', async () => {
    const txid = 'cd'.repeat(32);
    const { window } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/account.json')) {
        return {
          status: 200,
          body: {
            ok: true, balanceMicro: 1000000, balance: '1.000000', purchasesEnabled: true,
            entitlements: [],
            history: [
              { delta: 1000000, reason: 'deposit', ref: `dep:${txid}:0`, amount: '1.000000', createdAt: 1, txUrl: `https://tronscan.org/#/transaction/${txid}` },
              { delta: -5000000, reason: 'purchase', ref: 'buy:1', amount: '-5.000000', createdAt: 2 },
            ],
          },
        };
      }
      return { status: 404, body: { error: 'not_found' } };
    }, 'ru');
    await tick();
    const links = Array.from(window.document.querySelectorAll('[data-pay="history"] a'));
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe(`https://tronscan.org/#/transaction/${txid}`);
    expect(links[0]!.textContent).toBe('перевод');
  });

  it('сеть берётся с сервера, а не из текста страницы', async () => {
    const { window } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/address.json')) {
        return {
          status: 200,
          body: {
            ok: true, address: '0x2222222222222222222222222222222222222222', index: 3,
            created: true, network: 'mainnet', chain: 'bsc', networkLabel: 'BNB Smart Chain (BEP-20)',
            asset: 'USDT', contract: '0x55d398326f99059ff775485246999027b3197955',
            decimals: 18, confirmations: 15,
          },
        };
      }
      if (url.endsWith('/pay/account.json')) return { status: 200, body: { ok: true, balanceMicro: 0, history: [], entitlements: [] } };
      return { status: 404, body: { error: 'not_found' } };
    }, 'ru');
    await tick();
    const note = window.document.querySelector('[data-pay="deposit-note"]')?.textContent ?? '';
    // Название сети — с сервера: статичный текст «TRC-20» пережил бы переезд и соврал.
    expect(note).toContain('BNB Smart Chain');
    // И предупреждение про округление появляется только там, где знаки > 6.
    expect(note).toContain('целое число');
    expect(window.document.querySelector('[data-pay="address"]')?.textContent)
      .toBe('0x2222222222222222222222222222222222222222');
  });

  it('на TRON про округление молчим: там хвост не теряется', async () => {
    const { window } = boot((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { access_token: 'tok' } };
      if (url.endsWith('/pay/address.json')) {
        return {
          status: 200,
          body: {
            ok: true, address: 'TXyz111111111111111111111111111111111', index: 1, created: true,
            network: 'mainnet', chain: 'tron', networkLabel: 'TRON (TRC-20)', asset: 'USDT',
            contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6, confirmations: 20,
          },
        };
      }
      if (url.endsWith('/pay/account.json')) return { status: 200, body: { ok: true, balanceMicro: 0, history: [], entitlements: [] } };
      return { status: 404, body: { error: 'not_found' } };
    }, 'ru');
    await tick();
    const note = window.document.querySelector('[data-pay="deposit-note"]')?.textContent ?? '';
    expect(note).toContain('TRON (TRC-20)');
    expect(note).not.toContain('дробная часть');
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
