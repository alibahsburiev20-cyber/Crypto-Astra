import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTurnstile } from '../../src/auth/turnstile';
import type { Env } from '../../src/env';

// «Подтверди, что ты человек» на бесплатных наградах (правка друга). Claim и
// бесплатные боксы — чистый кран: без проверки их выкачивают скрипты. Шлюз живёт
// на HTTP-слое (до обращения к миру), поэтому отказ не списывает и не начисляет.
// Секрет не задан — шлюз молча пропускает: разработка, тесты и превью не должны
// требовать Cloudflare.

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const SITE_KEY = '0x4AAAAA-sitekey';

function env(overrides: Partial<Env> = {}): Env {
  return {
    TURNSTILE_SECRET: '1x-secret-secret-secret',
    TURNSTILE_SITE_KEY: SITE_KEY,
    ...overrides,
  } as unknown as Env;
}

function request(): Request {
  return new Request('http://local/claim', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.7' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('шлюз «человек»', () => {
  it('без секрета пропускает всё — и пустой токен тоже', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bare = { TURNSTILE_SITE_KEY: SITE_KEY } as unknown as Env;
    await expect(checkTurnstile(bare, request(), {})).resolves.toBeUndefined();
    await expect(checkTurnstile(bare, request(), { turnstileToken: 'мусор' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('секрет есть, токена нет — 403 turnstile_required до всякого siteverify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkTurnstile(env(), request(), {})).rejects.toMatchObject({
      status: 403, code: 'turnstile_required',
    });
    await expect(checkTurnstile(env(), request(), { turnstileToken: '' })).rejects.toMatchObject({
      code: 'turnstile_required',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('секрет есть, токен проверен с секретом и remoteip', async () => {
    const calls: { url: string; form: FormData }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: FormData }) => {
      calls.push({ url, form: init.body });
      return new Response(JSON.stringify({ success: true }));
    }));
    await expect(checkTurnstile(env(), request(), { turnstileToken: 'tok-1' })).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('siteverify');
    // Секрет уходит только на siteverify — и уходит вместе с токеном и IP.
    expect(calls[0].form.get('secret')).toBe('1x-secret-secret-secret');
    expect(calls[0].form.get('response')).toBe('tok-1');
    expect(calls[0].form.get('remoteip')).toBe('203.0.113.7');
  });

  it('siteverify сказал «нет» — 403 turnstile_failed; сеть упала — тоже отказ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    await expect(checkTurnstile(env(), request(), { turnstileToken: 'bad' })).rejects.toMatchObject({
      status: 403, code: 'turnstile_failed',
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await expect(checkTurnstile(env(), request(), { turnstileToken: 'bad' })).rejects.toMatchObject({
      code: 'turnstile_failed',
    });
  });
});

describe('маршруты бонусов пропускают шлюз', () => {
  const game = read('worker/src/routes/game.ts');

  it('Claim проверяет человека до начисления', () => {
    const claim = game.slice(game.indexOf('export async function claim('), game.indexOf('export async function startExpedition('));
    // Проверка стоит до вызова мира: отказ не должен ничего начислять.
    expect(claim.indexOf('checkTurnstile')).toBeLessThan(claim.indexOf('world(env, a).claim'));
    // И тело читается мягко: пустой POST старого клиента — это 403, а не 400.
    expect(claim).toContain('request.json().catch(() => ({}))');
  });

  it('бесплатный бокс проверяется, платный — нет', () => {
    const boxOpen = game.slice(game.indexOf('export async function boxOpen('), game.indexOf('// ── Авиазвено'));
    expect(boxOpen).toContain('BOXES[box].price === 0');
    expect(boxOpen.indexOf('checkTurnstile')).toBeLessThan(boxOpen.indexOf('openBox(a.userId'));
  });
});

describe('клиент бонусной проверки', () => {
  const app = read('client/app.js');
  const css = read('client/styles.css');

  it('токен ставится в тело Claim и бесплатного бокса и сбрасывается после', () => {
    expect(app).toContain("{ turnstileToken: bonusToken }");
    // Одноразовость: после любого бонусного действия прошим заново.
    expect(app).toContain('resetBonusGate()');
    // Сброс — это remove(), а не reset(): после ошибки reset оставляет мёртвый
    // iframe, и токен после него не приходит никогда.
    expect(app).toContain('window.turnstile.remove(bonusWidget)');
    expect(app).not.toContain('window.turnstile.reset(bonusWidget)');
    // Отказ сервера по шлюзу обязан вернуть виджет в исходное состояние, иначе
    // игрок жмёт «Забрать» и получает ту же ошибку до перезагрузки страницы.
    expect(app).toContain("String(data?.error || '').startsWith('turnstile')");
  });

  it('сбой проверки — это состояние с объяснением и повтором, а не молчаливая ошибка', () => {
    // Класс состояния на блоке: CSS рисует рамку по факту, а не по догадке.
    expect(app).toContain('is-${bonusGate}');
    // Ошибка: объяснение + кнопка повтора + перезагрузка страницы.
    const gate = app.slice(app.indexOf('function bonusGateBlock()'), app.indexOf('/** Навешиваем виджет'));
    expect(gate).toContain('Повторить проверку');
    expect(gate).toContain('location.reload()');
    expect(gate).toContain('Загружаем проверку');
    // Контейнер живёт между перерисовками: живой challenge нельзя рвать re-render'ом.
    expect(app).toContain('const bonusGateHost =');
    expect(app.slice(app.indexOf('function mountBonusGate()'), app.indexOf('function renderBonusWidget')).includes('box.firstChild'),
      'живой виджет должен переживать перерисовку экрана').toBe(true);
    // Ошибку колбэка показываем с кодом: по нему видно, домен это или сеть.
    expect(app).toContain("'error-callback': (err)");
    expect(app).toContain('function turnstileErrorText(err)');
    // Разные коды — разные подсказки: «домен не настроен» и «другая вкладка».
    expect(app).toContain('600010');
    expect(app).toContain('300030');
    expect(app).toContain('бонусы никуда не денутся');
    // И на форме входа сбой виджета тоже объясняется, а не молчит.
    expect(app).toContain("$('#auth-error').textContent = turnstileErrorText(err)");
    expect(app).toContain('Подтверждение истекло — отметьте заново');
    expect(css).toContain('.bonus-check.is-error');
    expect(css).toContain('.ts-wrap.is-hidden');
  });

  it('кнопка бонуса спит, пока нет токена; бесплатный бокс помечен data-free', () => {
    expect(app).toContain('bonusGateOn() && !bonusToken');
    expect(app).toContain("'data-free': b.price === 0 ? '1' : null");
    // Обновление таймером не теряет шлюз: он учтён в updateTimers.
    expect(app).toContain('blockedByGate');
  });

  it('виджет ставится после перерисовки бонусных экранов', () => {
    expect(app).toContain("if (view === 'bridge' || view === 'boxes' || view === 'bonus') mountBonusGate();");
    expect(app).toContain('function bonusGateBlock()');
    // Подпись для игрока: проверка именно что про бонус.
    expect(app).toContain('Подтвердите, что вы человек');
  });

  it('без site key шлюз не появляется вообще', () => {
    expect(app).toContain('function bonusGateOn()');
    // bonusGateBlock возвращает null, когда ключа нет — блоки нет в разметке.
    const fn = app.slice(app.indexOf('function bonusGateBlock()'), app.indexOf('/** Навешиваем виджет'));
    expect(fn).toContain('if (!bonusGateOn()) return null;');
  });
});

describe('цена бокса и бейджи не вылезают за контур карточки', () => {
  const css = read('client/styles.css');

  it('заголовок сжимается, бейдж переносится, а не распирает рамку', () => {
    const head = css.slice(css.indexOf('.box-head {'), css.indexOf('.box-card p'));
    expect(head).toContain('flex-wrap: wrap');
    expect(head).toContain('min-width: 0');
    const badge = css.slice(css.indexOf('.badge {'), css.indexOf('.kinds'));
    expect(badge).toContain('flex: 0 0 auto');
    // Тот же паттерн — в заголовках экранов и миссий.
    const title = css.slice(css.indexOf('.screen-title {'), css.indexOf('.badge {'));
    expect(title).toContain('flex-wrap: wrap');
    expect(title).toContain('min-width: 0');
    const mission = css.slice(css.indexOf('.mission-head {'), css.indexOf('.mission-head {') + 200);
    expect(mission).toContain('flex-wrap: wrap');
  });

  it('блок проверки держит место под iframe, чтобы экран не прыгал', () => {
    expect(css).toContain('.bonus-check');
    expect(css).toContain('.ts-host');
    expect(css.slice(css.indexOf('.ts-host'), css.indexOf('.ts-host') + 120)).toContain('min-height: 68px');
  });
});
