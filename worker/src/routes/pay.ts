import type { Env } from '../env';
import { json } from '../http/response';
import { payFlags, publicFlags } from '../pay/flags';
import { PAY_SCHEMA_VERSION, PAY_TABLES, ensurePaySchema } from '../pay/schema';

// Astra Pay (этап 1): пока только состояние контура. Ни одного денежного
// маршрута здесь нет и не будет до этапов 4–10 — таблицы и флаги есть, операции
// выключены.
//
// `/pay/status.json` открыт всем: игрок и админ должны видеть, включены ли
// платежи, раньше, чем увидят кнопку «купить». Секретов в ответе нет.

/** Контракт USDT по сети. Значение можно переопределить через `PAY_USDT_CONTRACT`. */
const USDT_CONTRACT: Record<string, string> = {
  mainnet: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  nile: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
};

export async function payStatus(env: Env): Promise<Response> {
  const flags = payFlags(env);
  // Базу трогаем только когда это осмысленно: при выключенных деньгах запрос не
  // должен стоить ни одного DDL-запроса к D1.
  const touchDb = flags.payments || flags.schemaCheck;
  const ready = touchDb ? await ensurePaySchema(env.DB) : null;
  return json({
    ok: true,
    service: 'astra-pay',
    version: PAY_SCHEMA_VERSION,
    network: flags.network,
    asset: 'USDT',
    decimals: 6,
    contract: String(env.PAY_USDT_CONTRACT ?? '') || USDT_CONTRACT[flags.network],
    flags: publicFlags(flags),
    // null — база не проверялась (деньги выключены), 'ready' — таблицы на месте.
    schema: ready === null ? 'off' : ready ? 'ready' : 'error',
    tables: PAY_TABLES.length,
    now: Date.now(),
  }, 200, { 'Cache-Control': 'no-store' });
}
