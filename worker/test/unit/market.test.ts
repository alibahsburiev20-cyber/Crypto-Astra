import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { RESOURCE_BASE_PRICES, marketTax } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { addResource, getResource } from '../../src/world/modules/maintenance';
import { buyLot, cancelLot, createLot, MARKET_BAND_MAX_SALES, marketView, priceBand } from '../../src/world/modules/market';
import { MARKET_FLAG_MAX, MARKET_FLAG_TTL_MS, pruneMarketFlags, runIdemCleanup } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

type World = ReturnType<typeof makeWorld>;

function world(): World {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  w.tx(() => createPlayer(w.sql, 'p2', T0));
  return w;
}

function fund(w: World, playerId: string, astra: number) {
  w.tx(() => applyDelta(w.sql, { playerId, asset: 'astra', delta: astra, reason: 'claim' }, T0 + 1));
}

function sell(w: World, amount: number, unitPrice: number, key = 'lot-1', resource = 'iron_ore') {
  w.tx(() => addResource(w.sql, 'p1', resource, amount, T0 + 2));
  return w.tx(() => createLot(w.sql, 'p1', key, { resource, amount, unitPrice }, T0 + 3));
}

describe('рынок (срез 6 этапа 2)', () => {
  it('выставление лота уводит ресурс в эскроу и пишет журнал', () => {
    const w = world();
    const { sql, tx } = w;
    const res = sell(w, 10, 5);
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(0);
    const reasons = sql.exec('SELECT reason FROM ledger').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('market_escrow');
    expect(verifyLedger(sql).ok).toBe(true);
    const view = marketView(sql, 'p2', T0 + 4);
    expect(view.lots.length).toBe(1);
    expect(view.lots[0].total).toBe(50);
    expect(view.lots[0].mine).toBe(false);
    expect(view.mine).toBe(0);
    expect(res.lot.amount).toBe(10);
  });

  it('покупка: покупатель платит и получает ресурс, продавец получает выручку и платит налог', () => {
    const w = world();
    const { sql, tx } = w;
    const { lot } = sell(w, 10, 5);
    fund(w, 'p2', 1000);
    const astraBefore = getBalance(sql, 'p1', 'astra');
    const buyerBefore = getBalance(sql, 'p2', 'astra');
    expect(buyerBefore).toBe(1500);

    const sale = tx(() => buyLot(sql, 'p2', 'buy-1', lot.id, T0 + 10));

    expect(sale.gross).toBe(50);
    expect(sale.tax).toBe(marketTax(50));
    expect(getBalance(sql, 'p2', 'astra')).toBe(buyerBefore - 50);
    expect(getResource(sql, 'p2', 'iron_ore')).toBe(10);
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore + 50 - marketTax(50));

    const reasons = sql.exec('SELECT reason FROM ledger').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('market_buy');
    expect(reasons).toContain('market_sale');
    expect(reasons).toContain('market_tax');
    expect(verifyLedger(sql).ok).toBe(true);

    // Лот закрыт: второй покупатель его уже не возьмёт.
    fund(w, 'p2', 1000);
    expect(() => tx(() => buyLot(sql, 'p2', 'buy-2', lot.id, T0 + 11))).toThrow(/lot_closed/);
  });

  it('свой лот купить нельзя', () => {
    const w = world();
    const { sql, tx } = w;
    const { lot } = sell(w, 5, 5);
    fund(w, 'p1', 1000);
    expect(() => tx(() => buyLot(sql, 'p1', 'buy-1', lot.id, T0 + 10))).toThrow(/own_lot/);
  });

  it('без ASTRA покупка не проходит и лот остаётся открытым', () => {
    const w = world();
    const { sql, tx } = w;
    // 1000 единиц по 5 = 5000 ASTRA, а у второго игрока только стартовые 500.
    const { lot } = sell(w, 1000, 5);
    expect(() => tx(() => buyLot(sql, 'p2', 'buy-1', lot.id, T0 + 10))).toThrow(/insufficient_funds/);
    expect(marketView(sql, 'p2', T0 + 11).lots.length).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('цена вне коридора не принимается', () => {
    const w = world();
    const { sql, tx } = w;
    // База железа 4 → коридор 2..6.
    expect(priceBand(sql, 'iron_ore', T0).min).toBe(2);
    expect(priceBand(sql, 'iron_ore', T0).max).toBe(6);
    expect(() => sell(w, 5, 100)).toThrow(/price_out_of_band/);
    expect(() => sell(w, 5, 1)).toThrow(/price_out_of_band/);
  });

  it('коридор считается от медианы сделок за неделю', () => {
    const w = world();
    const { sql, tx } = w;
    const { lot } = sell(w, 1, 6);
    fund(w, 'p2', 1000);
    tx(() => buyLot(sql, 'p2', 'buy-1', lot.id, T0 + 10));
    const band = priceBand(sql, 'iron_ore', T0 + 11);
    expect(band.sales).toBe(1);
    expect(band.median).toBe(6);
    expect(band.min).toBe(3);
    expect(band.max).toBe(9);
    // Через 8 дней сделка выпадает из окна — снова базовая цена.
    expect(priceBand(sql, 'iron_ore', T0 + 10 + 8 * DAY_MS).median).toBe(RESOURCE_BASE_PRICES.iron_ore);
  });

  it('отмена возвращает ресурс из эскроу', () => {
    const w = world();
    const { sql, tx } = w;
    const { lot } = sell(w, 7, 5);
    tx(() => cancelLot(sql, 'p1', 'cancel-1', lot.id, T0 + 10));
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(7);
    expect(marketView(sql, 'p1', T0 + 11).lots.length).toBe(0);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('чужой лот отменить нельзя, закрытый — тоже', () => {
    const w = world();
    const { sql, tx } = w;
    const { lot } = sell(w, 7, 5);
    expect(() => tx(() => cancelLot(sql, 'p2', 'cancel-1', lot.id, T0 + 10))).toThrow(/not_your_lot/);
    fund(w, 'p2', 1000);
    tx(() => buyLot(sql, 'p2', 'buy-1', lot.id, T0 + 11));
    expect(() => tx(() => cancelLot(sql, 'p1', 'cancel-2', lot.id, T0 + 12))).toThrow(/lot_closed/);
  });

  it('лимит лотов на игрока держится', () => {
    const w = world();
    const { sql, tx } = w;
    tx(() => addResource(sql, 'p1', 'iron_ore', 20, T0 + 2));
    for (let i = 0; i < 10; i++) {
      tx(() => createLot(sql, 'p1', `lot-${i}`, { resource: 'iron_ore', amount: 1, unitPrice: 5 }, T0 + 10 + i));
    }
    expect(() => tx(() => createLot(sql, 'p1', 'lot-11', { resource: 'iron_ore', amount: 1, unitPrice: 5 }, T0 + 30)))
      .toThrow(/market_lot_limit/);
  });

  it('повтор с тем же ключом не списывает дважды', () => {
    const w = world();
    const { sql, tx } = w;
    const first = tx(() => {
      addResource(sql, 'p1', 'iron_ore', 4, T0 + 2);
      return createLot(sql, 'p1', 'same', { resource: 'iron_ore', amount: 4, unitPrice: 5 }, T0 + 3);
    });
    const second = tx(() => createLot(sql, 'p1', 'same', { resource: 'iron_ore', amount: 4, unitPrice: 5 }, T0 + 4));
    expect(second.lot.id).toBe(first.lot.id);
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(0);
    expect(marketView(sql, 'p1', T0 + 5).lots.length).toBe(1);
  });

  it('повторяющиеся сделки одной пары попадают во флаги, но проходят', () => {
    const w = world();
    const { sql, tx } = w;
    fund(w, 'p2', 10000);
    for (let i = 0; i < 3; i++) {
      tx(() => addResource(sql, 'p1', 'iron_ore', 1, T0 + 2 + i));
      const { lot } = tx(() => createLot(sql, 'p1', `lot-${i}`, { resource: 'iron_ore', amount: 1, unitPrice: 5 }, T0 + 10 + i));
      tx(() => buyLot(sql, 'p2', `buy-${i}`, lot.id, T0 + 20 + i));
    }
    const flags = sql.exec('SELECT kind FROM market_flags').toArray().map((r) => String(r.kind));
    expect(flags).toContain('repeat_pair');
    expect(verifyLedger(sql).ok).toBe(true);
  });
});

describe('потолок чтения коридора цены', () => {
  // `market_sales` — append-only таблица, которая растёт вместе с оборотом рынка.
  // Без потолка «медиана за 7 дней» читается полностью на каждом открытом экране
  // рынка (по разу на ресурс), и раздуть её можно двумя счётчиками.
  const bulk = (sql: SqlStorage, price: number, at: number, from: number, to: number) => sql.exec(
    `INSERT INTO market_sales (id, lot_id, seller_id, buyer_id, resource, amount, unit_price, gross, tax, at)
     WITH RECURSIVE n(x) AS (SELECT ?1 UNION ALL SELECT x + 1 FROM n WHERE x < ?2)
     SELECT 'S' || x, 'L' || x, 'p1', 'p2', 'iron_ore', 1, ?3, ?3, 0, ?4 FROM n`,
    from, to, price, at,
  );

  it('медиана считается по последним сделкам, а не по всем недели', () => {
    const w = world();
    const { sql, tx } = w;
    tx(() => {
      // Две тысячи старых «дёшево», затем свежие «дорого» — окна разного размера
      // дают разный ответ, и видно, какое именно окно прочитал код.
      bulk(sql, 1, T0 - 2 * DAY_MS, 1, 2000);
      bulk(sql, 900, T0 - DAY_MS, 2001, 4000);
    });
    const band = priceBand(sql, 'iron_ore', T0);
    expect(band.sales).toBe(MARKET_BAND_MAX_SALES);
    // В окне из 2 000 последних строк — только дорогие: дёшевые отрезаны потолком.
    expect(band.median).toBe(900);
    // Без потолка медиана сидела бы между 1 и 900.
    const all = Number(sql.exec('SELECT COUNT(*) AS c FROM market_sales').toArray()[0].c);
    expect(all).toBe(4000);
  });

  it('окно ограничено, поэтому стоимость запроса не зависит от оборота', () => {
    const w = world();
    const { sql, tx } = w;
    tx(() => { bulk(sql, 7, T0 - 2 * DAY_MS, 1, 6000); });
    expect(priceBand(sql, 'iron_ore', T0).sales).toBe(MARKET_BAND_MAX_SALES);
    expect(priceBand(sql, 'iron_ore', T0).median).toBe(7);
  });
});

describe('флаги рынка чистятся', () => {
  it('старые и лишние строки уходят, свежие остаются', () => {
    const w = world();
    const { sql, tx } = w;
    tx(() => {
      // Много свежих — сверх потолка, плюс древние, которые давно протухли.
      sql.exec(
        `INSERT INTO market_flags (id, kind, seller_id, buyer_id, resource, gross, at)
         WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?)
         SELECT 'F' || x, 'large_trade', 'p1', 'p2', 'iron_ore', 99999, ? + x FROM n`,
        MARKET_FLAG_MAX + 40, T0,
      );
      sql.exec(
        `INSERT INTO market_flags (id, kind, seller_id, buyer_id, resource, gross, at)
         WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 20)
         SELECT 'OLD' || x, 'repeat_pair', 'p1', 'p2', 'iron_ore', 500, ? - ? FROM n`,
        T0, MARKET_FLAG_TTL_MS + DAY_MS,
      );
    });
    expect(Number(sql.exec('SELECT COUNT(*) AS c FROM market_flags').toArray()[0].c))
      .toBe(MARKET_FLAG_MAX + 60);
    const left = tx(() => pruneMarketFlags(sql, T0));
    expect(left).toBe(MARKET_FLAG_MAX);
    // Ушли именно древние: «старше TTL» и «сверх потолка» — два разных правила.
    expect(sql.exec(`SELECT COUNT(*) AS c FROM market_flags WHERE id LIKE 'OLD%'`).toArray()[0].c).toBe(0);
    expect(tx(() => pruneMarketFlags(sql, T0 + 1000))).toBe(MARKET_FLAG_MAX);
  });

  it('регулярная чистка мира трогает и флаги', () => {
    const w = world();
    const { sql, tx } = w;
    tx(() => {
      sql.exec(
        `INSERT INTO market_flags (id, kind, seller_id, buyer_id, resource, gross, at) VALUES ('X1', 'large_trade', 'p1', 'p2', 'iron_ore', 1, ?)`,
        T0 - MARKET_FLAG_TTL_MS - DAY_MS,
      );
    });
    tx(() => runIdemCleanup(sql, T0));
    expect(Number(sql.exec('SELECT COUNT(*) AS c FROM market_flags').toArray()[0].c)).toBe(0);
  });
});
