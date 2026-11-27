// Исполнение сбора USDT с депозитных адресов (`pay/evm/sweeps.ts`).
//
// План (`evmSweepPlan`) проверяли отдельно — он только читает. Здесь то, ради чего
// сбор вообще опасная операция: подпись чужим ключом и отправка. Поэтому главные
// проверки не «сумма сошлась», а «ничего лишнего не ушло»: dryRun не пишет,
// повтор не начинает вторую транзакцию, отказ подписи освобождает nonce и
// оставляет след, а намерение сборки нельзя переписать задним числом.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import {
  SWEEP_CONFIRM, SWEEP_IDEM_PREFIX, SweepError, applyEvmSweepConfirmations,
  listSweeps, runEvmSweep, sweepCandidates, sweepGasCostWei,
} from '../../src/pay/evm/sweeps';
// Порог «сколько имеет смысл собирать» живёт рядом со шкалой баланса.
import { SWEEP_MIN_MICRO } from '../../src/pay/evm/balances';
import { deriveEvmKey } from '../../src/pay/evm/derivation';
import { evmAddressFromPrivateKey } from '../../src/pay/evm/address';
import { decodeSignedTx, signingHash, signingPayload } from '../../src/pay/evm/tx';
import { keccak256 } from '../../src/pay/crypto/keccak';
import { signDigest } from '../../src/pay/crypto/secp256k1';
import { bytesToHex, hexToBytes } from '../../src/pay/crypto/hmac';
import { microToChainValue } from '../../src/pay/units';
import type { RunSweepInput, SweepSignerClient } from '../../src/pay/evm/sweeps';
import type { EvmRpc } from '../../src/pay/evm/rpc';

const USDT = '0x55d398326f99059ff775485246999027b3197955';
const HOT = `0x${'99'.repeat(20)}`;
const GWEI = 1_000_000_000n;
const CHAIN_ID = 97;
const T0 = 1_700_000_000_000;
const SEED = '11'.repeat(32);
const FEE = 3n * GWEI;

/** Баланс игрока в единицах сети: micro → raw (18 знаков в BNB). */
function raw(micro: number): bigint {
  return microToChainValue(micro, 'bsc');
}

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

interface NodeState {
  /** адрес (lowercase) → USDT в micro */
  usdt?: Record<string, number>;
  /** адрес (lowercase) → нативная монета в wei */
  gas?: Record<string, bigint>;
  /** Нода не отвечает: «не прочитали», а не «пусто». */
  failRead?: boolean;
  receipt?: { status: boolean; blockNumber: number } | null;
  head?: number;
}

/** Подставная нода: `balanceOf`, баланс нативки, nonce, ставка газа, приём сырой транзакции. */
function node(state: NodeState = {}) {
  const sent: string[] = [];
  const rpc = {
    chainId: async () => CHAIN_ID,
    call: async (_to: string, data: string) => {
      if (state.failRead) throw new Error('no data');
      // `balanceOf(address)`: адрес — последний 32-байтный слот calldata.
      const who = `0x${data.slice(-40)}`.toLowerCase();
      return word(raw(state.usdt?.[who] ?? 0));
    },
    balance: async (address: string) => {
      if (state.failRead) throw new Error('no data');
      return state.gas?.[address.toLowerCase()] ?? 0n;
    },
    transactionCount: async () => 5,
    feeHistory: async () => ({ maxFeePerGas: FEE, maxPriorityFeePerGas: GWEI }),
    gasPrice: async () => 2n * GWEI,
    sendRawTransaction: async (rawTx: string) => {
      // Нода отвечает хешем принятого тела — ровно то, что сверяет воркер перед
      // тем, как записать txid. «Приняли одно, ответили другое» падает здесь.
      sent.push(rawTx);
      return bytesToHex(keccak256(hexToBytes(rawTx.slice(2))));
    },
    transactionReceipt: async () => (state.receipt === undefined ? null : state.receipt),
    blockNumber: async () => state.head ?? 1_000,
  };
  return { rpc: rpc as unknown as EvmRpc, sent };
}

/**
 * Подписант-заглушка: выводит ключ по индексу так же, как Signer (`SIGNER_SEED` +
 * `index`), и возвращает адрес, который реально получился. Поэтому «перепутали
 * индекс» в этом тесте не пройдёт незаметно.
 */
function signer(opts: { wrongFrom?: boolean; refuse?: string } = {}): SweepSignerClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    async signEvmSweep(request) {
      calls.push(request as unknown as Record<string, unknown>);
      if (opts.refuse) throw new Error(opts.refuse);
      const derived = await deriveEvmKey(SEED, request.index);
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
      const claimed = String(request.signingHash ?? '');
      if (claimed && claimed !== signingHash(tx)) throw new Error('hash_mismatch');
      const signed = signDigest(keccak256(signingPayload(tx)), derived.privateKey);
      return {
        signature: signed.signature,
        from: opts.wrongFrom ? `0x${'7'.repeat(40)}` : evmAddressFromPrivateKey(derived.privateKey),
      };
    },
  };
}

async function dbWith(rows: Array<{ address: string; user: string; index: number; chain?: 'bsc' | 'polygon' }>) {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  let i = 0;
  for (const row of rows) {
    i += 1;
    await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(`ad_${i}`, row.user, row.chain ?? 'bsc', row.address, row.address.slice(2), row.index, T0 - i).run();
  }
  return db;
}

/** Адрес и индекс из семени — так, как их выдал бы `/pay/address`. */
/**
 * Кошелёк игрока: адрес из семени по индексу. `user` — отдельный на каждый
 * индекс, потому что `pay_addresses.user_id` уникален в пределах сети: два адреса
 * одного игрока в одной цепи — это не «две строки», а «одна из них лишняя».
 */
async function wallet(index: number): Promise<{ address: string; user: string; index: number }> {
  const derived = await deriveEvmKey(SEED, index);
  // В базе адрес лежит в нижнем регистре (как его выдаёт `pay/addresses`), и
  // сверки идут по тому же виду: EIP-55 — для человека, канон — для сравнения.
  return { address: evmAddressFromPrivateKey(derived.privateKey).toLowerCase(), user: `u${index}`, index };
}

/** Адрес с «всё готово для сбора»: USDT выше минимума и нативка на один `transfer`. */
async function readyWallet(index: number, micro = 40_000_000) {
  const w = await wallet(index);
  return { wallet: w, state: { usdt: { [w.address.toLowerCase()]: micro }, gas: { [w.address.toLowerCase()]: sweepGasCostWei(FEE) } } };
}

const base = {
  chain: 'bsc' as const, chainId: CHAIN_ID, contract: USDT, network: 'testnet' as const,
  destination: HOT, actor: 'owner', idemKey: 'sweep-0001', dryRun: true, confirm: SWEEP_CONFIRM, now: T0,
};

describe('кандидаты на сбор', () => {
  it('берёт адрес только когда есть USDT не меньше минимума и есть газ', async () => {
    const enough = await wallet(1);
    const noGas = await wallet(2);
    const dust = await wallet(3);
    const db = await dbWith([enough, noGas, dust]);
    const n = node({
      usdt: {
        [enough.address.toLowerCase()]: SWEEP_MIN_MICRO,
        [noGas.address.toLowerCase()]: SWEEP_MIN_MICRO,
        [dust.address.toLowerCase()]: 1_000_000,
      },
      gas: {
        [enough.address.toLowerCase()]: sweepGasCostWei(FEE),
        [noGas.address.toLowerCase()]: 0n,
        [dust.address.toLowerCase()]: sweepGasCostWei(FEE),
      },
    });

    const found = await sweepCandidates({
      db, rpc: n.rpc, contract: USDT, chain: 'bsc', network: 'testnet', maxFeePerGas: FEE,
    });
    expect(found.candidates.map((r) => r.address)).toEqual([enough.address]);
    expect(found.skipped.map((r) => r.reason).sort()).toEqual(['below_minimum', 'no_gas']);
  });

  it('непрочитанный адрес — «не прочитали», а не «пусто»', async () => {
    const a = await wallet(1);
    const db = await dbWith([a]);
    const found = await sweepCandidates({
      db, rpc: node({ failRead: true }).rpc, contract: USDT, chain: 'bsc', network: 'testnet', maxFeePerGas: FEE,
    });
    expect(found.candidates).toEqual([]);
    expect(found.unreadable).toBe(1);
  });

  it('чужую сеть не трогает: polygon-адрес в bsc-выборку не попадает', async () => {
    const a = await wallet(1);
    const db = await dbWith([{ ...a, chain: 'polygon' }]);
    const found = await sweepCandidates({
      db, rpc: node({ usdt: { [a.address.toLowerCase()]: 20_000_000 } }).rpc,
      contract: USDT, chain: 'bsc', network: 'testnet', maxFeePerGas: FEE,
    });
    expect(found.candidates).toEqual([]);
  });

  it('сортировка — крупные вперёд, а не «первые N по дате»', async () => {
    const small = await wallet(4);
    const big = await wallet(5);
    const db = await dbWith([small, big]);
    const found = await sweepCandidates({
      db,
      rpc: node({
        usdt: { [small.address.toLowerCase()]: 12_000_000, [big.address.toLowerCase()]: 90_000_000 },
        gas: { [small.address.toLowerCase()]: sweepGasCostWei(FEE), [big.address.toLowerCase()]: sweepGasCostWei(FEE) },
      }).rpc,
      contract: USDT, chain: 'bsc', network: 'testnet', maxFeePerGas: FEE, limit: 1,
    });
    expect(found.candidates.map((r) => r.address)).toEqual([big.address]);
  });
});

describe('пробный проход', () => {
  it('dryRun ничего не пишет и не подписывает', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    const s = signer();

    const result = await runEvmSweep({ db, rpc: n.rpc, signer: s, ...base } as RunSweepInput);
    expect(result.dryRun).toBe(true);
    expect(result.totalMicro).toBe(40_000_000);
    expect(result.rows[0]).toMatchObject({ address: w.address.toLowerCase(), status: 'would_sweep', amount: '40.00' });
    expect(s.calls.length).toBe(0);
    expect(n.sent.length).toBe(0);
    expect(await listSweeps(db)).toEqual([]);
  });

  it('без слова подтверждения — отказ, и до сети мы не дошли', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    await expect(runEvmSweep({
      db, rpc: n.rpc, signer: signer(), ...base, dryRun: false, confirm: '',
    } as RunSweepInput)).rejects.toThrow(SweepError);
    expect(n.sent.length).toBe(0);
  });

  it('пустой получатель — отказ до чтения сети', async () => {
    const db = await dbWith([]);
    const n = node();
    await expect(runEvmSweep({ db, rpc: n.rpc, signer: signer(), ...base, destination: '' } as RunSweepInput))
      .rejects.toThrow('bad_destination');
    expect(n.sent.length).toBe(0);
  });

  it('короткий ключ идемпотентности — отказ: по нему ищут «что уже делали»', async () => {
    const db = await dbWith([]);
    await expect(runEvmSweep({ db, rpc: node().rpc, signer: signer(), ...base, idemKey: 'ab' } as RunSweepInput))
      .rejects.toThrow('bad_idem_key');
  });
});

describe('настоящий сбор', () => {
  it('один адрес: строка журнала, подпись ключом индекса, перевод на горячий кошелёк', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    const s = signer();

    const result = await runEvmSweep({ db, rpc: n.rpc, signer: s, ...base, dryRun: false, idemKey: 'sweep-run-1' } as RunSweepInput);
    expect(result.rows[0].status).toBe('broadcasting');
    expect(result.totalMicro).toBe(40_000_000);

    expect(s.calls[0]).toMatchObject({ index: 1, address: w.address.toLowerCase(), recipient: HOT, amountMicro: 40_000_000 });
    const tx = (s.calls[0] as { tx: Record<string, string | number> }).tx;
    expect(String(tx.to).toLowerCase()).toBe(USDT);
    expect(String(tx.value)).toBe('0');
    expect(String(tx.gasLimit)).toBe('80000');
    // Что реально ушло в сеть — `transfer` на наш кошелёк, а не «что-то похожее».
    const decoded = decodeSignedTx(n.sent[0]);
    expect(String(decoded.to).toLowerCase()).toBe(USDT);
    expect(decoded.value).toBe(0n);
    expect(decoded.data.slice(2, 10)).toBe('a9059cbb');
    // Слот получателя — второе слово calldata (не хвост: в хвосте сумма).
    expect(decoded.data.slice(2 + 8 + 24, 2 + 8 + 64)).toBe(HOT.slice(2));

    const rows = await listSweeps(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chain: 'bsc', address: w.address.toLowerCase(), userId: 'u1', amountMicro: 40_000_000,
      status: 'broadcasting', nonce: 5, derivationIndex: 1,
    });
    expect(rows[0].idemKey.startsWith(`${SWEEP_IDEM_PREFIX}sweep-run-1:`)).toBe(true);
    // Хеш в базе — без `0x`: обёртка RPC срезает префикс (`rpc.ts: return text.slice(2)`),
    // и им же сверяется `computed`. `transactionReceipt` добавляет `0x` обратно сам.
    expect(rows[0].txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('повтор по тому же адресу, пока попытка открыта, — пропуск, а не вторая транзакция', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    await runEvmSweep({ db, rpc: n.rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-run-2' } as RunSweepInput);
    expect(n.sent.length).toBe(1);

    const again = await runEvmSweep({ db, rpc: n.rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-run-3' } as RunSweepInput);
    expect(again.totalMicro).toBe(0);
    expect(again.rows[0]).toMatchObject({ status: 'skipped', error: 'sweep_in_progress' });
    expect(n.sent.length).toBe(1);
  });

  it('отказ подписи: nonce освобождён, строка в `failed`, сеть ничего не видела', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    const result = await runEvmSweep({
      db, rpc: n.rpc, signer: signer({ refuse: 'signer_sweep_disabled' }), ...base, dryRun: false, idemKey: 'sweep-run-4',
    } as RunSweepInput);
    expect(result.rows[0].status).toBe('failed');
    expect(result.rows[0].error).toContain('signer_sweep_disabled');
    expect(n.sent.length).toBe(0);

    // Замок nonce снят: «попробуй позже» не должно блокировать адрес навсегда.
    const locks = await db.prepare("SELECT COUNT(*) AS n FROM pay_operations WHERE scope = 'evm_nonce'")
      .first<{ n: number }>();
    expect(Number(locks?.n ?? 0)).toBe(0);
    const [row] = await listSweeps(db);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('signer_sweep_disabled');
  });

  it('Signer назвал чужой адрес — не отправляем ничего', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    const result = await runEvmSweep({
      db, rpc: n.rpc, signer: signer({ wrongFrom: true }), ...base, dryRun: false, idemKey: 'sweep-run-5',
    } as RunSweepInput);
    expect(result.rows[0].error).toBe('signer_address_mismatch');
    expect(n.sent.length).toBe(0);
  });

  it('нода назвала чужой хеш — строка не «confirmed» по подставному txid', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const honest = node(state);
    const lying = {
      ...honest.rpc,
      sendRawTransaction: async () => `0x${'f'.repeat(64)}`,
    } as EvmRpc;
    const result = await runEvmSweep({
      db, rpc: lying, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-run-7',
    } as RunSweepInput);
    expect(result.rows[0].error).toBe('tx_hash_mismatch');
  });

  it('намерение неизменяемо: сумму и получателя задним числом не правят', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const result = await runEvmSweep({
      db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-run-8',
    } as RunSweepInput);
    const id = result.rows[0].id;
    expect(id).not.toBe('');
    await expect(db.prepare('UPDATE pay_sweeps SET amount_micro = 1 WHERE id = ?').bind(id).run()).rejects.toThrow(/immutable/);
    await expect(db.prepare('UPDATE pay_sweeps SET destination = ? WHERE id = ?')
      .bind(`0x${'11'.repeat(20)}`, id).run()).rejects.toThrow(/immutable/);
    await expect(db.prepare('UPDATE pay_sweeps SET address = ? WHERE id = ?')
      .bind(`0x${'22'.repeat(20)}`, id).run()).rejects.toThrow(/immutable/);
    // Статус и txid — можно: это движение попытки, а не намерения.
    await expect(db.prepare("UPDATE pay_sweeps SET status = 'sent' WHERE id = ?").bind(id).run()).resolves.toBeTruthy();
  });
});

describe('подтверждения сети', () => {
  it('квитанции нет → ждём; есть и хватает блоков → confirmed', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const waiting = node(state);
    const result = await runEvmSweep({ db, rpc: waiting.rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-confirm-1' } as RunSweepInput);
    expect(result.rows[0].id).not.toBe('');

    expect(await applyEvmSweepConfirmations(db, waiting.rpc, 3, T0 + 1000, 'bsc'))
      .toMatchObject({ checked: 1, confirmed: 0, pending: 1 });
    // Открытая попытка всё ещё есть — новый сбор по этому адресу запрещён.
    expect((await runEvmSweep({ db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-confirm-1b' } as RunSweepInput)).rows[0].error)
      .toBe('sweep_in_progress');

    const n = node({ ...state, receipt: { status: true, blockNumber: 998 }, head: 1001 });
    expect(await applyEvmSweepConfirmations(db, n.rpc, 3, T0 + 2000, 'bsc'))
      .toMatchObject({ checked: 1, confirmed: 1, pending: 0 });
    expect((await listSweeps(db, 5))[0].status).toBe('confirmed');

    // 1001 − 998 + 1 = 4 ≥ 3 — подтвердили. При меньшей глубине остаёмся в `sent`.
    const shallow = node({ ...state, receipt: { status: true, blockNumber: 1000 }, head: 1001 });
    await runEvmSweep({ db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-confirm-2' } as RunSweepInput);
    expect(await applyEvmSweepConfirmations(db, shallow.rpc, 3, T0 + 3000, 'bsc'))
      .toMatchObject({ confirmed: 0, pending: 1 });
  });

  it('реверт — failed с причиной; после этого адрес снова можно собрать', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    await runEvmSweep({ db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-revert-1' } as RunSweepInput);
    const n = node({ ...state, receipt: { status: false, blockNumber: 999 }, head: 1001 });
    expect(await applyEvmSweepConfirmations(db, n.rpc, 3, T0 + 1000, 'bsc')).toMatchObject({ reverted: 1, confirmed: 0 });
    expect((await listSweeps(db))[0]).toMatchObject({ status: 'failed', error: 'reverted' });

    const again = await runEvmSweep({ db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-revert-2' } as RunSweepInput);
    expect(again.rows[0].status).toBe('broadcasting');
  });

  it('чужую сеть не сверяем: bsc-строку через polygon-проход не «теряем»', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    await runEvmSweep({ db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-chain-1' } as RunSweepInput);
    expect(await applyEvmSweepConfirmations(db, node().rpc, 3, T0 + 1000, 'polygon')).toMatchObject({ checked: 0 });
  });
});

describe('сбор не трогает баланс игрока', () => {
  it('ни `payout`, ни `adjust`: в `pay_ledger` после сбора пусто', async () => {
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    await runEvmSweep({ db, rpc: node(state).rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-ledger-1' } as RunSweepInput);

    const { results } = await db.prepare('SELECT reason, delta FROM pay_ledger').all<{ reason: string; delta: number }>();
    expect(results ?? []).toEqual([]);
    // Аудит есть: без него «деньги переехали» неотличимо от сбоя.
    const audit = await db.prepare("SELECT action, target FROM pay_audit_log WHERE action = 'sweep'")
      .all<{ action: string; target: string }>();
    expect((audit.results ?? []).length).toBeGreaterThan(0);
  });

  it('собранный адрес не зачисляется себе как депозит (нет петли)', async () => {
    // `to` перевода — горячий кошелёк, а не адрес игрока: сканер кредитует по
    // получателю, и «сбор = депозит» означал бы бесконечное самозачисление.
    const { wallet: w, state } = await readyWallet(1);
    const db = await dbWith([w]);
    const n = node(state);
    await runEvmSweep({ db, rpc: n.rpc, signer: signer(), ...base, dryRun: false, idemKey: 'sweep-loop-1' } as RunSweepInput);
    const decoded = decodeSignedTx(n.sent[0]);
    expect(decoded.data.slice(2 + 8 + 24, 2 + 8 + 64)).not.toBe(w.address.slice(2).toLowerCase());
  });
});
