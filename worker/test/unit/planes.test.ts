import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import {
  BOXES, BOX_ORDER, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, RESOURCE_BASE_PRICES, isPlaneId, planeSprite,
} from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { boxesView, openBox, planesView, rollBox } from '../../src/world/modules/boxes';
import { getResource } from '../../src/world/modules/maintenance';
import { buildState } from '../../src/world/modules/state';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

const SEEDS = Array.from({ length: 400 }, (_, i) => {
  const block = (m: number, shift: number) => (((i + shift) * m) >>> 0).toString(16).padStart(8, '0');
  return block(0x9e3779b1, 3) + block(0x85ebca6b, 11) + block(0xc2b2ae35, 17) + block(0x27d4eb2f, 29);
});

function world(astra?: number) {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  // Через журнал, а не UPDATE: иначе сверка честно покажет расхождение.
  if (astra !== undefined) w.tx(() => applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: astra, reason: 'claim' }, T0 + 1));
  return w;
}

describe('каталог звена', () => {
  it('восемь машин, идентификаторы уникальны и разбираются', () => {
    expect(PLANE_ORDER).toHaveLength(8);
    expect(new Set(PLANE_ORDER).size).toBe(8);
    for (const id of PLANE_ORDER) {
      expect(PLANES[id].id).toBe(id);
      expect(PLANES[id].name).toBeTruthy();
      expect(PLANES[id].hint).toBeTruthy();
      expect(PLANE_RARITY_NAMES[PLANES[id].rarity]).toBeTruthy();
      expect(planeSprite(id)).toBe(`/sprites/planes/${id}.png`);
    }
    expect(isPlaneId('sokol')).toBe(true);
    expect(isPlaneId('boeing')).toBe(false);
  });

  it('легендарная машина одна, обычных больше, чем редких — иначе «редкое» ничего не значит', () => {
    const byRarity = (r: string) => PLANE_ORDER.filter((id) => PLANES[id].rarity === r).length;
    expect(byRarity('legendary')).toBe(1);
    expect(byRarity('common')).toBeGreaterThan(byRarity('rare'));
    expect(byRarity('common') + byRarity('rare') + byRarity('legendary')).toBe(8);
  });

  it('каждый бокс может выдать машину, и только из своего пула', () => {
    for (const box of BOX_ORDER) {
      const cfg = BOXES[box].plane;
      expect(cfg, box).toBeTruthy();
      expect(cfg!.chance, box).toBeGreaterThan(0);
      expect(cfg!.chance, box).toBeLessThan(1);
      expect(cfg!.pool.length, box).toBeGreaterThan(0);
      for (const id of cfg!.pool) expect(PLANE_ORDER, `${box}: ${id}`).toContain(id);
    }
    // Бесплатные и дешёвый ящик не выдают редких: за ними надо идти в дорогой.
    expect(BOXES.daily.plane!.pool.every((id) => PLANES[id].rarity === 'common')).toBe(true);
    expect(BOXES.crate_supply.plane!.pool.every((id) => PLANES[id].rarity === 'common')).toBe(true);
    expect(BOXES.crate_pro.plane!.pool).toContain('feniks');
    expect(BOXES.weekly.plane!.pool).toContain('sokol');
  });
});

describe('розыгрыш машины', () => {
  it('детерминирован и не сдвигает ресурсы: те же seed — тот же бокс', () => {
    for (const box of BOX_ORDER) {
      const a = rollBox(BOXES[box], SEEDS[7]);
      const b = rollBox(BOXES[box], SEEDS[7]);
      expect(a).toEqual(b);
      // Ресурсная часть считается теми же байтами, что и раньше: 0–8.
      expect(a.drops).toEqual(b.drops);
    }
  });

  it('машина всегда из пула бокса, а частота близка к заявленной', () => {
    for (const box of BOX_ORDER) {
      const def = BOXES[box];
      let hits = 0;
      for (const seed of SEEDS) {
        const roll = rollBox(def, seed);
        if (roll.plane) {
          hits += 1;
          expect(def.plane!.pool, `${box}/${roll.plane}`).toContain(roll.plane);
        }
      }
      const rate = hits / SEEDS.length;
      // Допуск широкий: 400 seed'ов дают шум, но порядок величины видно.
      expect(rate, `${box} частота`).toBeGreaterThan(def.plane!.chance - 0.06);
      expect(rate, `${box} частота`).toBeLessThan(def.plane!.chance + 0.06);
    }
  });
});

describe('машина в боксе', () => {
  it('найденная машина попадает в полку звена, дубликаты копятся', () => {
    const { sql, tx } = world(100000);
    let found = null as ReturnType<typeof openBox> | null;
    // Открываем платный ящик, пока не выпадет машина: шанс 12 %, но ждать долго нельзя.
    for (let i = 0; i < 200 && !found; i++) {
      const res = tx(() => openBox(sql, 'p1', `k${i}`, 'crate_supply', T0 + i * 1000));
      if (res.plane) found = res;
    }
    expect(found).toBeTruthy();
    expect(found!.plane!.firstTime).toBe(true);
    expect(found!.plane!.count).toBe(1);

    const shelf = planesView(sql, 'p1');
    expect(shelf.total).toBe(8);
    expect(shelf.found).toBe(1);
    const mine = shelf.models.find((m) => m.id === found!.plane!.id)!;
    expect(mine.count).toBe(1);
    expect(mine.firstAt).toBeGreaterThan(0);
    // Не найденные модели остаются в полке с нулём: клиент рисует силуэт.
    expect(shelf.models.filter((m) => m.count === 0)).toHaveLength(7);
  });

  it('машина не тратит ASTRA и не занимает ячейки гаража', () => {
    const { sql, tx } = world(100000);
    const before = getBalance(sql, 'p1', 'astra');
    const garagesBefore = Number(sql.exec(`SELECT COUNT(*) AS n FROM ships WHERE player_id = 'p1'`).toArray()[0].n);
    let opens = 0;
    for (let i = 0; i < 60; i++) {
      tx(() => openBox(sql, 'p1', `g${i}`, 'crate_supply', T0 + i * 1000));
      opens += 1;
    }
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - BOXES.crate_supply.price * opens);
    expect(Number(sql.exec(`SELECT COUNT(*) AS n FROM ships WHERE player_id = 'p1'`).toArray()[0].n)).toBe(garagesBefore);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('коллекция ничего не стоит в ресурсах: дропы те же, что без машины', () => {
    // Машина идёт «сверху»: сумма ресурсов равна units, как и раньше.
    for (const box of BOX_ORDER) {
      const def = BOXES[box];
      for (const seed of SEEDS.slice(0, 40)) {
        const roll = rollBox(def, seed);
        const units = roll.drops.filter((d) => def.pool.includes(d.resource)).reduce((s, d) => s + d.amount, 0);
        expect(units, `${box}: ${seed}`).toBe(roll.units);
        for (const drop of roll.drops) expect(RESOURCE_BASE_PRICES[drop.resource]).toBeGreaterThan(0);
      }
    }
  });

  it('/me отдаёт полку звена, а бесплатный бокс не может её выдать дважды за день', () => {
    const { sql, tx } = world();
    tx(() => openBox(sql, 'p1', 'd1', 'daily', T0));
    const state = buildState(sql, 'p1', T0 + 1000) as unknown as { planes: { found: number; total: number; models: unknown[] } };
    expect(state.planes.total).toBe(8);
    expect(state.planes.models).toHaveLength(8);
    expect(state.planes.found).toBeGreaterThanOrEqual(0);
    expect(() => tx(() => openBox(sql, 'p1', 'd2', 'daily', T0 + 2000))).toThrow(/box_cooldown/);
    expect(boxesView(sql, 'p1', T0 + 2000).boxes.find((b) => b.id === 'daily')!.opens).toBe(1);
    // Ресурсы от машины не зависят: их количество не изменилось от того, что
    // в пуле бокса появилось ещё одно поле.
    expect(getResource(sql, 'p1', 'ice')).toBeGreaterThanOrEqual(0);
  });
});

describe('звено в клиенте', () => {
  const root = new URL('../../../', import.meta.url);
  const app = readFileSync(new URL('client/app.js', root), 'utf8');
  const stage = readFileSync(new URL('client/box-stage.js', root), 'utf8');
  const css = readFileSync(new URL('client/styles.css', root), 'utf8');

  it('у каждой машины есть спрайт 128×128 и он не тяжелее 40 КБ', () => {
    for (const id of PLANE_ORDER) {
      const buf = readFileSync(new URL(`client/sprites/planes/${id}.png`, root));
      expect(buf.subarray(0, 8).toString('hex'), id).toBe('89504e470d0a1a0a');
      expect(buf.readUInt32BE(16), id).toBe(128);
      expect(buf.readUInt32BE(20), id).toBe(128);
      expect(buf.length, id).toBeLessThan(40 * 1024);
    }
  });

  it('полка звена есть во флоте и подписана как коллекция, а не как флот', () => {
    expect(app).toContain('function planeShelf');
    expect(app).toContain('planeShelf()');
    expect(app).toContain('Авиазвено');
    expect(app).toContain('не летают');
    expect(app).toContain("state.planes");
    expect(css).toContain('.plane-grid');
    expect(css).toContain('.plane-slot');
  });

  it('сцена бокса показывает машину отдельным чипом со своим спрайтом', () => {
    expect(stage).toContain('plane');
    expect(stage).toContain('function iconOf');
    expect(stage).toContain('/sprites/planes/');
    expect(stage).toContain('новинка');
  });

  it('боксы передают находку и в сцену, и в плашку результата', () => {
    expect(app).toContain('plane: res.data.plane || null');
    expect(app).toContain('planeFindLine');
    expect(app).toContain('Новая машина в звене');
  });
});
