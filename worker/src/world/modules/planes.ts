import {
  PATROL, PATROL_FIND, PATROL_MAX_CONCURRENT, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, RESOURCE_NAMES,
  isPlaneId, planeSprite, planesOfRarity, salvageLabel,
  type PlaneId, type PlaneRarity,
} from '../../shared/gameData';
import { applyXp } from './progress';
import { applyResourceDelta, assertPlayable } from './maintenance';
import { levelFromXp, seedUnit, seedUnit16 } from './expeditionMath';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { playerExists } from './players';

// Авиазвено (этап 6). Две части:
//
//  1. Коллекция: машины падают из боксов (редкость задана в `BOXES[].plane`), и
//     повторных моделей бокс не выдаёт — см. `rollPlane`.
//  2. Патруль: машина летает сама, тащит закладку ресурсов и опыта и иногда
//     находит ещё одну машину.
//
// ASTRA патрулём не капает намеренно: валюта уже течёт из рейсов, арены и Claim,
// а звено к тому же бесплатное в содержании — ни топлива, ни износа. Ресурсы
// можно: они становятся деньгами только через рынок, то есть через второе
// действие. Параллельность ограничена слотами (`PATROL_MAX_CONCURRENT`) и длиной
// полёта: 6 / 12 / 24 часа.
//
// Хранится только то, что нельзя пересчитать: счётчик машин и журнал патрулей с
// seed, чтобы находку можно было перепроверить.

export interface PlaneView {
  id: PlaneId;
  name: string;
  rarity: PlaneRarity;
  rarityName: string;
  hint: string;
  sprite: string;
  count: number;
  firstAt: number;
  /** Патруль этой модели: длительность и шанс находки. Есть у любой машины. */
  patrolMs: number;
  findChance: number;
  /** Закладка завершённого вылета: что борт принесёт в трюме. */
  salvage: { resource: string; name: string; amount: number }[];
  /** Текст закладки для карточки: «6 руды, 2 меди». */
  salvageText: string;
  /** Опыт за вылет. */
  xp: number;
  /** Борт сейчас в воздухе. */
  flying: boolean;
}

export interface PatrolView {
  id: string;
  plane: PlaneId;
  name: string;
  sprite: string;
  rarity: PlaneRarity;
  rarityName: string;
  startedAt: number;
  endsAt: number;
  ready: boolean;
  /** Шанс находки этой машины за один патруль, для подсказки на карточке. */
  findChance: number;
  /** Что вернётся вместе с бортом, если дождаться возвращения. */
  salvage: { resource: string; name: string; amount: number }[];
  salvageText: string;
  xp: number;
}

export interface PlanesState {
  found: number;
  total: number;
  models: PlaneView[];
  /** Первый борт в воздухе — для старых клиентов; полный список лежит в `active`. */
  patrol: PatrolView | null;
  /** Все борта в воздухе: их столько, сколько слотов занято. */
  active: PatrolView[];
  /** Сколько бортов одновременно пускает ангар звена. */
  slots: number;
  /** Вернулись и ждут сдачи. */
  ready: number;
  /** Сейчас в воздухе (включая тех, кто ещё не вернулся). */
  flying: number;
  /** Свободных слотов: сколько бортов можно запустить прямо сейчас. */
  freeSlots: number;
  /** патрулей, завершённых за всё время, и часы налёта. */
  patrols: number;
  hours: number;
}

function salvageOf(rarity: PlaneRarity): { resource: string; name: string; amount: number }[] {
  return Object.entries(PATROL[rarity].salvage).map(([resource, amount]) => ({
    resource,
    name: RESOURCE_NAMES[resource] ?? resource,
    amount,
  }));
}

function patrolRows(sql: SqlStorage, playerId: string): Record<string, unknown>[] {
  return sql.exec(
    `SELECT id, plane, started_at, ends_at FROM plane_patrols
     WHERE player_id = ? AND status = 'flying' ORDER BY started_at`,
    playerId,
  ).toArray();
}

function patrolViewOf(row: Record<string, unknown>, now: number): PatrolView {
  const plane = String(row.plane) as PlaneId;
  const def = PLANES[plane];
  const rarity = def?.rarity ?? 'common';
  const cfg = PATROL[rarity];
  return {
    id: String(row.id),
    plane,
    name: def?.name ?? plane,
    sprite: planeSprite(plane),
    rarity,
    rarityName: PLANE_RARITY_NAMES[rarity],
    startedAt: Number(row.started_at),
    endsAt: Number(row.ends_at),
    ready: Number(row.ends_at) <= now,
    findChance: cfg.find,
    salvage: salvageOf(rarity),
    salvageText: salvageLabel(cfg.salvage),
    xp: cfg.xp,
  };
}

/** Полка звена: все модели, включая ещё не найденные (count 0), плюс патрули. */
export function planesView(sql: SqlStorage, playerId: string, now: number): PlanesState {
  const rows = sql.exec('SELECT plane, count, first_at FROM player_planes WHERE player_id = ?', playerId).toArray();
  const byId = new Map(rows.map((r) => [String(r.plane), r]));
  const air = patrolRows(sql, playerId);
  const flyingPlanes = new Set(air.map((r) => String(r.plane)));
  const models = PLANE_ORDER.map((id) => {
    const def = PLANES[id];
    const row = byId.get(id);
    const patrol = PATROL[def.rarity];
    return {
      id,
      name: def.name,
      rarity: def.rarity,
      rarityName: PLANE_RARITY_NAMES[def.rarity],
      hint: def.hint,
      sprite: planeSprite(id),
      count: row ? Number(row.count) : 0,
      firstAt: row ? Number(row.first_at) : 0,
      patrolMs: patrol.ms,
      findChance: patrol.find,
      salvage: salvageOf(def.rarity),
      salvageText: salvageLabel(patrol.salvage),
      xp: patrol.xp,
      flying: flyingPlanes.has(id),
    };
  });
  const stats = sql.exec(
    `SELECT COUNT(*) AS n, COALESCE(SUM(ends_at - started_at), 0) AS ms
     FROM plane_patrols WHERE player_id = ? AND status = 'done'`,
    playerId,
  ).toArray()[0];
  const views = air.map((row) => patrolViewOf(row, now));
  return {
    found: models.filter((m) => m.count > 0).length,
    total: PLANE_ORDER.length,
    models,
    patrol: views[0] ?? null,
    active: views,
    slots: PATROL_MAX_CONCURRENT,
    ready: views.filter((v) => v.ready).length,
    flying: views.length,
    freeSlots: Math.max(0, PATROL_MAX_CONCURRENT - views.length),
    patrols: Number(stats?.n ?? 0),
    hours: Math.round(Number(stats?.ms ?? 0) / 3600_000),
  };
}

/** Начислить машину. Дубликаты копятся счётчиком — коллекция не «сгорает». */
export function grantPlane(sql: SqlStorage, playerId: string, plane: PlaneId, now: number): number {
  const row = sql.exec('SELECT count FROM player_planes WHERE player_id = ? AND plane = ?', playerId, plane).toArray()[0];
  const count = row ? Number(row.count) + 1 : 1;
  sql.exec(
    `INSERT INTO player_planes (player_id, plane, count, first_at, last_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (player_id, plane) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
    playerId, plane, now, now,
  );
  return count;
}

export function ownsPlane(sql: SqlStorage, playerId: string, plane: PlaneId): boolean {
  return sql.exec('SELECT 1 FROM player_planes WHERE player_id = ? AND plane = ?', playerId, plane).toArray().length > 0;
}

/** Модели, которые у игрока уже есть. Нужны боксам и патрулям, чтобы не выдавать повтор. */
export function ownedPlanes(sql: SqlStorage, playerId: string): Set<PlaneId> {
  const rows = sql.exec('SELECT plane FROM player_planes WHERE player_id = ? AND count > 0', playerId).toArray();
  return new Set(rows.map((r) => String(r.plane) as PlaneId).filter((id) => PLANE_ORDER.includes(id)));
}

/**
 * Что нашёл патруль. Чистая функция от seed — как и `rollBox`: ответ сохранён в
 * журнале патрулей, поэтому находку можно пересчитать и проверить.
 *
 * `owned` — коллекция игрока. Повторов звено не носит: найденная машина обязана
 * быть новой, иначе патруль превращался бы в «×2 того же Стрижа». Ступени
 * перебираются по весам таблицы: своя ступень → остальные по убыванию веса; если
 * несобранного в этих ступенях ничего нет, возвращаем null. Пустое `owned`
 * воспроизводит старый результат байт в байт — seed ради этого и лежит в строке.
 */
export function rollPatrol(plane: PlaneId, seed: string, owned?: ReadonlySet<PlaneId>): PlaneId | null {
  const rarity = PLANES[plane].rarity;
  // Попадание — двумя байтами (11–12), шанс маленький; ступень и модель — по байту.
  if (seedUnit16(seed, 11) >= PATROL[rarity].find) return null;
  const table = PATROL_FIND[rarity];
  const total = table.reduce((sum, t) => sum + t.weight, 0);
  const roll = seedUnit(seed, 13) * total;
  let acc = 0;
  let picked: PlaneRarity = table[0].rarity;
  for (const tier of table) {
    acc += tier.weight;
    if (roll < acc) { picked = tier.rarity; break; }
  }
  const fresh = (tier: PlaneRarity): PlaneId | null => {
    const all = planesOfRarity(tier);
    const pool = owned && owned.size ? all.filter((id) => !owned.has(id)) : all;
    if (!pool.length) return null;
    const index = Math.min(pool.length - 1, Math.floor(seedUnit(seed, 14) * pool.length));
    return pool[index];
  };
  const direct = fresh(picked);
  if (direct) return direct;
  for (const tier of table) {
    if (tier.rarity === picked) continue;
    const alt = fresh(tier.rarity);
    if (alt) return alt;
  }
  return null;
}

export function startPatrol(sql: SqlStorage, playerId: string, idemKey: string, planeId: string, now: number) {
  return withIdempotency(sql, playerId, 'plane_patrol', idemKey, { plane: planeId }, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    if (!isPlaneId(planeId)) throw new ApiError(400, 'bad_plane');
    if (!ownsPlane(sql, playerId, planeId)) throw new ApiError(409, 'plane_not_owned');
    const air = patrolRows(sql, playerId);
    // Один борт — один вылет: гонять «Стрижа» двумя патрулями смысла нет, а слот
    // он занял бы.
    if (air.some((row) => String(row.plane) === planeId)) throw new ApiError(409, 'patrol_busy');
    // Слотов больше, чем одна машина, — это и есть «звено»: четыре борта летают
    // разом. Пять и больше — уже конвейер, который не надо было бы строить.
    if (air.length >= PATROL_MAX_CONCURRENT) throw new ApiError(409, 'patrol_slots_full');

    const ms = PATROL[PLANES[planeId].rarity].ms;
    const id = crypto.randomUUID();
    // 16 байт: находке нужно четыре (11–14), остальное — запас на будущие поля.
    const seed = crypto.randomUUID().replace(/-/g, '');
    sql.exec(
      `INSERT INTO plane_patrols (id, player_id, plane, seed, started_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'flying')`,
      id, playerId, planeId, seed, now, now + ms,
    );
    return {
      value: {
        patrol: patrolViewOf({ id, plane: planeId, started_at: now, ends_at: now + ms }, now),
        planes: planesView(sql, playerId, now),
      },
      store: true,
    };
  });
}

/**
 * Сдать патрули: один запрос забирает **все** вернувшиеся борта.
 *
 * Намеренно не по одному: кликать по числу слотов — это работа, а не игра. Каждый
 * вернувшийся борт закрывается своей записью в журнале с sourceRef = id патруля,
 * поэтому начисление воспроизводимо и сверка видит ровно те же суммы.
 */
export function claimPatrol(sql: SqlStorage, playerId: string, idemKey: string, now: number) {
  return withIdempotency(sql, playerId, 'plane_patrol_claim', idemKey, {}, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    const rows = sql.exec(
      `SELECT id, plane, seed, started_at, ends_at FROM plane_patrols
       WHERE player_id = ? AND status = 'flying' ORDER BY started_at`,
      playerId,
    ).toArray();
    if (!rows.length) throw new ApiError(404, 'no_patrol');
    const ready = rows.filter((row) => now >= Number(row.ends_at));
    if (!ready.length) {
      const soonest = Math.min(...rows.map((row) => Number(row.ends_at)));
      throw new ApiError(409, 'patrol_flying', Math.ceil((soonest - now) / 1000));
    }

    const rarities: PlaneRarity[] = [];
    // Коллекция обновляется прямо в цикле: вторая вернувшаяся машина не должна
    // найти то, что только что принёс первый борт.
    const collected = ownedPlanes(sql, playerId);
    const foundList: {
      id: PlaneId; name: string; rarity: PlaneRarity; rarityName: string; sprite: string; count: number; firstTime: boolean;
    }[] = [];
    let xpTotal = 0;
    for (const row of ready) {
      const plane = String(row.plane) as PlaneId;
      const rarity = PLANES[plane].rarity;
      const patrolId = String(row.id);
      const found = rollPatrol(plane, String(row.seed), collected);
      if (found) collected.add(found);
      sql.exec(
        `UPDATE plane_patrols SET status = 'done', found = ?, claimed_at = ? WHERE id = ?`,
        found, now, patrolId,
      );
      rarities.push(rarity);
      // Закладка вылета: ресурсы идут в тот же журнал, что и рейсы.
      for (const [resource, amount] of Object.entries(PATROL[rarity].salvage)) {
        applyResourceDelta(sql, {
          playerId, resource, delta: amount, reason: 'plane_salvage', sourceRef: patrolId, idemKey,
        }, now);
      }
      const xp = PATROL[rarity].xp;
      if (xp) {
        applyXp(sql, { playerId, delta: xp, reason: 'plane_salvage', sourceRef: patrolId, idemKey }, now, levelFromXp);
        xpTotal += xp;
      }
      if (found) {
        const count = grantPlane(sql, playerId, found, now);
        foundList.push({
          id: found,
          name: PLANES[found].name,
          rarity: PLANES[found].rarity,
          rarityName: PLANE_RARITY_NAMES[PLANES[found].rarity],
          sprite: planeSprite(found),
          count,
          firstTime: count === 1,
        });
      }
    }

    return {
      value: {
        // Одна находка или несколько: клиент показывает список, а не угадывает.
        found: foundList[0] ?? null,
        foundList,
        claimed: ready.length,
        xp: xpTotal,
        plane: String(ready[0].plane) as PlaneId,
        salvage: sumSalvage(rarities),
        // Обратная совместимость: старый клиент читает `planes.patrol`.
        planes: planesView(sql, playerId, now),
      },
      store: true,
    };
  });
}

/** Что принёс залп: суммы по всем вернувшимся бортам. */
function sumSalvage(rarities: PlaneRarity[]): { resource: string; name: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const rarity of rarities) {
    for (const [resource, amount] of Object.entries(PATROL[rarity].salvage)) {
      totals.set(resource, (totals.get(resource) ?? 0) + amount);
    }
  }
  return [...totals.entries()].map(([resource, amount]) => ({
    resource, name: RESOURCE_NAMES[resource] ?? resource, amount,
  }));
}
