import { describe, expect, it } from 'vitest';

// E2E идёт против живого `wrangler dev` (Durable Objects + D1).
// Без E2E_BASE_URL файл пропускается, поэтому `npm test` остаётся быстрым.
const BASE = process.env.E2E_BASE_URL;

if (!BASE) {
  describe.skip('API этапа 1 (нужен E2E_BASE_URL)', () => {
    it('пропущено', () => {});
  });
} else {
  // Свой IP на прогон: лимиты частоты в D1 не мешают повторным запускам.
  const IP = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'password123';
  const state: {
    token: string;
    cookie: string;
    worldId: string;
    shipId: string;
    expeditionId: string;
    claimKey: string;
  } = { token: '', cookie: '', worldId: '', shipId: '', expeditionId: '', claimKey: `claim-${Date.now()}` };

  const url = (p: string): string => `${BASE}${p}`;

  async function api(
    path: string, init: { method?: string; body?: unknown; key?: string; auth?: boolean; cookie?: string } = {},
  ) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': IP };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
    if (init.key) headers['Idempotency-Key'] = init.key;
    if (init.cookie) headers.Cookie = init.cookie;
    const res = await fetch(url(path), {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data: data as Record<string, any>, headers: res.headers };
  }

  describe('API этапа 1', () => {
    it('health и config отвечают', async () => {
      const h = await api('/health', { auth: false });
      expect(h.status).toBe(200);
      expect(typeof h.data.now).toBe('number');
      const c = await api('/config', { auth: false });
      expect(c.status).toBe(200);
      expect(c.data).toHaveProperty('turnstile_site_key');
    });

    it('регистрация выдаёт access-токен и refresh-cookie', async () => {
      const r = await api('/auth/register', { method: 'POST', auth: false, body: { email, password } });
      expect(r.status).toBe(200);
      state.token = String(r.data.access_token);
      state.worldId = String(r.data.user.world_id);
      state.cookie = String(r.headers.get('set-cookie') ?? '').split(';')[0];
      expect(state.token.split('.')).toHaveLength(3);
      expect(state.cookie.startsWith('astra_refresh=')).toBe(true);
    });

    it('/me отдаёт стартовое состояние', async () => {
      const me = await api('/me');
      expect(me.status).toBe(200);
      expect(me.data.world_id).toBe(state.worldId);
      expect(me.data.balances).toEqual({ astra: 500, fuel: 3, points: 0 });
      expect(me.data.ships).toHaveLength(1);
      expect(me.data.frozen).toBe(false);
      // Вкладка «Рейс» строится из planets: если сервер не отдаёт их, старт рейса
      // из интерфейса невозможен, хотя API работает.
      expect(Array.isArray(me.data.planets)).toBe(true);
      const open = (me.data.planets as Array<Record<string, any>>).filter((p) => !p.locked);
      expect(open.length).toBeGreaterThan(0);
      expect(open[0].options.map((o: Record<string, any>) => o.kind)).toEqual(['short', 'medium', 'long']);
      expect(open[0].options[0].fuel).toBeGreaterThan(0);
      state.shipId = String(me.data.ships[0].id);
    });

    it('Claim игнорирует суммы из тела и идемпотентен', async () => {
      const a = await api('/claim', { method: 'POST', key: state.claimKey, body: { astra: 999999, fuel: 999 } });
      expect(a.status).toBe(200);
      expect(a.data.reward).toBe(5);
      expect(a.data.balance).toBe(505);

      const b = await api('/claim', { method: 'POST', key: state.claimKey, body: { astra: 999999, fuel: 999 } });
      expect(b.status).toBe(200);
      expect(b.data).toEqual(a.data);

      const c = await api('/claim', { method: 'POST', key: `${state.claimKey}-again`, body: {} });
      expect(c.status).toBe(429);
      expect(c.data.error).toBe('too_early');
      expect(Number(c.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('журнал отдаётся и лимит не ломается на мусоре', async () => {
      const l = await api('/ledger?limit=2');
      expect(l.status).toBe(200);
      expect(l.data.entries.length).toBeLessThanOrEqual(2);
      const bad = await api('/ledger?limit=abc');
      expect(bad.status).toBe(200);
      expect(bad.data.entries.length).toBeGreaterThan(0);
    });

    it('старт рейса списывает топливо, суммы из тела не проходят', async () => {
      const start = await api('/expeditions/start', {
        method: 'POST', key: 'e2e-start',
        body: { shipId: state.shipId, planet: 'ferra', kind: 'short', astra: 1_000_000, fuel: 100 },
      });
      expect(start.status).toBe(200);
      state.expeditionId = String(start.data.expedition.id);
      expect(start.data.expedition.fuelSpent).toBe(1);

      const replay = await api('/expeditions/start', {
        method: 'POST', key: 'e2e-start',
        body: { shipId: state.shipId, planet: 'ferra', kind: 'short' },
      });
      expect(replay.status).toBe(200);
      expect(replay.data.expedition.id).toBe(state.expeditionId);

      const second = await api('/expeditions/start', {
        method: 'POST', key: 'e2e-start-2',
        body: { shipId: state.shipId, planet: 'ferra', kind: 'short' },
      });
      expect(second.status).toBe(409);
      expect(second.data.error).toBe('ship_busy');

      const me = await api('/me');
      expect(me.data.balances.fuel).toBe(2);
      expect(me.data.balances.astra).toBe(505);
    });

    it('чужое событие и отсутствие ключа идемпотентности дают понятные коды', async () => {
      const choose = await api('/expeditions/choose-event', {
        method: 'POST', key: 'e2e-choose', body: { expeditionId: 'nope', choiceId: 'bypass' },
      });
      expect(choose.status).toBe(404);
      expect(choose.data.error).toBe('expedition_not_found');

      const noKey = await api('/claim', { method: 'POST', body: {} });
      expect(noKey.status).toBe(400);
      expect(noKey.data.error).toBe('idempotency_key_required');
    });

    it('отмена возвращает рейс и не ломает журнал', async () => {
      const cancel = await api('/expeditions/cancel', {
        method: 'POST', key: 'e2e-cancel', body: { expeditionId: state.expeditionId },
      });
      expect(cancel.status).toBe(200);
      expect(cancel.data.expedition.status).toBe('cancelled');
      const me = await api('/me');
      expect(me.data.ships[0].status).toBe('idle');
    });

    it('неверный пароль не раскрывает email, успешный вход чистит счётчик', async () => {
      for (let i = 0; i < 2; i++) {
        const bad = await api('/auth/login', { method: 'POST', auth: false, body: { email, password: 'wrong-password' } });
        expect(bad.status).toBe(401);
        expect(bad.data.error).toBe('invalid_credentials');
      }
      const ok = await api('/auth/login', { method: 'POST', auth: false, body: { email, password } });
      expect(ok.status).toBe(200);
      state.token = String(ok.data.access_token);
      state.cookie = String(ok.headers.get('set-cookie') ?? '').split(';')[0];
    });

    it('refresh ротируется, старый токен отзывает сессию', async () => {
      const first = await api('/auth/refresh', { method: 'POST', auth: false, cookie: state.cookie });
      expect(first.status).toBe(200);
      expect(typeof first.data.access_token).toBe('string');

      const reuse = await api('/auth/refresh', { method: 'POST', auth: false, cookie: state.cookie });
      expect(reuse.status).toBe(401);
      expect(reuse.data.error).toBe('session_reuse');
    });

    it('без токена закрытые маршруты недоступны', async () => {
      const res = await api('/me', { auth: false });
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('unauthorized');
    });

    it('/me отдаёт сезон: номер, рамки и место игрока', async () => {
      const me = await api('/me');
      expect(me.status).toBe(200);
      const season = me.data.season as Record<string, any>;
      expect(season.number).toBe(1);
      expect(season.lengthDays).toBe(56);
      expect(season.endsAt).toBeGreaterThan(season.startsAt);
      expect(season.daysLeft).toBeGreaterThan(0);
      // Место не фиксируем: e2e может идти в мире, где уже есть другие игроки.
      expect(season.rank).toBeGreaterThanOrEqual(1);
      expect(season.rank).toBeLessThanOrEqual(season.players);
      expect(season.players).toBeGreaterThanOrEqual(1);
    });

    it('GET /season отдаёт рейтинг, призы и прошлые сезоны', async () => {
      const res = await api('/season');
      expect(res.status).toBe(200);
      const body = res.data as Record<string, any>;
      expect(body.season.id).toBe('s1');
      expect(body.season.lengthDays).toBe(56);
      expect(Array.isArray(body.top)).toBe(true);
      expect(body.top.length).toBeGreaterThanOrEqual(1);
      expect(body.top.length).toBeLessThanOrEqual(20);
      expect(body.top[0].rank).toBe(1);
      expect(body.top[0].label.startsWith('Пилот ')).toBe(true);
      // Себя видно в топе, если своё место попало в первые двадцать.
      const mine = body.top.filter((row: { isMe: boolean }) => row.isMe).length;
      expect(mine).toBe(body.me.rank <= body.top.length ? 1 : 0);
      expect(body.me.label.startsWith('Пилот ')).toBe(true);
      expect(body.rewards.map((r: { place: number | string }) => r.place)).toEqual([1, 2, 3, '4–10', 'участие']);
      expect(Array.isArray(body.past)).toBe(true);
      expect(body.past.length).toBeLessThanOrEqual(3);
    });

    it('/season закрыт для гостя', async () => {
      const res = await api('/season', { auth: false });
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('unauthorized');
    });
  });
}
