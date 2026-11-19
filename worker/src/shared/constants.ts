// Стартовые числа из концепции v2.1. Игровые значения подлежат симуляции до запуска.
export const WORLD_CAPACITY = 100;
export const START_ASTRA = 500;
export const START_FUEL = 3;

export const DAY_MS = 86_400_000;
export const CLAIM_INTERVAL_MS = 15 * 60 * 1000;
export const CLAIM_DAILY_MAX = 96;
// В концепции размер награды Claim не задан. 5 ASTRA — временное значение для разработки.
export const CLAIM_REWARD = 5;

export const IDEM_TTL_MS = 30 * DAY_MS;
export const RESERVATION_TTL_MS = 5 * 60 * 1000;

export const FUEL_REGEN_MS = 2 * 60 * 60 * 1000;
export const FUEL_UNIT_PRICE = 25;
export const FUEL_DAILY_MAX = 20;
export const EXPEDITION_FULL_REWARD = 8;
export const POINTS_SOFT_CAP = 700;
export const POINTS_HARD_CAP = 1000;
// 15 из концепции оказалось неподъёмным: при износе 5–15 % за рейс игрок тратил
// на ремонт больше, чем приносили Claim и рейсы вместе (симуляция, docs/ECONOMY.md).
// 2 ASTRA за процент держит ремонт примерно в трети дохода и оставляет экономику
// в целевом коридоре 70–90 % поглощения.
export const REPAIR_ASTRA_PER_PERCENT = 2;

export function utcDay(now: number): number {
  return Math.floor(now / DAY_MS);
}

// ── Сезоны (этап 3, концепция §II.10) ─────────────────────────────────────────
// Сезон — восемь недель. Очки начисляются только за рейсы и живут в Ledger как
// актив `points`; при закрытии сезона они списываются записью `season_reset`,
// поэтому баланс «Очки» всегда означает очки текущего сезона.
export const SEASON_DAYS = 56;
export const SEASON_LENGTH_MS = SEASON_DAYS * DAY_MS;
/** Сколько строк рейтинга отдаём клиенту и сколько мест получают награду. */
export const SEASON_TOP_LIMIT = 20;
export const SEASON_PAID_PLACES = 10;
/**
 * Награда за место в закрытом сезоне, ASTRA. Цифры маленькие намеренно: сезон
 * закрывается раз в восемь недель, а экономика уже сходится на 79 % поглощения.
 * Приз в 2 000 ASTRA — это ~4 дня активной игры, а не печатный станок.
 */
export const SEASON_REWARDS = { first: 2000, second: 1200, third: 800, top10: 400, participation: 150 } as const;
/** Меньше одного очка — награды за участие нет: иначе можно получить приз, ничего не делая. */
export const SEASON_MIN_POINTS = 1;
/** Периодичность снимка мира для D1/R2. */
export const SNAPSHOT_INTERVAL_MS = 7 * DAY_MS;
/** Сколько снимков отдаём воркеру за один cron-проход. */
export const SNAPSHOT_BATCH = 5;

// ── Социальное (этап 4, концепция §II.10–II.11) ──────────────────────────────
// Гильдии, рефералы, миссии, достижения и Astra Pass. Деньги не участвуют:
// всё, что печатает ASTRA, ограничено и проверяется симуляцией.

/** Создание гильдии — сток: 500 ASTRA уходят из экономики, а не печатаются. */
export const GUILD_CREATE_COST = 500;
export const GUILD_MAX_MEMBERS = 10;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 24;
export const GUILD_TAG_MAX = 5;

/** Рефералы: награда после того, как приглашённый реально отлетал 5 рейсов. */
export const REFERRAL_LIMIT = 20;
export const REFERRAL_QUALIFY_EXPEDITIONS = 5;
export const REFERRAL_REWARD = 150;

/**
 * Миссии — единственный источник «новой» ASTRA на этапе 4, поэтому награды
 * маленькие: три дневные дают максимум 150 ASTRA в день (против ~1 500 от
 * рейсов и Claim), недельная — 400. Симуляция и бюджет — docs/ECONOMY.md.
 */
export const MISSIONS_DAILY = 3;
export const MISSION_DAILY_REWARD = { astra: 10, points: 25 } as const;
export const MISSION_DAILY_HARD_REWARD = { astra: 20, points: 40 } as const;
export const MISSION_WEEKLY_REWARD = { astra: 50, points: 150 } as const;

/** Astra Pass: бесплатный трек за очки сезона. Платного нет и не будет без юриста. */
export const PASS_LEVELS = 10;
/** Уровень, на котором открывается второй слот крафта. */
export const PASS_SLOT_LEVEL = 3;
export const PASS_THRESHOLDS = [400, 900, 1500, 2200, 3000, 3900, 4900, 6000, 7800, 10000] as const;

export interface PassReward {
  kind: 'astra' | 'slot' | 'badge' | 'title';
  label: string;
  astra?: number;
}

/** Награды по уровням: ASTRA, второй слот крафта и косметика. */
export const PASS_REWARDS: Record<number, PassReward> = {
  1: { kind: 'astra', label: '20 ASTRA', astra: 20 },
  2: { kind: 'astra', label: '25 ASTRA', astra: 25 },
  3: { kind: 'slot', label: 'Второй слот крафта' },
  4: { kind: 'astra', label: '30 ASTRA', astra: 30 },
  5: { kind: 'badge', label: 'Знак «Ветеран»' },
  6: { kind: 'astra', label: '35 ASTRA', astra: 35 },
  7: { kind: 'badge', label: 'Знак «Штурман»' },
  8: { kind: 'astra', label: '40 ASTRA', astra: 40 },
  9: { kind: 'badge', label: 'Знак «Хранитель»' },
  10: { kind: 'title', label: 'Титул «Легенда сезона»' },
};
