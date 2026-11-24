// Обёртка над маршрутизатором: считает запросы и уводит сайт в деградацию.
//
// Логика нарочно простая: один вызов на запрос, никакой магии. Если счётчик
// недоступен — запрос всё равно выполняется (сайт важнее статистики).

import type { Env } from '../env';
import {
  consumeRequest, dailyBudget, blockedCode, isBlocked, peekBudget, routeClass, secondsUntilReset,
} from './budget';

export const MODE_HEADER = 'X-Astra-Mode';

/**
 * Пропустить запрос через бюджет.
 *
 * `run` вызывается только если маршрут разрешён в текущем режиме; иначе игрок
 * получает честный 503 с `Retry-After`, а не «что-то сломалось».
 */
export async function withBudget(
  request: Request,
  env: Env,
  run: () => Promise<Response>,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  const klass = routeClass(url.pathname);

  // Критичные маршруты не тратят бюджет и не могут быть заблокированы: иначе в
  // самый плохой день нельзя будет ни войти, ни посмотреть статус, ни забрать
  // оплаченное.
  if (klass === 'critical') {
    // Бюджет не тратим, но режим показываем правдиво: по этому заголовку
    // мониторинг и клиент понимают, что происходит.
    let criticalMode: string = 'full';
    try {
      const peeked = await peekBudget(env.DB, now, dailyBudget(env.REQUEST_BUDGET));
      criticalMode = peeked.mode;
    } catch { /* счётчик недоступен — не врём, но и не падаем */ }
    const res = await run();
    return withMode(res, criticalMode);
  }

  let mode: string = 'full';
  try {
    const state = await consumeRequest(env.DB, now, dailyBudget(env.REQUEST_BUDGET));
    mode = state.mode;
    if (isBlocked(state.mode, klass)) {
      const retryAfter = secondsUntilReset(now);
      return new Response(
        JSON.stringify({
          ok: false,
          error: blockedCode(state.mode),
          mode: state.mode,
          retryAfter,
          until: new Date(now + retryAfter * 1000).toISOString(),
        }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'retry-after': String(retryAfter),
            [MODE_HEADER]: state.mode,
          },
        },
      );
    }
  } catch {
    // Счётчик сломался — не наказываем игрока.
    mode = 'full';
  }

  const res = await run();
  return withMode(res, mode);
}

function withMode(res: Response, mode: string): Response {
  try {
    // Ответы могут быть с неизменяемыми заголовками (например, из кэша ассетов),
    // поэтому клонируем, а не правим на месте.
    const headers = new Headers(res.headers);
    headers.set(MODE_HEADER, mode);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch {
    return res;
  }
}
