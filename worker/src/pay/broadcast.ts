// Отправка USDT TRC-20: собрать транзакцию → подписать в Signer → отправить в сеть.
//
// Собирает и отправляет основной Worker, но подписать сам не может: он не знает
// ключа. Signer проверяет дайджест, адрес получателя и сумму и возвращает
// подпись; только после этого транзакция уходит в TronGrid.
//
// Сеть и подписант передаются аргументами: в тестах это подделки, в бою —
// настоящий TronGrid и service binding. Никаких ключей в этом файле нет.

import { addressToHex } from './tron/address';
import { usdtContract } from './tron/contracts';
import type { Env } from '../env';
import type { PayNetwork } from './flags';

export const DEFAULT_FEE_LIMIT_SUN = 30_000_000; // 30 TRX — с запасом на энергию
export const DEFAULT_API = 'https://api.trongrid.io';

export interface TronTransport {
  fetchJson: (url: string, init?: { method?: string; body?: string }) => Promise<unknown>;
  apiBase?: string;
}

export interface SignerClient {
  sign(input: { rawDataHex: string; txID: string; to: string; amountMicro: number }): Promise<{ signature: string }>;
}

export class BroadcastError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
  }
}

function pad64(hex: string): string {
  return hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/** Параметр вызова `transfer(address,uint256)`: получатель и сумма, по 32 байта. */
export function transferParameter(to: string, amountMicro: number): string {
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) throw new BroadcastError('bad_amount');
  return pad64(addressToHex(to).slice(2)) + pad64(amountMicro.toString(16));
}

/** Полный `data` вызова: селектор `a9059cbb` + параметры. */
export function transferDataHex(to: string, amountMicro: number): string {
  return `a9059cbb${transferParameter(to, amountMicro)}`;
}

export interface UnsignedTransfer {
  txID: string;
  rawDataHex: string;
  transaction: Record<string, unknown>;
}

/**
 * Попросить TronGrid собрать транзакцию вызова контракта.
 * `fee_limit` ограничивает сжигание TRX: без него ошибка в контракте может
 * стоить дороже перевода.
 */
export async function createUnsignedTransfer(
  transport: TronTransport,
  input: { owner: string; to: string; amountMicro: number; contract: string; feeLimitSun?: number },
): Promise<UnsignedTransfer> {
  const base = transport.apiBase ?? DEFAULT_API;
  const payload = {
    owner_address: input.owner,
    contract_address: input.contract,
    function_selector: 'transfer(address,uint256)',
    parameter: transferParameter(input.to, input.amountMicro),
    fee_limit: input.feeLimitSun ?? DEFAULT_FEE_LIMIT_SUN,
    call_value: 0,
    visible: true,
  };

  const res = await transport.fetchJson(`${base}/wallet/triggersmartcontract`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as {
    result?: { result?: boolean; message?: string };
    transaction?: { txID?: string; raw_data_hex?: string };
  };

  if (res?.result && res.result.result === false) throw new BroadcastError('create_rejected');
  const txID = res?.transaction?.txID;
  const rawDataHex = res?.transaction?.raw_data_hex;
  if (!txID || !rawDataHex) throw new BroadcastError('create_no_transaction');
  if (!/^[0-9a-f]{64}$/i.test(txID)) throw new BroadcastError('bad_tx_id');

  return { txID: txID.toLowerCase(), rawDataHex: String(rawDataHex).toLowerCase(), transaction: { ...res.transaction } };
}

export interface SendResult {
  txid: string;
  signature: string;
}

/**
 * Полный путь выплаты: собрать → подписать → отправить.
 *
 * Идемпотентности здесь нет и быть не может: сеть — не база. Повторную отправку
 * запрещает автомат состояний заявки (`reserved` → `broadcasting` один раз), а
 * `txid` уникален в `pay_withdrawals`.
 */
export async function sendUsdt(
  transport: TronTransport,
  signer: SignerClient,
  input: { owner: string; to: string; amountMicro: number; contract: string; feeLimitSun?: number },
): Promise<SendResult> {
  const unsigned = await createUnsignedTransfer(transport, input);
  const signed = await signer.sign({
    rawDataHex: unsigned.rawDataHex,
    txID: unsigned.txID,
    to: input.to,
    amountMicro: input.amountMicro,
  });

  const base = transport.apiBase ?? DEFAULT_API;
  const res = await transport.fetchJson(`${base}/wallet/broadcasttransaction`, {
    method: 'POST',
    body: JSON.stringify({ ...unsigned.transaction, signature: [signed.signature] }),
  }) as { result?: boolean; txid?: string; code?: string; message?: string };

  if (res?.result !== true) {
    throw new BroadcastError(`broadcast_rejected:${res?.code ?? 'unknown'}`);
  }
  const txid = String(res.txid ?? unsigned.txID).toLowerCase();
  return { txid, signature: signed.signature };
}

/** Настоящий TronGrid с ключом из секретов Worker. */
export function trongridTransport(env: Env, fetchImpl: typeof fetch = fetch): TronTransport {
  return {
    fetchJson: async (url: string, init?: { method?: string; body?: string }) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (env.TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = env.TRONGRID_API_KEY;
      const res = await fetchImpl(url, { method: init?.method ?? 'GET', headers, body: init?.body });
      if (!res.ok) throw new BroadcastError(`http_${res.status}`);
      return await res.json();
    },
  };
}

/** Клиент Signer-контура через service binding. */
export function signerClient(env: Env): SignerClient {
  return {
    async sign(input) {
      const token = String(env.SIGNER_TOKEN ?? '');
      if (!env.SIGNER || !token) throw new BroadcastError('signer_not_configured');
      const res = await env.SIGNER.fetch('https://signer/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new BroadcastError(`signer_${res.status}`);
      const data = await res.json() as { signature?: string };
      if (!data.signature) throw new BroadcastError('signer_no_signature');
      return { signature: data.signature };
    },
  };
}

export function contractFor(env: Env, network: PayNetwork): string {
  return usdtContract(env, network);
}
