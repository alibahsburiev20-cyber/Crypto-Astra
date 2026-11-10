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
