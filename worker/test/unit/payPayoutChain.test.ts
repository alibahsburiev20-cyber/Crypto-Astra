// Шкала и нода выплаты — по СЕТИ заявки, а не «как в BNB».
//
// Это про деньги, а не про косметика. Два способа потерять их молча, которые
// закрыты здесь:
//   * сумма в `data` считается в 18 знаков, потому что «сеть была одна»: для
//     Polygon (6 знаков) это «в 1e12 раз больше, чем просили»;
//   * баланс кошелька читается той же чужой шкалой: «на кошельке ноль, платить
//     нечем» там, где лежат деньги (и наоборот).
// Плюс выбор ноды: `PAY_CHAIN` может смениться между заявкой и кнопкой
// «отправить», и тогда polygon-перевод искали бы через BNB-RPC.
import { describe, expect, it } from 'vitest';
import { buildPayoutTx, PAYOUT_GAS_LIMIT, evmRpcFor, sendUsdtEvm } from '../../src/pay/evm/broadcast';
import { decodeSignedTx, parseTransferCalldata, signingPayload, transferCalldata } from '../../src/pay/evm/tx';
import { evmAccountBalances, evmHotWalletState, usdtBalanceMicro } from '../../src/pay/evm/balances';
import { microToChainValue } from '../../src/pay/units';
import { chainSpec } from '../../src/pay/chain';
import { payFlags } from '../../src/pay/flags';
import { payoutTxCheck } from '../../../scripts/lib/rehearse';
import type { EvmRpc } from '../../src/pay/evm/rpc';
import { keccak256 } from '../../src/pay/crypto/keccak';
import { bytesToHex, hexToBytes } from '../../src/pay/crypto/hmac';
import { signDigest } from '../../src/pay/crypto/secp256k1';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';

const BNB_USDT = '0x55d398326f99059ff775485246999027b3197955';
const POL_USDT = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
const HOT_KEY = '0'.repeat(63) + '1';
const OWNER = '0x' + 'aa'.repeat(20);
const RECIPIENT = '0x' + 'bb'.repeat(20);
const GWEI = 1_000_000_000n;
const THREE_USDT = 3_000_000;

const base = {
  nonce: 7,
  recipient: RECIPIENT,
  amountMicro: THREE_USDT,
  maxFeePerGas: 3n * GWEI,
  maxPriorityFeePerGas: GWEI,
};

describe('шкала `data` выплаты — по сети', () => {
  it('BNB: 3 USDT = 3 × 10^18 (18 знаков)', () => {
    const tx = buildPayoutTx({ ...base, chainId: 56, contract: BNB_USDT, chain: 'bsc' });
    expect(parseTransferCalldata(tx.data).amountRaw).toBe(3_000_000_000_000_000_000n);
    expect(tx.data).toBe(transferCalldata(RECIPIENT, microToChainValue(THREE_USDT, 'bsc')));
  });

  it('Polygon: те же 3 USDT = 3 000 000 (6 знаков), а не в триллион раз больше', () => {
    const tx = buildPayoutTx({ ...base, chainId: 137, contract: POL_USDT, chain: 'polygon' });
    const raw = parseTransferCalldata(tx.data).amountRaw;
    expect(raw).toBe(3_000_000n);
    // Страховка от «починили одним местом, а второе осталось»: ровно та сумма,
    // которую вернула бы общая функция пересчёта для этой сети.
    expect(raw).toBe(microToChainValue(THREE_USDT, 'polygon'));
    // И это НЕ та транзакция, что собрала бы шкала BNB.
    expect(tx.data).not.toBe(buildPayoutTx({ ...base, chainId: 137, contract: POL_USDT, chain: 'bsc' }).data);
  });

  it('`chain` не передана — BNB (историческое поведение), Polygon обязан назвать себя', () => {
    const implicit = buildPayoutTx({ ...base, chainId: 56, contract: BNB_USDT });
    const explicit = buildPayoutTx({ ...base, chainId: 56, contract: BNB_USDT, chain: 'bsc' });
    expect(implicit.data).toBe(explicit.data);
  });

  it('провоживающий скрипт сверяет ту же шкалу: 3 USDT в Polygon = 3 000_000', () => {
    const tx = buildPayoutTx({ ...base, chainId: 137, contract: POL_USDT, chain: 'polygon' });
    const verdict = payoutTxCheck({
      got: { to: tx.to, chainId: tx.chainId, nonce: tx.nonce, gasLimit: tx.gasLimit, value: tx.value, data: tx.data },
      want: { contract: POL_USDT, chainId: 137, nonce: 7, gasLimit: PAYOUT_GAS_LIMIT, recipient: RECIPIENT, amountMicro: THREE_USDT, decimals: 6 },
    });
    expect(verdict.checks.every((c) => c.status === 'ok')).toBe(true);
    // А проверка «как в BNB» (18 знаков) обязана на этом же теле сказать «fail».
    const asBsc = payoutTxCheck({
      got: { to: tx.to, chainId: tx.chainId, nonce: tx.nonce, gasLimit: tx.gasLimit, value: tx.value, data: tx.data },
      want: { contract: POL_USDT, chainId: 137, nonce: 7, gasLimit: PAYOUT_GAS_LIMIT, recipient: RECIPIENT, amountMicro: THREE_USDT, decimals: 18 },
    });
    expect(asBsc.checks.some((c) => c.step === 'сумма' && c.status === 'fail')).toBe(true);
  });
});

describe('балансы EVM — шкалой своей сети', () => {
  /** `balanceOf` отвечает «3 USDT» числом своей сети; `eth_getBalance` — 1 BNB/POL. */
  const node = (raw: bigint) => ({
    call: async () => `0x${raw.toString(16).padStart(64, '0')}`,
    balance: async () => 10n ** 18n,
  }) as unknown as EvmRpc;

  it('Polygon: 3 000 000 raw = 3.0 USDT', async () => {
    expect(await usdtBalanceMicro(node(3_000_000n), POL_USDT, OWNER, 'polygon')).toBe(3_000_000);
    const balances = await evmAccountBalances(node(3_000_000n), POL_USDT, OWNER, 'polygon');
    expect(balances.usdtMicro).toBe(3_000_000);
    expect(balances.gasWei).toBe(10n ** 18n);
  });

  it('BNB: 3 × 10^18 raw = 3.0 USDT', async () => {
    expect(await usdtBalanceMicro(node(3_000_000_000_000_000_000n), BNB_USDT, OWNER, 'bsc')).toBe(3_000_000);
  });

  it('чужая шкала не «ноль», а явная ошибка: тишины про баланс не бывает', async () => {
    // Polygon-остаток, прочитанный 18-значной шкалой, — это доля micro, то есть
    // «ниже точности». `units.ts` на такое кидается, а не округляет до нуля, и
    // это то, что нужно: «кошелёк пуст» и «мы не смогли прочитать» — разные
    // решения для оператора.
    await expect(usdtBalanceMicro(node(3_000_000n), POL_USDT, OWNER, 'bsc'))
      .rejects.toThrowError(expect.objectContaining({ code: 'amount_below_precision' }));
    // В обратную сторону — тоже не молчание: BNB-остаток, прочитанный как
    // 6-значный, даёт триллион «найденных» долларов, и `units.ts` отсекает это
    // как число за пределами safe-int. Оба конца ошибки видимы, и именно поэтому
    // шкалу нельзя угадывать по «сети по умолчанию».
    await expect(usdtBalanceMicro(node(3_000_000_000_000_000_000n), BNB_USDT, OWNER, 'polygon'))
      .rejects.toThrowError(expect.objectContaining({ code: 'amount_too_big' }));
  });

  it('состояние кошелька для Polygon не «пусто», а «хватает»', async () => {
    const wallet = await evmHotWalletState(node(3_000_000n), POL_USDT, OWNER, 2_000_000, 1n, 'polygon');
    expect(wallet.error).toBeNull();
    expect(wallet.usdtMicro).toBe(3_000_000);
    expect(wallet.blocker).toBeNull();
    // Та же база, но «POL-кошелёк прочитан шкалой BNB»: вместо баланса — ошибка
    // чтения, и она обязана остаться видимой (не превратиться в «денег нет»).
    const wrongScale = await evmHotWalletState(node(3_000_000n), POL_USDT, OWNER, 2_000_000, 1n, 'bsc');
    expect(wrongScale.error).toBe('chain_error');
    expect(wrongScale.usdtMicro).toBe(0);
  });
});

describe('нода выплаты — по сети заявки', () => {
  const env = (patch: Record<string, string> = {}) => ({
    PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet',
    PAY_EVM_CHAINS: 'bnb,polygon',
    PAY_EVM_CONTRACT_BNB: BNB_USDT, PAY_EVM_CONTRACT_POL: POL_USDT,
    PAY_EVM_RPC_BNB: 'https://bnb-rpc.example/',
    PAY_EVM_RPC_POL: 'https://polygon-rpc.example/',
    ...patch,
  }) as never;

  const specOf = (env_: never, chain: 'bsc' | 'polygon') =>
    chainSpec(env_, { ...payFlags(env_), chain } as never);

  it('Polygon-спека даёт Polygon-RPC, а не «цепь не EVM»', async () => {
    // Раньше здесь стоял отказ `chain_not_evm` для всего, что не BSC: выплаты в
    // Polygon физически не могли уйти.
    const ask = async (chain: 'bsc' | 'polygon') => {
      const url = { current: '' };
      const fetchImpl = (async (input: RequestInfo | URL) => {
        url.current = String(input);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x65' }), {
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;
      const env_ = env();
      const rpc = evmRpcFor(env_, fetchImpl, specOf(env_, chain) as never);
      await rpc.blockNumber();
      return url.current;
    };
    expect(await ask('polygon')).toBe('https://polygon-rpc.example/');
    expect(await ask('bsc')).toBe('https://bnb-rpc.example/');
  });

  it('TRON-цепь в EVM-транспорт не пускается', () => {
    const env_ = env({ PAY_CHAIN: 'tron', PAY_EVM_CHAINS: 'bnb' });
    expect(() => evmRpcFor(env_, fetch, chainSpec(env_, payFlags(env_)) as never)).toThrowError(
      expect.objectContaining({ code: 'chain_not_evm' }),
    );
  });
});

describe('отправка выплаты: та же шкала до ноды и в ответе', () => {
  it('`sendUsdtEvm` в Polygon несёт 6-значную сумму и отправляет ровно то, что подписал Signer', async () => {
    const sent: string[] = [];
    const rpc = {
      chainId: async () => 137,
      transactionCount: async () => 0,
      feeHistory: async () => ({ maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: 2n * GWEI }),
      gasPrice: async () => 20n * GWEI,
      call: async () => `0x${(10_000_000n).toString(16).padStart(64, '0')}`,
      balance: async () => 10n ** 18n,
      sendRawTransaction: async (raw: string) => {
        sent.push(raw);
        return bytesToHex(keccak256(hexToBytes(raw.slice(2))));
      },
      transactionReceipt: async () => null,
    } as unknown as EvmRpc;
    const signer = {
      async signEvm(request: { tx: Record<string, string | number>; signingHash: string }) {
        // Как настоящий Signer: пересобирает тело из полей, сверяет дайджест и
        // подписывает своим ключом — иначе тест проверял бы «что-то ушло», а не
        // «ушло то, что подписано».
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
        const digest = bytesToHex(keccak256(signingPayload(tx)));
        expect(String(request.signingHash).toLowerCase().replace(/^0x/, ''))
          .toBe(digest.replace(/^0x/, ''));
        const signed = signDigest(keccak256(signingPayload(tx)), HOT_KEY);
        return { signature: signed.signature, from: OWNER };
      },
    };
    const res = await sendUsdtEvm(rpc, signer, {
      owner: OWNER, recipient: RECIPIENT, amountMicro: THREE_USDT,
      contract: POL_USDT, chainId: 137, chain: 'polygon', nonce: 0, maxGasPriceWei: 100n * GWEI,
    });
    expect(sent).toHaveLength(1);
    expect(res.raw).toBe(sent[0]);
    // То, что ушло в сеть, распаковывается в ту же 6-значную сумму.
    expect(parseTransferCalldata(decodeSignedTx(res.raw).data).amountRaw).toBe(3_000_000n);
    expect(res.maxCostWei).toBe(PAYOUT_GAS_LIMIT * 30n * GWEI);
  });
});

describe('заявка платит в своей сети, когда активная уже другая', () => {
  it('строка `chain=polygon` + активная цепь `bsc` → сумма в 6 знаков', async () => {
    // Проверяем то, ради чего `pay_withdrawals.chain` вообще существует: в
    // момент отправки воркер обязан взять шкалу, контракт и ноду ИЗ СТРОКИ.
    resetPaySchemaForTests();
    const { db } = makeD1();
    await ensurePaySchema(db);
    const row = await db.prepare(
      `INSERT INTO pay_withdrawals (id, user_id, chain, address, amount_micro, status, idem_key, created_at)
       VALUES ('wd_pol', 'u1', 'polygon', ?, 2000000, 'requested', 'k_pol', 1700000000000)`,
    ).bind(RECIPIENT).run();
    expect(row).toBeTruthy();
    const stored = await db.prepare('SELECT chain FROM pay_withdrawals WHERE id = ?')
      .bind('wd_pol').first<{ chain: string }>();
    expect(stored?.chain).toBe('polygon');

    const env = {
      PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet', PAY_EVM_CHAINS: 'bnb,polygon',
      PAY_EVM_CONTRACT_BNB: BNB_USDT, PAY_EVM_CONTRACT_POL: POL_USDT,
    } as never;
    const spec = chainSpec(env, { ...payFlags(env), chain: 'polygon' } as never);
    // Спецификация активной цепи при этом остаётся BNB — вот её-то и нельзя
    // подставлять в выплату, которая была подана в Polygon.
    const active = chainSpec(env, payFlags(env));
    expect([spec.chain, active.chain]).toEqual(['polygon', 'bsc']);
    expect([spec.decimals, active.decimals]).toEqual([6, 18]);

    const tx = buildPayoutTx({
      chainId: spec.chainId ?? 137, nonce: 0, contract: spec.contract,
      recipient: RECIPIENT, amountMicro: 2_000_000,
      maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: 2n * GWEI, chain: spec.chain,
    });
    expect(parseTransferCalldata(tx.data).amountRaw).toBe(2_000_000n);
  });
});
