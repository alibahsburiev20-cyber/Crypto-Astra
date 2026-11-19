// Каталог из концепции v2.1. Базовые количества награды в expeditionMath — стартовые:
// в концепции задана форма формулы, но не целые «базовая_стоимость» по планетам.

export type ShipType = 'scout' | 'hauler' | 'miner' | 'explorer' | 'cruiser' | 'flagship';
export type ExpeditionKind = 'short' | 'medium' | 'long';

export interface ShipDef {
  type: ShipType;
  name: string;
  rarity: string;
  cargo: number;
  maxSector: number;
  tank: number;
  consumption: number;
  speed: number;
  mining: number;
  slots: number;
  /** null — не продаётся (старт или чертёж). */
  price: number | null;
  unlockLevel: number;
  repairCoef: number;
}

export const SHIPS: Record<ShipType, ShipDef> = {
  scout: { type: 'scout', name: 'Scout', rarity: 'Common', cargo: 10, maxSector: 2, tank: 5, consumption: 1, speed: 1, mining: 1, slots: 1, price: null, unlockLevel: 1, repairCoef: 1 },
  hauler: { type: 'hauler', name: 'Hauler', rarity: 'Uncommon', cargo: 40, maxSector: 2, tank: 8, consumption: 1.2, speed: 0.9, mining: 1, slots: 2, price: 1500, unlockLevel: 5, repairCoef: 1.5 },
  miner: { type: 'miner', name: 'Miner', rarity: 'Uncommon', cargo: 25, maxSector: 2, tank: 7, consumption: 1.1, speed: 1, mining: 1.5, slots: 2, price: 2000, unlockLevel: 5, repairCoef: 1.5 },
  explorer: { type: 'explorer', name: 'Explorer', rarity: 'Rare', cargo: 20, maxSector: 4, tank: 12, consumption: 1, speed: 1.3, mining: 1.1, slots: 3, price: 6000, unlockLevel: 12, repairCoef: 2 },
  cruiser: { type: 'cruiser', name: 'Cruiser', rarity: 'Epic', cargo: 60, maxSector: 4, tank: 15, consumption: 1.5, speed: 1.2, mining: 1.3, slots: 4, price: 20000, unlockLevel: 20, repairCoef: 2 },
  flagship: { type: 'flagship', name: 'Flagship', rarity: 'Legendary', cargo: 120, maxSector: 5, tank: 25, consumption: 2, speed: 1.5, mining: 1.6, slots: 6, price: null, unlockLevel: 30, repairCoef: 3 },
};

export const SHIP_ORDER: ShipType[] = ['scout', 'hauler', 'miner', 'explorer', 'cruiser', 'flagship'];

export interface SectorDef { id: number; name: string; level: number; danger: 'low' | 'mid' | 'high' | 'extreme' }
export const SECTORS: SectorDef[] = [
  { id: 1, name: 'Alpha Reach', level: 1, danger: 'low' },
  { id: 2, name: 'Beta Belt', level: 5, danger: 'low' },
  { id: 3, name: 'Gamma Drift', level: 12, danger: 'mid' },
  { id: 4, name: 'Delta Nebula', level: 20, danger: 'high' },
  { id: 5, name: 'Omega Edge', level: 30, danger: 'extreme' },
];

export interface PlanetDef {
  id: string;
  name: string;
  sector: number;
  resources: [string, string];
  rare?: string;
  difficulty: number;
  /** Базовый шанс редкой находки до бонуса сканера. Потолок 40% считается в формуле. */
  rareChance: number;
}

export const PLANETS: PlanetDef[] = [
  { id: 'ferra', name: 'Ferra', sector: 1, resources: ['iron_ore', 'copper_ore'], difficulty: 1, rareChance: 0.02 },
  { id: 'cinder', name: 'Cinder', sector: 1, resources: ['silicon', 'iron_ore'], difficulty: 1, rareChance: 0.02 },
  { id: 'lumen', name: 'Lumen', sector: 1, resources: ['ice', 'copper_ore'], difficulty: 2, rareChance: 0.04 },
  { id: 'tessera', name: 'Tessera', sector: 2, resources: ['titanium', 'silicon'], difficulty: 2, rareChance: 0.05 },
  { id: 'marrow', name: 'Marrow', sector: 2, resources: ['helium3', 'ice'], difficulty: 3, rareChance: 0.06 },
  { id: 'glacia', name: 'Glacia', sector: 2, resources: ['ice', 'crystal'], difficulty: 3, rareChance: 0.07 },
  { id: 'vesper', name: 'Vesper', sector: 3, resources: ['crystal', 'titanium'], difficulty: 4, rareChance: 0.08 },
  { id: 'halcyon', name: 'Halcyon', sector: 3, resources: ['helium3', 'crystal'], difficulty: 4, rareChance: 0.09 },
  { id: 'rime', name: 'Rime', sector: 3, resources: ['titanium', 'astralite'], rare: 'astralite', difficulty: 5, rareChance: 0.12 },
  { id: 'nyx', name: 'Nyx', sector: 4, resources: ['astralite', 'void_crystal'], rare: 'void_crystal', difficulty: 6, rareChance: 0.16 },
  { id: 'solace', name: 'Solace', sector: 4, resources: ['crystal', 'quantum_dust'], rare: 'quantum_dust', difficulty: 6, rareChance: 0.16 },
  { id: 'umbra', name: 'Umbra', sector: 4, resources: ['void_crystal', 'astralite'], difficulty: 7, rareChance: 0.18 },
  { id: 'kharon', name: 'Kharon', sector: 5, resources: ['void_crystal', 'quantum_dust'], difficulty: 8, rareChance: 0.22 },
  { id: 'aether', name: 'Aether', sector: 5, resources: ['quantum_dust', 'astralite'], difficulty: 9, rareChance: 0.26 },
  { id: 'zenith', name: 'Zenith', sector: 5, resources: ['quantum_dust', 'void_crystal'], difficulty: 10, rareChance: 0.3 },
];

export const PLANET_BY_ID: Record<string, PlanetDef> = Object.fromEntries(PLANETS.map((p) => [p.id, p]));

export function sectorById(id: number): SectorDef {
  const s = SECTORS.find((x) => x.id === id);
  if (!s) throw new Error('bad_sector');
  return s;
}

export interface ExpeditionTypeDef {
  kind: ExpeditionKind;
  durationMs: number;
  fuelMult: number;
  pointsMult: number;
  events: number;
  xp: number;
  /** Множитель количества ресурсов: difficulty × qty. */
  qty: number;
  /** Множитель ASTRA: difficulty × astra. Стартовое число. */
  astra: number;
  label: string;
}

export const EXPEDITION_TYPES: Record<ExpeditionKind, ExpeditionTypeDef> = {
  short: { kind: 'short', durationMs: 15 * 60 * 1000, fuelMult: 1, pointsMult: 1, events: 0, xp: 10, qty: 2, astra: 8, label: 'Короткая' },
  medium: { kind: 'medium', durationMs: 4 * 60 * 60 * 1000, fuelMult: 2, pointsMult: 3, events: 1, xp: 30, qty: 5, astra: 24, label: 'Средняя' },
  long: { kind: 'long', durationMs: 24 * 60 * 60 * 1000, fuelMult: 4, pointsMult: 8, events: 2, xp: 80, qty: 10, astra: 60, label: 'Длинная' },
};

export type EventKind = 'anomaly' | 'drifting_cargo' | 'meteor' | 'distress';

export interface EventChoice { id: string; safe: boolean; label: string }
export interface EventDef { title: string; text: string; choices: [EventChoice, EventChoice] }

export const EVENTS: Record<EventKind, EventDef> = {
  anomaly: {
    title: 'Аномалия',
    text: 'Курс пересекает аномалию.',
    choices: [
      { id: 'bypass', safe: true, label: 'Обойти' },
      { id: 'explore', safe: false, label: 'Исследовать' },
    ],
  },
  drifting_cargo: {
    title: 'Дрейфующий груз',
    text: 'Рядом беспилотный контейнер.',
    choices: [
      { id: 'careful', safe: true, label: 'Забрать осторожно' },
      { id: 'grab', safe: false, label: 'Забрать быстро' },
    ],
  },
  meteor: {
    title: 'Метеорный поток',
    text: 'Впереди метеоры.',
    choices: [
      { id: 'shield', safe: true, label: 'Закрыться щитом' },
      { id: 'maneuver', safe: false, label: 'Манёвр' },
    ],
  },
  distress: {
    title: 'Сигнал бедствия',
    text: 'Кто-то просит помощи.',
    choices: [
      { id: 'ignore', safe: true, label: 'Не отвечать' },
      { id: 'help', safe: false, label: 'Помочь' },
    ],
  },
};

export const EVENT_KINDS: EventKind[] = ['anomaly', 'drifting_cargo', 'meteor', 'distress'];

export const RESOURCE_NAMES: Record<string, string> = {
  iron_ore: 'Железная руда',
  copper_ore: 'Медная руда',
  silicon: 'Кремний',
  ice: 'Лёд',
  helium3: 'Гелий-3',
  titanium: 'Титан',
  crystal: 'Кристалл',
  astralite: 'Астралит',
  void_crystal: 'Пустотный кристалл',
  quantum_dust: 'Квантовая пыль',
  energy_cell: 'Энергоячейка',
  circuit: 'Схема',
  alloy_plate: 'Сплавная пластина',
};

// Крафт (этап 2, срез 3). Компоненты — такие же ресурсы: лежат в resources и
// пишутся в журнал как res:<имя>.
export type RecipeId = 'energy_cell' | 'circuit' | 'alloy_plate';

export interface Recipe {
  id: RecipeId;
  name: string;
  inputs: { resource: string; amount: number }[];
  ms: number;
  /** Плата в ASTRA. Главный поглотитель этапа: без неё крафт только печатает ресурсы. */
  fee: number;
}

// Все рецепты собираются из ресурсов **первого сектора** (железо, медь, кремний,
// лёд). Это не мелочь: металл и кристаллы лежат в секторах 2+, а туда пускают с
// 5-го уровня. Прежние рецепты (титан, гелий-3, кристалл) были недостижимы первые
// часы игры — и пластину для ремонта нельзя было получить вообще.
// Инвариант проверяется тестом «рецепты доступны с первого уровня».
export const RECIPES: Record<RecipeId, Recipe> = {
  energy_cell: {
    id: 'energy_cell', name: 'Энергоячейка',
    inputs: [{ resource: 'ice', amount: 3 }, { resource: 'silicon', amount: 2 }],
    ms: 30 * 60 * 1000, fee: 50,
  },
  circuit: {
    id: 'circuit', name: 'Схема',
    inputs: [{ resource: 'copper_ore', amount: 3 }, { resource: 'silicon', amount: 2 }],
    ms: 20 * 60 * 1000, fee: 40,
  },
  alloy_plate: {
    id: 'alloy_plate', name: 'Сплавная пластина',
    inputs: [{ resource: 'iron_ore', amount: 3 }, { resource: 'copper_ore', amount: 2 }],
    ms: 20 * 60 * 1000, fee: 60,
  },
};

export const RECIPE_ORDER: RecipeId[] = ['energy_cell', 'circuit', 'alloy_plate'];

export function isRecipeId(value: string): value is RecipeId {
  return (RECIPE_ORDER as string[]).includes(value);
}

// ── Модули корабля (этап 2, срез 4) ────────────────────────────────────────────
// Модуль ставится на конкретный корабль и занимает слот (slots в ShipDef).
// Уровень 1..5, цена уровня L = basePrice × 2^(L−1), компоненты × L.
// Снять модуль нельзя: только поставить или улучшить. Это сознательно — иначе
// слоты обходились бы перестановкой, а вложенная ASTRA возвращалась бы игроку.
export type ModuleId = 'engine' | 'fuel_system' | 'scanner' | 'cargo_bay' | 'mining_drill' | 'shield' | 'repair_kit';
export type ModuleEffect = 'duration' | 'tank' | 'scanner' | 'cargo' | 'mining' | 'wear' | 'repair';

export const MODULE_MAX_LEVEL = 5;

export interface ModuleDef {
  id: ModuleId;
  name: string;
  /** Что меняет модуль. Один эффект на модуль, поэтому множители не складываются. */
  effect: ModuleEffect;
  /** Доля за уровень: 0.05 = 5 %. У топлива, износа, ремонта и длительности — снижение. */
  perLevel: number;
  /** Цена уровня 1. Уровень L стоит basePrice × 2^(L−1). */
  basePrice: number;
  /** Компоненты за уровень; на уровень L нужно amount × L. */
  parts: { resource: string; amount: number }[];
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  engine: {
    id: 'engine', name: 'Двигатель', effect: 'duration', perLevel: 0.03, basePrice: 1200,
    parts: [{ resource: 'circuit', amount: 1 }],
  },
  // Топливо целое: −5 % от 1 единицы всё равно даёт 1, поэтому модуль не снижает
  // расход, а расширяет бак — это видно сразу и работает на всех корпусах.
  fuel_system: {
    id: 'fuel_system', name: 'Топливная система', effect: 'tank', perLevel: 1, basePrice: 900,
    parts: [{ resource: 'energy_cell', amount: 1 }, { resource: 'circuit', amount: 1 }],
  },
  // Кристалл лежит в секторе 2 и выше — сканер собираем из схем и кремния,
  // иначе его нельзя прокачать первые часы игры (тест доступности это ловит).
  scanner: {
    id: 'scanner', name: 'Сканер', effect: 'scanner', perLevel: 0.15, basePrice: 1500,
    parts: [{ resource: 'circuit', amount: 2 }, { resource: 'silicon', amount: 4 }],
  },
  cargo_bay: {
    id: 'cargo_bay', name: 'Грузовой отсек', effect: 'cargo', perLevel: 0.1, basePrice: 2000,
    parts: [{ resource: 'alloy_plate', amount: 2 }],
  },
  mining_drill: {
    id: 'mining_drill', name: 'Бур', effect: 'mining', perLevel: 0.06, basePrice: 2500,
    parts: [{ resource: 'alloy_plate', amount: 2 }, { resource: 'circuit', amount: 1 }],
  },
  shield: {
    id: 'shield', name: 'Щит', effect: 'wear', perLevel: 0.08, basePrice: 3000,
    parts: [{ resource: 'alloy_plate', amount: 3 }, { resource: 'energy_cell', amount: 1 }],
  },
  repair_kit: {
    id: 'repair_kit', name: 'Ремкомплект', effect: 'repair', perLevel: 0.1, basePrice: 600,
    parts: [{ resource: 'circuit', amount: 1 }, { resource: 'alloy_plate', amount: 1 }],
  },
};

export const MODULE_ORDER: ModuleId[] = ['engine', 'fuel_system', 'scanner', 'cargo_bay', 'mining_drill', 'shield', 'repair_kit'];

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_ORDER as string[]).includes(value);
}

/** Цена следующего уровня: base × 2^(L−1). */
export function modulePrice(id: ModuleId, level: number): number {
  return Math.round(MODULES[id].basePrice * Math.pow(2, level - 1));
}

/** Компоненты на уровень L: количество растёт линейно. */
export function moduleParts(id: ModuleId, level: number): { resource: string; amount: number }[] {
  return MODULES[id].parts.map((p) => ({ resource: p.resource, amount: p.amount * level }));
}

export interface ModuleFx {
  duration: number;
  cargo: number;
  mining: number;
  wear: number;
  repair: number;
  /** Прибавки, а не множители: к баку и к шансу редкой находки. */
  tank: number;
  scanner: number;
}

export const NEUTRAL_FX: ModuleFx = { duration: 1, cargo: 1, mining: 1, wear: 1, repair: 1, tank: 0, scanner: 0 };

/** Множители от установленных модулей. Без модулей — ровно единицы. */
export function moduleFx(installed: { module: ModuleId; level: number }[]): ModuleFx {
  const fx: ModuleFx = { ...NEUTRAL_FX };
  for (const m of installed) {
    const def = MODULES[m.module];
    if (!def || m.level <= 0) continue;
    const level = Math.min(MODULE_MAX_LEVEL, Math.max(1, Math.round(m.level)));
    const shift = def.perLevel * level;
    if (def.effect === 'scanner') fx.scanner += shift;
    else if (def.effect === 'tank') fx.tank += shift;
    else if (def.effect === 'cargo' || def.effect === 'mining') fx[def.effect] *= 1 + shift;
    else fx[def.effect] *= 1 - shift;
  }
  return fx;
}

/** Подпись эффекта для уровня: то, что видит игрок. */
export function moduleEffectText(id: ModuleId, level: number): string {
  const def = MODULES[id];
  const pct = Math.round(def.perLevel * Math.min(MODULE_MAX_LEVEL, Math.max(0, level)) * 100);
  switch (def.effect) {
    case 'duration': return `−${pct} % длительности рейса`;
    case 'tank': return `+${Math.round(def.perLevel * level)} к запасу топлива`;
    case 'scanner': return `+${pct} % к шансу редкой находки`;
    case 'cargo': return `+${pct} % грузоподъёмности`;
    case 'mining': return `+${pct} % добычи`;
    case 'wear': return `−${pct} % износа`;
    case 'repair': return `−${pct} % стоимости ремонта`;
    default: return '';
  }
}

// ── Рынок (этап 2, срез 6) ────────────────────────────────────────────────────
// Торговля внутри мира: лоты с эскроу, налог в систему и коридор цены вокруг
// медианы сделок за неделю. Базовая цена нужна, пока сделок ещё не было.
export const RESOURCE_BASE_PRICES: Record<string, number> = {
  iron_ore: 4,
  copper_ore: 6,
  silicon: 8,
  ice: 5,
  helium3: 10,
  titanium: 14,
  crystal: 18,
  astralite: 30,
  void_crystal: 45,
  quantum_dust: 60,
  energy_cell: 120,
  circuit: 140,
  alloy_plate: 180,
};

/** 5 % в базисных пунктах: 500 bp = 5 %. */
export const MARKET_TAX_BP = 500;
export const MARKET_LOT_LIMIT = 10;
export const MARKET_MAX_AMOUNT = 1000;
export const MARKET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Коридор: ±50 % от медианы. */
export const MARKET_CORRIDOR_BP = 5000;

export function marketTax(gross: number): number {
  return Math.floor((gross * MARKET_TAX_BP) / 10000);
}
