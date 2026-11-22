import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { creditDeposit } from '../../src/pay/ledger';
import {
  catalogForClient, entitlements, findProduct, premiumStatus, purchase,
} from '../../src/pay/shop';
import { hexToBase58 } from '../../src/pay/tron/address';

// Доделки интерфейса: шкала уровня, вкладка бонусов, магазин в главном меню,
// Premium и объяснение скинов. Проверяем не «красиво», а наличие и смысл:
// шкала считается из серверных порогов, магазин доступен из игры, Premium имеет
// срок, а скин не даёт преимуществ.

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const html = read('client/index.html');
const app = read('client/app.js');
const css = read('client/styles.css');
const payHtml = read('client/pay.html');
const payJs = read('client/pay.js');

const T0 = 1_700_000_000_000;
const ALICE = hexToBase58('41' + '11'.repeat(20));

describe('интерфейс: шкала уровня и бонусы', () => {
  it('шкала считается из серверных порогов XP', () => {
    expect(app).toContain('function levelProgress');
    expect(app).toContain('state.xpPrev');
    expect(app).toContain('state.xpNext');
    expect(app).toContain('level-bar-fill');
    expect(app).toContain('осталось');
    // Ширина ставится через CSSOM: инлайн-атрибут style запрещён CSP.
    expect(app).toContain('fill.style.width');
  });

  it('шкала видна на мостике и в разделе «Бонусы»', () => {
    expect(app).toContain('levelBar()');
    expect(app).toContain('levelBar(true)');
    expect(css).toContain('.level-bar-fill');
    expect(css).toContain('.level-widget');
  });

  it('вкладка «Бонусы» есть в меню и в доке', () => {
    expect(html).toContain('data-view="bonus"');
    expect(html).toContain('/icons/nav/bonus.png');
    expect(app).toContain('function renderBonus');
    expect(app).toContain("view === 'bonus' ? renderBonus()");
    expect(app).toContain('data-bonus-timer');
    // Бонус — тот же 15-минутный Claim, без новой валюты.
    expect(app).toContain('+5 ASTRA');
    expect(app).toContain('15 минут');
  });
});

describe('интерфейс: магазин и скины', () => {
  it('магазин стоит в главном меню игры, а не только отдельной страницей', () => {
    expect(html).toContain('href="/pay.html"');
    expect(html).toContain('data-nav="/pay.html"');
    expect(html).toContain('Магазин');
    expect(app).toContain("querySelectorAll('[data-nav]')");
    expect(readFileSync(new URL('client/icons/nav/pay.png', root)).subarray(1, 4).toString()).toBe('PNG');
  });

  it('скины применяются к корпусу и не влияют на игру', () => {
    expect(app).toContain('SKIN_SPRITES');
    expect(app).toContain("'skin:nebula'");
    expect(app).toContain('/sprites/cosmetics/skin_nebula.png');
    expect(app).toContain('внешний вид корпуса');
    expect(payHtml).toContain('На что покупаются скины');
    expect(payHtml).toContain('На скорость, добычу, бой и рейтинг она не влияет');
  });

  it('витрина объясняет Premium и показывает статус', () => {
    expect(payHtml).toContain('Premium');
    expect(payJs).toContain('premium?.active');
    expect(payJs).toContain("data-pay=\"premium\"");
  });
});

describe('Premium в магазине', () => {
  async function freshDb() {
    resetPaySchemaForTests();
    const { db } = makeD1();
    await ensurePaySchema(db);
    return db;
  }

  it('Premium есть в каталоге и продаётся на 30 дней', () => {
    const product = findProduct('premium_30');
    expect(product).toMatchObject({ kind: 'premium', durationDays: 30, enabled: true });
    const catalog = catalogForClient();
    const premium = catalog.find((p) => p.id === 'premium_30');
    expect(premium?.price).toBe('5.00');
    expect(premium?.durationDays).toBe(30);
  });

  it('покупка выдаёт Premium со сроком, статус считается по сроку', async () => {
    const db = await freshDb();
    await creditDeposit(db, {
      txid: 'a'.repeat(64), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 5_000_000,
    }, T0);

    const bought = await purchase(db, { userId: 'u1', productId: 'premium_30', idemKey: 'premium-0001' }, T0);
    expect(bought.duplicated).toBe(false);

    const list = await entitlements(db, 'u1');
    expect(list[0].expiresAt).toBe(T0 + 30 * 86_400_000);

    const now = await premiumStatus(db, 'u1', T0 + 1000);
    expect(now.active).toBe(true);
    expect(now.until).toBe(T0 + 30 * 86_400_000);

    const later = await premiumStatus(db, 'u1', T0 + 31 * 86_400_000);
    expect(later.active).toBe(false);
  });

  it('без Premium статус выключен и срок пустой', async () => {
    const db = await freshDb();
    expect(await premiumStatus(db, 'nobody', T0)).toEqual({ active: false, until: null });
  });

  it('косметика без срока действует бессрочно', async () => {
    const db = await freshDb();
    await creditDeposit(db, {
      txid: 'b'.repeat(64), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 2_000_000,
    }, T0);
    await purchase(db, { userId: 'u1', productId: 'skin_nebula', idemKey: 'order-0001' }, T0);
    const list = await entitlements(db, 'u1');
    expect(list[0]).toMatchObject({ productId: 'skin_nebula', expiresAt: null, cosmetic: 'skin:nebula' });
  });
});
