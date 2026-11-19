import {
  DAY_MS, SEASON_LENGTH_MS, SEASON_MIN_POINTS, SEASON_PAID_PLACES, SEASON_REWARDS, SEASON_TOP_LIMIT, SNAPSHOT_INTERVAL_MS,
} from '../../shared/constants';
import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { enqueue } from '../scheduler';

// Сезон (этап 3). Рейтинг не хранится отдельным счётчиком: он читается из баланса
// `points`, который живёт в Ledger как обычный актив. Поэтому подделать очки из
// клиента нельзя, а сверка Ledger проверяет их наравне с ASTRA.
// Закрытие сезона списывает очки записью `season_reset`, начисляет призы записью
// `season_reward` и пишет итоги в `season_results` — всё внутри одной транзакции мира.

export type SeasonStatus = 'active' | 'closed';

export interface SeasonRow {
  id: string;
  number: number;
  startsAt: number;
  endsAt: number;
  status: SeasonStatus;
  closedAt: number | null;
  players: number;
  points: number;
}

export interface RatingRow {
  id: string;
  level: number;
  xp: number;
  createdAt: number;
  points: number;
  ships: number;
}

function toSeason(row: Record<string, unknown>): SeasonRow {
  return {
    id: String(row.id),
    number: Number(row.number),
    startsAt: Number(row.starts_at),
    endsAt: Number(row.ends_at),
    status: String(row.status) as SeasonStatus,
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
    players: Number(row.players ?? 0),
    points: Number(row.points ?? 0),
  };
}

/** Активный сезон или null. В мире их не может быть больше одного. */
export function activeSeason(sql: SqlStorage): SeasonRow | null {
  const rows = sql.exec(`SELECT * FROM seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1`).toArray();
  return rows.length ? toSeason(rows[0]) : null;
}

export function getSeason(sql: SqlStorage, seasonId: string): SeasonRow | null {
  const rows = sql.exec('SELECT * FROM seasons WHERE id = ?', seasonId).toArray();
  return rows.length ? toSeason(rows[0]) : null;
}

/**
 * Сезон, который должен идти сейчас. Если его нет — создаём следующий.
 *
 * Мир может проспать (никто не заходил, будильник не сработал) целый сезон.
 * Догонять пропущенные сезоны бессмысленно: в них не было игроков, а награды
 * за пустые сезоны — это просто печать ASTRA. Поэтому новый сезон стартует
 * от конца предыдущего, но не в прошлом.
 */
export function ensureSeason(sql: SqlStorage, now: number): SeasonRow {
  const current = activeSeason(sql);
  if (current) return current;
  const last = sql.exec('SELECT number, ends_at FROM seasons ORDER BY number DESC LIMIT 1').toArray()[0];
  const number = last ? Number(last.number) + 1 : 1;
  let startsAt = last ? Number(last.ends_at) : now;
  if (now >= startsAt + SEASON_LENGTH_MS) startsAt = now;
  const id = `s${number}`;
  sql.exec(
    `INSERT INTO seasons (id, number, starts_at, ends_at, status, closed_at, players, points)
     VALUES (?, ?, ?, ?, 'active', NULL, 0, 0)`,
    id, number, startsAt, startsAt + SEASON_LENGTH_MS,
  );
  sql.exec(
    `INSERT INTO meta (key, value) VALUES ('season_current', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    id,
  );
  return { id, number, startsAt, endsAt: startsAt + SEASON_LENGTH_MS, status: 'active', closedAt: null, players: 0, points: 0 };
}

/**
 * Рейтинг мира. Порядок: очки, затем опыт, затем кто раньше зарегистрировался,
 * затем id. Тай-брейк нужен, чтобы у двух игроков с равными очками место не
 * прыгало от запроса к запросу (и чтобы тест не был флаком).
 */
export function ratingRows(sql: SqlStorage): RatingRow[] {
  return sql.exec(
    `SELECT p.id AS id, p.level AS level, p.xp AS xp, p.created_at AS created_at,
            COALESCE(b.amount, 0) AS points,
            (SELECT COUNT(*) FROM ships s WHERE s.player_id = p.id) AS ships
       FROM players p
       LEFT JOIN balances b ON b.player_id = p.id AND b.asset = 'points'
      ORDER BY points DESC, xp DESC, created_at ASC, p.id ASC`,
  ).toArray().map((r) => ({
    id: String(r.id),
    level: Number(r.level),
    xp: Number(r.xp),
    createdAt: Number(r.created_at),
    points: Number(r.points),
    ships: Number(r.ships),
  }));
}

/** Короткая подпись игрока в рейтинге. Email и прочие данные аккаунта мир не знает. */
export function ratingLabel(playerId: string): string {
  const compact = playerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  return compact ? `Пилот ${compact}` : 'Пилот';
}

/** Награда за место. Ноль, если очков нет: приз за участие без игры не выдаём. */
export function seasonRewardFor(rank: number, points: number): number {
  if (points < SEASON_MIN_POINTS) return 0;
  if (rank === 1) return SEASON_REWARDS.first;
  if (rank === 2) return SEASON_REWARDS.second;
  if (rank === 3) return SEASON_REWARDS.third;
  if (rank <= SEASON_PAID_PLACES) return SEASON_REWARDS.top10;
  return SEASON_REWARDS.participation;
}

export function seasonRewardsTable() {
  return [
    { place: 1, astra: SEASON_REWARDS.first },
    { place: 2, astra: SEASON_REWARDS.second },
    { place: 3, astra: SEASON_REWARDS.third },
    { place: `4–${SEASON_PAID_PLACES}`, astra: SEASON_REWARDS.top10 },
    { place: 'участие', astra: SEASON_REWARDS.participation },
  ];
}

function daysLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / DAY_MS));
}

/** Компактный блок сезона для `/me`: клиенту хватает его, чтобы рисовать карточку. */
export function seasonBrief(sql: SqlStorage, playerId: string, now: number) {
  const season = ensureSeason(sql, now);
  const rows = ratingRows(sql);
  const idx = rows.findIndex((r) => r.id === playerId);
  return {
    id: season.id,
    number: season.number,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    daysLeft: daysLeft(season.endsAt, now),
    lengthDays: Math.round(SEASON_LENGTH_MS / DAY_MS),
    points: idx >= 0 ? rows[idx].points : 0,
    rank: idx >= 0 ? idx + 1 : null,
    players: rows.length,
  };
}

export interface SeasonTopRow {
  rank: number;
  label: string;
  points: number;
  level: number;
  ships: number;
  isMe: boolean;
}

/** Полный экран сезона: рейтинг, своё место, таблица наград и прошлые сезоны. */
export function seasonReport(sql: SqlStorage, playerId: string, now: number) {
  const season = ensureSeason(sql, now);
  const rows = ratingRows(sql);
  const top: SeasonTopRow[] = rows.slice(0, SEASON_TOP_LIMIT).map((r, i) => ({
    rank: i + 1,
    label: ratingLabel(r.id),
    points: r.points,
    level: r.level,
    ships: r.ships,
    isMe: r.id === playerId,
  }));
  const idx = rows.findIndex((r) => r.id === playerId);
  const past = sql.exec(
    `SELECT id, number, starts_at, ends_at, closed_at, players, points
       FROM seasons WHERE status = 'closed' ORDER BY number DESC LIMIT 3`,
  ).toArray().map((s) => {
    const winner = sql.exec(
      `SELECT r.player_id AS player_id, r.points AS points, r.reward AS reward
         FROM season_results r WHERE r.season_id = ? ORDER BY r.rank ASC LIMIT 1`,
      String(s.id),
    ).toArray()[0];
    const mine = sql.exec(
      'SELECT rank, points, reward FROM season_results WHERE season_id = ? AND player_id = ?',
      String(s.id), playerId,
    ).toArray()[0];
    return {
      id: String(s.id),
      number: Number(s.number),
      startsAt: Number(s.starts_at),
      endsAt: Number(s.ends_at),
      closedAt: Number(s.closed_at),
      players: Number(s.players),
      pointsTotal: Number(s.points),
      winner: winner ? { label: ratingLabel(String(winner.player_id)), points: Number(winner.points), reward: Number(winner.reward) } : null,
      me: mine ? { rank: Number(mine.rank), points: Number(mine.points), reward: Number(mine.reward) } : null,
    };
  });
  return {
    season: {
      id: season.id,
      number: season.number,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      status: season.status,
      daysLeft: daysLeft(season.endsAt, now),
      lengthDays: Math.round(SEASON_LENGTH_MS / DAY_MS),
      players: rows.length,
      pointsTotal: rows.reduce((sum, r) => sum + r.points, 0),
    },
    me: {
      label: ratingLabel(playerId),
      rank: idx >= 0 ? idx + 1 : null,
      points: idx >= 0 ? rows[idx].points : 0,
      level: idx >= 0 ? rows[idx].level : 1,
      reward: idx >= 0 ? seasonRewardFor(idx + 1, rows[idx].points) : 0,
    },
    top,
    rewards: seasonRewardsTable(),
    past,
  };
}

/**
 * Задачи сезона: закрытие в конце сезона и недельный снимок мира. Вызывается из
 * `ensureMaintenance`, поэтому всегда есть ровно одна задача каждого вида —
 * повторный `poke` не плодит дубликаты.
 */
export function ensureSeasonJobs(sql: SqlStorage, now: number): void {
  const season = ensureSeason(sql, now);
  const has = (kind: string) => sql.exec(
    `SELECT 1 FROM jobs WHERE kind = ? AND status = 'pending' LIMIT 1`, kind,
  ).toArray().length > 0;
  if (!has('season_close')) enqueue(sql, 'season_close', season.endsAt, { seasonId: season.id });
  if (!has('snapshot_export')) enqueue(sql, 'snapshot_export', now + SNAPSHOT_INTERVAL_MS, {});
}

export interface CloseSeasonResult {
  closed: boolean;
  seasonId: string;
  nextSeasonId: string | null;
  players: number;
  points: number;
  rewards: number;
}

/**
 * Закрытие сезона. Только внутри транзакции мира и только при сошедшейся сверке:
 * призы — это выпуск ASTRA, а в замороженном мире журналу верить нельзя.
 *
 * Повторный вызов для закрытого сезона ничего не делает: задача планировщика
 * может сработать дважды, и это не должно начислять призы второй раз.
 */
export function closeSeason(sql: SqlStorage, seasonId: string, now: number): CloseSeasonResult {
  const season = getSeason(sql, seasonId);
  if (!season) throw new ApiError(404, 'season_not_found');
  if (season.status !== 'active') {
    return { closed: false, seasonId, nextSeasonId: activeSeason(sql)?.id ?? null, players: season.players, points: season.points, rewards: 0 };
  }
  const rows = ratingRows(sql);
  const pointsTotal = rows.reduce((sum, r) => sum + r.points, 0);
  let rewards = 0;
  rows.forEach((row, i) => {
    const rank = i + 1;
    const reward = seasonRewardFor(rank, row.points);
    sql.exec(
      `INSERT OR REPLACE INTO season_results (season_id, player_id, rank, points, level, xp, reward)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seasonId, row.id, rank, row.points, row.level, row.xp, reward,
    );
    if (reward > 0) {
      applyDelta(sql, {
        playerId: row.id, asset: 'astra', delta: reward,
        reason: 'season_reward', sourceRef: `${seasonId}:${rank}`,
      }, now);
      rewards += reward;
    }
    // Очки сезона обнуляются журналом, а не UPDATE: иначе сверка увидела бы
    // расхождение между Ledger и балансом.
    if (row.points > 0) {
      applyDelta(sql, {
        playerId: row.id, asset: 'points', delta: -row.points,
        reason: 'season_reset', sourceRef: seasonId,
      }, now);
    }
  });
  sql.exec(
    `UPDATE seasons SET status = 'closed', closed_at = ?, players = ?, points = ? WHERE id = ?`,
    now, rows.length, pointsTotal, seasonId,
  );
  sql.exec(
    `INSERT INTO meta (key, value) VALUES ('season_last_closed', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    `${seasonId}@${now}`,
  );
  const next = ensureSeason(sql, now);
  return { closed: true, seasonId, nextSeasonId: next.id, players: rows.length, points: pointsTotal, rewards };
}
