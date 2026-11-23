// План сбора (sweep) — чтение без движения денег.
//
// Смысл теста: админ должен видеть правду до того, как что-то подпишет.
// «Сколько лежит», «хватает ли TRX на комиссию» и «сколько докупить» считаются
// из ответа сети, а не из надежд; ошибка сети по одному адресу не прячет
// остальные и не превращается в «можно собирать».
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import {
  SWEEP_FEE_SUN, parseBalances, sweepChainDeps, sweepPlan,
} from '../../src/pay/sweep';
import { USDT_MAINNET, TRON_API_MAINNET } from '../../src/pay/tron/contracts';

const T0 = 1_700_000_000_000;
const DEST = 'TEpNofrztMUwq3HgRjQARLF4ScxSbWRgFp';

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  return db;
}

async function addAddress(db: D1Database, userId: string, address: string, index: number) {
  await db.prepare(
    `INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(`ad_${index}`, userId, address, `41${String(index).padStart(40, '0')}`, index, T0).run();
}

/** TronGrid по адресам: то, что реально отдаёт `/v1/accounts/{address}`. */
function fakeChain(map: Record<string, { trx?: number; usdt?: number } | 'error'>) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    const address = decodeURIComponent(url.split('/v1/accounts/')[1] ?? '');
    const entry = map[address];
    if (!entry || entry === 'error') throw new Error('http_503');
    return {
      data: [{
        balance: entry.trx ?? 0,
        trc20: entry.usdt === undefined ? [] : [{ [USDT_MAINNET]: String(entry.usdt) }],
      }],
    };
  };
  return { fetchJson, calls };
}

describe('план сбора USDT', () => {
  it('разбирает ответ TronGrid без домыслов', () => {
    expect(parseBalances({ data: [{ balance: 25_000_000, trc20: [{ [USDT_MAINNET]: '1500000' }] }] }, USDT_MAINNET))
      .toEqual({ trxSun: 25_000_000, usdtMicro: 1_500_000 });
    expect(parseBalances({ data: [] }, USDT_MAINNET)).toEqual({ trxSun: 0, usdtMicro: 0 });
    expect(parseBalances({}, USDT_MAINNET)).toEqual({ trxSun: 0, usdtMicro: 0 });
    // Чужой токен деньгами не считается.
    expect(parseBalances({ data: [{ balance: 0, trc20: [{ TMISSING: '999999' }] }] }, USDT_MAINNET).usdtMicro).toBe(0);
  });

  it('считает, что можно собрать и сколько TRX не хватает', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 1);
    await addAddress(db, 'u2', 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 2);
    await addAddress(db, 'u3', 'TCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 3);

    const { fetchJson } = fakeChain({
      // Хватает TRX — заберём 3 USDT.
      TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: { trx: 20_000_000, usdt: 3_000_000 },
      // USDT есть, TRX нет — сначала надо закинуть комиссию.
      TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: { trx: 0, usdt: 1_500_000 },
      // Пусто — собирать нечего.
      TCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC: { trx: 5_000_000, usdt: 0 },
    });

    const plan = await sweepPlan({
      db,
      deps: { fetchJson, apiBase: TRON_API_MAINNET, contract: USDT_MAINNET },
      network: 'mainnet', destination: DEST, sweepEnabled: true, now: T0,
    });

    expect(plan.addresses).toBe(3);
    expect(plan.ready).toBe(true);
    expect(plan.totals.usdtMicro).toBe(4_500_000);
    expect(plan.totals.sweepableMicro).toBe(4_500_000);
    expect(plan.totals.trxShortfallSun).toBe(SWEEP_FEE_SUN);

    const byAddr = new Map(plan.rows.map((r) => [r.address, r]));
    expect(byAddr.get('TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')?.blocker).toBeNull();
    expect(byAddr.get('TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')?.blocker).toBe('trx_missing');
    expect(byAddr.get('TCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC')?.blocker).toBe('no_usdt');
  });

  it('ошибка сети по адресу не отменяет план по остальным', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', 'TDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 1);
    await addAddress(db, 'u2', 'TEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', 2);

    const { fetchJson } = fakeChain({
      TDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD: 'error',
      TEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE: { trx: 30_000_000, usdt: 2_000_000 },
    });

    const plan = await sweepPlan({
      db,
      deps: { fetchJson, apiBase: TRON_API_MAINNET, contract: USDT_MAINNET },
      network: 'mainnet', destination: DEST, sweepEnabled: true, now: T0,
    });

    const broken = plan.rows.find((r) => r.address === 'TDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
    expect(broken?.blocker).toBe('chain_error');
    expect(broken?.error).toContain('http_503');
    expect(plan.totals.usdtMicro).toBe(2_000_000);
    expect(plan.rows.filter((r) => r.blocker === null)).toHaveLength(1);
  });

  it('без кошелька и без флага план не готов — и говорит почему', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', 'TFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 1);
    const { fetchJson } = fakeChain({
      TFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF: { trx: 20_000_000, usdt: 1_000_000 },
    });
    const deps = { fetchJson, apiBase: TRON_API_MAINNET, contract: USDT_MAINNET };

    const noDest = await sweepPlan({ db, deps, network: 'mainnet', destination: '', sweepEnabled: true, now: T0 });
    expect(noDest.ready).toBe(false);
    expect(noDest.reason).toBe('hot_wallet_missing');

    const noFlag = await sweepPlan({ db, deps, network: 'mainnet', destination: DEST, sweepEnabled: false, now: T0 });
    expect(noFlag.ready).toBe(false);
    expect(noFlag.reason).toBe('sweep_disabled');

    // План всё равно показывает суммы: владельцу нужно знать, что лежит.
    expect(noFlag.totals.usdtMicro).toBe(1_000_000);
  });

  it('сеть и контракт берутся из конфигурации, а не из кода', () => {
    const deps = sweepChainDeps(async () => ({}), 'nile', {});
    expect(deps.apiBase).toBe('https://nile.trongrid.io');
    expect(deps.contract).toBe('TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj');
    const mainnet = sweepChainDeps(async () => ({}), 'mainnet', {});
    expect(mainnet.apiBase).toBe(TRON_API_MAINNET);
    expect(mainnet.contract).toBe(USDT_MAINNET);
  });
});
