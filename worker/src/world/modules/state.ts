import { FUEL_DAILY_MAX, FUEL_UNIT_PRICE, utcDay } from '../../shared/constants';
import {
  EXPEDITION_TYPES, NEUTRAL_FX, PLANETS, RESOURCE_NAMES, SECTORS, SHIP_ORDER, SHIPS, sectorById,
  type ExpeditionKind, type ModuleFx, type ShipType,
} from '../../shared/gameData';
import { durationOf, fuelCost, repairCost, rewardRange, xpThreshold } from './expeditionMath';
import { fxOfShip, moduleStateFor } from './shipModules';
import { listExpeditions } from './expeditions';
import { craftCatalog, listCraftJobs } from './crafting';
import { craftSlotsFor } from './pass';
import { guildOf, roleOf } from './guilds';
import { dailyOf, fuelCap, getResource, isFrozen, verifyStatus } from './maintenance';
import { playerPayload } from '../scheduler';
import { marketView } from './market';
import { getPlayerState } from './players';
import { seasonBrief } from './season';
import { minigameBrief } from './minigame';
import { garageView } from './garage';
import { planesView } from './planes';
import { ownIdentity } from './identity';

export function buildState(sql: SqlStorage, playerId: string, now: number, premium = false) {
  const base = getPlayerState(sql, playerId);
  const day = utcDay(now);
  const daily = dailyOf(sql, playerId, day);
  const cap = fuelCap(sql, playerId);
  const owned = new Set(base.ships.map((s) => String(s.type)));
  // Эффекты модулей считаются один раз на корабль: тот же объект идёт в цену
  // ремонта, в варианты рейса и в блок «Модули».
  const fxByShip = new Map<string, ModuleFx>();
  for (const raw of base.ships) fxByShip.set(String(raw.id), fxOfShip(sql, String(raw.id)));
  const ships = base.ships.map((raw) => {
    const type = String(raw.type) as ShipType;
    const def = SHIPS[type];
    const durability = Number(raw.durability);
    const status = String(raw.status);
    // Ниже 50 % ремонт требует alloy_plate. С этапа 2 пластину можно скрафтить,
    // поэтому это уже не запрет, а цена: показываем её, если пластина есть.
    const needsPlate = durability < 50;
    const hasPlate = getResource(sql, playerId, 'alloy_plate') >= 1;
    const repairMult = fxByShip.get(String(raw.id))?.repair ?? 1;
    let repair: { blocked: 'ok' | 'busy' | 'full' | 'needs_plate'; cost: number | null; plate: boolean } = { blocked: 'full', cost: null, plate: false };
    if (status !== 'idle') repair = { blocked: 'busy', cost: null, plate: needsPlate };
    else if (needsPlate) {
      repair = hasPlate
        ? { blocked: 'ok', cost: repairCost(100 - durability, def.repairCoef, repairMult), plate: true }
        : { blocked: 'needs_plate', cost: null, plate: true };
    } else if (durability < 100) {
      repair = { blocked: 'ok', cost: repairCost(100 - durability, def.repairCoef, repairMult), plate: false };
    }
    return { id: String(raw.id), type, name: def.name, durability, status, repair };
  });
  const activeShip = ships[0];
  const shipFx = activeShip ? (fxByShip.get(activeShip.id) ?? NEUTRAL_FX) : NEUTRAL_FX;
  const planets = PLANETS.map((planet) => {
    const sector = sectorById(planet.sector);
    const levelLocked = base.level < sector.level;
    const rangeLocked = !activeShip || SHIPS[activeShip.type].maxSector < planet.sector;
    const locked = levelLocked || rangeLocked;
    const options = locked || !activeShip ? [] : (['short', 'medium', 'long'] as ExpeditionKind[]).map((kind) => {
      const type = EXPEDITION_TYPES[kind];
      const range = rewardRange(planet.id, activeShip.type, kind, shipFx);
      return {
        kind, label: type.label, durationMs: durationOf(kind, shipFx), xp: type.xp, fuel: fuelCost(SHIPS[activeShip.type].consumption, kind),
        astra: range.astra, units: range.units,
      };
    });
    return {
      id: planet.id, name: planet.name, sector: planet.sector, sectorName: sector.name,
      resources: planet.resources.map((id) => ({ id, name: RESOURCE_NAMES[id] ?? id })),
      difficulty: planet.difficulty, locked,
      lock: levelLocked ? `Нужен уровень ${sector.level}` : rangeLocked ? 'Корабль не долетает до сектора' : null,
      options,
    };
  });
  const regen = sql.exec(
    `SELECT MIN(run_at) AS t FROM jobs WHERE kind = 'fuel_regen' AND status = 'pending' AND payload = ?`,
    playerPayload(playerId),
  ).toArray();
  const nextFuelAt = regen.length && regen[0].t != null ? Number(regen[0].t) : null;
  return {
    ...base,
    ships,
    xpNext: xpThreshold(base.level + 1),
    // Шкала уровня: от порога текущего уровня до следующего. Без xpPrev клиент
    // не может честно нарисовать прогресс — он начинается не с нуля.
    xpPrev: xpThreshold(base.level),
    resources: sql.exec('SELECT resource, amount FROM resources WHERE player_id = ? AND amount > 0 ORDER BY resource', playerId).toArray()
      .map((r) => ({ id: String(r.resource), name: RESOURCE_NAMES[String(r.resource)] ?? String(r.resource), amount: Number(r.amount) })),
    fuel: { cap, price: FUEL_UNIT_PRICE, boughtToday: daily.fuelBought, dailyMax: FUEL_DAILY_MAX, nextAt: nextFuelAt },
    // Клиент строит список планет и варианты рейса из этого поля. Без него вкладка
    // «Рейс» падала на state.planets.filter и экран оставался пустым.
    planets,
    expeditions: listExpeditions(sql, playerId),
    frozen: isFrozen(sql),
    verify: verifyStatus(sql, now),
    // Крафт: каталог рецептов и запущенные задачи. Очередь — один слот.
    craft: { slots: craftSlotsFor(sql, playerId), running: listCraftJobs(sql, playerId), recipes: craftCatalog() },
    // Модули: каталог с ценами по уровням и состояние каждого корабля.
    modules: moduleStateFor(sql, playerId),
    // Гараж: сколько ячеек, сколько занято и почём следующая.
    garage: garageView(sql, playerId, premium),
    // Авиазвено: коллекция из боксов и летающий патруль. Ни ASTRA, ни ресурсов
    // патруль не даёт — только машины и часы налёта.
    planes: planesView(sql, playerId, now),
    // Своя карточка: позывной, рамка, след, значок и срок Premium.
    profile: ownIdentity(sql, playerId, now),
    catalog: SHIP_ORDER.map((type) => {
      const def = SHIPS[type];
      return {
        type, name: def.name, rarity: def.rarity, cargo: def.cargo, tank: def.tank, consumption: def.consumption,
        mining: def.mining, price: def.price, unlockLevel: def.unlockLevel, owned: owned.has(type),
        locked: !owned.has(type),
      };
    }),
    sectors: SECTORS.map((s) => ({ id: s.id, name: s.name, level: s.level, open: base.level >= s.level })),
    // Рынок: открытые лоты, коридор по каждому ресурсу и лимиты. Считается в том
    // же ответе /me: клиенту не нужен отдельный поход в /market на старте.
    market: marketView(sql, playerId, now),
    // Сезон: номер, рамки, дни до конца и место в рейтинге. Полный рейтинг —
    // в отдельном /season, чтобы /me не раздувался на сто игроков.
    season: seasonBrief(sql, playerId, now),
    // Мини-игра короткой строкой: сколько попыток, побед и что дальше по ступеням.
    minigame: minigameBrief(sql, playerId, now, premium),
    // Гильдия короткой строкой для мостика: полный экран — отдельным /guild.
    guild: (() => {
      const g = guildOf(sql, playerId);
      return g ? { id: g.id, name: g.name, tag: g.tag, role: roleOf(sql, playerId) } : null;
    })(),
  };
}

export function listLedger(sql: SqlStorage, playerId: string, limit: number) {
  const n = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 20;
  return sql.exec(
    `SELECT seq, asset, delta, reason, source_ref, created_at FROM ledger WHERE player_id = ? ORDER BY seq DESC LIMIT ?`,
    playerId, n,
  ).toArray().map((r) => ({
    seq: Number(r.seq), asset: String(r.asset), delta: Number(r.delta), reason: String(r.reason),
    sourceRef: r.source_ref == null ? null : String(r.source_ref), createdAt: Number(r.created_at),
  }));
}
