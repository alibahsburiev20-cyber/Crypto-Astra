// Выплаты в EVM: очередь,nonce-замок и подтверждение по квитанции сети.
//
// Зачем здесь замок. `nonce` — счётчик транзакций кошелька, и его даёт нода. Два
// админа, нажавшие «отправить» одновременно, получают один и тот же номер: первая
// транзакция уходит, вторая никогда не будет принята (тот же nonce), а заявка
// остаётся в `broadcasting` с уже списанным резервом. Деньги не потеряны, но
// «зависли» — ровно тот класс bugs, который потом ищут неделями.
//
// замок — это строка в `pay_operations` с PRIMARY KEY (scope, idem_key): в D1
// вставка с конфликтом — атомарная операция, и она же «выдала/не выдала» разрешение.
// Конфликт = номер занят параллельной отправкой → берём следующий.
//
// Подтверждение. Идемпотентность в сети даёт не мы, а `txid`: повторная отправка
// тем же nonce невозможна, а `pay_withdrawals.txid` уникален. Переходы — только по
// таблице состояний из `pay/payouts.ts`.

import { failWithdrawal, confirmWithdrawal, markSent, type WithdrawalRow } from '../payouts';
import type { PayChain } from '../units';
import { PAYOUT_GAS_LIMIT } from './broadcast';
import type { EvmRpc } from './rpc';

/** Scope замка в `pay_operations`. */
export const NONCE_SCOPE = 'evm_nonce';

/** Сколько заявок за один проход сверяем: cron не должен выставлять очередь в RPC. */
export const PAYOUT_VERIFY_LIMIT = 20;

export function nonceKey(chainId: number, owner: string, nonce: number): string {
  return `${chainId}:${owner.toLowerCase()}:${nonce}`;
}

async function claim(db: D1Database, key: string, now: number): Promise<boolean> {
  const res = await db.prepare(
    `INSERT INTO pay_operations (scope, idem_key, user_id, request_hash, response, created_at)
     VALUES (?, ?, NULL, '', '', ?) ON CONFLICT (scope, idem_key) DO NOTHING`,
  ).bind(NONCE_SCOPE, key, now).run();
  return Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}

export async function releaseNonce(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM pay_operations WHERE scope = ? AND idem_key = ?')
    .bind(NONCE_SCOPE, key).run().catch(() => null);
}

export interface NonceReservation {
  nonce: number;
  key: string;
}

/**
 * Занять nonce для отправки. `attempts` — потому что занят может быть ровно один
 * соседний номер: параллельная отправка уйдёт с этим же nonce+1 не позже, чем мы
 * досчитаем до конца цикла.
 */
export async function reserveNonce(
  db: D1Database,
  rpc: Pick<EvmRpc, 'transactionCount'>,
  chainId: number,
  owner: string,
  now: number,
  attempts = 3,
): Promise<NonceReservation> {
  let nonce = await rpc.transactionCount(owner, 'pending');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const key = nonceKey(chainId, owner, nonce);
    if (await claim(db, key, now)) return { nonce, key };
    nonce += 1;
  }
  throw new Error('nonce_busy');
}

export type VerifyResult = 'confirmed' | 'pending' | 'reverted' | 'no_txid' | 'not_found' | 'skipped';

export interface VerifyInput {
  db: D1Database;
  rpc: Pick<EvmRpc, 'transactionReceipt' | 'blockNumber'>;
  confirmations: number;
  withdrawalId: string;
  now?: number;
}

/**
 * Проверить одну выплату по квитанции: `sent → confirmed`, реверт → `failed` с
 * возвратом резерва, квитанции нет → ждём.
 *
 * «Квитанции нет» — это не «транзакция пропала»: на BSC она может лежать в
 * мемпуле минут десять. Возврат денег делаем только по явной ошибке сети, иначе
 * игрок получит и USDT, и возврат — за наш счёт.
 */
export async function verifyPayout(input: VerifyInput): Promise<VerifyResult> {
  const now = input.now ?? Date.now();
  const row = await input.db.prepare(
    'SELECT id, status, txid FROM pay_withdrawals WHERE id = ?',
  ).bind(input.withdrawalId).first<{ id: string; status: string; txid: string | null }>();
  if (!row) return 'not_found';
  // Уже подтверждено или переведено в `failed`/`manual` — сверять нечего.
  if (row.status !== 'broadcasting' && row.status !== 'sent') return 'skipped';
  const txid = String(row.txid ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) return 'no_txid';

  const receipt = await input.rpc.transactionReceipt(txid).catch(() => null);
  // Квитанции нет — транзакция может лежать в мемпуле. Ждём: возврат денег по
  // «мы её пока не видим» означал бы «игрок получил дважды».
  if (!receipt) return 'pending';
  if (!receipt.status) {
    await failWithdrawal(input.db, row.id, 'reverted', now);
    // Реверт — не «ошибка отправки»: сеть видела транзакцию и откатила её. Попытку
    // закрываем здесь, иначе в `pay_payouts` она навсегда останется `broadcast`,
    // и админ будет гадать, пытался кто-то ещё или нет.
    await input.db.prepare(
      `UPDATE pay_payouts SET result = 'reverted', error = 'reverted', solidified_at = ?
        WHERE withdrawal_id = ? AND result = 'broadcast'`,
    ).bind(now, row.id).run();
    return 'reverted';
  }
  const head = await input.rpc.blockNumber();
  const block = receipt.blockNumber ?? head;
  if (head - block + 1 < input.confirmations) return 'pending';

  if (row.status === 'broadcasting') await markSent(input.db, row.id, txid, now);
  await confirmWithdrawal(input.db, row.id, now);
  return 'confirmed';
}

/**
 * Сверить очередь выплат с сетью. Вызывается из cron; ничего не подписывает.
 *
 * Возвращает счётчики — по ним в `/admin/pay` видно, что подтверждения идут, а
 * не что очередь стоит (нода молчит, а мы «всё хорошо»).
 */
export async function applyEvmPayoutConfirmations(
  db: D1Database,
  rpc: Pick<EvmRpc, 'transactionReceipt' | 'blockNumber'>,
  confirmations: number,
  now: number = Date.now(),
  chain: PayChain = 'bsc',
): Promise<{ checked: number; confirmed: number; reverted: number; pending: number }> {
  // Фильтр по сети обязателен: заявка в Polygon и проверка через RPC BNB — это
  // «transakция не найдена» на каждый проход, то есть вечно висящий `sent`.
  const rows = await db.prepare(
    `SELECT id FROM pay_withdrawals
      WHERE status IN ('broadcasting', 'sent') AND txid IS NOT NULL AND chain = ?
      ORDER BY decided_at ASC LIMIT ?`,
  ).bind(chain, PAYOUT_VERIFY_LIMIT).all<{ id: string }>();

  const out = { checked: 0, confirmed: 0, reverted: 0, pending: 0 };
  for (const row of (rows.results ?? []) as Array<{ id: string }>) {
    out.checked += 1;
    try {
      const result = await verifyPayout({ db, rpc, confirmations, withdrawalId: row.id, now });
      if (result === 'confirmed') out.confirmed += 1;
      else if (result === 'reverted') out.reverted += 1;
      else out.pending += 1; // pending / no_txid / skipped / not_found: ждём дальше
    } catch {
      // Ошибка сети по одной заявке не отменяет сверку остальных; на следующем
      // проходе cron попробуем снова — переходы идемпотентны.
      out.pending += 1;
    }
  }
  return out;
}

/** Максимальная стоимость газа перевода — «запас на неудачу» для кошелька. */
export function payoutMaxCostWei(maxFeePerGas: bigint, gasLimit: bigint = PAYOUT_GAS_LIMIT): bigint {
  return maxFeePerGas * gasLimit;
}

export type { WithdrawalRow };
