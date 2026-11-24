import { levelFromXp, xpThreshold } from '../../src/world/modules/expeditionMath';
import { applyXp } from '../../src/world/modules/progress';

/**
 * Выставить игроку уровень в тестовом мире.
 *
 * Уровень — производная от опыта (`playerLevel`), а опыт живёт в журнале: тест,
 * который пишет колонку `level` или `xp` голым UPDATE, либо не добивается ничего,
 * либо роняет сверку. Поэтому начисляем ровно столько XP, сколько нужно на
 * уровень, через applyXp — он же обновит кэш уровня.
 */
export function setLevel(sql: SqlStorage, playerId: string, level: number, now = 1): void {
  const delta = xpThreshold(level);
  if (delta <= 0) return;
  applyXp(sql, { playerId, delta, reason: 'seed', sourceRef: `level-${level}` }, now, levelFromXp);
}
