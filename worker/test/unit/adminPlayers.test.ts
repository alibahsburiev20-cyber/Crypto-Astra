// Операции админа над игроком: карточка, блокировка входа, закрытие аккаунта.
//
// Главное, что здесь закреплено: «удалить игрока» не может съесть его деньги.
// Пока на балансе лежит хоть одна micro-USDT или висит незакрытая заявка,
// закрытие отказывает — иначе остаток становится невыплачиваемым, а виной тому
// кнопка в админке.
import { beforeEach, describe, expect, it } from 'vitest';
import { blockPlayer, closePlayer, playerSummary, revokeAllSessions, unblockPlayer } from '../../src/admin/players';
import { adminPlayerClose } from '../../src/routes/admin';
import { errorResponse } from '../../src/http/response';
import { resetAdminSchemaForTests, ADMIN_SCHEMA_STATEMENTS } from '../../src/admin/schema';
import { adminTestDb, credit, payAddress, withdrawal } from '../helpers/adminDb';
import { readAdminAudit } from '../../src/admin/accounts';
import type { Env } from '../../src/env';

const T0 = Date.now();

function envOf(users: Parameters<typeof adminTestDb>[0], sessions: Parameters<typeof adminTestDb>[1] = []) {
  const { db, raw } = adminTestDb(users, sessions, T0);
  // Маршрут пишет след в `admin_audit`; в рантайме таблицы создаёт self-heal.
  for (const sql of ADMIN_SCHEMA_STATEMENTS) raw.exec(sql);
  const identity: string[] = [];
  const env = {
    DB: db,
    ADMIN_TOKEN: 'test-admin-token-for-unit-32ch',
    WORLD: {
      idFromName: (name: string) => ({ name }),
      get: () => ({
        async adminPlayer(playerId: string) {
          return { id: playerId, label: 'Пилот', level: 3, xp: 0, astra: 120, points: 7, ships: 1, frozen: false };
        },
        async clearIdentity(playerId: string) { identity.push(playerId); return { ok: true }; },
      }),
    },
  } as unknown as Env;
  return { env, db, raw, identity };
}

beforeEach(() => resetAdminSchemaForTests());

describe('карточка игрока', () => {
  it('собирает аккаунт, деньги и сессии в одном месте', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1', email: 'pilot@example.com', worldId: 'w2', telegramId: 'tg_1' }],
      [{ userId: 'u1' }, { userId: 'u1', revokedAt: T0 - 10 }, { userId: 'u1', expiresAt: T0 - 1000 }]);
    credit(raw, 'u1', 2_500_000);
    payAddress(raw, 'u1');
    withdrawal(raw, 'u1', 'broadcasting');
    withdrawal(raw, 'u1', 'confirmed');

    const card = await playerSummary(db, 'u1', { astra: 120, level: 3, points: 7 });
    expect(card).toMatchObject({
      id: 'u1', email: 'pilot@example.com', status: 'active', worldId: 'w2',
      telegram: true, sessions: 1, payBalanceMicro: 2_500_000, openWithdrawals: 1,
    });
    expect(card.addresses).toEqual([{ chain: 'polygon', address: expect.any(String), active: 1 }]);
    // Почта и id телеграма — да; сам хеш пароля и сам id телеграма — нет.
    expect(JSON.stringify(card)).not.toContain('tg_1');
    expect(JSON.stringify(card)).not.toContain('hash');
  });

  it('в карточке нет личных данных: хеш пароля и id телеграма наружу не уходят', async () => {
    const { db } = adminTestDb([{ id: 'u1', email: 'a@b.test', telegramId: 'tg_secret' }]);
    const json = JSON.stringify(await playerSummary(db, 'u1'));
    expect(json).not.toContain('tg_secret');
    expect(json).toContain('"telegram":true');
  });

  it('нет игрока — 404 своим кодом', async () => {
    const { db } = adminTestDb([]);
    await expect(playerSummary(db, 'ghost')).rejects.toThrow(/player_not_found/);
  });
});

describe('блокировка входа', () => {
  it('ставит blocked и отзывает активные сессии', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }], [{ userId: 'u1' }, { userId: 'u1', revokedAt: T0 - 5 }]);
    const res = await blockPlayer(db, 'u1', T0);
    expect(res).toEqual({ sessions: 1, alreadyBlocked: false });
    expect(raw.prepare('SELECT status FROM users').get()).toEqual({ status: 'blocked' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get()).toEqual({ n: 0 });
    // Данные на месте: блокировка — не удаление. Пароль и почта целы.
    expect(raw.prepare('SELECT email, password_hash FROM users').get()).toEqual({ email: null, password_hash: 'hash' });
  });

  it('повторная блокировка — не ошибка, и сессии всё равно отзываются', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }]);
    expect(await blockPlayer(db, 'u1', T0)).toEqual({ sessions: 0, alreadyBlocked: false });
    // Между двумя нажатиями игрок мог войти заново — отзываем и во второй раз.
    raw.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('s_new', 'u1', 'h_new', T0 + 1000, T0);
    expect(await blockPlayer(db, 'u1', T0 + 5)).toEqual({ sessions: 1, alreadyBlocked: true });
  });

  it('разблокировка работает только над заблокированным', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }]);
    await expect(unblockPlayer(db, 'u1')).rejects.toThrow(/not_blocked/);
    await blockPlayer(db, 'u1', T0);
    await unblockPlayer(db, 'u1');
    expect(raw.prepare('SELECT status FROM users').get()).toEqual({ status: 'active' });
  });

  it('закрытый аккаунт «заблокировать» уже нельзя', async () => {
    const { db } = adminTestDb([{ id: 'u1', status: 'deleted' }]);
    await expect(blockPlayer(db, 'u1', T0)).rejects.toThrow(/player_already_closed/);
  });
});

describe('закрытие аккаунта админом', () => {
  it('ненулевой баланс — отказ, аккаунт остаётся целым', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }]);
    credit(raw, 'u1', 1);
    await expect(closePlayer(db, 'u1', T0)).rejects.toThrow(/player_has_funds/);
    const row = raw.prepare('SELECT status, email, password_hash FROM users').get() as Record<string, unknown>;
    expect(row).toEqual({ status: 'active', email: null, password_hash: 'hash' });
  });

  it('висящая заявка — отказ, даже если на балансе ноль', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }]);
    credit(raw, 'u1', 1_000_000);
    withdrawal(raw, 'u1', 'approved');
    // Списали весь остаток проводкой «payout» — заявок в работе это не отменяет.
    raw.prepare(
      `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
       VALUES ('pl_out', 'u1', 'USDT', -1000000, 'payout', 'tx', 'k_out', 'p2', 'h2', ?)`,
    ).run(T0);
    await expect(closePlayer(db, 'u1', T0)).rejects.toThrow(/player_has_funds/);
  });

  it('обнулённый баланс и закрытая заявка больше не мешают', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }]);
    credit(raw, 'u1', 1_000_000);
    const id = withdrawal(raw, 'u1', 'approved');
    // Выплата закрыта «как в жизни»: обратной проводкой и переводом заявки в
    // `confirmed`. Правкой той же строки тут пахнет на триггер «append-only».
    credit(raw, 'u1', -1_000_000, 'payout_1', T0 + 1, 'payout');
    raw.prepare(`UPDATE pay_withdrawals SET status = 'confirmed' WHERE id = ?`).run(id);
    const res = await closePlayer(db, 'u1', T0);
    expect(res).toMatchObject({ closedAt: T0, sessions: 0, balanceMicro: 0 });
  });

  it('стирает почту и пароль, отзывает сессии, освобождает позывной', async () => {
    const { db, raw, identity } = envOf([{ id: 'u1', email: 'pilot@example.com', worldId: 'w1' }], [{ userId: 'u1' }]);
    const res = await closePlayer(db, 'u1', T0);
    expect(res).toMatchObject({ sessions: 1, wiped: { email: true, password: true } });
    const row = raw.prepare('SELECT status, email, password_hash FROM users').get() as Record<string, unknown>;
    expect(row).toEqual({ status: 'deleted', email: null, password_hash: null });
    // Освобождение позывного — дело маршрута (он стучится в DO), а не этой
    // функции: здесь проверяем, что для мира игрок ещё существует и его монеты
    // не «сгорают» вместе с аккаунтом.
    expect(identity).toEqual([]);
  });

  it('повторное закрытие — 409, а не «успех»', async () => {
    const { db } = adminTestDb([{ id: 'u1', status: 'deleted' }]);
    await expect(closePlayer(db, 'u1', T0)).rejects.toThrow(/player_already_closed/);
  });

  it('баланс не прочитан — закрытия не будет', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }]);
    raw.exec('DROP TABLE pay_ledger');
    await expect(closePlayer(db, 'u1', T0)).rejects.toThrow(/pay_unavailable/);
  });
});

describe('маршрут закрытия', () => {
  const request = (body: unknown) => new Request('https://astra.example/admin/player/close', {
    method: 'POST',
    headers: { 'X-Admin-Token': 'test-admin-token-for-unit-32ch', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const run = async (env: Env, body: unknown) => {
    try {
      return await adminPlayerClose(request(body), env);
    } catch (e) {
      return errorResponse(e);
    }
  };

  it('без DELETE и без причины — отказ, аккаунт целой', async () => {
    const { env, raw } = envOf([{ id: 'u1', email: 'pilot@example.com' }]);
    expect((await run(env, { player: 'pilot@example.com', reason: 'просьба игрока' })).status).toBe(400);
    expect((await run(env, { player: 'pilot@example.com', confirm: 'DELETE' })).status).toBe(400);
    expect((await run(env, { player: 'pilot@example.com', reason: 'x', confirm: 'delete' })).status).toBe(400);
    expect(raw.prepare('SELECT status FROM users').get()).toEqual({ status: 'active' });
  });

  it('успех: игрок закрыт, в журнале — причина и актор', async () => {
    const { env, raw, identity } = envOf([{ id: 'u1', email: 'pilot@example.com' }], [{ userId: 'u1' }]);
    const res = await run(env, { player: 'pilot@example.com', reason: 'по просьбе игрока', confirm: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { balanceMicro: number; sessions: number };
    expect(body).toMatchObject({ balanceMicro: 0, sessions: 1 });
    expect(raw.prepare('SELECT status, email FROM users').get()).toEqual({ status: 'deleted', email: null });
    expect(identity).toEqual(['u1']);
    const entries = await readAdminAudit(env.DB, 5);
    expect(entries[0]).toMatchObject({ action: 'player_close', target: 'u1', role: 'owner', actor: 'owner' });
    expect(entries[0].payload).toMatchObject({ reason: 'по просьбе игрока' });
  });

  it('мир недоступен — аккаунт всё равно закрыт, и это записано отдельной строкой', async () => {
    const { env, raw } = envOf([{ id: 'u1', email: 'pilot@example.com' }]);
    env.WORLD = {
      idFromName: () => ({ name: 'w1' }),
      get: () => ({ async clearIdentity() { throw new Error('DO unavailable'); } }),
    } as unknown as Env['WORLD'];
    const res = await run(env, { player: 'pilot@example.com', reason: 'чит', confirm: 'DELETE' });
    expect(res.status).toBe(200);
    expect(raw.prepare('SELECT status FROM users').get()).toEqual({ status: 'deleted' });
    const actions = (await readAdminAudit(env.DB, 5)).map((e) => e.action);
    expect(actions).toContain('player_close_identity_stale');
    expect(actions).toContain('player_close');
    // Ответ честно говорит про занятый позывной: «всё чисто» при незакрытом
    // хвосте означало бы, что оператор придёт к игроку с занятым именем.
    const body = await res.json() as { identityReleased: boolean; note: string };
    expect(body.identityReleased).toBe(false);
    expect(body.note).toContain('позывной остался занят');
  });
});

describe('отзыв сессий', () => {
  it('считает только живые и не трогает отозванные', async () => {
    const { db, raw } = adminTestDb([{ id: 'u1' }], [
      { userId: 'u1' }, { userId: 'u1' }, { userId: 'u1', revokedAt: T0 - 100 },
    ]);
    expect(await revokeAllSessions(db, 'u1', T0)).toBe(2);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get()).toEqual({ n: 0 });
  });
});
