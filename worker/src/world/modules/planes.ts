import {
  PATROL, PATROL_FIND, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, isPlaneId, planeSprite,
  planesOfRarity, type PlaneId, type PlaneRarity,
} from '../../shared/gameData';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { seedUnit, seedUnit16 } from './expeditionMath';
import { assertPlayable } from './maintenance';
import { playerExists } from './players';

// Авиазвено (этап 6). Две части, и обе намеренно без экономики:
//
//  1. Коллекция: машины падают из боксов (редкость задана в `BOXES[].plane`).
//  2. Патруль: машина летает сама и иногда находит ещё одну. Ни ASTRA, ни
//     ресурсов, ни очков — иначе звеном можно было бы фармить экономику в обход
//     рейсов: машин восемь, а рейс у корабля один.
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
}

export interface PlanesState {
  found: number;
  total: number;
  models: PlaneView[];
  patrol: PatrolView | null;
  /** Сколько патрулей завершено и сколько часов налёта. */
  patrols: number;
  hours: number;
}

function patrolRow(sql: SqlStorage, playerId: string) {
  return sql.exec(
    `SELECT id, plane, started_at, ends_at FROM plane_patrols
     WHERE player_id = ? AND status = 'flying' ORDER BY started_at LIMIT 1`,
    playerId,
  ).toArray()[0];
}

function patrolViewOf(row: Record<string, unknown>, now: number): PatrolView {
  const plane = String(row.plane) as PlaneId;
  const def = PLANES[plane];
  return {
    id: String(row.id),
    plane,
    name: def?.name ?? plane,
    sprite: planeSprite(plane),
    rarity: def?.rarity ?? 'common',
    rarityName: PLANE_RARITY_NAMES[def?.rarity ?? 'common'],
    startedAt: Number(row.started_at),
    endsAt: Number(row.ends_at),
    ready: Number(row.ends_at) <= now,
    findChance: PATROL[def?.rarity ?? 'common'].find,
  };
}

/** Полка звена: все модели, включая ещё не найденные (count 0), плюс патруль. */
export function planesView(sql: SqlStorage, playerId: string, now: number): PlanesState {
  const rows = sql.exec('SELECT plane, count, first_at FROM player_planes WHERE player_id = ?', playerId).toArray();
  const byId = new Map(rows.map((r) => [String(r.plane), r]));
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
    };
  });
  const stats = sql.exec(
    `SELECT COUNT(*) AS n, COALESCE(SUM(ends_at - started_at), 0) AS ms
     FROM plane_patrols WHERE player_id = ? AND status = 'done'`,
    playerId,
  ).toArray()[0];
  const active = patrolRow(sql, playerId);
  return {
    found: models.filter((m) => m.count > 0).length,
    total: PLANE_ORDER.length,
    models,
    patrol: active ? patrolViewOf(active, now) : null,
    patrols: Number(stats?.n ?? 0),
    hours: Math.round(Number(stats?.ms ?? 0) / 3600_000),
  };
}

/** Начислить машину. Дубликаты копятся счётчиком — коллекция не«сгорает». */
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

/**
 * Что нашёл патруль. Чистая функция от seed — как и `rollBox`: ответ сохранён в
 * журнале патрулей, поэтому находку можно пересчитать и проверить.
 */
export function rollPatrol(plane: PlaneId, seed: string): PlaneId | null {
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
  const pool = planesOfRarity(picked);
  if (!pool.length) return null;
  const index = Math.min(pool.length - 1, Math.floor(seedUnit(seed, 14) * pool.length));
  return pool[index];
}

export function startPatrol(sql: SqlStorage, playerId: string, idemKey: string, planeId: string, now: number) {
  return withIdempotency(sql, playerId, 'plane_patrol', idemKey, { plane: planeId }, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    if (!isPlaneId(planeId)) throw new ApiError(400, 'bad_plane');
    if (!ownsPlane(sql, playerId, planeId)) throw new ApiError(409, 'plane_not_owned');
    // Патруль один на игрока: восемь машин, летающих разом, — это уже очередь
    // бесплатных находок, а не занятие. Долгий полёт — второй тормоз.
    if (patrolRow(sql, playerId)) throw new ApiError(409, 'patrol_busy');

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

export function claimPatrol(sql: SqlStorage, playerId: string, idemKey: string, now: number) {
  return withIdempotency(sql, playerId, 'plane_patrol_claim', idemKey, {}, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    const row = sql.exec(
      `SELECT id, plane, seed, ends_at FROM plane_patrols
       WHERE player_id = ? AND status = 'flying' ORDER BY started_at LIMIT 1`,
      playerId,
    ).toArray()[0];
    if (!row) throw new ApiError(404, 'no_patrol');
    const endsAt = Number(row.ends_at);
    if (now < endsAt) throw new ApiError(409, 'patrol_flying', Math.ceil((endsAt - now) / 1000));

    const plane = String(row.plane) as PlaneId;
    const found = rollPatrol(plane, String(row.seed));
    sql.exec(
      `UPDATE plane_patrols SET status = 'done', found = ?, claimed_at = ? WHERE id = ?`,
      found, now, String(row.id),
    );
    const count = found ? grantPlane(sql, playerId, found, now) : 0;

    return {
      value: {
        found: found
          ? {
            id: found,
            name: PLANES[found].name,
            rarity: PLANES[found].rarity,
            rarityName: PLANE_RARITY_NAMES[PLANES[found].rarity],
            sprite: planeSprite(found),
            count,
            firstTime: count === 1,
          }
          : null,
        plane,
        // Ни ASTRA, ни ресурсов: патруль возвращает только машину или ничего.
        planes: planesView(sql, playerId, now),
      },
      store: true,
    };
  });
}
