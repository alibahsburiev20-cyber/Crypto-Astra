import { describe, expect, it } from 'vitest';
import { handleAddress, handleSign } from '../../../signer/src/index';
import { addressToHex, hexToBase58 } from '../../src/pay/tron/address';
import { deriveKey } from '../../src/pay/crypto/hd';
import { publicKeyFromPrivate, verifyDigest } from '../../src/pay/crypto/secp256k1';
import { sha256Bytes } from '../../src/shared/sha256';
import { ensureAddress, findAddress, signerDeriver, type AddressDeriver } from '../../src/pay/addresses';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { makeD1 } from '../helpers/d1';
import type { Env } from '../../src/env';

// Signer — единственное место с ключами, поэтому проверяем не «работает», а
// «отказывает там, где должен»: чужой токен, подменённое тело, другой
// получатель, сумма выше лимита.

const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const HOT_KEY = '0'.repeat(63) + '1';
const TOKEN = 'signer-test-token-0123456789abcdef';
const TO = hexToBase58('41' + '55'.repeat(20));
const T0 = 1_700_000_000_000;

function env(patch: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    SIGNER_TOKEN: TOKEN,
    SIGNER_SEED: SEED,
    SIGNER_PRIVATE_KEY: HOT_KEY,
    SIGNER_MAX_TX_MICRO: '100000000',
    ...patch,
  };
}

function auth(token = TOKEN): RequestInit {
  return { method: 'POST', headers: { authorization: `Bearer ${token}` } };
}

function pad64(hex: string): string {
  return hex.padStart(64, '0');
}

function rawData(to: string, amountMicro: number): string {
  return `a9059cbb${pad64(addressToHex(to).slice(2))}${pad64(amountMicro.toString(16))}`;
}

function sha256HexOf(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  let out = '';
  for (const b of sha256Bytes(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

describe('Signer: выдача адресов', () => {
  it('адрес совпадает с деривацией из семени', async () => {
    const res = await handleAddress(
      new Request('https://signer/address', { ...auth(), body: JSON.stringify({ index: 0 }) }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { address: string; index: number };
    expect(body.address).toBe((await deriveKey(SEED, 0)).address);
    expect(body.index).toBe(0);
  });

  it('без токена, с чужим токеном и без токена в конфиге — отказ', async () => {
    const noToken = await handleAddress(
      new Request('https://signer/address', { method: 'POST', body: '{"index":0}' }), env(),
    );
    expect(noToken.status).toBe(401);

    const wrong = await handleAddress(
      new Request('https://signer/address', { ...auth('wrong-token-wrong-token'), body: '{"index":0}' }), env(),
    );
    expect(wrong.status).toBe(403);

    const disabled = await handleAddress(
      new Request('https://signer/address', { ...auth(), body: '{"index":0}' }), env({ SIGNER_TOKEN: '' }),
    );
    expect(disabled.status).toBe(503);
  });

  it('индекс вне диапазона отвергается', async () => {
    for (const index of [-1, 1_000_000, 1.5, 'abc']) {
      const res = await handleAddress(
        new Request('https://signer/address', { ...auth(), body: JSON.stringify({ index }) }), env(),
      );
      expect(res.status).toBe(400);
    }
  });
});

describe('Signer: подпись', () => {
  const amount = 6_000_000;
  const raw = rawData(TO, amount);
  const txID = sha256HexOf(raw);

  function sign(body: Record<string, unknown>, patch: Partial<Record<string, string>> = {}, token = TOKEN) {
    return handleSign(
      new Request('https://signer/sign', { ...auth(token), body: JSON.stringify(body) }),
      env(patch),
    );
  }

  it('подписывает проверенный перевод, подпись сходится с ключом', async () => {
    const res = await sign({ rawDataHex: raw, txID, to: TO, amountMicro: amount });
    expect(res.status).toBe(200);
    const body = await res.json() as { signature: string; txID: string };
    expect(body.txID).toBe(txID);

    const digest = new Uint8Array(raw.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    expect(verifyDigest(sha256Bytes(digest), body.signature, publicKeyFromPrivate(HOT_KEY))).toBe(true);
  });

  it('подменённое тело не подписывается', async () => {
    const other = rawData(TO, amount + 1);
    const res = await sign({ rawDataHex: other, txID, to: TO, amountMicro: amount });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('tx_mismatch');
  });

  it('другой получатель в теле — отказ', async () => {
    const otherTo = hexToBase58('41' + '66'.repeat(20));
    const res = await sign({ rawDataHex: raw, txID, to: otherTo, amountMicro: amount });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('destination_mismatch');
  });

  it('другая сумма — отказ, даже если тело цело', async () => {
    const res = await sign({ rawDataHex: raw, txID, to: TO, amountMicro: amount + 1 });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('amount_mismatch');
  });

  it('сумма выше лимита Signer не подписывается', async () => {
    const big = 200_000_000;
    const rawBig = rawData(TO, big);
    const res = await sign({ rawDataHex: rawBig, txID: sha256HexOf(rawBig), to: TO, amountMicro: big });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('above_signer_limit');
  });

  it('без ключа подпись недоступна, мусор в теле отвергается', async () => {
    expect((await sign({ rawDataHex: raw, txID, to: TO, amountMicro: amount }, { SIGNER_PRIVATE_KEY: '' })).status).toBe(503);
    expect((await sign({ rawDataHex: 'zz', txID, to: TO, amountMicro: amount })).status).toBe(400);
    expect((await sign({ rawDataHex: raw, txID: 'short', to: TO, amountMicro: amount })).status).toBe(400);
  });

  it('чужой токен не подписывает ничего', async () => {
    const res = await sign({ rawDataHex: raw, txID, to: TO, amountMicro: amount }, {}, 'another-token-another-token');
    expect(res.status).toBe(403);
  });
});

/** Дериватор без сети: считает адрес из семени локально. */
const localDeriver: AddressDeriver = {
  async derive(index: number) {
    const key = await deriveKey(SEED, index);
    return { index, address: key.address };
  },
};

describe('адреса игроков', () => {
  async function freshDb() {
    resetPaySchemaForTests();
    const { db } = makeD1();
    await ensurePaySchema(db);
    return db;
  }

  it('адрес выдаётся один раз на цепь и не меняется', async () => {
    const db = await freshDb();
    const first = await ensureAddress(db, 'u1', localDeriver, T0, 'tron');
    expect(first.created).toBe(true);
    expect(first.index).toBe(0);
    expect(first.chain).toBe('tron');

    const second = await ensureAddress(db, 'u1', localDeriver, T0 + 1000, 'tron');
    expect(second.created).toBe(false);
    expect(second.address).toBe(first.address);
    expect(second.index).toBe(0);
  });

  it('вторая цепь — второй адрес у того же игрока, старый остаётся', async () => {
    // Это и есть переезд TRON -> BSC в одном тесте: сеть в конфиге меняется,
    // адрес прошлой сети не аннулируется (на нём лежат деньги), а новый
    // выдаётся по этой же цепи и со следующего индекса.
    const db = await freshDb();
    const tron = await ensureAddress(db, 'u1', localDeriver, T0, 'tron');
    const bsc = await ensureAddress(db, 'u1', localDeriver, T0 + 1000, 'bsc');

    expect(bsc.created).toBe(true);
    expect(bsc.index).toBe(tron.index + 1);
    expect(bsc.address).not.toBe(tron.address);

    // Повторный запрос в ту же цепь идемпотентен и не создаёт третью строку.
    const again = await ensureAddress(db, 'u1', localDeriver, T0 + 2000, 'bsc');
    expect(again.address).toBe(bsc.address);
    expect(again.created).toBe(false);
    expect(await findAddress(db, 'u1', 'tron')).toMatchObject({ address: tron.address, chain: 'tron' });
    expect(await findAddress(db, 'u1', 'bsc')).toMatchObject({ address: bsc.address, chain: 'bsc' });
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM pay_addresses').first<number>('n');
    expect(Number(rows)).toBe(2);
  });

  it('чужую цепь запрос не видит', async () => {
    // Сосед по базе не должен «унаследовать» адрес: `findAddress` ищет по паре
    // (игрок, сеть), иначе BSC-сканер начал бы зачитывать TRON-адрес как свой.
    const db = await freshDb();
    await ensureAddress(db, 'u1', localDeriver, T0, 'tron');
    expect(await findAddress(db, 'u1', 'bsc')).toBeNull();
  });

  it('разным игрокам — разные индексы и адреса', async () => {
    const db = await freshDb();
    const a = await ensureAddress(db, 'u1', localDeriver, T0, 'tron');
    const b = await ensureAddress(db, 'u2', localDeriver, T0, 'tron');
    expect(b.index).toBe(a.index + 1);
    expect(b.address).not.toBe(a.address);
    expect((await findAddress(db, 'u2', 'tron'))?.address).toBe(b.address);
  });

  it('занятый индекс не выдаётся повторно', async () => {
    const db = await freshDb();
    await ensureAddress(db, 'u1', localDeriver, T0, 'tron');
    // «Сломанный» дериватор всегда возвращает индекс 0 — второй игрок должен
    // получить следующий свободный, а не тот же адрес.
    const broken: AddressDeriver = {
      async derive(index: number) {
        const key = await deriveKey(SEED, index === 0 ? 0 : index);
        return { index: 0, address: key.address };
      },
    };
    const b = await ensureAddress(db, 'u2', broken, T0 + 1, 'tron');
    expect(b.index).toBe(1);
    expect(b.address).not.toBe((await findAddress(db, 'u1', 'tron'))?.address);
  });

  it('без service binding адрес не выдаётся', async () => {
    const deriver = signerDeriver({} as unknown as Env);
    await expect(deriver.derive(0)).rejects.toThrow(/signer_not_configured/);
  });
});
