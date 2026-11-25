// Выплата USDT BEP-20: собрать транзакцию → подписать в Signer → отправить в сеть.
//
// Это EVM-близнец `pay/broadcast.ts` (TRON). Разница не в словах, а в деталях:
//   * транзакцию собираем сами, а не просим у ноды — в EVM «unsigned» в сеть не
//     отправляют: поле `to`/`data`/газ известны заранее;
//   * комиссия — EIP-1559 (`maxFeePerGas` + приоритет), а не `fee_limit` в TRX;
//   * подпись — keccak256 от `0x02 || rlp(поля)`, а не sha256 от protobuf;
//   * `nonce` считает нода, и он же — защита от двойной отправки.
//
// Ключей здесь нет: подписывает Signer, и он сам разбирает то, что подписывает
// (`decodeSignedTx`), поэтому Worker физически не может попросить подписать одно,
// а отправить в сеть другое.
//
// Идемпотентности на уровне сети нет и быть не может. Повтор отправке запрещает
// автомат состояний (`reserved → broadcasting` ровно один раз) и `nonce`: второй
// перевод с тем же номером нода не примет.

import { keccak256 } from '../crypto/keccak';
import { bytesToHex, hexToBytes } from '../crypto/hmac';
import { chainValueToMicro, microToChainValue } from '../units';
import {
  TxError, applySignature, signingHash, transferCalldata, type EvmTxFields,
} from './tx';
import { createEvmRpc, type EvmRpc } from './rpc';
import type { Env } from '../../env';
import { payFlags } from '../flags';
import { chainSpec } from '../chain';

/** Лимит газа на `transfer(address,uint256)`. Реальный расход ~45–65k; берём с запасом. */
export const PAYOUT_GAS_LIMIT = 80_000n;

/** 20 gwei. Выше — сеть стоит дороже перевода, и это повод остановиться, а не платить. */
export const DEFAULT_MAX_GAS_PRICE_WEI = 20_000_000_000n;

export class BroadcastError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
  }
}

/** Клиент Signer-контура для EVM: отдаёт подпись 65 байт (`r||s||v`, v = 27 + recovery). */
export interface EvmSignerRequest {
  tx: Record<string, string | number>;
  signingHash: string;
  recipient: string;
  amountMicro: number;
}

export interface EvmSignerClient {
  /**
   * `from` — адрес того ключа, которым Signer реально подписал. Нужен, чтобы
   * `PAY_HOT_ADDRESS` и `SIGNER_PRIVATE_KEY` не могли разойтись: баланс мы
   * смотрим у одного кошелька, а подпись стоит у другого.
   */
  signEvm(request: EvmSignerRequest): Promise<{ signature: string; from?: string }>;
}

/**
 * Тело транзакции. Отдельная чистая функция: её можно сверить с эталонным хешем
 * без подделки RPC, а Signer пересобирает из тех же полей — расхождение видно сразу.
 */
export function buildPayoutTx(input: {
  chainId: number;
  nonce: number;
  contract: string;
  recipient: string;
  amountMicro: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasLimit?: bigint;
}): EvmTxFields {
  if (!Number.isSafeInteger(input.amountMicro) || input.amountMicro <= 0) throw new BroadcastError('bad_amount');
  // Перевод на 18-значной сети обязан быть точным до micro: иначе «отдали 1 USDT»,
  // а в сети ушло 0.999999999999.
  const raw = microToChainValue(input.amountMicro, 'bsc');
  if (chainValueToMicro(raw.toString(), 'bsc') !== input.amountMicro) throw new BroadcastError('amount_not_exact');
  return {
    chainId: input.chainId,
    nonce: input.nonce,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    maxFeePerGas: input.maxFeePerGas,
    gasLimit: input.gasLimit ?? PAYOUT_GAS_LIMIT,
    to: input.contract,
    value: 0n,
    data: transferCalldata(input.recipient, raw),
  };
}

export interface PayoutGas {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: number;
}

/**
 * Комиссия и следующий номер счёта. У части нод `eth_feeHistory` не отдаётся — тогда
 * берём `eth_gasPrice` и удваиваем, чтобы транзакция не зависла в мемпуле.
 *
 * Ставку считаем здесь и больше нигде: `maxFeePerGas` из `sendUsdtEvm` строится на
 * этих же числах, и проверка «не дороже ли газ, чем перевод» обязана стоять до
 * подписи, иначе она проверяет уже подписанное.
 */
export async function payoutGas(
  rpc: Pick<EvmRpc, 'feeHistory' | 'gasPrice' | 'transactionCount'>,
  owner: string,
  maxGasPriceWei: bigint = DEFAULT_MAX_GAS_PRICE_WEI,
): Promise<PayoutGas> {
  const nonce = await rpc.transactionCount(owner, 'pending');
  const history = await rpc.feeHistory().catch(() => null);
  const price = history ? null : await rpc.gasPrice();
  const gas: PayoutGas = history
    ? { ...history, nonce }
    : { maxFeePerGas: (price ?? 0n) * 2n, maxPriorityFeePerGas: price ?? 0n, nonce };
  // Ноль — это не «бесплатно», а «нода врёт» или сеть забита: транзакция не уйдёт
  // никогда, а заявка повиснет в `broadcasting`.
  if (gas.maxFeePerGas <= 0n) throw new BroadcastError('gas_price_missing');
  if (gas.maxFeePerGas > maxGasPriceWei) throw new BroadcastError('gas_price_too_high');
  if (gas.maxPriorityFeePerGas > gas.maxFeePerGas) throw new BroadcastError('gas_price_too_high');
  return gas;
}

export interface SendInput {
  owner: string;
  recipient: string;
  amountMicro: number;
  contract: string;
  chainId: number;
  /**
   * Заранее занятый номер (замок в `pay_operations`). Если передан — берём его,
   * а не читаем у ноды: иначе две параллельные отправки подпишут один nonce.
   */
  nonce?: number;
  maxGasPriceWei?: bigint;
}

export interface SendResult {
  txid: string;
  signature: string;
  raw: string;
  nonce: number;
  /** Худший случай по газу в wei — сколько максимально с нас возьмёт сеть. */
  maxCostWei: bigint;
}

/**
 * Полный путь: газ → тело → подпись в Signer → `eth_sendRawTransaction`.
 *
 * Порядок проверок такой, чтобы до сети не ушло ничего подписанного, если
 * конфигурация врёт: цепь, кошелёк и контракт сверяются до подписи.
 */
export async function sendUsdtEvm(rpc: EvmRpc, signer: EvmSignerClient, input: SendInput): Promise<SendResult> {
  if (!/^0x[0-9a-f]{40}$/.test(String(input.contract ?? '').toLowerCase())) throw new BroadcastError('bad_contract');
  if (!/^0x[0-9a-f]{40}$/.test(String(input.recipient ?? '').toLowerCase())) throw new BroadcastError('bad_recipient');
  if (input.recipient.toLowerCase() === input.contract.toLowerCase()) throw new BroadcastError('recipient_is_contract');
  if (!/^0x[0-9a-f]{40}$/.test(String(input.owner ?? '').toLowerCase())) throw new BroadcastError('bad_owner');
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new BroadcastError('bad_chain_id');
  if (input.nonce !== undefined && (!Number.isInteger(input.nonce) || input.nonce < 0)) {
    throw new BroadcastError('bad_nonce');
  }

  // Нода обязана обслуживать ту же сеть, для которой Signer подписал транзакцию:
  // подпись с чужым chainId не проходит, а вот отправка в «ту же EVM, но другую
  // цепь» с совпадающим адресом — уже реальная потеря денег.
  const nodeId = await rpc.chainId().catch(() => 0);
  if (nodeId !== input.chainId) throw new BroadcastError('chain_id_mismatch');

  const gas = await payoutGas(rpc, input.owner, input.maxGasPriceWei ?? DEFAULT_MAX_GAS_PRICE_WEI);
  const tx = buildPayoutTx({
    chainId: input.chainId,
    nonce: input.nonce ?? gas.nonce,
    contract: input.contract,
    recipient: input.recipient,
    amountMicro: input.amountMicro,
    maxFeePerGas: gas.maxFeePerGas,
    maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
  });
  const signer_ = await signer.signEvm({
    tx: {
      chainId: tx.chainId,
      nonce: tx.nonce,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
      maxFeePerGas: tx.maxFeePerGas.toString(),
      gasLimit: tx.gasLimit.toString(),
      to: tx.to,
      value: '0',
      data: tx.data,
    },
    signingHash: signingHash(tx),
    // `contract` не отправляем: allowlist у Signer свой (`SIGNER_EVM_CONTRACT`),
    // и если он разойдётся с `PAY_EVM_CONTRACT`, подпись не выдаётся.
    recipient: input.recipient,
    amountMicro: input.amountMicro,
  });

  // «Ключ не от того кошелька» — самый дорогой из тихих багов: транзакция ушла бы
  // с пустого адреса, а заявка повисла бы в `broadcasting`.
  if (signer_.from && signer_.from.toLowerCase() !== input.owner.toLowerCase()) {
    throw new BroadcastError('hot_address_mismatch');
  }

  let raw: string;
  try {
    raw = applySignature(tx, signer_.signature);
  } catch (e) {
    if (e instanceof TxError) throw new BroadcastError(`bad_signature:${e.message}`);
    throw e;
  }

  const txid = await rpc.sendRawTransaction(raw);
  // Хеш подписанной транзакции = то, чем её зовут в сети. Сверяем с ответом ноды:
  // несовпадение значит, что нода приняла не то, что мы собрали.
  const computed = bytesToHex(keccak256(hexToBytes(raw.slice(2))));
  if (computed !== txid.toLowerCase()) throw new BroadcastError('tx_hash_mismatch');

  return {
    txid,
    signature: signer_.signature,
    raw,
    nonce: gas.nonce,
    maxCostWei: tx.gasLimit * tx.maxFeePerGas,
  };
}

/** JSON-RPC клиент активной BSC-сети. Ошибку даёт явную: без URL платить нельзя. */
export function evmRpcFor(env: Env, fetchImpl: typeof fetch = fetch): EvmRpc {
  const spec = chainSpec(env, payFlags(env));
  if (spec.chain !== 'bsc') throw new BroadcastError('chain_not_evm');
  if (!spec.apiBase) throw new BroadcastError('rpc_missing');
  return createEvmRpc({ url: spec.apiBase, fetchImpl, timeoutMs: 10_000 });
}

/** Настоящий клиент Signer-контура через service binding. */
export function evmSignerClient(env: Env): EvmSignerClient {
  return {
    async signEvm(request) {
      const token = String(env.SIGNER_TOKEN ?? '');
      if (!env.SIGNER || !token) throw new BroadcastError('signer_not_configured');
      const res = await env.SIGNER.fetch('https://signer/sign/evm', {
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
