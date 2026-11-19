import { describe, expect, it } from 'vitest';
import { DAY_MS, SEASON_LENGTH_MS, SEASON_REWARDS, SNAPSHOT_INTERVAL_MS } from '../../src/shared/constants';
import { sha256Hex } from '../../src/shared/sha256';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { runSeasonClose, runSnapshotExport } from '../../src/world/jobs';
import {
  activeSeason, closeSeason, ensureSeason, ensureSeasonJobs, ratingRows, seasonBrief, seasonReport,
  seasonRewardFor,
} from '../../src/world/modules/season';
import { ackSnapshots, buildSnapshot, pendingSnapshots } from '../../src/world/modules/snapshots';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

type World = ReturnType<typeof makeWorld>;

function world(players: string[] = ['p1']): World {
  const w = makeWorld();
  for (const id of players) w.tx(() => createPlayer(w.sql, id, T0));
  return w;
}

/** Очки приходят только из рейсов, поэтому в тестах пишем их тем же журналом. */
function points(w: World, playerId: string, amount: number, at = T0 + 1000) {
  w.tx(() => applyDelta(w.sql, { playerId, asset: 'points', delta: amount, reason: 'expedition_reward', sourceRef: 'exp' }, at));
}

describe('сезоны: рамки и рейтинг (срез 1 этапа 3)', () => {
  it('первый сезон создаётся сам и длится восемь недель', () => {
    const { sql } = world();
    const s = ensureSeason(sql, T0);
    expect(s.number).toBe(1);
    expect(s.startsAt).toBe(T0);
    expect(s.endsAt - s.startsAt).toBe(SEASON_LENGTH_MS);
    expect(SEASON_LENGTH_MS / DAY_MS).toBe(56);
    expect(s.status).toBe('active');
    // Повторный вызов не плодит сезоны.
    expect(ensureSeason(sql, T0 + DAY_MS).id).toBe(s.id);
    expect(sql.exec('SELECT COUNT(*) AS c FROM seasons').toArray()[0].c).toBe(1);
  });

  it('пропущенные сезоны не догоняются: новый начинается сейчас, а не в прошлом', () => {
    const { sql } = world();
    const first = ensureSeason(sql, T0);
    closeSeason(sql, first.id, T0 + SEASON_LENGTH_MS);
    const second = ensureSeason(sql, T0 + SEASON_LENGTH_MS);
    expect(second.id).toBe('s2');
    // Мир спал ещё два сезона: закрываем второй, когда он давно кончился.
    const late = T0 + SEASON_LENGTH_MS * 4;
    closeSeason(sql, second.id, late);
    const third = ensureSeason(sql, late);
    expect(third.id).toBe('s3');
    expect(third.startsAt).toBe(late);
    expect(third.endsAt).toBe(late + SEASON_LENGTH_MS);
    // Пустые сезоны за пропущенное время не создаются пачкой.
    expect(sql.exec('SELECT COUNT(*) AS c FROM seasons').toArray()[0].c).toBe(3);
  });

  it('рейтинг сортируется по очкам, тай-брейк — опыт, затем дата регистрации', () => {
    const w = world(['p1', 'p2', 'p3']);
    const { sql } = w;
    ensureSeason(sql, T0);
    points(w, 'p1', 100);
    points(w, 'p2', 100);
    points(w, 'p3', 100);
    // p3 зарегистрирован раньше всех, p2 получает больше опыта.
    w.tx(() => sql.exec('UPDATE players SET created_at = ? WHERE id = ?', T0 - 5000, 'p3'));
    w.tx(() => sql.exec('UPDATE players SET xp = 50 WHERE id = ?', 'p2'));
    const order = ratingRows(sql).map((r) => r.id);
    expect(order).toEqual(['p2', 'p3', 'p1']);
  });

  it('в рейтинг попадают и игроки без очков — с нулём и своим местом', () => {
    const w = world(['p1', 'p2']);
    ensureSeason(w.sql, T0);
    points(w, 'p1', 30);
    const rows = ratingRows(w.sql);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: 'p2', points: 0 });
    const brief = seasonBrief(w.sql, 'p2', T0);
    expect(brief.rank).toBe(2);
    expect(brief.players).toBe(2);
    expect(brief.points).toBe(0);
    expect(brief.daysLeft).toBe(56);
  });

  it('награда за место: топ-3, топ-10, участие и ничего за ноль очков', () => {
    expect(seasonRewardFor(1, 500)).toBe(SEASON_REWARDS.first);
    expect(seasonRewardFor(2, 500)).toBe(SEASON_REWARDS.second);
    expect(seasonRewardFor(3, 500)).toBe(SEASON_REWARDS.third);
    expect(seasonRewardFor(7, 500)).toBe(SEASON_REWARDS.top10);
    expect(seasonRewardFor(50, 500)).toBe(SEASON_REWARDS.participation);
    expect(seasonRewardFor(1, 0)).toBe(0);
  });

  it('в отчёте есть своя строка, награда и таблица призов', () => {
    const w = world(['p1', 'p2']);
    ensureSeason(w.sql, T0);
    points(w, 'p1', 120);
    points(w, 'p2', 40);
    const report = seasonReport(w.sql, 'p1', T0 + DAY_MS);
    expect(report.season.number).toBe(1);
    expect(report.season.daysLeft).toBe(55);
    expect(report.me).toMatchObject({ rank: 1, points: 120, reward: SEASON_REWARDS.first });
    expect(report.top[0]).toMatchObject({ rank: 1, points: 120, isMe: true });
    expect(report.top[1].isMe).toBe(false);
    expect(report.top[0].label).toMatch(/^Пилот [A-Z0-9]{1,6}$/);
    expect(report.rewards.map((r) => r.place)).toEqual([1, 2, 3, '4–10', 'участие']);
    expect(report.past).toEqual([]);
  });
});

describe('сезоны: закрытие и призы (срез 2 этапа 3)', () => {
  it('закрытие платит по местам, обнуляет очки журналом и открывает следующий сезон', () => {
    const w = world(['p1', 'p2', 'p3', 'p4']);
    const { sql } = w;
    const season = ensureSeason(sql, T0);
    points(w, 'p1', 300);
    points(w, 'p2', 100);
    points(w, 'p3', 50);
    const astraBefore = getBalance(sql, 'p1', 'astra');
    const end = season.endsAt;

    const result = w.tx(() => closeSeason(sql, season.id, end));

    expect(result.closed).toBe(true);
    expect(result.players).toBe(4);
    expect(result.points).toBe(450);
    expect(result.rewards).toBe(SEASON_REWARDS.first + SEASON_REWARDS.second + SEASON_REWARDS.third);
    // p4 не играл — приза за участие нет.
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore + SEASON_REWARDS.first);
    expect(getBalance(sql, 'p4', 'astra')).toBe(500);
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(getBalance(sql, id, 'points')).toBe(0);

    const reasons = sql.exec('SELECT reason, asset, delta FROM ledger').toArray().map((r) => `${r.reason}:${r.asset}:${r.delta}`);
    expect(reasons).toContain(`season_reward:astra:${SEASON_REWARDS.first}`);
    expect(reasons).toContain('season_reset:points:-300');
    expect(verifyLedger(sql).ok).toBe(true);

    const closed = sql.exec('SELECT status, players, points FROM seasons WHERE id = ?', season.id).toArray()[0];
    expect(closed.status).toBe('closed');
    expect(closed.players).toBe(4);
    expect(closed.points).toBe(450);

    const next = activeSeason(sql);
    expect(next?.id).toBe('s2');
    expect(next?.startsAt).toBe(end);
    expect(next?.endsAt).toBe(end + SEASON_LENGTH_MS);
  });

  it('повторное закрытие ничего не платит и не плодит сезоны', () => {
    const w = world(['p1']);
    const { sql } = w;
    const season = ensureSeason(sql, T0);
    points(w, 'p1', 100);
    w.tx(() => closeSeason(sql, season.id, season.endsAt));
    const astraAfter = getBalance(sql, 'p1', 'astra');
    const again = w.tx(() => closeSeason(sql, season.id, season.endsAt + DAY_MS));
    expect(again.closed).toBe(false);
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraAfter);
    expect(sql.exec('SELECT COUNT(*) AS c FROM seasons').toArray()[0].c).toBe(2);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('итоги закрытого сезона видны в отчёте: победитель и своё место', () => {
    const w = world(['p1', 'p2']);
    const { sql } = w;
    const season = ensureSeason(sql, T0);
    points(w, 'p1', 80);
    points(w, 'p2', 20);
    w.tx(() => closeSeason(sql, season.id, season.endsAt));
    const report = seasonReport(sql, 'p2', season.endsAt + 1000);
    expect(report.season.number).toBe(2);
    expect(report.me.points).toBe(0);
    expect(report.past).toHaveLength(1);
    expect(report.past[0]).toMatchObject({ number: 1, players: 2, pointsTotal: 100 });
    expect(report.past[0].winner?.points).toBe(80);
    expect(report.past[0].me).toEqual({ rank: 2, points: 20, reward: SEASON_REWARDS.second });
  });

  it('замороженный мир призы не получает, задача переносится на час', () => {
    const w = world(['p1']);
    const { sql } = w;
    const season = ensureSeason(sql, T0);
    points(w, 'p1', 90);
    w.tx(() => sql.exec(`INSERT INTO meta (key, value) VALUES ('frozen', '1')`));
    const astraBefore = getBalance(sql, 'p1', 'astra');

    w.tx(() => runSeasonClose(sql, season.id, season.endsAt));

    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore);
    expect(getBalance(sql, 'p1', 'points')).toBe(90);
    const status = sql.exec('SELECT status FROM seasons WHERE id = ?', season.id).toArray()[0].status;
    expect(status).toBe('active');
    const job = sql.exec(`SELECT run_at FROM jobs WHERE kind = 'season_close' AND status = 'pending'`).toArray()[0];
    expect(Number(job.run_at)).toBe(season.endsAt + 60 * 60 * 1000);
  });

  it('закрытие по задаче снимает снимок сезона с итогами и головой цепочки', () => {
    const w = world(['p1', 'p2']);
    const { sql } = w;
    const season = ensureSeason(sql, T0);
    points(w, 'p1', 60);
    points(w, 'p2', 30);

    w.tx(() => runSeasonClose(sql, season.id, season.endsAt));

    const node = sql.exec(`SELECT kind, season_id, sha256, payload, ok FROM season_snapshots`).toArray()[0];
    expect(node.kind).toBe('season_close');
    expect(node.season_id).toBe(season.id);
    expect(Number(node.ok)).toBe(1);
    expect(sha256Hex(String(node.payload))).toBe(String(node.sha256));
    const snapshot = JSON.parse(String(node.payload));
    expect(snapshot.kind).toBe('season_close');
    expect(snapshot.season.id).toBe(season.id);
    expect(snapshot.standings).toHaveLength(2);
    expect(snapshot.standings[0]).toMatchObject({ rank: 1, points: 60, reward: SEASON_REWARDS.first });
    expect(snapshot.ledger.verifyOk).toBe(true);
    expect(snapshot.totals.players).toBe(2);
    // Очки к моменту снимка уже обнулены в balances, но в снимке должна остаться
    // сумма сезона — иначе история сезона в D1 запишет ноль.
    expect(snapshot.totals.points).toBe(90);
    expect(snapshot.standings?.reduce((sum, row) => sum + row.points, 0)).toBe(90);
    // Следующий сезон уже запланирован задачей.
    const next = sql.exec(`SELECT payload FROM jobs WHERE kind = 'season_close' AND status = 'pending'`).toArray()[0];
    expect(JSON.parse(String(next.payload)).seasonId).toBe('s2');
  });
});

describe('сезоны: планировщик и снимки (срез 3 этапа 3)', () => {
  it('задачи сезона и снимка существуют в одном экземпляре', () => {
    const w = world(['p1']);
    const { sql } = w;
    ensureSeasonJobs(sql, T0);
    ensureSeasonJobs(sql, T0 + 1000);
    const count = (kind: string) => Number(sql.exec(`SELECT COUNT(*) AS c FROM jobs WHERE kind = ?`, kind).toArray()[0].c);
    expect(count('season_close')).toBe(1);
    expect(count('snapshot_export')).toBe(1);
  });

  it('недельный снимок пишет сводку мира и не дублирует сам себя', () => {
    const w = world(['p1', 'p2']);
    const { sql } = w;
    ensureSeason(sql, T0);
    points(w, 'p1', 40);
    w.tx(() => runSnapshotExport(sql, T0 + DAY_MS));
    w.tx(() => runSnapshotExport(sql, T0 + DAY_MS + SNAPSHOT_INTERVAL_MS));
    const rows = sql.exec('SELECT kind FROM season_snapshots ORDER BY created_at').toArray();
    expect(rows.map((r) => r.kind)).toEqual(['weekly', 'weekly']);
    const snapshot = buildSnapshot(sql, 'weekly', T0 + DAY_MS);
    expect(snapshot.totals.players).toBe(2);
    expect(snapshot.totals.ships).toBe(2);
    expect(snapshot.totals.points).toBe(40);
    expect(snapshot.ledger.rows).toBeGreaterThan(0);
    expect(snapshot.standings).toBeUndefined();
  });

  it('снимки уходят из мира только после подтверждения архива', () => {
    const w = world(['p1']);
    const { sql } = w;
    ensureSeason(sql, T0);
    w.tx(() => runSnapshotExport(sql, T0 + DAY_MS));
    const pending = pendingSnapshots(sql);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('weekly');
    expect(pendingSnapshots(sql)).toHaveLength(1);
    expect(ackSnapshots(sql, [pending[0].id])).toBe(1);
    expect(pendingSnapshots(sql)).toHaveLength(0);
  });

  it('снимок одинакового мира побайтно одинаков — sha256 воспроизводим', () => {
    const w = world(['p1', 'p2']);
    ensureSeason(w.sql, T0);
    points(w, 'p1', 10);
    const a = JSON.stringify(buildSnapshot(w.sql, 'weekly', T0 + 500));
    const b = JSON.stringify(buildSnapshot(w.sql, 'weekly', T0 + 500));
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    const c = JSON.stringify(buildSnapshot(w.sql, 'weekly', T0 + 501));
    expect(sha256Hex(c)).not.toBe(sha256Hex(a));
  });
});
