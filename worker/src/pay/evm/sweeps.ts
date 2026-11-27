// Сбор USDT с депозитных адресов в EVM: план → подпись → отправка → подтверждение.
//
// До этого модуля у рельса был только план (`evmSweepPlan`): «вот сколько лежит,
// вот чего не хватает на газ». Дальше оператор шёл в свой кошелёк руками. Ручной
// разбор плох не ленью, а отсутствием следа: сеть видела перевод, а у нас про него
// ничего нет, и следующий план показывает те же деньги «не забранными».
//
// Три решения, заложенные сюда:
//
//   1. **Сбор не трогает баланс игрока.** Деньги зачтены по событию сети
//      (`pay_deposits` → `pay_ledger`), и перекладывание их в горячий кошелёк —
//      это наша внутренняя кастодия, а не расход игрока. Поэтому здесь нет ни
//      `payout`, ни `adjust`: собрал — и журнал игрока не тронут. Обратная
//      сторона медали: `pay_sweeps` — единственный след, и он обязателен.
//   2. **Сумма — ровно то, что прочитали в сети прямо сейчас.** Не «сколько
//      было в плане минутку назад»: игрок мог прислать ещё, и тогда сумма из
//      плана либо не прошла бы по балансу, либо оставила бы пыль, которую больше
//      никто не соберёт.
//   3. **`dryRun` по умолчанию, запись — со словом `SWEEP`.** Та же договорённость,
//      что у приза и у ручной корректировки: первый клик никогда не двигает деньги.
//
// Nonce берётся через тот же замок, что и выплаты (`pay_operations`): с одного
// адреса может уходить и возврат по заявке, и сбор, а два подписанта с одним
// nonce — это «одна транзакция ушла, вторая застряла навсегда».

import { formatMicroUsdt } from '../tron/amount';
import { SWEEP_MIN_MICRO, evmAccountBalances, formatBnb } from './balances';
import { PAYOUT_GAS_LIMIT, BroadcastError, buildPayoutTx, payoutGas } from './broadcast';
import { releaseNonce, reserveNonce } from './payouts';
import { applySignature, signingHash } from './tx';
import { bytesToHex, hexToBytes } from '../crypto/hmac';
import { keccak256 } from '../crypto/keccak';
import type { PayNetwork } from '../flags';
import type { EvmRpc } from './rpc';
import type { PayChain } from '../units';

/** Сколько адресов за один вызов. Больше — это батч, а батч обязан быть чьим-то решением. */
export const SWEEP_RUN_LIMIT = 5;

/** Слово подтверждения записи. Отдельное от `ADJUST`: здесь подписываем чужим ключом. */
export const SWEEP_CONFIRM = 'SWEEP';

/** Префикс ключа идемпотентности в `pay_sweeps.idem_key`. */
export const SWEEP_IDEM_PREFIX = 'admswp:';

/** Статусы, которые считаем «ещё живыми»: по ним не начинаем второй сбор с того же адреса. */
export const SWEEP_OPEN_STATES = ['queued', 'broadcasting', 'sent'];

/** Потолок газа на сбор: ровно столько, сколько стоит `transfer` (та же транзакция, что и выплата). */
export const SWEEP_GAS_LIMIT = PAYOUT_GAS_LIMIT;

export type SweepCode =
  | 'bad_destination'
  | 'bad_chain'
  | 'bad_contract'
  | 'no_candidates'
  | 'sweep_in_progress'
  | 'address_not_ours'
  | 'confirm_required'
  | 'bad_idem_key'
  | 'chain_error';

export class SweepError extends Error {
  readonly code: SweepCode;

  constructor(code: SweepCode, message: string = code) {
    super(message);
    this.name = 'SweepError';
    this.code = code;
  }
}

/** Клиент Signer-контура для сбора: подпись ключом депозитного адреса по индексу. */
export interface SweepSignerRequest {
  index: number;
  address: string;
  tx: Record<string, string | number>;
  signingHash: string;
  recipient: string;
  amountMicro: number;
}

export interface SweepSignerClient {
  signEvmSweep(request: SweepSignerRequest): Promise<{ signature: string; from?: string }>;
}

export interface SweepCandidate {
  address: string;
  userId: string | null;
  derivationIndex: number;
  usdtMicro: number;
  gasWei: bigint;
}

export interface SweepRow {
  id: string;
  chain: PayChain;
  address: string;
  userId: string | null;
  derivationIndex: number;
  amountMicro: number;
  amount: string;
  status: string;
  txid: string;
  error: string;
  /** Ключ оператора: по нему видно, какая кнопка породила эту строку. */
  idemKey: string;
  nonce: number | null;
  createdAt: number;
  decidedAt: number | null;
}

/** Верхняя оценка комиссии одного `transfer` — та же, что показывает план. */
export function sweepGasCostWei(maxFeePerGas: bigint): bigint {
  return maxFeePerGas * SWEEP_GAS_LIMIT;
}

/**
 * Кандидаты на сбор: активные адреса этой сети, у которых есть USDT не меньше
 * минимума и есть нативная монета на газ.
 *
 * Балансы читаются заново, а не берутся из плана: план — отчёт, а отчёт имеет
 * право устареть. Сумма, с которой подписывают, обязана быть прочитана здесь.
 */
export async function sweepCandidates(input: {
  db: D1Database;
  rpc: Pick<EvmRpc, 'call' | 'balance'>;
  contract: string;
  chain: PayChain;
  network: PayNetwork;
  maxFeePerGas: bigint;
  limit?: number;
  scanLimit?: number;
}): Promise<{ candidates: SweepCandidate[]; skipped: Array<{ address: string; reason: string }>; unreadable: number }> {
  const limit = Math.max(1, input.limit ?? SWEEP_RUN_LIMIT);
  // Смотрим больше адресов, чем берём: крупные сортируются вперёд, а «первые N по
  // дате» — это N мелких и ощущение, что собирать нечего.
  const scan = input.scanLimit ?? Math.max(limit * 20, 100);
  const fee = sweepGasCostWei(input.maxFeePerGas);
  const { results } = await input.db.prepare(
    `SELECT address, user_id, derivation_index FROM pay_addresses
      WHERE active = 1 AND chain = ?
      ORDER BY created_at DESC LIMIT ?`,
  ).bind(input.chain, scan).all<{ address: string; user_id: string | null; derivation_index: number }>();

  const candidates: SweepCandidate[] = [];
  const skipped: Array<{ address: string; reason: string }> = [];
  let unreadable = 0;
  for (const row of (results ?? []) as Array<{ address: string; user_id: string | null; derivation_index: number }>) {
    let balances;
    try {
      balances = await evmAccountBalances(input.rpc, input.contract, row.address, input.chain);
    } catch (e) {
      // «Не прочитали» ≠ «пусто»: адрес без ответа остаётся в стороне, но не
      // превращается в «игрок ничего не присылал».
      unreadable += 1;
      skipped.push({ address: row.address, reason: e instanceof Error ? e.message : 'chain_error' });
      continue;
    }
    if (balances.usdtMicro <= 0) continue;
    if (balances.usdtMicro < SWEEP_MIN_MICRO) { skipped.push({ address: row.address, reason: 'below_minimum' }); continue; }
    if (balances.gasWei < fee) { skipped.push({ address: row.address, reason: 'no_gas' }); continue; }
    candidates.push({
      address: row.address, userId: row.user_id ?? null,
      derivationIndex: Number(row.derivation_index), usdtMicro: balances.usdtMicro, gasWei: balances.gasWei,
    });
  }
  // Крупные вперёд: за один вызов забрать максимум того, что всё равно придётся
  // собирать, а не перебирать адреса по алфавиту.
  candidates.sort((a, b) => b.usdtMicro - a.usdtMicro);
  return { candidates: candidates.slice(0, limit), skipped, unreadable };
}

export interface RunSweepInput {
  db: D1Database;
  rpc: EvmRpc;
  signer: SweepSignerClient;
  chain: PayChain;
  chainId: number;
  contract: string;
  network: PayNetwork;
  /** Горячий кошелёк — единственное разрешённое «куда». */
  destination: string;
  actor: string;
  /** Ключ оператора; в `pay_sweeps` уходит как `admswp:<ключ>` (+ адрес на батч). */
  idemKey: string;
  dryRun: boolean;
  confirm: string;
  now: number;
  /** Сузить сбор до одного адреса: «проверь на одном, потом остальное». */
  address?: string;
  maxGasPriceWei?: bigint;
  limit?: number;
}

export interface SweepOutcome {
  address: string;
  userId: string | null;
  amountMicro: number;
  amount: string;
  status: 'would_sweep' | 'broadcasting' | 'failed' | 'skipped';
  id: string;
  txid: string;
  error: string;
  /** Нативки на адресе после чтения — по ней видно, надо ли заносить газ. */
  gasLeft: string;
  gasWei: string;
}

export interface RunSweepResult {
  dryRun: boolean;
  chain: PayChain;
  destination: string;
  totalMicro: number;
  total: string;
  rows: SweepOutcome[];
  skipped: Array<{ address: string; reason: string }>;
  unreadable: number;
  minMicro: number;
  gasLimit: number;
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/**
 * Исполнить сбор. Ошибка по одному адресу не отменяет остальные: сеть может
 * ответить отказом на одном кошельке (кончилась нативка, чужой nonce), и это не
 * повод бросать половину адресов несобранными.
 */
export async function runEvmSweep(input: RunSweepInput): Promise<RunSweepResult> {
  const destination = String(input.destination ?? '').trim().toLowerCase();
  if (!ADDRESS_RE.test(destination)) throw new SweepError('bad_destination');
  if (input.chain !== 'bsc' && input.chain !== 'polygon') throw new SweepError('bad_chain');
  if (!ADDRESS_RE.test(String(input.contract ?? '').toLowerCase())) throw new SweepError('bad_contract');
  if (!input.dryRun && input.confirm !== SWEEP_CONFIRM) throw new SweepError('confirm_required');
  const rawKey = String(input.idemKey ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(rawKey)) throw new SweepError('bad_idem_key');

  // Ставку газа и nonce читаем один раз на вызов: «по запросу на адрес» отказ
  // ноды превратился бы в отказ на каждой итерации.
  let gas;
  try {
    gas = await payoutGas(input.rpc, destination, input.maxGasPriceWei ?? undefined);
  } catch (e) {
    if (e instanceof BroadcastError) throw e;
    throw new SweepError('chain_error', e instanceof Error ? e.message : 'chain_error');
  }

  const found = await sweepCandidates({
    db: input.db, rpc: input.rpc, contract: input.contract, chain: input.chain,
    network: input.network, maxFeePerGas: gas.maxFeePerGas,
    limit: input.address ? 1 : (input.limit ?? SWEEP_RUN_LIMIT),
  });
  let candidates = found.candidates;
  if (input.address) {
    const want = input.address.toLowerCase();
    candidates = candidates.filter((c) => c.address.toLowerCase() === want);
    // «Адрес не в этом списке» — не «собирать нечего»: у адреса может не быть
    // газа, или он принадлежит другой сети. Отказ называется явно, чтобы план и
    // объяснение видел человек, а не лог.
    if (!candidates.length) throw new SweepError('address_not_ours');
  }
  if (!candidates.length) {
    return {
      dryRun: input.dryRun, chain: input.chain, destination, totalMicro: 0, total: '0.00',
      rows: [], skipped: found.skipped, unreadable: found.unreadable,
      minMicro: SWEEP_MIN_MICRO, gasLimit: Number(SWEEP_GAS_LIMIT),
    };
  }

  const rows: SweepOutcome[] = [];
  let total = 0;
  for (const candidate of candidates) {
    const address = candidate.address.toLowerCase();
    const out = (over: Partial<SweepOutcome>): SweepOutcome => ({
      address, userId: candidate.userId, amountMicro: candidate.usdtMicro,
      amount: formatMicroUsdt(candidate.usdtMicro),
      status: 'skipped', id: '', txid: '', error: '',
      gasWei: candidate.gasWei.toString(),
      gasLeft: formatBnb(candidate.gasWei),
      ...over,
    });

    // Открытая попытка по этому адресу — не начинаем вторую: две транзакции с
    // одного адреса означают гонку nonce и «одна ушла, вторая зависла».
    const open = await input.db.prepare(
      `SELECT id FROM pay_sweeps
        WHERE chain = ? AND address = ? AND status IN (${SWEEP_OPEN_STATES.map(() => '?').join(',')}) LIMIT 1`,
    ).bind(input.chain, address, ...SWEEP_OPEN_STATES).first<{ id: string }>();
    if (open) {
      rows.push(out({ status: 'skipped', id: String(open.id), error: 'sweep_in_progress' }));
      continue;
    }

    if (input.dryRun) {
      rows.push(out({ status: 'would_sweep' }));
      total += candidate.usdtMicro;
      continue;
    }

    // Адресpart в ключе обязателен при батче: один клик собирает N адресов, и у
    // каждого обязана быть своя строка журнала — иначе второй адрес батча упёрся
    // бы в UNIQUE по `idem_key` и «пропал» бы из журнала.
    const idemKey = `${SWEEP_IDEM_PREFIX}${rawKey}:${address.slice(2)}`;
    const id = `sw_${shortHash(idemKey)}`;
    let lockKey = '';
    try {
      const reserved = await reserveNonce(input.db, input.rpc, input.chainId, address, input.now);
      lockKey = reserved.key;
      await input.db.prepare(
        `INSERT INTO pay_sweeps (id, chain, address, user_id, derivation_index, contract, destination,
           amount_micro, gas_limit, max_fee_wei, nonce, status, idem_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      ).bind(
        id, input.chain, address, candidate.userId, candidate.derivationIndex, input.contract, destination,
        candidate.usdtMicro, Number(SWEEP_GAS_LIMIT), gas.maxFeePerGas.toString(), reserved.nonce, idemKey, input.now,
      ).run();

      const tx = buildPayoutTx({
        chainId: input.chainId,
        nonce: reserved.nonce,
        contract: input.contract,
        recipient: destination,
        amountMicro: candidate.usdtMicro,
        chain: input.chain,
        maxFeePerGas: gas.maxFeePerGas,
        maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
        gasLimit: SWEEP_GAS_LIMIT,
      });
      const signed = await input.signer.signEvmSweep({
        index: candidate.derivationIndex,
        address,
        tx: {
          chainId: tx.chainId, nonce: tx.nonce,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
          maxFeePerGas: tx.maxFeePerGas.toString(),
          gasLimit: tx.gasLimit.toString(),
          to: tx.to, value: '0', data: tx.data,
        },
        signingHash: signingHash(tx),
        recipient: destination,
        amountMicro: candidate.usdtMicro,
      });
      // Signer подписывает ключом, выведенным из семени по индексу. Адрес, который
      // он назвал, обязан совпасть с адресом из базы: расхождение = перепутанный
      // индекс или чужое семя, и отправлять такое нельзя.
      if (signed.from && signed.from.toLowerCase() !== address) throw new BroadcastError('signer_address_mismatch');
      const raw = applySignature(tx, signed.signature);
      const txid = await input.rpc.sendRawTransaction(raw);
      // Хеш подписанной транзакции — то, чем её зовут в сети. Если нода назвала
      // другой, она приняла не то, что мы собрали, и по этому txid мы будем
      // «подтверждать» чужую транзакцию.
      const computed = bytesToHex(keccak256(hexToBytes(raw.slice(2))));
      if (computed !== txid.toLowerCase()) throw new BroadcastError('tx_hash_mismatch');
      await input.db.prepare(`UPDATE pay_sweeps SET status = 'broadcasting', txid = ?, decided_at = ? WHERE id = ?`)
        .bind(txid, input.now, id).run();
      rows.push(out({ status: 'broadcasting', id, txid }));
      total += candidate.usdtMicro;
    } catch (e) {
      const code = e instanceof BroadcastError ? e.code
        : e instanceof SweepError ? e.code
          : e instanceof Error ? e.message : 'unknown';
      if (lockKey) await releaseNonce(input.db, lockKey);
      await input.db.prepare(`UPDATE pay_sweeps SET status = 'failed', error = ?, decided_at = ? WHERE id = ? AND status = 'queued'`)
        .bind(String(code).slice(0, 200), input.now, id).run().catch(() => null);
      await writeSweepAudit(input.db, input.actor, address, candidate.usdtMicro, input.chain, `failed:${code}`, input.now);
      rows.push(out({ status: 'failed', id, error: String(code) }));
    }
  }

  if (total > 0) {
    await writeSweepAudit(input.db, input.actor, destination, total, input.chain,
      `${input.dryRun ? 'dryRun' : 'sent'}: ${rows.length} адресов`, input.now);
  }
  return {
    dryRun: input.dryRun, chain: input.chain, destination, totalMicro: total, total: formatMicroUsdt(total),
    rows, skipped: found.skipped, unreadable: found.unreadable,
    minMicro: SWEEP_MIN_MICRO, gasLimit: Number(SWEEP_GAS_LIMIT),
  };
}

/** Короткий стабильный хеш строки (FNV-1a) — часть id записи. */
function shortHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

let auditSeq = 0;

async function writeSweepAudit(
  db: D1Database, actor: string, address: string, amountMicro: number, chain: PayChain, note: string, now: number,
): Promise<void> {
  try {
    // id обязан быть уникальным: в одном прогоне мы пишем и «не удалось по
    // адресу», и «итог батча» — с детерминированным id из времени они столкнулись
    // бы (UNIQUE по `pay_audit_log.id`) и вторая запись молча пропала бы.
    auditSeq += 1;
    await db.prepare(
      'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      `au_swp_${now.toString(36)}_${auditSeq.toString(36)}_${shortHash(address + note).slice(0, 6)}`,
      `admin:${actor}`, 'sweep', address,
      JSON.stringify({ amountMicro, chain, note }), now,
    ).run();
  } catch (e) {
    // Сбор мог уже уйти в сеть — отсутствие строки аудита его не отменяет и не
    // даёт права молчать: пусть будет хотя бы в логах.
    console.error('sweep audit write failed', address, e);
  }
}

/**
 * Подтверждения сбора: `broadcasting → sent → confirmed`, реверт → `failed`.
 * Делает cron по той же схеме, что подтверждения выплат, — сверка по квитанции
 * сети, а не «админ посмотрел в эксплорере».
 */
export async function applyEvmSweepConfirmations(
  db: D1Database,
  rpc: Pick<EvmRpc, 'transactionReceipt' | 'blockNumber'>,
  confirmations: number,
  now: number = Date.now(),
  chain: PayChain = 'bsc',
  limit = 20,
): Promise<{ checked: number; confirmed: number; reverted: number; pending: number }> {
  const { results } = await db.prepare(
    `SELECT id, txid, status, address, amount_micro, chain, destination FROM pay_sweeps
      WHERE status IN ('broadcasting', 'sent') AND txid IS NOT NULL AND chain = ?
      ORDER BY created_at ASC LIMIT ?`,
  ).bind(chain, limit).all<{
    id: string; txid: string | null; status: string; address: string;
    amount_micro: number; chain: PayChain; destination: string;
  }>();

  const out = { checked: 0, confirmed: 0, reverted: 0, pending: 0 };
  for (const row of (results ?? []) as Array<{
    id: string; txid: string | null; status: string; address: string;
    amount_micro: number; chain: PayChain; destination: string;
  }>) {
    out.checked += 1;
    const txid = String(row.txid ?? '').toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(txid)) { out.pending += 1; continue; }
    let receipt;
    try {
      receipt = await rpc.transactionReceipt(txid);
    } catch {
      out.pending += 1;
      continue;
    }
    // Квитанции нет — транзакция может лежать в мемпуле. Это не «сбор не
    // состоялся»: деньги на том же адресе, и повторный сбор по «мы её не видим»
    // создал бы вторую транзакцию с тем же источником.
    if (!receipt) { out.pending += 1; continue; }
    if (!receipt.status) {
      await db.prepare(`UPDATE pay_sweeps SET status = 'failed', error = 'reverted', decided_at = ? WHERE id = ?`)
        .bind(now, row.id).run();
      out.reverted += 1;
      continue;
    }
    const head = await rpc.blockNumber();
    const block = receipt.blockNumber ?? head;
    if (head - block + 1 < confirmations) {
      if (row.status === 'broadcasting') await db.prepare(`UPDATE pay_sweeps SET status = 'sent' WHERE id = ?`).bind(row.id).run();
      out.pending += 1;
      continue;
    }
    await db.prepare(`UPDATE pay_sweeps SET status = 'confirmed', decided_at = ? WHERE id = ?`).bind(now, row.id).run();
    await writeSweepAudit(db, 'cron', row.address, Number(row.amount_micro), row.chain, 'confirmed', now);
    out.confirmed += 1;
  }
  return out;
}

/** Последние сборы — для админки и для ответа «когда в последний раз разбирали». */
export async function listSweeps(db: D1Database, limit = 20, chain?: PayChain): Promise<SweepRow[]> {
  const args: unknown[] = [];
  let where = '';
  if (chain) { where = 'WHERE chain = ?'; args.push(chain); }
  args.push(Math.max(1, Math.min(100, limit)));
  const { results } = await db.prepare(
    `SELECT id, chain, address, user_id, derivation_index, amount_micro, status,
            COALESCE(txid, '') AS txid, error, nonce, created_at, decided_at, idem_key
       FROM pay_sweeps ${where} ORDER BY created_at DESC LIMIT ?`,
  ).bind(...args).all<Record<string, unknown>>();
  return ((results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), chain: String(row.chain) as PayChain, address: String(row.address),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    derivationIndex: Number(row.derivation_index),
    amountMicro: Number(row.amount_micro), amount: formatMicroUsdt(Number(row.amount_micro)),
    status: String(row.status), txid: String(row.txid), error: String(row.error ?? ''),
    idemKey: String(row.idem_key ?? ''),
    nonce: row.nonce === null || row.nonce === undefined ? null : Number(row.nonce),
    createdAt: Number(row.created_at),
    decidedAt: row.decided_at === null || row.decided_at === undefined ? null : Number(row.decided_at),
  }));
}

/** Клиент Signer-контура для сбора — отдельная ручка, отдельные секреты (см. Signer). */
export function evmSweepSignerClient(env: {
  SIGNER?: { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> };
  SIGNER_TOKEN?: string;
}): SweepSignerClient {
  return {
    async signEvmSweep(request) {
      const token = String(env.SIGNER_TOKEN ?? '');
      if (!env.SIGNER || !token) throw new BroadcastError('signer_not_configured');
      const res = await env.SIGNER.fetch('https://signer/sign/evm/sweep', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
      });
      const data = await res.json() as { signature?: string; from?: string; error?: string };
      if (!res.ok) throw new BroadcastError(`signer_${data.error ?? res.status}`);
      if (!data.signature) throw new BroadcastError('signer_no_signature');
      return { signature: data.signature, from: typeof data.from === 'string' ? data.from : undefined };
    },
  };
}
