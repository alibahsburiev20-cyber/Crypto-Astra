import { utcDay } from '../../shared/constants';
import {
  EVENTS, EXPEDITION_TYPES, PLANET_BY_ID, SHIPS, sectorById,
  type EventKind, type ExpeditionKind, type ShipType,
} from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { dropExpeditionJobs, enqueue } from '../scheduler';
import {
  applyEventChoice, canCancel, computeReward, eventKindFor, eventSchedule, fuelCost, isKind, levelFromXp, safeChoiceId,
  type Reward,
} from './expeditionMath';
import { addResource, assertPlayable, bumpDaily, dailyOf, fuelCap } from './maintenance';

interface ShipRow { id: string; type: ShipType; durability: number; status: string }

function shipOf(sql: SqlStorage, playerId: string, shipId: string): ShipRow {
  const rows = sql.exec('SELECT id, type, durability, status FROM ships WHERE id = ? AND player_id = ?', shipId, playerId).toArray();
  if (!rows.length) throw new ApiError(404, 'ship_not_found');
  return { id: String(rows[0].id), type: String(rows[0].type) as ShipType, durability: Number(rows[0].durability), status: String(rows[0].status) };
}

function newSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ExpeditionView {
  id: string;
  shipId: string;
  planet: string;
  kind: ExpeditionKind;
  status: string;
  startedAt: number;
  endsAt: number;
  fuelSpent: number;
  cancelUntil: number;
  reward: Reward | null;
  event: null | {
    id: string;
    idx: number;
    kind: EventKind;
    title: string;
    text: string;
    deadlineAt: number;
    choices: { id: string; label: string; safe: boolean }[];
  };
}

function viewOf(sql: SqlStorage, row: Record<string, unknown>): ExpeditionView {
  const kind = String(row.kind) as ExpeditionKind;
  const startedAt = Number(row.started_at);
  const endsAt = Number(row.ends_at);
  let reward: Reward | null = null;
  if (row.reward_json) {
    try { reward = JSON.parse(String(row.reward_json)) as Reward; } catch { reward = null; }
  }
  let event: ExpeditionView['event'] = null;
  if (row.status === 'waiting_choice') {
    const ev = sql.exec(
      `SELECT id, idx, kind, deadline_at FROM expedition_events WHERE expedition_id = ? AND status = 'waiting' ORDER BY idx LIMIT 1`,
      String(row.id),
    ).toArray();
    if (ev.length) {
      const k = String(ev[0].kind) as EventKind;
      const def = EVENTS[k];
      event = {
        id: String(ev[0].id), idx: Number(ev[0].idx), kind: k, title: def.title, text: def.text, deadlineAt: Number(ev[0].deadline_at),
        choices: def.choices.map((c) => ({ id: c.id, label: c.label, safe: c.safe })),
      };
    }
  }
  return {
    id: String(row.id), shipId: String(row.ship_id), planet: String(row.planet), kind, status: String(row.status),
    startedAt, endsAt, fuelSpent: Number(row.fuel_spent), cancelUntil: startedAt + Math.floor((endsAt - startedAt) * 0.1),
    reward, event,
  };
}

export function listExpeditions(sql: SqlStorage, playerId: string): { active: ExpeditionView | null; recent: ExpeditionView[] } {
  const activeRows = sql.exec(
    `SELECT * FROM expeditions WHERE player_id = ? AND status IN ('flying', 'waiting_choice') ORDER BY started_at DESC LIMIT 1`,
    playerId,
  ).toArray();
  const recent = sql.exec(
    `SELECT * FROM expeditions WHERE player_id = ? AND status IN ('completed', 'cancelled') ORDER BY created_at DESC LIMIT 5`,
    playerId,
  ).toArray();
  return {
    active: activeRows.length ? viewOf(sql, activeRows[0]) : null,
    recent: recent.map((r) => viewOf(sql, r)),
  };
}

export interface StartResult { expedition: ExpeditionView }

export function startExpedition(
  sql: SqlStorage, playerId: string, idemKey: string, body: { shipId: string; planet: string; kind: string }, now: number,
): StartResult {
  return withIdempotency(sql, playerId, 'expedition_start', idemKey, body, now, () => {
    assertPlayable(sql);
    if (!isKind(body.kind)) throw new ApiError(400, 'bad_expedition');
    const planet = PLANET_BY_ID[body.planet];
    if (!planet) throw new ApiError(400, 'bad_expedition');
    const ship = shipOf(sql, playerId, body.shipId);
    const def = SHIPS[ship.type];
    if (!def) throw new ApiError(400, 'bad_expedition');
    if (ship.durability <= 0) throw new ApiError(409, 'ship_broken');
    if (ship.status !== 'idle') throw new ApiError(409, 'ship_busy');
    const busy = sql.exec(
      `SELECT 1 FROM expeditions WHERE ship_id = ? AND status IN ('flying', 'waiting_choice') LIMIT 1`,
      ship.id,
    ).toArray();
    if (busy.length) throw new ApiError(409, 'ship_busy');
    const player = sql.exec('SELECT level FROM players WHERE id = ?', playerId).toArray();
    if (!player.length) throw new ApiError(404, 'player_not_found');
    const sector = sectorById(planet.sector);
    if (Number(player[0].level) < sector.level) throw new ApiError(403, 'sector_locked');
    if (def.maxSector < planet.sector) throw new ApiError(403, 'ship_range');
    const cost = fuelCost(def.consumption, body.kind);
    if (getBalance(sql, playerId, 'fuel') < cost) throw new ApiError(409, 'not_enough_fuel');

    const type = EXPEDITION_TYPES[body.kind];
    const id = crypto.randomUUID();
    const seed = newSeed();
    const endsAt = now + type.durationMs;
    applyDelta(sql, { playerId, asset: 'fuel', delta: -cost, reason: 'expedition_start', sourceRef: id, idemKey }, now);
    sql.exec(
      `INSERT INTO expeditions (
         id, player_id, ship_id, planet, kind, status, seed, started_at, ends_at, fuel_spent, event_bonus_bp, extra_wear, created_at
       ) VALUES (?, ?, ?, ?, ?, 'flying', ?, ?, ?, ?, 1000, 0, ?)`,
      id, playerId, ship.id, planet.id, body.kind, seed, now, endsAt, cost, now,
    );
    sql.exec(`UPDATE ships SET status = 'flying' WHERE id = ?`, ship.id);
    const slots = eventSchedule(now, endsAt, type.events);
    slots.forEach((slot, idx) => {
      sql.exec(
        `INSERT INTO expedition_events (id, expedition_id, idx, kind, opens_at, deadline_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        crypto.randomUUID(), id, idx, eventKindFor(seed, idx), slot.opensAt, slot.deadlineAt,
      );
    });
    if (slots.length) enqueue(sql, 'expedition_event', slots[0].opensAt, { expeditionId: id, eventIdx: 0 });
    enqueue(sql, 'expedition_finish', endsAt, { expeditionId: id });
    const row = sql.exec('SELECT * FROM expeditions WHERE id = ?', id).toArray()[0];
    return { value: { expedition: viewOf(sql, row) }, store: true };
  });
}

export function cancelExpedition(sql: SqlStorage, playerId: string, idemKey: string, expeditionId: string, now: number): StartResult {
  return withIdempotency(sql, playerId, 'expedition_cancel', idemKey, { expeditionId }, now, () => {
    assertPlayable(sql);
    const rows = sql.exec('SELECT * FROM expeditions WHERE id = ? AND player_id = ?', expeditionId, playerId).toArray();
    if (!rows.length) throw new ApiError(404, 'expedition_not_found');
    const row = rows[0];
    if (row.status === 'cancelled' || row.status === 'completed') throw new ApiError(409, 'expedition_done');
    if (!canCancel(Number(row.started_at), Number(row.ends_at), now)) throw new ApiError(409, 'too_late_to_cancel');
    const refund = Math.floor(Number(row.fuel_spent) / 2);
    if (refund > 0) {
      const cap = fuelCap(sql, playerId);
      const have = getBalance(sql, playerId, 'fuel');
      const grant = Math.min(refund, Math.max(0, cap - have));
      if (grant > 0) applyDelta(sql, { playerId, asset: 'fuel', delta: grant, reason: 'expedition_cancel', sourceRef: expeditionId, idemKey }, now);
    }
    sql.exec(`UPDATE expeditions SET status = 'cancelled' WHERE id = ?`, expeditionId);
    sql.exec(`UPDATE ships SET status = 'idle' WHERE id = ?`, String(row.ship_id));
    dropExpeditionJobs(sql, expeditionId);
    const updated = sql.exec('SELECT * FROM expeditions WHERE id = ?', expeditionId).toArray()[0];
    return { value: { expedition: viewOf(sql, updated) }, store: true };
  });
}

function loadOpen(sql: SqlStorage, expeditionId: string): Record<string, unknown> {
  const rows = sql.exec('SELECT * FROM expeditions WHERE id = ?', expeditionId).toArray();
  if (!rows.length) throw new ApiError(404, 'expedition_not_found');
  return rows[0];
}

function resolveChoice(sql: SqlStorage, row: Record<string, unknown>, eventIdx: number, choiceId: string, now: number): void {
  const evRows = sql.exec(
    'SELECT id, idx, kind, status FROM expedition_events WHERE expedition_id = ? AND idx = ?',
    String(row.id), eventIdx,
  ).toArray();
  if (!evRows.length || evRows[0].status === 'resolved') return;
  const kind = String(evRows[0].kind) as EventKind;
  const outcome = applyEventChoice(String(row.seed), eventIdx, kind, choiceId, Number(row.event_bonus_bp));
  sql.exec(
    `UPDATE expeditions SET event_bonus_bp = ?, extra_wear = extra_wear + ?, status = 'flying' WHERE id = ?`,
    outcome.eventBonusBp, outcome.extraWear, String(row.id),
  );
  sql.exec(`UPDATE expedition_events SET status = 'resolved', choice = ? WHERE id = ?`, choiceId, String(evRows[0].id));
  if (outcome.fuel > 0 && !isFrozenSafe(sql)) {
    const playerId = String(row.player_id);
    const cap = fuelCap(sql, playerId);
    const have = getBalance(sql, playerId, 'fuel');
    if (have < cap) applyDelta(sql, { playerId, asset: 'fuel', delta: 1, reason: 'expedition_event', sourceRef: String(row.id) }, now);
  }
  const next = sql.exec(
    `SELECT idx, opens_at FROM expedition_events WHERE expedition_id = ? AND status = 'pending' ORDER BY idx LIMIT 1`,
    String(row.id),
  ).toArray();
  if (next.length) {
    const opensAt = Math.max(Number(next[0].opens_at), now);
    enqueue(sql, 'expedition_event', opensAt, { expeditionId: String(row.id), eventIdx: Number(next[0].idx) });
  }
}

function isFrozenSafe(sql: SqlStorage): boolean {
  const r = sql.exec(`SELECT value FROM meta WHERE key = 'frozen'`).toArray();
  return r.length > 0 && String(r[0].value) === '1';
}

export function openExpeditionEvent(sql: SqlStorage, expeditionId: string, eventIdx: number, now: number): void {
  const row = loadOpen(sql, expeditionId);
  if (row.status === 'completed' || row.status === 'cancelled') return;
  const ev = sql.exec(
    'SELECT id, status, deadline_at FROM expedition_events WHERE expedition_id = ? AND idx = ?',
    expeditionId, eventIdx,
  ).toArray();
  if (!ev.length || ev[0].status !== 'pending') return;
  sql.exec(`UPDATE expedition_events SET status = 'waiting' WHERE id = ?`, String(ev[0].id));
  sql.exec(`UPDATE expeditions SET status = 'waiting_choice' WHERE id = ?`, expeditionId);
  enqueue(sql, 'expedition_event_timeout', Number(ev[0].deadline_at), { expeditionId, eventIdx });
}

export function timeoutExpeditionEvent(sql: SqlStorage, expeditionId: string, eventIdx: number, now: number): void {
  const row = loadOpen(sql, expeditionId);
  if (row.status !== 'waiting_choice') return;
  const ev = sql.exec(
    'SELECT kind, status FROM expedition_events WHERE expedition_id = ? AND idx = ?',
    expeditionId, eventIdx,
  ).toArray();
  if (!ev.length || ev[0].status !== 'waiting') return;
  resolveChoice(sql, row, eventIdx, safeChoiceId(String(ev[0].kind) as EventKind), now);
}

export function chooseExpeditionEvent(
  sql: SqlStorage, playerId: string, idemKey: string, expeditionId: string, choiceId: string, now: number,
): StartResult {
  return withIdempotency(sql, playerId, 'expedition_choose', idemKey, { expeditionId, choiceId }, now, () => {
    assertPlayable(sql);
    const rows = sql.exec('SELECT * FROM expeditions WHERE id = ? AND player_id = ?', expeditionId, playerId).toArray();
    if (!rows.length) throw new ApiError(404, 'expedition_not_found');
    const row = rows[0];
    if (row.status !== 'waiting_choice') throw new ApiError(409, 'not_waiting');
    const ev = sql.exec(
      `SELECT idx, kind, status, deadline_at FROM expedition_events WHERE expedition_id = ? AND status = 'waiting' ORDER BY idx LIMIT 1`,
      expeditionId,
    ).toArray();
    if (!ev.length) throw new ApiError(409, 'not_waiting');
    const kind = String(ev[0].kind) as EventKind;
    const known = EVENTS[kind].choices.some((c) => c.id === choiceId);
    if (!known) throw new ApiError(400, 'bad_choice');
    const pick = now > Number(ev[0].deadline_at) ? safeChoiceId(kind) : choiceId;
    resolveChoice(sql, row, Number(ev[0].idx), pick, now);
    const updated = sql.exec('SELECT * FROM expeditions WHERE id = ?', expeditionId).toArray()[0];
    return { value: { expedition: viewOf(sql, updated) }, store: true };
  });
}

export function finishExpedition(sql: SqlStorage, expeditionId: string, now: number): void {
  const rows = sql.exec('SELECT * FROM expeditions WHERE id = ?', expeditionId).toArray();
  if (!rows.length) return;
  const row = rows[0];
  if (row.status === 'completed' || row.status === 'cancelled') return;
  if (isFrozenSafe(sql)) {
    enqueue(sql, 'expedition_finish', now + 60 * 60 * 1000, { expeditionId });
    return;
  }
  const waiting = sql.exec(
    `SELECT idx, kind FROM expedition_events WHERE expedition_id = ? AND status = 'waiting'`,
    expeditionId,
  ).toArray();
  for (const ev of waiting) resolveChoice(sql, row, Number(ev.idx), safeChoiceId(String(ev.kind) as EventKind), now);
  sql.exec(`UPDATE expedition_events SET status = 'resolved', choice = 'skipped' WHERE expedition_id = ? AND status = 'pending'`, expeditionId);

  const fresh = sql.exec('SELECT * FROM expeditions WHERE id = ?', expeditionId).toArray()[0];
  const playerId = String(fresh.player_id);
  const ship = shipOf(sql, playerId, String(fresh.ship_id));
  const planet = PLANET_BY_ID[String(fresh.planet)];
  const kind = String(fresh.kind) as ExpeditionKind;
  const day = utcDay(now);
  const daily = dailyOf(sql, playerId, day);
  const reward = computeReward({
    planet, shipType: ship.type, kind, seed: String(fresh.seed),
    eventBonusBp: Number(fresh.event_bonus_bp), extraWear: Number(fresh.extra_wear), durability: ship.durability,
    expeditionsToday: daily.expeditions, pointsToday: daily.pointsGained,
  });
  if (reward.astra > 0) applyDelta(sql, { playerId, asset: 'astra', delta: reward.astra, reason: 'expedition_reward', sourceRef: expeditionId }, now);
  if (reward.points > 0) applyDelta(sql, { playerId, asset: 'points', delta: reward.points, reason: 'expedition_reward', sourceRef: expeditionId }, now);
  for (const stack of reward.resources) addResource(sql, playerId, stack.resource, stack.amount);
  const nextDur = Math.max(0, ship.durability - reward.wear);
  sql.exec(`UPDATE ships SET durability = ?, status = 'idle' WHERE id = ?`, nextDur, ship.id);
  const xpRow = sql.exec('SELECT xp FROM players WHERE id = ?', playerId).toArray()[0];
  const xp = Number(xpRow.xp) + reward.xp;
  sql.exec('UPDATE players SET xp = ?, level = ? WHERE id = ?', xp, levelFromXp(xp), playerId);
  bumpDaily(sql, playerId, day, 'expeditions', 1);
  if (reward.points > 0) bumpDaily(sql, playerId, day, 'points_gained', reward.points);
  sql.exec(`UPDATE expeditions SET status = 'completed', reward_json = ? WHERE id = ?`, JSON.stringify(reward), expeditionId);
}
