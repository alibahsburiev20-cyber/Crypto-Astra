import { ApiError } from '../world/errors';

// Коды ошибок Durable Object (доходят как message) → HTTP-статус.
const STATUS_BY_CODE: Record<string, number> = {
  player_not_found: 404,
  reservation_not_found: 404,
  insufficient_funds: 409,
  idempotency_key_reused: 409,
  idempotency_key_required: 400,
  world_full: 409,
  reservation_expired: 409,
  player_id_required: 400,
  world_frozen: 423,
  ship_not_found: 404,
  expedition_not_found: 404,
  ship_busy: 409,
  ship_broken: 409,
  sector_locked: 403,
  ship_range: 403,
  not_enough_fuel: 409,
  bad_expedition: 400,
  too_late_to_cancel: 409,
  expedition_done: 409,
  not_waiting: 409,
  bad_choice: 400,
  nothing_to_repair: 409,
  repair_needs_alloy_plate: 409,
  fuel_tank_full: 409,
  fuel_daily_limit: 409,
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: e.code }, e.status);
  const msg = e instanceof Error ? e.message : '';
  const status = STATUS_BY_CODE[msg];
  if (status) return json({ error: msg }, status);
  console.error('unhandled', e);
  return json({ error: 'internal' }, 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad_request');
  return body as Record<string, unknown>;
}
