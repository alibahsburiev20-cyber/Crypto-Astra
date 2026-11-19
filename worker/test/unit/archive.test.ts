import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/env';
import { SEASON_REWARDS } from '../../src/shared/constants';
import { buildSeasonHistory, syncArchive } from '../../src/archive';
import type { PendingSnapshot } from '../../src/world/modules/snapshots';

// Архив сезона в D1: строка истории строится из снимка мира. Тест фиксирует,
// что призы суммируются, топ ограничен десятью местами, а подписи не раскрывают
// ничего, кроме короткого идентификатора игрока.

const worldId = 'w1';
const createdAt = 1_700_000_000_000;

function payload(standings: unknown[], totals = { players: standings.length, points: 999 }) {
  return JSON.stringify({
    v: 1,
    kind: 'season_close',
    created_at: createdAt,
    season: { id: 's1', number: 1, startsAt: createdAt - 1000, endsAt: createdAt, status: 'closed', closedAt: createdAt },
    totals: { ...totals, astra: 0, fuel: 0, resources: {}, ships: 0, durability: 0, marketLots: 0 },
    ledger: { rows: 10, headSeq: 10, headHash: 'b'.repeat(64), verifyOk: true, brokenAtSeq: null },
    standings,
  });
}

const podium = [
  { rank: 1, playerId: 'aaa-111', points: 300, level: 7, xp: 900, reward: SEASON_REWARDS.first },
  { rank: 2, playerId: 'bbb-222', points: 200, level: 5, xp: 500, reward: SEASON_REWARDS.second },
  { rank: 3, playerId: 'ccc-333', points: 100, level: 4, xp: 300, reward: SEASON_REWARDS.third },
];

describe('архив сезона в D1 (этап 3)', () => {
  it('строка истории собирается из снимка: рамки, призы и топ', () => {
    const row = buildSeasonHistory(worldId, payload(podium), createdAt + 5);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      worldId,
      seasonId: 's1',
      seasonNumber: 1,
      players: 3,
      pointsTotal: 999,
      rewardsTotal: SEASON_REWARDS.first + SEASON_REWARDS.second + SEASON_REWARDS.third,
      closedAt: createdAt,
    });
    const top = JSON.parse(String(row?.topJson)) as { rank: number; label: string; reward: number }[];
    expect(top).toHaveLength(3);
    expect(top[0].rank).toBe(1);
    expect(top[0].label).toMatch(/^Пилот [A-Z0-9]{1,6}$/);
    expect(top[0].reward).toBe(SEASON_REWARDS.first);
  });

  it('в историю попадают только первые десять мест', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      rank: i + 1, playerId: `p-${i}`, points: 100 - i, level: 1, xp: 0,
      reward: i === 0 ? SEASON_REWARDS.first : i === 1 ? SEASON_REWARDS.second : i === 2 ? SEASON_REWARDS.third : SEASON_REWARDS.participation,
    }));
    const row = buildSeasonHistory(worldId, payload(many), createdAt);
    expect((JSON.parse(String(row?.topJson)) as unknown[])).toHaveLength(10);
    expect(row?.rewardsTotal).toBe(SEASON_REWARDS.first + SEASON_REWARDS.second + SEASON_REWARDS.third + SEASON_REWARDS.participation * 11);
  });

  it('снимок без данных сезона в историю не попадает', () => {
    const noSeason = JSON.stringify({ v: 1, kind: 'weekly', created_at: createdAt, season: null, totals: {} });
    expect(buildSeasonHistory(worldId, noSeason, createdAt)).toBeNull();
  });
});

// Конвейер архива целиком: мир отдаёт снимок, cron кладёт его в R2 или D1,
// дублирует историю сезона и только потом подтверждает. Тесты держат именно те
// свойства, которые на пустом проде проверить нечем: что запись идёт до ack,
// что сбой D1 оставляет снимок в мире и что payload не дублируется в R2-режиме.

interface Call {
  sql: string;
  params: unknown[];
}

function fakeEnv(snapshots: PendingSnapshot[], options: { bucket?: boolean; failAt?: number } = {}) {
  const calls: Call[] = [];
  const acked: string[][] = [];
  const uploaded: { key: string; body: string }[] = [];
  let attempt = 0;

  const DB = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              attempt += 1;
              if (options.failAt === attempt) throw new Error('D1 недоступна');
              calls.push({ sql, params });
              return { success: true, meta: { changes: 1 }, results: [] };
            },
          };
        },
      };
    },
  };

  const stub = {
    async takeSnapshots() {
      return snapshots;
    },
    async ackSnapshots(ids: string[]) {
      acked.push(ids);
      return ids.length;
    },
  };

  const env = {
    DB,
    WORLD: { idFromName: (name: string) => `do-${name}`, get: () => stub },
    ARCHIVE: options.bucket
      ? {
          async put(key: string, body: string) {
            uploaded.push({ key, body });
            return { key };
          },
        }
      : undefined,
  } as unknown as Env;

  return { env, calls, acked, uploaded };
}

function pending(overrides: Partial<PendingSnapshot> = {}): PendingSnapshot {
  return {
    id: 'snp-1',
    kind: 'weekly',
    seasonId: null,
    createdAt,
    sha256: 'a'.repeat(64),
    size: 640,
    headSeq: 10,
    headHash: 'b'.repeat(64),
    ok: true,
    payload: payload(podium),
    ...overrides,
  };
}

describe('конвейер архива (этап 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('без бакета снимок ложится в D1 и только потом подтверждается', async () => {
    const { env, calls, acked } = fakeEnv([pending()]);
    const result = await syncArchive(env, [worldId]);

    expect(result).toEqual({ archived: 1, uploaded: 0, failed: 0, seasons: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO world_snapshots');
    expect(calls[0].params.slice(0, 4)).toEqual(['snp-1', worldId, 'weekly', null]);
    // storage = d1, payload остаётся в D1
    expect(calls[0].params[7]).toBe('d1');
    expect(calls[0].params[8]).toBeNull();
    expect(calls[0].params[12]).toBe(payload(podium));
    expect(acked).toEqual([['snp-1']]);
  });

  it('закрытие сезона пишет ещё и историю с призами', async () => {
    const closed = payload(podium);
    const { env, calls, acked } = fakeEnv([
      pending({ kind: 'season_close', seasonId: 's1', payload: closed }),
    ]);
    const result = await syncArchive(env, [worldId]);

    expect(result.seasons).toBe(1);
    expect(calls.map((c) => (c.sql.includes('season_history') ? 'history' : 'snapshot')))
      .toEqual(['snapshot', 'history']);
    const history = calls[1].params;
    expect(history.slice(0, 3)).toEqual([worldId, 's1', 1]);
    expect(history[7]).toBe(999); // очки сезона из totals
    expect(history[8]).toBe(SEASON_REWARDS.first + SEASON_REWARDS.second + SEASON_REWARDS.third);
    expect(String(history[9])).toContain('Пилот');
    expect(acked).toEqual([['snp-1']]);
  });

  it('с бакетом payload не дублируется в D1, а ключ предсказуем', async () => {
    const { env, calls, uploaded, acked } = fakeEnv([pending()], { bucket: true });
    const result = await syncArchive(env, [worldId]);

    expect(result.uploaded).toBe(1);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].key).toBe(`worlds/${worldId}/snapshots/weekly-${createdAt}-snp-1.json`);
    expect(calls[0].params[7]).toBe('r2');
    expect(calls[0].params[8]).toBe(uploaded[0].key);
    expect(calls[0].params[12]).toBeNull();
    expect(acked).toEqual([['snp-1']]);
  });

  it('сбой D1 не подтверждает снимок: он уедет следующим проходом', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, calls, acked } = fakeEnv([pending()], { failAt: 1 });
    const result = await syncArchive(env, [worldId]);

    expect(result).toEqual({ archived: 0, uploaded: 0, failed: 1, seasons: 0 });
    expect(calls).toHaveLength(0);
    expect(acked).toEqual([]);
    quiet.mockRestore();
  });

  it('сбойный снимок не блокирует остальные', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, acked } = fakeEnv(
      [pending({ id: 'bad' }), pending({ id: 'good' })],
      { failAt: 1 },
    );
    const result = await syncArchive(env, [worldId]);

    expect(result.archived).toBe(1);
    expect(result.failed).toBe(1);
    expect(acked).toEqual([['good']]);
    quiet.mockRestore();
  });

  it('пустая очередь не трогает D1 и не подтверждает ничего', async () => {
    const { env, calls, acked } = fakeEnv([]);
    const result = await syncArchive(env, [worldId]);

    expect(result).toEqual({ archived: 0, uploaded: 0, failed: 0, seasons: 0 });
    expect(calls).toHaveLength(0);
    expect(acked).toEqual([]);
  });
});
