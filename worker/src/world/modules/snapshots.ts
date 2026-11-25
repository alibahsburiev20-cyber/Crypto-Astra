import { SNAPSHOT_BATCH } from '../../shared/constants';
import { sha256Hex } from '../../shared/sha256';
import { verifyNow } from '../ledger';
import { activeSeason, getSeason } from './season';

// Снимок мира (этап 3). Задача `snapshot_export` раз в неделю и при закрытии
// сезона складывает компактный JSON в таблицу мира, откуда cron воркера
// перекладывает его в D1 и — когда появится бакет — в R2.
//
// В снимке нет самого Ledger: он большой, а истина по журналу восстанавливается
// через Time Travel. Зато есть голова цепочки, число строк и результат сверки —
// по ним видно, что архив снят с честного мира, и это проверяет скрипт
// `scripts/verify-snapshot.ts`.

export type SnapshotKind = 'weekly' | 'season_close';

export interface SnapshotStanding {
  rank: number;
  playerId: string;
  points: number;
  level: number;
  xp: number;
  reward: number;
}

export interface WorldSnapshot {
  v: 1;
  kind: SnapshotKind;
  created_at: number;
  season: { id: string; number: number; startsAt: number; endsAt: number; status: string; closedAt: number | null } | null;
  totals: {
    players: number;
    astra: number;
    fuel: number;
    points: number;
    resources: Record<string, number>;
    ships: number;
    durability: number;
    marketLots: number;
  };
  ledger: { rows: number; headSeq: number | null; headHash: string | null; verifyOk: boolean; brokenAtSeq: number | null };
  standings?: SnapshotStanding[];
}

function sum(sql: SqlStorage, query: string): number {
  const row = sql.exec(query).toArray()[0];
  const value = row ? Number(Object.values(row)[0]) : 0;
  return Number.isFinite(value) ? value : 0;
}

/** Чистая сборка снимка: одинаковый мир и время дают одинаковый JSON (и одинаковый sha256). */
export function buildSnapshot(sql: SqlStorage, kind: SnapshotKind, now: number, seasonId?: string): WorldSnapshot {
  // Для закрытого сезона показываем закрытый сезон, а не тот, что уже начался.
  const season = (seasonId ? getSeason(sql, seasonId) : null) ?? activeSeason(sql);
  const report = verifyNow(sql);
  const resources: Record<string, number> = {};
  for (const row of sql.exec('SELECT resource, SUM(amount) AS total FROM resources GROUP BY resource ORDER BY resource').toArray()) {
    resources[String(row.resource)] = Number(row.total);
  }
  const snapshot: WorldSnapshot = {
    v: 1,
    kind,
    created_at: now,
    season: season
      ? { id: season.id, number: season.number, startsAt: season.startsAt, endsAt: season.endsAt, status: season.status, closedAt: season.closedAt }
      : null,
    totals: {
      players: sum(sql, 'SELECT COUNT(*) AS c FROM players'),
      astra: sum(sql, `SELECT COALESCE(SUM(amount), 0) AS c FROM balances WHERE asset = 'astra'`),
      fuel: sum(sql, `SELECT COALESCE(SUM(amount), 0) AS c FROM balances WHERE asset = 'fuel'`),
      points: sum(sql, `SELECT COALESCE(SUM(amount), 0) AS c FROM balances WHERE asset = 'points'`),
      resources,
      ships: sum(sql, 'SELECT COUNT(*) AS c FROM ships'),
      durability: sum(sql, 'SELECT COALESCE(SUM(durability), 0) AS c FROM ships'),
      marketLots: sum(sql, `SELECT COUNT(*) AS c FROM market_lots WHERE status = 'open'`),
    },
    ledger: {
      rows: report.rows,
      headSeq: report.head?.seq ?? null,
      headHash: report.head?.hash ?? null,
      verifyOk: report.ok,
      brokenAtSeq: report.brokenAtSeq,
    },
  };
  if (kind === 'season_close' && seasonId) {
    // Очки в balances к этому моменту уже обнулены, поэтому сумму берём из
    // строки сезона: там она записана до сброса.
    if (season && season.id === seasonId) snapshot.totals.points = season.points;
    snapshot.standings = sql.exec(
      `SELECT rank, player_id, points, level, xp, reward FROM season_results WHERE season_id = ? ORDER BY rank ASC`,
      seasonId,
    ).toArray().map((row) => ({
      rank: Number(row.rank),
      playerId: String(row.player_id),
      points: Number(row.points),
      level: Number(row.level),
      xp: Number(row.xp),
      reward: Number(row.reward),
    }));
  }
  return snapshot;
}

export function storeSnapshot(sql: SqlStorage, snapshot: WorldSnapshot): { id: string; sha256: string; size: number } {
  const payload = JSON.stringify(snapshot);
  const hash = sha256Hex(payload);
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO season_snapshots (id, kind, season_id, created_at, sha256, size, head_seq, head_hash, ok, exported, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id, snapshot.kind, snapshot.season?.id ?? null, snapshot.created_at, hash, payload.length,
    snapshot.ledger.headSeq, snapshot.ledger.headHash, snapshot.ledger.verifyOk ? 1 : 0, payload,
  );
  return { id, sha256: hash, size: payload.length };
}

export interface PendingSnapshot {
  id: string;
  kind: SnapshotKind;
  seasonId: string | null;
  createdAt: number;
  sha256: string;
  size: number;
  headSeq: number | null;
  headHash: string | null;
  ok: boolean;
  payload: string;
}

/** Снимки, которые cron ещё не забрал. Их число ограничено, чтобы ответ DO не раздулся. */
export function pendingSnapshots(sql: SqlStorage, limit = SNAPSHOT_BATCH): PendingSnapshot[] {
  return sql.exec(
    `SELECT id, kind, season_id, created_at, sha256, size, head_seq, head_hash, ok, payload
       FROM season_snapshots WHERE exported = 0 ORDER BY created_at ASC, id ASC LIMIT ?`,
    Math.max(1, Math.min(SNAPSHOT_BATCH, limit)),
  ).toArray().map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as SnapshotKind,
    seasonId: row.season_id == null ? null : String(row.season_id),
    createdAt: Number(row.created_at),
    sha256: String(row.sha256),
    size: Number(row.size),
    headSeq: row.head_seq == null ? null : Number(row.head_seq),
    headHash: row.head_hash == null ? null : String(row.head_hash),
    ok: Number(row.ok) === 1,
    payload: String(row.payload),
  }));
}

/** Отметка «снимок доехал до D1/R2». Только после успешной записи, иначе архив потеряется. */
export function ackSnapshots(sql: SqlStorage, ids: string[]): number {
  let done = 0;
  for (const id of ids) {
    sql.exec('UPDATE season_snapshots SET exported = 1 WHERE id = ? AND exported = 0', id);
    done += 1;
  }
  return done;
}
