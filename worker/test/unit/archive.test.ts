import { describe, expect, it } from 'vitest';
import { SEASON_REWARDS } from '../../src/shared/constants';
import { buildSeasonHistory } from '../../src/archive';

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
