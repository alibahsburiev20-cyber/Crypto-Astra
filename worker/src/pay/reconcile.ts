// Сверка (этап 11): «сколько должно быть» против «сколько записано».
//
// Сверка не верит никому: она складывает журнал, складывает депозиты и заявки и
// сравнивает. Расхождение — это не «мелкая ошибка», а сигнал остановить выплаты,
// пока не разобрались.
//
// Что проверяется:
//   1. хеш-цепочка журнала (подмена строки видна);
//   2. сумма `reason = deposit` в журнале = сумме зачисленных депозитов;
//   3. сумма `reason = payout` в журнале = сумме заявок в состояниях
//      «зарезервировано … отправлено»;
//   4. ни у кого нет отрицательного баланса;
//   5. стоп-флаг: если он поднят, выплаты не идут даже при `PAYOUTS_ENABLED`.
//
// Баланс блокчейна сверяется отдельно (этап 12): для этого нужен реальный
// узел, а не наши таблицы.

import { verifyPayLedger } from './ledger';

export interface ReconcileIssue {
  code: string;
  detail: string;
}

export interface ReconcileReport {
  ok: boolean;
  checkedAt: number;
  ledger: { ok: boolean; rows: number; brokenAt: string | null };
  totals: {
    depositsMicro: number;
    creditedDepositsMicro: number;
    payoutsMicro: number;
    reservedWithdrawalsMicro: number;
    balancesMicro: number;
  };
  issues: ReconcileIssue[];
  stop: boolean;
}

const STOP_SCOPE = 'system';
const STOP_KEY = 'payouts_stop';

export async function isPayoutsStopped(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT response FROM pay_operations WHERE scope = ? AND idem_key = ?')
    .bind(STOP_SCOPE, STOP_KEY).first<string>('response');
  if (!row) return false;
  try {
    return (JSON.parse(String(row)) as { stop?: boolean }).stop === true;
  } catch {
    return true; // битое значение трактуем как «стоп»: безопаснее остановиться
  }
}

export async function setPayoutsStop(
  db: D1Database,
  stop: boolean,
  reason: string,
  now: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO pay_operations (scope, idem_key, user_id, request_hash, response, created_at)
     VALUES (?, ?, NULL, ?, ?, ?)
     ON CONFLICT (scope, idem_key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at`,
  ).bind(STOP_SCOPE, STOP_KEY, String(reason).slice(0, 120), JSON.stringify({ stop, reason }), now).run();
  await db.prepare(
    'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    `au_stop_${now}_${stop ? 'on' : 'off'}`, 'system', stop ? 'payouts_stop' : 'payouts_resume',
    'withdrawals', JSON.stringify({ reason }), now,
  ).run();
}

export async function reconcile(db: D1Database, now: number): Promise<ReconcileReport> {
  const ledger = await verifyPayLedger(db);

  const sum = async (sql: string, params: unknown[] = []): Promise<number> => {
    const row = await db.prepare(sql).bind(...params).first<number>('total');
    return Number(row ?? 0);
  };

  const depositsMicro = await sum("SELECT COALESCE(SUM(amount), 0) AS total FROM (SELECT delta AS amount FROM pay_ledger WHERE reason = 'deposit')");
  const creditedDepositsMicro = await sum(
    "SELECT COALESCE(SUM(amount_micro), 0) AS total FROM pay_deposits WHERE status = 'credited'",
  );
  const payoutsMicro = await sum(
    "SELECT COALESCE(SUM(-delta), 0) AS total FROM pay_ledger WHERE reason = 'payout'",
  );
  const reservedWithdrawalsMicro = await sum(
    `SELECT COALESCE(SUM(amount_micro), 0) AS total FROM pay_withdrawals
      WHERE status IN ('reserved', 'broadcasting', 'sent')`,
  );
  const balancesMicro = await sum('SELECT COALESCE(SUM(delta), 0) AS total FROM pay_ledger');

  const issues: ReconcileIssue[] = [];
  if (!ledger.ok) {
    issues.push({ code: 'ledger_broken', detail: ledger.brokenAt ?? 'mismatch' });
  }
  if (depositsMicro !== creditedDepositsMicro) {
    issues.push({
      code: 'deposits_vs_ledger',
      detail: `журнал ${depositsMicro}, депозиты ${creditedDepositsMicro}`,
    });
  }
  if (payoutsMicro !== reservedWithdrawalsMicro) {
    issues.push({
      code: 'payouts_vs_withdrawals',
      detail: `журнал ${payoutsMicro}, заявки ${reservedWithdrawalsMicro}`,
    });
  }

  const { results: negative } = await db.prepare(
    'SELECT user_id, SUM(delta) AS total FROM pay_ledger GROUP BY user_id HAVING SUM(delta) < 0',
  ).all<{ user_id: string; total: number }>();
  for (const row of negative ?? []) {
    issues.push({ code: 'negative_balance', detail: `${row.user_id}: ${Number(row.total)}` });
  }

  return {
    ok: issues.length === 0,
    checkedAt: now,
    ledger: { ok: ledger.ok, rows: ledger.rows, brokenAt: ledger.brokenAt },
    totals: { depositsMicro, creditedDepositsMicro, payoutsMicro, reservedWithdrawalsMicro, balancesMicro },
    issues,
    stop: await isPayoutsStopped(db),
  };
}

/**
 * Сверка «с последствиями»: при расхождении поднимает стоп-флаг сам.
 * Возвращает отчёт, чтобы cron мог записать его в лог.
 */
export async function reconcileAndFlag(db: D1Database, now: number): Promise<ReconcileReport> {
  const report = await reconcile(db, now);
  if (!report.ok && !report.stop) {
    await setPayoutsStop(db, true, report.issues.map((i) => i.code).join(','), now);
    report.stop = true;
  }
  return report;
}

/**
 * Суточная сверка без привязки к тексту расписания.
 *
 * Раньше в `scheduled` стояло сравнение `controller.cron === '0 3 * * *'`:
 * малейшая правка `crons` в `wrangler.toml` — и сверка молча перестаёт бегать,
 * а вместе с ней и автостоп при расхождении журнала. Теперь периодичность
 * хранится в самой базе (та же таблица `pay_operations`, где живёт стоп-флаг):
 * сработал любой тик — сверяемся, если с прошлой сверки прошло не меньше порога.
 * Как часто будит расписание — Worker'у больше не важно.
 */
const RECONCILE_MARK = 'reconcile_last';
export const RECONCILE_MIN_INTERVAL_MS = 20 * 60 * 60_000; // сутки с запасом на пропущенный тик

export async function reconcileDaily(db: D1Database, now: number): Promise<ReconcileReport | null> {
  let last = 0;
  try {
    const row = await db.prepare('SELECT response FROM pay_operations WHERE scope = ? AND idem_key = ?')
      .bind('system', RECONCILE_MARK).first<string>('response');
    last = Number((JSON.parse(String(row ?? '{}')) as { ts?: unknown }).ts ?? 0) || 0;
  } catch {
    last = 0; // нет строки или битый JSON — считаем, что сверки давно не было
  }
  if (now - last < RECONCILE_MIN_INTERVAL_MS) return null;
  // Отметку пишем ТОЛЬКО после успешной сверки: если база упала — следующий тик
  // попробует снова, вместо «ещё сутки никто не смотрел».
  const report = await reconcileAndFlag(db, now);
  await db.prepare(
    `INSERT INTO pay_operations (scope, idem_key, user_id, request_hash, response, created_at)
     VALUES ('system', ?, NULL, 'cron', ?, ?)
     ON CONFLICT (scope, idem_key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at`,
  ).bind(RECONCILE_MARK, JSON.stringify({ ts: now }), now).run();
  return report;
}
