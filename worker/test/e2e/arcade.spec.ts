import { describe, expect, it } from 'vitest';
import { makeMaze, solveMaze } from '../../src/shared/arcade';

// E2E аркады (этап 18). Отдельный файл и отдельный игрок: частотный лимит
// считается на пользователя, и в общем файле аркада упиралась бы в 30 записей
// в минуту, оставленных чужими тестами.
//
// Здесь проверяется то, чего не видно в unit-тестах: маршрут ↔ мир ↔ журнал
// на живом воркере, плюс «идеальный путь» считается тем же общим модулем, что
// и на сервере, — значит контракт клиента и сервера не разошёлся.

const BASE = process.env.E2E_BASE_URL;

/** Идеальный проход лабиринта по зерну: единственный способ выиграть — сыграть. */
function perfectMazeMoves(seed: number): number[] {
  const g = makeMaze(seed >>> 0);
  const { path, steps } = solveMaze(g);
  const moves: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1] % g.cols;
    const ay = Math.floor(path[i - 1] / g.cols);
    const bx = path[i] % g.cols;
    const by = Math.floor(path[i] / g.cols);
    moves.push(bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : 0);
  }
  if (moves.length !== steps) throw new Error('решатель лабиринта разошёлся с полем');
  return moves;
}

if (!BASE) {
  describe.skip('аркада (нужен E2E_BASE_URL)', () => {
    it('пропущено', () => {});
  });
} else {
  const IP = `198.51.101.${Math.floor(Math.random() * 250) + 1}`;
  const email = `arcade-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const state: { token: string; runId: string; seed: number; key: string; astra: number } = {
    token: '', runId: '', seed: 0, key: '', astra: 0,
  };

  const url = (p: string): string => `${BASE}${p}`;

  async function api(
    path: string,
    init: { method?: string; body?: unknown; key?: string; auth?: boolean } = {},
  ) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': IP };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
    if (init.key) headers['Idempotency-Key'] = init.key;
    const res = await fetch(url(path), {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data: data as Record<string, any> };
  }

  describe('аркада: маршруты и зачёт', () => {
    it('новый игрок видит каталог из десяти игр и полный пул попыток', async () => {
      const r = await api('/auth/register', { method: 'POST', auth: false, body: { email, password: 'password123' } });
      expect(r.status).toBe(200);
      state.token = String(r.data.access_token);
      const g = await api('/arcade');
      expect(g.status).toBe(200);
      expect(g.data.games).toHaveLength(10);
      expect(g.data.attempts).toMatchObject({ used: 0, limit: 10, left: 10 });
      expect(g.data.wins).toBe(0);
      expect(g.data.maxScore).toBe(600);
      expect(g.data.winScore).toBe(300);
      // Лидерборд арки — общий на мир, поэтому «пусто» мы утверждать не можем:
      // на проде и на локальной машине до нас уже кто-то выиграл. Инвариант
      // другой: новичок без побед в него не попадает.
      expect((g.data.leaderboard as Array<Record<string, any>>).every((r) => r.isMe !== true)).toBe(true);
      expect((g.data.leaderboard as Array<Record<string, any>>).every((r) => Number(r.wins) > 0)).toBe(true);
      for (const game of g.data.games) {
        expect(typeof game.title).toBe('string');
        expect(game.sprite).toMatch(/^\/sprites\/arcade\/[a-z0-9_]+\.png$/);
      }
      const me = await api('/me');
      state.astra = Number(me.data.balances.astra);
    });

    it('битые запросы не тратят попытки', async () => {
      const noKey = await api('/arcade/start', { method: 'POST', body: { game: 'maze' } });
      expect(noKey.status).toBe(400);
      expect(noKey.data.error).toBe('idempotency_key_required');

      const badGame = await api('/arcade/start', { method: 'POST', body: { game: 'football' }, key: `arc-bad-${Date.now()}` });
      expect(badGame.status).toBe(400);
      expect(badGame.data.error).toBe('bad_game');

      const ghost = await api('/arcade/finish', {
        method: 'POST',
        body: { runId: '00000000-0000-4000-8000-000000000000', moves: [1] },
        key: `arc-ghost-${Date.now()}`,
      });
      expect(ghost.status).toBe(404);
      expect(ghost.data.error).toBe('run_not_found');

      const after = await api('/arcade');
      expect(after.data.attempts).toMatchObject({ used: 0, left: 10 });
    });

    it('ход сквозь стену не засчитывается, а попытка сгорает один раз', async () => {
      const start = await api('/arcade/start', { method: 'POST', body: { game: 'maze' }, key: `arc-c-${Date.now()}` });
      expect(start.status).toBe(200);
      const runId = String(start.data.runId);
      const cheat = await api('/arcade/finish', {
        method: 'POST', body: { runId, moves: [1, 1, 1, 1, 1] }, key: `arc-cf-${Date.now()}`,
      });
      expect(cheat.status).toBe(409);
      expect(['bad_trace', 'short']).toContain(cheat.data.error);
      // Забег закрыт: второй раз его уже не «пересдать».
      const again = await api('/arcade/finish', {
        method: 'POST', body: { runId, moves: [1, 1, 1, 1, 1] }, key: `arc-cf2-${Date.now()}`,
      });
      expect(again.status).toBe(409);
      expect(again.data.error).toBe('run_expired');
      const view = await api('/arcade');
      expect(view.data.attempts.used).toBe(1);
    });

    it('честное решение даёт очки, опыт и ни одной ASTRA', async () => {
      const start = await api('/arcade/start', { method: 'POST', body: { game: 'maze' }, key: `arc-m-${Date.now()}` });
      expect(start.status).toBe(200);
      state.runId = String(start.data.runId);
      state.seed = Number(start.data.seed);
      state.key = `arc-mf-${Date.now()}`;
      expect(Number(start.data.runMs)).toBeGreaterThan(1000);
      expect(Number(start.data.endsAt)).toBeGreaterThan(Date.now() + Number(start.data.runMs) - 5000);

      const finish = await api('/arcade/finish', {
        method: 'POST', body: { runId: state.runId, moves: perfectMazeMoves(state.seed) }, key: state.key,
      });
      expect(finish.status).toBe(200);
      expect(finish.data.ok).toBe(true);
      expect(finish.data.result.score).toBeGreaterThan(300);
      expect(finish.data.result.win).toBe(true);
      expect(finish.data.rewards.xp).toBeGreaterThan(0);
      expect(finish.data.attempts.used).toBe(2);

      const me = await api('/me');
      expect(Number(me.data.balances.astra)).toBe(state.astra);
      expect(Number(me.data.xp)).toBeGreaterThan(0);

      const view = await api('/arcade');
      expect(view.data.wins).toBe(1);
      expect(view.data.best).toBe(finish.data.result.score);
      expect(view.data.games.find((g: { id: string }) => g.id === 'maze')).toMatchObject({ runs: 1, wins: 1 });
      // Мы обязаны быть в лидерборде, но не обязательно первыми: на проде до нас
      // уже выигрывали, и сортировка по победам это честное равенство.
      const mine = (view.data.leaderboard as Array<Record<string, any>>).find((r) => r.isMe === true);
      expect(mine).toBeTruthy();
      expect(Number(mine.wins)).toBeGreaterThanOrEqual(1);
      expect(view.data.today.xp).toBe(finish.data.rewards.xp);
    });

    it('повтор того же ответа с тем же ключом не удваивает награду', async () => {
      const replay = await api('/arcade/finish', {
        method: 'POST', body: { runId: state.runId, moves: perfectMazeMoves(state.seed) }, key: state.key,
      });
      expect(replay.status).toBe(200);
      expect(replay.data.attempts.used).toBe(2);
      const view = await api('/arcade');
      expect(view.data.wins).toBe(1);
      expect(view.data.today.runs).toBe(2);
    });

    it('опыт аркады виден в журнале и только как опыт', async () => {
      const l = await api('/ledger?limit=50');
      expect(l.status).toBe(200);
      const rows = (l.data.entries ?? []).filter((e: { reason: string }) => e.reason === 'arcade');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((e: { asset: string }) => e.asset === 'xp')).toBe(true);
      expect(rows.every((e: { asset: string }) => e.asset !== 'astra' && e.asset !== 'points')).toBe(true);
    });
  });
}
