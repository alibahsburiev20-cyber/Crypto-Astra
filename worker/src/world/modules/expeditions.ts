import { EXPEDITION_KINDS, type ExpeditionKind } from '../../shared/constants';
import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { playerExists } from './players';

export type Rng = () => number;
const defaultRng: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;

export function isKind(v: unknown): v is ExpeditionKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPEDITION_KINDS, v);
}

export interface StartResult { id: string; kind: ExpeditionKind; shipId: string; startedAt: number; endsAt: number; fuel: number }

// Вызывать внутри транзакции мира. Время — серверное. Награда считается при получении, клиент сумм не передаёт.
export function startExpedition(
  sql: SqlStorage, playerId: string, idemKey: string, req: { kind: ExpeditionKind; shipId?: string | null }, now: number,
): StartResult {
  return withIdempotency<StartResult>(sql, playerId, 'expedition_start', idemKey, { kind: req.kind, shipId: req.shipId ?? null }, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    if (!isKind(req.kind)) throw new ApiError(400, 'bad_expedition_kind');
    const spec = EXPEDITION_KINDS[req.kind];
    const ships = req.shipId
      ? sql.exec('SELECT id, status, durability FROM ships WHERE id = ? AND player_id = ?', req.shipId, playerId).toArray()
      : sql.exec(`SELECT id, status, durability FROM ships WHERE player_id = ? AND status = 'idle' ORDER BY rowid LIMIT 1`, playerId).toArray();
    if (!ships.length) throw new ApiError(req.shipId ? 404 : 409, req.shipId ? 'ship_not_found' : 'no_idle_ship');
    const ship = ships[0];
    if (ship.status !== 'idle') throw new ApiError(409, 'ship_busy');
    if (Number(ship.durability) <= 0) throw new ApiError(409, 'ship_broken');

    const id = crypto.randomUUID();
    const fuel = applyDelta(sql, { playerId, asset: 'fuel', delta: -spec.fuel, reason: 'expedition_fuel', sourceRef: id, idemKey }, now);
    const shipId = String(ship.id);
    const endsAt = now + spec.durationMs;
    sql.exec(`UPDATE ships SET status = 'away' WHERE id = ?`, shipId);
    sql.exec(
      `INSERT INTO expeditions (id, player_id, ship_id, kind, sector, started_at, ends_at, status) VALUES (?, ?, ?, ?, 1, ?, ?, 'active')`,
      id, playerId, shipId, req.kind, now, endsAt,
    );
    return { value: { id, kind: req.kind, shipId, startedAt: now, endsAt, fuel }, store: true };
  });
}

export type CollectResult =
  | { ok: true; id: string; kind: ExpeditionKind; reward: number; balance: number }
  | { ok: false; code: 'not_ready'; endsAt: number };

export function collectExpedition(
  sql: SqlStorage, playerId: string, idemKey: string, expeditionId: string, now: number, rng: Rng = defaultRng,
): CollectResult {
  return withIdempotency<CollectResult>(sql, playerId, 'expedition_collect', idemKey, { id: expeditionId }, now, () => {
    const rows = sql.exec('SELECT id, ship_id, kind, ends_at, status FROM expeditions WHERE id = ? AND player_id = ?', expeditionId, playerId).toArray();
    if (!rows.length) throw new ApiError(404, 'expedition_not_found');
    const r = rows[0];
    if (r.status !== 'active') throw new ApiError(409, 'already_collected');
    const endsAt = Number(r.ends_at);
    if (now < endsAt) return { value: { ok: false, code: 'not_ready', endsAt }, store: false };

    const kind = String(r.kind) as ExpeditionKind;
    const spec = EXPEDITION_KINDS[kind];
    const span = spec.rewardMax - spec.rewardMin + 1;
    const reward = spec.rewardMin + Math.min(span - 1, Math.floor(rng() * span));
    const balance = applyDelta(sql, { playerId, asset: 'astra', delta: reward, reason: 'expedition_reward', sourceRef: expeditionId, idemKey }, now);
    sql.exec(`UPDATE expeditions SET status = 'collected', reward_astra = ?, collected_at = ? WHERE id = ?`, reward, now, expeditionId);
    sql.exec(`UPDATE ships SET status = 'idle' WHERE id = ?`, String(r.ship_id));
    return { value: { ok: true, id: expeditionId, kind, reward, balance }, store: true };
  });
}
