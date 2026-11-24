import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import {
  BOXES, BOX_ORDER, PATROL, PATROL_MAX_CONCURRENT, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, PLANE_RARITY_ORDER, RESOURCE_BASE_PRICES,
  isPlaneId, planeSprite, planesOfRarity, type PlaneId,
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

  it('повторов не будет: собранная модель не может выпасть второй раз', () => {
    // Для любого набора «уже собрано» бокс обязан выдавать только то, чего нет.
    const ownedSets: PlaneId[][] = [
      ['strizh'],
      ['strizh', 'osa'],
      ['strizh', 'osa', 'kolibri', 'skat'],
      ['sokol'],
      ['feniks'],
      ['strizh', 'osa', 'kolibri', 'skat', 'sokol', 'manta', 'prizrak'],
      ['strizh', 'osa', 'kolibri', 'skat', 'sokol', 'manta', 'prizrak', 'feniks'],
    ];
    for (const box of BOX_ORDER) {
      for (const list of ownedSets) {
        const owned = new Set<PlaneId>(list);
        for (const seed of SEEDS) {
          const plane = rollPlane(BOXES[box], seed, owned);
          if (plane) expect(owned.has(plane), `${box}/${list.join('+')}/${seed}`).toBe(false);
        }
      }
    }
    // Собранная коллекция — машина не выпадает вовсе: дублей в мире нет.
    const everything = new Set<PlaneId>(PLANE_ORDER);
    for (const box of BOX_ORDER) {
      for (const seed of SEEDS.slice(0, 50)) {
        expect(rollPlane(BOXES[box], seed, everything), box).toBeNull();
      }
    }
  });

  it('анти-дубль не меняет старые розыгрыши и детерминирован', () => {
    for (const box of BOX_ORDER) {
      for (const seed of SEEDS) {
        // Пустой набор «собрано» — ровно то же самое, что до правки: сохранённые
        // в box_opens seed'ы перепроверяются байт в байт.
        expect(rollPlane(BOXES[box], seed), `${box}/${seed}`).toBe(rollPlane(BOXES[box], seed, new Set()));
        // Тот же seed и то же собранное — та же машина.
        const owned = new Set<PlaneId>(['strizh']);
        expect(rollPlane(BOXES[box], seed, owned)).toBe(rollPlane(BOXES[box], seed, new Set(['strizh'])));
      }
    }
  });

  it('собранную ступень бокс заменяет соседней, а не пустотой', () => {
    const def = BOXES.crate_pro; // common 3 % + rare 0.8 % + legendary 0.4 %
    const seedRare = (() => {
      // Подберём seed, который без анти-дубля даёт редкую модель.
      for (const seed of SEEDS) {
        const plane = rollPlane(def, seed);
        if (plane && PLANES[plane].rarity === 'rare') return seed;
      }
      return '';
    })();
    expect(seedRare).not.toBe('');
    const rareModel = rollPlane(def, seedRare)!;
    // Редкая ступень собрана целиком — бросок уезжает на обычную, не в ноль.
    const allRare = new Set<PlaneId>(planesOfRarity('rare'));
    const substitute = rollPlane(def, seedRare, allRare);
    expect(substitute).not.toBeNull();
    expect(substitute).not.toBe(rareModel);
    expect(PLANES[substitute!].rarity).toBe('common');
    // Обычная тоже собрана — тогда выше: легендарная остаётся единственной свежей.
    const up = rollPlane(def, seedRare, new Set<PlaneId>([...planesOfRarity('rare'), ...planesOfRarity('common')]));
    expect(PLANES[up!].rarity).toBe('legendary');
  });

  it('boxesView честно говорит, сколько моделей ещё не собрано', () => {
    const { sql, tx } = world();
    const view = () => boxesView(sql, 'p1', T0);
    // Новичок: одна машина есть (стартовый «Стриж»), значит свежих обычных три.
    const all = view();
    const daily = all.boxes.find((b) => b.id === 'daily')!;
    expect(daily.planeChances.length).toBeGreaterThan(0);
    const common = daily.planeChances.find((c) => c.rarity === 'common')!;
    expect(common.models).toBe(planesOfRarity('common').length);
    expect(common.fresh).toBe(common.models - 1);
    expect(view().planesFound).toBe(1);
    expect(view().planesAllOwned).toBe(false);
    // Собрать всё: fresh обнуляется, бокс объявляет, что машин не даст.
    // Коллекцию кладём напрямую — проверять лотерею боксов здесь не нужно.
    tx(() => {
      for (const id of PLANE_ORDER) {
        sql.exec(
          `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES ('p1', ?, 1, ?, ?)
           ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1`,
          id, T0, T0,
        );
      }
    });
    const full = view();
    expect(full.planesAllOwned).toBe(true);
    expect(full.planesTotal).toBe(PLANE_ORDER.length);
    for (const box of full.boxes) {
      for (const chance of box.planeChances) expect(chance.fresh).toBe(0);
    }
  });

  it('ни одного повторного корабля из боксов: 400 открытий дают разные модели', () => {
    const { sql, tx } = world(2_000_000);
    const seen: string[] = [];
    for (let i = 0; i < 400; i++) {
      const res = tx(() => openBox(sql, 'p1', `nd${i}`, 'crate_pro', T0 + i * 1000));
      const plane = (res as { plane?: { id: string; count: number } }).plane;
      if (!plane) continue;
      seen.push(plane.id);
      // Счётчик не обязан расти: second copy of the same model never happens.
      expect(plane.count).toBe(1);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(seen.length);
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
    // Подпись обязана обещать ровно то, что делает код: ресурсы и опыт звено
    // приносит, ASTRA — нет. И то и другое должно быть в тексте прямо.
    expect(app).toContain('шанса на ASTRA нет');
    expect(app).toContain('возвращается с закладкой ресурсов и опыта');
    expect(app).toContain('ячейки под корабли звено не занимает');
    // Анти-дубль боксов и патрулей тоже обещан в интерфейсе, а не только в коде.
    expect(app).toContain('Повторных машин боксы и патрули не выдают');
    // Шанс находки подписан как шанс новой машины и честен при собранной полке.
    expect(app).toContain('находка новой ${chance} %');
    expect(app).toContain('Звено собрано целиком');
  });

  it('патруль живёт в интерфейсе: кнопка, таймер возврата и забор находки', () => {
    expect(app).toContain('function planePatrolBlock');
    expect(app).toContain('planePatrolBlock()');
    expect(app).toContain("'/planes/patrol'");
    expect(app).toContain("'/planes/patrol/claim'");
    expect(app).toContain('plane-patrol');
    expect(app).toContain('plane-patrol-row');
    expect(app).toContain('В патруль');
    // Сдаются все вернувшиеся борта сразу — одной кнопкой.
    expect(app).toContain('Забрать');
    expect(app).toContain('salvageText');
    // Сколько бортов пускает ангар — видно на карточке.
    expect(app).toContain('p.slots');
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
      common: { ms: 6 * 3600 * 1000, find: 0.01, salvage: { iron_ore: 1 }, xp: 4 },
      rare: { ms: 12 * 3600 * 1000, find: 0.02, salvage: { iron_ore: 2, silicon: 1 }, xp: 8 },
      legendary: { ms: 24 * 3600 * 1000, find: 0.04, salvage: { iron_ore: 3, crystal: 1 }, xp: 16 },
    });
    // Параллельность патруля ограничена слотами: не конвейер.
    expect(PATROL_MAX_CONCURRENT).toBe(4);
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

  it('звено может летать параллельно, но не больше слотов', () => {
    const { sql, tx } = world();
    // Четыре обычные машины — ровно столько, сколько есть в коллекции.
    for (const plane of ['strizh', 'osa', 'kolibri', 'skat']) {
      sql.exec(
        `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES ('p1', ?, 1, ?, ?)
         ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1`,
        plane, T0, T0,
      );
    }
    const planes = ['strizh', 'osa', 'kolibri', 'skat'];
    planes.forEach((plane, i) => {
      expect(() => tx(() => startPatrol(sql, 'p1', `k${i}`, plane, T0))).not.toThrow();
    });
    // Пятый борт — уже конвейер: слоты закончились.
    sql.exec(
      `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES ('p1', 'sokol', 1, ?, ?)
       ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1`,
      T0, T0,
    );
    expect(() => tx(() => startPatrol(sql, 'p1', 'k5', 'sokol', T0))).toThrow(/patrol_slots_full/);
    const shelf = planesView(sql, 'p1', T0);
    expect(shelf.active.length).toBe(PATROL_MAX_CONCURRENT);
    expect(shelf.flying).toBe(PATROL_MAX_CONCURRENT);
    expect(shelf.freeSlots).toBe(0);
    // Каждая модель в воздухе помечена: кнопка «В патруль» не дразнится.
    expect(shelf.models.filter((m) => m.flying).map((m) => m.id).sort())
      .toEqual(['kolibri', 'osa', 'skat', 'strizh']);
  });

  it('одна машина дважды в воздух не выходит', () => {
    const { sql, tx } = worldWithPlane('strizh');
    tx(() => startPatrol(sql, 'p1', 'k1', 'strizh', T0));
    expect(() => tx(() => startPatrol(sql, 'p1', 'k2', 'strizh', T0 + 1000))).toThrow(/patrol_busy/);
  });

  it('сдача забирает все вернувшиеся борта и отдаёт закладку каждого', () => {
    const { sql, tx } = world();
    for (const plane of ['strizh', 'osa']) {
      sql.exec(
        `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES ('p1', ?, 1, ?, ?)
         ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1`,
        plane, T0, T0,
      );
    }
    tx(() => startPatrol(sql, 'p1', 'k1', 'strizh', T0));
    // Второй борт стартовал позже: к моменту сдачи первого он ещё летит.
    tx(() => startPatrol(sql, 'p1', 'k2', 'osa', T0 + 1000));
    const res = tx(() => claimPatrol(sql, 'p1', 'c1', T0 + PATROL.common.ms));
    expect(res.claimed).toBe(1);
    // Закладка обычной машины: одно железо и опыт.
    expect(res.salvage).toEqual([{ resource: 'iron_ore', name: 'Железная руда', amount: 1 }]);
    expect(res.xp).toBe(PATROL.common.xp);
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(1);
    // Второй борт ещё в воздухе — его не трогаем.
    expect(planesView(sql, 'p1', T0 + PATROL.common.ms).active.length).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('патруль даёт ресурсы и опыт, но не ASTRA и не топливо', () => {
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

    expect(getBalance(sql, 'p1', 'astra'), 'ASTRA звеном не печатается').toBe(astraBefore);
    expect(getBalance(sql, 'p1', 'fuel')).toBe(fuelBefore);
    const resourcesAfter = sql.exec('SELECT resource, amount FROM resources WHERE player_id = ? ORDER BY resource', 'p1').toArray()
      .map((r) => `${String(r.resource)}:${Number(r.amount)}`).join(',');
    // Ресурсы, наоборот, обязаны капать: иначе патруль — безделушка.
    expect(resourcesAfter).not.toBe(resourcesBefore);
    const totals = new Map(sql.exec('SELECT resource, amount FROM resources WHERE player_id = ? ORDER BY resource', 'p1').toArray()
      .map((r) => [String(r.resource), Number(r.amount)]));
    // 12 вылетов по 1 железу: 12 + то 2 железа, что лежали до теста.
    expect(totals.get('iron_ore')).toBe(14);
    expect(totals.get('copper_ore')).toBeUndefined();
    // Опыт за вылет — 4: 12 × 4 = 48.
    expect(Number(sql.exec("SELECT xp FROM players WHERE id = 'p1'").toArray()[0].xp)).toBe(48);
    expect(verifyLedger(sql).ok).toBe(true);
    expect(planesView(sql, 'p1', T0 + 1000000).patrols).toBe(12);
  });

  it('найденная машина попадает в коллекцию один раз', () => {
    // Ищем seed, на котором патруль точно что-то находит: 15 % на легендарной.
    let seed = '';
    for (let i = 0; i < 4000; i++) {
      const candidate = `${i}`.padStart(2, '0').repeat(16);
      if (rollPatrol('feniks', candidate)) { seed = candidate; break; }
    }
    expect(seed).not.toBe('');
    // Ожидаем ровно то же, что посчитает сервер: коллекция игрока к моменту сдачи
    // — «Стриж» (стартовый) и «Феникс», поэтому легенда уже занята и патруль
    // скатывается на редкую ступень.
    const found = rollPatrol('feniks', seed, new Set<PlaneId>(['strizh', 'feniks']))!;
    const { sql, tx } = worldWithPlane('feniks');
    sql.exec(`INSERT INTO plane_patrols (id, player_id, plane, seed, started_at, ends_at, status)
              VALUES ('x1', 'p1', 'feniks', ?, ?, ?, 'flying')`, seed, T0, T0 + 1000);
    const res = tx(() => claimPatrol(sql, 'p1', 'c1', T0 + 2000));
    expect(res.found?.id).toBe(found);
    const shelf = planesView(sql, 'p1', T0 + 2000);
    const mine = shelf.models.find((m) => m.id === found)!;
    // Патруль не приносит то, что уже стоит на полке: count остаётся 1 у новой
    // машины и 1 у «Феникса», который летал.
    expect(mine.count).toBe(1);
    expect(shelf.models.find((m) => m.id === 'feniks')!.count).toBe(1);
    expect(res.foundList.every((f) => f.firstTime)).toBe(true);
    expect(shelf.hours).toBe(0);
    expect(shelf.models[0].patrolMs).toBe(PATROL.common.ms);
  });

  it('патруль ищет только несобранное: ступени обходятся по весам', () => {
    // Тот же seed, но с разным собранным набором: находка обязана быть новой.
    let seed = '';
    for (let i = 0; i < 4000; i++) {
      const candidate = `${i}`.padStart(2, '0').repeat(16);
      if (rollPatrol('feniks', candidate)) { seed = candidate; break; }
    }
    const legendary = planesOfRarity('legendary');
    const rare = planesOfRarity('rare');
    const common = planesOfRarity('common');
    // Пустое `owned` = старый результат байт в байт.
    const base = rollPatrol('feniks', seed)!;
    expect(rollPatrol('feniks', seed, new Set<PlaneId>())).toBe(base);
    // Легенда уже есть — скатываемся на редких (второй вес таблицы легендарных).
    expect(rollPatrol('feniks', seed, new Set(legendary))).not.toBeNull();
    expect(rare).toContain(rollPatrol('feniks', seed, new Set(legendary))!);
    // Легенда и редкие собраны — в таблице легендарных больше ходить некуда.
    expect(rollPatrol('feniks', seed, new Set([...legendary, ...rare]))).toBeNull();
    // Обычная машина при собранной обычности находит редкую.
    let cseed = '';
    for (let i = 0; i < 2000; i++) {
      const candidate = `${i}`.padStart(2, '0').repeat(16);
      if (rollPatrol('strizh', candidate)) { cseed = candidate; break; }
    }
    expect(rollPatrol('strizh', cseed, new Set(common))).not.toBeNull();
    expect([...rare, ...common]).toContain(rollPatrol('strizh', cseed, new Set(common))!);
    // Собрано всё — находить нечего, и это не ошибка: патруль просто ничего не несёт.
    expect(rollPatrol('strizh', cseed, new Set([...common, ...rare, ...legendary]))).toBeNull();
    expect(rollPatrol('feniks', seed, new Set(PLANE_ORDER))).toBeNull();
  });

  it('два вернувшихся борта не приносят одну и ту же машину', () => {
    // Один и тот же seed на двух «Стрижах»: если бы коллекция не обновлялась в
    // цикле, обе находки совпали.
    let seed = '';
    for (let i = 0; i < 4000; i++) {
      const candidate = `${i}`.padStart(2, '0').repeat(16);
      const hit = rollPatrol('strizh', candidate);
      // Нужна находка именно обычной ступени — тогда второй борт обязан взять другую.
      if (hit && PLANES[hit].rarity === 'common') { seed = candidate; break; }
    }
    expect(seed).not.toBe('');
    const { sql, tx } = worldWithPlane('strizh');
    sql.exec(
      `INSERT INTO plane_patrols (id, player_id, plane, seed, started_at, ends_at, status)
       VALUES ('x1', 'p1', 'strizh', ?, ?, ?, 'flying'), ('x2', 'p1', 'osa', ?, ?, ?, 'flying')`,
      seed, T0, T0 + 1000, seed, T0, T0 + 1000,
    );
    const res = tx(() => claimPatrol(sql, 'p1', 'c1', T0 + 2000));
    const ids = res.foundList.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Полка без повторов: найденное раньше не стояло ни у кого (у стартового
    // «Стрижа» count 2 — его выдал хелпер, это не дубликат патруля).
    const shelf = planesView(sql, 'p1', T0 + 2000);
    for (const id of ids) expect(shelf.models.find((m) => m.id === id)!.count).toBe(1);
  });

  it('без активного патруля claim отвечает no_patrol', () => {
    const { sql, tx } = world();
    expect(() => tx(() => claimPatrol(sql, 'p1', 'c1', T0))).toThrow(/no_patrol/);
  });
});
