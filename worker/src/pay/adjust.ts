// Ручная корректировка денежного баланса игрока (админка, только владелец).
//
// Зачем это вообще существует: игровые монеты (ASTRA) правятся freely и пишутся
// в журнал мира, а USDT — нет. Баланс игрока это сумма `pay_ledger`, журнал
// append-only (триггеры на UPDATE/DELETE), и «списать деньги» не может означать
// «подправить строку». Значит единственная честная форма такой операции —
// компенсирующая запись с причиной. Она же видна сверке и игроку при экспорте
// данных, поэтому спор «куда делся остаток» решается одной выборкой.
//
// Три решения, заложенные сюда:
//
//   1. **Списание не может увести баланс в минус.** Не «предупредим», а отказ:
//      баланс — это то, что игроку должны, и минус означал бы, что мы теперь
//      должны меньше, чем у него осталось на руках (он уже мог вывести часть).
//   2. **Списание не может съесть деньги, уже обещанные в выплате.** Пока у
//      игрока висит заявка в `requested`/`approved`, её ещё не списали в резерв
//      (резервирование — отдельная проводка `payout`), и после нашего «минус»
//      reserve упадёт с `insufficient_funds` посреди очереди. Поэтому остатка
//      должно хватать на все незакрытые заявки — это и проверяется.
//   3. **`dryRun` по умолчанию.** Первое нажатие в админке показывает, что
//      станет с балансом, и не пишет ничего. Запись создаётся только вторым
//      нажатием с `confirm: 'ADJUST'` и тем же ключом идемпотентности.
//
// Ключ идемпотентности обязателен и принадлежит оператору, а не генерируется
// здесь: «нажал второй раз, потому что сеть не ответила» не должно удвоить
// списание, а «поправил сумму и нажал снова» обязано пройти новой записью.
// Поэтому повтор с тем же ключом, но другими суммой или игроком — не «успех»,
// а `idem_conflict`.

import { appendPayLedger, payBalanceMicro } from './ledger';
import { formatMicroUsdt, parseUsdtToMicro } from './tron/amount';
import { MICRO } from './units';

/** Потолок одной корректировки: 5 000 USDT — та же планка, что у заявки на вывод. */
export const MAX_ADJUST_MICRO = 5_000 * MICRO;

/** Префикс ключа в `pay_ledger.idem_key`: не пересекается с `wdres:`/`pz:`. */
export const ADJUST_IDEM_PREFIX = 'admadj:';

/** Подтверждение, которое обязан ввести оператор, чтобы запись состоялась. */
export const ADJUST_CONFIRM = 'ADJUST';

/** Статусы заявок, которые ещё не списали баланс, но уже обещают списать. */
export const PENDING_WITHDRAWAL_STATES = ['requested', 'approved'];

export type AdjustCode =
  | 'bad_user'
  | 'bad_amount'
  | 'amount_too_big'
  | 'reason_required'
  | 'bad_idem_key'
  | 'confirm_required'
  | 'balance_below_zero'
  | 'below_pending_withdrawals'
  | 'idem_conflict';

export class AdjustError extends Error {
  readonly code: AdjustCode;

  constructor(code: AdjustCode) {
    super(code);
    this.code = code;
  }
}

export interface AdjustInput {
  /** Канонический id игрока (маршрут разбирает email/начало id до него). */
  userId: string;
  /** Микро-USDT со знаком: минус — списание. */
  deltaMicro: number;
  reason: string;
  /** Ключ оператора; в базу уходит с префиксом `admadj:`. */
  idemKey: string;
  /** Кто пишет в аудит: `owner` или id доступа. */
  actor: string;
  dryRun?: boolean;
  confirm?: string;
}

export interface AdjustResult {
  dryRun: boolean;
  duplicated: boolean;
  playerId: string;
  deltaMicro: number;
  delta: string;
  direction: 'credit' | 'debit';
  balanceBeforeMicro: number;
  balanceBefore: string;
  balanceAfterMicro: number;
  balanceAfter: string;
  /** Сколько денег у игрока зарезервировано незакрытыми заявками. */
  pendingMicro: number;
  pending: string;
  reason: string;
  idemKey: string;
  ledgerHash: string;
}

const IDEM_RE = /^[A-Za-z0-9:_-]{8,80}$/;

/**
 * Разбор тела запроса. Чистая функция: «сколько микро-USDT мы собираемся
 * списать» — то, что обязано быть проверенным без базы, потому что ошибка на
 * этом шаге стоит либо чужих денег, либо «операция не прошла, а деньги ушли».
 *
 * Принимаются обе формы: человекочитаемая (`amount: "12.5"`, `direction:
 * 'debit'`) и машинная (`deltaMicro: -12500000`) — вторая нужна скриптам и
 * повтору из журнала.
 */
export function parseAdjustInput(
  body: Record<string, unknown>,
): { ok: true; value: { userId: string; deltaMicro: number; reason: string; idemKey: string; dryRun: boolean; confirm: string } } | { ok: false; error: AdjustCode } {
  const userId = String(body.player ?? body.userId ?? body.playerId ?? body.email ?? '').trim();
  if (!userId || userId.length > 254) return { ok: false, error: 'bad_user' };

  const reason = String(body.reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  // Причина — не «комментарий по желанию»: без неё скорректированная проводка
  // неотличима от ошибки, и восстановить её later нечем.
  if (reason.length < 3) return { ok: false, error: 'reason_required' };

  const idemKey = String(body.idem ?? body.idemKey ?? '').trim();
  if (!IDEM_RE.test(idemKey)) return { ok: false, error: 'bad_idem_key' };

  let deltaMicro: number;
  const raw = body.deltaMicro ?? body.delta;
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed === 0) return { ok: false, error: 'bad_amount' };
    deltaMicro = parsed;
  } else {
    const amount = String(body.amount ?? '').trim();
    if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(amount)) return { ok: false, error: 'bad_amount' };
    const negative = amount.startsWith('-');
    const magnitude = negative ? amount.slice(1) : amount;
    let micro: number;
    try {
      micro = parseUsdtToMicro(magnitude);
    } catch {
      return { ok: false, error: 'bad_amount' };
    }
    const direction = String(body.direction ?? '').trim().toLowerCase();
    if (direction !== '' && direction !== 'credit' && direction !== 'debit') return { ok: false, error: 'bad_amount' };
    // Минус в сумме и `direction: 'debit'` — одно и то же; вместе они не
    // «взаимно уничтожаются» (минус на минус = плюс) и не спорят.
    const debit = negative || direction === 'debit';
    deltaMicro = debit ? -micro : micro;
  }
  if (Math.abs(deltaMicro) > MAX_ADJUST_MICRO) return { ok: false, error: 'amount_too_big' };

  return {
    ok: true,
    value: { userId, deltaMicro, reason, idemKey, dryRun: body.dryRun !== false, confirm: String(body.confirm ?? '') },
  };
}

/** Сколько у игрока зарезервировано «в головах»: заявки, ещё не списавшие баланс. */
export async function pendingWithdrawalMicro(db: D1Database, userId: string): Promise<number> {
  const placeholders = PENDING_WITHDRAWAL_STATES.map(() => '?').join(',');
  const row = await db.prepare(
    `SELECT COALESCE(SUM(amount_micro), 0) AS micro FROM pay_withdrawals
      WHERE user_id = ? AND status IN (${placeholders})`,
  ).bind(userId, ...PENDING_WITHDRAWAL_STATES).first<{ micro: number }>();
  return Math.max(0, Number(row?.micro ?? 0));
}

/**
 * Применить корректировку. Возвращает и «что было», и «что стало»: оператор
 * принимает решение по числам, а не по своим ощущениям, и эти же числа уходят в
 * `pay_audit_log`.
 */
export async function adjustBalance(db: D1Database, input: AdjustInput, now: number): Promise<AdjustResult> {
  const userId = String(input.userId ?? '').trim();
  if (!userId) throw new AdjustError('bad_user');
  const delta = Number(input.deltaMicro);
  if (!Number.isSafeInteger(delta) || delta === 0) throw new AdjustError('bad_amount');
  if (Math.abs(delta) > MAX_ADJUST_MICRO) throw new AdjustError('amount_too_big');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) throw new AdjustError('reason_required');
  const rawKey = String(input.idemKey ?? '').trim();
  if (!IDEM_RE.test(rawKey)) throw new AdjustError('bad_idem_key');
  const idemKey = `${ADJUST_IDEM_PREFIX}${rawKey}`;
  const dryRun = input.dryRun !== false;
  if (!dryRun && input.confirm !== ADJUST_CONFIRM) throw new AdjustError('confirm_required');

  const before = await payBalanceMicro(db, userId);
  const after = before + delta;
  const pending = await pendingWithdrawalMicro(db, userId);

  const shape = (over: Partial<AdjustResult>): AdjustResult => ({
    dryRun,
    duplicated: false,
    playerId: userId,
    deltaMicro: delta,
    delta: formatMicroUsdt(Math.abs(delta)),
    direction: delta < 0 ? 'debit' : 'credit',
    balanceBeforeMicro: before,
    balanceBefore: formatMicroUsdt(before),
    balanceAfterMicro: after,
    balanceAfter: formatMicroUsdt(after),
    pendingMicro: pending,
    pending: formatMicroUsdt(pending),
    reason,
    idemKey,
    ledgerHash: '',
    ...over,
  });

  // Повтор с тем же ключом — не ошибка, а «это уже записано»: показываем то же
  // самое, что увидел оператор в прошлый раз. Другая сумма под тем же ключом —
  // отказ: значит ключ переиспользовали, и «исправленная» операция требует
  // нового ключа, а не подмены уже проведённой.
  const seen = await db.prepare(
    'SELECT user_id, delta, hash FROM pay_ledger WHERE idem_key = ? LIMIT 1',
  ).bind(idemKey).first<{ user_id: string; delta: number; hash: string }>();
  if (seen) {
    if (String(seen.user_id) !== userId || Number(seen.delta) !== delta) throw new AdjustError('idem_conflict');
    // Запись уже в журнале, значит `before` — это ИТОГ прошлой операции, а не
    // «до». Разворачиваем числа обратно, иначе превью сказало бы оператору, что
    // баланс изменится ещё раз.
    const afterStored = before;
    const beforeStored = afterStored - delta;
    return shape({
      duplicated: true,
      ledgerHash: String(seen.hash),
      balanceBeforeMicro: beforeStored,
      balanceBefore: formatMicroUsdt(beforeStored),
      balanceAfterMicro: afterStored,
      balanceAfter: formatMicroUsdt(afterStored),
    });
  }

  // Границы применяются и к пробному проходу: показывать «станет −40 USDT» и
  // разрешать это записать — значит сделать из превью ловушку.
  if (after < 0) throw new AdjustError('balance_below_zero');
  if (after < pending) throw new AdjustError('below_pending_withdrawals');

  if (dryRun) return shape({});

  const ledger = await appendPayLedger(db, {
    userId,
    delta,
    reason: 'adjust',
    sourceRef: `admin:${reason}`.slice(0, 200),
    idemKey,
    createdAt: now,
  });
  if (ledger.duplicated) {
    // Гонка двух вкладок: провёл кто-то другой, мы не удваиваем.
    return shape({ duplicated: true, ledgerHash: ledger.hash });
  }

  try {
    await db.prepare(
      'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      `au_${idemKey}`, `admin:${input.actor || 'owner'}`, 'balance_adjust', userId,
      JSON.stringify({ deltaMicro: delta, reason, idemKey, balanceBefore: before, balanceAfter: after }), now,
    ).run();
  } catch (e) {
    // Проводка уже в журнале — откатывать её нельзя, а молчать нельзя: без
    // аудита операция выглядит как «вдруг изменилось».
    console.error('balance adjust audit write failed', idemKey, e);
  }

  return shape({ ledgerHash: ledger.hash });
}

/** Код ошибки → HTTP-статус. Свои, а не «400 на всё»: смысл отказа виден в логах. */
export function adjustStatus(code: AdjustCode): number {
  if (code === 'balance_below_zero' || code === 'below_pending_withdrawals' || code === 'idem_conflict') return 409;
  if (code === 'amount_too_big') return 422;
  // `confirm_required` — тот же код и тот же статус, что у подтверждения удаления
  // аккаунта: одному коду не место в двух статусах, иначе «код → смысл» читают
  // по логам, а не по ответу.
  return 400;
}
