// Балансы и план сбора в BNB Chain.
//
// Здесь живут те самые «а на чём платить комиссию» цифры. На BSC USDT сам себя
// перевести не может: адрес игрока, которому мы показали `0x…`, приходит с
// нулём BNB, и сбор с него невозможен, пока газ туда не занесли. План обязан это
// показывать деньгами, а не одной ошибкой «недостаточно газа».
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import {
  BALANCE_OF_SELECTOR, GAS_TOPUP_WEI, SWEEP_MIN_MICRO, balanceOfCalldata, evmAccountBalances,
  evmHotWalletState, evmPayoutBlocker, formatBnb, gasCostWei, parseBalanceWord, usdtBalanceMicro,
} from '../../src/pay/evm/balances';
import { PAYOUT_GAS_LIMIT } from '../../src/pay/evm/broadcast';
import { evmSweepPlan, evmActiveAddresses, formatSweepTotals } from '../../src/pay/evm/sweep';

const USDT = '0x55d398326f99059ff775485246999027b3197955';
const PLAYER = '0x' + '11'.repeat(20);
const T0 = 1_700_000_000_000;
const GWEI = 1_000_000_000n;

/** Слово-ответ `balanceOf`: 1 USDT = 10^18 на этой сети. */
function word(raw: bigint): string {
  return `0x${raw.toString(16).padStart(64, '0')}`;
}

function node(balances: Record<string, { usdtRaw: bigint; bnbWei: bigint; fail?: boolean }>) {
  const calls: string[] = [];
  const rpc = {
    call: async (to: string, data: string) => {
      calls.push(`${to}|${data.slice(0, 10)}`);
      const key = `0x${data.slice(10 + 24)}`.toLowerCase();
      const row = balances[key];
      if (!row || row.fail) throw new Error('no data');
      return word(row.usdtRaw);
    },
    balance: async (address: string) => {
      const row = balances[address.toLowerCase()];
      if (!row || row.fail) throw new Error('no data');
      return row.bnbWei;
    },
  };
  return { rpc: rpc as never, calls };
}

async function dbWithAddresses(rows: Array<{ address: string; user: string; active?: number }>) {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  let i = 0;
  for (const row of rows) {
    i += 1;
    await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(`ad_${i}`, row.user, row.address, row.address.slice(2), i, row.active ?? 1, T0 - i).run();
  }
  return db;
}

describe('шкала и разбор ответов', () => {
  it('`balanceOf` — это селектор + адрес в 32-байтном слоте', () => {
    const data = balanceOfCalldata(PLAYER);
    expect(data.startsWith(`0x${BALANCE_OF_SELECTOR}`)).toBe(true);
    // Слот 32 байта: 24 нуля слева + адрес. Если адрес не вписать в слот,
    // `balanceOf` вернёт баланс какого-нибудь мусорного адреса, а не игрока.
    expect(data.slice(2 + 8)).toBe(`${'0'.repeat(24)}${PLAYER.slice(2)}`);
  });

  it('18 знаков: 1 USDT = 1 000 000 micro, пыль в хвосте отбрасывается', async () => {
    const { rpc } = node({
      [PLAYER]: { usdtRaw: 10n ** 18n, bnbWei: 0n },
      ['0x' + '22'.repeat(20)]: { usdtRaw: 10n ** 18n + 5n * 10n ** 11n, bnbWei: 0n },
    });
    expect((await evmAccountBalances(rpc, USDT, PLAYER)).usdtMicro).toBe(1_000_000);
    expect((await evmAccountBalances(rpc, USDT, `0x${'22'.repeat(20)}`)).usdtMicro).toBe(1_000_000);
    expect(await usdtBalanceMicro(rpc, USDT, PLAYER)).toBe(1_000_000);
  });

  it('`null` от ноды — это ошибка, а не «ноль на счету»', () => {
    expect(() => parseBalanceWord(null)).toThrow('bad_balance_word');
    expect(() => parseBalanceWord('')).toThrow('bad_balance_word');
    expect(parseBalanceWord('0x0000000000000000000000000000000000000000000000000000000000000000')).toBe(0n);
    // Верхняя граница uint256 должна влезать в BigInt без потерь.
    expect(parseBalanceWord(`0x${'f'.repeat(64)}`)).toBe(2n ** 256n - 1n);
  });

  it('цена перевода = лимит газа × ставка; формат BNB режет хвост', () => {
    expect(gasCostWei(GWEI)).toBe(PAYOUT_GAS_LIMIT * GWEI);
    expect(formatBnb(5_000_000_000_000_000n)).toBe('0.0050');
    expect(formatBnb(0n)).toBe('0.0000');
    expect(formatBnb(2n * 10n ** 18n + 123450000000000000n)).toBe('2.1234');
  });
});

describe('вердикт «чем платить»', () => {
  it('не хватает USDT — одно, не хватает газа — другое', () => {
    const fee = gasCostWei(GWEI);
    expect(evmPayoutBlocker({ usdtMicro: 100, gasWei: fee }, 1_000_000, fee)).toBe('hot_wallet_insufficient_usdt');
    expect(evmPayoutBlocker({ usdtMicro: 5_000_000, gasWei: fee - 1n }, 1_000_000, fee)).toBe('hot_wallet_no_bnb');
    expect(evmPayoutBlocker({ usdtMicro: 5_000_000, gasWei: fee }, 1_000_000, fee)).toBeNull();
  });

  it('кошелёк без адреса — `hot_wallet_missing`, а не «ноль на счету»', async () => {
    const { rpc } = node({});
    const state = await evmHotWalletState(rpc, USDT, '', 1_000_000, GWEI);
    expect(state).toMatchObject({ error: 'hot_wallet_missing', blocker: null, usdt: '0.00' });
  });

  it('нода легла → `chain_error` и без вердикта: отправку это не блокирует', async () => {
    const { rpc } = node({});
    const state = await evmHotWalletState(rpc, USDT, PLAYER, 1_000_000, GWEI);
    expect(state).toMatchObject({ error: 'chain_error', blocker: null, shortfallMicro: 1_000_000 });
  });

  it('баланс прочитался → blocker и нехватка считаются честно', async () => {
    const { rpc } = node({ [PLAYER]: { usdtRaw: 2n * 10n ** 18n, bnbWei: 10n ** 16n } });
    const state = await evmHotWalletState(rpc, USDT, PLAYER, 5_000_000, gasCostWei(GWEI));
    expect(state).toMatchObject({
      error: null, usdtMicro: 2_000_000, usdt: '2.00',
      blocker: 'hot_wallet_insufficient_usdt', shortfallMicro: 3_000_000, shortfall: '3.00',
    });
    expect(state.bnb).toBe('0.0100'); // 1e16 wei = 0.01 BNB
  });
});

describe('план сбора в BSC', () => {
  it('читает только `0x…`-адреса и только активные', async () => {
    const db = await dbWithAddresses([
      { address: PLAYER, user: 'u1' },
      { address: 'T' + 'x'.repeat(33), user: 'u2' },
      { address: '0x' + '33'.repeat(20), user: 'u3', active: 0 },
    ]);
    const set = await evmActiveAddresses(db, 10);
    expect(set.rows.map((r) => r.address)).toEqual([PLAYER]);
    expect(set.total).toBe(1);
    expect(set.truncated ?? set.total > set.rows.length).toBe(false);
  });

  it('три состояния адреса: можно забрать, уперлось в газ, слишком мелко', async () => {
    const a = PLAYER;
    const b = '0x' + '22'.repeat(20);
    const c = '0x' + '33'.repeat(20);
    const db = await dbWithAddresses([
      { address: a, user: 'u1' }, { address: b, user: 'u2' }, { address: c, user: 'u3' },
    ]);
    const fee = gasCostWei(GWEI);
    const { rpc } = node({
      // 12 USDT и газ есть — заберём.
      [a]: { usdtRaw: 12n * 10n ** 18n, bnbWei: fee },
      // 50 USDT, газа нет — сбор упирается в BNB.
      [b]: { usdtRaw: 50n * 10n ** 18n, bnbWei: 0n },
      // 1 USDT — ниже планки: комиссия съест смысл.
      [c]: { usdtRaw: 1n * 10n ** 18n, bnbWei: fee },
    });

    const plan = await evmSweepPlan({
      db, rpc, contract: USDT, network: 'mainnet', destination: '0x' + 'aa'.repeat(20),
      sweepEnabled: true, maxFeePerGas: GWEI, now: T0,
    });

    expect(plan.rows.map((r) => r.blocker)).toEqual([null, 'bnb_missing', 'below_min']);
    expect(plan.totals).toMatchObject({
      usdtMicro: 63_000_000,
      sweepableMicro: 12_000_000,
      belowMinMicro: 1_000_000,
      feePerSweepWei: fee,
    });
    // Не хватает ровно `fee` на одном адресе.
    expect(plan.totals.gasNeededWei).toBe(fee);
    expect(plan.ready).toBe(true);
    expect(plan.reason).toBe(null);
  });

  it('газ нужен с запасом: «недостаточно» считает верхнюю оценку, а не ноль', async () => {
    const db = await dbWithAddresses([{ address: PLAYER, user: 'u1' }]);
    const fee = gasCostWei(GWEI);
    const { rpc } = node({ [PLAYER]: { usdtRaw: 20n * 10n ** 18n, bnbWei: fee / 2n } });
    const plan = await evmSweepPlan({
      db, rpc, contract: USDT, network: 'mainnet', destination: '0x' + 'aa'.repeat(20),
      sweepEnabled: true, maxFeePerGas: GWEI, now: T0,
    });
    expect(plan.totals.gasNeededWei).toBe(fee - fee / 2n);
    // Для человека: суммарно «занести» = нехватка + минимальный запас на адрес.
    const display = formatSweepTotals(plan);
    expect(display.bnbNeeded).toBe(formatBnb(fee - fee / 2n + GAS_TOPUP_WEI));
    expect(display.usdt).toBe('20.00');
  });

  it('один битый адрес не роняет план: он виден как `chain_error`', async () => {
    const broken = '0x' + '99'.repeat(20);
    const db = await dbWithAddresses([{ address: PLAYER, user: 'u1' }, { address: broken, user: 'u2' }]);
    const { rpc } = node({
      [PLAYER]: { usdtRaw: 15n * 10n ** 18n, bnbWei: gasCostWei(GWEI) },
      [broken]: { usdtRaw: 0n, bnbWei: 0n, fail: true },
    });
    const plan = await evmSweepPlan({
      db, rpc, contract: USDT, network: 'mainnet', destination: '0x' + 'aa'.repeat(20),
      sweepEnabled: true, maxFeePerGas: GWEI, now: T0,
    });
    expect(plan.rows.map((r) => r.blocker)).toEqual([null, 'chain_error']);
    expect(plan.totals.sweepableMicro).toBe(15_000_000);
    expect(plan.rows[1].error).toBeTruthy();
  });

  it('флаг выключен или кошелька нет — план read-only и с причиной', async () => {
    const db = await dbWithAddresses([{ address: PLAYER, user: 'u1' }]);
    const { rpc } = node({ [PLAYER]: { usdtRaw: 15n * 10n ** 18n, bnbWei: gasCostWei(GWEI) } });
    const base = { db, rpc, contract: USDT, network: 'mainnet' as const, maxFeePerGas: GWEI, now: T0 };

    await expect(evmSweepPlan({ ...base, destination: '', sweepEnabled: true }))
      .resolves.toMatchObject({ ready: false, reason: 'hot_wallet_missing' });
    await expect(evmSweepPlan({ ...base, destination: '0x' + 'aa'.repeat(20), sweepEnabled: false }))
      .resolves.toMatchObject({ ready: false, reason: 'sweep_disabled' });
  });

  it('планка min такая же, как у TRON — 10 USDT', async () => {
    expect(SWEEP_MIN_MICRO).toBe(10_000_000);
    expect(GAS_TOPUP_WEI).toBeLessThan(10n ** 17n); // 0.005 BNB — не «полкошелька»
  });
});
