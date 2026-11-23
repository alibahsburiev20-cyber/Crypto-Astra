// Призы из фонда сезона.
//
// Фонд формируется только из выручки магазина (`PRIZE_SHARE_DEFAULT` = 40 % от
// цены косметики, см. `pool.ts`). Взносов игроков в нём нет: пополнить фонд
// может только покупка, поэтому приз физически не может превысить то, что
// действительно заплатили за скины.
//
// Что делает начисление приза:
//   1. списывает сумму из `pay_pool_cycles.prize_budget` — с условием
//      `prize_budget >= сумма`, поэтому одновременные начисления не могут увести
//      фонд в минус;
//   2. зачисляет ту же сумму на USDT-баланс игрока в журнал (`reason = 'pool'`).
//
// Дальше деньги двигаются обычным путём: `POST /pay/withdraw` → `approve` →
// `reserve` → `send` (подпись в Signer). Приз не «выводится мимо кассы»: он
// становится балансом игрока, а вывод — тот же проверенный автомат состояний,
// что и для депозитов.
//
// Почему `reason = 'pool'`, а не отдельный `'prize'`: в CHECK-ограничении таблицы
// `pay_ledger` перечислены допустимые причины, и добавление новой требует
// пересборки таблицы. `'pool'` уже означает «движение из фонда»; конкретный приз
// виден по `source_ref = prize:<ключ>` и по `idem_key = pz:<ключ>`.
//
// Колонку `paid` цикла здесь трогать нельзя: она участвует в формуле
// `Available = Confirmed − Reserved − Paid − Locked`, и приз из выручки сделал бы
// публичный отчёт «дефицитным» на ровном месте. Счётчик фонда — только
// `prize_budget`.

import { appendPayLedger } from './ledger';
import { openCycle } from './pool';
import { formatMicroUsdt } from './tron/amount';

/** Потолок одного приза: 100 USDT. Больше — уже не приз, а сделка, её руками. */
export const MAX_PRIZE_AWARD_MICRO = 100_000_000;

const USER_ID = /^[A-Za-z0-9._:@-]{1,64}$/;
const IDEM = /^[A-Za-z0-9._:-]{8,64}$/;

export class PrizeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'PrizeError';
    this.code = code;
  }
}

export interface PrizeAwardInput {
  userId: string;
  amountMicro: number;
  /** Кому и за что — попадает в аудит. Не секрет, видно владельцу. */
  note?: string;
  /** Ключ от админа: повтор запроса не начислит приз дважды. */
  idemKey: string;
}

export interface PrizeAwardResult {
  duplicated: boolean;
  userId: string;
  amountMicro: number;
  amount: string;
  note: string;
  /** Сколько осталось в фонде после начисления. */
  budgetAfterMicro: number;
  budgetAfter: string;
  ledgerHash: string;
}

export interface PrizeSummary {
  cycleId: string | null;
  budgetMicro: number;
  budget: string;
  /** Сколько уже выдано призов в текущем цикле. */
  awardedMicro: number;
  awarded: string;
  awards: number;
  maxAwardMicro: number;
  maxAward: string;
  updatedAt: number;
}

/** Сколько сейчас в фонде. Без цикла — ноль, а не «неизвестно». */
export async function prizeFundMicro(db: D1Database): Promise<number> {
  const cycle = await openCycle(db);
  return cycle ? Math.max(0, Number(cycle.prize_budget)) : 0;
}

/**
 * Начислить приз с баланса фонда.
 *
 * Порядок важен: сначала списание из фонда (оно и есть проверка «хватает ли»),
 * потом запись в журнал. Если запись окажется повтором (тот же `idem_key`),
 * списание возвращается обратно — деньги не «сгорают» из-за гонки.
 */
export async function awardPrize(
  db: D1Database,
  input: PrizeAwardInput,
  now: number,
): Promise<PrizeAwardResult> {
  const userId = String(input.userId ?? '').trim();
  if (!USER_ID.test(userId)) throw new PrizeError('bad_user');

  const amount = Number(input.amountMicro);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PrizeError('bad_amount');
  if (amount > MAX_PRIZE_AWARD_MICRO) throw new PrizeError('above_maximum');

  const rawKey = String(input.idemKey ?? '').trim();
  if (!IDEM.test(rawKey)) throw new PrizeError('bad_idem_key');
  const idemKey = `pz:${rawKey}`;

  const note = String(input.note ?? '').trim().slice(0, 200);

  const cycle = await openCycle(db);
  if (!cycle) throw new PrizeError('no_open_cycle');

  const existing = await db.prepare('SELECT hash FROM pay_ledger WHERE idem_key = ?')
    .bind(idemKey).first<{ hash: string }>('hash');
  if (existing) {
    const budget = await prizeFundMicro(db);
    return {
      duplicated: true, userId, amountMicro: amount, amount: formatMicroUsdt(amount), note,
      budgetAfterMicro: budget, budgetAfter: formatMicroUsdt(budget), ledgerHash: String(existing.hash),
    };
  }

  // Списание с условием: два одновременных приза не могут увести фонд в минус.
  const res = await db.prepare(
    `UPDATE pay_pool_cycles SET prize_budget = prize_budget - ?
      WHERE id = ? AND status = 'open' AND prize_budget >= ?`,
  ).bind(amount, cycle.id, amount).run();
  const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (!changes) throw new PrizeError('insufficient_prize_fund');

  const ledger = await appendPayLedger(db, {
    userId,
    delta: amount,
    reason: 'pool',
    sourceRef: `prize:${rawKey}`,
    idemKey,
    createdAt: now,
  });

  if (ledger.duplicated) {
    // Гонка двух одинаковых запросов: журнал уже начислил, возвращаем списание.
    await db.prepare('UPDATE pay_pool_cycles SET prize_budget = prize_budget + ? WHERE id = ?')
      .bind(amount, cycle.id).run();
    const budget = await prizeFundMicro(db);
    return {
      duplicated: true, userId, amountMicro: amount, amount: formatMicroUsdt(amount), note,
      budgetAfterMicro: budget, budgetAfter: formatMicroUsdt(budget), ledgerHash: ledger.hash,
    };
  }

  await db.prepare(
    'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    `au_prize_${rawKey}`, 'admin', 'prize_award', userId,
    JSON.stringify({ amountMicro: amount, note, idemKey }), now,
  ).run();

  const budget = await prizeFundMicro(db);
  return {
    duplicated: false, userId, amountMicro: amount, amount: formatMicroUsdt(amount), note,
    budgetAfterMicro: budget, budgetAfter: formatMicroUsdt(budget), ledgerHash: ledger.hash,
  };
}

/** Сводка для админки: сколько в фонде и сколько уже выдано. */
export async function prizeSummary(db: D1Database, now = Date.now()): Promise<PrizeSummary> {
  const cycle = await openCycle(db);
  const total = await db.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS micro, COUNT(*) AS n FROM pay_ledger WHERE reason = 'pool' AND delta > 0",
  ).first<{ micro: number; n: number }>();
  const awarded = Number(total?.micro ?? 0);
  const budget = cycle ? Math.max(0, Number(cycle.prize_budget)) : 0;
  return {
    cycleId: cycle ? String(cycle.id) : null,
    budgetMicro: budget,
    budget: formatMicroUsdt(budget),
    awardedMicro: awarded,
    awarded: formatMicroUsdt(awarded),
    awards: Number(total?.n ?? 0),
    maxAwardMicro: MAX_PRIZE_AWARD_MICRO,
    maxAward: formatMicroUsdt(MAX_PRIZE_AWARD_MICRO),
    updatedAt: now,
  };
}

/** Последние призы: кому, сколько и когда. Без адресов игроков. */
export async function listPrizes(db: D1Database, limit = 20) {
  const { results } = await db.prepare(
    `SELECT user_id, delta, source_ref, created_at FROM pay_ledger
      WHERE reason = 'pool' AND delta > 0
      ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).bind(Math.max(1, Math.min(100, limit))).all<{ user_id: string; delta: number; source_ref: string; created_at: number }>();
  return (results ?? []).map((row) => ({
    userId: String(row.user_id),
    amountMicro: Number(row.delta),
    amount: formatMicroUsdt(Number(row.delta)),
    sourceRef: String(row.source_ref ?? ''),
    createdAt: Number(row.created_at),
  }));
}
