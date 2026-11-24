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
  // Токен админки пула: в CI он приходит из .dev.vars, локально — из окружения.
  const ADMIN = process.env.ADMIN_TOKEN ?? 'ci-admin-token';

  async function api(
    path: string,
    init: { method?: string; body?: unknown; key?: string; auth?: boolean; cookie?: string; admin?: boolean } = {},
  ) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': IP };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
    if (init.key) headers['Idempotency-Key'] = init.key;
    if (init.cookie) headers.Cookie = init.cookie;
    if (init.admin) headers['X-Admin-Token'] = ADMIN;
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

    // Жалоба владельца: «не могу начислить другому монеты, даже причину пишу».
    // Проверяем ровно его сценарий: игрок зарегистрирован, оператор пишет email и
    // причину — начисление обязано пройти в тот мир, где игрок реально живёт.
    it('админ начисляет ASTRA по email и по началу id', async () => {
      const byEmail = await api('/admin/world/grant?world=w1', {
        method: 'POST', auth: false, admin: true,
        body: { player: email, astra: 250, reason: 'e2e: компенсация' },
      });
      expect(byEmail.status).toBe(200);
      expect(byEmail.data.world).toBe(state.worldId);
      expect(byEmail.data.resolvedBy).toBe('email');
      const playerId = String(byEmail.data.playerId);
      expect(byEmail.data.granted).toBe(250);

      const byPrefix = await api('/admin/world/grant?world=w1', {
        method: 'POST', auth: false, admin: true,
        body: { player: playerId.slice(0, 8), astra: 5, reason: 'e2e: начало id' },
      });
      expect(byPrefix.status).toBe(200);
      expect(byPrefix.data.playerId).toBe(playerId);
      expect(byPrefix.data.resolvedBy === 'prefix' || byPrefix.data.resolvedBy === 'id').toBe(true);

      const me = await api('/me');
      expect(me.data.balances.astra).toBe(500 + 250 + 5);

      // Отрицательная сумма — списание. Заодно возвращаем баланс к исходному,
      // чтобы последующие проверки в файле оставались предсказуемыми.
      const back = await api('/admin/world/grant?world=w1', {
        method: 'POST', auth: false, admin: true,
        body: { player: email, astra: -255, reason: 'e2e: откат начисления' },
      });
      expect(back.status).toBe(200);
      expect(back.data.granted).toBe(-255);
      expect((await api('/me')).data.balances.astra).toBe(500);

      // Без причины — понятный код, а не «что-то сломалось».
      const noReason = await api('/admin/world/grant', {
        method: 'POST', auth: false, admin: true,
        body: { player: email, astra: 10 },
      });
      expect(noReason.status).toBe(400);
      expect(noReason.data.error).toBe('reason_required');
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

    it('GET /social отдаёт миссии, достижения и Pass', async () => {
      const res = await api('/social');
      expect(res.status).toBe(200);
      const body = res.data as Record<string, any>;
      expect(body.missions.daily).toHaveLength(3);
      expect(body.missions.weekly.id.startsWith('w_')).toBe(true);
      expect(body.missions.daily[0]).toHaveProperty('progress');
      expect(body.missions.daily[0]).toHaveProperty('target');
      expect(body.achievements.list.length).toBeGreaterThanOrEqual(10);
      expect(body.pass.levels).toHaveLength(10);
      expect(body.pass.level).toBeGreaterThanOrEqual(0);
      expect(body.pass.levels[0]).toHaveProperty('threshold');
    });

    it('незавершённую миссию забрать нельзя', async () => {
      const social = await api('/social');
      const mission = (social.data.missions.daily as { id: string; ready: boolean }[])
        .find((m) => !m.ready);
      if (!mission) return; // новичок без прогресса, но на всякий случай
      const res = await api('/missions/claim', {
        method: 'POST', key: `m-${Date.now()}`, body: { missionId: mission.id },
      });
      expect(res.status).toBe(409);
      expect(res.data.error).toBe('mission_incomplete');
    });

    it('GET /guild: свободный пилот видит цену, рейтинг и свой код приглашения', async () => {
      const res = await api('/guild');
      expect(res.status).toBe(200);
      const body = res.data as Record<string, any>;
      expect(body.guild.mine).toBeNull();
      expect(body.guild.cost).toBe(500);
      expect(Array.isArray(body.guild.top)).toBe(true);
      expect(String(body.referrals.code)).toMatch(/^[A-Z0-9]{7}$/);
      expect(body.referrals.reward).toBe(150);
    });

    it('гильдия создаётся и покидается', async () => {
      const created = await api('/guild/create', {
        method: 'POST', key: `g-${Date.now()}`, body: { name: `Эскадра ${Date.now() % 100000}`, tag: 'E2E' },
      });
      expect(created.status).toBe(200);
      expect(created.data.guild.tag).toBe('E2E');
      expect(String(created.data.guild.inviteCode)).toMatch(/^[A-Z0-9]{6}$/);

      const view = await api('/guild');
      expect(view.data.guild.mine.name).toBe(created.data.guild.name);
      expect(view.data.guild.role).toBe('leader');
      expect(view.data.guild.members).toHaveLength(1);

      const left = await api('/guild/leave', { method: 'POST', key: `gl-${Date.now()}`, body: {} });
      expect(left.status).toBe(200);
      const after = await api('/guild');
      expect(after.data.guild.mine).toBeNull();
    });

    it('свой код приглашения применить нельзя', async () => {
      const view = await api('/guild');
      const res = await api('/referrals/apply', {
        method: 'POST', key: `ref-${Date.now()}`, body: { code: view.data.referrals.code },
      });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe('self_referral');
    });


    it('GET /pool — публичный отчёт без входа, выплаты выключены', async () => {
      const res = await api('/pool.json', { auth: false });
      expect(res.status).toBe(200);
      const body = res.data as Record<string, any>;
      expect(body.ok).toBe(true);
      expect(body.payoutsEnabled).toBe(false);
      expect(body.feePercent).toBe(20);
      expect(Array.isArray(body.totals)).toBe(true);
      expect(Array.isArray(body.latest)).toBe(true);
      // Публичный отчёт не отдаёт номера платежей.
      for (const row of body.latest) expect(row.ref).toBeUndefined();
    });

    it('запись пула без админ-токена отклоняется', async () => {
      const res = await api('/admin/pool/entry', {
        method: 'POST', auth: false,
        body: { kind: 'in', amount: 100, currency: 'EUR', ref: `no-token-${Date.now()}` },
      });
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('admin_token_required');
    });

    it('админ добавляет взнос, отчёт сходится, повтор не удваивает сумму', async () => {
      const before = await api('/pool.json', { auth: false });
      const inBefore = Number((before.data.totals as { currency: string; in: number }[])
        .find((t) => t.currency === 'EUR')?.in ?? 0);

      const ref = `e2e-in-${Date.now()}`;
      const added = await api('/admin/pool/entry', {
        method: 'POST', auth: false, admin: true,
        body: { kind: 'in', amount: 1234, currency: 'EUR', ref, note: 'e2e взнос' },
      });
      expect(added.status).toBe(201);
      expect(added.data.ref).toBe(ref);

      const after = await api('/pool.json', { auth: false });
      const inAfter = Number((after.data.totals as { currency: string; in: number }[])
        .find((t) => t.currency === 'EUR')?.in ?? 0);
      expect(inAfter - inBefore).toBe(1234);

      const repeat = await api('/admin/pool/entry', {
        method: 'POST', auth: false, admin: true,
        body: { kind: 'in', amount: 1234, currency: 'EUR', ref, note: 'e2e взнос' },
      });
      expect(repeat.status).toBe(409);
      expect(repeat.data.error).toBe('pool_ref_exists');
    });

    it('админский список пула закрыт без токена', async () => {
      expect((await api('/admin/pool', { auth: false })).status).toBe(401);
      expect((await api('/admin/pool', { auth: false, admin: true })).status).toBe(200);
    });

    it('пачка действий: несколько операций одним запросом', async () => {
      const key = `batch-${Date.now()}`;
      const r = await api('/batch', {
        method: 'POST',
        body: {
          ops: [
            { op: '/claim', idem: `${key}-a`, body: {} },
            { op: '/fuel/buy', idem: `${key}-b`, body: {} },
          ],
        },
      });
      expect(r.status).toBe(200);
      expect(Array.isArray(r.data.results)).toBe(true);
      expect(r.data.results).toHaveLength(2);
      // Статус каждой операции свой: 200 — выполнено, 4xx — отказано по правилам
      // игры (например, лимит топлива). Главное — это не 5xx и не падение.
      for (const item of r.data.results as Array<{ status: number }>) {
        expect(item.status).toBeLessThan(500);
      }
      expect(r.data.blockedAt).toBeNull();
    });

    it('пачка не пускает деньги и админку', async () => {
      const r = await api('/batch', {
        method: 'POST',
        body: { ops: [{ op: '/pay/purchase', idem: 'batch-pay-001', body: {} }] },
      });
      expect(r.status).toBe(400);
      expect(r.data.error).toBe('op_not_allowed');

      const guest = await api('/batch', { method: 'POST', auth: false, body: { ops: [{ op: '/claim', idem: 'batch-guest-1' }] } });
      expect(guest.status).toBe(401);
    });

    it('/social и /guild закрыты для гостя', async () => {
      expect((await api('/social', { auth: false })).status).toBe(401);
      expect((await api('/guild', { auth: false })).status).toBe(401);
    });

    // Боксы идут последними в файле: они меняют баланс ASTRA и склад ресурсов,
    // а проверки выше опираются на конкретные суммы.
    it('боксы: дневной открывается, повтор упирается в таймер', async () => {
      const list = await api('/boxes');
      expect(list.status).toBe(200);
      expect(list.data.boxes.map((b: any) => b.id)).toEqual(['daily', 'weekly', 'crate_supply', 'crate_pro']);
      const daily = list.data.boxes.find((b: any) => b.id === 'daily');
      expect(daily.ready).toBe(true);
      expect(daily.price).toBe(0);
      expect(String(daily.sprite)).toBe('/sprites/boxes/daily.png');

      const astraBefore = (await api('/me')).data.balances.astra;
      const open = await api('/boxes/open', { method: 'POST', key: 'e2e-box-daily-1', body: { box: 'daily' } });
      expect(open.status).toBe(200);
      expect(open.data.box).toBe('daily');
      expect(open.data.drops.length).toBeGreaterThan(0);
      const units = open.data.drops
        .filter((d: any) => ['iron_ore', 'copper_ore', 'silicon', 'ice'].includes(d.resource))
        .reduce((s: number, d: any) => s + d.amount, 0);
      expect(units).toBe(open.data.units);

      const me = await api('/me');
      expect(me.data.balances.astra).toBe(astraBefore);
      const resources = (me.data.resources || []).reduce((s: number, r: any) => s + r.amount, 0);
      expect(resources).toBeGreaterThanOrEqual(units);

      const again = await api('/boxes/open', { method: 'POST', key: 'e2e-box-daily-2', body: { box: 'daily' } });
      expect(again.status).toBe(429);
      expect(again.data.error).toBe('box_cooldown');
      // Таймер виден в каталоге: клиент считает по нему, а не по заголовку.
      const after = await api('/boxes');
      const dailyAfter = after.data.boxes.find((b: any) => b.id === 'daily');
      expect(dailyAfter.ready).toBe(false);
      expect(dailyAfter.nextOpenAt).toBeGreaterThan(0);
    });

    it('платный бокс списывает ASTRA и не открывается без денег', async () => {
      // К этому месту игрок потратился на гильдию и рейсы — пополняем бюджет
      // тем же админским начислением, что и в жизни (без него тест зависел бы
      // от порядка проверок выше).
      const top = await api('/admin/world/grant?world=w1', {
        method: 'POST', auth: false, admin: true,
        body: { player: email, astra: 2000, reason: 'e2e: бюджет на боксы' },
      });
      expect(top.status).toBe(200);
      const before = (await api('/me')).data.balances.astra;

      const paid = await api('/boxes/open', { method: 'POST', key: 'e2e-box-paid-1', body: { box: 'crate_supply' } });
      expect(paid.status).toBe(200);
      expect(paid.data.price).toBe(280);
      expect((await api('/me')).data.balances.astra).toBe(before - 280);

      const bad = await api('/boxes/open', { method: 'POST', key: 'e2e-box-bad', body: { box: 'ghost' } });
      expect(bad.status).toBe(400);
      expect(bad.data.error).toBe('bad_box');
      expect((await api('/me')).data.balances.astra).toBe(before - 280);

      const pro = await api('/boxes/open', { method: 'POST', key: 'e2e-box-pro-1', body: { box: 'crate_pro' } });
      expect(pro.status).toBe(200);
      expect(pro.data.price).toBe(850);
      const left = (await api('/me')).data.balances.astra;
      expect(left).toBe(before - 280 - 850);

      // Дожимаем баланс ниже цены дешёвого бокса: сколько именно останется,
      // зависит от того, что успели потратить проверки выше, поэтому цикл, а не
      // жёсткая цифра.
      let astra = left;
      let n = 2;
      while (astra >= 850) {
        const again = await api('/boxes/open', { method: 'POST', key: `e2e-box-pro-${n++}`, body: { box: 'crate_pro' } });
        expect(again.status).toBe(200);
        astra -= 850;
        expect((await api('/me')).data.balances.astra).toBe(astra);
      }

      const poor = await api('/boxes/open', { method: 'POST', key: 'e2e-box-poor', body: { box: 'crate_supply' } });
      expect(poor.status).toBe(409);
      expect(poor.data.error).toBe('insufficient_funds');
      expect((await api('/me')).data.balances.astra).toBe(astra);
    });
  });
}
