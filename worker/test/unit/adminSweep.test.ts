// Маршруты исполнения сбора: `POST /admin/pay/sweep/run` и `GET /admin/pay/sweeps`.
//
// `payEvmSweepRun.test.ts` проверяет сам исполнитель на подставной ноде. Здесь
// важно другое: кто имеет право нажать кнопку, в каком порядке стоят гейты и каким
// статусом отказ доходит до админки. Порядок принципиален: «Signer не настроен»
// (503) вместо «это действие только для владельца» (403) подсказывал бы оператору
// чинить конфигурацию там, где прав не было вовсе.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminTestDb } from '../helpers/adminDb';
import { adminPaySweepRun, adminPaySweeps } from '../../src/routes/pay';
import { errorResponse } from '../../src/http/response';
import { createAdminInvite } from '../../src/admin/accounts';
import { resetAdminSchemaForTests } from '../../src/admin/schema';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { SWEEP_CONFIRM } from '../../src/pay/evm/sweeps';
import type { Env } from '../../src/env';

const ADMIN_TOKEN = 'test-admin-token-for-unit-32ch';
const T0 = Date.now();
const HOT = '0x1111111111111111111111111111111111111111';

/**
 * `sweep` — `SWEEP_ENABLED`, `hot` — `PAY_HOT_ADDRESS`, `net` — сеть (`PAY_NETWORK`).
 * RPC и контракт намеренно не задаём: до живой сети эти тесты доходить не должны,
 * а если дойдут — начнётся запрос в интернет, и тест перестанет быть тестом.
 */
function build(opts: { payments?: boolean; sweep?: boolean; hot?: boolean; network?: string } = {}) {
  const { db } = adminTestDb([{ id: 'player-1', email: 'pilot@example.com', worldId: 'w1' }], [], T0);
  const env = {
    DB: db,
    ADMIN_TOKEN,
    PAYMENTS_ENABLED: opts.payments === false ? 'off' : 'on',
    SWEEP_ENABLED: opts.sweep === false ? 'off' : 'on',
    PAY_HOT_ADDRESS: opts.hot === false ? '' : (opts.hot || HOT),
    PAY_NETWORK: opts.network ?? 'nile',
    PAY_CHAIN: 'bsc',
    PAY_EVM_CHAINS: 'bsc,polygon',
  } as unknown as Env;
  return { env, db };
}

const req = (path: string, init: RequestInit = {}) => new Request(`https://astra.example${path}`, init);
const ownerHeaders = (extra: Record<string, string> = {}) => ({ 'X-Admin-Token': ADMIN_TOKEN, ...extra });

async function run(handler: (request: Request, env: Env) => Promise<Response>, request: Request, env: Env) {
  try {
    return await handler(request, env);
  } catch (e) {
    return errorResponse(e);
  }
}

const post = (env: Env, body: Record<string, unknown>, headers: Record<string, string> = ownerHeaders()) =>
  run(adminPaySweepRun, req('/admin/pay/sweep/run', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env);

beforeEach(() => { resetAdminSchemaForTests(); resetPaySchemaForTests(); });

describe('доступ к кнопке сбора', () => {
  it('помощнику — 403 owner_only, и он не дошёл ни до Signer, ни до сети', async () => {
    const { env, db } = build();
    const invite = await createAdminInvite(db, {
      label: 'Помощник', grantLimit: 5000, days: 7, note: 'тест', actor: 'owner', now: T0,
    });
    const res = await post(env, { chain: 'bsc', dryRun: false, confirm: SWEEP_CONFIRM, idem: 'sweep-key-1' }, { 'X-Admin-Key': invite.key });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('owner_only');
    // Ни одной строки намерения: отказ случился до чтения балансов. Таблицы при
    // 403 никто не создавал (`ensurePaySchema` стоит ПОСЛЕ проверки роли), поэтому
    // поднимаем схему сами — проверяем пустоту журнала, а не её отсутствие.
    await ensurePaySchema(db);
    const { listSweeps } = await import('../../src/pay/evm/sweeps');
    expect(await listSweeps(db)).toEqual([]);
  });

  it('журнал сборов помощник видит: это чтение, а не подпись', async () => {
    const { env, db } = build();
    const invite = await createAdminInvite(db, { label: 'Помощник', grantLimit: 5000, days: 7, note: 'тест', actor: 'owner', now: T0 });
    const res = await run(adminPaySweeps, req('/admin/pay/sweeps', { headers: { 'X-Admin-Key': invite.key } }), env);
    expect(res.status).toBe(200);
    const data = await res.json() as { sweeps: unknown[]; confirm: string; runLimit: number; flags: Record<string, unknown> };
    expect(data.sweeps).toEqual([]);
    expect(data.confirm).toBe(SWEEP_CONFIRM);
    expect(data.flags.payments).toBe(true);
  });
});

describe('гейты перед сбором', () => {
  it('выключенный денежный контур — 503 payments_disabled', async () => {
    const { env } = build({ payments: false });
    const res = await post(env, { chain: 'bsc', dryRun: true });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe('payments_disabled');
  });

  it('без SWEEP_ENABLED — 503 sweep_disabled, и это после проверки общего флага', async () => {
    const { env } = build({ sweep: false });
    const res = await post(env, { chain: 'bsc', dryRun: true });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe('sweep_disabled');
  });

  it('пустой PAY_HOT_ADDRESS — 503 hot_wallet_missing: некому отправлять', async () => {
    const { env } = build({ hot: false });
    const res = await post(env, { chain: 'bsc', dryRun: true });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe('hot_wallet_missing');
  });

  it('сеть без контракта USDT — 503 chain_not_configured (в тестнет-контрактов нет)', async () => {
    const { env } = build();
    for (const chain of ['bsc', 'polygon']) {
      const res = await post(env, { chain, dryRun: true });
      expect(res.status, chain).toBe(503);
      expect((await res.json() as { error: string }).error, chain).toBe('chain_not_configured');
    }
  });

  it('чужую сеть не собираем: 400 bad_chain', async () => {
    const { env } = build();
    const res = await post(env, { chain: 'tron', dryRun: true });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('bad_chain');
  });

  it('адрес игрока проверяется на месте: 400 bad_address, а не «не нашли»', async () => {
    const { env } = build();
    for (const address of ['0x123', 'TQrQg', '0x' + 'g'.repeat(40)]) {
      const res = await post(env, { chain: 'bsc', dryRun: true, address });
      expect(res.status, address).toBe(400);
      expect((await res.json() as { error: string }).error, address).toBe('bad_address');
    }
  });
});
