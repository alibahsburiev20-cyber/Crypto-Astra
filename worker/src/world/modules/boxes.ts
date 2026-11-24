import {
  BOXES, BOX_COMPONENTS, BOX_ORDER, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, RESOURCE_NAMES,
  isBoxId, planeSprite, type BoxDef, type BoxId, type PlaneId,
} from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { seedUnit } from './expeditionMath';
import { applyResourceDelta, assertPlayable } from './maintenance';
import { playerExists } from './players';

// Боксы (этап 5). Два бесплатных по таймеру и два платных за ASTRA.
//
// Правила, которые нельзя нарушать:
//  1. Случайность — серверная и записываемая. seed кладётся в `box_opens`,
//     поэтому выдачу можно перепроверить, а клиент ничего не подкручивает.
//  2. Бесплатные не чаще таймера: дневной раз в 24 ч, недельный раз в 7 дней.
//  3. Платные — сток ASTRA. Ресурсы из них дешевле цены (см. `rollValue`),
//     иначе их выгодно скупать и перепродавать на рынке.
//  4. Никакой ASTRA внутри бокса: иначе платный бокс становится обменником.

export interface BoxDrop {
  resource: string;
  name: string;
  amount: number;
}

export interface BoxRoll {
  units: number;
  drops: BoxDrop[];
  rare: boolean;
  components: number;
  /** Машина звена: коллекция, а не ресурс. null — не выпала. */
  plane: PlaneId | null;
}

export interface BoxView {
  id: BoxId;
  name: string;
  hint: string;
  sprite: string;
  price: number;
  cooldownMs: number;
  units: [number, number];
  /** 0 — можно открывать сейчас. */
  nextOpenAt: number;
  ready: boolean;
  opens: number;
}

/** Спрайт бокса. Путь строим из id, как и у ресурсов: клиент не правится. */
export function boxSprite(id: BoxId): string {
  return `/sprites/boxes/${id}.png`;
}

function stack(list: BoxDrop[], resource: string, amount: number): void {
  if (amount <= 0) return;
  const found = list.find((s) => s.resource === resource);
  if (found) found.amount += amount;
  else list.push({ resource, name: RESOURCE_NAMES[resource] ?? resource, amount });
}

/**
 * Розыгрыш содержимого. Чистая функция: тот же seed и тот же бокс — тот же
 * результат. Порядок байтов seed закреплён тестом, менять его нельзя: иначе уже
 * выданные боксы перестанут воспроизводиться по сохранённому seed.
 */
export function rollBox(def: BoxDef, seed: string): BoxRoll {
  const [lo, hi] = def.units;
  const units = lo + Math.min(hi - lo, Math.floor(seedUnit(seed, 0) * (hi - lo + 1)));
  const total = Math.max(1, Math.min(hi, units));

  const primary = def.pool[Math.floor(seedUnit(seed, 1) * def.pool.length)] ?? def.pool[0];
  const secondary = def.pool[Math.floor(seedUnit(seed, 2) * def.pool.length)] ?? primary;

  const drops: BoxDrop[] = [];
  // 35 % уходит на второй ресурс, но не больше, чем осталось после первого.
  const second = secondary === primary ? 0 : Math.min(total - 1, Math.floor(total * 0.35));
  stack(drops, primary, total - second);
  stack(drops, secondary, second);

  // Редкий ресурс: это не «джекпот», а одна единица того, что лежит в 3–4 секторе.
  const rare = !!def.rare && seedUnit(seed, 3) < def.rare.chance;
  if (rare && def.rare) stack(drops, def.rare.resource, 1);

  let components = 0;
  if (def.components) {
    for (let i = 0; i < def.components.count; i++) {
      if (seedUnit(seed, 4 + i) >= def.components.chance) continue;
      const pick = BOX_COMPONENTS[Math.floor(seedUnit(seed, 8 + i) * BOX_COMPONENTS.length)] ?? BOX_COMPONENTS[0];
      stack(drops, pick, 1);
      components++;
    }
  }

  // Машина звена. Свои байты (9 и 10), чтобы не сдвигать ресурсы: у уже
  // выданных боксов по сохранённому seed обязано воспроизводиться то же самое.
  const plane = def.plane && seedUnit(seed, 9) < def.plane.chance
    ? def.plane.pool[Math.min(def.plane.pool.length - 1, Math.floor(seedUnit(seed, 10) * def.plane.pool.length))]
    : null;

  return { units: total, drops, rare, components, plane: plane ?? null };
}

export interface PlaneView {
  id: PlaneId;
  name: string;
  rarity: string;
  rarityName: string;
  hint: string;
  sprite: string;
  count: number;
  firstAt: number;
}

/** Полка звена: все модели, включая ещё не найденные (count 0). */
export function planesView(sql: SqlStorage, playerId: string): { found: number; total: number; models: PlaneView[] } {
  const rows = sql.exec('SELECT plane, count, first_at FROM player_planes WHERE player_id = ?', playerId).toArray();
  const byId = new Map(rows.map((r) => [String(r.plane), r]));
  const models = PLANE_ORDER.map((id) => {
    const def = PLANES[id];
    const row = byId.get(id);
    return {
      id,
      name: def.name,
      rarity: def.rarity,
      rarityName: PLANE_RARITY_NAMES[def.rarity],
      hint: def.hint,
      sprite: planeSprite(id),
      count: row ? Number(row.count) : 0,
      firstAt: row ? Number(row.first_at) : 0,
    };
  });
  return { found: models.filter((m) => m.count > 0).length, total: PLANE_ORDER.length, models };
}

/** Начислить машину. Дубликаты копятся счётчиком — коллекция не «сгорает». */
function grantPlane(sql: SqlStorage, playerId: string, plane: PlaneId, now: number): number {
  const row = sql.exec('SELECT count FROM player_planes WHERE player_id = ? AND plane = ?', playerId, plane).toArray()[0];
  const count = row ? Number(row.count) + 1 : 1;
  sql.exec(
    `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
    playerId, plane, now, now,
  );
  return count;
}

export function boxesView(sql: SqlStorage, playerId: string, now: number): { boxes: BoxView[] } {
  const rows = sql.exec('SELECT box, last_open_at, opens FROM box_state WHERE player_id = ?', playerId).toArray();
  const byBox = new Map(rows.map((r) => [String(r.box), r]));

  return {
    boxes: BOX_ORDER.map((id) => {
      const def = BOXES[id];
      const row = byBox.get(id);
      const last = row ? Number(row.last_open_at) : 0;
      const nextOpenAt = def.cooldownMs > 0 && last > 0 ? last + def.cooldownMs : 0;
      return {
        id,
        name: def.name,
        hint: def.hint,
        sprite: boxSprite(id),
        price: def.price,
        cooldownMs: def.cooldownMs,
        units: def.units,
        nextOpenAt,
        ready: nextOpenAt <= now,
        opens: row ? Number(row.opens) : 0,
      };
    }),
  };
}

/**
 * Открыть бокс. Один вызов — один бокс: и ASTRA, и ресурсы пишутся в журнал в
 * одной транзакции мира, поэтому «списали и не выдали» невозможно.
 */
export function openBox(sql: SqlStorage, playerId: string, idemKey: string, boxId: string, now: number) {
  return withIdempotency(sql, playerId, 'box_open', idemKey, { box: boxId }, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    if (!isBoxId(boxId)) throw new ApiError(400, 'bad_box');
    const def = BOXES[boxId];

    const row = sql.exec('SELECT last_open_at, opens FROM box_state WHERE player_id = ? AND box = ?', playerId, boxId).toArray()[0];
    const last = row ? Number(row.last_open_at) : 0;
    const opens = row ? Number(row.opens) : 0;

    if (def.cooldownMs > 0 && last > 0) {
      const next = last + def.cooldownMs;
      if (next > now) throw new ApiError(429, 'box_cooldown', Math.ceil((next - now) / 1000));
    }

    let astra = getBalance(sql, playerId, 'astra');
    if (def.price > 0) {
      if (astra < def.price) throw new ApiError(409, 'insufficient_funds');
      astra = applyDelta(sql, { playerId, asset: 'astra', delta: -def.price, reason: 'box_purchase', sourceRef: boxId, idemKey }, now);
    }

    // 16 байт: розыгрышу нужно не больше 10, остальное — запас на будущие поля.
    const seed = crypto.randomUUID().replace(/-/g, '');
    const roll = rollBox(def, seed);

    for (const drop of roll.drops) {
      applyResourceDelta(sql, {
        playerId, resource: drop.resource, delta: drop.amount,
        reason: 'box_open', sourceRef: boxId, idemKey,
      }, now);
    }

    // Машина звена: пишется в ту же транзакцию, что и ресурсы, поэтому
    // «выпало в анимации, но не сохранилось» невозможно.
    const plane = roll.plane ? grantPlane(sql, playerId, roll.plane, now) : 0;

    sql.exec(
      `INSERT INTO box_state (player_id, box, last_open_at, opens) VALUES (?, ?, ?, ?)
       ON CONFLICT (player_id, box) DO UPDATE SET last_open_at = excluded.last_open_at, opens = excluded.opens`,
      playerId, boxId, now, opens + 1,
    );
    // Журнал самих открытий: по нему видно, что именно выпало и с каким seed.
    sql.exec(
      'INSERT INTO box_opens (id, player_id, box, seed, cost, drops_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), playerId, boxId, seed, def.price, JSON.stringify(roll.drops), now,
    );

    const view = boxesView(sql, playerId, now).boxes.find((b) => b.id === boxId);
    return {
      value: {
        box: boxId,
        name: def.name,
        price: def.price,
        drops: roll.drops,
        units: roll.units,
        rare: roll.rare,
        components: roll.components,
        plane: roll.plane
          ? {
            id: roll.plane,
            name: PLANES[roll.plane].name,
            rarity: PLANES[roll.plane].rarity,
            rarityName: PLANE_RARITY_NAMES[PLANES[roll.plane].rarity],
            hint: PLANES[roll.plane].hint,
            sprite: planeSprite(roll.plane),
            count: plane,
            firstTime: plane === 1,
          }
          : null,
        astra,
        nextOpenAt: view ? view.nextOpenAt : 0,
        opens: opens + 1,
      },
      store: true,
    };
  });
}

/** Последние открытия: клиент показывает, что выпало в прошлый раз. */
export function boxesHistory(sql: SqlStorage, playerId: string, limit = 5) {
  const rows = sql.exec(
    'SELECT box, drops_json, created_at FROM box_opens WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    playerId, Math.max(1, Math.min(20, limit)),
  ).toArray();
  return rows.map((r) => ({
    box: String(r.box),
    drops: JSON.parse(String(r.drops_json)) as BoxDrop[],
    at: Number(r.created_at),
  }));
}
