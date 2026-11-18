import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';

function world(env: Env, a: AuthContext) {
  return env.WORLD.get(env.WORLD.idFromName(a.worldId));
}

function idemKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key') ?? '';
  if (!key) throw new ApiError(400, 'idempotency_key_required');
  return key;
}

export async function me(env: Env, a: AuthContext): Promise<Response> {
  // server_time нужен клиенту, чтобы таймеры не зависели от часов устройства.
  return json({ world_id: a.worldId, server_time: Date.now(), ...(await world(env, a).getState(a.userId)) });
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
  return json(await world(env, a).buyShip(a.userId, idemKey(request), type));
}
