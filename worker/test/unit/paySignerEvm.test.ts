// Signer и EVM: что он готов подписать, а что — нет.
//
// Это единственное место, где есть ключ, поэтому проверяем не «подпись вернулась»,
// а что подпись невозможно выманить на чужой контракт, чужую сеть, чужой получателя
// и чужую сумму. Плюс второй адресной ветки: `0x…` из того же семени, что и `T…`.
import { describe, expect, it } from 'vitest';
import { handleAddress, handleSignEvm, type SignerEnv } from '../../../signer/src/index';
import { deriveEvmKey } from '../../src/pay/evm/derivation';
import { evmAddressFromPrivateKey, toChecksumAddress } from '../../src/pay/evm/address';
import { deriveKey } from '../../src/pay/crypto/hd';
import { keccak256 } from '../../src/pay/crypto/keccak';
import { publicKeyFromPrivate, verifyDigest } from '../../src/pay/crypto/secp256k1';
import { signingHash, signingPayload, transferCalldata, decodeSignedTx, applySignature } from '../../src/pay/evm/tx';
import { microToChainValue } from '../../src/pay/units';
import { addressToHex } from '../../src/pay/tron/address';

const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const HOT_KEY = '0'.repeat(63) + '1';
const TOKEN = 'signer-test-token-0123456789abcdef';
const CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const RECIPIENT = '0x' + 'bb'.repeat(20);
const AMOUNT = 12_500_000; // 12.5 USDT

function env(patch: Record<string, string> = {}): SignerEnv {
  return {
    SIGNER_TOKEN: TOKEN,
    SIGNER_SEED: SEED,
    SIGNER_PRIVATE_KEY: HOT_KEY,
    SIGNER_MAX_TX_MICRO: '100000000',
    SIGNER_EVM_CONTRACT: CONTRACT,
    SIGNER_EVM_CHAIN_IDS: '56',
    ...patch,
  } as SignerEnv;
}

function post(body: unknown, token = TOKEN): Request {
  return new Request('https://signer/sign/evm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

interface Body {
  tx: Record<string, string | number>;
  signingHash: string;
  recipient: string;
  amountMicro: number;
}

/** Поля транзакции в «wire»-формате (строки) и те же поля для хеша (bigint). */
interface TxWire { [key: string]: string | number }

function fieldsOf(tx: TxWire) {
  return {
    chainId: Number(tx.chainId),
    nonce: Number(tx.nonce),
    maxPriorityFeePerGas: BigInt(String(tx.maxPriorityFeePerGas)),
    maxFeePerGas: BigInt(String(tx.maxFeePerGas)),
    gasLimit: BigInt(String(tx.gasLimit)),
    to: String(tx.to),
    value: BigInt(String(tx.value ?? '0')),
    data: String(tx.data),
  };
}

function txBody(over: { tx?: TxWire; recipient?: string; amountMicro?: number; dataMicro?: number; dataRecipient?: string } = {}): {
  tx: TxWire; signingHash: string; recipient: string; amountMicro: number;
} {
  const tx: TxWire = {
    chainId: 56,
    nonce: 7,
    maxPriorityFeePerGas: '1000000000',
    maxFeePerGas: '3000000000',
    gasLimit: '80000',
    to: CONTRACT,
    value: '0',
    // `dataMicro` отдельно от `amountMicro`: чтобы проверить «в теле одно, а в
    // заявке другое», их надо уметь развести.
    data: transferCalldata(over.dataRecipient ?? over.recipient ?? RECIPIENT, microToChainValue(over.dataMicro ?? over.amountMicro ?? AMOUNT, 'bsc')),
    ...over.tx,
  };
  return {
    tx,
    // Хеш считается из того, что реально в `tx`. Для заведомо битых полей (приоритет
    // больше maxFee) хеша не бывает — и Signер обязан отказать по проверке поля, а
    // не по несовпадению хеша.
    signingHash: hashOrEmpty(tx),
    recipient: over.recipient ?? RECIPIENT,
    amountMicro: over.amountMicro ?? AMOUNT,
  };
}

function hashOrEmpty(tx: TxWire): string {
  try {
    return signingHash(fieldsOf(tx));
  } catch {
    return '';
  }
}

async function sign(over: Parameters<typeof txBody>[0] = {}, e: SignerEnv = env()): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handleSignEvm(post(txBody(over)), e);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('выдача адресов: две сети из одного семени', () => {
  const request = (body: unknown, token = TOKEN): Request => new Request('https://signer/address', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  it('`chain: "bsc"` даёт `0x…` с контрольной суммой, без `chain` — как раньше, `T…`', async () => {
    const bsc = await handleAddress(request({ index: 3, chain: 'bsc' }), env());
    const tron = await handleAddress(request({ index: 3 }), env());
    const bscBody = await bsc.json() as { address: string; chain: string };
    const tronBody = await tron.json() as { address: string; chain: string };

    expect(bscBody.chain).toBe('bsc');
    expect(bscBody.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(toChecksumAddress(bscBody.address)).toBe(bscBody.address);
    expect(tronBody.chain).toBe('tron');
    expect(tronBody.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(bsc.status).toBe(200);
  });

  it('индекс общий, ключи разные: адрес BSC ≠ адрес TRON, и оба совпадают с деривацией', async () => {
    const res = await handleAddress(request({ index: 5, chain: 'bsc' }), env());
    const bsc = await res.json() as { address: string };
    const tron = await handleAddress(request({ index: 5, chain: 'tron' }), env());
    const tronBody = await tron.json() as { address: string };

    expect(bsc.address.toLowerCase()).toBe((await deriveEvmKey(SEED, 5)).address.toLowerCase());
    expect(tronBody.address).toBe((await deriveKey(SEED, 5)).address);
    // Смысл двух путей деривации — что ключи не пересекаются. Если coin type
    // (60 vs 195) перепутать, адреса совпадут по hex-части, и тест упадёт здесь.
    expect(bsc.address.slice(2)).not.toBe(addressToHex(tronBody.address).slice(2));
  });

  it('чужая сеть в запросе — 400, а не «подставим TRON»', async () => {
    const res = await handleAddress(request({ index: 1, chain: 'ethereum' }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_chain' });
  });

  it('без семени — 503, и адрес не выдаётся «от неизвестного источника»', async () => {
    const res = await handleAddress(request({ index: 1, chain: 'bsc' }), { SIGNER_TOKEN: TOKEN } as SignerEnv);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'seed_missing' });
  });
});

describe('подпись EVM-перевода', () => {
  it('хэппи-песня: подпись проходит, `from` = адрес горячего ключа', async () => {
    const { status, body } = await sign();
    expect(status).toBe(200);
    const signature = String(body.signature);
    expect(signature).toMatch(/^(0x)?[0-9a-f]{130}$/);
    expect(body.from).toBe(toChecksumAddress(evmAddressOf(HOT_KEY)).toLowerCase());

    // Проверка подписи открытым ключом: если Signer подписал не тот дайджест,
    // `verifyDigest` это увидит.
    const fields = fieldsOf(txBody().tx);
    const digest = keccak256(signingPayload(fields));
    expect(verifyDigest(digest, signature, publicKeyFromPrivate(HOT_KEY))).toBe(true);

    // И тело после вставки подписи распаковывается в те же поля.
    const raw = applySignature(fields, signature);
    expect(decodeSignedTx(raw)).toMatchObject({ chainId: 56, nonce: 7, to: CONTRACT });
  });

  it('контракт не из окружения — отказ', async () => {
    expect((await sign({ tx: { to: '0x' + '11'.repeat(20) } })).body).toMatchObject({ error: 'contract_mismatch' });
  });

  it('без `SIGNER_EVM_CONTRACT` подпись не выдаётся вообще', async () => {
    const res = await handleSignEvm(post(txBody()), env({ SIGNER_EVM_CONTRACT: '' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'contract_misconfigured' });
  });

  it('chainId вне списка — отказ (подпись в чужую сеть = деньги в чужой сети)', async () => {
    expect((await sign({ tx: { chainId: 97 } })).body).toMatchObject({ error: 'chain_not_allowed' });
    // Тот же chainId проходит, когда он явно разрешён.
    const ok = await sign({ tx: { chainId: 97 } }, env({ SIGNER_EVM_CHAIN_IDS: '56,97' }));
    expect(ok.status).toBe(200);
    expect(ok.body.hash).toBe(signingHash(fieldsOf({ ...txBody().tx, chainId: 97 })).slice(2));
  });

  it('`value > 0` — отказ: мы переводим токен, а не нативную монету', async () => {
    expect((await sign({ tx: { value: '1000000000000000000' } })).body).toMatchObject({ error: 'value_not_zero' });
  });

  it('газ и лимит проверяются до подписи', async () => {
    expect((await sign({ tx: { maxFeePerGas: '21000000000' } })).body).toMatchObject({ error: 'gas_price_too_high' });
    expect((await sign({ tx: { maxFeePerGas: '21000000000' } }, env({ SIGNER_EVM_MAX_GAS_WEI: '30000000000' }))).status).toBe(200);
    expect((await sign({ tx: { maxPriorityFeePerGas: '4000000000', maxFeePerGas: '3000000000' } })).body)
      .toMatchObject({ error: 'priority_above_max_fee' });
    expect((await sign({ tx: { gasLimit: '30000000' } })).body).toMatchObject({ error: 'gas_limit_too_high' });
  });

  it('нижняя граница газа: нулевая ставка и «газ меньше пересылки монеты» — отказ', async () => {
    // Такую транзакцию сеть не включит никогда, а заявка уже висела бы в
    // `broadcasting` со списанным резервом.
    expect((await sign({ tx: { maxFeePerGas: '0', maxPriorityFeePerGas: '0' } })).body)
      .toMatchObject({ error: 'gas_price_too_low' });
    expect((await sign({ tx: { gasLimit: '20999' } })).body).toMatchObject({ error: 'gas_limit_too_low' });
  });

  it('несовпадение хеша — отказ: тело подменено по дороге', async () => {
    const body = txBody();
    const res = await handleSignEvm(post({ ...body, signingHash: `0x${'00'.repeat(32)}` }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'hash_mismatch' });
  });

  it('не `transfer` в `data` — отказ, включая `approve` на весь кошелёк', async () => {
    const approve = `0x095ea7b3${pad(CONTRACT)}${'f'.repeat(64)}`;
    expect((await sign({ tx: { data: approve } })).body).toMatchObject({ error: 'not_a_transfer_call' });
  });

  it('получатель в `data` ≠ заявленный — отказ; регистр и отсутствие `0x` — не повод отказать', async () => {
    // Заявленный получатель ≠ тот, что в calldata: подпись на «одного» получателя,
    // а уйдут деньги к другому. Ловится именно здесь, до сети.
    expect((await sign({ recipient: '0x' + 'dd'.repeat(20), dataRecipient: RECIPIENT })).body)
      .toMatchObject({ error: 'recipient_mismatch' });
    // В `data` всегда лежит канонический `0x…`, а заявлять получателя можем в
    // любой из человеческих форм: 40 hex без префикса, чексум, ВЕРХНИЙ РЕГИСТР.
    // Отказать такому вводу — значит «кошелёк игрока принимает, а мы нет».
    const bare = RECIPIENT.slice(2);
    const upper = toChecksumAddress(RECIPIENT);
    for (const claimed of [bare, upper, upper.toUpperCase(), `0X${RECIPIENT.slice(2)}`]) {
      const res = await sign({ recipient: claimed, dataRecipient: RECIPIENT });
      expect(res.status, `форма адреса: ${claimed}`).toBe(200);
    }
  });

  it('сумма сверяется по `data`, а не по словам', async () => {
    // Заявлено 12.500001 USDT, а в теле — 12.5: расхождение видно только если
    // читать calldata, а не верить JSON.
    expect((await sign({ amountMicro: AMOUNT + 1, dataMicro: AMOUNT })).body).toMatchObject({ error: 'amount_mismatch' });
    // В теле — сумма, а в заявке ноль или дробь: проверяется и то, и другое.
    expect((await sign({ amountMicro: 0, dataMicro: AMOUNT })).body).toMatchObject({ error: 'bad_amount' });
    expect((await sign({ amountMicro: 1.5, dataMicro: AMOUNT })).body).toMatchObject({ error: 'bad_amount' });
  });

  it('лимит на одну транзакцию — в micro, общая шкала для обеих сетей', async () => {
    const big = 150_000_000; // 150 USDT
    const body = txBody({ amountMicro: big });
    const res = await handleSignEvm(post(body), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'above_signer_limit' });

    // Тот же перевод проходит, когда лимит поднят.
    const res2 = await handleSignEvm(post(body), env({ SIGNER_MAX_TX_MICRO: '200000000' }));
    expect(res2.status).toBe(200);
  });

  it('без токена — 401/503, и ни одна проверка не выполняется «впустую»', async () => {
    const noToken = await handleSignEvm(post(txBody(), ''), env());
    expect(noToken.status).toBe(401);
    const wrongToken = await handleSignEvm(post(txBody(), 'nope-nope-nope-nope-nope-1'), env());
    expect(wrongToken.status).toBe(403);
    const noKey = await handleSignEvm(post(txBody()), { SIGNER_TOKEN: TOKEN, SIGNER_EVM_CONTRACT: CONTRACT } as SignerEnv);
    expect(noKey.status).toBe(503);
  });
});

function pad(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0');
}

/** Адрес из приватного ключа — тот же расчёт, что делает `pay/evm/derivation.ts`. */
function evmAddressOf(key: string): string {
  return toChecksumAddress(evmAddressFromPrivateKey(key));
}
