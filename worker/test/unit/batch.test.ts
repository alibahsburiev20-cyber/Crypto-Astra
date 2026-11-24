// Пачка игровых действий: один запрос вместо пяти.
//
// Смысл теста — не «пачка работает», а «пачка ничего не разрешает сверх
// одиночного запроса»: те же маршруты, тот же ключ идемпотентности, тот же
// бюджет, и деньги в пачку не складываются.
import { describe, expect, it } from 'vitest';
import {
  BATCH_ALLOWED, BATCH_MAX_OPS, parseBatchOps, runBatch,
} from '../../src/http/batch';

const op = (path: string, idem = 'key-0001') => ({ op: path, idem, body: {} });

describe('разбор пачки', () => {
  it('принимает разрешённые действия', () => {
    const parsed = parseBatchOps({ ops: [op('/claim'), { op: '/market/lot', idem: 'lot-00001', body: { amount: 3 } }] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ops).toHaveLength(2);
    expect(parsed.ops[1].body).toEqual({ amount: 3 });
  });

  it('деньги, вход, админка и сам batch — нельзя', () => {
    for (const path of ['/pay/purchase', '/auth/login', '/admin/pay', '/batch', '/me']) {
      expect(parseBatchOps({ ops: [op(path)] })).toEqual({ ok: false, error: 'op_not_allowed' });
    }
  });

  it('без ключа идемпотентности — отказ: повтор начислил бы дважды', () => {
    expect(parseBatchOps({ ops: [{ op: '/claim', body: {} }] })).toEqual({ ok: false, error: 'bad_idem_key' });
    expect(parseBatchOps({ ops: [{ op: '/claim', idem: 'short' }] })).toEqual({ ok: false, error: 'bad_idem_key' });
  });

  it('пустая, огромная и кривая пачка отвергаются', () => {
    expect(parseBatchOps({})).toEqual({ ok: false, error: 'bad_batch' });
    expect(parseBatchOps({ ops: [] })).toEqual({ ok: false, error: 'empty_batch' });
    expect(parseBatchOps({ ops: 'nope' })).toEqual({ ok: false, error: 'bad_batch' });
    expect(parseBatchOps({ ops: Array.from({ length: BATCH_MAX_OPS + 1 }, () => op('/claim'))}))
      .toEqual({ ok: false, error: 'batch_too_large' });
    expect(parseBatchOps({ ops: [{ op: '/claim', idem: 'key-0001', body: [1, 2] }] }))
      .toEqual({ ok: false, error: 'bad_op_body' });
  });

  it('в белом списке нет ничего денежного и админского', () => {
    for (const path of BATCH_ALLOWED) {
      expect(path.startsWith('/pay')).toBe(false);
      expect(path.startsWith('/admin')).toBe(false);
      expect(path.startsWith('/auth')).toBe(false);
    }
  });
});

describe('выполнение пачки', () => {
  const headers = new Headers({ authorization: 'Bearer test-token', cookie: 'rt=1' });

  it('выполняет по порядку и приносит авторизацию в каждую операцию', async () => {
    const seen: Array<{ path: string; idem: string | null; auth: string | null }> = [];
    const out = await runBatch({
      ops: [op('/claim', 'key-0001'), op('/market/buy', 'key-0002')],
      headers,
      dispatch: async (request) => {
        seen.push({
          path: new URL(request.url).pathname,
          idem: request.headers.get('idempotency-key'),
          auth: request.headers.get('authorization'),
        });
        return Response.json({ ok: true });
      },
    });

    expect(seen.map((s) => s.path)).toEqual(['/claim', '/market/buy']);
    expect(seen.map((s) => s.idem)).toEqual(['key-0001', 'key-0002']);
    expect(seen.every((s) => s.auth === 'Bearer test-token')).toBe(true);
    expect(out.results.every((r) => r.status === 200)).toBe(true);
    expect(out.blockedAt).toBeNull();
  });

  it('ошибка одной операции не отменяет остальные', async () => {
    const out = await runBatch({
      ops: [op('/claim'), op('/market/buy'), op('/pass/claim')],
      headers,
      dispatch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/market/buy') return Response.json({ error: 'insufficient_funds' }, { status: 402 });
        if (path === '/pass/claim') throw new Error('boom');
        return Response.json({ ok: true });
      },
    });

    expect(out.results.map((r) => r.status)).toEqual([200, 402, 500]);
    expect((out.results[1].data as { error: string }).error).toBe('insufficient_funds');
  });

  it('бюджет кончился — останавливаемся и говорим когда вернуться', async () => {
    let calls = 0;
    const out = await runBatch({
      ops: [op('/claim', 'key-0001'), op('/claim', 'key-0002'), op('/claim', 'key-0003')],
      headers,
      dispatch: async () => { calls += 1; return Response.json({ ok: true }); },
      consume: async () => (calls < 1 ? { allowed: true } : { allowed: false, retryAfter: 3600 }),
    });

    expect(calls).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(out.blockedAt).toBe(1);
    expect(out.retryAfter).toBe(3600);
  });

  it('каждая операция тратит бюджет — пачка не обходит лимит', async () => {
    let consumed = 0;
    await runBatch({
      ops: [op('/claim', 'key-0001'), op('/claim', 'key-0002'), op('/claim', 'key-0003')],
      headers,
      dispatch: async () => Response.json({ ok: true }),
      consume: async () => { consumed += 1; return { allowed: true }; },
    });
    expect(consumed).toBe(3);
  });
});
