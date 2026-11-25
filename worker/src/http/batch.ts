// Склейка действий в один запрос.
//
// Зачем: одно действие игры = один запрос к Worker, а бесплатный план даёт
// 100 000 в сутки. Пять действий подряд можно отправить одной пачкой — и это
// впятеро меньше запросов при том же игровом результате.
//
// Как устроено: пачка не «доверяет» клиенту ничего нового. Каждая операция
// превращается в обычный HTTP-запрос к тому же маршруту и проходит ту же
// проверку прав, ту же валидацию и тот же `Idempotency-Key`, что и одиночный
// вызов. Поэтому батч не может сделать того, чего нельзя сделать по одному.
//
// Что НЕ складывается в пачку: деньги (`/pay/*`), вход (`/auth/*`), админка
// (`/admin*`) и сам `/batch`. Деньги — отдельно и явно: у них своя идемпотентность
// и свой журнал, и «пачка покупок» — это не то, что нужно упрощать.

export const BATCH_MAX_OPS = 10;
export const BATCH_MAX_BODY = 32 * 1024;

/**
 * Белый список: только игровые действия, которые и так идемпотентны по
 * `Idempotency-Key`. Всё остальное — по одному запросу, как раньше.
 */
export const BATCH_ALLOWED: readonly string[] = [
  '/claim',
  '/profile/callsign',
  '/profile/style',
  '/expeditions/start',
  '/expeditions/cancel',
  '/expeditions/choose',
  '/expeditions/choose-event',
  '/ships/repair',
  '/ships/buy',
  '/fuel/buy',
  '/craft/start',
  '/modules/install',
  '/market/lot',
  '/market/buy',
  '/market/cancel',
  '/missions/claim',
  '/pass/claim',
  '/garage/buy',
  '/minigame/start',
  '/minigame/finish',
  '/referrals/apply',
  '/guild/create',
  '/guild/join',
  '/guild/leave',
  '/guild/kick',
  '/guild/role',
  '/guild/rename',
];

export interface BatchOp {
  op: string;
  idem: string;
  body: Record<string, unknown>;
}

export interface BatchResult {
  op: string;
  status: number;
  data: unknown;
}

const IDEM = /^[A-Za-z0-9._:-]{8,64}$/;

export type ParsedOps = { ok: true; ops: BatchOp[] } | { ok: false; error: string };

/**
 * Разбор тела пачки. Всё строго: лишнее — ошибка, а не «пропустим молча».
 * Идентификатор операции обязателен: без него пачка не может быть идемпотентной,
 * а значит повтор после обрыва связи начислил бы дважды.
 */
export function parseBatchOps(raw: unknown): ParsedOps {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_batch' };
  const list = (raw as { ops?: unknown }).ops;
  if (!Array.isArray(list)) return { ok: false, error: 'bad_batch' };
  if (list.length === 0) return { ok: false, error: 'empty_batch' };
  if (list.length > BATCH_MAX_OPS) return { ok: false, error: 'batch_too_large' };

  const ops: BatchOp[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'bad_op' };
    const entry = item as { op?: unknown; idem?: unknown; body?: unknown };
    const op = String(entry.op ?? '');
    if (!BATCH_ALLOWED.includes(op)) return { ok: false, error: 'op_not_allowed' };
    const idem = String(entry.idem ?? '');
    if (!IDEM.test(idem)) return { ok: false, error: 'bad_idem_key' };
    const body = entry.body === undefined ? {} : entry.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_op_body' };
    ops.push({ op, idem, body: body as Record<string, unknown> });
  }
  return { ok: true, ops };
}

export interface RunBatchInput {
  ops: BatchOp[];
  /** Заголовки исходного запроса: из них берём только авторизацию и cookie. */
  headers: Headers;
  /** Внутренний диспетчер: обычно тот же роутер. */
  dispatch: (request: Request) => Promise<Response>;
  /**
   * Учёт бюджета на каждую операцию. Пачка не должна обходить лимит: пять
   * действий — это пять запросов, даже если сеть была одна.
   */
  consume?: () => Promise<{ allowed: boolean; error?: string; retryAfter?: number }>;
  origin?: string;
}

export interface RunBatchOutput {
  results: BatchResult[];
  /** На какой операции остановились из-за бюджета (null — дошли до конца). */
  blockedAt: number | null;
  retryAfter: number;
}

/**
 * Выполнить пачку последовательно.
 *
 * Последовательно — специально: игры-действия зависят друг от друга (сначала
 * купить топливо, потом стартовать), а параллельность внутри мира всё равно
 * сериализуется транзакциями.
 *
 * Ошибка одной операции не отменяет следующие: клиент видит статус каждой и сам
 * решает, что показывать. Бюджет закончился — останавливаемся и говорим, когда
 * вернуться.
 */
export async function runBatch(input: RunBatchInput): Promise<RunBatchOutput> {
  const results: BatchResult[] = [];
  const origin = input.origin ?? 'https://astra.internal';

  for (let i = 0; i < input.ops.length; i += 1) {
    const op = input.ops[i];

    if (input.consume) {
      const verdict = await input.consume();
      if (!verdict.allowed) {
        return {
          results,
          blockedAt: i,
          retryAfter: verdict.retryAfter ?? 60,
        };
      }
    }

    const headers = new Headers();
    const auth = input.headers.get('authorization');
    if (auth) headers.set('authorization', auth);
    const cookie = input.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
    headers.set('content-type', 'application/json');
    headers.set('idempotency-key', op.idem);

    const request = new Request(new URL(op.op, origin).toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(op.body),
    });

    try {
      const res = await input.dispatch(request);
      const data = await res.json().catch(() => ({}));
      results.push({ op: op.op, status: res.status, data });
    } catch (e) {
      // Одна упавшая операция не должна стирать уже выполненные. Текст ошибки
      // наружу не отдаём: в него попадает то, что сказал Durable Object или D1, —
      // имена таблиц и куски запросов. Клиенту достаточно кода и порядка
      // операций, а настоящая причина остаётся в логе изолята.
      console.error('batch op failed', op.op, e);
      results.push({ op: op.op, status: 500, data: { error: 'internal' } });
    }
  }

  return { results, blockedAt: null, retryAfter: 0 };
}
