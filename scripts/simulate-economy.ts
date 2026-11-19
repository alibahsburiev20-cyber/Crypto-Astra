/**
 * Симуляция экономики этапа 2 и социального этапа 4 на реальных формулах и ценах игры.
 *
 * Запуск: npm run simulate -- --players 200 --days 30 --claims 32 --max-expeditions 5 --social
 *
 * Что считается (срез 7): Claim, награды экспедиций, топливо, ремонт, плата за крафт,
 * модули, верфь и налог рынка. Цель — стоки возвращают 70–90 % выпущенной валюты.
 * С флагом `--social` добавляется выпуск этапа 4 (миссии, Astra Pass, рефералы) и
 * сток за создание гильдий: награды берутся из тех же констант, что и в игре, а
 * прогресс миссий — из действий игрока в симуляции, а не из «примерно столько».
 *
 * Модель поведения (это допущения, а не правила игры):
 *  · игрок заходит раз в день, делает Claim и до N рейсов;
 *  · ремонтируется, когда прочность ниже 70 %, и только если хватает ASTRA;
 *  · ставит модули по порядку, если есть цена и компоненты, и держит резерв;
 *  · покупает следующий корабль, когда накопил цену плюс резерв;
 *  · лишние ресурсы продаёт на рынке (это перевод между игроками: в поглощение
 *    идёт только 5 % налога, а не вся выручка).
 */
import {
  CLAIM_DAILY_MAX, FUEL_DAILY_MAX, FUEL_REGEN_MS, FUEL_UNIT_PRICE, GUILD_CREATE_COST, PASS_REWARDS,
  PASS_THRESHOLDS, REFERRAL_REWARD, REPAIR_ASTRA_PER_PERCENT, START_ASTRA, START_FUEL,
} from '../worker/src/shared/constants';
import { dailyMissions, weeklyMission, type Metric } from '../worker/src/world/modules/missions';
import { seasonRewardFor } from '../worker/src/world/modules/season';
import {
  EXPEDITION_TYPES, MODULES, MODULE_MAX_LEVEL, MODULE_ORDER, PLANETS, RECIPE_ORDER, RECIPES, RESOURCE_BASE_PRICES,
  SHIPS, marketTax, moduleFx, moduleParts, modulePrice, sectorById,
  type ExpeditionKind, type ModuleId, type PlanetDef, type ShipType,
} from '../worker/src/shared/gameData';
import { computeReward, fuelCost, levelFromXp, repairCost } from '../worker/src/world/modules/expeditionMath';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Args {
  players: number;
  days: number;
  claims: number;
  maxExpeditions: number;
  seed: number;
  reserve: number;
  /** Пробные коэффициенты: с ними ищем значения, потом переносим в константы. */
  repairPerPct: number | null;
  astraMult: number | null;
  /** Доля дневного дохода, которую игрок готов вложить в модули и корабли. */
  invest: number;
  /** Смешанная популяция: новички, обычные, активные. */
  mix: boolean;
  /** Считать призы за закрытие сезона (гейт 3). */
  season: boolean;
  /** Считать выпуск этапа 4: миссии, Astra Pass, рефералы, гильдии. */
  social: boolean;
  /** Доля игроков, пришедших по приглашению (допущение модели). */
  invited: number;
}

function parseArgs(argv: string[]): Args {
  const arg = (name: string, fallback: number): number => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0 || i + 1 >= argv.length) return fallback;
    const n = Number(argv[i + 1]);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    players: Math.max(1, Math.floor(arg('players', 200))),
    days: Math.max(1, Math.floor(arg('days', 30))),
    claims: Math.min(CLAIM_DAILY_MAX, Math.max(0, Math.floor(arg('claims', 32)))),
    maxExpeditions: Math.max(0, Math.floor(arg('max-expeditions', 5))),
    seed: Math.floor(arg('seed', 1)),
    // Резерв: игрок не тратит последнее, иначе нечем покупать топливо.
    reserve: Math.max(0, Math.floor(arg('reserve', 250))),
    repairPerPct: argv.includes('--repair-percent') ? arg('repair-percent', 0) : null,
    astraMult: argv.includes('--astra-mult') ? arg('astra-mult', 1) : null,
    invest: Math.min(1, Math.max(0, arg('invest', 0.4))),
    mix: argv.includes('--mix'),
    season: argv.includes('--season'),
    social: argv.includes('--social'),
    invited: Math.min(1, Math.max(0, arg('invited', 0.25))),
  };
}

/** Архетипы игроков: онлайна в игре ещё нет, поэтому это гипотеза, а не факт. */
const ARCHETYPES = [
  { id: 'новичок', share: 0.5, claims: 10, flights: 2, invest: 0.4 },
  { id: 'обычный', share: 0.35, claims: 32, flights: 5, invest: 0.4 },
  { id: 'активный', share: 0.15, claims: 64, flights: 8, invest: 0.35 },
];

// Детерминированный PRNG: один и тот же seed даёт один и тот же отчёт.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexSeed(rnd: () => number): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += Math.floor(rnd() * 256).toString(16).padStart(2, '0');
  return out;
}

interface SimShip {
  type: ShipType;
  durability: number;
  modules: Partial<Record<ModuleId, number>>;
}

interface Player {
  astra: number;
  fuel: number;
  /** Очки сезона: в игре это баланс `points`, он же рейтинг. */
  points: number;
  xp: number;
  level: number;
  ships: SimShip[];
  res: Record<string, number>;
  craftMinutes: number;
  /** Копилка на прогресс: сюда откладывается доля дохода, отсюда платятся модули и корабли. */
  fund: number;
}

interface Totals {
  claims: number;
  expeditionAstra: number;
  fuelSpend: number;
  repairSpend: number;
  craftSpend: number;
  moduleSpend: number;
  shipSpend: number;
  marketTax: number;
  marketTurnover: number;
  flights: number;
  crafts: number;
  modulesInstalled: number;
  shipsBought: number;
  stuck: number;
  finalAstra: number;
  finalDurability: number;
  finalLevel: number;
  soldUnits: number;
  seasonRewards: number;
  seasonPlayers: number;
  /** Действия игроков за прогон: из них считается прогресс миссий этапа 4. */
  sales: number;
  purchases: number;
  repairs: number;
  sessions: number;
  /** Сумма очков сезона: по ней определяется уровень Astra Pass. */
  points: number;
}

const SHIP_ORDER: ShipType[] = ['hauler', 'miner', 'explorer', 'cruiser'];
/** Пустые счётчики: один список на все места, где собираем итоги. */
const ZERO: Totals = {
  claims: 0, expeditionAstra: 0, fuelSpend: 0, repairSpend: 0, craftSpend: 0, moduleSpend: 0,
  shipSpend: 0, marketTax: 0, marketTurnover: 0, flights: 0, crafts: 0, modulesInstalled: 0,
  shipsBought: 0, stuck: 0, finalAstra: 0, finalDurability: 0, finalLevel: 0, soldUnits: 0,
  seasonRewards: 0, seasonPlayers: 0, sales: 0, purchases: 0, repairs: 0, sessions: 0, points: 0,
};
const zeroTotals = (): Totals => ({ ...ZERO });

function installed(ship: SimShip): { module: ModuleId; level: number }[] {
  return MODULE_ORDER.filter((id) => (ship.modules[id] ?? 0) > 0)
    .map((id) => ({ module: id, level: ship.modules[id] as number }));
}

function usedSlots(ship: SimShip): number {
  return MODULE_ORDER.filter((id) => (ship.modules[id] ?? 0) > 0).length;
}

function fleetCap(p: Player): number {
  let cap = 0;
  for (const ship of p.ships) {
    const bonus = (ship.modules.fuel_system ?? 0) * MODULES.fuel_system.perLevel;
    cap = Math.max(cap, SHIPS[ship.type].tank + bonus);
  }
  return cap;
}

function have(p: Player, resource: string): number {
  return p.res[resource] ?? 0;
}

/** Плановая установка: первый по порядку модуль, который ещё не на максимуме. */
function nextModule(ship: SimShip): { id: ModuleId; level: number } | null {
  for (const id of MODULE_ORDER) {
    const level = ship.modules[id] ?? 0;
    if (level < MODULE_MAX_LEVEL) break;
  }
  for (const id of MODULE_ORDER) {
    const level = ship.modules[id] ?? 0;
    if (level === 0 && usedSlots(ship) < SHIPS[ship.type].slots) return { id, level: 1 };
    if (level > 0 && level < MODULE_MAX_LEVEL) return { id, level: level + 1 };
  }
  return null;
}

/**
 * Сколько чего игроку нужно в ближайшее время: компоненты под следующий модуль и
 * сырьё под их крафт, плюс пластина для крупного ремонта. По этому списку он и
 * выбирает планету — иначе возит один ресурс и не может крафтить.
 */
function needs(p: Player): Map<string, number> {
  const need = new Map<string, number>();
  const add = (resource: string, amount: number): void => {
    need.set(resource, Math.max(need.get(resource) ?? 0, amount));
  };
  for (const ship of p.ships) {
    const next = nextModule(ship);
    if (!next) continue;
    for (const part of moduleParts(next.id, next.level)) {
      if ((RECIPE_ORDER as string[]).includes(part.resource)) {
        const recipe = RECIPES[part.resource as (typeof RECIPE_ORDER)[number]];
        for (const input of recipe.inputs) add(input.resource, input.amount);
      } else {
        add(part.resource, part.amount);
      }
    }
  }
  if (p.ships.some((s) => s.durability < 55) && have(p, 'alloy_plate') === 0) {
    for (const input of RECIPES.alloy_plate.inputs) add(input.resource, input.amount);
  }
  return need;
}

function simulate(args: Args): Totals {
  const rnd = mulberry32(args.seed);
  const t: Totals = zeroTotals();
  const regenPerDay = Math.floor(DAY_MS / FUEL_REGEN_MS);
  // Очки сезона по игрокам: нужны, чтобы прикинуть призы за закрытие сезона.
  const scores: number[] = [];

  for (let n = 0; n < args.players; n++) {
    const claimsPerDay = args.claims;
    const flightsPerDay = args.maxExpeditions;
    const invest = args.invest;
    const p: Player = {
      astra: START_ASTRA,
      fuel: START_FUEL,
      points: 0,
      xp: 0,
      level: 1,
      ships: [{ type: 'scout', durability: 100, modules: {} }],
      res: {},
      craftMinutes: 0,
      fund: 0,
    };

    const repair = (ship: SimShip): boolean => {
      if (ship.durability >= 100) return false;
      const fx = moduleFx(installed(ship));
      const lost = 100 - ship.durability;
      const cost = args.repairPerPct == null
        ? repairCost(lost, SHIPS[ship.type].repairCoef, fx.repair)
        : Math.round(args.repairPerPct * lost * SHIPS[ship.type].repairCoef * fx.repair);
      const needsPlate = ship.durability < 50;
      if (p.astra < cost || (needsPlate && have(p, 'alloy_plate') < 1)) return false;
      if (needsPlate) p.res.alloy_plate -= 1;
      p.astra -= cost;
      t.repairSpend += cost;
      t.repairs += 1;
      ship.durability = 100;
      return true;
    };

    const craft = (id: (typeof RECIPE_ORDER)[number]): boolean => {
      const recipe = RECIPES[id];
      // craftMinutes — минуты, ms в рецепте — миллисекунды.
      const minutes = Math.ceil(recipe.ms / 60000);
      if (p.craftMinutes < minutes) return false;
      if (p.astra < recipe.fee) return false;
      if (recipe.inputs.some((i) => have(p, i.resource) < i.amount)) return false;
      for (const i of recipe.inputs) p.res[i.resource] -= i.amount;
      p.astra -= recipe.fee;
      p.craftMinutes -= minutes;
      p.res[id] = have(p, id) + 1;
      t.craftSpend += recipe.fee;
      t.crafts += 1;
      return true;
    };

    for (let day = 0; day < args.days; day++) {
      t.sessions += 1;
      p.fuel = Math.min(fleetCap(p), p.fuel + regenPerDay);
      p.craftMinutes = 24 * 60; // один слот крафта на игрока, но за день его много
      const claims = claimsPerDay;
      p.astra += claims * 5;
      t.claims += claims * 5;
      // В копилку на прогресс уходит доля дохода. Копить на корабль за 6000 ASTRA —
      // нормальное поведение, поэтому покупка ждёт, пока в копилке хватит.
      p.fund += claims * 5 * invest;

      // ── Рейсы ──────────────────────────────────────────────────────────────
      let flightsToday = 0;
      let boughtToday = 0;
      let pointsToday = 0;
      while (flightsToday < flightsPerDay) {
        const ship = p.ships
          .filter((s) => s.durability > 0)
          .sort((a, b) => b.durability - a.durability)[0];
        if (!ship) break;

        if (ship.durability < 70) {
          if (!repair(ship)) {
            // Нужна пластина: крафтим её, если есть руда и ASTRA на плату.
            if (ship.durability < 50 && have(p, 'alloy_plate') === 0) {
              while (have(p, 'alloy_plate') === 0 && craft('alloy_plate')) { /* плавим, пока выходит */ }
            }
            if (!repair(ship)) break;
          }
        }

        const fx = moduleFx(installed(ship));
        const r = rnd();
        const kinds: ExpeditionKind[] = [];
        if (p.fuel >= fuelCost(SHIPS[ship.type].consumption, 'long') && r < 0.05) kinds.push('long');
        else if (p.fuel >= fuelCost(SHIPS[ship.type].consumption, 'medium') && r < 0.35) kinds.push('medium');
        else kinds.push('short');
        const kind = kinds[0];
        const cost = fuelCost(SHIPS[ship.type].consumption, kind);
        while (p.fuel < cost && boughtToday < FUEL_DAILY_MAX && p.astra >= FUEL_UNIT_PRICE + args.reserve) {
          p.fuel += 1;
          p.astra -= FUEL_UNIT_PRICE;
          t.fuelSpend += FUEL_UNIT_PRICE;
          boughtToday += 1;
        }
        if (p.fuel < cost) break;

        const open = PLANETS.filter((pl) => pl.sector <= SHIPS[ship.type].maxSector
          && p.level >= sectorById(pl.sector).level);
        if (!open.length) break;
        // Игрок ищет то, чего не хватает для следующего модуля или пластины, а потом
        // уже самое сложное: иначе он вечно возит один ресурс и не может крафтить.
        const want = needs(p);
        const score = (pl: PlanetDef): number => {
          let sc = pl.difficulty * 0.5;
          for (const r of pl.resources) {
            const target = want.get(r) ?? 0;
            const haveNow = have(p, r);
            if (target > 0 && haveNow < target) sc += 3;
            else if (target > 0 && haveNow < target * 3) sc += 1;
          }
          return sc;
        };
        const planet: PlanetDef = open.reduce((a, b) => (score(b) > score(a) ? b : a));
        const reward = computeReward({
          planet, shipType: ship.type, kind, seed: hexSeed(rnd), eventBonusBp: 1000,
          extraWear: 0, durability: ship.durability, expeditionsToday: flightsToday, pointsToday, fx,
        });

        p.fuel -= cost;
        const astraGain = args.astraMult == null ? reward.astra : Math.round(reward.astra * args.astraMult);
        p.astra += astraGain;
        ship.durability = Math.max(0, ship.durability - reward.wear);
        p.xp += reward.xp;
        p.level = levelFromXp(p.xp);
        p.points += reward.points;
        pointsToday += reward.points;
        t.expeditionAstra += astraGain;
        p.fund += astraGain * invest;
        t.flights += 1;
        flightsToday += 1;
        for (const stack of reward.resources) p.res[stack.resource] = have(p, stack.resource) + stack.amount;
      }

      // ── Крафт под модули ──────────────────────────────────────────────────
      for (const ship of p.ships) {
        const next = nextModule(ship);
        if (!next) continue;
        for (const part of moduleParts(next.id, next.level)) {
          const isComponent = (RECIPE_ORDER as string[]).includes(part.resource);
          if (!isComponent) continue;
          while (have(p, part.resource) < part.amount && craft(part.resource as (typeof RECIPE_ORDER)[number])) {
            // крафтим ровно столько, сколько не хватает
          }
        }
      }

      // ── Модули ─────────────────────────────────────────────────────────────
      for (const ship of p.ships) {
        const next = nextModule(ship);
        if (!next) continue;
        const price = modulePrice(next.id, next.level);
        const parts = moduleParts(next.id, next.level);
        const partsOk = parts.every((x) => have(p, x.resource) >= x.amount);
        if (!partsOk || p.astra < price + args.reserve) continue;
        if (p.fund < price) continue;
        for (const x of parts) p.res[x.resource] -= x.amount;
        p.astra -= price;
        t.moduleSpend += price;
        ship.modules[next.id] = next.level;
        p.fund -= price;
        t.modulesInstalled += 1;
        t.purchases += 1;
      }

      // ── Верфь ──────────────────────────────────────────────────────────────
      for (const type of SHIP_ORDER) {
        const def = SHIPS[type];
        if (def.price == null) continue;
        if (p.ships.some((s) => s.type === type)) continue;
        if (p.level < def.unlockLevel) continue;
        if (p.astra < def.price + args.reserve) continue;
        if (p.fund < def.price) continue;
        p.astra -= def.price;
        p.fund -= def.price;
        t.shipSpend += def.price;
        t.shipsBought += 1;
        p.ships.push({ type, durability: 100, modules: {} });
        break;
      }

      // ── Рынок: лишние ресурсы уходят другим игрокам ────────────────────────
      // Выручка — перевод между игроками, поэтому баланс от неё не растёт:
      // в поглощение идёт только налог. Иначе один игрок «печатал» бы ASTRA.
      const keep: Record<string, number> = { iron_ore: 6, copper_ore: 6, silicon: 6, ice: 6 };
      let revenue = 0;
      let units = 0;
      for (const [resource, amount] of Object.entries(p.res)) {
        const surplus = amount - (keep[resource] ?? 2);
        if (surplus <= 0) continue;
        const price = RESOURCE_BASE_PRICES[resource];
        if (!price) continue;
        p.res[resource] = amount - surplus;
        revenue += surplus * price;
        units += surplus;
      }
      if (revenue > 0) {
        t.marketTurnover += revenue;
        t.marketTax += marketTax(revenue);
        t.soldUnits += units;
        t.sales += 1; // один лот за день
      }
    }

    t.finalAstra += p.astra;
    t.points += p.points;
    t.finalDurability += p.ships.reduce((a, s) => a + s.durability, 0) / p.ships.length;
    t.finalLevel += p.level;
    // Застрял: все корабли ниже 50 %, пластины нет и на крафт пластины не хватает.
    const broken = p.ships.every((s) => s.durability < 50);
    const canPlate = have(p, 'alloy_plate') > 0 || (p.astra >= RECIPES.alloy_plate.fee
      && RECIPES.alloy_plate.inputs.every((i) => have(p, i.resource) >= i.amount));
    if (broken && !canPlate) t.stuck += 1;
    scores.push(p.points);
  }
  // Призы закрытого сезона: те же места и суммы, что в SEASON_REWARDS.
  scores.sort((a, b) => b - a);
  scores.forEach((points, i) => {
    const reward = seasonRewardFor(i + 1, points);
    if (reward > 0) {
      t.seasonRewards += reward;
      t.seasonPlayers += 1;
    }
  });
  return t;
}


interface SocialTotals {
  missionsAstra: number;
  missionsPoints: number;
  weeklyAstra: number;
  passAstra: number;
  passLevel: number;
  referralAstra: number;
  referrals: number;
  guildSpend: number;
  emission: number;
}

/**
 * Выпуск этапа 4 на действиях игрока из симуляции: награды — те же константы,
 * что в игре, набор миссий — та же детерминированная функция дня/недели.
 * Это модель, а не факт: доля приглашённых и создателей гильдий — допущения.
 */
function socialOf(r: Run, invitedShare: number): SocialTotals {
  const perDay = (n: number): number => n / Math.max(1, r.players * r.days);
  const metric: Record<Metric, number> = {
    expeditions: perDay(r.flights),
    crafts: perDay(r.crafts),
    // В Totals.claims лежит ASTRA за Claim (5 за раз), поэтому делим.
    claims: perDay(r.claims / 5),
    repairs: perDay(r.repairs),
    sales: perDay(r.sales),
    purchases: perDay(r.purchases),
  };
  const out: SocialTotals = {
    missionsAstra: 0, missionsPoints: 0, weeklyAstra: 0, passAstra: 0, passLevel: 0,
    referralAstra: 0, referrals: 0, guildSpend: 0, emission: 0,
  };
  const playerCount = Math.max(1, Math.round(r.players));
  const weeks = Math.floor(r.days / 7);
  for (let i = 0; i < playerCount; i += 1) {
    const id = `sim-${r.label}-${i}`;
    for (let d = 0; d < r.days; d += 1) {
      for (const mission of dailyMissions(id, 20000 + d)) {
        if (metric[mission.metric] < mission.target) continue;
        out.missionsAstra += mission.astra;
        out.missionsPoints += mission.points;
      }
    }
    for (let w = 0; w < weeks; w += 1) {
      const mission = weeklyMission(id, 2800 + w);
      if (metric[mission.metric] * 7 < mission.target) continue;
      out.weeklyAstra += mission.astra;
      out.missionsPoints += mission.points;
    }
    const points = r.points / playerCount;
    const level = PASS_THRESHOLDS.filter((t) => points >= t).length;
    out.passLevel += level;
    for (let lv = 1; lv <= level; lv += 1) out.passAstra += PASS_REWARDS[lv]?.astra ?? 0;
  }
  out.passLevel = out.passLevel / playerCount;
  // Приглашённый получает награду, когда отлетает 5 рейсов; в симуляции летают все.
  out.referrals = Math.round(playerCount * invitedShare);
  out.referralAstra = out.referrals * REFERRAL_REWARD * 2;
  // Гильдии — сток: одна на десять игроков, создатель платит 500 из своих.
  out.guildSpend = Math.ceil(playerCount / 10) * GUILD_CREATE_COST;
  out.emission = out.missionsAstra + out.weeklyAstra + out.passAstra + out.referralAstra;
  return out;
}

const args = parseArgs(process.argv.slice(2));
const fmt = (n: number): string => Math.round(n).toLocaleString('ru-RU');

interface Run extends Totals {
  label: string;
  players: number;
  days: number;
  claimsPerDay: number;
  flightsPerDay: number;
  invest: number;
}

function addTotals(a: Totals, b: Totals): Totals {
  const out = { ...a };
  for (const key of Object.keys(b) as (keyof Totals)[]) out[key] += b[key];
  return out;
}

function run(label: string, players: number, claims: number, flights: number, invest: number): Run {
  const sub: Args = { ...args, players, claims, maxExpeditions: flights, invest };
  return { ...simulate(sub), label, players, days: args.days, claimsPerDay: claims, flightsPerDay: flights, invest };
}

const runs: Run[] = args.mix
  ? ARCHETYPES.map((a) => run(a.id, Math.max(1, Math.round(args.players * a.share)), a.claims, a.flights, a.invest))
  : [run('профиль', args.players, args.claims, args.maxExpeditions, args.invest)];

const total = runs.reduce((acc, r) => addTotals(acc, r), zeroTotals());
const totalPlayers = runs.reduce((a, r) => a + r.players, 0);

const created = total.claims + total.expeditionAstra;
const sinksOf = (t: Totals): number => t.fuelSpend + t.repairSpend + t.craftSpend + t.moduleSpend + t.shipSpend + t.marketTax;
/** Награды за закрытие сезона считаются выпуском, а не стоком. */
const seasonOf = (): number => (args.season ? total.seasonRewards : 0);
const sinks = sinksOf(total);
const ratio = created > 0 ? (sinks / created) * 100 : 0;
const shareOf = (n: number): string => `${created > 0 ? ((n / created) * 100).toFixed(1) : '0.0'}%`;

console.log(`Crypto Astra — симуляция экономики этапа 2 (${args.days} дн., ${totalPlayers} игроков, seed ${args.seed})`);
if (args.mix) {
  console.log(`Популяция: ${ARCHETYPES.map((a) => `${a.id} ${Math.round(a.share * 100)}%`).join(', ')}`);
} else {
  console.log(`Профиль: ${args.claims} Claim/день, до ${args.maxExpeditions} рейсов/день, резерв ${args.reserve} ASTRA, в прогресс ${Math.round(args.invest * 100)}% дохода`);
}
if (args.repairPerPct != null || args.astraMult != null) {
  console.log(`ПРОБНЫЙ ПРОГОН: ремонт ${args.repairPerPct ?? REPAIR_ASTRA_PER_PERCENT}/%, награда ×${args.astraMult ?? 1} — в константы ещё не внесено`);
}
console.log('');
console.log('Источники ASTRA:');
console.log(`  Claim: ${fmt(total.claims)}`);
console.log(`  награды экспедиций (${fmt(total.flights)} рейсов): ${fmt(total.expeditionAstra)}`);
console.log(`  всего выпущено: ${fmt(created)}`);
console.log('Стоки ASTRA:');
console.log(`  топливо:            ${fmt(total.fuelSpend)} (${shareOf(total.fuelSpend)})`);
console.log(`  ремонт:             ${fmt(total.repairSpend)} (${shareOf(total.repairSpend)})`);
console.log(`  плата за крафт:     ${fmt(total.craftSpend)} (${shareOf(total.craftSpend)}) кр. ${fmt(total.crafts)}`);
console.log(`  модули:             ${fmt(total.moduleSpend)} (${shareOf(total.moduleSpend)}) шт. ${fmt(total.modulesInstalled)}`);
console.log(`  верфь:              ${fmt(total.shipSpend)} (${shareOf(total.shipSpend)}) шт. ${fmt(total.shipsBought)}`);
console.log(`  налог рынка 5%:     ${fmt(total.marketTax)} (${shareOf(total.marketTax)}) оборот ${fmt(total.marketTurnover)}`);
console.log(`  всего стоков: ${fmt(sinks)}`);
console.log('');
console.log(`Поглощение: ${ratio.toFixed(1)}% (цель 70–90%)`);
console.log(`Средний баланс: ${fmt(total.finalAstra / totalPlayers)} ASTRA · уровень ${(total.finalLevel / totalPlayers).toFixed(1)} · прочность ${(total.finalDurability / totalPlayers).toFixed(0)}%`);
console.log(`Продано на рынке: ${fmt(total.soldUnits)} единиц ресурсов`);
console.log(`Застряло без ремонта: ${total.stuck} из ${totalPlayers}`);
if (args.season) {
  // Призы — это тоже выпуск ASTRA, поэтому поглощение считаем уже с ними.
  const createdWithSeason = created + total.seasonRewards;
  const ratioWithSeason = createdWithSeason > 0 ? (sinks / createdWithSeason) * 100 : 0;
  console.log('');
  console.log(`Сезон 8 недель: призы ${fmt(total.seasonRewards)} ASTRA на ${fmt(total.seasonPlayers)} игроков`);
  console.log(`  это ${(created > 0 ? (total.seasonRewards / created) * 100 : 0).toFixed(1)}% выпуска за ${args.days} дн.`);
  console.log(`Поглощение с призами: ${ratioWithSeason.toFixed(1)}% (цель 70–90%)`);
}

// Этап 4: миссии, Astra Pass и рефералы печатают ASTRA, гильдии — сток.
// Поглощение пересчитывается с ними: иначе отчёт врёт в лучшую сторону.
let ratioFinal = ratio;
let createdFinal = created + seasonOf();
if (args.social) {
  const social = runs.reduce((acc, r) => {
    const one = socialOf(r, args.invited);
    return {
      missionsAstra: acc.missionsAstra + one.missionsAstra,
      missionsPoints: acc.missionsPoints + one.missionsPoints,
      weeklyAstra: acc.weeklyAstra + one.weeklyAstra,
      passAstra: acc.passAstra + one.passAstra,
      passLevel: acc.passLevel + one.passLevel * r.players,
      referralAstra: acc.referralAstra + one.referralAstra,
      referrals: acc.referrals + one.referrals,
      guildSpend: acc.guildSpend + one.guildSpend,
      emission: acc.emission + one.emission,
    } as SocialTotals;
  }, { missionsAstra: 0, missionsPoints: 0, weeklyAstra: 0, passAstra: 0, passLevel: 0, referralAstra: 0, referrals: 0, guildSpend: 0, emission: 0 } as SocialTotals);
  const sinksFinal = sinks + social.guildSpend;
  createdFinal = created + seasonOf() + social.emission;
  ratioFinal = createdFinal > 0 ? (sinksFinal / createdFinal) * 100 : 0;
  const shareFinal = (n: number): string => `${createdFinal > 0 ? ((n / createdFinal) * 100).toFixed(1) : '0.0'}%`;
  console.log('');
  console.log('Социальное (этап 4):');
  console.log(`  миссии дневные:     ${fmt(social.missionsAstra)} ASTRA (${shareFinal(social.missionsAstra)}) · ${fmt(social.missionsPoints)} очков`);
  console.log(`  миссия недельная:   ${fmt(social.weeklyAstra)} ASTRA (${shareFinal(social.weeklyAstra)})`);
  console.log(`  Astra Pass:         ${fmt(social.passAstra)} ASTRA (${shareFinal(social.passAstra)}) · средний уровень ${(social.passLevel / totalPlayers).toFixed(1)}`);
  console.log(`  рефералы:           ${fmt(social.referralAstra)} ASTRA (${shareFinal(social.referralAstra)}) · ${fmt(social.referrals)} приглашённых`);
  console.log(`  всего выпущено с социальным: ${fmt(createdFinal)}`);
  console.log(`  создание гильдий:   -${fmt(social.guildSpend)} ASTRA (сток)`);
  console.log(`Поглощение с социальным: ${ratioFinal.toFixed(1)}% (цель 70–90%)`);
}

if (runs.length > 1) {
  console.log('');
  console.log('По архетипам:');
  console.log('  архетип    игроков  Claim   рейсов  в прогресс  поглощение  баланс');
  for (const r of runs) {
    const c = r.claims + r.expeditionAstra;
    const k = sinksOf(r);
    console.log(`  ${r.label.padEnd(9)}  ${String(r.players).padStart(6)}  ${String(r.claimsPerDay).padStart(6)}  ${String(r.flightsPerDay).padStart(6)}  ${String(Math.round(r.invest * 100) + '%').padStart(10)}  ${((c > 0 ? (k / c) * 100 : 0).toFixed(1) + '%').padStart(10)}  ${fmt(r.finalAstra / r.players).padStart(6)}`);
  }
}

if (ratioFinal < 70) {
  console.log('');
  console.log('Вывод: стоков мало. Поднимать надо расходы игрока (ремонт, крафт, модули),');
  console.log('а не резать Claim: иначе новичок не накопит на первый корабль.');
} else if (ratioFinal > 90) {
  console.log('');
  console.log('Вывод: стоки выше цели, экономика слишком жёсткая для новых игроков.');
}
