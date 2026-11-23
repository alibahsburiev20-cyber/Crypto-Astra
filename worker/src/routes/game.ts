import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';
import { premiumStatus } from '../pay/shop';
import { RUN_MS, expandTrace } from '../shared/minigame';

function world(env: Env, a: AuthContext) {
  return env.WORLD.get(env.WORLD.idFromName(a.worldId));
}

function idemKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key') ?? '';
  if (!key) throw new ApiError(400, 'idempotency_key_required');
  return key;
}

/**
 * Premium живёт в D1 платёжной части, а мир — отдельный объект. Спрашиваем здесь
 * и передаём флагом: если платежи не настроены, игрок просто получает базовые
 * попытки, а не 500.
 */
export async function isPremium(env: Env, a: AuthContext): Promise<boolean> {
  try {
    return (await premiumStatus(env.DB, a.userId, Date.now())).active;
  } catch {
    return false;
  }
}

export async function me(env: Env, a: AuthContext): Promise<Response> {
  // server_time нужен клиенту, чтобы таймеры не зависели от часов устройства.
  const premium = await isPremium(env, a);
  return json({ world_id: a.worldId, server_time: Date.now(), premium, ...(await world(env, a).getState(a.userId, premium)) });
}

// ── Мини-игра (этап 13) ──────────────────────────────────────────────────────
export async function minigame(env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).getMinigame(a.userId, await isPremium(env, a)));
}

export async function minigameStart(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const key = idemKey(request);
  const r = await world(env, a).startMinigame(a.userId, key, await isPremium(env, a));
  if (!r.runId) return json({ error: 'daily_limit', attempts: r.attempts }, 429);
  return json({ ...r, runMs: RUN_MS });
}

// Трассу проверяет мир: маршрут только отсекает мусор до транзакции.
export async function minigameFinish(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const runId = typeof body.runId === 'string' ? body.runId : '';
  if (!runId) throw new ApiError(400, 'bad_run');
  // Два формата: полная трасса (тесты, отладка) и компактная `xs` + шаг, которую
  // шлёт браузер. Полная — тысяча объектов, она не влезает в лимит тела 16 КБ.
  let trace: { t: number; x: number }[] = [];
  if (Array.isArray(body.trace) && body.trace.length) {
    trace = body.trace.slice(0, 4000).map((p) => ({
      t: Number((p as { t?: unknown })?.t),
      x: Number((p as { x?: unknown })?.x),
    }));
  } else if (Array.isArray(body.xs) && body.xs.length) {
    trace = expandTrace(body.xs, Number(body.stepMs));
  }
  if (!trace.length) throw new ApiError(400, 'bad_run');
  const result = await world(env, a).finishMinigame(a.userId, idemKey(request), { runId, trace }, await isPremium(env, a));
  if (!result.ok) {
    const status = result.error === 'run_not_found' ? 404 : 409;
    return json(result, status);
  }
  return json(result);
}

// limit приходит строкой. Битое значение раньше уходило в SQL как NaN и на D1 давало 500.
export function parseLimit(raw: string | null, fallback = 30): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

export async function ledger(url: URL, env: Env, a: AuthContext): Promise<Response> {
  const limit = parseLimit(url.searchParams.get('limit'));
  return json({ entries: await world(env, a).listLedger(a.userId, limit) });
}

// Сезон: рейтинг, своё место, награды и прошлые сезоны. Только чтение.
export async function season(env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).getSeason(a.userId));
}

// Idempotency-Key создаёт клиент один раз на действие и хранит до ответа. Суммы клиент не передаёт.
export async function claim(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const key = idemKey(request);
  const r = await world(env, a).claim(a.userId, key);
  // Никаких полей, меняющихся от вызова к вызову: повтор с тем же ключом должен вернуть байт-в-байт тот же ответ.
  if (r.ok) return json({ reward: r.reward, balance: r.balance, next_claim_at: r.nextClaimAt });
  const retry = Math.max(1, Math.ceil((r.nextClaimAt - Date.now()) / 1000));
  return json({ error: r.code, next_claim_at: r.nextClaimAt }, 429, { 'Retry-After': String(retry) });
}

export async function startExpedition(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const shipId = typeof body.shipId === 'string' ? body.shipId : '';
  const planet = typeof body.planet === 'string' ? body.planet : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!shipId || !planet || !kind) throw new ApiError(400, 'bad_expedition');
  const result = await world(env, a).startExpedition(a.userId, idemKey(request), { shipId, planet, kind });
  return json(result);
}

export async function cancelExpedition(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const expeditionId = typeof body.expeditionId === 'string' ? body.expeditionId : '';
  if (!expeditionId) throw new ApiError(400, 'bad_expedition');
  return json(await world(env, a).cancelExpedition(a.userId, idemKey(request), expeditionId));
}

export async function chooseEvent(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const expeditionId = typeof body.expeditionId === 'string' ? body.expeditionId : '';
  const choiceId = typeof body.choiceId === 'string' ? body.choiceId : '';
  if (!expeditionId || !choiceId) throw new ApiError(400, 'bad_choice');
  return json(await world(env, a).chooseEvent(a.userId, idemKey(request), expeditionId, choiceId));
}

export async function repair(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const shipId = typeof body.shipId === 'string' ? body.shipId : '';
  if (!shipId) throw new ApiError(400, 'ship_not_found');
  return json(await world(env, a).repair(a.userId, idemKey(request), shipId));
}

export async function buyFuel(request: Request, env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).buyFuel(a.userId, idemKey(request)));
}

export async function craftStart(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const recipe = typeof body.recipe === 'string' ? body.recipe : '';
  if (!recipe) throw new ApiError(400, 'bad_recipe');
  return json(await world(env, a).startCraft(a.userId, idemKey(request), recipe));
}

export async function moduleInstall(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const shipId = typeof body.shipId === 'string' ? body.shipId : '';
  const module = typeof body.module === 'string' ? body.module : '';
  if (!shipId || !module) throw new ApiError(400, 'bad_module');
  return json(await world(env, a).installModule(a.userId, idemKey(request), { shipId, module }));
}

export async function shipBuy(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const type = typeof body.type === 'string' ? body.type : '';
  if (!type) throw new ApiError(400, 'bad_ship_type');
  return json(await world(env, a).buyShip(a.userId, idemKey(request), type, await isPremium(env, a)));
}

export async function market(url: URL, env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).getMarket(a.userId));
}

export async function marketLot(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const resource = typeof body.resource === 'string' ? body.resource : '';
  const amount = Number(body.amount);
  const unitPrice = Number(body.unitPrice);
  if (!resource) throw new ApiError(400, 'bad_resource');
  return json(await world(env, a).createLot(a.userId, idemKey(request), { resource, amount, unitPrice }));
}

export async function marketBuy(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const lotId = typeof body.lotId === 'string' ? body.lotId : '';
  if (!lotId) throw new ApiError(400, 'lot_not_found');
  return json(await world(env, a).buyLot(a.userId, idemKey(request), lotId));
}

export async function marketCancel(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const lotId = typeof body.lotId === 'string' ? body.lotId : '';
  if (!lotId) throw new ApiError(400, 'lot_not_found');
  return json(await world(env, a).cancelLot(a.userId, idemKey(request), lotId));
}

// ── Социальное (этап 4) ──────────────────────────────────────────────────────

// Экран «Задания»: миссии дня и недели, достижения и Astra Pass одним ответом.
export async function social(env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).getSocial(a.userId));
}

export async function missionClaim(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const missionId = typeof body.missionId === 'string' ? body.missionId : '';
  if (!missionId) throw new ApiError(400, 'bad_mission');
  return json(await world(env, a).claimMission(a.userId, idemKey(request), missionId));
}

export async function passClaim(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const level = Number(body.level);
  if (!Number.isInteger(level)) throw new ApiError(400, 'bad_pass_level');
  return json(await world(env, a).claimPass(a.userId, idemKey(request), level));
}

// Экран «Команда»: гильдия, участники, рейтинг гильдий и рефералы.
export async function guild(env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).getGuild(a.userId));
}

export async function guildCreate(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name : '';
  const tag = typeof body.tag === 'string' ? body.tag : '';
  if (!name || !tag) throw new ApiError(400, 'bad_guild_name');
  return json(await world(env, a).createGuild(a.userId, idemKey(request), { name, tag }));
}

export async function guildJoin(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code) throw new ApiError(400, 'guild_not_found');
  return json(await world(env, a).joinGuild(a.userId, idemKey(request), code));
}

export async function guildLeave(request: Request, env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).leaveGuild(a.userId, idemKey(request)));
}

export async function guildKick(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const target = typeof body.playerId === 'string' ? body.playerId : '';
  if (!target) throw new ApiError(400, 'bad_target');
  return json(await world(env, a).kickGuildMember(a.userId, idemKey(request), target));
}

export async function guildRole(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const target = typeof body.playerId === 'string' ? body.playerId : '';
  const role = typeof body.role === 'string' ? body.role : '';
  if (!target || !role) throw new ApiError(400, 'bad_role');
  return json(await world(env, a).setGuildRole(a.userId, idemKey(request), { target, role }));
}

export async function guildRename(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name : '';
  const tag = typeof body.tag === 'string' ? body.tag : '';
  if (!name || !tag) throw new ApiError(400, 'bad_guild_name');
  return json(await world(env, a).renameGuild(a.userId, idemKey(request), { name, tag }));
}

export async function referralApply(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const body = await readJson(request);
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code) throw new ApiError(400, 'referral_not_found');
  return json(await world(env, a).applyReferral(a.userId, idemKey(request), code));
}

// ── Гараж (этап 14) ──────────────────────────────────────────────────────────
export async function garage(env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).getGarage(a.userId, await isPremium(env, a)));
}

export async function garageBuy(request: Request, env: Env, a: AuthContext): Promise<Response> {
  return json(await world(env, a).buyGarageSlot(a.userId, idemKey(request)));
}
