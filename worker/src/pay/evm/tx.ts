// RLP и транзакция EIP-1559 — то, чем платят в BNB Chain.
//
// Зачем это нам самим, а не библиотекой: Signer обязан **проверить** то, что
// ему прислали, прежде чем поставить подпись. Значит у нас должен быть
// независимый декодер транзакции, и он же заодно кодирует. Один код на оба
// конца — меньше шансов разойтись, а расхождение здесь = подпись чужой
// транзакции.
//
// Правила, без которых нельзя:
//   * RLP — каноничный: ведущие нули в числах запрещены, иначе одна и та же
//     транзакция кодируется двумя способами и хеш перестаёт быть «именем»;
//   * подпись ставится на keccak256 от `0x02 || rlp(поля без подписи)`, и
//     `chainId` входит в хеш — иначе транзакцию можно сыграть повтором в
//     другой EVM-сети (replay attack);
//   * `to` — контракт USDT, а не адрес игрока: игрок получает деньги переводом
//     токена, а не нативной монетой.

import { keccak256 } from '../crypto/keccak';
import { bytesToHex, hexToBytes } from '../crypto/hmac';

export class TxError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'TxError';
    this.code = code;
  }
}

/** Тип транзакции EIP-1559: байт `0x02` перед RLP-списком. */
export const TX_TYPE_EIP1559 = '02';

/** Селектор `transfer(address,uint256)` — одинаковый во всех ERC-20/BEP-20. */
export const TRANSFER_SELECTOR = 'a9059cbb';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function bytes(value: Uint8Array | string | number | bigint): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    let hex = BigInt(value).toString(16);
    if (hex === '0') return new Uint8Array(0);
    if (hex.length % 2) hex = `0${hex}`;
    return hexToBytes(hex);
  }
  return hexToBytes(value.startsWith('0x') ? value.slice(2) : value);
}

function encodeLength(len: number, offset: number): Uint8Array {
  if (len <= 55) return new Uint8Array([offset + len]);
  const hex = len.toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  const size = hexToBytes(padded);
  return new Uint8Array([offset + 55 + size.length, ...size]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type RlpInput = Uint8Array | string | number | bigint | RlpInput[];

/**
 * RLP-кодирование. Числа кодируются без ведущих нулей — это часть канона.
 */
export function rlpEncode(input: RlpInput): Uint8Array {
  if (Array.isArray(input)) {
    const payload = input.map((item) => rlpEncode(item));
    return concat(encodeLength(payload.reduce((sum, p) => sum + p.length, 0), 0xc0), ...payload);
  }
  const body = bytes(input);
  if (body.length === 1 && body[0] <= 0x7f) return body;
  return concat(encodeLength(body.length, 0x80), body);
}

/** Разбор: возвращает элемент и смещение следующего. */
function rlpDecodeAt(data: Uint8Array, at: number): { value: Uint8Array | Uint8Array[]; next: number } {
  const prefix = data[at];
  if (prefix === undefined) throw new TxError('rlp_truncated');
  if (prefix < 0x80) return { value: data.slice(at, at + 1), next: at + 1 };
  if (prefix < 0xb8) return slice(data, at + 1, prefix - 0x80, at + 1 + prefix - 0x80);
  if (prefix < 0xc0) {
    const lenSize = prefix - 0xb7;
    const len = readInt(data.slice(at + 1, at + 1 + lenSize));
    const start = at + 1 + lenSize;
    return slice(data, start, len, start + len);
  }
  if (prefix < 0xf8) {
    const len = prefix - 0xc0;
    const list = decodeList(data, at + 1, len);
    return { value: list, next: at + 1 + len };
  }
  const lenSize = prefix - 0xf7;
  const len = readInt(data.slice(at + 1, at + 1 + lenSize));
  const start = at + 1 + lenSize;
  const list = decodeList(data, start, len);
  return { value: list, next: start + len };
}

function slice(data: Uint8Array, start: number, len: number, next: number) {
  if (len < 0 || start + len > data.length) throw new TxError('rlp_truncated');
  return { value: data.slice(start, start + len), next };
}

function decodeList(data: Uint8Array, start: number, len: number): Uint8Array[] {
  const end = start + len;
  if (end > data.length) throw new TxError('rlp_truncated');
  const out: Uint8Array[] = [];
  let at = start;
  while (at < end) {
    const item = rlpDecodeAt(data, at);
    if (item.next > end) throw new TxError('rlp_bad_list');
    out.push(item.value as Uint8Array);
    at = item.next;
  }
  if (at !== end) throw new TxError('rlp_bad_list');
  return out;
}

function readInt(data: Uint8Array): number {
  if (data.length > 6) throw new TxError('rlp_number_too_big');
  let value = 0;
  for (const byte of data) value = value * 256 + byte;
  return value;
}

function toBigInt(value: Uint8Array): bigint {
  if (!value.length) return 0n;
  // Канон: ведущие нули в кодировке числа недопустимы.
  if (value[0] === 0) throw new TxError('rlp_not_canonical');
  return BigInt(`0x${bytesToHex(value)}`);
}

function toHex(value: Uint8Array): string {
  return `0x${bytesToHex(value)}`;
}

function strip0x(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function pad64(hex: string): string {
  const clean = strip0x(hex).toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean)) throw new TxError('bad_hex');
  return clean.padStart(64, '0');
}

/** `transfer(address,uint256)` для суммы в already-scaled единицах сети. */
export function transferCalldata(to: string, amountRaw: bigint): string {
  if (!ADDRESS_RE.test(to)) throw new TxError('bad_address');
  if (amountRaw <= 0n) throw new TxError('bad_amount');
  return `0x${TRANSFER_SELECTOR}${pad64(strip0x(to))}${pad64(amountRaw.toString(16))}`;
}

/** Разобрать `transfer(address,uint256)` → получатель и сумма сети. */
export function parseTransferCalldata(data: string): { to: string; amountRaw: bigint } {
  const clean = strip0x(data).toLowerCase();
  if (!clean.startsWith(TRANSFER_SELECTOR)) throw new TxError('not_transfer_call');
  const body = clean.slice(TRANSFER_SELECTOR.length);
  if (body.length !== 128) throw new TxError('bad_calldata_length');
  const toSlot = body.slice(0, 64);
  if (toSlot.slice(0, 24) !== '0'.repeat(24)) throw new TxError('bad_recipient_slot');
  return { to: `0x${toSlot.slice(24)}`, amountRaw: BigInt(`0x${body.slice(64)}`) };
}

export interface EvmTxFields {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;
  value: bigint;
  data: string;
  /** Access list — у нас всегда пустой, но поле входит в хеш. */
  accessList?: never[];
}

export interface SignedEvmTx extends EvmTxFields {
  yParity: number;
  r: bigint;
  s: bigint;
}

function fieldList(tx: EvmTxFields): RlpInput[] {
  return [
    tx.chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    tx.to,
    tx.value,
    tx.data || '0x',
    tx.accessList ?? [],
  ];
}

function assertTx(tx: EvmTxFields): void {
  if (!Number.isInteger(tx.chainId) || tx.chainId <= 0) throw new TxError('bad_chain_id');
  if (!Number.isInteger(tx.nonce) || tx.nonce < 0) throw new TxError('bad_nonce');
  if (tx.maxFeePerGas <= 0n) throw new TxError('bad_max_fee');
  if (tx.maxPriorityFeePerGas < 0n) throw new TxError('bad_priority_fee');
  if (tx.maxPriorityFeePerGas > tx.maxFeePerGas) throw new TxError('priority_above_max_fee');
  if (tx.gasLimit <= 0n || tx.gasLimit > 30_000_000n) throw new TxError('bad_gas_limit');
  if (!ADDRESS_RE.test(tx.to)) throw new TxError('bad_to');
  if (tx.value < 0n) throw new TxError('bad_value');
  if (!/^0x[0-9a-fA-F]*$/.test(tx.data || '0x')) throw new TxError('bad_data');
}

/** Тело для подписи: `0x02 || rlp(поля без подписи)`. */
export function signingPayload(tx: EvmTxFields): Uint8Array {
  assertTx(tx);
  return concat(new Uint8Array([parseInt(TX_TYPE_EIP1559, 16)]), rlpEncode(fieldList(tx)));
}

/** Хеш, который подписывает Signer. */
export function signingHash(tx: EvmTxFields): string {
  return `0x${bytesToHex(keccak256(signingPayload(tx)))}`;
}

/** Готовая транзакция: те же поля + `yParity`, `r`, `s`. */
export function encodeSignedTx(tx: SignedEvmTx): string {
  assertTx(tx);
  if (tx.yParity !== 0 && tx.yParity !== 1) throw new TxError('bad_y_parity');
  if (tx.r <= 0n || tx.s <= 0n) throw new TxError('bad_signature');
  const body = [...fieldList(tx), tx.yParity === 0 ? 0 : 1, tx.r, tx.s];
  return `0x${TX_TYPE_EIP1559}${bytesToHex(rlpEncode(body))}`;
}

/**
 * Разбор подписанной транзакции. Нужен Signer'у: он обязан подписывать то, что
 * реально уйдёт в сеть, а не «то, что описали словами в JSON».
 */
export function decodeSignedTx(raw: string): SignedEvmTx {
  const clean = strip0x(raw.trim().toLowerCase());
  if (clean.length % 2) throw new TxError('bad_raw_length');
  if (!clean.startsWith(TX_TYPE_EIP1559)) throw new TxError('unsupported_tx_type');
  const decoded = rlpDecodeAt(hexToBytes(clean.slice(2)), 0);
  const list = decoded.value as Uint8Array[];
  if (list.length !== 12) throw new TxError('bad_tx_fields');
  const to = toHex(list[5]);
  if (!/^0x[0-9a-f]{40}$/.test(to)) throw new TxError('bad_to');
  return {
    chainId: Number(toBigInt(list[0])),
    nonce: Number(toBigInt(list[1])),
    maxPriorityFeePerGas: toBigInt(list[2]),
    maxFeePerGas: toBigInt(list[3]),
    gasLimit: toBigInt(list[4]),
    to,
    value: toBigInt(list[6]),
    data: toHex(list[7]),
    yParity: Number(toBigInt(list[9])),
    r: toBigInt(list[10]),
    s: toBigInt(list[11]),
  };
}

/** Подставить подпись в проверенное тело. Поля берутся из декодированной транзакции. */
export function applySignature(tx: EvmTxFields, signatureHex: string): string {
  const clean = strip0x(signatureHex).toLowerCase();
  if (!/^[0-9a-f]{130}$/.test(clean)) throw new TxError('bad_signature_length');
  const r = BigInt(`0x${clean.slice(0, 64)}`);
  const s = BigInt(`0x${clean.slice(64, 128)}`);
  const v = Number(BigInt(`0x${clean.slice(128, 130)}`));
  // Signer отдаёт `v = 27 + recovery` (формат TRON и EIP-155), а в EIP-1559
  // нужен `yParity` 0/1. Не свести их — сеть отвергнёт транзакцию.
  const yParity = v >= 27 ? v - 27 : v;
  if (yParity !== 0 && yParity !== 1) throw new TxError('bad_y_parity');
  return encodeSignedTx({ ...tx, yParity, r, s });
}

export { toHex };
