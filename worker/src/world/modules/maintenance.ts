import { FUEL_REGEN_MS, utcDay } from '../../shared/constants';
import { MODULES, SHIPS, TANK_MODULES, type ModuleId, type ShipType } from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { cleanupIdempotency } from '../idempotency';
import { appendLedger } from '../ledger';
import { LEDGER_TAIL_KEY, VERIFY_HASH_KEY, VERIFY_SEQ_KEY, verifyLedger, verifyNow, verifyWatermark } from '../ledger';
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
  // Бак считается по лучшему кораблю флота. Топливная система и контур
  // охлаждения расширяют бак своего корабля, поэтому модули читаются вместе с
  // типом: два модуля на одном корпусе дают сумму обоих.
  // Порядок параметров = порядок вопросов в SQL: сначала список модулей, потом
  // игрок. Переставить их местами — и бак молча станет нулевым.
  const rows = sql.exec(
    `SELECT s.id AS id, s.type AS type, m.module AS module, m.level AS level
       FROM ships s
       LEFT JOIN ship_modules m ON m.ship_id = s.id AND m.module IN (${TANK_MODULES.map(() => '?').join(', ')})
      WHERE s.player_id = ?`,
    ...TANK_MODULES, playerId,
  ).toArray();
  // Бонус считаем по каждому модулю отдельно: у них разные perLevel, и правка
  // формулы не должна требовать миграции.
  const bonus = new Map<string, number>();
  const types = new Map<string, ShipType>();
  for (const row of rows) {
    const shipId = String(row.id);
    types.set(shipId, String(row.type) as ShipType);
    const def = row.module == null ? null : MODULES[String(row.module) as ModuleId];
    if (!def) continue;
    bonus.set(shipId, (bonus.get(shipId) ?? 0) + Number(row.level) * def.perLevel);
  }
  let cap = 0;
  for (const [shipId, type] of types) {
    const ship = SHIPS[type];
    if (!ship) continue;
    cap = Math.max(cap, ship.tank + (bonus.get(shipId) ?? 0));
  }
  return Math.floor(cap);
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

/** Как часто сверяем журнал мира. Минута-в-минуту не нужно, час — достаточно. */
export const VERIFY_INTERVAL_MS = 60 * 60 * 1000;

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
  if (!has('ledger_verify')) {
    // Первую сверку делаем скоро: так ошибка в свежем мире видна в тот же день.
    // Дальше — раз в час: полный пересчёт журнала на каждом шаге не нужен, а
    // каждое пробуждение мира стоит времени Durable Object.
    const last = sql.exec(`SELECT value FROM meta WHERE key = 'last_verify_at'`).toArray()[0]?.value;
    const everVerified = Number(last ?? 0) > 0;
    enqueue(sql, 'ledger_verify', now + (everVerified ? VERIFY_INTERVAL_MS : 5 * 60 * 1000), {});
  }
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


/**
 * Как часто делать полную перепроверку от генезиса.
 *
 * Часовой прогон — быстрый: суммы целиком и хеш-цепочка только нового. Раз в
 * неделю мир всё-таки перечитывает журнал от первой строки, чтобы «тихая»
 * подмена старой записи не осталась живой навсегда. Между этими прогонами
 * подделку выдают расхождение сумм и счётчики строк.
 */
export const FULL_VERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function metaGet(sql: SqlStorage, key: string): string | null {
  const row = sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
  return row === undefined ? null : String(row.value);
}

export function setMeta(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key, value,
  );
}

export function runLedgerVerify(sql: SqlStorage, now: number): void {
  const lastFull = Number(metaGet(sql, 'ledger_verify_full_at') ?? 0);
  // Первая сверка (или мир без отметки) — всегда полная: нечего ещё и ускорять.
  const full = !verifyWatermark(sql) || now - lastFull >= FULL_VERIFY_INTERVAL_MS;
  const report = full ? verifyLedger(sql) : verifyNow(sql);

  setMeta(sql, 'last_verify_at', String(now));
  setMeta(sql, 'last_verify_ok', report.ok ? '1' : '0');
  if (full) setMeta(sql, 'ledger_verify_full_at', String(now));
  sql.exec(
    `INSERT INTO ledger_checks (day, at, ok) VALUES (?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET at = excluded.at, ok = excluded.ok`,
    utcDay(now), now, report.ok ? 1 : 0,
  );
  if (report.ok) {
    // Отметку двигаем только при успехе: следующий прогон начнёт отсюда.
    if (report.head) {
      setMeta(sql, VERIFY_SEQ_KEY, String(report.head.seq));
      setMeta(sql, VERIFY_HASH_KEY, report.head.hash);
    }
    setMeta(sql, LEDGER_TAIL_KEY, `${report.rows}:${report.head?.seq ?? 0}`);
    // Голова закреплена: `verifyLedgerFast` сверит с ней следующий прогон.
    setMeta(sql, 'frozen', '0');
  } else {
    setMeta(sql, 'frozen', '1');
    setMeta(sql, 'frozen_seq', String(report.brokenAtSeq ?? ''));
  }
  enqueue(sql, 'ledger_verify', now + VERIFY_INTERVAL_MS, {});
}

/** Флаги рынка протухают: разбор сделки старше трёх месяцев уже не нужен. */
export const MARKET_FLAG_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** И жёсткий потолок строк: флаг пишется на каждую «крупную» сделку. */
export const MARKET_FLAG_MAX = 5_000;

/**
 * Сколько строк `market_flags` осталось после чистки. Наружу — ради теста:
 * «удалили лишнее» нельзя проверить, не посмотрев в таблицу.
 */
export function pruneMarketFlags(sql: SqlStorage, now: number): number {
  sql.exec('DELETE FROM market_flags WHERE at < ?', now - MARKET_FLAG_TTL_MS);
  sql.exec(
    `DELETE FROM market_flags WHERE id NOT IN (
        SELECT id FROM market_flags ORDER BY at DESC LIMIT ?
     )`,
    MARKET_FLAG_MAX,
  );
  return Number(sql.exec('SELECT COUNT(*) AS c FROM market_flags').toArray()[0].c);
}

export function runIdemCleanup(sql: SqlStorage, now: number): void {
  cleanupIdempotency(sql, now);
  sql.exec(`DELETE FROM jobs WHERE status IN ('done', 'failed') AND run_at < ?`, now - 7 * 24 * 60 * 60 * 1000);
  // Флаги подозрительных сделок пишет каждый крупный или «парный» оборот, и
  // чистит их больше некому: без этой строки таблица растёт всю жизнь, а
  // читают её редко и только в админке.
  pruneMarketFlags(sql, now);
  enqueue(sql, 'idem_cleanup', now + 24 * 60 * 60 * 1000, {});
}

export function assertPlayable(sql: SqlStorage): void {
  if (isFrozen(sql)) throw new ApiError(423, 'world_frozen');
}
