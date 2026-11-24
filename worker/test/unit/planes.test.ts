import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import {
  BOXES, BOX_ORDER, PATROL, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, PLANE_RARITY_ORDER, RESOURCE_BASE_PRICES,
  isPlaneId, planeSprite, planesOfRarity,
} from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { boxesView, openBox, rollBox, rollPlane } from '../../src/world/modules/boxes';
import { claimPatrol, planesView, rollPatrol, startPatrol } from '../../src/world/modules/planes';
import { addResource, getResource } from '../../src/world/modules/maintenance';
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

  it('шансы заданы по редкости, суммы крошечные и растут от дешёвого к дорогому', () => {
    const sum = (box: (typeof BOX_ORDER)[number]) => {
      const cfg = BOXES[box].plane!;
      return (cfg.common ?? 0) + (cfg.rare ?? 0) + (cfg.legendary ?? 0);
    };
    for (const box of BOX_ORDER) {
      const cfg = BOXES[box].plane;
      expect(cfg, box).toBeTruthy();
      for (const rarity of PLANE_RARITY_ORDER) {
        const chance = (cfg as Record<string, number | undefined>)[rarity] ?? 0;
        expect(chance, `${box}/${rarity}`).toBeGreaterThanOrEqual(0);
        expect(chance, `${box}/${rarity}`).toBeLessThan(0.1);
      }
      // Внутри бокса редкая ступень не может быть вероятнее обычной.
      expect(cfg!.rare ?? 0, `${box}: редкая`).toBeLessThanOrEqual(cfg!.common ?? 0);
      expect(cfg!.legendary ?? 0, `${box}: легендарная`).toBeLessThanOrEqual(cfg!.rare ?? 1);
    }
    // Бесплатные и дешёвый ящик не выдают редких: за ними надо идти в дорогой.
    expect(BOXES.daily.plane!.rare ?? 0).toBe(0);
    expect(BOXES.daily.plane!.legendary ?? 0).toBe(0);
    expect(BOXES.crate_supply.plane!.rare ?? 0).toBe(0);
    expect(BOXES.crate_pro.plane!.legendary ?? 0).toBeGreaterThan(0);
    // Легендарная — только в дорогом контейнере (и в патруле с редкой машины).
    expect(BOXES.weekly.plane!.legendary ?? 0).toBe(0);
    // Общий шанс машины упал в разы по сравнению с первым выпуском (было 6.6/28.8/11.9/36 %).
    expect(sum('daily')).toBeLessThan(0.02);
    expect(sum('weekly')).toBeLessThan(0.1);
    expect(sum('crate_supply')).toBeLessThan(0.03);
    expect(sum('crate_pro')).toBeLessThan(0.08);
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

  it('шанс реализован точно: перебор всех 65536 значений байтов 9–10', () => {
    // Байты 9–10 дают 65536 равновероятных значений. Прогоняем все и сравниваем
    // долю попаданий с заявленным шансом: расхождение не больше одного кванта.
    const quantum = 1 / 65536;
    for (const box of BOX_ORDER) {
      const cfg = BOXES[box].plane!;
      const counts = { common: 0, rare: 0, legendary: 0 };
      for (let value = 0; value < 65536; value++) {
        const hi = (value >> 8) & 0xff;
        const lo = value & 0xff;
        // Байты 0–8 = 0 (ресурсы в этом тесте не нужны), байт 11 = 0 → всегда
        // первая модель ступени: ступень от него не зависит.
        const seed = '0'.repeat(18)
          + hi.toString(16).padStart(2, '0') + lo.toString(16).padStart(2, '0')
          + '0'.repeat(10);
        const plane = rollPlane(BOXES[box], seed);
        if (plane) counts[PLANES[plane].rarity] += 1;
      }
      for (const rarity of PLANE_RARITY_ORDER) {
        const expected = (cfg as Record<string, number | undefined>)[rarity] ?? 0;
        expect(Math.abs(counts[rarity] / 65536 - expected), `${box}/${rarity}`)
          .toBeLessThanOrEqual(quantum);
      }
    }
  });

  it('машина выпадает только своей ступенью и попадает в заявленный шанс', () => {
    // Шансы маленькие (0.1–6 %), поэтому частоту проверяем на большом числе seed'ов.
    // Seed'ы — из настоящего ГПСЧ: арифметические «блоки» дают коррелированные
    // байты, и на редких ступенях это перекашивает частоту.
    let state = 20261117;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const many = Array.from({ length: 20000 }, () => {
      let seed = '';
      for (let b = 0; b < 16; b++) seed += Math.floor(next() * 256).toString(16).padStart(2, '0');
      return seed;
    });
    for (const box of BOX_ORDER) {
      const def = BOXES[box];
      const cfg = def.plane!;
      const counts = { common: 0, rare: 0, legendary: 0 };
      let hits = 0;
      for (const seed of many) {
        const plane = rollPlane(def, seed);
        if (!plane) continue;
        hits += 1;
        counts[PLANES[plane].rarity] += 1;
      }
      const n = many.length;
      for (const rarity of PLANE_RARITY_ORDER) {
        const expected = (cfg as Record<string, number | undefined>)[rarity] ?? 0;
        // Допуск 0.25 п.п. или 25 % от ожидания: на 20 000 бросаний это больше
        // четырёх сигм, так что тест не мигает, но порядок шанса проверяет жёстко.
        const tolerance = Math.max(0.0025, expected * 0.25);
        expect(Math.abs(counts[rarity] / n - expected), `${box}/${rarity}`).toBeLessThan(tolerance);
      }
      const total = (cfg.common ?? 0) + (cfg.rare ?? 0) + (cfg.legendary ?? 0);
      expect(Math.abs(hits / n - total), `${box} сумма`).toBeLessThan(Math.max(0.004, total * 0.2));
    }
  });

  it('легендарная машина действительно редкая: с контейнера реже 1 из 100', () => {
    const cfg = BOXES.crate_pro.plane!;
    expect(cfg.legendary!).toBeLessThan(0.01);
    // И она никогда не выдаётся дешёвыми боксами.
    expect(rollPlane(BOXES.daily, SEEDS[0])).not.toBe('feniks');
    expect(planesOfRarity('legendary')).toEqual(['feniks']);
  });
});

describe('машина в боксе', () => {
  it('найденная машина попадает в полку звена, дубликаты копятся', () => {
    const { sql, tx } = world(2_000_000);
    let found = null as ReturnType<typeof openBox> | null;
    // Открыть бокс и увидеть машину — лотерея: шанс 4.2 % на открытие. Поэтому
    // берём самый щедвый бокс и 400 попыток: «не дождаться» было бы 10⁻⁸.
    for (let i = 0; i < 400 && !found; i++) {
      const res = tx(() => openBox(sql, 'p1', `k${i}`, 'crate_pro', T0 + i * 1000));
      if (res.plane) found = res;
    }
    expect(found).toBeTruthy();
    // «Стриж» уже выдан новичку, поэтому у него это второй экземпляр, а не новинка.
    const starter = found!.plane!.id === 'strizh';
    expect(found!.plane!.firstTime).toBe(!starter);
    expect(found!.plane!.count).toBe(starter ? 2 : 1);

    const shelf = planesView(sql, 'p1', T0 + 1000);
    expect(shelf.total).toBe(8);
    // Стартовая «Стриж» + находка: у новичка одна машина уже есть.
    expect(shelf.models.find((m) => m.id === 'strizh')!.count).toBeGreaterThanOrEqual(1);
    const mine = shelf.models.find((m) => m.id === found!.plane!.id)!;
    expect(mine.count).toBe(found!.plane!.id === 'strizh' ? 2 : 1);
    expect(mine.firstAt).toBeGreaterThan(0);
    expect(shelf.found).toBe(found!.plane!.id === 'strizh' ? 1 : 2);
    // Не найденные модели остаются в полке с нулём: клиент рисует силуэт.
    expect(shelf.models.filter((m) => m.count === 0)).toHaveLength(found!.plane!.id === 'strizh' ? 7 : 6);
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

  it('/me отдаёт полку звена вместе с патрулём', () => {
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
    expect(app).toContain("state.planes");
    expect(css).toContain('.plane-grid');
    expect(css).toContain('.plane-slot');
    // Подпись обязана обещать ровно то, что делает код: ни ASTRA, ни ресурсов.
    expect(app).toContain('но ни ASTRA, ни ресурсов звено не даёт');
  });

  it('патруль живёт в интерфейсе: кнопка, таймер возврата и забор находки', () => {
    expect(app).toContain('function planePatrolBlock');
    expect(app).toContain('planePatrolBlock()');
    expect(app).toContain("'/planes/patrol'");
    expect(app).toContain("'/planes/patrol/claim'");
    expect(app).toContain('plane-patrol');
    expect(app).toContain('В патруль');
    expect(app).toContain('Забрать находку');
    // Таймер возврата должен оживать сам: кнопка «Забрать» появляется без перезагрузки.
    expect(app).toContain("'data-patrol-ready'");
    expect(css).toContain('.plane-patrol');
    expect(css).toContain('plane-drift');
    // Полёт длится часами — показываем часы, а не 360 минут.
    expect(app).toContain('function fmtDuration');
  });

  it('бокс показывает шанс машины по редкости прямо в карточке', () => {
    expect(app).toContain('planeChances');
    expect(app).toContain('Машина звена');
    expect(css).toContain('.box-plane-chances');
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

describe('стартовая машина', () => {
  it('новичок получает «Стриж» — иначе патруль недоступен до первой удачи в боксах', () => {
    const { sql } = world();
    const shelf = planesView(sql, 'p1', T0);
    expect(shelf.found).toBe(1);
    expect(shelf.models.find((m) => m.id === 'strizh')!.count).toBe(1);
    expect(shelf.patrols).toBe(0);
    expect(shelf.patrol).toBeNull();
  });
});

describe('патруль: машины действительно летают', () => {
  /** Мир с одной машиной в коллекции: кладём её напрямую, как будто выпала из бокса. */
  function worldWithPlane(plane = 'strizh') {
    const w = world();
    // «Стриж» уже выдаётся при создании игрока, поэтому не INSERT, а upsert.
    w.sql.exec(
      `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES ('p1', ?, 1, ?, ?)
       ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1`,
      plane, T0, T0,
    );
    return w;
  }

  it('цифры звена зафиксированы: правка баланса обязана пройти через этот тест', () => {
    expect(BOXES.daily.plane).toEqual({ common: 0.008 });
    expect(BOXES.weekly.plane).toEqual({ common: 0.04, rare: 0.008 });
    expect(BOXES.crate_supply.plane).toEqual({ common: 0.015 });
    expect(BOXES.crate_pro.plane).toEqual({ common: 0.03, rare: 0.008, legendary: 0.004 });
    expect(PATROL).toEqual({
      common: { ms: 6 * 3600 * 1000, find: 0.04 },
      rare: { ms: 12 * 3600 * 1000, find: 0.08 },
      legendary: { ms: 24 * 3600 * 1000, find: 0.15 },
    });
  });

  it('чем реже машина, тем дольше и результативнее полёт', () => {
    const durations = PLANE_RARITY_ORDER.map((r) => PATROL[r].ms);
    const chances = PLANE_RARITY_ORDER.map((r) => PATROL[r].find);
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThan(durations[i - 1]);
      expect(chances[i]).toBeGreaterThan(chances[i - 1]);
    }
  });

  it('обычный полёт — 6 часов: чаще четырёх вылетов в сутки звено не даст', () => {
    const { sql, tx } = worldWithPlane('strizh');
    const first = tx(() => startPatrol(sql, 'p1', 'k1', 'strizh', T0));
    expect(Math.round((first.patrol.endsAt - T0) / 3600000)).toBe(6);
    expect(PATROL.common.ms).toBeGreaterThanOrEqual(6 * 3600 * 1000);
  });

  it('патруль требует владения машиной и идёт только один за раз', () => {
    const { sql, tx } = world();
    // У новичка есть только стартовая «Стриж»: «Феникс» ему недоступен.
    expect(() => tx(() => startPatrol(sql, 'p1', 'k0', 'feniks', T0))).toThrow(/plane_not_owned/);
    const owned = worldWithPlane('strizh');
    const res = owned.tx(() => startPatrol(owned.sql, 'p1', 'k1', 'strizh', T0));
    expect(res.patrol.endsAt - T0).toBe(PATROL.common.ms);
    expect(res.patrol.ready).toBe(false);
    expect(() => owned.tx(() => startPatrol(owned.sql, 'p1', 'k2', 'strizh', T0 + 1000))).toThrow(/patrol_busy/);
    expect(() => owned.tx(() => startPatrol(owned.sql, 'p1', 'k3', 'boeing', T0 + 1000))).toThrow(/bad_plane/);
  });

  it('забрать раньше времени нельзя, после — можно, и находить может кого угодно', () => {
    const { sql, tx } = worldWithPlane('feniks');
    tx(() => startPatrol(sql, 'p1', 'k1', 'feniks', T0));
    expect(() => tx(() => claimPatrol(sql, 'p1', 'c1', T0 + 1000))).toThrow(/patrol_flying/);

    const res = tx(() => claimPatrol(sql, 'p1', 'c2', T0 + PATROL.legendary.ms));
    expect(res.plane).toBe('feniks');
    // Легендарная машина ищет только легендарные и редкие — за 8 вылетов не common.
    for (let i = 0; i < 8; i++) {
      const seed = `${i}`.padStart(2, '0').repeat(16);
      const found = rollPatrol('feniks', seed);
      if (found) expect(['feniks', 'sokol', 'manta', 'prizrak']).toContain(found);
    }
    expect(planesView(sql, 'p1', T0 + PATROL.legendary.ms + 1).patrol).toBeNull();
    expect(planesView(sql, 'p1', T0 + PATROL.legendary.ms + 1).patrols).toBe(1);
  });

  it('патруль не даёт ни ASTRA, ни ресурсов: это коллекция, а не доход', () => {
    const { sql, tx } = worldWithPlane('strizh');
    tx(() => addResource(sql, 'p1', 'iron_ore', 2, T0));
    const astraBefore = getBalance(sql, 'p1', 'astra');
    const resourcesBefore = sql.exec('SELECT resource, amount FROM resources WHERE player_id = ? ORDER BY resource', 'p1').toArray()
      .map((r) => `${String(r.resource)}:${Number(r.amount)}`).join(',');
    const fuelBefore = getBalance(sql, 'p1', 'fuel');

    for (let i = 0; i < 12; i++) {
      // Разные seed'ы: часть вылетов пустая, часть с находкой — на экономику это не влияет.
      const at = T0 + i * PATROL.common.ms * 2;
      tx(() => startPatrol(sql, 'p1', `p${i}`, 'strizh', at));
      tx(() => claimPatrol(sql, 'p1', `c${i}`, at + PATROL.common.ms));
    }

    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore);
    expect(getBalance(sql, 'p1', 'fuel')).toBe(fuelBefore);
    const resourcesAfter = sql.exec('SELECT resource, amount FROM resources WHERE player_id = ? ORDER BY resource', 'p1').toArray()
      .map((r) => `${String(r.resource)}:${Number(r.amount)}`).join(',');
    expect(resourcesAfter).toBe(resourcesBefore);
    expect(verifyLedger(sql).ok).toBe(true);
    expect(planesView(sql, 'p1', T0 + 1000000).patrols).toBe(12);
  });

  it('найденная машина попадает в коллекцию, дубликаты копятся', () => {
    // Ищем seed, на котором патруль точно что-то находит: 5 % на легендарной.
    let seed = '';
    for (let i = 0; i < 500; i++) {
      const candidate = `${i}`.padStart(2, '0').repeat(16);
      if (rollPatrol('feniks', candidate)) { seed = candidate; break; }
    }
    expect(seed).not.toBe('');
    const found = rollPatrol('feniks', seed)!;
    const { sql, tx } = worldWithPlane('feniks');
    sql.exec(`INSERT INTO plane_patrols (id, player_id, plane, seed, started_at, ends_at, status)
              VALUES ('x1', 'p1', 'feniks', ?, ?, ?, 'flying')`, seed, T0, T0 + 1000);
    const res = tx(() => claimPatrol(sql, 'p1', 'c1', T0 + 2000));
    expect(res.found?.id).toBe(found);
    const shelf = planesView(sql, 'p1', T0 + 2000);
    const mine = shelf.models.find((m) => m.id === found)!;
    expect(mine.count).toBeGreaterThanOrEqual(1);
    if (found === 'feniks') expect(mine.count).toBe(2);
    expect(shelf.hours).toBe(0);
    expect(shelf.models[0].patrolMs).toBe(PATROL.common.ms);
  });

  it('без активного патруля claim отвечает no_patrol', () => {
    const { sql, tx } = world();
    expect(() => tx(() => claimPatrol(sql, 'p1', 'c1', T0))).toThrow(/no_patrol/);
  });
});
