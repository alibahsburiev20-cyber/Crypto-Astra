import {
  DAY_MS, MISSIONS_DAILY, MISSION_DAILY_HARD_REWARD, MISSION_DAILY_REWARD, MISSION_WEEKLY_REWARD, utcDay,
} from '../../shared/constants';
import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { XP } from '../../shared/gameData';
import { applyXp } from './progress';
import { levelFromXp } from './expeditionMath';

// Миссии (этап 4). Прогресс считается по фактам игры — завершённым рейсам,
// готовому крафту, сделкам рынка и записям журнала, — а не по счётчику, который
// клиент мог бы прислать. Поэтому «накрутить» миссию нельзя, а таблица нужна
// только для отметки о выданной награде.

export type Metric = 'expeditions' | 'crafts' | 'sales' | 'purchases' | 'claims' | 'repairs';

export interface MissionDef {
  id: string;
  title: string;
  hint: string;
  metric: Metric;
  target: number;
  astra: number;
  points: number;
}

const DAILY_POOL: MissionDef[] = [
  { id: 'd_exp_3', title: 'Три рейса', hint: 'Заверши 3 экспедиции', metric: 'expeditions', target: 3, ...MISSION_DAILY_REWARD },
  { id: 'd_exp_6', title: 'Дальняя смена', hint: 'Заверши 6 экспедиций', metric: 'expeditions', target: 6, ...MISSION_DAILY_HARD_REWARD },
  { id: 'd_craft_1', title: 'Мастерская', hint: 'Заверши один крафт', metric: 'crafts', target: 1, ...MISSION_DAILY_REWARD },
  { id: 'd_sale_1', title: 'Первый лот', hint: 'Продай лот на рынке', metric: 'sales', target: 1, ...MISSION_DAILY_REWARD },
  { id: 'd_buy_1', title: 'Закупка', hint: 'Купи лот на рынке', metric: 'purchases', target: 1, ...MISSION_DAILY_REWARD },
  { id: 'd_claim_4', title: 'Ритм', hint: 'Забери Claim 4 раза', metric: 'claims', target: 4, ...MISSION_DAILY_REWARD },
  { id: 'd_repair_1', title: 'Техобслуживание', hint: 'Отремонтируй корабль', metric: 'repairs', target: 1, ...MISSION_DAILY_REWARD },
];

const WEEKLY_POOL: MissionDef[] = [
  { id: 'w_exp_20', title: 'Неделя в рейсах', hint: 'Заверши 20 экспедиций', metric: 'expeditions', target: 20, ...MISSION_WEEKLY_REWARD },
  { id: 'w_sale_3', title: 'Торговая неделя', hint: 'Продай 3 лота', metric: 'sales', target: 3, ...MISSION_WEEKLY_REWARD },
  { id: 'w_craft_5', title: 'Конвейер', hint: 'Заверши 5 крафтов', metric: 'crafts', target: 5, ...MISSION_WEEKLY_REWARD },
];

/** Меньше очков у FNV-1a, но этого хватает: набор должен быть стабильным на день. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const METRIC_LABELS: Record<Metric, string> = {
  expeditions: 'Рейсы',
  crafts: 'Крафт',
  sales: 'Продажи на рынке',
  purchases: 'Покупки на рынке',
  claims: 'Claim',
  repairs: 'Ремонт',
};

export function dailyMissions(playerId: string, day: number): MissionDef[] {
  const start = seedOf(`${playerId}:${day}`) % DAILY_POOL.length;
  return Array.from({ length: MISSIONS_DAILY }, (_, i) => DAILY_POOL[(start + i * 2) % DAILY_POOL.length]);
}

export function weeklyMission(playerId: string, week: number): MissionDef {
  return WEEKLY_POOL[seedOf(`${playerId}:w${week}`) % WEEKLY_POOL.length];
}

export function dayWindow(now: number): number {
  return utcDay(now) * DAY_MS;
}

export function weekWindow(now: number): number {
  return Math.floor(utcDay(now) / 7) * 7 * DAY_MS;
}

export function dailyPeriod(now: number): string {
  return `d${utcDay(now)}`;
}

export function weeklyPeriod(now: number): string {
  return `w${Math.floor(utcDay(now) / 7)}`;
}

function countOf(sql: SqlStorage, playerId: string, metric: Metric, since: number): number {
  const one = (query: string) => {
    const rows = sql.exec(query, playerId, since).toArray();
    return rows.length ? Number(rows[0].c) : 0;
  };
  switch (metric) {
    case 'expeditions':
      return one(`SELECT COUNT(*) AS c FROM expeditions WHERE player_id = ? AND status = 'completed' AND ends_at >= ?`);
    case 'crafts':
      return one(`SELECT COUNT(*) AS c FROM craft_jobs WHERE player_id = ? AND status = 'done' AND ends_at >= ?`);
    case 'sales':
      return one(`SELECT COUNT(*) AS c FROM market_sales WHERE seller_id = ? AND at >= ?`);
    case 'purchases':
      return one(`SELECT COUNT(*) AS c FROM market_sales WHERE buyer_id = ? AND at >= ?`);
    case 'claims':
      // Считаем строки ASTRA: у Claim теперь две записи на действие (валюта и
      // опыт), без фильтра по активу миссия «Ритм» закрывалась бы за пару кликов.
      return one(`SELECT COUNT(*) AS c FROM ledger WHERE player_id = ? AND asset = 'astra' AND reason = 'claim' AND delta > 0 AND created_at >= ?`);
    case 'repairs':
      return one(`SELECT COUNT(*) AS c FROM ledger WHERE player_id = ? AND reason = 'repair' AND asset = 'astra' AND created_at >= ?`);
    default:
      return 0;
  }
}

export interface MissionView {
  id: string;
  title: string;
  hint: string;
  metric: Metric;
  target: number;
  progress: number;
  astra: number;
  points: number;
  claimed: boolean;
  ready: boolean;
}

function view(sql: SqlStorage, playerId: string, def: MissionDef, since: number, period: string): MissionView {
  const progress = Math.min(def.target, countOf(sql, playerId, def.metric, since));
  const claimed = sql.exec(
    'SELECT 1 FROM mission_claims WHERE player_id = ? AND period = ? AND mission_id = ?',
    playerId, period, def.id,
  ).toArray().length > 0;
  return {
    id: def.id, title: def.title, hint: def.hint, metric: def.metric, target: def.target,
    progress, astra: def.astra, points: def.points, claimed, ready: !claimed && progress >= def.target,
  };
}

export function missionsView(sql: SqlStorage, playerId: string, now: number) {
  const day = utcDay(now);
  const week = Math.floor(day / 7);
  const daily = dailyMissions(playerId, day).map((def) => view(sql, playerId, def, dayWindow(now), dailyPeriod(now)));
  const weekly = view(sql, playerId, weeklyMission(playerId, week), weekWindow(now), weeklyPeriod(now));
  return {
    day,
    daily,
    weekly,
    ready: daily.filter((m) => m.ready).length + (weekly.ready ? 1 : 0),
  };
}

export interface ClaimMissionResult {
  missionId: string;
  astra: number;
  points: number;
  balance: number;
}

export function claimMission(
  sql: SqlStorage, playerId: string, idemKey: string, missionId: string, now: number,
): ClaimMissionResult {
  return withIdempotency(sql, playerId, 'mission:claim', idemKey, { missionId }, now, () => {
    assertPlayable(sql);
    const day = utcDay(now);
    const week = Math.floor(day / 7);
    const daily = dailyMissions(playerId, day);
    const weekly = weeklyMission(playerId, week);
    const def = daily.find((m) => m.id === missionId) ?? (weekly.id === missionId ? weekly : null);
    if (!def) throw new ApiError(400, 'bad_mission');
    const isDaily = daily.some((m) => m.id === def.id);
    const period = isDaily ? dailyPeriod(now) : weeklyPeriod(now);
    const since = isDaily ? dayWindow(now) : weekWindow(now);
    const already = sql.exec(
      'SELECT 1 FROM mission_claims WHERE player_id = ? AND period = ? AND mission_id = ?',
      playerId, period, def.id,
    ).toArray().length > 0;
    if (already) throw new ApiError(409, 'mission_claimed');
    if (countOf(sql, playerId, def.metric, since) < def.target) throw new ApiError(409, 'mission_incomplete');
    sql.exec(
      'INSERT INTO mission_claims (player_id, period, mission_id, claimed_at) VALUES (?, ?, ?, ?)',
      playerId, period, def.id, now,
    );
    if (def.astra > 0) applyDelta(sql, { playerId, asset: 'astra', delta: def.astra, reason: 'mission_reward', sourceRef: `${period}:${def.id}` }, now);
    if (def.points > 0) applyDelta(sql, { playerId, asset: 'points', delta: def.points, reason: 'mission_reward', sourceRef: `${period}:${def.id}` }, now);
    // Миссии всегда давали очки, но не давали опыта — из-за этого «дневной рот»
    // не двигал уровень. Недельная миссия ценнее, поэтому и опыта за неё больше.
    const xp = isDaily
      ? (def.points === MISSION_DAILY_HARD_REWARD.points ? XP.missionHard : XP.mission)
      : XP.missionWeekly;
    applyXp(sql, { playerId, delta: xp, reason: 'mission_reward', sourceRef: `${period}:${def.id}` }, now, levelFromXp);
    const balance = Number(sql.exec('SELECT amount FROM balances WHERE player_id = ? AND asset = ?', playerId, 'astra').toArray()[0]?.amount ?? 0);
    return { value: { missionId: def.id, astra: def.astra, points: def.points, xp, balance }, store: true };
  });
}

export { countOf as missionMetricCount };
