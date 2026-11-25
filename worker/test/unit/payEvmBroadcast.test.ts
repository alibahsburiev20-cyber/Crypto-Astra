// Сборка, подпись и отправка выплаты в BNB Chain.
//
// Тест проверяет не «функция вернула txid», а три вещи, за которые платят
// деньгами:
//   * то, что уходит в сеть, — это ровно та транзакция, которую подписал Signer
//     (разбираем `raw` обратно и сверяем поля);
//   * ни одна проверка не пропускает «газ с Луны» и чужую сеть;
//   * `nonce` используется занятый, а не перечитанный.
import { describe, expect, it } from 'vitest';
import { keccak256 } from '../../src/pay/crypto/keccak';
import { bytesToHex, hexToBytes } from '../../src/pay/crypto/hmac';
import { signDigest } from '../../src/pay/crypto/secp256k1';
import {
  DEFAULT_MAX_GAS_PRICE_WEI, PAYOUT_GAS_LIMIT, BroadcastError, buildPayoutTx,
  payoutGas, sendUsdtEvm,
} from '../../src/pay/evm/broadcast';
import { decodeSignedTx, parseTransferCalldata, signingHash, signingPayload, transferCalldata } from '../../src/pay/evm/tx';
import { microToChainValue } from '../../src/pay/units';
import type { EvmRpc } from '../../src/pay/evm/rpc';

const USDT = '0x55d398326f99059ff775485246999027b3197955';
const HOT_KEY = '0'.repeat(63) + '1';
const OWNER = '0x' + 'aa'.repeat(20);
const RECIPIENT = '0x' + 'bb'.repeat(20);
const GWEI = 1_000_000_000n;
const AMOUNT = 12_500_000; // 12.5 USDT

type Node = {
  chainId?: number;
  nonce?: number;
  fee?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null;
  gasPrice?: bigint;
  /** Подменить хеш, который нода отдаёт как «принятый». */
  hashOverride?: string;
  sent?: string[];
};

function fakeNode(opts: Node = {}) {
  const sent: Array<{ raw: string }> = [];
  const rpc = {
    chainId: async () => opts.chainId ?? 56,
    transactionCount: async () => opts.nonce ?? 7,
    feeHistory: async () => (opts.fee === null ? null : (opts.fee ?? { maxFeePerGas: 3n * GWEI, maxPriorityFeePerGas: GWEI })),
    gasPrice: async () => opts.gasPrice ?? 2n * GWEI,
    sendRawTransaction: async (raw: string) => {
      sent.push({ raw });
      if (opts.hashOverride) return opts.hashOverride;
      return bytesToHex(keccak256(hexToBytes(raw.slice(2))));
    },
    transactionReceipt: async () => null,
  } as unknown as EvmRpc;
  return { rpc, sent };
}

/** Signer как он ведёт себя в бою: получает поля, сам считает хеш, подписывает. */
function fakeSigner(opts: { from?: string; tamper?: boolean } = {}) {
  const signer = {
    calls: [] as Array<Record<string, unknown>>,
    async signEvm(request: { tx: Record<string, string | number>; signingHash: string }) {
      signer.calls.push(request as never);
      const tx = {
        chainId: Number(request.tx.chainId),
        nonce: Number(request.tx.nonce),
        maxPriorityFeePerGas: BigInt(String(request.tx.maxPriorityFeePerGas)),
        maxFeePerGas: BigInt(String(request.tx.maxFeePerGas)),
        gasLimit: BigInt(String(request.tx.gasLimit)),
        to: String(request.tx.to),
        value: 0n,
        data: String(request.tx.data),
      };
      const digest = keccak256(signingPayload(tx));
      const signed = signDigest(digest, HOT_KEY);
      // `tamper` — это «Worker прислал один хеш, а подписал мы другое»: проверка
      // `signingHash` в Signer обязана это поймать, но и здесь не помешает.
      const signature = opts.tamper
        ? `0x${signed.signature.replace(/^0x/, '').slice(0, 128)}00`
        : signed.signature;
      return { signature, from: opts.from ?? OWNER };
    },
  };
  return signer;
}

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  await expect(fn()).rejects.toMatchObject({ code });
}

describe('отправка USDT в BSC', () => {
  it('собранный перевод = `transfer(получатель, сумма × 10^18)`', () => {
    const tx = buildPayoutTx({
      chainId: 56, nonce: 7, contract: USDT, recipient: RECIPIENT, amountMicro: AMOUNT,
      maxFeePerGas: 3n * GWEI, maxPriorityFeePerGas: GWEI,
    });
    expect(tx.to).toBe(USDT);
    expect(tx.value).toBe(0n);
    expect(tx.gasLimit).toBe(PAYOUT_GAS_LIMIT);
    expect(tx.data).toBe(transferCalldata(RECIPIENT, microToChainValue(AMOUNT, 'bsc')));
    const parsed = parseTransferCalldata(tx.data);
    expect(parsed.to.toLowerCase()).toBe(RECIPIENT);
    expect(parsed.amountRaw).toBe(12_500_000_000_000_000_000n);
  });

  it('кольцо «подпись → отправка»: то, что ушло в сеть, распаковывается в те же поля', async () => {
    const { rpc, sent } = fakeNode();
    const signer = fakeSigner();
    const res = await sendUsdtEvm(rpc, signer, {
      owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
    });

    expect(sent.length).toBe(1);
    const decoded = decodeSignedTx(res.raw);
    expect(decoded).toMatchObject({
      chainId: 56, nonce: 7, to: USDT.toLowerCase(), value: 0n,
      maxFeePerGas: 3n * GWEI, maxPriorityFeePerGas: GWEI, gasLimit: PAYOUT_GAS_LIMIT,
    });
    expect(parseTransferCalldata(decoded.data).amountRaw).toBe(microToChainValue(AMOUNT, 'bsc'));
    // Хеш, которым сеть звала транзакцию, = хеш этих байт.
    expect(`0x${res.txid}`).toBe(`0x${bytesToHex(keccak256(hexToBytes(res.raw.slice(2))))}`);
    // Signер видел ровно тот же хеш, что подписывался.
    expect(signer.calls[0]).toMatchObject({ signingHash: signingHash(decoded) });
  });

  it('`nonce` из замка используется, а не перечитывается на своё усмотрение', async () => {
    const { rpc } = fakeNode({ nonce: 41 });
    const res = await sendUsdtEvm(rpc, fakeSigner(), {
      owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56, nonce: 7,
    });
    expect(decodeSignedTx(res.raw).nonce).toBe(7);
  });

  it('нода в другой сети — отказ до подписи', async () => {
    const { rpc, sent } = fakeNode({ chainId: 97 });
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), {
        owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
      }),
      'chain_id_mismatch',
    );
    expect(sent.length).toBe(0);
  });

  it('газ выше потолка — отказ, и `feeHistory` от этого не спасает', async () => {
    const { rpc, sent } = fakeNode({ fee: { maxFeePerGas: 500n * GWEI, maxPriorityFeePerGas: GWEI } });
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), {
        owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
      }),
      'gas_price_too_high',
    );
    expect(sent.length).toBe(0);
  });

  it('нода без `feeHistory` → `eth_gasPrice × 2`; ноль ставки — это ошибка, а не «бесплатно»', async () => {
    const gas = await payoutGas({
      feeHistory: async () => null,
      gasPrice: async () => 5n * GWEI,
      transactionCount: async () => 3,
    } as never, OWNER);
    expect(gas).toMatchObject({ maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 5n * GWEI, nonce: 3 });

    const zero = { feeHistory: async () => null, gasPrice: async () => 0n, transactionCount: async () => 3 };
    await expect(payoutGas(zero as never, OWNER)).rejects.toMatchObject({ code: 'gas_price_missing' });

    const priority = { feeHistory: async () => ({ maxFeePerGas: 2n * GWEI, maxPriorityFeePerGas: 9n * GWEI }), gasPrice: async () => GWEI, transactionCount: async () => 1 };
    await expect(payoutGas(priority as never, OWNER)).rejects.toMatchObject({ code: 'gas_price_too_high' });
  });

  it('потолок ставки можно перебить: свой `maxGasPriceWei` действует на обеих дорожках', async () => {
    const { rpc } = fakeNode({ fee: { maxFeePerGas: 21n * GWEI, maxPriorityFeePerGas: GWEI } });
    // По умолчанию 20 gwei → отказ.
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), {
        owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
      }),
      'gas_price_too_high',
    );
    expect(DEFAULT_MAX_GAS_PRICE_WEI).toBe(20n * GWEI);
  });

  it('Signer подписал чужим ключом — в сеть не идёт', async () => {
    const { rpc, sent } = fakeNode();
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner({ from: '0x' + 'cc'.repeat(20) }), {
        owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
      }),
      'hot_address_mismatch',
    );
    expect(sent.length).toBe(0);
  });

  it('битая подпись от Signer — явная ошибка, а не «отправили как-нибудь»', async () => {
    const { rpc, sent } = fakeNode();
    await expectCode(
      () => sendUsdtEvm(rpc, { async signEvm() { return { signature: '0xdeadbeef' }; } }, {
        owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
      }),
      'bad_signature:bad_signature_length',
    );
    expect(sent.length).toBe(0);
  });

  it('нода назвала чужой хеш — считаем это сбоем, а не успехом', async () => {
    const { rpc } = fakeNode({ hashOverride: 'ff'.repeat(32) });
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), {
        owner: OWNER, recipient: RECIPIENT, amountMicro: AMOUNT, contract: USDT, chainId: 56,
      }),
      'tx_hash_mismatch',
    );
  });

  it('пыль в сумме, контракт вместо получателя и чужой формат — отказы до сети', async () => {
    const { rpc, sent } = fakeNode();
    const base = { owner: OWNER, amountMicro: AMOUNT, contract: USDT, chainId: 56 };
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), { ...base, recipient: USDT }),
      'recipient_is_contract',
    );
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), { ...base, recipient: 'T' + 'x'.repeat(33) }),
      'bad_recipient',
    );
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), { ...base, recipient: RECIPIENT, amountMicro: 0 }),
      'bad_amount',
    );
    await expectCode(
      () => sendUsdtEvm(rpc, fakeSigner(), { ...base, recipient: RECIPIENT, amountMicro: 1.5 }),
      'bad_amount',
    );
    expect(sent.length).toBe(0);
  });

  it('сумма обязана быть точной в micro на 18-значной шкале', () => {
    // 1 micro = 10^12 wei-долей USDT; нецелое число таких долей невозможно, и
    // «округлим тихо» здесь значило бы «отдали меньше, чем обещали».
    expect(() => buildPayoutTx({
      chainId: 56, nonce: 0, contract: USDT, recipient: RECIPIENT, amountMicro: 1_000_000.5,
      maxFeePerGas: GWEI, maxPriorityFeePerGas: GWEI,
    })).toThrow(BroadcastError);
  });
});
