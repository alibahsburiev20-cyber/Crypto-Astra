// Маршрут ручной корректировки USDT: `/admin/pay/adjust`.
//
// Юнит-тест `payAdjust.test.ts` проверяет арифметику и границы. Здесь важно другое:
// что маршрут НЕ разрешает тем, кому нельзя (помощнику — `owner_only`), что
// молчаливый вызов без `dryRun: false` ничего не пишет, и что коды отказа доходят
// до клиента своими статусами — по ним админка и объясняет оператору, что делать.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminTestDb, credit, withdrawal } from '../helpers/adminDb';
import { payBalanceMicro } from '../../src/pay/ledger';
import { adminPayAdjust, adminPayAdjustInfo } from '../../src/routes/pay';
import { errorResponse } from '../../src/http/response';
import { createAdminInvite } from '../../src/admin/accounts';
import { resetAdminSchemaForTests } from '../../src/admin/schema';
import { resetPaySchemaForTests } from '../../src/pay/schema';
import { ADJUST_CONFIRM } from '../../src/pay/adjust';
import type { Env } from '../../src/env';

const ADMIN_TOKEN = 'test-admin-token-for-unit-32ch';
const T0 = Date.now();

function build(payments = true) {
  const { db, raw } = adminTestDb([{ id: 'player-1', email: 'pilot@example.com', worldId: 'w1' }], [], T0);
  credit(raw, 'player-1', 10_000_000);
  const env = {
    DB: db, ADMIN_TOKEN,
    // Флаг читается строго: `isOn` признаёт только 'on', поэтому 'off' и пустая
    // строка — «выключено», и проверка «не включено» в тесте честная.
    PAYMENTS_ENABLED: payments ? 'on' : 'off',
  } as unknown as Env;
  return { env, raw, db };
}

const req = (path: string, init: RequestInit = {}) => new Request(`https://astra.example${path}`, init);
const adminHeaders = (extra: Record<string, string> = {}) => ({ 'X-Admin-Token': ADMIN_TOKEN, ...extra });

async function run(handler: (request: Request, env: Env) => Promise<Response>, request: Request, env: Env) {
  try {
    return await handler(request, env);
  } catch (e) {
    return errorResponse(e);
  }
}

const post = (env: Env, body: Record<string, unknown>) => run(adminPayAdjust, req('/admin/pay/adjust', {
  method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
}), env);

beforeEach(() => { resetAdminSchemaForTests(); resetPaySchemaForTests(); });

describe('границы доступа к списанию', () => {
  it('помощнику — 403, и он ничего не списал', async () => {
    const { env, db } = build();
    const invite = await createAdminInvite(db, {
      label: 'Помощник', grantLimit: 5000, days: 7, note: 'тест', actor: 'owner', now: T0,
    });

    const res = await run(adminPayAdjust, req('/admin/pay/adjust', {
      method: 'POST',
      headers: { 'X-Admin-Key': invite.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'player-1', amount: '-5', reason: 'хочу списать', idem: 'adj-key-1', dryRun: false, confirm: ADJUST_CONFIRM }),
    }), env);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('owner_only');
    expect(await payBalanceMicro(db, 'player-1')).toBe(10_000_000);
  });

  it('информация о списании — тоже только владельцу', async () => {
    const { env, db } = build();
    const invite = await createAdminInvite(db, { label: 'Помощник', grantLimit: 5000, days: 7, note: 'тест', actor: 'owner', now: T0 });
    const res = await run(adminPayAdjustInfo, req('/admin/pay/adjust?player=player-1', {
      headers: { 'X-Admin-Key': invite.key },
    }), env);
    expect(res.status).toBe(403);
  });

  it('выключенный денежный контур — 503, а не «тихий отказ»', async () => {
    const { env } = build(false);
    const res = await post(env, { player: 'player-1', amount: '-1', reason: 'проба', idem: 'adj-key-2' });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe('payments_disabled');
  });
});

describe('тело запроса', () => {
  it('молчаливый вызов не пишет: dryRun по умолчанию', async () => {
    const { env, db } = build();
    const res = await post(env, { player: 'player-1', amount: '-4', reason: 'возврат покупки', idem: 'adj-key-3' });
    expect(res.status).toBe(200);
    const data = await res.json() as { adjust: { dryRun: boolean; balanceAfterMicro: number } };
    expect(data.adjust.dryRun).toBe(true);
    expect(data.adjust.balanceAfterMicro).toBe(6_000_000);
    expect(await payBalanceMicro(db, 'player-1')).toBe(10_000_000);
  });

  it('без слова подтверждения — 400 своим кодом, проводки нет', async () => {
    const { env, db } = build();
    const res = await post(env, { player: 'player-1', amount: '-4', reason: 'возврат покупки', idem: 'adj-key-4', dryRun: false });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('confirm_required');
    expect(await payBalanceMicro(db, 'player-1')).toBe(10_000_000);
  });

  it('отрицательный баланс — 409 своим кодом', async () => {
    const { env } = build();
    const res = await post(env, { player: 'player-1', amount: '-11', reason: 'вся жизнь', idem: 'adj-key-5', dryRun: false, confirm: ADJUST_CONFIRM });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('balance_below_zero');
  });

  it('письмо игрока и email принимаются, чужого игрока — 404', async () => {
    const { env, db } = build();
    const ok = await post(env, { email: 'pilot@example.com', amount: '-1', reason: 'комбо', idem: 'adj-key-6', dryRun: false, confirm: ADJUST_CONFIRM });
    expect(ok.status).toBe(201);
    expect((await ok.json() as { resolvedBy: string }).resolvedBy).toBe('email');
    expect(await payBalanceMicro(db, 'player-1')).toBe(9_000_000);

    const ghost = await post(env, { player: 'player-9', amount: '-1', reason: 'комбо', idem: 'adj-key-7' });
    expect(ghost.status).toBe(404);
  });
});

describe('заявка на вывод важнее кнопки', () => {
  it('списание не съедает обещанные деньги', async () => {
    const { env, raw, db } = build();
    withdrawal(raw, 'player-1', 'requested'); // 1 USDT, ещё не списан в резерв

    // 10 − 9.1 = 0.9 USDT: формально «в плюс», но обещанного доллара уже не
    // хватает, и резерв упадёт посреди очереди. Поэтому отказ.
    const res = await post(env, { player: 'player-1', amount: '-9.1', reason: 'штраф', idem: 'adj-key-8', dryRun: false, confirm: ADJUST_CONFIRM });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('below_pending_withdrawals');
    expect(await payBalanceMicro(db, 'player-1')).toBe(10_000_000);
  });

  it('владелец видит резерв ещё до попытки', async () => {
    const { env, raw } = build();
    withdrawal(raw, 'player-1', 'approved');
    const res = await run(adminPayAdjustInfo, req('/admin/pay/adjust?player=player-1', { headers: adminHeaders() }), env);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      player: { balance: string; pending: string; canAdjustDownMicro: number };
      maxAdjust: string; confirm: string; actor: string;
    };
    expect(data.player.balance).toBe('10.00');
    expect(data.player.pending).toBe('1.00');
    expect(data.player.canAdjustDownMicro).toBe(9_000_000);
    expect(data.maxAdjust).toBe('5000.00');
    expect(data.confirm).toBe(ADJUST_CONFIRM);
    expect(data.actor).toBe('owner');
  });
});
