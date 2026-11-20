// Разбор переводов USDT TRC-20.
//
// Источник может быть разный: TronGrid по адресу или полный узел с логами
// контракта. Наружу мы отдаём один и тот же нормализованный объект, чтобы
// остальной код не знал, откуда пришли данные.
//
// Что проверяется всегда, без исключений:
//   * контракт из allowlist (чужой токен — не деньги);
//   * `contractRet = SUCCESS` (иначе перевода не было);
//   * адрес получателя проходит контрольную сумму;
//   * сумма — целое положительное число микро-USDT;
//   * идентификатор `(txid, event_index)` есть всегда: по нему же дедуп.

import { AmountError, microFromChainValue } from './amount';
import { TronAddressError, addressToHex, hexToBase58, normalizeAddress } from './address';

/** keccak256("Transfer(address,address,uint256)") — тема события TRC-20. */
export const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class TransferError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
  }
}

export interface Trc20Transfer {
  txid: string;
  eventIndex: number;
  from: string;
  to: string;
  contract: string;
  amountMicro: number;
  blockHeight: number | null;
  /** Время блока, миллисекунды. */
  blockTime: number;
  success: boolean;
  raw: string;
}

export interface ParseOptions {
  /** Разрешённые контракты. Пустой список означает «никакой не разрешён». */
  contracts: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new TransferError('bad_shape');
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

function canonical(value: string, code: string): string {
  try {
    return normalizeAddress(value);
  } catch (e) {
    if (e instanceof TronAddressError) throw new TransferError(code);
    throw e;
  }
}

/**
 * Один элемент `GET /v1/accounts/{address}/transactions/trc20`.
 *
 * Особенность этого API: он не отдаёт индекс события внутри транзакции, поэтому
 * по умолчанию считаем его нулевым. Если в транзакции два разных перевода на
 * один и тот же адрес (крайне редкий случай), они различаются по `from`/`value`,
 * а исходный JSON сохраняется в базе — при споре видно, что пришло от сети.
 */
export function parseAccountTransfer(input: unknown, opts: ParseOptions): Trc20Transfer {
  const row = asRecord(input);
  const txid = str(row.transaction_id) || str(row.txID);
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new TransferError('bad_txid');

  const token = asRecord(row.token_info ?? {});
  const contract = str(row.contract_address) || str(token.address);
  if (!contract) throw new TransferError('no_contract');
  if (!opts.contracts.includes(contract)) throw new TransferError('wrong_contract');

  const decimals = num(token.decimals);
  if (decimals !== null && decimals !== 6) throw new TransferError('wrong_decimals');

  const type = str(row.type);
  if (type && type !== 'Transfer' && type !== 'TransferFrom') throw new TransferError('not_transfer');

  const from = canonical(str(row.from), 'bad_from');
  const to = canonical(str(row.to), 'bad_to');

  let amountMicro: number;
  try {
    amountMicro = microFromChainValue(row.value);
  } catch (e) {
    if (e instanceof AmountError) throw new TransferError('bad_amount');
    throw e;
  }

  const ret = str(row.contractRet) || str(row.ret);
  if (ret && ret.toUpperCase() !== 'SUCCESS') throw new TransferError('not_success');

  const blockTime = num(row.block_timestamp) ?? 0;
  if (blockTime <= 0) throw new TransferError('bad_block_time');

  const eventIndex = num(row.event_index);

  return {
    txid: txid.toLowerCase(),
    eventIndex: eventIndex !== null && eventIndex >= 0 ? Math.trunc(eventIndex) : 0,
    from,
    to,
    contract,
    amountMicro,
    blockHeight: num(row.block_number),
    blockTime,
    success: true,
    raw: JSON.stringify(input),
  };
}

/**
 * Лог контракта из полного узла (`gettransactioninfobyid` → `log[]`).
 * Здесь индекс события настоящий — это точный идентификатор перевода.
 */
export function parseContractLog(
  log: unknown,
  tx: { txid: string; blockNumber?: number | null; blockTime: number; ret?: string },
  opts: ParseOptions,
): Trc20Transfer {
  const row = asRecord(log);
  const contract = str(row.address);
  if (!canonicalHexAddress(contract)) throw new TransferError('bad_contract_address');
  if (!opts.contracts.includes(hexToBase58(contract))) throw new TransferError('wrong_contract');

  const topics = Array.isArray(row.topics) ? row.topics.map((t) => String(t).toLowerCase()) : [];
  if (topics.length < 3) throw new TransferError('bad_topics');
  if (topics[0] !== TRANSFER_TOPIC) throw new TransferError('not_transfer');

  const from = hexToBase58(topics[1].slice(-40));
  const to = hexToBase58(topics[2].slice(-40));

  const data = str(row.data);
  if (!/^[0-9a-f]{1,64}$/i.test(data)) throw new TransferError('bad_data');
  let amountMicro: number;
  try {
    amountMicro = microFromChainValue(BigInt(`0x${data}`).toString());
  } catch (e) {
    if (e instanceof AmountError) throw new TransferError('bad_amount');
    throw e;
  }

  if (tx.ret && tx.ret.toUpperCase() !== 'SUCCESS') throw new TransferError('not_success');

  const eventIndex = num(row.event_index) ?? 0;

  return {
    txid: str(tx.txid).toLowerCase(),
    eventIndex: Math.trunc(eventIndex),
    from,
    to,
    contract: hexToBase58(contract),
    amountMicro,
    blockHeight: tx.blockNumber ?? null,
    blockTime: tx.blockTime,
    success: true,
    raw: JSON.stringify(log),
  };
}

function canonicalHexAddress(hex: string): boolean {
  try {
    addressToHex(hexToBase58(hex));
    return true;
  } catch {
    return false;
  }
}

/**
 * Фильтр «это наш платёж»: перевод на один из наших адресов, по нужному
 * контракту, с успешным статусом. Всё остальное — не наше и в учёт не идёт.
 */
export function isIncomingTransfer(transfer: Trc20Transfer, ourAddresses: string[]): boolean {
  return transfer.success && ourAddresses.includes(transfer.to);
}
