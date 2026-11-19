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
