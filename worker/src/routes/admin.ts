import type { Env } from '../env';
import { requireAdmin, requireOwner } from '../http/admin';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';
import {
  adminInviteLink, createAdminInvite, listAdminAccounts, parseInviteInput, readAdminAudit,
  revokeAdminAccount, writeAdminAudit, type AdminPrincipal,
} from '../admin/accounts';
import { ensureAdminSchema, requireAdminSchema } from '../admin/schema';
import { blockPlayer, closePlayer, playerSummary, unblockPlayer } from '../admin/players';

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

/**
 * «Кто я в этой админке» — нужно клиенту, чтобы не показывать младшему админу
 * кнопки, которые сервер всё равно отвергнет. Это не защита (защита — на
 * сервере), это честный интерфейс: кнопка, которая не работает для входящего,
 * хуже надписи «это решает владелец».
 */
export async function adminSession(request: Request, env: Env): Promise<Response> {
  const who = await requireAdmin(request, env);
  return json({
    ok: true,
    role: who.role,
    label: who.label,
    grantLimit: Number.isFinite(who.grantLimit) ? who.grantLimit : null,
    expiresAt: who.expiresAt,
  });
}

export async function adminWorld(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  return json({ ok: true, world: worldId(url), ...(await worldOf(env, url).adminWorld()) });
}

export async function adminFreeze(request: Request, env: Env): Promise<Response> {
  // Заморозка останавливает весь мир — это не действие «на каждый день», и
  // помощник её включать не должен.
  requireOwner(await requireAdmin(request, env));
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
  const who = await requireAdmin(request, env);
  const url = new URL(request.url);
  const body = await readJson(request);
  const input = parseGrantInput(body);
  // Потолок младшего доступа. Он на сервере, а не «в форме max» у клиента:
  // форма в браузере правится руками, и полагаться на неё в деньгах нельзя.
  if (who.role !== 'owner' && Math.abs(input.astra) > who.grantLimit) {
    throw new ApiError(409, 'grant_limit');
  }

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
    .grant(who.id, playerId, input.astra, input.reason);
  // След в D1, а не только в журнале мира: выдача могла уйти в другой мир, а
  // «кто и когда» владелец читает в одном месте.
  // Намеренно НЕ `requireAdminSchema`: монеты уже начислены, и отказ журнала не
  // должен превращать успешную выдачу в «не удалось» — иначе оператор жмёт ещё раз.
  await ensureAdminSchema(env.DB);
  await writeAdminAudit(env.DB, {
    actor: who.id, role: who.role, action: 'grant', target: playerId,
    payload: { astra: input.astra, reason: input.reason, world, resolvedBy: by, label: who.label },
    now: Date.now(),
  });
  // `res` содержит свой `playerId` (канонический) — он и должен победить.
  return json({ ok: true, world, resolvedBy: by, actor: who.role, ...res });
}

// --- Доступы: приглашения младших админов ------------------------------------

/**
 * Создать доступ. Ключ возвращается ОДИН РАЗ и больше нигде не появляется:
 * в базе лежит только его хеш. Отсюда требование «скопировать ссылку сейчас» —
 * закрыть окно и потерять доступ не страшно, создастся новый за секунду.
 */
export async function adminAccountInvite(request: Request, env: Env): Promise<Response> {
  const who = requireOwner(await requireAdmin(request, env));
  await requireAdminSchema(env.DB);
  const parsed = parseInviteInput(await readJson(request));
  if (!parsed.ok) throw new ApiError(400, parsed.error);
  const now = Date.now();
  const created = await createAdminInvite(env.DB, { ...parsed.value, actor: who.id, now });
  // Origin берём из запроса, а не из переменной: ссылка живёт в том же хосте, с
  // которого админ зашёл (рабочий домен или `*.workers.dev`). Свой домен позже —
  // это та же строка, просто другой хост в запросе.
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    id: created.id,
    key: created.key,
    link: adminInviteLink(origin, created.key),
    expiresAt: created.expiresAt,
    label: parsed.value.label,
    grantLimit: parsed.value.grantLimit ?? 5_000,
    actor: who.id,
    note: 'Ключ показан один раз: сохранить надо сейчас. В списке доступов его больше не будет.',
  }, 201);
}

export async function adminAccounts(request: Request, env: Env): Promise<Response> {
  requireOwner(await requireAdmin(request, env));
  await requireAdminSchema(env.DB);
  const now = Date.now();
  return json({ ok: true, now, accounts: await listAdminAccounts(env.DB, now) });
}

export async function adminAccountRevoke(request: Request, env: Env): Promise<Response> {
  const who = requireOwner(await requireAdmin(request, env));
  await requireAdminSchema(env.DB);
  const body = await readJson(request);
  const id = String(body.id ?? '').trim();
  if (!id) throw new ApiError(400, 'bad_account');
  const revoked = await revokeAdminAccount(env.DB, id, who.id, Date.now());
  if (!revoked) throw new ApiError(409, 'account_not_active');
  return json({ ok: true, revoked: id, actor: who.id });
}

/** Журнал: кто нажимал. Только для владельца — там фамилии и суммы игроков. */
export async function adminAuditLog(request: Request, env: Env): Promise<Response> {
  requireOwner(await requireAdmin(request, env));
  await requireAdminSchema(env.DB);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '25');
  return json({ ok: true, entries: await readAdminAudit(env.DB, limit) });
}

// --- Игроки: карточка, блокировка, закрытие ----------------------------------

/** Игрок + id мира: разбор ссылки на игрока один на все админ-операции. */
async function resolvePlayer(env: Env, raw: string): Promise<{ id: string; worldId: string }> {
  const found = await findUserByRef(env.DB, String(raw ?? ''));
  if (!found.ok) throw new ApiError(404, found.error === 'ambiguous_player' ? 'ambiguous_player' : 'player_not_found');
  return { id: found.id, worldId: found.worldId ?? 'w1' };
}

export async function adminPlayer(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const { id, worldId } = await resolvePlayer(env, url.searchParams.get('player') ?? '');
  let game = null;
  try {
    game = await env.WORLD.get(env.WORLD.idFromName(worldId)).adminPlayer(id);
  } catch (e) {
    // Мир не ответил (DO недоступен, игрок в другом мире) — карточка всё равно
    // показывается: деньги и сессии живут в D1, и ради них заходить в мир не
    // нужно. Игровая часть просто пустая, и UI говорит об этом отдельно.
    console.error('admin player card: world unavailable', e);
  }
  const summary = await playerSummary(env.DB, id, game ? { astra: game.astra, level: game.level, points: game.points } : null);
  return json({ ok: true, player: summary, world: game ? { ...game } : null });
}

/** Заблокировать / разблокировать вход. Обратимо, деньги не трогает. */
export async function adminPlayerBlock(request: Request, env: Env): Promise<Response> {
  const who = requireOwner(await requireAdmin(request, env));
  const body = await readJson(request);
  const action = String(body.action ?? 'block');
  if (action !== 'block' && action !== 'unblock') throw new ApiError(400, 'bad_action');
  const reason = String(body.reason ?? '').trim().slice(0, 120);
  if (!reason) throw new ApiError(400, 'reason_required');
  const { id } = await resolvePlayer(env, String(body.player ?? ''));
  const now = Date.now();
  let sessions = 0;
  let alreadyBlocked = false;
  if (action === 'block') {
    const res = await blockPlayer(env.DB, id, now);
    sessions = res.sessions;
    alreadyBlocked = res.alreadyBlocked;
  } else {
    // Сессий при снятии блокировки не отзывают: их и так нет, игрок сам войдёт.
    await unblockPlayer(env.DB, id);
  }
  await ensureAdminSchema(env.DB);
  await writeAdminAudit(env.DB, { actor: who.id, role: who.role, action: `player_${action}`, target: id, payload: { reason }, now });
  return json({
    ok: true, playerId: id, action, sessions, alreadyBlocked,
    note: action === 'block'
      ? 'Вход закрыт: сессии отозваны, повторный вход откажет. Выпущенные access-токены живут до 15 минут — это цена проверки токена без базы на каждый запрос.'
      : 'Блокировка снята.',
    actor: who.role,
  });
}

/**
 * Закрыть аккаунт. Требует `confirm: 'DELETE'` и двух прочитанных чисел: денег на
 * балансе и незакрытых заявок. Это не «удалить строку»: почта и пароль стираются,
 * журнал остаётся, обратного хода нет — поэтому здесь отдельное подтверждение.
 */
export async function adminPlayerClose(request: Request, env: Env): Promise<Response> {
  const who = requireOwner(await requireAdmin(request, env));
  const body = await readJson(request);
  const reason = String(body.reason ?? '').trim().slice(0, 120);
  if (!reason) throw new ApiError(400, 'reason_required');
  if (String(body.confirm ?? '') !== 'DELETE') throw new ApiError(400, 'confirm_required');
  const { id, worldId } = await resolvePlayer(env, String(body.player ?? ''));
  const now = Date.now();
  const closed = await closePlayer(env.DB, id, now);
  let identityReleased = true;
  try {
    await env.WORLD.get(env.WORLD.idFromName(worldId)).clearIdentity(id);
  } catch (e) {
    // Позывной мог не освободиться, если мир недоступен. Аккаунт при этом закрыт
    // (вход уже отозван), и это то, чего хотели; освобождение имени — хозяйственная
    // деталь, её надо доделать вручную, и мы это говорим прямо.
    console.error('admin close: identity clear failed', e);
    identityReleased = false;
    await ensureAdminSchema(env.DB);
    await writeAdminAudit(env.DB, {
      actor: who.id, role: who.role, action: 'player_close_identity_stale', target: id,
      payload: { reason, world: worldId }, now,
    });
  }
  await ensureAdminSchema(env.DB);
  await writeAdminAudit(env.DB, {
    actor: who.id, role: who.role, action: 'player_close', target: id,
    payload: { reason, sessions: closed.sessions, balanceMicro: closed.balanceMicro, identityReleased }, now,
  });
  return json({
    ok: true, playerId: id, closedAt: closed.closedAt, sessions: closed.sessions,
    // Always 0 — ненулевой баланс не дошёл бы до этой строки (см. `player_has_funds`).
    balanceMicro: closed.balanceMicro,
    actor: who.role,
    identityReleased,
    note: identityReleased
      ? 'Аккаунт закрыт: почта и пароль стёрты, сессии отозваны, позывной освобождён. Записи журналов остались — по ним видно, что деньги были и куда делись.'
      : 'Аккаунт закрыт, но позывной остался занят: мир не ответил. Закрытый вход это не отменяет — имя игрока подчистите, когда мир станет доступен.',
  });
}
