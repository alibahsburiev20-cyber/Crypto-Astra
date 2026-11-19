import { FUEL_REGEN_MS, utcDay } from '../../shared/constants';
import { MODULES, SHIPS, type ShipType } from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { cleanupIdempotency } from '../idempotency';
import { appendLedger } from '../ledger';
import { verifyLedger } from '../ledger';
import { enqueue, playerPayload } from '../scheduler';
import { ensureSeasonJobs } from './season';

export function isFrozen(sql: SqlStorage): boolean {
  const r = sql.exec(`SELECT value FROM meta WHERE key = 'frozen'`).toArray();
  return r.length > 0 && String(r[0].value) === '1';
}

// Статус последней сверки Ledger. Нужен и клиенту (экран журнала), и оператору:
// без этого поля результат ежедневного `ledger_verify` виден только внутри мира.
export function verifyStatus(sql: SqlStorage, now: number): { at: number | null; ok: boolean | null; streak: number } {
  const rows = sql.exec(`SELECT key, value FROM meta WHERE key IN ('last_verify_at', 'last_verify_ok')`).toArray();
  const meta = new Map(rows.map((r) => [String(r.key), String(r.value)]));
  const atRaw = meta.get('last_verify_at');
  const at = atRaw === undefined ? NaN : Number(atRaw);
  const okRaw = meta.get('last_verify_ok');
  const checks = sql.exec('SELECT day, ok FROM ledger_checks ORDER BY day DESC').toArray()
    .map((r) => ({ day: Number(r.day), ok: Number(r.ok) === 1 }));
  return {
    at: Number.isFinite(at) ? at : null,
    ok: okRaw === undefined ? null : okRaw === '1',
    streak: verifyStreak(checks, utcDay(now)),
  };
}

/**
 * Сколько дней подряд сверка проходила без расхождений. Гейт 1 требует семь.
 * Сегодняшняя сверка может быть ещё не сделана — тогда считаем со вчерашнего дня,
 * иначе счётчик обнулялся бы каждую полночь.
 */
export function verifyStreak(checks: { day: number; ok: boolean }[], today: number): number {
  const byDay = new Map(checks.map((c) => [c.day, c.ok]));
  let day = byDay.has(today) ? today : today - 1;
  let streak = 0;
  while (byDay.get(day) === true) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

export function fuelCap(sql: SqlStorage, playerId: string): number {
  // Бак считается по лучшему кораблю флота. Топливная система расширяет бак
  // своего корабля, поэтому уровень читается вместе с типом.
  const rows = sql.exec(
    `SELECT s.type AS type,
            COALESCE((SELECT level FROM ship_modules m WHERE m.ship_id = s.id AND m.module = 'fuel_system'), 0) AS tank_level
       FROM ships s WHERE s.player_id = ?`,
    playerId,
  ).toArray();
  let cap = 0;
  for (const row of rows) {
    const def = SHIPS[String(row.type) as ShipType];
    if (!def) continue;
    const bonus = Number(row.tank_level) * MODULES.fuel_system.perLevel;
    cap = Math.max(cap, def.tank + bonus);
  }
  return cap;
}

interface Daily { expeditions: number; fuelBought: number; pointsGained: number }

export function dailyOf(sql: SqlStorage, playerId: string, day: number): Daily {
  const r = sql.exec(
    'SELECT expeditions, fuel_bought, points_gained FROM daily_counters WHERE player_id = ? AND day = ?',
    playerId, day,
  ).toArray();
  if (!r.length) return { expeditions: 0, fuelBought: 0, pointsGained: 0 };
  return { expeditions: Number(r[0].expeditions), fuelBought: Number(r[0].fuel_bought), pointsGained: Number(r[0].points_gained) };
}

export function bumpDaily(sql: SqlStorage, playerId: string, day: number, field: 'expeditions' | 'fuel_bought' | 'points_gained', amount: number): void {
  const d = dailyOf(sql, playerId, day);
  const next = {
    expeditions: d.expeditions + (field === 'expeditions' ? amount : 0),
    fuel_bought: d.fuelBought + (field === 'fuel_bought' ? amount : 0),
    points_gained: d.pointsGained + (field === 'points_gained' ? amount : 0),
  };
  sql.exec(
    `INSERT INTO daily_counters (player_id, day, expeditions, fuel_bought, points_gained) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (player_id, day) DO UPDATE SET expeditions = excluded.expeditions, fuel_bought = excluded.fuel_bought, points_gained = excluded.points_gained`,
    playerId, day, next.expeditions, next.fuel_bought, next.points_gained,
  );
}

/**
 * Изменение ресурса и запись в журнал одной операцией. Срез 1 этапа 2: до этого
 * ресурсы жили в таблице resources и в Ledger не попадали вовсе.
 */
export function applyResourceDelta(
  sql: SqlStorage,
  input: { playerId: string; resource: string; delta: number; reason: string; sourceRef?: string | null; idemKey?: string | null },
  now: number,
): number {
  if (!Number.isInteger(input.delta) || input.delta === 0) return getResource(sql, input.playerId, input.resource);
  const next = getResource(sql, input.playerId, input.resource) + input.delta;
  if (next < 0) throw new ApiError(409, 'insufficient_resources');
  if (next === 0) {
    sql.exec('DELETE FROM resources WHERE player_id = ? AND resource = ?', input.playerId, input.resource);
  } else {
    sql.exec(
      `INSERT INTO resources (player_id, resource, amount) VALUES (?, ?, ?)
       ON CONFLICT (player_id, resource) DO UPDATE SET amount = excluded.amount`,
      input.playerId, input.resource, next,
    );
  }
  appendLedger(sql, {
    playerId: input.playerId,
    asset: `res:${input.resource}`,
    delta: input.delta,
    reason: input.reason,
    sourceRef: input.sourceRef ?? null,
    idemKey: input.idemKey ?? null,
  }, now);
  return next;
}

export function getResource(sql: SqlStorage, playerId: string, resource: string): number {
  const r = sql.exec('SELECT amount FROM resources WHERE player_id = ? AND resource = ?', playerId, resource).toArray();
  return r.length ? Number(r[0].amount) : 0;
}

export function addResource(sql: SqlStorage, playerId: string, resource: string, amount: number, now: number, sourceRef?: string): void {
  if (amount <= 0) return;
  applyResourceDelta(sql, { playerId, resource, delta: amount, reason: 'resource_gain', sourceRef: sourceRef ?? null }, now);
}

/** Сколько топлива выдать, если задача просрочена, и когда ставить следующую. */
export function regenPlan(runAt: number, now: number, have: number, cap: number): { grant: number; nextAt: number } {
  if (now < runAt) return { grant: 0, nextAt: runAt };
  const ticks = 1 + Math.floor((now - runAt) / FUEL_REGEN_MS);
  const space = Math.max(0, cap - have);
  const grant = Math.min(space, ticks);
  const nextAt = grant < ticks ? now + FUEL_REGEN_MS : runAt + ticks * FUEL_REGEN_MS;
  return { grant, nextAt };
}

export function ensureMaintenance(sql: SqlStorage, now: number): void {
  const has = (kind: string) => sql.exec(`SELECT 1 FROM jobs WHERE kind = ? AND status = 'pending' LIMIT 1`, kind).toArray().length > 0;
  if (!has('ledger_verify')) enqueue(sql, 'ledger_verify', now + 5 * 60 * 1000, {});
  if (!has('idem_cleanup')) enqueue(sql, 'idem_cleanup', now + 24 * 60 * 60 * 1000, {});
  ensureSeasonJobs(sql, now);
  const players = sql.exec('SELECT id FROM players').toArray();
  for (const p of players) {
    const id = String(p.id);
    const pending = sql.exec(
      `SELECT 1 FROM jobs WHERE kind = 'fuel_regen' AND status = 'pending' AND payload = ? LIMIT 1`,
      playerPayload(id),
    ).toArray();
    if (!pending.length) enqueue(sql, 'fuel_regen', now + FUEL_REGEN_MS, { playerId: id });
  }
}

export function runFuelRegen(sql: SqlStorage, playerId: string, scheduledAt: number, now: number): void {
  const exists = sql.exec('SELECT 1 FROM players WHERE id = ?', playerId).toArray();
  if (!exists.length) return;
  if (isFrozen(sql)) {
    enqueue(sql, 'fuel_regen', now + FUEL_REGEN_MS, { playerId });
    return;
  }
  const cap = fuelCap(sql, playerId);
  const have = getBalance(sql, playerId, 'fuel');
  const plan = regenPlan(scheduledAt, now, have, cap);
  if (plan.grant > 0) {
    applyDelta(sql, { playerId, asset: 'fuel', delta: plan.grant, reason: 'fuel_regen', sourceRef: 'regen' }, now);
  }
  enqueue(sql, 'fuel_regen', plan.nextAt, { playerId });
}

export function runLedgerVerify(sql: SqlStorage, now: number): void {
  const report = verifyLedger(sql);
  const set = (key: string, value: string) => sql.exec(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key, value,
  );
  set('last_verify_at', String(now));
  set('last_verify_ok', report.ok ? '1' : '0');
  sql.exec(
    `INSERT INTO ledger_checks (day, at, ok) VALUES (?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET at = excluded.at, ok = excluded.ok`,
    utcDay(now), now, report.ok ? 1 : 0,
  );
  set('frozen', report.ok ? '0' : '1');
  if (!report.ok) set('frozen_seq', String(report.brokenAtSeq ?? ''));
  enqueue(sql, 'ledger_verify', now + 24 * 60 * 60 * 1000, {});
}

export function runIdemCleanup(sql: SqlStorage, now: number): void {
  cleanupIdempotency(sql, now);
  sql.exec(`DELETE FROM jobs WHERE status IN ('done', 'failed') AND run_at < ?`, now - 7 * 24 * 60 * 60 * 1000);
  enqueue(sql, 'idem_cleanup', now + 24 * 60 * 60 * 1000, {});
}

export function assertPlayable(sql: SqlStorage): void {
  if (isFrozen(sql)) throw new ApiError(423, 'world_frozen');
}
