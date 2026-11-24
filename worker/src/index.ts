import { syncArchive } from './archive';
import { cleanupAuthLimits } from './auth/rateLimit';
import { ensureArchiveSchema } from './db/bootstrap';
import { payFlags } from './pay/flags';
import { chainSpec } from './pay/chain';
import { applyEvmDeposits, bscActiveAddresses, scanEvmBlocks } from './pay/evm/deposits';
import { createEvmRpc } from './pay/evm/rpc';
import { applyDeposits, scanAll, trongridFetcher } from './pay/monitor';
import { tronApiBase } from './pay/tron/contracts';
import { ensurePaySchema } from './pay/schema';
import { reconcileAndFlag } from './pay/reconcile';
import { usdtContracts } from './pay/tron/contracts';
import { cleanupSessions } from './auth/sessions';
import type { Env } from './env';
import { route } from './http/router';
import { securityHeaders } from './http/security';
import { withBudget } from './ops/guard';
import { WorldLobby } from './lobby/WorldLobby';
import { SITE_FILES } from './static/site';
import { World } from './world/World';

export { World, WorldLobby };
export type { Env };

// Набор заголовков один для API и статики — см. http/security.ts. Раньше он был
// продублирован здесь и в client/_headers, и однажды уже разъехался (HSTS жил
// только в _headers, а Pages этот маршрут не отдаёт).

// Список миров берём у лобби. Если лобби недоступно, падаем на зеркало world_seats в D1:
// cron не должен терять миры из-за одной ошибки.
async function worldIds(env: Env): Promise<string[]> {
  try {
    const seats = await env.LOBBY.get(env.LOBBY.idFromName('main')).seats();
    const ids = seats.map((w) => String(w.world_id)).filter(Boolean);
    if (ids.length) return ids;
  } catch (e) {
    console.error('lobby seats failed', e);
  }
  try {
    const rows = await env.DB.prepare('SELECT world_id FROM world_seats').all<{ world_id: string }>();
    return (rows.results ?? []).map((r) => String(r.world_id)).filter(Boolean);
  } catch (e) {
    console.error('world_seats fallback failed', e);
    return [];
  }
}

function staticResponse(pathname: string, method: string): Response | null {
  const path = pathname === '/' ? '/index.html' : pathname;
  const file = SITE_FILES[path];
  // Отдача строго по точному ключу из `SITE_FILES`: путь не склеивается и не
  // нормализуется, поэтому `/../worker/src/env.ts`, `//etc/passwd` и `%2e%2e%2f`
  // просто не находят файла (проверено тестом).
  if (!file) return null;
  const headers: Record<string, string> = {
    'Content-Type': file.type,
    'Cache-Control': 'no-cache',
    ...securityHeaders(),
  };
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(file.body, { status: 200, headers });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = staticResponse(url.pathname, request.method);
      if (file) return Promise.resolve(file);
    }
    // Считаем бюджет и, если время плохое, отвечаем понятным 503 вместо того,
    // чтобы упереться в лимит Cloudflare и получить ошибку 1027.
    return withBudget(request, env, () => route(request, env));
  },
  // Часовой cron — страховка, если будильник мира не сработал. Сверка и рейсы живут в alarm мира.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const ids = await worldIds(env);
    for (const id of ids) {
      try {
        await env.WORLD.get(env.WORLD.idFromName(id)).poke();
      } catch (e) {
        console.error('poke failed', id, e);
      }
    }
    // Архив: снимки миров в R2 (если бакет подключён) и историю сезонов в D1.
    // Таблицы создаём сами: деплой идёт из браузера, `wrangler d1 migrations`
    // оттуда не запустить. На мигрированной базе это no-op.
    await ensureArchiveSchema(env.DB);
    // Astra Pay: схему лечим только когда деньги включены. При выключенных флагах
    // cron не тратит CPU на 14 DDL-запросов и не трогает денежные таблицы.
    const pay = payFlags(env);
    if (pay.payments) await ensurePaySchema(env.DB);
    // Приём денег: смотрим блокчейн и превращаем найденное в баланс. Только при
    // включённом флаге и только подтверждённые переводы. Ошибка сети не валит cron.
    if (pay.deposits && pay.chainConfigError) {
      // `PAY_CHAIN` с опечаткой: деньги не ищем вообще, но и не молчим — иначе
      // «депозиты не пришли» будет выглядеть как проблема игрока.
      console.error('pay deposits paused: неизвестное PAY_CHAIN', { value: String(env.PAY_CHAIN ?? '') });
    } else if (pay.deposits) {
      // Сканер выбирается по цепи, а не «оба сразу»: смотреть обе сети можно, но
      // тогда одна из них крутит сеть впустую, и в логах непонятно, где деньги.
      const spec = chainSpec(env, pay);
      if (spec.chain === 'tron') {
        try {
          const summary = await scanAll(env.DB, {
            fetchJson: trongridFetcher(env.TRONGRID_API_KEY),
            contracts: usdtContracts(env, pay.network),
            apiBase: tronApiBase(pay.network),
          }, Date.now(), 20);
          const applied = await applyDeposits(env.DB, Date.now(), 100);
          if (summary.stored || summary.errors.length || applied.credited) {
            console.log('pay monitor', summary, applied);
          }
        } catch (e) {
          console.error('pay monitor failed', e);
        }
      } else if (spec.ready.deposits && spec.contract) {
        try {
          const addresses = await bscActiveAddresses(env.DB);
          const scanned = await scanEvmBlocks(env.DB, {
            rpc: createEvmRpc({ url: spec.apiBase, fetchImpl: fetch }),
            contract: spec.contract,
            chain: 'bsc',
            confirmations: spec.confirmations,
            addresses,
          }, Date.now());
          const applied = await applyEvmDeposits(env.DB, spec.contract, Date.now(), 100);
          if (scanned.stored || scanned.error || applied.credited || applied.orphan) {
            console.log('pay monitor bsc', scanned, applied);
          }
        } catch (e) {
          console.error('pay monitor bsc failed', e);
        }
      } else {
        // Рельс выбран, но не дописан: молча молчать нельзя, иначе «депозиты не
        // пришли» будет выглядеть как проблема игрока.
        console.error('pay deposits paused', { chain: spec.chain, reason: spec.ready.reason });
      }
      // Отдельная страховка на случай переезда: активные адреса старой цепи,
      // которые новый сканер никогда не найдёт. Деньги на них не потеряны, но
      // сами они не зачтутся — об этом надо узнать до анонса, а не после.
      try {
        const stranded = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM pay_addresses WHERE active = 1 AND address LIKE 'T%'",
        ).first<number>('n');
        if (Number(stranded ?? 0) > 0 && spec.chain !== 'tron') {
          console.error('pay: активные TRON-адреса при другой цепи', { count: Number(stranded), chain: spec.chain });
        }
      } catch (e) {
        console.error('pay stranded check failed', e);
      }
    }

    // Сверка — раз в сутки ночью. Расхождение само поднимает стоп-флаг выплат:
    // лучше остановиться и разобраться, чем продолжать платить по битым данным.
    if (pay.payments && String(controller.cron ?? '') === '0 3 * * *') {
      try {
        const report = await reconcileAndFlag(env.DB, Date.now());
        if (!report.ok) console.error('pay reconcile mismatch', report);
      } catch (e) {
        console.error('pay reconcile failed', e);
      }
    }
    try {
      const archived = await syncArchive(env, ids);
      if (archived.archived || archived.failed) console.log('archive', archived);
    } catch (e) {
      console.error('archive failed', e);
    }
    // Гигиена D1: истёкшие refresh-сессии и старые счётчики частоты.
    const now = Date.now();
    try {
      await cleanupSessions(env.DB, now);
    } catch (e) {
      console.error('session cleanup failed', e);
    }
    await cleanupAuthLimits(env.DB, now);
  },
};
