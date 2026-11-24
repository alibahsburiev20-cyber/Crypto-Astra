import { EXPEDITION_FULL_REWARD, POINTS_HARD_CAP, POINTS_SOFT_CAP, REPAIR_ASTRA_PER_PERCENT } from '../../shared/constants';
import {
  EVENTS, EXPEDITION_TYPES, EVENT_KINDS, NEUTRAL_FX, PLANET_BY_ID, SHIPS, sectorById,
  type EventKind, type ExpeditionKind, type ModuleFx, type PlanetDef, type ShipType,
} from '../../shared/gameData';

export function isKind(v: string): v is ExpeditionKind {
  return v === 'short' || v === 'medium' || v === 'long';
}

export function fuelCost(consumption: number, kind: ExpeditionKind): number {
  return Math.ceil(consumption * EXPEDITION_TYPES[kind].fuelMult - 1e-9);
}

export function xpThreshold(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 60 && xp >= xpThreshold(level + 1)) level++;
  return level;
}

/** Байт seed в диапазоне 0..1. seed — hex, минимум 16 символов (8 байт). */
export function seedUnit(seed: string, byteIndex: number): number {
  const hex = seed.slice(byteIndex * 2, byteIndex * 2 + 2);
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n) || hex.length !== 2) throw new Error('bad_seed');
  return n / 255;
}

/**
 * То же, что `seedUnit`, но по двум байтам: 65536 значений вместо 256. Нужно для
 * очень маленьких шансов — на одном байте 0.4 % и 0.8 % слиплись бы в 1/256.
 */
export function seedUnit16(seed: string, byteIndex: number): number {
  const hi = Number.parseInt(seed.slice(byteIndex * 2, byteIndex * 2 + 2), 16);
  const lo = Number.parseInt(seed.slice(byteIndex * 2 + 2, byteIndex * 2 + 4), 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) throw new Error('bad_seed');
  return ((hi << 8) | lo) / 65535;
}

export function seedMultiplier(seed: string): number {
  return 0.8 + seedUnit(seed, 0) * 0.4;
}

export function rareHit(seed: string, baseChance: number, scannerBonus = 0): boolean {
  const chance = Math.min(0.4, baseChance * (1 + scannerBonus));
  return seedUnit(seed, 1) < chance;
}

export function durabilityLoss(seed: string, dangerous: boolean, extra: number): number {
  const [lo, hi] = dangerous ? [10, 25] : [5, 15];
  const base = lo + Math.floor(seedUnit(seed, 2) * (hi - lo));
  return Math.min(100, base + extra);
}

export function eventKindFor(seed: string, index: number): EventKind {
  const n = Number.parseInt(seed.slice(4 + index * 2, 6 + index * 2), 16);
  return EVENT_KINDS[n % EVENT_KINDS.length];
}

export function eventSchedule(start: number, end: number, count: number): { opensAt: number; deadlineAt: number }[] {
  const dur = end - start;
  const window = Math.min(30 * 60 * 1000, Math.floor(dur * 0.25));
  const out: { opensAt: number; deadlineAt: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const opensAt = start + Math.floor((dur * i) / (count + 1));
    out.push({ opensAt, deadlineAt: Math.min(end, opensAt + window) });
  }
  return out;
}

export function canCancel(startedAt: number, endsAt: number, now: number): boolean {
  return now <= startedAt + Math.floor((endsAt - startedAt) * 0.1);
}

export function repairCost(lostPercent: number, coef: number, repairMult = 1): number {
  return Math.round(REPAIR_ASTRA_PER_PERCENT * lostPercent * coef * repairMult);
}

/** Длительность рейса с учётом двигателя. Считается один раз при старте. */
export function durationOf(kind: ExpeditionKind, fx: ModuleFx = NEUTRAL_FX): number {
  return Math.round(EXPEDITION_TYPES[kind].durationMs * fx.duration);
}

export interface RewardInput {
  planet: PlanetDef;
  shipType: ShipType;
  kind: ExpeditionKind;
  seed: string;
  eventBonusBp: number;
  extraWear: number;
  durability: number;
  expeditionsToday: number;
  pointsToday: number;
  scannerBonus?: number;
  /** Множители от модулей корабля. Без них рейс считается как раньше. */
  fx?: ModuleFx;
}

export interface ResourceStack { resource: string; amount: number }

export interface Reward {
  resources: ResourceStack[];
  astra: number;
  points: number;
  xp: number;
  wear: number;
  rare: boolean;
  diminished: boolean;
  units: number;
}

function splitCargo(total: number, planet: PlanetDef, rare: boolean): ResourceStack[] {
  const out: ResourceStack[] = [];
  let left = total;
  if (rare && planet.rare && left > 0) {
    out.push({ resource: planet.rare, amount: 1 });
    left -= 1;
  }
  const [primary, secondary] = planet.resources;
  if (secondary && left >= 2) {
    const sec = Math.floor(left * 0.3);
    if (sec > 0) {
      out.push({ resource: secondary, amount: sec });
      left -= sec;
    }
  }
  if (left > 0) out.push({ resource: primary, amount: left });
  return out;
}

export function computeReward(i: RewardInput): Reward {
  const type = EXPEDITION_TYPES[i.kind];
  const ship = SHIPS[i.shipType];
  const sector = sectorById(i.planet.sector);
  const dangerous = sector.id >= 4;
  const fx = i.fx ?? NEUTRAL_FX;
  const diminished = i.expeditionsToday >= EXPEDITION_FULL_REWARD;
  const low = i.durability < 30;
  const seedMult = seedMultiplier(i.seed);
  const eventBonus = i.eventBonusBp / 1000;
  let units = i.planet.difficulty * type.qty * ship.mining * fx.mining * seedMult * eventBonus;
  if (low) units *= 0.5;
  if (diminished) units *= 0.5;
  // Грузовой отсек расширяет трюм, поэтому потолок тоже растёт.
  const cargoCap = Math.max(0, Math.floor(ship.cargo * fx.cargo));
  const capped = Math.max(0, Math.min(cargoCap, Math.floor(units)));
  const rare = rareHit(i.seed, i.planet.rareChance, (i.scannerBonus ?? 0) + fx.scanner) && capped > 0;
  let astra = i.planet.difficulty * type.astra * seedMult * eventBonus;
  if (diminished) astra *= 0.5;
  const rawPoints = Math.floor(i.planet.difficulty * 10 * type.pointsMult * (dangerous ? 1.5 : 1));
  let points = i.pointsToday >= POINTS_SOFT_CAP ? Math.floor(rawPoints * 0.5) : rawPoints;
  points = Math.max(0, Math.min(points, POINTS_HARD_CAP - i.pointsToday));
  return {
    resources: splitCargo(capped, i.planet, rare),
    astra: Math.floor(astra),
    points,
    xp: type.xp,
    // Щит срезает износ, но рейс в любом случае что-то стоит: минимум 1 %.
    wear: Math.max(1, Math.round(durabilityLoss(i.seed, dangerous, i.extraWear) * fx.wear)),
    rare,
    diminished,
    units: capped,
  };
}

/** Оценка для клиента: границы seed 0.8 и 1.2, без события и без редкой находки. Не награда. */
export function rewardRange(
  planetId: string, shipType: ShipType, kind: ExpeditionKind, fx: ModuleFx = NEUTRAL_FX,
): { astra: [number, number]; units: [number, number] } {
  const planet = PLANET_BY_ID[planetId];
  const base = {
    planet, shipType, kind, eventBonusBp: 1000, extraWear: 0, durability: 100,
    expeditionsToday: 0, pointsToday: 0, fx,
  };
  const lo = computeReward({ ...base, seed: '00'.repeat(8) });
  const hi = computeReward({ ...base, seed: 'ff'.repeat(8) });
  return {
    astra: [Math.min(lo.astra, hi.astra), Math.max(lo.astra, hi.astra)],
    units: [Math.min(lo.units, hi.units), Math.max(lo.units, hi.units)],
  };
}

export interface EventOutcome {
  eventBonusBp: number;
  extraWear: number;
  fuel: number;
  risky: boolean;
  success: boolean;
}

export function applyEventChoice(seed: string, index: number, kind: EventKind, choiceId: string, bonusBp: number): EventOutcome {
  const def = EVENTS[kind];
  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error('bad_choice');
  if (choice.safe) {
    const bonus = choiceId === 'careful' ? Math.floor(bonusBp * 105 / 100) : bonusBp;
    return { eventBonusBp: bonus, extraWear: 0, fuel: 0, risky: false, success: true };
  }
  const roll = seedUnit(seed, 3 + index);
  const success = roll >= 0.5;
  if (success) {
    return {
      eventBonusBp: Math.floor(bonusBp * 135 / 100),
      extraWear: 0,
      fuel: choiceId === 'help' ? 1 : 0,
      risky: true,
      success: true,
    };
  }
  return {
    eventBonusBp: Math.max(100, Math.floor(bonusBp * 70 / 100)),
    extraWear: 10 + Math.floor(roll * 15),
    fuel: 0,
    risky: true,
    success: false,
  };
}

export function safeChoiceId(kind: EventKind): string {
  const c = EVENTS[kind].choices.find((x) => x.safe);
  if (!c) throw new Error('bad_event');
  return c.id;
}
