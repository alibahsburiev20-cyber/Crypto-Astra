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

// Экспедиции: длительности из концепции v2.1 (15 мин / 4 ч / 24 ч).
// Расход топлива и награды — временные значения для разработки, подлежат симуляции до запуска.
export const EXPEDITION_KINDS = {
  short: { durationMs: 15 * 60 * 1000, fuel: 1, rewardMin: 8, rewardMax: 12 },
  medium: { durationMs: 4 * 60 * 60 * 1000, fuel: 1, rewardMin: 128, rewardMax: 192 },
  long: { durationMs: DAY_MS, fuel: 1, rewardMin: 768, rewardMax: 1152 },
} as const;
export type ExpeditionKind = keyof typeof EXPEDITION_KINDS;
