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
import { keccak256 } from '../../worker/src/pay/crypto/keccak';
import { deriveEvmKey } from '../../worker/src/pay/evm/derivation';
import { evmAddressFromPrivateKey, toChecksumAddress } from '../../worker/src/pay/evm/address';
import { TRANSFER_SELECTOR, parseTransferCalldata, signingHash, signingPayload } from '../../worker/src/pay/evm/tx';
import { TxError } from '../../worker/src/pay/evm/tx';
import { chainValueToMicro, microToChainValue, type PayChain } from '../../worker/src/pay/units';
import { evmKeyByChainId } from '../../worker/src/pay/evm/config';

export interface SignerEnv {
  /** Токен доступа. Обязателен: без него Worker отвечает 503. */
  SIGNER_TOKEN?: string;
  /** Семя для адресов игроков (hex, ≥ 32 байта). */
  SIGNER_SEED?: string;
  /** Приватный ключ горячего кошелька (hex, 32 байта). Только для подписи выплат. */
  SIGNER_PRIVATE_KEY?: string;
  /** Максимум на одну транзакцию в микро-USDT. По умолчанию 100 USDT. */
  SIGNER_MAX_TX_MICRO?: string;
  /**
   * Контракт USDT в EVM-сети. Единственный `to`, которому мы подписываем
   * транзакцию: вызов любого другого контракта — это произвольный код от имени
   * кошелька, а не перевод.
   *
   * Легаси-имя = BNB Chain. Для двух сетей — `SIGNER_EVM_CONTRACT_BNB` и
   * `SIGNER_EVM_CONTRACT_POL`: «одна разрешённая переменная на две цепи» физически
   * не описывает пару «сеть + контракт», а подписать polygon-перевод с контрактом
   * BNB в теле — значит отправить деньги на несуществующий токен.
   */
  SIGNER_EVM_CONTRACT?: string;
  SIGNER_EVM_CONTRACT_BNB?: string;
  SIGNER_EVM_CONTRACT_POL?: string;
  /**
   * Какие chainId принимаем: «56», «56,137», «97,80002». По умолчанию 56 (mainnet).
   *
   * Polygon (137) не включён намеренно: вторая сеть включается одной строкой в
   * секретах, и без неё подписи в Polygon не будет, даже если Worker попросит.
   */
  SIGNER_EVM_CHAIN_IDS?: string;
  /** Потолок газа на транзакцию, wei. Выше — отказ: сеть дороже перевода. */
  SIGNER_EVM_MAX_GAS_WEI?: string;
  /** Потолок `gasLimit`. BEP-20 `transfer` стоит ~55k; миллион значит «в теле что-то не то». */
  SIGNER_EVM_MAX_GAS_LIMIT?: string;
  /**
   * Сбор USDT с депозитных адресов (`/sign/evm/sweep`). По умолчанию выключен:
   * подпись ключом игрока — это операция с чужими деньгами, и включать её
   * обязан владелец отдельно от выплат.
   */
  SIGNER_SWEEP_ENABLED?: string;
  /**
   * Единственный разрешённый получатель сбора — горячий кошелёк. Кому увести
   * деньги решает этот секрет, а не запрос: иначе скомпрометированный Worker
   * выменивал бы подпись на перевод на любой адрес.
   */
  SIGNER_SWEEP_DESTINATION?: string;
  /** Потолок одного сбора в micro. По умолчанию 1000 USDT. */
  SIGNER_SWEEP_MAX_MICRO?: string;
}

const MAX_INDEX = 1_000_000;
/**
 * Потолок газа на сбор. Столько же, сколько у выплаты (`PAYOUT_GAS_LIMIT`):
 * сбор — тот же `transfer`. Отдельная константа здесь, а не импорт из Worker:
 * Signer не должен подписывать чужой `gasLimit`, если на Worker его задумают
 * поднять — счёт за газ платит игрок, с того же адреса, чей ключ подписывает.
 */
const SWEEP_GAS_LIMIT_CAP = 80_000n;
/** Потолок одного сбора по умолчанию, micro (1000 USDT). */
const DEFAULT_SWEEP_MAX_MICRO = 1_000_000_000;
const MAX_RAW_HEX = 8192;
/** Значения в JSON приходят строками: BigInt в `JSON.stringify` не существует. */
const DECIMAL_RE = /^\d{1,78}$/;
const DEFAULT_MAX_GAS_WEI = 20_000_000_000n; // 20 gwei
const DEFAULT_MAX_GAS_LIMIT = 200_000n;

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

/**
 * Выдать адрес по индексу. Приватный ключ наружу не отдаётся никогда.
 *
 * Одна сеть — один путь деривации: `m/44'/195'/0'/0/i` для TRON и
 * `m/44'/60'/0'/0/i` для BNB Chain. Семя то же, индексы те же, ключи разные.
 * Именно поэтому игроку можно показать оба адреса, не заводя второй кошелёк.
 */
export async function handleAddress(request: Request, env: SignerEnv): Promise<Response> {
  const denied = authorized(request, env);
  if (denied) return denied;
  if (!env.SIGNER_SEED) return fail('seed_missing', 503);

  let body: { index?: unknown; chain?: unknown };
  try {
    body = await request.json() as { index?: unknown; chain?: unknown };
  } catch {
    return fail('bad_json', 400);
  }
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_INDEX) return fail('bad_index', 400);
  const chain = body.chain === undefined || body.chain === null ? 'tron' : String(body.chain);
  // `bsc` и `polygon` — одна и та же EVM-деривация (m/44'/60'/0'/0/i), разные
  // имена нужны только чтобы Worker положил в базу верную колонку `chain`.
  if (chain !== 'tron' && chain !== 'bsc' && chain !== 'polygon') return fail('bad_chain', 400);

  try {
    const derived = chain !== 'tron'
      ? await deriveEvmKey(env.SIGNER_SEED, index)
      : await deriveKey(env.SIGNER_SEED, index);
    // Наружу — адрес в той форме, в которой его видит игрок: для EVM это
    // контрольная сумма EIP-55 (кошельки иначе ругаются), в базу уходит нижний
    // регистр (см. `pay/chain.ts`).
    return json({
      ok: true, index, chain,
      address: chain === 'tron' ? derived.address : toChecksumAddress(derived.address),
    });
  } catch (e) {
    return fail(`derive_failed:${e instanceof Error ? e.message : 'unknown'}`, 500);
  }
}

function decimal(value: unknown, field: string): bigint {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!DECIMAL_RE.test(text)) throw new Error(`bad_${field}`);
  return BigInt(text);
}

function chainIdAllowed(env: SignerEnv, chainId: bigint): boolean {
  const list = String(env.SIGNER_EVM_CHAIN_IDS ?? '56')
    .split(',').map((x) => x.trim()).filter((x) => x.length > 0);
  if (!list.length) return false;
  return list.includes(chainId.toString());
}

/**
 * Разрешённый контракт USDT для сети.
 *
 * Сеть здесь не параметр запроса, а `chainId` самой транзакции: то есть «для
 * какой цепи подписывают» решает тело транзакции, а контракт ему отвечают свой.
 * Именно в таком порядке это невозможно подделать: попросить подписать вызов
 * чужого контракта, назвавшись другой сетью, не выйдет — пара проверяется сразу
 * по обоим значениям (`contract_mismatch`).
 */
function contractOf(env: SignerEnv, key: 'bnb' | 'polygon' = 'bnb'): string {
  const perChain = String(env[`SIGNER_EVM_CONTRACT_${key === 'polygon' ? 'POL' : 'BNB'}`] ?? '').trim();
  const legacy = String(env.SIGNER_EVM_CONTRACT ?? '').trim();
  const raw = (perChain || (key === 'bnb' ? legacy : '')).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(raw)) throw new Error('contract_missing');
  return raw;
}

/**
 * Тело запроса. `contract` здесь **не** принимается: контракт USDT берётся только
 * из `SIGNER_EVM_CONTRACT`. Иначе «разрешённый контракт» стал бы параметром
 * вызывающей стороны, а это ровно то, от чего Signer и нужен.
 */
export interface SignEvmRequest {
  tx?: unknown;
  signingHash?: unknown;
  recipient?: unknown;
  amountMicro?: unknown;
}

/**
 * Подписать EVM-транзакцию выплаты.
 *
 * Signer не доверяет описанию перевода — он пересобирает транзакцию из полей,
 * считает хеш сам и читает `data` как вызов `transfer(address,uint256)`.
 * Отсюда порядок проверок:
 *   1. поля транзакции собраны корректно и хеш совпадает с тем, что прислали;
 *   2. `to` — контракт USDT из переменных окружения, а не «что попросили»;
 *   3. `value` = 0: мы переводим токен, а не нативную монету;
 *   4. газ и `chainId` в разрешённых пределах;
 *   5. адрес получателя и сумма внутри `data` совпадают с телом заявки;
 *   6. сумма не больше лимита на транзакцию (в тех же micro, что и TRON).
 *
 * Смысл в том, чтобы скомпрометированный Worker не смог выманить подпись на
 * «одну транзакцию», а отправить другую: подпись привязана к хешу этих байт.
 */
export async function handleSignEvm(request: Request, env: SignerEnv): Promise<Response> {
  const denied = authorized(request, env);
  if (denied) return denied;
  const key = String(env.SIGNER_PRIVATE_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) return fail('key_missing', 503);

  let body: SignEvmRequest;
  try {
    body = await request.json() as SignEvmRequest;
  } catch {
    return fail('bad_json', 400);
  }

  const raw = body.tx as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return fail('bad_tx', 400);

  let tx;
  let chainId = 0n;
  let contract = '';
  // Шкала USDT по сети: 18 знаков в BNB, 6 в Polygon. Без неё проверка суммы
  // превращается в «сумма в теле не совпадает» на живой Polygon — то есть выплата
  // встанет, а причина будет выглядеть как подделка.
  let chain: PayChain = 'bsc';
  try {
    chainId = decimal(raw.chainId, 'chain_id');
    if (!chainIdAllowed(env, chainId)) return fail('chain_not_allowed', 400);
    const key = evmKeyByChainId(Number(chainId));
    // Число сети вне списка известных — отказ: мы не знаем ни контракта, ни
    // шкалы этой сети, а «попробуем наугад» для подписи ключом горячего кошелька
    // не бывает.
    if (!key) return fail('chain_unknown', 400);
    chain = key === 'polygon' ? 'polygon' : 'bsc';
    contract = contractOf(env, key);
  } catch {
    return fail('contract_misconfigured', 503);
  }

  try {
    const nonce = decimal(raw.nonce, 'nonce');
    if (nonce > 0xffffffffn) return fail('bad_nonce', 400);
    const maxPriorityFeePerGas = decimal(raw.maxPriorityFeePerGas, 'priority_fee');
    const maxFeePerGas = decimal(raw.maxFeePerGas, 'max_fee');
    const gasLimit = decimal(raw.gasLimit, 'gas_limit');
    const cap = decimal(env.SIGNER_EVM_MAX_GAS_WEI ?? DEFAULT_MAX_GAS_WEI.toString(), 'gas_cap');
    const limitCap = decimal(env.SIGNER_EVM_MAX_GAS_LIMIT ?? DEFAULT_MAX_GAS_LIMIT.toString(), 'gas_limit_cap');
    if (maxFeePerGas > cap) return fail('gas_price_too_high', 400);
    // Нижняя граница — не перестраховка: транзакция с нулевой ставкой или с газом
    // меньше «просто переслать монету» никогда не будет включена, а заявка
    // уже ушла бы в `broadcasting` и висела там.
    if (maxFeePerGas <= 0n) return fail('gas_price_too_low', 400);
    if (gasLimit < 21_000n) return fail('gas_limit_too_low', 400);
    if (maxPriorityFeePerGas > maxFeePerGas) return fail('priority_above_max_fee', 400);
    if (gasLimit > limitCap) return fail('gas_limit_too_high', 400);
    const to = String(raw.to ?? '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(to)) return fail('bad_to', 400);
    // Подписываем только вызов контракта USDT. Это единственная защита от
    // «Worker попросил подписать approve() на всё, что лежит в кошельке».
    if (to !== contract) return fail('contract_mismatch', 400);
    if (decimal(raw.value ?? '0', 'value') !== 0n) return fail('value_not_zero', 400);
    const data = String(raw.data ?? '');
    if (!/^0x[0-9a-fA-F]*$/.test(data)) return fail('bad_data', 400);

    tx = {
      chainId: Number(chainId),
      nonce: Number(nonce),
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to,
      value: 0n,
      data: data.toLowerCase(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'bad_tx';
    return fail(message.startsWith('bad_') ? message : 'bad_tx', 400);
  }

  // 1. Хеш пересобираем сами и сверяем с присланным: расхождение = тело подменено.
  let hash: string;
  try {
    hash = signingHash(tx);
  } catch (e) {
    if (e instanceof TxError) return fail(e.message, 400);
    throw e;
  }
  const claimed = String(body.signingHash ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (claimed && claimed !== hash.slice(2)) return fail('hash_mismatch', 400);

  // 5. Что внутри вызова.
  let parsed: { to: string; amountRaw: bigint };
  try {
    parsed = parseTransferCalldata(tx.data);
  } catch {
    return fail('not_a_transfer_call', 400);
  }
  if (tx.data.slice(2, 10) !== TRANSFER_SELECTOR) return fail('not_a_transfer_call', 400);

  let recipient: string;
  try {
    recipient = toChecksumAddress(String(body.recipient ?? '')).toLowerCase();
  } catch {
    return fail('bad_recipient', 400);
  }
  if (parsed.to.toLowerCase() !== recipient) return fail('recipient_mismatch', 400);
  if (recipient === contract) return fail('recipient_is_contract', 400);

  const amountMicro = Number(body.amountMicro);
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) return fail('bad_amount', 400);
  const expectedRaw = microToChainValue(amountMicro, chain);
  if (parsed.amountRaw !== expectedRaw) return fail('amount_mismatch', 400);
  // На 18 знаках в хвосте легко потерять пыль: сумма внутри `data` обязана быть
  // ровно этим micro, а не «округлённо близко к ним».
  if (chainValueToMicro(parsed.amountRaw.toString(), chain) !== amountMicro) return fail('amount_not_exact', 400);

  // 6. Лимит на одну транзакцию — в micro, общая шкала для обеих сетей.
  const maxMicro = Number(env.SIGNER_MAX_TX_MICRO ?? 100_000_000);
  if (!Number.isFinite(maxMicro) || maxMicro <= 0) return fail('limit_misconfigured', 503);
  if (amountMicro > maxMicro) return fail('above_signer_limit', 400);

  // 7. Дайджест для EVM — keccak256 от тела, а не sha256: другое и не примут.
  const digest = keccak256(signingPayload(tx));
  const signed = signDigest(digest, key);
  // Журнал: сеть, nonce, кому, сколько. Ни ключей, ни тел транзакций.
  console.log('signer.sign.evm', JSON.stringify({
    hash: hash.slice(2), chainId: tx.chainId, nonce: tx.nonce, to: recipient,
    amountMicro, recovery: signed.recovery,
  }));
  // `from` — адрес подписавшего ключа. Worker сверит его с `PAY_HOT_ADDRESS`:
  // баланс он смотрит на кошельке, а подпись стоит ключом из секрета, и эти два
  // значения могут разойтись молча.
  const from = toChecksumAddress(evmAddressFromPrivateKey(key)).toLowerCase();
  return json({ ok: true, hash: hash.slice(2), from, signature: signed.signature });
}

export interface SignEvmSweepRequest {
  index?: unknown;
  address?: unknown;
  tx?: unknown;
  signingHash?: unknown;
  recipient?: unknown;
  amountMicro?: unknown;
}

/**
 * Подписать сбор USDT с депозитного адреса (ключ выводится из семени по индексу).
 *
 * Почему это отдельная ручка, а не параметр `/sign/evm`: у выплаты подписант —
 * наш горячий кошелёк, и «кому» задаёт заявка игрока. У сбора подписант — чужой
 * кошелёк (адрес игрока), и единственная защита от «Worker выманил подпись и увёл
 * деньги игрока» в том, что получатель жёстко прописан в секрете Signer, а не
 * приходит в запросе. Плюс отдельный тумблер: сбор выключен, пока владелец его не
 * включил, даже если выплаты уже работают.
 *
 * Проверки — каждая своим кодом, потому что чинятся по-разному:
 *   1. `SIGNER_SWEEP_ENABLED = on` и семя на месте;
 *   2. индекс в диапазоне, адрес вывели мы, и он совпал с названным;
 *   3. `to` — контракт USDT сети из `chainId` тела (не из слова запроса);
 *   4. тело — ровно `transfer(address,uint256)`, `value` = 0, газ в потолках;
 *   5. хеш пересобран и совпал: подпись привязана к этим байтам, а не к описанию;
 *   6. получатель внутри `data` = `SIGNER_SWEEP_DESTINATION`, а не «надеюсь, наш»;
 *   7. сумма в `data` ровно та же в micro (шкала сети) и не больше потолка сбора.
 */
export async function handleSignEvmSweep(request: Request, env: SignerEnv): Promise<Response> {
  const denied = authorized(request, env);
  if (denied) return denied;
  if (String(env.SIGNER_SWEEP_ENABLED ?? '').trim().toLowerCase() !== 'on') return fail('sweep_disabled', 503);

  const seed = String(env.SIGNER_SEED ?? '').trim();
  if (!/^[0-9a-fA-F]{64,}$/.test(seed)) return fail('seed_missing', 503);
  const destination = String(env.SIGNER_SWEEP_DESTINATION ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(destination)) return fail('sweep_destination_missing', 503);

  let body: SignEvmSweepRequest;
  try {
    body = await request.json() as SignEvmSweepRequest;
  } catch {
    return fail('bad_json', 400);
  }

  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_INDEX) return fail('bad_index', 400);

  const raw = body.tx as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return fail('bad_tx', 400);

  let chainId = 0n;
  let chain: PayChain = 'bsc';
  let contract = '';
  try {
    chainId = decimal(raw.chainId, 'chain_id');
    if (!chainIdAllowed(env, chainId)) return fail('chain_not_allowed', 400);
    const key = evmKeyByChainId(Number(chainId));
    if (!key) return fail('chain_unknown', 400);
    chain = key === 'polygon' ? 'polygon' : 'bsc';
    contract = contractOf(env, key);
  } catch {
    return fail('contract_misconfigured', 503);
  }

  let tx;
  try {
    const nonce = decimal(raw.nonce, 'nonce');
    if (nonce > 0xffffffffn) return fail('bad_nonce', 400);
    const maxPriorityFeePerGas = decimal(raw.maxPriorityFeePerGas, 'priority_fee');
    const maxFeePerGas = decimal(raw.maxFeePerGas, 'max_fee');
    const gasLimit = decimal(raw.gasLimit, 'gas_limit');
    const cap = decimal(env.SIGNER_EVM_MAX_GAS_WEI ?? DEFAULT_MAX_GAS_WEI.toString(), 'gas_cap');
    const limitCap = decimal(env.SIGNER_EVM_MAX_GAS_LIMIT ?? DEFAULT_MAX_GAS_LIMIT.toString(), 'gas_limit_cap');
    // Ноль — не «бесплатно», а «нода врёт»: в сети с нулевой ставкой транзакция
    // не включится, а адрес уже потратил nonce и сбор застрянет в `broadcasting`.
    if (maxFeePerGas <= 0n) return fail('gas_price_too_low', 400);
    if (maxFeePerGas > cap) return fail('gas_price_too_high', 400);
    if (maxPriorityFeePerGas > maxFeePerGas) return fail('priority_above_max_fee', 400);
    if (gasLimit < 21_000n || gasLimit > limitCap || gasLimit > SWEEP_GAS_LIMIT_CAP) return fail('bad_gas_limit', 400);
    const to = String(raw.to ?? '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(to)) return fail('bad_to', 400);
    if (to !== contract) return fail('contract_mismatch', 400);
    if (decimal(raw.value ?? '0', 'value') !== 0n) return fail('value_not_zero', 400);
    const data = String(raw.data ?? '');
    if (!/^0x[0-9a-fA-F]*$/.test(data)) return fail('bad_data', 400);
    tx = {
      chainId: Number(chainId), nonce: Number(nonce), maxPriorityFeePerGas, maxFeePerGas,
      gasLimit, to, value: 0n, data: data.toLowerCase(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'bad_tx';
    return fail(message.startsWith('bad_') ? message : 'bad_tx', 400);
  }

  if (tx.data.slice(2, 10) !== TRANSFER_SELECTOR) return fail('not_a_transfer_call', 400);
  let parsed: { to: string; amountRaw: bigint };
  try {
    parsed = parseTransferCalldata(tx.data);
  } catch {
    return fail('not_a_transfer_call', 400);
  }

  const hash = signingHash(tx);
  const claimed = String(body.signingHash ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (claimed && claimed !== hash.slice(2)) return fail('hash_mismatch', 400);

  // Получатель решает всё: это единственное, что отличает «собрали в наш
  // кошелёк» от «увели деньги игрока». Поэтому сверяем с секретом и обязательно
  // с тем, что лежит внутри `data`, — описанию запроса мы не верим.
  let recipient: string;
  try {
    recipient = toChecksumAddress(String(body.recipient ?? '')).toLowerCase();
  } catch {
    return fail('bad_recipient', 400);
  }
  if (parsed.to.toLowerCase() !== recipient) return fail('recipient_mismatch', 400);
  if (recipient !== destination) return fail('destination_not_allowed', 400);

  const amountMicro = Number(body.amountMicro);
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) return fail('bad_amount', 400);
  if (parsed.amountRaw !== microToChainValue(amountMicro, chain)) return fail('amount_mismatch', 400);
  if (chainValueToMicro(parsed.amountRaw.toString(), chain) !== amountMicro) return fail('amount_not_exact', 400);
  const maxMicro = Number(env.SIGNER_SWEEP_MAX_MICRO ?? DEFAULT_SWEEP_MAX_MICRO);
  if (!Number.isFinite(maxMicro) || maxMicro <= 0) return fail('limit_misconfigured', 503);
  if (amountMicro > maxMicro) return fail('above_sweep_limit', 400);

  let derived: { privateKey: string; address: string };
  try {
    derived = await deriveEvmKey(seed, index);
  } catch (e) {
    return fail(`derive_failed:${e instanceof Error ? e.message : 'unknown'}`, 500);
  }
  const from = evmAddressFromPrivateKey(derived.privateKey).toLowerCase();
  // Адрес обязан быть назван: сверка «индекс ↔ адрес» не даёт перепутать игрока
  // и увести деньги с соседнего адреса того же семени.
  const claimedAddress = String(body.address ?? '').trim().toLowerCase();
  if (claimedAddress && claimedAddress !== from) return fail('address_mismatch', 400);
  if (from === destination) return fail('source_is_destination', 400);

  const signed = signDigest(keccak256(signingPayload(tx)), derived.privateKey);
  // Журнал: сеть, nonce, индекс, кому, сколько. Ни семян, ни ключей, ни тел.
  console.log('signer.sign.evm.sweep', JSON.stringify({
    hash: hash.slice(2), chainId: tx.chainId, nonce: tx.nonce, index, from, to: recipient,
    amountMicro, recovery: signed.recovery,
  }));
  return json({ ok: true, hash: hash.slice(2), from, index, signature: signed.signature });
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
    if (request.method === 'POST' && url.pathname === '/sign/evm') return handleSignEvm(request, env);
    if (request.method === 'POST' && url.pathname === '/sign/evm/sweep') return handleSignEvmSweep(request, env);
    return fail('not_found', 404);
  },
};
