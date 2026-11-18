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

export const RECIPES: Record<RecipeId, Recipe> = {
  energy_cell: {
    id: 'energy_cell', name: 'Энергоячейка',
    inputs: [{ resource: 'helium3', amount: 3 }, { resource: 'silicon', amount: 2 }],
    ms: 30 * 60 * 1000, fee: 50,
  },
  circuit: {
    id: 'circuit', name: 'Схема',
    inputs: [{ resource: 'copper_ore', amount: 2 }, { resource: 'silicon', amount: 1 }, { resource: 'crystal', amount: 1 }],
    ms: 20 * 60 * 1000, fee: 40,
  },
  alloy_plate: {
    id: 'alloy_plate', name: 'Сплавная пластина',
    inputs: [{ resource: 'iron_ore', amount: 3 }, { resource: 'titanium', amount: 1 }],
    ms: 20 * 60 * 1000, fee: 60,
  },
};

export const RECIPE_ORDER: RecipeId[] = ['energy_cell', 'circuit', 'alloy_plate'];

export function isRecipeId(value: string): value is RecipeId {
  return (RECIPE_ORDER as string[]).includes(value);
}
