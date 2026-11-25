import { DAY_MS } from './constants';

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
  /**
   * Ресурс-чертёж, из которого корабль собирается в ангаре. Нужен там, где
   * `price === null`: иначе у игрока нет ни цены, ни пути — только замок.
   */
  blueprint: RecipeId | null;
  unlockLevel: number;
  repairCoef: number;
}

export const SHIPS: Record<ShipType, ShipDef> = {
  scout: { type: 'scout', name: 'Scout', rarity: 'Common', cargo: 10, maxSector: 2, tank: 5, consumption: 1, speed: 1, mining: 1, slots: 2, price: null, blueprint: null, unlockLevel: 1, repairCoef: 1 },
  hauler: { type: 'hauler', name: 'Hauler', rarity: 'Uncommon', cargo: 40, maxSector: 2, tank: 8, consumption: 1.2, speed: 0.9, mining: 1, slots: 3, price: 1500, blueprint: null, unlockLevel: 5, repairCoef: 1.5 },
  miner: { type: 'miner', name: 'Miner', rarity: 'Uncommon', cargo: 25, maxSector: 2, tank: 7, consumption: 1.1, speed: 1, mining: 1.5, slots: 3, price: 2000, blueprint: null, unlockLevel: 5, repairCoef: 1.5 },
  explorer: { type: 'explorer', name: 'Explorer', rarity: 'Rare', cargo: 20, maxSector: 4, tank: 12, consumption: 1, speed: 1.3, mining: 1.1, slots: 5, price: 6000, blueprint: null, unlockLevel: 12, repairCoef: 2 },
  cruiser: { type: 'cruiser', name: 'Cruiser', rarity: 'Epic', cargo: 60, maxSector: 4, tank: 15, consumption: 1.5, speed: 1.2, mining: 1.3, slots: 6, price: 20000, blueprint: null, unlockLevel: 20, repairCoef: 2 },
  // Флагман — единственный борт, который дотягивает до 5-го сектора. Продавать
  // его за ASTRA нельзя (иначе дальность становится товаром), поэтому он
  // собирается из чертежа: `flagship_plans` крафтится из редких ресурсов 4-го
  // сектора, то есть путь к «Omega Edge» есть у того, кто долетел до «Nyx».
  flagship: { type: 'flagship', name: 'Flagship', rarity: 'Legendary', cargo: 120, maxSector: 5, tank: 25, consumption: 2, speed: 1.5, mining: 1.6, slots: 8, price: null, blueprint: 'flagship_plans', unlockLevel: 30, repairCoef: 3 },
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
  helium_coolant: 'Гелиевый хладагент',
  titanium_frame: 'Титановая рама',
  crystal_lens: 'Кристаллическая линза',
  astralite_core: 'Астралитовое ядро',
  void_weave: 'Пустотное полотно',
  quantum_matrix: 'Квантовая матрица',
  flagship_plans: 'Чертёж Flagship',
};

// Крафт (этап 2, срез 3). Компоненты — такие же ресурсы: лежат в resources и
// пишутся в журнал как res:<имя>.
export type RecipeId =
  | 'energy_cell' | 'circuit' | 'alloy_plate'
  | 'helium_coolant' | 'titanium_frame' | 'crystal_lens'
  | 'astralite_core' | 'void_weave' | 'quantum_matrix' | 'flagship_plans';

export interface Recipe {
  id: RecipeId;
  name: string;
  inputs: { resource: string; amount: number }[];
  ms: number;
  /** Плата в ASTRA. Главный поглотитель этапа: без неё крафт только печатает ресурсы. */
  fee: number;
  /**
   * Круг рецепта. 1 — стартовый: только ресурсы первого сектора, доступен с
   * нулевого уровня и закрывает ремонт и первые модули. 2 — дальний: в нём
   * редкие ресурсы секторов 2–5, поэтому он не обязателен новичку.
   */
  tier: 1 | 2;
}

// Рецепты первого круга собираются из ресурсов **первого сектора** (железо, медь,
// кремний, лёд). Это не мелочь: металл и кристаллы лежат в секторах 2+, а туда
// пускают с 5-го уровня. Прежние рецепты (титан, гелий-3, кристалл) были
// недостижимы первые часы игры — и пластину для ремонта нельзя было получить.
// Инвариант проверяется тестом «рецепты первого круга доступны с первого уровня».
//
// Второй круг существует ради обратной задачи: гелий-3, титан, кристалл,
// астралит, пустотный кристалл и квантовая пыль раньше только продавались на
// рынке — в мире их ничто не потребляло. Теперь каждый редкий ресурс входит в
// свой компонент, а компоненты нужны модулям с 4-го уровня (MODULE_LATE_LEVEL).
export const RECIPES: Record<RecipeId, Recipe> = {
  energy_cell: {
    id: 'energy_cell', name: 'Энергоячейка', tier: 1,
    inputs: [{ resource: 'ice', amount: 3 }, { resource: 'silicon', amount: 2 }],
    ms: 30 * 60 * 1000, fee: 50,
  },
  circuit: {
    id: 'circuit', name: 'Схема', tier: 1,
    inputs: [{ resource: 'copper_ore', amount: 3 }, { resource: 'silicon', amount: 2 }],
    ms: 20 * 60 * 1000, fee: 40,
  },
  alloy_plate: {
    id: 'alloy_plate', name: 'Сплавная пластина', tier: 1,
    inputs: [{ resource: 'iron_ore', amount: 3 }, { resource: 'copper_ore', amount: 2 }],
    ms: 20 * 60 * 1000, fee: 60,
  },
  // Второй круг. Входы дешёвые и добываются рядом с редким ресурсом, плата в
  // ASTRA выше — иначе редкий ресурс превращался бы в компонент бесплатно.
  helium_coolant: {
    id: 'helium_coolant', name: 'Гелиевый хладагент', tier: 2,
    inputs: [{ resource: 'helium3', amount: 3 }, { resource: 'ice', amount: 4 }, { resource: 'silicon', amount: 2 }],
    ms: 40 * 60 * 1000, fee: 90,
  },
  titanium_frame: {
    id: 'titanium_frame', name: 'Титановая рама', tier: 2,
    inputs: [{ resource: 'titanium', amount: 4 }, { resource: 'iron_ore', amount: 3 }, { resource: 'copper_ore', amount: 2 }],
    ms: 45 * 60 * 1000, fee: 110,
  },
  crystal_lens: {
    id: 'crystal_lens', name: 'Кристаллическая линза', tier: 2,
    inputs: [{ resource: 'crystal', amount: 3 }, { resource: 'silicon', amount: 4 }],
    ms: 50 * 60 * 1000, fee: 130,
  },
  astralite_core: {
    id: 'astralite_core', name: 'Астралитовое ядро', tier: 2,
    inputs: [{ resource: 'astralite', amount: 3 }, { resource: 'copper_ore', amount: 3 }, { resource: 'silicon', amount: 4 }],
    ms: 60 * 60 * 1000, fee: 180,
  },
  void_weave: {
    id: 'void_weave', name: 'Пустотное полотно', tier: 2,
    inputs: [{ resource: 'void_crystal', amount: 2 }, { resource: 'ice', amount: 3 }, { resource: 'silicon', amount: 3 }],
    ms: 70 * 60 * 1000, fee: 200,
  },
  quantum_matrix: {
    id: 'quantum_matrix', name: 'Квантовая матрица', tier: 2,
    inputs: [
      { resource: 'quantum_dust', amount: 2 }, { resource: 'crystal', amount: 1 },
      { resource: 'copper_ore', amount: 3 }, { resource: 'silicon', amount: 3 },
    ],
    ms: 90 * 60 * 1000, fee: 260,
  },
  // Чертёж флагмана. Единственный рецепт, на выходе у которого не компонент, а
  // документ: он не продаётся на рынке и не нужен модулям — он открывает верфь.
  // Входы собраны так, чтобы чертёж был виден игроку, который долетел до 4-го
  // сектора, но ещё не имеет права летать в 5-й: иначе получился бы замок,
  // который вскрывается только тем, кому он и так не нужен.
  flagship_plans: {
    id: 'flagship_plans', name: 'Чертёж Flagship', tier: 2,
    inputs: [
      { resource: 'quantum_dust', amount: 6 }, { resource: 'void_crystal', amount: 4 },
      { resource: 'titanium_frame', amount: 3 }, { resource: 'astralite_core', amount: 2 },
    ],
    ms: 6 * 60 * 60 * 1000, fee: 900,
  },
};

export const RECIPE_ORDER: RecipeId[] = [
  'energy_cell', 'circuit', 'alloy_plate',
  'helium_coolant', 'titanium_frame', 'crystal_lens',
  'astralite_core', 'void_weave', 'quantum_matrix', 'flagship_plans',
];

/** Рецепты первого круга: их видно новичку, они собираются из первого сектора. */
export const STARTER_RECIPES: RecipeId[] = RECIPE_ORDER.filter((id) => RECIPES[id].tier === 1);

// ── Авиазвено (этап 6) ───────────────────────────────────────────────────────
// Маленькие машины, которые падают из боксов и висят в гараже на полке. Это
// **коллекция, а не флот**: они не летают к планетам, не занимают ячейки под
// корабли и не приносят ASTRA. Но они умеют патрулировать — см. `PATROL`:
// за завершённый вылет машина тащит ресурсы и опыт. Бокс не стал бы заменой верфи,
// а флот печатным станком, если бы звено приносило валюту.
export type PlaneId = 'strizh' | 'osa' | 'kolibri' | 'skat' | 'sokol' | 'manta' | 'prizrak' | 'feniks';
export type PlaneRarity = 'common' | 'rare' | 'legendary';

export interface PlaneDef {
  id: PlaneId;
  name: string;
  rarity: PlaneRarity;
  /** Короткая строка для карточки: силуэт, а не характеристики. */
  hint: string;
}

export const PLANES: Record<PlaneId, PlaneDef> = {
  strizh: { id: 'strizh', name: 'Стриж', rarity: 'common', hint: 'Разведчик звена' },
  osa: { id: 'osa', name: 'Оса', rarity: 'common', hint: 'Перехватчик' },
  kolibri: { id: 'kolibri', name: 'Колибри', rarity: 'common', hint: 'Курьер' },
  skat: { id: 'skat', name: 'Скат', rarity: 'common', hint: 'Разведчик глубокого космоса' },
  sokol: { id: 'sokol', name: 'Сокол', rarity: 'rare', hint: 'Тяжёлый перехватчик' },
  manta: { id: 'manta', name: 'Манта', rarity: 'rare', hint: 'Дальний разведчик' },
  prizrak: { id: 'prizrak', name: 'Призрак', rarity: 'rare', hint: 'Ночная машина' },
  feniks: { id: 'feniks', name: 'Феникс', rarity: 'legendary', hint: 'Один на всю галактику' },
};

export const PLANE_ORDER: PlaneId[] = ['strizh', 'osa', 'kolibri', 'skat', 'sokol', 'manta', 'prizrak', 'feniks'];

/** От обычных к легендарным: порядок важен для розыгрыша и для полки. */
export const PLANE_RARITY_ORDER: PlaneRarity[] = ['common', 'rare', 'legendary'];

export function planesOfRarity(rarity: PlaneRarity): PlaneId[] {
  return PLANE_ORDER.filter((id) => PLANES[id].rarity === rarity);
}

/**
 * Сколько бортов звена может быть в воздухе одновременно.
 *
 * Это тормоз для конвейера: машин восемь, но летают четыре. Выбирать приходится
 * честно — редкая машина стоит слота дольше, зато приносит больше за вылет.
 */
export const PATROL_MAX_CONCURRENT = 4;

/**
 * Патруль: машина летает сама, тащит металлолом и иногда находит ещё одну машину.
 *
 * До этой правки патруль не приносил ничего — коллекция была украшением, а не
 * занятием. Теперь звено **добывает ресурсы и опыт**, но намеренно **не добывает
 * ASTRA**: валюта и так течёт из рейсов, арены и Claim, а печатный станок поверх
 * коллекции сломал бы пул. Ресурсы — да: они идут в крафт и на рынок, то есть
 * требуют второго действия, чтобы стать деньгами.
 *
 * Тормозов три. Первый — слоты: `PATROL_MAX_CONCURRENT` бортов в воздухе.
 * Второй — длительность: 6 / 12 / 24 часа, то есть 4 / 2 / 1 вылет в сутки.
 * Третий — цена внимания: добычу надо забрать кнопкой, она не капает сама.
 *
 * Ставки нарочно маленькие: одна закладка меньше, чем привозит короткий рейс
 * скаута, — звено должно быть приятным фоном, а не вторым флотом. Потолок
 * идеальной игры (четыре обычные машины, восемь сдач в сутки) — 16 руды
 * ≈ 64 ASTRA-эквивалента в сутки.
 *
 * Шанс находки уменьшен ровно вчетверо, когда слотов стало четыре: бортов в
 * воздухе стало вчетверо больше, и старые 4 / 8 / 15 % сделали бы коллекцию
 * делом двух недель. С новыми числами сутки захода раз в день дают тот же темп
 * охоты, что и один патруль в старом правиле, — а частые заходы лишь немного
 * ускоряют её, как и положено награде за внимание.
 *
 * Чем реже машина, тем выше шанс находки и жирнее закладка: редкая ищет лучше,
 * легендарная ищет легендарное.
 */
export const PATROL: Record<PlaneRarity, {
  ms: number;
  find: number;
  /** Что машина приносит за один завершённый вылет: ресурс → количество. */
  salvage: Record<string, number>;
  /** Опыт за вылет. Он не валюта, поэтому его давать безопасно. */
  xp: number;
}> = {
  common: { ms: 6 * 3600 * 1000, find: 0.01, salvage: { iron_ore: 1 }, xp: 4 },
  rare: { ms: 12 * 3600 * 1000, find: 0.02, salvage: { iron_ore: 2, silicon: 1 }, xp: 8 },
  legendary: { ms: 24 * 3600 * 1000, find: 0.04, salvage: { iron_ore: 3, crystal: 1 }, xp: 16 },
};

/** Суммарная закладка вылета: клиент показывает её как «принесёт ≈ …». */
export function salvageLabel(salvage: Record<string, number>): string {
  return Object.entries(salvage).map(([resource, amount]) => `${amount} ${RESOURCE_NAMES[resource] ?? resource}`).join(', ');
}

/**
 * Какую редкость находит патруль: своя ступень с большим весом, соседние — реже.
 * Легендарная машина ищет легендарные чаще всех — в этом и смысл владеть ею.
 */
export const PATROL_FIND: Record<PlaneRarity, { rarity: PlaneRarity; weight: number }[]> = {
  common: [{ rarity: 'common', weight: 88 }, { rarity: 'rare', weight: 12 }],
  rare: [{ rarity: 'rare', weight: 70 }, { rarity: 'common', weight: 25 }, { rarity: 'legendary', weight: 5 }],
  legendary: [{ rarity: 'legendary', weight: 60 }, { rarity: 'rare', weight: 40 }],
};

export const PLANE_RARITY_NAMES: Record<PlaneRarity, string> = {
  common: 'обычная',
  rare: 'редкая',
  legendary: 'легендарная',
};

export function isPlaneId(value: string): value is PlaneId {
  return (PLANE_ORDER as string[]).includes(value);
}

/** Стартовая машина: без неё патруль недоступен, пока не повезёт с боксом. */
export const STARTER_PLANE: PlaneId = 'strizh';

/** Спрайт машины. Путь из id: клиент не надо править при добавлении модели. */
export function planeSprite(id: PlaneId): string {
  return `/sprites/planes/${id}.png`;
}

// ── Боксы (этап 5) ───────────────────────────────────────────────────────────
// Два бесплатных (дневной и недельный) и два платных. Платные — сток ASTRA:
// ресурсы из них всегда дешевле цены бокса, иначе получился бы печатный станок
// «купил бокс → продал ресурсы на рынке». Это проверяется тестом
// `boxes.test.ts` по `RESOURCE_BASE_PRICES`, а не держится на обещаниях.
//
// Доходность подобрана ниже рейсов: короткий рейс приносит 2 единицы за 15 минут
// (за сутки их набегает 10–30), дневной бокс — 3–5 единиц за сутки, недельный —
// 11–15 за неделю. Рейс вдобавок даёт ASTRA, очки и опыт, бокс — только ресурсы.
export type BoxId = 'daily' | 'weekly' | 'crate_supply' | 'crate_pro';

export interface BoxDef {
  id: BoxId;
  name: string;
  hint: string;
  /** 0 — бесплатный. */
  price: number;
  /** 0 — без таймера. */
  cooldownMs: number;
  /** Сколько единиц ресурсов выпадает: [минимум, максимум]. */
  units: [number, number];
  pool: string[];
  /** Компоненты: count попыток, у каждой шанс chance. */
  components?: { count: number; chance: number };
  rare?: { resource: string; chance: number };
  /**
   * Шанс найти машину звена — **по редкости**, отдельным числом на ступень.
   * Это абсолютные шансы за одно открытие, а не доля: если в `crate_pro` обычная
   * 3 % и легендарная 0.4 %, столько и есть. Ноль или пропуск — ступень из бокса
   * не выпадает вовсе.
   *
   * Коллекция ничего не стоит в ASTRA, поэтому шансы не влияют на «печатный
   * станок» платных боксов: их ресурсная часть считается отдельно.
   *
   * Шансы здесь намеренно крошечные (0.4–4 % против 6–36 % в первом выпуске):
   * коллекция должна быть длинным охотничьим треком, а не вечерним лутом.
   */
  plane?: { common?: number; rare?: number; legendary?: number };
  /** Опыт за одно открытие. Открыл бокс — подрос; ASTRA при этом не печатается. */
  xp?: number;
}

/** Компоненты, которые могут выпасть из бокса. */
export const BOX_COMPONENTS = ['energy_cell', 'circuit', 'alloy_plate'] as const;

export const BOXES: Record<BoxId, BoxDef> = {
  daily: {
    id: 'daily', name: 'Дневной бокс', hint: 'Раз в сутки, бесплатно',
    price: 0, cooldownMs: DAY_MS, units: [3, 5],
    pool: ['iron_ore', 'copper_ore', 'silicon', 'ice'],
    components: { count: 1, chance: 0.1 },
    plane: { common: 0.008 },
    xp: 2,
  },
  weekly: {
    id: 'weekly', name: 'Недельный бокс', hint: 'Раз в неделю, бесплатно',
    price: 0, cooldownMs: 7 * DAY_MS, units: [11, 15],
    pool: ['iron_ore', 'copper_ore', 'silicon', 'ice', 'helium3', 'titanium', 'crystal'],
    components: { count: 1, chance: 1 },
    rare: { resource: 'astralite', chance: 0.15 },
    // Недельный — шанс на редкую машину бесплатно. Легендарной здесь нет: она
    // только в дорогом контейнере и в патруле с редкой машины.
    plane: { common: 0.04, rare: 0.008 },
    xp: 8,
  },
  crate_supply: {
    id: 'crate_supply', name: 'Ящик снабжения', hint: 'Ресурсы первого сектора',
    price: 280, cooldownMs: 0, units: [16, 22],
    pool: ['iron_ore', 'copper_ore', 'silicon', 'ice'],
    components: { count: 1, chance: 0.3 },
    plane: { common: 0.015 },
    xp: 3,
  },
  crate_pro: {
    id: 'crate_pro', name: 'Грузовой контейнер', hint: 'Ресурсы, компоненты и шанс на астралит',
    price: 850, cooldownMs: 0, units: [30, 38],
    pool: ['iron_ore', 'copper_ore', 'silicon', 'ice', 'helium3', 'titanium', 'crystal'],
    components: { count: 2, chance: 0.55 },
    rare: { resource: 'astralite', chance: 0.2 },
    plane: { common: 0.03, rare: 0.008, legendary: 0.004 },
    xp: 10,
  },
};

export const BOX_ORDER: BoxId[] = ['daily', 'weekly', 'crate_supply', 'crate_pro'];

export function isBoxId(value: string): value is BoxId {
  return (BOX_ORDER as string[]).includes(value);
}


export function isRecipeId(value: string): value is RecipeId {
  return (RECIPE_ORDER as string[]).includes(value);
}

// ── Модули корабля (этап 2, срез 4) ────────────────────────────────────────────
// Модуль ставится на конкретный корабль и занимает слот (slots в ShipDef).
// Уровень 1..5, цена уровня L = basePrice × 2^(L−1), компоненты × L.
// Снять модуль нельзя: только поставить или улучшить. Это сознательно — иначе
// слоты обходились бы перестановкой, а вложенная ASTRA возвращалась бы игроку.
export type ModuleId =
  | 'engine' | 'nav_computer' | 'fuel_system' | 'coolant_loop' | 'scanner'
  | 'cargo_bay' | 'drone_bay' | 'mining_drill' | 'shield' | 'armor_plating' | 'repair_kit';
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
  /**
   * Дальние компоненты: добавляются к parts с уровня MODULE_LATE_LEVEL и тоже
   * умножаются на уровень. Здесь редкие ресурсы секторов 2–5, поэтому до 4-го
   * уровня модуль качается на стартовых компонентах.
   */
  lateParts?: { resource: string; amount: number }[];
}

/** С какого уровня модулю нужны компоненты второго круга. */
export const MODULE_LATE_LEVEL = 4;

// ── Опыт (уровень игрока) ────────────────────────────────────────────────────
/**
 * Опыт капает за всё, чем игрок занимается, — а не только за рейсы.
 *
 * До этой правки XP начислялся лишь за завершённый рейс, и активный игрок с
 * сотнями очков сезона оставался 1-го уровня. Уровень — это замок верфи и
 * секторов, поэтому прогресс выглядел сломанным. Правило теперь простое:
 * любое действие, которое даёт очки или ASTRA, даёт и опыт.
 *
 * Опыт ничего не стоит в экономике (уровень не выдаёт ASTRA), поэтому эти числа
 * не двигают поглощение — они только снимают искусственный замок.
 */
export const XP = {
  /** За один Claim. Их до 96 в сутки, поэтому тут единица, а не пятёрка. */
  claim: 1,
  /** За дневные миссии: обычная и посложнее. */
  mission: 10,
  missionHard: 16,
  missionWeekly: 60,
  /** За засчитанный забег на арене и сверху за победу. */
  minigameRun: 4,
  minigameWin: 8,
  /** За каждый купленный уровень модуля: вложился — получил. */
  moduleLevel: 2,
  /** За готовый крафт (выдача, а не постановка в очередь). */
  craft: 3,
  /** Догоняющий пересчёт: сколько очков сезона считается за 1 XP. */
  pointsPerXp: 4,
} as const;

export const MODULES: Record<ModuleId, ModuleDef> = {
  engine: {
    id: 'engine', name: 'Двигатель', effect: 'duration', perLevel: 0.03, basePrice: 1200,
    parts: [{ resource: 'circuit', amount: 1 }],
    lateParts: [{ resource: 'helium_coolant', amount: 1 }],
  },
  // Топливо целое: −5 % от 1 единицы всё равно даёт 1, поэтому модуль не снижает
  // расход, а расширяет бак — это видно сразу и работает на всех корпусах.
  fuel_system: {
    id: 'fuel_system', name: 'Топливная система', effect: 'tank', perLevel: 1, basePrice: 900,
    parts: [{ resource: 'energy_cell', amount: 1 }, { resource: 'circuit', amount: 1 }],
    lateParts: [{ resource: 'helium_coolant', amount: 1 }],
  },
  // Кристалл лежит в секторе 2 и выше — сканер собираем из схем и кремния,
  // иначе его нельзя прокачать первые часы игры (тест доступности это ловит).
  scanner: {
    id: 'scanner', name: 'Сканер', effect: 'scanner', perLevel: 0.15, basePrice: 1500,
    parts: [{ resource: 'circuit', amount: 2 }, { resource: 'silicon', amount: 4 }],
    lateParts: [{ resource: 'crystal_lens', amount: 1 }],
  },
  // Навигатор и двигатель режут одно и то же число, но считаются по-разному:
  // движок дешёвый и качается рано, навигатор дорогой и выигрывает на длинных
  // рейсах. Множители effects складываются, поэтому «быстрый» корабль собирается
  // из обоих — это и есть смысл нескольких слотов.
  nav_computer: {
    id: 'nav_computer', name: 'Навигатор', effect: 'duration', perLevel: 0.04, basePrice: 1700,
    parts: [{ resource: 'circuit', amount: 1 }, { resource: 'silicon', amount: 3 }],
    lateParts: [{ resource: 'crystal_lens', amount: 1 }],
  },
  cargo_bay: {
    id: 'cargo_bay', name: 'Грузовой отсек', effect: 'cargo', perLevel: 0.1, basePrice: 2000,
    parts: [{ resource: 'alloy_plate', amount: 2 }],
    lateParts: [{ resource: 'titanium_frame', amount: 1 }],
  },
  // Дроны дешевле цельного трюма и просятся на маленький корпус: −1 слот против
  // cargo_bay на large hull'ах решает игрок, а не таблица.
  drone_bay: {
    id: 'drone_bay', name: 'Дрон-ангар', effect: 'cargo', perLevel: 0.07, basePrice: 1400,
    parts: [{ resource: 'energy_cell', amount: 1 }, { resource: 'circuit', amount: 1 }],
    lateParts: [{ resource: 'titanium_frame', amount: 1 }],
  },
  mining_drill: {
    id: 'mining_drill', name: 'Бур', effect: 'mining', perLevel: 0.06, basePrice: 2500,
    parts: [{ resource: 'alloy_plate', amount: 2 }, { resource: 'circuit', amount: 1 }],
    lateParts: [{ resource: 'titanium_frame', amount: 1 }, { resource: 'astralite_core', amount: 1 }],
  },
  shield: {
    id: 'shield', name: 'Щит', effect: 'wear', perLevel: 0.08, basePrice: 3000,
    parts: [{ resource: 'alloy_plate', amount: 3 }, { resource: 'energy_cell', amount: 1 }],
    lateParts: [{ resource: 'void_weave', amount: 1 }, { resource: 'quantum_matrix', amount: 1 }],
  },
  // Пассивная броня: дешевле щита, берёт медью и железом, поэтому доступна там,
  // где щит ещё не собран. Тот же эффект, другие деньги и другие слоты.
  armor_plating: {
    id: 'armor_plating', name: 'Бронеплиты', effect: 'wear', perLevel: 0.05, basePrice: 1600,
    parts: [{ resource: 'alloy_plate', amount: 2 }, { resource: 'copper_ore', amount: 6 }],
    lateParts: [{ resource: 'titanium_frame', amount: 1 }],
  },
  // Охлаждение — второй источник топлива: бак складывается из двух модулей, и на
  // большом корпусе можно поставить оба.
  coolant_loop: {
    id: 'coolant_loop', name: 'Контур охлаждения', effect: 'tank', perLevel: 1, basePrice: 1300,
    parts: [{ resource: 'energy_cell', amount: 2 }],
    lateParts: [{ resource: 'helium_coolant', amount: 1 }],
  },
  repair_kit: {
    id: 'repair_kit', name: 'Ремкомплект', effect: 'repair', perLevel: 0.1, basePrice: 600,
    parts: [{ resource: 'circuit', amount: 1 }, { resource: 'alloy_plate', amount: 1 }],
    lateParts: [{ resource: 'crystal_lens', amount: 1 }],
  },
};

// Порядок = порядок слотов в интерфейсе: сначала скорость и топливо, потом груз
// и добыча, в конце защита и ремонт.
export const MODULE_ORDER: ModuleId[] = [
  'engine', 'nav_computer', 'fuel_system', 'coolant_loop', 'scanner',
  'cargo_bay', 'drone_bay', 'mining_drill', 'shield', 'armor_plating', 'repair_kit',
];

/** Модули, которые дают прибавку к баку: их два, и бак считается суммой. */
export const TANK_MODULES: ModuleId[] = MODULE_ORDER.filter((id) => MODULES[id].effect === 'tank');

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_ORDER as string[]).includes(value);
}

/** Цена следующего уровня: base × 2^(L−1). */
export function modulePrice(id: ModuleId, level: number): number {
  return Math.round(MODULES[id].basePrice * Math.pow(2, level - 1));
}

/**
 * Компоненты на уровень L: количество растёт линейно. С MODULE_LATE_LEVEL
 * добавляются дальние компоненты — тоже × L, иначе редкий ресурс на 5-м уровне
 * стоил бы столько же, сколько на 4-м.
 */
export function moduleParts(id: ModuleId, level: number): { resource: string; amount: number }[] {
  const def = MODULES[id];
  const parts = def.parts.map((p) => ({ resource: p.resource, amount: p.amount * level }));
  if (level >= MODULE_LATE_LEVEL) {
    for (const p of def.lateParts ?? []) parts.push({ resource: p.resource, amount: p.amount * level });
  }
  return parts;
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
  helium_coolant: 120,
  titanium_frame: 150,
  crystal_lens: 170,
  astralite_core: 260,
  void_weave: 230,
  quantum_matrix: 330,
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
