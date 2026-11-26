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

describe('Polygon в контуре Signer', () => {
  const POL = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
  const POL_ENV = { SIGNER_EVM_CHAIN_IDS: '56,137', SIGNER_EVM_CONTRACT_POL: POL };

  /** Тело перевода в Polygon: та же `transfer`, но 6-значная шкала USDT0. */
  function polBody(over: { amountMicro?: number; dataMicro?: number; chainId?: number; to?: string } = {}) {
    const chainId = over.chainId ?? 137;
    const to = over.to ?? POL;
    const tx: TxWire = {
      chainId,
      nonce: 3,
      maxPriorityFeePerGas: '1000000000',
      maxFeePerGas: '3000000000',
      gasLimit: '80000',
      to,
      value: '0',
      data: transferCalldata(RECIPIENT, microToChainValue(over.dataMicro ?? over.amountMicro ?? AMOUNT, 'polygon')),
    };
    return { tx, signingHash: hashOrEmpty(tx), recipient: RECIPIENT, amountMicro: over.amountMicro ?? AMOUNT };
  }

  const signPol = async (over: Parameters<typeof polBody>[0] = {}, patch: Record<string, string> = {}) => {
    const res = await handleSignEvm(post(polBody(over)), env({ ...POL_ENV, ...patch }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  it('137 + контракт Polygon + шкала 6 знаков — подписывает', async () => {
    const { status, body } = await signPol();
    expect(status).toBe(200);
    expect(String(body.signature)).toMatch(/^(0x)?[0-9a-f]{130}$/);
  });

  it('Polygon не подписывается, пока его сеть не названа явно', async () => {
    // Значение по умолчанию — `56`. «Мы добавили Polygon в конфигурацию Worker»
    // не имеет права само по себе разрешить подписи в новой цепи.
    const res = await handleSignEvm(post(polBody()), env({ SIGNER_EVM_CONTRACT_POL: POL }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'chain_not_allowed' });
  });

  it('контракт Polygon без `SIGNER_EVM_CONTRACT_POL` — 503, а не «подставим BNB»', async () => {
    const res = await handleSignEvm(post(polBody()), env({ SIGNER_EVM_CHAIN_IDS: '56,137' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'contract_misconfigured' });
  });

  it('пара «сеть + контракт» проверяется как пара', async () => {
    // Контракт BNB в транзакции Polygon и контракт Polygon в транзакции BNB —
    // оба отказа: подписать такой перевод значит отправить деньги на токен,
    // которого в этой сети нет.
    expect((await signPol({ to: CONTRACT })).body).toMatchObject({ error: 'contract_mismatch' });
    const bnbTx = await sign({ tx: { chainId: 56, to: POL } });
    expect(bnbTx.body).toMatchObject({ error: 'contract_mismatch' });
  });

  it('сумка сверяется по шкале СВОЕЙ сети', async () => {
    // 12.5 USDT в 18-значной шкале, отправленные как polygon-перевод, — это в
    // миллион раз больше, чем просил игрок. Проверка обязана упасть, а не
    // «подписать близкое значение».
    const wrongScale = microToChainValue(AMOUNT, 'bsc');
    const tx: TxWire = {
      chainId: 137,
      nonce: 3,
      maxPriorityFeePerGas: '1000000000',
      maxFeePerGas: '3000000000',
      gasLimit: '80000',
      to: POL,
      value: '0',
      data: transferCalldata(RECIPIENT, wrongScale),
    };
    const res = await handleSignEvm(post({ tx, signingHash: hashOrEmpty(tx), recipient: RECIPIENT, amountMicro: AMOUNT }), env(POL_ENV));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'amount_mismatch' });
  });

  it('число сети вне списка известных — отказ, а не «считаем, что это BNB»', async () => {
    // Сначала allowlist: `chain_not_allowed` — это «такую сеть мы не подписываем
    // вообще». `chain_unknown` — другой случай: оператор сеть назвал, а мы не
    // знаем про неё ни контракта, ни шкалы; угадывать «похоже на EVM» нельзя.
    expect((await signPol({ chainId: 1 })).body).toMatchObject({ error: 'chain_not_allowed' });
    expect((await signPol({ chainId: 1 }, { SIGNER_EVM_CHAIN_IDS: '56,1' })).body)
      .toMatchObject({ error: 'chain_unknown' });
  });

  it('адрес Polygon выводится из того же семени и индекса, что и BNB', async () => {
    const request = (body: unknown) => new Request('https://signer/address', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    const pol = await handleAddress(request({ index: 9, chain: 'polygon' }), env());
    const bsc = await handleAddress(request({ index: 9, chain: 'bsc' }), env());
    const polBody = await pol.json() as { address: string; chain: string };
    const bscBody = await bsc.json() as { address: string; chain: string };
    expect(polBody.chain).toBe('polygon');
    // Та же цепочка ключей: EVM-адрес не зависит от сети, и это нормально —
    // различает их именно `chain` в нашей базе, а не форма адреса.
    expect(polBody.address).toBe(bscBody.address);
    expect(toChecksumAddress(polBody.address)).toBe(polBody.address);
  });
});

function pad(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0');
}

/** Адрес из приватного ключа — тот же расчёт, что делает `pay/evm/derivation.ts`. */
function evmAddressOf(key: string): string {
  return toChecksumAddress(evmAddressFromPrivateKey(key));
}
