import { describe, expect, it } from 'vitest';
import {
  BroadcastError, DEFAULT_FEE_LIMIT_SUN, createUnsignedTransfer, sendUsdt, transferDataHex,
  transferParameter, type SignerClient, type TronTransport,
} from '../../src/pay/broadcast';
import { handleSign } from '../../../signer/src/index';
import { addressToHex, hexToBase58 } from '../../src/pay/tron/address';
import { publicKeyFromPrivate, verifyDigest } from '../../src/pay/crypto/secp256k1';
import { sha256Bytes } from '../../src/shared/sha256';

// Полный путь выплаты без сети: TronGrid подменён, а Signer — настоящий
// (те же проверки, что в бою). Так проверяется стык, где обычно и теряются
// деньги: «собрали одно, подписали другое, отправили третье».

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const OWNER = hexToBase58('41' + '77'.repeat(20));
const TO = hexToBase58('41' + '55'.repeat(20));
const HOT_KEY = '0'.repeat(63) + '1';
const TOKEN = 'signer-test-token-0123456789abcdef';
const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const AMOUNT = 6_000_000;

function pad64(hex: string): string {
  return hex.padStart(64, '0');
}

function sha256HexOf(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  let out = '';
  for (const b of sha256Bytes(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Поддельный TronGrid: собирает «транзакцию» из запроса и запоминает вызовы. */
function fakeTron(options: { rejectBroadcast?: boolean } = {}) {
  const calls: { url: string; body: string }[] = [];
  const transport: TronTransport = {
    fetchJson: async (url, init) => {
      calls.push({ url, body: init?.body ?? '' });
      if (url.endsWith('/wallet/triggersmartcontract')) {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        // Тело транзакции = селектор + параметр: ровно то, что подписывает Signer.
        const rawDataHex = `a9059cbb${String(payload.parameter)}`;
        return {
          result: { result: true },
          transaction: { txID: sha256HexOf(rawDataHex), raw_data_hex: rawDataHex, visible: true },
        };
      }
      if (options.rejectBroadcast) return { result: false, code: 'SIGERROR' };
      const payload = JSON.parse(String(init?.body)) as { txID?: string };
      return { result: true, txid: payload.txID ?? '' };
    },
  };
  return { transport, calls };
}

/** Настоящий Signer, вызванный напрямую: никакой сети, но все проверки на месте. */
const realSigner: SignerClient = {
  async sign(input) {
    const res = await handleSign(
      new Request('https://signer/sign', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(input),
      }),
      { SIGNER_TOKEN: TOKEN, SIGNER_SEED: SEED, SIGNER_PRIVATE_KEY: HOT_KEY, SIGNER_MAX_TX_MICRO: '100000000' },
    );
    const data = await res.json() as { signature?: string; error?: string };
    if (!res.ok || !data.signature) throw new BroadcastError(data.error ?? `signer_${res.status}`);
    return { signature: data.signature };
  },
};

describe('сборка перевода TRC-20', () => {
  it('параметр вызова: адрес и сумма по 32 байта', () => {
    const param = transferParameter(TO, AMOUNT);
    expect(param).toBe(pad64(addressToHex(TO).slice(2)) + pad64(AMOUNT.toString(16)));
    expect(param).toHaveLength(128);
    expect(transferDataHex(TO, AMOUNT).startsWith('a9059cbb')).toBe(true);
  });

  it('нулевая и дробная сумма отвергаются', () => {
    expect(() => transferParameter(TO, 0)).toThrow(BroadcastError);
    expect(() => transferParameter(TO, 1.5)).toThrow(BroadcastError);
  });

  it('TronGrid получает правильный запрос и лимит комиссии', async () => {
    const { transport, calls } = fakeTron();
    const unsigned = await createUnsignedTransfer(transport, {
      owner: OWNER, to: TO, amountMicro: AMOUNT, contract: USDT,
    });
    const body = JSON.parse(calls[0].body) as Record<string, unknown>;

    expect(calls[0].url).toContain('/wallet/triggersmartcontract');
    expect(body.function_selector).toBe('transfer(address,uint256)');
    expect(body.fee_limit).toBe(DEFAULT_FEE_LIMIT_SUN);
    expect(body.contract_address).toBe(USDT);
    expect(body.visible).toBe(true);
    expect(unsigned.txID).toHaveLength(64);
  });

  it('отказ сети при сборке — ошибка, а не «пустая транзакция»', async () => {
    const transport: TronTransport = {
      fetchJson: async () => ({ result: { result: false, message: 'balance' } }),
    };
    await expect(createUnsignedTransfer(transport, {
      owner: OWNER, to: TO, amountMicro: AMOUNT, contract: USDT,
    })).rejects.toThrow(/create_rejected/);
  });
});

describe('полный путь выплаты', () => {
  it('собрали → подписали → отправили, подпись сходится с ключом', async () => {
    const { transport, calls } = fakeTron();
    const result = await sendUsdt(transport, realSigner, {
      owner: OWNER, to: TO, amountMicro: AMOUNT, contract: USDT,
    });

    expect(result.txid).toHaveLength(64);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('/wallet/broadcasttransaction');

    const broadcast = JSON.parse(calls[1].body) as { signature: string[] };
    expect(broadcast.signature).toHaveLength(1);

    const rawData = `a9059cbb${transferParameter(TO, AMOUNT)}`;
    const digest = sha256Bytes(new Uint8Array(rawData.match(/.{2}/g)!.map((b) => parseInt(b, 16))));
    expect(verifyDigest(digest, broadcast.signature[0], publicKeyFromPrivate(HOT_KEY))).toBe(true);
  });

  it('если сеть отвергла вещание — ошибка с кодом', async () => {
    const { transport } = fakeTron({ rejectBroadcast: true });
    await expect(sendUsdt(transport, realSigner, {
      owner: OWNER, to: TO, amountMicro: AMOUNT, contract: USDT,
    })).rejects.toThrow(/broadcast_rejected/);
  });

  it('Signer не подпишет перевод другому получателю, чем в теле', async () => {
    const { transport } = fakeTron();
    const stranger = hexToBase58('41' + '99'.repeat(20));
    // Подменяем получателя уже после сборки: Signer обязан это заметить.
    const sneaky: SignerClient = {
      sign: (input) => realSigner.sign({ ...input, to: stranger }),
    };
    await expect(sendUsdt(transport, sneaky, {
      owner: OWNER, to: TO, amountMicro: AMOUNT, contract: USDT,
    })).rejects.toThrow(/destination_mismatch/);
  });
});
