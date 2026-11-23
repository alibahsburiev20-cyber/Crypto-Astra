import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';
import { entitlements } from '../pay/shop';

// Аккаунт и персональные данные (GDPR).
//
// Экспорт отдаёт всё, что мы знаем об игроке: аккаунт, покупки, журнал платежей
// и журнал мира. Удаление — «мягкое»: почта и пароль стираются, сессии
// отзываются, позывной и косметика удаляются. Записи журналов остаются: это
// бухгалтерия, а в них нет ни почты, ни пароля. Такой подход и описан игроку.

function world(env: Env, a: AuthContext) {
  return env.WORLD.get(env.WORLD.idFromName(a.worldId));
}

export async function accountExport(env: Env, a: AuthContext): Promise<Response> {
  const now = Date.now();
  const user = await env.DB.prepare(
    'SELECT id, email, world_id, status, created_at FROM users WHERE id = ?',
  ).bind(a.userId).first<{ id: string; email: string | null; world_id: string | null; status: string; created_at: number }>();
  if (!user) throw new ApiError(404, 'player_not_found');

  const pays = await env.DB.prepare(
    'SELECT id, asset, delta, reason, source_ref, created_at FROM pay_ledger WHERE user_id = ? ORDER BY created_at ASC',
  ).bind(a.userId).all<Record<string, unknown>>();

  let purchases: unknown[] = [];
  try {
    purchases = await entitlements(env.DB, a.userId);
  } catch { purchases = []; }

  const state = await world(env, a).getState(a.userId, false);
  const ledger = await world(env, a).listLedger(a.userId, 50);

  return json({
    exported_at: now,
    account: {
      id: user.id,
      email: user.email,
      world_id: user.world_id,
      status: user.status,
      created_at: Number(user.created_at),
    },
    purchases,
    pay_ledger: pays.results ?? [],
    world: state,
    world_ledger: ledger,
    note: 'ASTRA — внутриигровая валюта. Денег на балансе игры нет: только USDT-покупки, перечисленные выше.',
  }, 200, {
    'Content-Disposition': 'attachment; filename="crypto-astra-export.json"',
    'Cache-Control': 'no-store',
  });
}

export async function accountDelete(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  if (String(body.confirm ?? '') !== 'DELETE') throw new ApiError(400, 'bad_request');

  const now = Date.now();
  // Порядок важен: сначала отзываем сессии, потом стираем личность и почту.
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, a.userId).run();
  await env.DB.prepare(
    `UPDATE users SET email = NULL, password_hash = NULL, status = 'deleted' WHERE id = ?`,
  ).bind(a.userId).run();

  try {
    await world(env, a).clearIdentity(a.userId);
  } catch (e) {
    console.error('identity clear failed', e);
  }

  return json({
    ok: true,
    deleted_at: now,
    note: 'Аккаунт закрыт: почта и пароль стёрты, сессии отозваны, позывной удалён. Записи журналов остаются обезличенными для учёта.',
  }, 200, { 'Set-Cookie': 'astra_rt=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });
}
