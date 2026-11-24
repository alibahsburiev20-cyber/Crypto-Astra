import type { Env } from '../env';
import { requireAdmin } from '../http/admin';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';

// Админка мира (этап 15). Доступ — заголовок `X-Admin-Token` (или Cloudflare
// Access в будущем): маршрут не принимает игроков вообще. Мир выбирается
// параметром `?world=w1`, потому что объектов может быть несколько.

function worldId(url: URL): string {
  const id = (url.searchParams.get('world') ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new ApiError(400, 'bad_world');
  return id;
}

function worldOf(env: Env, url: URL) {
  return env.WORLD.get(env.WORLD.idFromName(worldId(url)));
}

export async function adminWorld(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  return json({ ok: true, world: worldId(url), ...(await worldOf(env, url).adminWorld()) });
}

export async function adminFreeze(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const body = await readJson(request);
  if (typeof body.frozen !== 'boolean') throw new ApiError(400, 'bad_request');
  const res = await worldOf(env, url).setFrozen(body.frozen);
  return json({ ok: true, world: worldId(url), ...res });
}

export interface GrantInput {
  /** id игрока, его начало (как в списке) или email. */
  player: string;
  astra: number;
  reason: string;
}

const PLAYER_REF = /^[A-Za-z0-9._@:-]{3,254}$/;

/**
 * Разбор тела начисления. Ошибки называются своими кодами, чтобы админка могла
 * показать причину, а не «что-то не так».
 */
export function parseGrantInput(body: Record<string, unknown>): GrantInput {
  // `playerId` оставлен для совместимости со старыми вызовами и скриптами.
  const player = String(body.player ?? body.playerId ?? body.email ?? '').trim();
  const astra = Number(body.astra ?? body.amount ?? 0);
  const reason = String(body.reason ?? '').trim();

  if (!player) throw new ApiError(400, 'bad_target');
  if (!PLAYER_REF.test(player)) throw new ApiError(400, 'bad_target');
  if (!Number.isInteger(astra) || astra === 0) throw new ApiError(400, 'bad_amount');
  if (Math.abs(astra) > 100_000) throw new ApiError(400, 'bad_amount');
  if (!reason) throw new ApiError(400, 'reason_required');
  return { player, astra, reason };
}

export type UserRef =
  | { ok: true; id: string; worldId: string | null; by: 'email' | 'id' | 'prefix' }
  | { ok: false; error: 'player_not_found' | 'ambiguous_player' };

/**
 * Найти игрока по id, началу id или email.
 *
 * Зачем: в админке игрок показан как `id.slice(0, 8)` — человек копирует именно
 * это. А email помнит каждый, id — никто. Раньше начисление «не работало» чаще
 * всего потому, что вводили email или обрезок id, а сервер ждал полный id и
 * отвечал `player_not_found`.
 */
export async function findUserByRef(db: D1Database, raw: string): Promise<UserRef> {
  const ref = String(raw ?? '').trim();
  if (!ref) return { ok: false, error: 'player_not_found' };

  if (ref.includes('@')) {
    const row = await db.prepare('SELECT id, world_id FROM users WHERE lower(email) = lower(?) LIMIT 1')
      .bind(ref).first<{ id: string; world_id: string | null }>();
    if (!row) return { ok: false, error: 'player_not_found' };
    return { ok: true, id: String(row.id), worldId: row.world_id ? String(row.world_id) : null, by: 'email' };
  }

  const exact = await db.prepare('SELECT id, world_id FROM users WHERE id = ? LIMIT 1')
    .bind(ref).first<{ id: string; world_id: string | null }>();
  if (exact) return { ok: true, id: String(exact.id), worldId: exact.world_id ? String(exact.world_id) : null, by: 'id' };

  // Начало id: только если совпадение однозначное. Иначе — ошибка, а не «первый попавшийся».
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(ref)) return { ok: false, error: 'player_not_found' };
  const { results } = await db.prepare('SELECT id, world_id FROM users WHERE id LIKE ? LIMIT 2')
    .bind(`${ref}%`).all<{ id: string; world_id: string | null }>();
  const rows = results ?? [];
  if (rows.length === 1) {
    return { ok: true, id: String(rows[0].id), worldId: rows[0].world_id ? String(rows[0].world_id) : null, by: 'prefix' };
  }
  if (rows.length > 1) return { ok: false, error: 'ambiguous_player' };
  return { ok: false, error: 'player_not_found' };
}

/**
 * Начислить ASTRA игроку.
 *
 * Мир определяется по самому игроку (`users.world_id`), а не по `?world=` —
 * иначе начисление уходило в другой мир и возвращалось `player_not_found`.
 * `?world=` остаётся запасным вариантом для случаев, когда игрока нет в D1.
 */
export async function adminGrant(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const body = await readJson(request);
  const input = parseGrantInput(body);

  let world = worldId(url);
  let playerId = input.player;
  let by: 'email' | 'id' | 'prefix' | 'world' = 'world';

  const found = await findUserByRef(env.DB, input.player);
  if (found.ok) {
    playerId = found.id;
    by = found.by;
    if (found.worldId) world = found.worldId;
  } else if (found.error === 'ambiguous_player') {
    throw new ApiError(409, 'ambiguous_player');
  }
  // Не нашли в D1 — пробуем как есть: id мог прийти из другого контура (локально,
  // тестнет). Мир тогда берётся из `?world=`, и мир сам ответит `player_not_found`.

  const res = await env.WORLD.get(env.WORLD.idFromName(world))
    .grant('admin', playerId, input.astra, input.reason);
  // `res` содержит свой `playerId` (канонический) — он и должен победить.
  return json({ ok: true, world, resolvedBy: by, ...res });
}
