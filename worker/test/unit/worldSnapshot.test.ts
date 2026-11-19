import { describe, expect, it } from 'vitest';
import { SEASON_REWARDS } from '../../src/shared/constants';
import { verifyWorldSnapshot } from '../../../scripts/lib/verifyWorldSnapshot';

// Снимок из архива проверяется до того, как по нему начнут восстанавливать мир.
// Тест фиксирует правила: суммы, голова цепочки и призы должны сходиться.

function base() {
  return {
    v: 1,
    kind: 'weekly',
    created_at: 1_700_000_000_000,
    season: { id: 's1', number: 1, startsAt: 1, endsAt: 2, status: 'active', closedAt: null },
    totals: { players: 3, astra: 1500, fuel: 9, points: 120, resources: { iron_ore: 40, ice: 12 }, ships: 3, durability: 300, marketLots: 1 },
    ledger: { rows: 42, headSeq: 42, headHash: 'a'.repeat(64), verifyOk: true, brokenAtSeq: null },
  };
}

describe('проверка снимка мира (срез 3 этапа 3)', () => {
  it('целый снимок проходит проверку', () => {
    const check = verifyWorldSnapshot(base());
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.players).toBe(3);
    expect(check.ledgerRows).toBe(42);
  });

  it('снимок закрытия сезона требует итоги и сверяет призы с таблицей', () => {
    const snapshot = {
      ...base(),
      kind: 'season_close',
      // Сумма очков в итогах обязана совпадать с totals.points: иначе история
      // сезона в D1 разойдётся со снимком.
      totals: { ...base().totals, points: 400 },
      standings: [
        { rank: 1, playerId: 'p1', points: 300, level: 7, xp: 900, reward: SEASON_REWARDS.first },
        { rank: 2, playerId: 'p2', points: 100, level: 4, xp: 300, reward: SEASON_REWARDS.second },
      ],
    };
    expect(verifyWorldSnapshot(snapshot).ok).toBe(true);

    const wrongReward = { ...snapshot, standings: [{ ...snapshot.standings[0], reward: 999_999 }, snapshot.standings[1]] };
    const report = verifyWorldSnapshot(wrongReward);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('приз 999999');

    const noStandings = { ...snapshot, standings: undefined };
    expect(verifyWorldSnapshot(noStandings).problems.join(' ')).toContain('нет итоговой таблицы');
  });

  it('пустая голова цепочки при непустом Ledger — ошибка', () => {
    const snapshot = base();
    snapshot.ledger = { ...snapshot.ledger, headSeq: null, headHash: null };
    const report = verifyWorldSnapshot(snapshot);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('голова цепочки пуста');
  });

  it('отрицательные суммы и чужая версия формата не проходят', () => {
    const snapshot = { ...base(), v: 2 };
    snapshot.totals = { ...snapshot.totals, astra: -1, resources: { iron_ore: -5 } };
    const report = verifyWorldSnapshot(snapshot);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('версия снимка 2');
    expect(report.problems.join(' ')).toContain('totals.astra');
    expect(report.problems.join(' ')).toContain('ресурс iron_ore');
  });

  it('дубли игроков и дыры в местах ловятся', () => {
    const snapshot = {
      ...base(),
      kind: 'season_close',
      standings: [
        { rank: 1, playerId: 'p1', points: 10, level: 1, xp: 0, reward: SEASON_REWARDS.first },
        { rank: 1, playerId: 'p1', points: 10, level: 1, xp: 0, reward: SEASON_REWARDS.first },
      ],
    };
    const report = verifyWorldSnapshot(snapshot);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('ожидалось 2');
    expect(report.problems.join(' ')).toContain('дважды');
  });
});
