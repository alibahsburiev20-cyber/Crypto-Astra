import { ensurePoolSchema } from '../db/bootstrap';
import type { Env } from '../env';
import { json, readJson } from '../http/response';
import {
  addPoolEntry, parsePoolEntry, poolAll, poolReport, poolTotals,
} from '../pool/accounting';
import { requireAdmin } from '../http/admin';
import { payFlags } from '../pay/flags';
import { usdtPoolBlock } from '../pay/pool';
import { ApiError } from '../world/errors';

// Пул (этап 5). Публичный отчёт открыт всем — это часть прозрачности и требований
// рекламных сетей. Записи добавляет только админ: до 5.3 это заголовок
// `X-Admin-Token`, дальше сверху встанет Cloudflare Access.

const PUBLIC_HEADERS = { 'Cache-Control': 'public, max-age=60' };

export async function poolPublic(env: Env): Promise<Response> {
  if (!(await ensurePoolSchema(env.DB))) throw new ApiError(503, 'pool_unavailable');
  const now = Date.now();
  const report = await poolReport(env.DB, now);
  // USDT — отдельным блоком и только при включённом флаге: фиат и крипта
  // никогда не складываются в одну цифру.
  if (payFlags(env).pool) {
    try {
      const usdt = await usdtPoolBlock(env.DB, now);
      return json({ ok: true, ...report, usdt }, 200, PUBLIC_HEADERS);
    } catch (e) {
      console.error('usdt pool block failed', e);
    }
  }
  return json({ ok: true, ...report }, 200, PUBLIC_HEADERS);
}

export async function adminPool(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePoolSchema(env.DB))) throw new ApiError(503, 'pool_unavailable');
  const [entries, totals] = await Promise.all([poolAll(env.DB, 100), poolTotals(env.DB)]);
  return json({ ok: true, updatedAt: Date.now(), totals, entries });
}

export async function adminPoolEntry(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePoolSchema(env.DB))) throw new ApiError(503, 'pool_unavailable');
  const input = parsePoolEntry(await readJson(request));
  const now = Date.now();
  await addPoolEntry(env.DB, input, now);
  const report = await poolReport(env.DB, now);
  return json({ ok: true, added: input.kind, ref: input.ref, ...report }, 201);
}
