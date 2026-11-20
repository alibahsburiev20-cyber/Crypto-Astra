import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Витрина Astra Pay. Проверяем не «красоту», а правила: цены и баланс приходят
// с сервера, покупка идёт с ключом идемпотентности, обещаний дохода нет, а
// инлайн-стилей нет, потому что CSP их запрещает.

const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/pay.html', root), 'utf8');
const js = readFileSync(new URL('client/pay.js', root), 'utf8');
const css = readFileSync(new URL('client/pay.css', root), 'utf8');
const pool = readFileSync(new URL('client/pool.html', root), 'utf8');

describe('страница «Astra Pay» (этап 7)', () => {
  it('подключает свои скрипт и стили, без инлайна под CSP', () => {
    expect(html).toContain('/pay.js');
    expect(html).toContain('/pay.css');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('style="');
  });

  it('берёт данные только с сервера и не считает цены сама', () => {
    expect(js).toContain("'/pay/products.json'");
    expect(js).toContain("'/pay/account.json'");
    expect(js).toContain("'/pay/purchase'");
    expect(js).toContain('Idempotency-Key');
    // Никаких собственных прайсов и «скидок» в браузере.
    expect(js).not.toContain('priceMicro =');
    expect(js).not.toContain('2000000');
  });

  it('токен берётся обновлением cookie, а не из localStorage', () => {
    expect(js).toContain("'/auth/refresh'");
    expect(js).not.toContain('localStorage');
    expect(js).toContain("credentials: 'include'");
  });

  it('честно объясняет, что это не инвестиция и выплат нет', () => {
    expect(html).toContain('Это не инвестиция');
    expect(html).toContain('ASTRA — не деньги');
    expect(html).toContain('внутриигровая валюта');
    expect(html).toContain('Автоматические выплаты выключены');
    expect(html).toContain('Повтор не спишет дважды');
  });

  it('витрина и кошелёк имеют стили', () => {
    for (const cls of ['.pay-grid', '.pay-card', '.pay-balance', '.pay-table', '.pay-rules']) {
      expect(css).toContain(cls);
    }
  });

  it('из отчёта пула есть переход в магазин', () => {
    expect(pool).toContain('href="/pay.html"');
  });
});
