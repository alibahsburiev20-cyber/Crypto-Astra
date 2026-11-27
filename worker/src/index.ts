import { syncArchive } from './archive';
import { cleanupAuthLimits } from './auth/rateLimit';
import { ensureArchiveSchema } from './db/bootstrap';
import { payFlags } from './pay/flags';
import { chainSpec, evmChainSpecs } from './pay/chain';
import { applyEvmDeposits, bscActiveAddresses, scanEvmBlocks } from './pay/evm/deposits';
import { createEvmRpc } from './pay/evm/rpc';
import { applyEvmPayoutConfirmations } from './pay/evm/payouts';
import { applyEvmSweepConfirmations } from './pay/evm/sweeps';
import { applyDeposits, scanAll, trongridFetcher } from './pay/monitor';
import { tronApiBase } from './pay/tron/contracts';
import { ensurePaySchema } from './pay/schema';
import { pruneChainEvents } from './pay/cleanup';
import { reconcileDaily } from './pay/reconcile';
import { usdtContracts } from './pay/tron/contracts';
import { cleanupSessions } from './auth/sessions';
import type { Env } from './env';
import { floodCheck } from './http/floodGuard';
import { route } from './http/router';
import { staticResponse } from './http/static';
import { withBudget } from './ops/guard';
import { WorldLobby } from './lobby/WorldLobby';
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

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Ливень-затвор раньше всего остального — до статики и до бюджета. Смысл в
    // том, чтобы мусор с одного адреса не стоил ни одной записи в D1: и кэш
    // страниц, и счётчик запросов стоят дешевле, чем выжженная база.
    const flooded = floodCheck(request, env, url.pathname);
    if (flooded) return Promise.resolve(flooded);
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
      } else {
        // EVM-рельс: каждую включённую сеть сканируем своим проходом. «Одна
        // сеть на воркер» было верно, пока сеть была одна; с двумя выборка
        // `WHERE chain = 'bsc'` означала бы «polygon-адреса игрока никто не
        // смотрит», и выглядело бы это как «игрок не прислал», а не как наша
        // ошибка. Курсор при этом отдельный на пару (сеть, контракт) — высоты
        // в разных цепях несопоставимы.
        for (const rail of evmChainSpecs(env, pay)) {
          if (!rail.ready.deposits || !rail.contract) {
            // Рельс выбран, но не дописан: молча молчать нельзя, иначе «депозиты
            // не пришли» будет выглядеть как проблема игрока.
            console.error('pay deposits paused', { chain: rail.chain, reason: rail.ready.reason });
            continue;
          }
          try {
            const addresses = await bscActiveAddresses(env.DB, undefined, rail.chain);
            const scanned = await scanEvmBlocks(env.DB, {
              rpc: createEvmRpc({ url: rail.apiBase, fetchImpl: fetch }),
              contract: rail.contract,
              chain: rail.chain,
              confirmations: rail.confirmations,
              addresses,
            }, Date.now());
            const applied = await applyEvmDeposits(env.DB, rail.contract, Date.now(), 100, rail.chain);
            if (scanned.stored || scanned.error || applied.credited || applied.orphan) {
              console.log('pay monitor evm', { chain: rail.chain }, scanned, applied);
            }
          } catch (e) {
            console.error('pay monitor evm failed', rail.chain, e);
          }
        }
      }
      // Отдельная страховка на случай переезда: активные адреса старой цепи,
      // которые новый сканер никогда не найдёт. Деньги на них не потеряны, но
      // сами они не зачтутся — об этом надо узнать до анонса, а не после.
      try {
        const stranded = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM pay_addresses WHERE active = 1 AND chain = 'tron'",
        ).first<number>('n');
        if (Number(stranded ?? 0) > 0 && spec.chain !== 'tron') {
          console.error('pay: активные TRON-адреса при другой цепи', { count: Number(stranded), chain: spec.chain });
        }
      } catch (e) {
        console.error('pay stranded check failed', e);
      }
    }

    // Подтверждение выплат по квитанции сети. Без этого шага заявка висела бы в
    // `sent` до ручного нажатия «подтвердить»: деньги ушли, а баланс игрока
    // «в обработке» неделями. Работает только там, где рельс дописан.
    if (pay.payouts) {
      // По каждой EVM-сети, а не «по активной»: заявка живёт в `pay_withdrawals`
      // со своей колонкой `chain`, и проверять polygon-перевод через BNB-RPC —
      // значит «заявка висит в sent, пока кто-то не нажмёт кнопку руками».
      for (const rail of evmChainSpecs(env, pay)) {
        if (!rail.ready.payouts || !rail.contract) continue;
        try {
          const rpc = createEvmRpc({ url: rail.apiBase, fetchImpl: fetch });
          const res = await applyEvmPayoutConfirmations(env.DB, rpc, rail.confirmations, Date.now(), rail.chain);
          if (res.checked) console.log('pay payouts confirm', { chain: rail.chain, ...res });
        } catch (e) {
          console.error('pay payouts confirm failed', rail.chain, e);
        }
      }
    }

    // Сбор с депозитных адресов: cron доводит до конца то, что уже отправлено.
    // План и саму отправку мы намеренно оставили руками (`/admin/pay/sweep/run`):
    // подписывать чужим ключом должен человек. А вот «ушла ли транзакция» —
    // рутина, и без неё строка `pay_sweeps` вечно висела бы в `broadcasting`, а
    // следующий план показывал бы те же деньги несобранными.
    if (pay.sweep) {
      for (const rail of evmChainSpecs(env, pay)) {
        if (!rail.contract || !rail.apiBase) continue;
        try {
          const rpc = createEvmRpc({ url: rail.apiBase, fetchImpl: fetch });
          const res = await applyEvmSweepConfirmations(env.DB, rpc, rail.confirmations, Date.now(), rail.chain);
          if (res.checked) console.log('pay sweeps confirm', { chain: rail.chain, ...res });
        } catch (e) {
          console.error('pay sweeps confirm failed', rail.chain, e);
        }
      }
    }

    // Сверка — не реже раза в сутки, но без сравнения с текстом расписания:
    // периодичность держит отметка в самой базе (reconcileDaily). Расхождение
    // само поднимает стоп-флаг выплат: лучше остановиться и разобраться, чем
    // продолжать платить по битым данным.
    if (pay.payments) {
      try {
        const report = await reconcileDaily(env.DB, Date.now());
        if (report && !report.ok) console.error('pay reconcile mismatch', report);
      } catch (e) {
        console.error('pay reconcile failed', e);
      }
      // Ротация сырых событий сети: без неё платёжный журнал съедает лимит D1,
      // и обнаруживается это в момент, когда приходят настоящие деньги.
      try {
        const pruned = await pruneChainEvents(env.DB, Date.now());
        if (pruned.deleted) console.log('pay chain events pruned', pruned);
      } catch (e) {
        console.error('pay prune failed', e);
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
