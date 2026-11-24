import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { BOXES, BOX_COMPONENTS, BOX_ORDER, RESOURCE_BASE_PRICES, isBoxId } from '../../src/shared/gameData';
import { getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { boxesHistory, boxesView, openBox, rollBox } from '../../src/world/modules/boxes';
import { getResource } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;
// 300 разных hex-seed'ов по 16 байт: именно такими их выдаёт сервер
// (`crypto.randomUUID()` без дефисов).
const SEEDS = Array.from({ length: 300 }, (_, i) => {
  const block = (m: number, shift: number) => (((i + shift) * m) >>> 0).toString(16).padStart(8, '0');
  return block(0x9e3779b1, 1) + block(0x85ebca6b, 7) + block(0xc2b2ae35, 13) + block(0x27d4eb2f, 21);
});

function world(astra?: number) {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  if (astra !== undefined) {
    w.sql.exec(`UPDATE balances SET amount = ? WHERE player_id = 'p1' AND asset = 'astra'`, astra);
  }
  return w;
}

function value(drops: { resource: string; amount: number }[]): number {
  return drops.reduce((sum, d) => sum + (RESOURCE_BASE_PRICES[d.resource] ?? 0) * d.amount, 0);
}

describe('каталог боксов', () => {
  it('четыре бокса: два по таймеру и два платных', () => {
    expect(BOX_ORDER).toEqual(['daily', 'weekly', 'crate_supply', 'crate_pro']);
    const free = BOX_ORDER.filter((id) => BOXES[id].price === 0);
    const paid = BOX_ORDER.filter((id) => BOXES[id].price > 0);
    expect(free).toEqual(['daily', 'weekly']);
    expect(paid).toEqual(['crate_supply', 'crate_pro']);
    expect(isBoxId('daily')).toBe(true);
    expect(isBoxId('ghost')).toBe(false);
  });

  it('у бесплатных есть таймер, у платных — цена', () => {
    expect(BOXES.daily.cooldownMs).toBe(DAY_MS);
    expect(BOXES.weekly.cooldownMs).toBe(7 * DAY_MS);
    expect(BOXES.crate_supply.cooldownMs).toBe(0);
    expect(BOXES.crate_pro.price).toBeGreaterThan(BOXES.crate_supply.price);
  });

  it('в пулах только ресурсы, которые существуют в игре', () => {
    for (const id of BOX_ORDER) {
      for (const resource of BOXES[id].pool) {
        expect(RESOURCE_BASE_PRICES[resource], `${id}: ${resource}`).toBeGreaterThan(0);
      }
      const rare = BOXES[id].rare?.resource;
      if (rare) expect(RESOURCE_BASE_PRICES[rare]).toBeGreaterThan(0);
    }
  });
});

describe('розыгрыш (rollBox)', () => {
  it('детерминирован: тот же seed — те же дропы', () => {
    for (const id of BOX_ORDER) {
      const a = rollBox(BOXES[id], 'abcdef0123456789abcdef0123456789');
      const b = rollBox(BOXES[id], 'abcdef0123456789abcdef0123456789');
      expect(a).toEqual(b);
    }
  });

  it('единиц всегда в границах бокса, дропы — только из пула и компонентов', () => {
    for (const id of BOX_ORDER) {
      const def = BOXES[id];
      for (const seed of SEEDS) {
        const roll = rollBox(def, seed);
        expect(roll.units).toBeGreaterThanOrEqual(def.units[0]);
        expect(roll.units).toBeLessThanOrEqual(def.units[1]);
        const allowed = new Set([...def.pool, ...BOX_COMPONENTS, def.rare?.resource ?? '']);
        for (const drop of roll.drops) {
          expect(allowed.has(drop.resource), `${id}/${drop.resource}`).toBe(true);
          expect(drop.amount).toBeGreaterThan(0);
        }
        // Ресурсов ровно столько, сколько «единиц»: компоненты и редкое идут сверху.
        const units = roll.drops.filter((d) => def.pool.includes(d.resource)).reduce((s, d) => s + d.amount, 0);
        expect(units).toBe(roll.units);
      }
    }
  });

  it('платный бокс в среднем дешевле своей цены — иначе это печатный станок', () => {
    for (const id of BOX_ORDER.filter((b) => BOXES[b].price > 0)) {
      const def = BOXES[id];
      const values = SEEDS.map((seed) => value(rollBox(def, seed).drops));
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      // Средняя выдача — не больше 60 % цены: скупка боксов и перепродажа
      // ресурсов на рынке (налог 5 %) заведомо убыточна.
      expect(avg / def.price, `${id} средняя`).toBeLessThan(0.6);
      // И прибыльных исходов мало: «повезло» — лотерея, а не стратегия.
      const profitable = values.filter((v) => v * 0.95 > def.price).length / values.length;
      expect(profitable, `${id} доля прибыльных`).toBeLessThan(0.08);
    }
  });

  it('эталонный seed не меняется: сохранённые открытия должны воспроизводиться', () => {
    // Если кто-то тронет порядок байтов, этот тест покажет расхождение.
    const roll = rollBox(BOXES.daily, 'fedcba9876543210fedcba9876543210');
    expect(roll).toMatchInlineSnapshot(`
      {
        "components": 0,
        "drops": [
          {
            "amount": 4,
            "name": "Лёд",
            "resource": "ice",
          },
          {
            "amount": 1,
            "name": "Кремний",
            "resource": "silicon",
          },
        ],
        "plane": null,
        "rare": false,
        "units": 5,
      }
    `);
  });
});

describe('бесплатные боксы', () => {
  it('дневной открывается, ресурсы и журнал на месте', () => {
    const { sql, tx } = world();
    const res = tx(() => openBox(sql, 'p1', 'k1', 'daily', T0 + 1000));
    expect(res.box).toBe('daily');
    expect(res.units).toBeGreaterThanOrEqual(3);
    const resources = sql.exec('SELECT resource, amount FROM resources WHERE player_id = ?', 'p1').toArray();
    expect(resources.length).toBeGreaterThan(0);
    const total = resources.reduce((s, r) => s + Number(r.amount), 0);
    expect(total).toBeGreaterThanOrEqual(res.units);
    const reasons = sql.exec('SELECT reason FROM ledger WHERE player_id = ?', 'p1').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('box_open');
    expect(verifyLedger(sql).ok).toBe(true);
    expect(boxesHistory(sql, 'p1').length).toBe(1);
  });

  it('повтор сразу — таймер, а не второй бокс', () => {
    const { sql, tx } = world();
    tx(() => openBox(sql, 'p1', 'k1', 'daily', T0 + 1000));
    const before = sql.exec('SELECT COUNT(*) AS c FROM box_opens').toArray()[0].c;
    expect(() => tx(() => openBox(sql, 'p1', 'k2', 'daily', T0 + 2000))).toThrow(/box_cooldown/);
    expect(Number(sql.exec('SELECT COUNT(*) AS c FROM box_opens').toArray()[0].c)).toBe(Number(before));
  });

  it('через сутки дневной снова готов, недельный — только через неделю', () => {
    const { sql, tx } = world();
    tx(() => openBox(sql, 'p1', 'k1', 'daily', T0));
    tx(() => openBox(sql, 'p1', 'k2', 'weekly', T0));
    expect(() => tx(() => openBox(sql, 'p1', 'k3', 'daily', T0 + DAY_MS - 1))).toThrow(/box_cooldown/);
    expect(() => tx(() => openBox(sql, 'p1', 'k4', 'daily', T0 + DAY_MS))).not.toThrow();
    expect(() => tx(() => openBox(sql, 'p1', 'k5', 'weekly', T0 + 6 * DAY_MS))).toThrow(/box_cooldown/);
    expect(() => tx(() => openBox(sql, 'p1', 'k6', 'weekly', T0 + 7 * DAY_MS))).not.toThrow();

    const daily = boxesView(sql, 'p1', T0 + DAY_MS + 1).boxes.find((b) => b.id === 'daily');
    expect(daily?.ready).toBe(false);
    expect(daily?.nextOpenAt).toBe(T0 + 2 * DAY_MS);
  });

  it('бесплатный бокс не списывает ASTRA', () => {
    const { sql, tx } = world();
    const before = getBalance(sql, 'p1', 'astra');
    tx(() => openBox(sql, 'p1', 'k1', 'daily', T0));
    expect(getBalance(sql, 'p1', 'astra')).toBe(before);
  });
});

describe('платные боксы', () => {
  it('списывают ровно цену и выдают ресурсы', () => {
    const { sql, tx } = world();
    const before = getBalance(sql, 'p1', 'astra');
    const res = tx(() => openBox(sql, 'p1', 'k1', 'crate_supply', T0));
    expect(res.price).toBe(BOXES.crate_supply.price);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - BOXES.crate_supply.price);
    expect(getResource(sql, 'p1', 'iron_ore')).toBeGreaterThanOrEqual(0);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('без ASTRA не открывается и ничего не выдаёт', () => {
    const { sql, tx } = world(10);
    expect(() => tx(() => openBox(sql, 'p1', 'k1', 'crate_pro', T0))).toThrow(/insufficient_funds/);
    const total = sql.exec('SELECT COALESCE(SUM(amount), 0) AS s FROM resources').toArray()[0].s;
    expect(Number(total)).toBe(0);
    expect(sql.exec('SELECT COUNT(*) AS c FROM box_opens').toArray()[0].c).toBe(0);
  });

  it('повтор с тем же ключом идемпотентности не списывает второй раз', () => {
    const { sql, tx } = world();
    const before = getBalance(sql, 'p1', 'astra');
    const a = tx(() => openBox(sql, 'p1', 'same', 'crate_supply', T0));
    const b = tx(() => openBox(sql, 'p1', 'same', 'crate_supply', T0 + 10));
    expect(b).toEqual(a);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - BOXES.crate_supply.price);
    expect(sql.exec('SELECT COUNT(*) AS c FROM box_opens').toArray()[0].c).toBe(1);
  });

  it('платные можно открывать подряд: таймера у них нет', () => {
    const { sql, tx } = world(5000);
    tx(() => openBox(sql, 'p1', 'k1', 'crate_supply', T0));
    expect(() => tx(() => openBox(sql, 'p1', 'k2', 'crate_supply', T0 + 1))).not.toThrow();
  });

  it('неизвестный бокс — 400, а не списание', () => {
    const { sql, tx } = world();
    const before = getBalance(sql, 'p1', 'astra');
    expect(() => tx(() => openBox(sql, 'p1', 'k1', 'golden', T0))).toThrow(/bad_box/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before);
  });

  it('замороженный мир не открывает боксы', () => {
    const { sql, tx } = world(5000);
    tx(() => sql.exec(`INSERT INTO meta (key, value) VALUES ('frozen', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`));
    expect(() => tx(() => openBox(sql, 'p1', 'k1', 'daily', T0))).toThrow(/world_frozen/);
  });
});
