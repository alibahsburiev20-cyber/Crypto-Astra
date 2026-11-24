import { ApiError } from '../errors';
import { appendLedger } from '../ledger';
import { levelFromXp } from './expeditionMath';

// Срез 2 этапа 2. Опыт и прочность раньше менялись голым UPDATE и в журнал не
// попадали. Теперь это такие же активы, как ASTRA: изменение и запись — одна
// операция, а сверка видит подмену в обход журнала.

export interface ProgressInput {
  playerId: string;
  delta: number;
  reason: string;
  sourceRef?: string | null;
  idemKey?: string | null;
}

export function getXp(sql: SqlStorage, playerId: string): number {
  const r = sql.exec('SELECT xp FROM players WHERE id = ?', playerId).toArray();
  if (!r.length) throw new ApiError(404, 'player_not_found');
  return Number(r[0].xp);
}

/**
 * Уровень игрока по опыту. Читается из `xp`, а не из колонки `level`: та лишь
 * кэш, и у игроков, набежавших до правки опыта, она отставала. Всё, что решает
 * «пора ли уже» (верфь, секторы, гараж), обязано смотреть сюда.
 */
export function playerLevel(sql: SqlStorage, playerId: string): number {
  const r = sql.exec('SELECT xp FROM players WHERE id = ?', playerId).toArray();
  if (!r.length) throw new ApiError(404, 'player_not_found');
  return levelFromXp(Number(r[0].xp));
}

/** Опыт и уровень. Уровень считается здесь же, чтобы не расходился с опытом. */
export function applyXp(sql: SqlStorage, input: ProgressInput, now: number, levelFromXp: (xp: number) => number): number {
  const next = getXp(sql, input.playerId) + input.delta;
  if (next < 0) throw new ApiError(409, 'bad_delta');
  sql.exec('UPDATE players SET xp = ?, level = ? WHERE id = ?', next, levelFromXp(next), input.playerId);
  appendLedger(sql, {
    playerId: input.playerId,
    asset: 'xp',
    delta: input.delta,
    reason: input.reason,
    sourceRef: input.sourceRef ?? null,
    idemKey: input.idemKey ?? null,
  }, now);
  return next;
}

export function getDurability(sql: SqlStorage, shipId: string): number {
  const r = sql.exec('SELECT durability FROM ships WHERE id = ?', shipId).toArray();
  if (!r.length) throw new ApiError(404, 'ship_not_found');
  return Number(r[0].durability);
}

/**
 * Прочность 0..100. Дельта в журнале — фактическая: если износ больше остатка,
 * списывается только то, что было, иначе сумма журнала не сошлась бы с кораблём.
 */
export function applyDurability(sql: SqlStorage, input: ProgressInput & { shipId: string }, now: number): number {
  const current = getDurability(sql, input.shipId);
  const raw = current + input.delta;
  const next = Math.max(0, Math.min(100, raw));
  const applied = next - current;
  if (applied === 0) return current;
  sql.exec('UPDATE ships SET durability = ? WHERE id = ?', next, input.shipId);
  appendLedger(sql, {
    playerId: input.playerId,
    asset: `dur:${input.shipId}`,
    delta: applied,
    reason: input.reason,
    sourceRef: input.sourceRef ?? null,
    idemKey: input.idemKey ?? null,
  }, now);
  return next;
}
