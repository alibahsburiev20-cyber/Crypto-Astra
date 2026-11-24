import { ApiError } from '../world/errors';

// Коды ошибок Durable Object (доходят как message) → HTTP-статус.
export const STATUS_BY_CODE: Record<string, number> = {
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
  // Этап 2: крафт и ресурсы. Коды приходят из мира строкой, поэтому таблица
  // должна знать их все, иначе клиент увидит internal.
  insufficient_resources: 409,
  bad_recipe: 400,
  craft_queue_full: 409,
  bad_delta: 409,
  // Срез 4: модули. Те же правила — каждый код обязан быть в таблице.
  bad_module: 400,
  module_slots_full: 409,
  module_max_level: 409,
  // Срез 5: покупка кораблей.
  bad_ship_type: 400,
  ship_not_for_sale: 400,
  ship_locked: 403,
  ship_owned: 409,
  admin_email_forbidden: 403,
  callsign_taken: 409,
  callsign_cooldown: 409,
  style_not_owned: 403,
  too_many_requests: 429,
  account_deleted: 403,
  garage_full: 409,
  garage_max: 409,
  // Этап 6: авиазвено. Как и всё остальное, каждый код обязан быть здесь.
  bad_plane: 400,
  plane_not_owned: 409,
  patrol_busy: 409,
  patrol_flying: 409,
  no_patrol: 404,
  // Срез 6: рынок.
  bad_resource: 400,
  bad_amount: 400,
  bad_price: 400,
  lot_not_found: 404,
  lot_closed: 409,
  own_lot: 409,
  not_your_lot: 403,
  market_lot_limit: 409,
  price_out_of_band: 409,
  // Этап 4: социальное. Любой новый код обязан попасть сюда, иначе мир
  // вернёт 500 internal, а клиент не покажет нормальный текст.
  bad_mission: 400,
  mission_incomplete: 409,
  mission_claimed: 409,
  bad_pass_level: 400,
  pass_locked: 409,
  pass_claimed: 409,
  bad_guild_name: 400,
  bad_guild_tag: 400,
  guild_not_found: 404,
  guild_full: 409,
  guild_already_member: 409,
  already_in_guild: 409,
  guild_name_taken: 409,
  guild_member_not_found: 404,
  not_in_guild: 409,
  bad_role: 400,
  bad_target: 400,
  not_allowed: 403,
  self_referral: 400,
  referral_already_applied: 409,
  referral_limit: 409,
  referral_not_found: 404,
  // Этап 5: пул. Деньги учитываем, выплат пока нет.
  bad_pool_kind: 400,
  bad_pool_amount: 400,
  bad_pool_currency: 400,
  bad_pool_ref: 400,
  pool_ref_exists: 409,
  admin_token_required: 401,
  admin_forbidden: 403,
  admin_disabled: 503,
  pool_unavailable: 503,
  season_not_found: 404,
  // Этап 5: боксы. У каждого кода обязан быть статус, иначе игрок увидит internal.
  bad_box: 400,
  box_cooldown: 429,
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...headers,
    },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return json({ error: e.code }, e.status, e.retryAfter ? { 'Retry-After': String(Math.max(1, e.retryAfter)) } : {});
  }
  const msg = e instanceof Error ? e.message : '';
  const status = STATUS_BY_CODE[msg];
  if (status) return json({ error: msg }, status);
  console.error('unhandled', e);
  return json({ error: 'internal' }, 500);
}

const MAX_JSON_BYTES = 16 * 1024;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  // Тело больше 16 КиБ на этих маршрутах не нужно: это защита от раздутых запросов.
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw new ApiError(413, 'payload_too_large');
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad_request');
  return body as Record<string, unknown>;
}
