import type { Env } from './env';
import { ratingLabel } from './world/modules/season';
import type { PendingSnapshot } from './world/modules/snapshots';

// Архив мира (этап 3). Мир снимает снимок внутри транзакции — там нет сети,
// а cron воркера забирает готовые снимки и раскладывает их:
//   · R2 — если бакет подключён (`ARCHIVE`);
//   · иначе D1 — payload остаётся в `world_snapshots.payload`.
// Итоги закрытых сезонов всегда дублируются в `season_history`: это отчётность,
// которая нужна и без бакета.

interface SeasonPayload {
  season?: { id: string; number: number; startsAt: number; endsAt: number; closedAt: number | null } | null;
  standings?: { rank: number; playerId: string; points: number; level: number; xp: number; reward: number }[];
  totals?: { players: number; points: number };
}

export interface ArchiveResult {
  archived: number;
  uploaded: number;
  failed: number;
  seasons: number;
}

export interface SeasonHistoryRow {
  worldId: string;
  seasonId: string;
  seasonNumber: number;
  startsAt: number;
  endsAt: number;
  closedAt: number;
  players: number;
  pointsTotal: number;
  rewardsTotal: number;
  topJson: string;
  createdAt: number;
}

/**
 * Чистое преобразование снимка закрытого сезона в строку истории D1.
 * Вынесено из записи в базу, чтобы проверить без D1: призы и топ считаются здесь.
 */
export function buildSeasonHistory(worldId: string, payload: string, fallbackAt: number): SeasonHistoryRow | null {
  const parsed = JSON.parse(payload) as SeasonPayload;
  const season = parsed.season;
  if (!season) return null;
  const standings = parsed.standings ?? [];
  const rewards = standings.reduce((sum, s) => sum + Number(s.reward ?? 0), 0);
  const top = standings.slice(0, 10).map((s) => ({
    rank: s.rank,
    label: ratingLabel(String(s.playerId)),
    points: s.points,
    reward: s.reward,
  }));
  return {
    worldId,
    seasonId: season.id,
    seasonNumber: season.number,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    closedAt: season.closedAt ?? fallbackAt,
    players: parsed.totals?.players ?? standings.length,
    pointsTotal: parsed.totals?.points ?? 0,
    rewardsTotal: rewards,
    topJson: JSON.stringify(top),
    createdAt: fallbackAt,
  };
}

async function recordSeasonHistory(env: Env, worldId: string, payload: string, fallbackAt: number): Promise<boolean> {
  const row = buildSeasonHistory(worldId, payload, fallbackAt);
  if (!row) return false;
  await env.DB.prepare(
    `INSERT INTO season_history (world_id, season_id, season_number, starts_at, ends_at, closed_at,
                                 players, points_total, rewards_total, top_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (world_id, season_id) DO NOTHING`,
  ).bind(
    row.worldId, row.seasonId, row.seasonNumber, row.startsAt, row.endsAt, row.closedAt,
    row.players, row.pointsTotal, row.rewardsTotal, row.topJson, row.createdAt,
  ).run();
  return true;
}

/** Забирает у миров ожидающие снимки и раскладывает их в R2 и/или D1. */
export async function syncArchive(env: Env, worldIds: string[]): Promise<ArchiveResult> {
  const result: ArchiveResult = { archived: 0, uploaded: 0, failed: 0, seasons: 0 };
  for (const worldId of worldIds) {
    const stub = env.WORLD.get(env.WORLD.idFromName(worldId));
    let pending: PendingSnapshot[] = [];
    try {
      pending = await stub.takeSnapshots();
    } catch (e) {
      console.error('snapshots take failed', worldId, e);
      result.failed += 1;
      continue;
    }
    if (!pending.length) continue;
    const acked: string[] = [];
    for (const snap of pending) {
      try {
        let storage: 'r2' | 'd1' = 'd1';
        let r2Key: string | null = null;
        if (env.ARCHIVE) {
          r2Key = `worlds/${worldId}/snapshots/${snap.kind}-${snap.createdAt}-${snap.id}.json`;
          await env.ARCHIVE.put(r2Key, snap.payload, { httpMetadata: { contentType: 'application/json' } });
          storage = 'r2';
          result.uploaded += 1;
        }
        await env.DB.prepare(
          `INSERT INTO world_snapshots (id, world_id, kind, season_id, created_at, size, sha256,
                                        storage, r2_key, head_seq, head_hash, ok, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
        ).bind(
          snap.id, worldId, snap.kind, snap.seasonId, snap.createdAt, snap.size, snap.sha256,
          storage, r2Key, snap.headSeq, snap.headHash, snap.ok ? 1 : 0,
          storage === 'd1' ? snap.payload : null,
        ).run();
        if (snap.kind === 'season_close') {
          const recorded = await recordSeasonHistory(env, worldId, snap.payload, snap.createdAt);
          if (recorded) result.seasons += 1;
        }
        acked.push(snap.id);
        result.archived += 1;
      } catch (e) {
        // Снимок остаётся в мире неотмеченным и уедет в следующий cron-проход.
        console.error('snapshot archive failed', worldId, snap.id, e);
        result.failed += 1;
      }
    }
    if (acked.length) {
      try {
        await stub.ackSnapshots(acked);
      } catch (e) {
        console.error('snapshot ack failed', worldId, e);
      }
    }
  }
  return result;
}
