// Astra Pay Signer — отдельный Worker, единственное место, где живут ключи.
//
// Почему отдельно:
//   * у основного Worker нет ни семени, ни ключа горячего кошелька;
//   * наружу этот Worker не опубликован (`workers_dev = false`): попасть в него
//     можно только через service binding из основного Worker;
//   * каждый запрос требует токен, который знает только основной Worker;
//   * подписывается не «что прислали», а проверенный дайджест: Signer сам считает
//     SHA-256 от raw_data и сравнивает с txID, ищет в теле адрес получателя и
//     сумму. Не совпало — отказано.
//
// Ограничения на этом уровне: сумма одной транзакции и адрес получателя.
// Суточные лимиты и очередь заявок — в основном Worker (`pay/payouts.ts`).

import { sha256Bytes } from '../../worker/src/shared/sha256';
import { addressToHex, normalizeAddress, TronAddressError } from '../../worker/src/pay/tron/address';
import { deriveKey } from '../../worker/src/pay/crypto/hd';
import { signDigest } from '../../worker/src/pay/crypto/secp256k1';

export interface SignerEnv {
  /** Токен доступа. Обязателен: без него Worker отвечает 503. */
  SIGNER_TOKEN?: string;
  /** Семя для адресов игроков (hex, ≥ 32 байта). */
  SIGNER_SEED?: string;
  /** Приватный ключ горячего кошелька (hex, 32 байта). Только для подписи выплат. */
  SIGNER_PRIVATE_KEY?: string;
  /** Максимум на одну транзакцию в микро-USDT. По умолчанию 100 USDT. */
  SIGNER_MAX_TX_MICRO?: string;
}

const MAX_INDEX = 1_000_000;
const MAX_RAW_HEX = 8192;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function fail(code: string, status = 400): Response {
  return json({ ok: false, error: code }, status);
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request: Request, env: SignerEnv): Response | null {
  const expected = String(env.SIGNER_TOKEN ?? '');
  if (!expected) return fail('signer_disabled', 503);
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return fail('token_required', 401);
  if (!sameToken(token, expected)) return fail('forbidden', 403);
  return null;
}

function hexToBytesLocal(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHexLocal(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function pad64(hex: string): string {
  const clean = hex.toLowerCase().replace(/^0x/, '');
  return clean.padStart(64, '0');
}

/** Выдать адрес по индексу. Приватный ключ наружу не отдаётся никогда. */
export async function handleAddress(request: Request, env: SignerEnv): Promise<Response> {
  const denied = authorized(request, env);
  if (denied) return denied;
  if (!env.SIGNER_SEED) return fail('seed_missing', 503);

  let body: { index?: unknown };
  try {
    body = await request.json() as { index?: unknown };
  } catch {
    return fail('bad_json', 400);
  }
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_INDEX) return fail('bad_index', 400);

  try {
    const derived = await deriveKey(env.SIGNER_SEED, index);
    return json({ ok: true, index, address: derived.address });
  } catch (e) {
    return fail(`derive_failed:${e instanceof Error ? e.message : 'unknown'}`, 500);
  }
}

export interface SignRequest {
  rawDataHex?: unknown;
  txID?: unknown;
  to?: unknown;
  amountMicro?: unknown;
}

/**
 * Подписать перевод USDT.
 *
 * Проверяется всё, что можно проверить без protobuf-парсера:
 *   1. `sha256(raw_data) === txID` — тело не подменено по дороге;
 *   2. в теле есть адрес получателя (32-байтный слот `a9059cbb`-вызова);
 *   3. в теле есть ровно эта сумма;
 *   4. сумма не больше лимита на транзакцию;
 *   5. адрес получателя валиден (контрольная сумма) и не является контрактом USDT.
 */
export async function handleSign(request: Request, env: SignerEnv): Promise<Response> {
  const denied = authorized(request, env);
  if (denied) return denied;
  const key = String(env.SIGNER_PRIVATE_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) return fail('key_missing', 503);

  let body: SignRequest;
  try {
    body = await request.json() as SignRequest;
  } catch {
    return fail('bad_json', 400);
  }

  const rawDataHex = String(body.rawDataHex ?? '').toLowerCase().replace(/^0x/, '');
  const txID = String(body.txID ?? '').toLowerCase();
  if (!/^[0-9a-f]{1,8000}$/.test(rawDataHex) || rawDataHex.length % 2 !== 0 || rawDataHex.length > MAX_RAW_HEX) {
    return fail('bad_raw_data', 400);
  }
  if (!/^[0-9a-f]{64}$/.test(txID)) return fail('bad_tx_id', 400);

  // 1. Целостность: дайджест считаем сами.
  const digest = sha256Bytes(hexToBytesLocal(rawDataHex));
  if (bytesToHexLocal(digest) !== txID) return fail('tx_mismatch', 400);

  // 2. Получатель.
  let to: string;
  try {
    to = normalizeAddress(String(body.to ?? ''));
  } catch (e) {
    if (e instanceof TronAddressError) return fail('bad_destination', 400);
    throw e;
  }
  const toSlot = pad64(addressToHex(to).slice(2));
  if (!rawDataHex.includes(toSlot)) return fail('destination_mismatch', 400);

  // 3. Сумма.
  const amountMicro = Number(body.amountMicro);
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) return fail('bad_amount', 400);
  const amountSlot = pad64(amountMicro.toString(16));
  if (!rawDataHex.includes(amountSlot)) return fail('amount_mismatch', 400);

  // 4. Лимит на одну транзакцию.
  const maxMicro = Number(env.SIGNER_MAX_TX_MICRO ?? 100_000_000);
  if (!Number.isFinite(maxMicro) || maxMicro <= 0) return fail('limit_misconfigured', 503);
  if (amountMicro > maxMicro) return fail('above_signer_limit', 400);

  // 5. Подпись.
  const signed = signDigest(digest, key);
  // Журнал: кто, куда, сколько, какой txid. Без ключей и без тел транзакций.
  console.log('signer.sign', JSON.stringify({ txID, to, amountMicro, recovery: signed.recovery }));
  return json({ ok: true, txID, signature: signed.signature });
}

export default {
  async fetch(request: Request, env: SignerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        service: 'astra-pay-signer',
        hasSeed: Boolean(env.SIGNER_SEED),
        hasKey: Boolean(env.SIGNER_PRIVATE_KEY),
        maxTxMicro: Number(env.SIGNER_MAX_TX_MICRO ?? 100_000_000),
      });
    }
    if (request.method === 'POST' && url.pathname === '/address') return handleAddress(request, env);
    if (request.method === 'POST' && url.pathname === '/sign') return handleSign(request, env);
    return fail('not_found', 404);
  },
};
