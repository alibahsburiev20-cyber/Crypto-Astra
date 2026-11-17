const $ = (s) => document.querySelector(s);

const ERRORS = {
  email_taken: 'Этот email уже зарегистрирован',
  invalid_credentials: 'Неверный email или пароль',
  invalid_email: 'Проверьте email',
  invalid_password: 'Пароль: от 8 до 128 символов',
  bad_request: 'Некорректный запрос',
  payload_too_large: 'Запрос слишком большой',
  turnstile_failed: 'Проверка не пройдена',
  unauthorized: 'Нужно войти заново',
  no_session: 'Сессия истекла, войдите заново',
  ship_not_found: 'Корабль не найден',
  world_full: 'Нет свободных мест, попробуйте позже',
  internal: 'Ошибка сервера, попробуйте позже',
  server_misconfigured: 'Сервер не настроен',
  registration_incomplete: 'Регистрация не завершилась, попробуйте войти или обратитесь в поддержку',
  turnstile_required: 'Подтвердите, что вы не робот',
  too_many_attempts: 'Слишком много попыток. Подождите и попробуйте снова',
  world_frozen: 'Мир заморожен: журнал не сходится',
  ship_busy: 'Корабль уже в рейсе',
  ship_broken: 'Прочность 0%. Нужен ремонт',
  sector_locked: 'Сектор ещё закрыт',
  ship_range: 'Этот корабль так далеко не летает',
  not_enough_fuel: 'Не хватает топлива',
  too_late_to_cancel: 'Отмена уже недоступна',
  not_waiting: 'Событие уже закрыто',
  bad_choice: 'Такого варианта нет',
  nothing_to_repair: 'Чинить нечего',
  repair_needs_alloy_plate: 'Ниже 50% нужен alloy_plate. Крафта ещё нет',
  fuel_tank_full: 'Бак полон',
  fuel_daily_limit: 'Суточный лимит топлива исчерпан',
  insufficient_funds: 'Не хватает ASTRA',
  too_early: 'Claim ещё не готов',
  daily_limit: 'Суточный лимит Claim исчерпан',
  expedition_not_found: 'Рейс не найден',
  expedition_done: 'Рейс уже завершён',
  bad_expedition: 'Проверьте планету и тип рейса',
  player_not_found: 'Игрок не найден',
  idempotency_key_required: 'Повторите действие',
  idempotency_key_reused: 'Ключ запроса уже использован',
  reservation_expired: 'Место в мире истекло, попробуйте снова',
  bad_planet: 'Планета не найдена',
};
const REASONS = {
  start_bonus: 'Стартовый бонус',
  claim: 'Claim',
  expedition_start: 'Топливо на рейс',
  expedition_cancel: 'Отмена рейса',
  expedition_reward: 'Награда рейса',
  expedition_event: 'Событие рейса',
  fuel_regen: 'Восстановление топлива',
  fuel_purchase: 'Покупка топлива',
  repair: 'Ремонт',
};
const ASSETS = { astra: 'ASTRA', fuel: 'Топливо', points: 'Очки' };

const errText = (code) => ERRORS[code] || 'Что-то пошло не так';

let token = null;
let mode = 'register';
let view = 'bridge';
let state = null;
let ledger = [];
let note = '';
let clock = 0;
// Разница «серверное время − часы устройства». Все таймеры считаются по серверу,
// иначе при сбитых часах Claim и рейс выглядят недоступными.
let serverOffset = 0;

// Turnstile включается только если сервер отдал site key в /config.
// Без ключей (локальная разработка) виджет не грузится вообще.
let config = { turnstile_site_key: null };
let turnstileToken = null;
let turnstileWidget = null;
let turnstileScript = null;
let loginNeedsTurnstile = false;

function syncServerTime(serverNow) {
  if (typeof serverNow === 'number' && Number.isFinite(serverNow)) serverOffset = serverNow - Date.now();
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) n.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function refresh() {
  const { status, data } = await request('/auth/refresh', { method: 'POST' });
  if (status === 200) { token = data.access_token; return true; }
  token = null;
  return false;
}

async function authed(path, opts) {
  let res = await request(path, opts);
  if (res.status === 401 && (await refresh())) res = await request(path, opts);
  return res;
}

function idemKey(scope) {
  const k = `idem:${scope}`;
  let v = sessionStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); sessionStorage.setItem(k, v); }
  return v;
}
function idemDone(scope) { sessionStorage.removeItem(`idem:${scope}`); }

function show(which) {
  $('#auth').hidden = which !== 'auth';
  $('#game').hidden = which !== 'game';
}

function setMode(m) {
  mode = m;
  $('#tab-register').classList.toggle('active', m === 'register');
  $('#tab-login').classList.toggle('active', m === 'login');
  $('#auth-submit').textContent = m === 'register' ? 'Зарегистрироваться' : 'Войти';
  $('#password').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
  refreshTurnstileVisibility();
}

async function loadConfig() {
  const res = await request('/config').catch(() => null);
  if (res?.status === 200) config = res.data;
  refreshTurnstileVisibility();
}

function showTurnstile() {
  const box = $('#turnstile');
  if (!config.turnstile_site_key) return false;
  box.hidden = false;
  if (turnstileWidget !== null) return true;
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  turnstileScript.then(() => {
    if (!window.turnstile || turnstileWidget !== null || box.hidden) return;
    turnstileWidget = window.turnstile.render(box, {
      sitekey: config.turnstile_site_key,
      theme: 'dark',
      callback: (token) => { turnstileToken = token; },
      'expired-callback': () => { turnstileToken = null; },
      'error-callback': () => { turnstileToken = null; },
    });
  }).catch(() => {
    // Сбросить промис, чтобы следующая попытка снова попробовала загрузить скрипт.
    turnstileScript = null;
    $('#auth-error').textContent = 'Не удалось загрузить проверку Cloudflare';
  });
  return true;
}

function resetTurnstile() {
  turnstileToken = null;
  if (turnstileWidget !== null && window.turnstile) {
    try { window.turnstile.reset(turnstileWidget); } catch { /* виджет уже снят */ }
  }
}

function refreshTurnstileVisibility() {
  const box = $('#turnstile');
  const need = Boolean(config.turnstile_site_key) && (mode === 'register' || loginNeedsTurnstile);
  if (!need) {
    box.hidden = true;
    resetTurnstile();
    return;
  }
  showTurnstile();
}

function left(ts) { return ts ? Math.max(0, ts - (Date.now() + serverOffset)) : 0; }

function updateTimers() {
  const claimLeft = left(state?.nextClaimAt);
  const btn = document.querySelector('[data-claim]');
  if (btn) btn.disabled = claimLeft > 0 || !!state?.frozen;
  const noteEl = document.querySelector('[data-claim-note]');
  if (noteEl) {
    noteEl.textContent = claimLeft > 0
      ? `Следующий Claim через ${fmtLeft(claimLeft)}`
      : 'Claim доступен. +5 ASTRA, не чаще раза в 15 минут.';
  }
  for (const n of document.querySelectorAll('[data-until]')) {
    const until = Number(n.getAttribute('data-until'));
    const prefix = n.getAttribute('data-prefix') || '';
    n.textContent = prefix + fmtLeft(left(until));
  }
}
function fmtLeft(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  return m < 120 ? `${m} мин` : `${Math.round(m / 60)} ч`;
}

function shipArt(type) {
  return el('div', { class: 'ship-viewer' }, el('img', { src: `/sprites/${type}.svg`, alt: '' }));
}

function cards() {
  const b = state.balances;
  return el('div', { class: 'cards' },
    el('div', { class: 'card' }, el('span', { class: 'label' }, 'ASTRA'), el('span', { class: 'value' }, b.astra)),
    el('div', { class: 'card' }, el('span', { class: 'label' }, 'Топливо'), el('span', { class: 'value' }, `${b.fuel}/${state.fuel.cap}`)),
    el('div', { class: 'card' }, el('span', { class: 'label' }, 'Очки'), el('span', { class: 'value' }, b.points)),
    el('div', { class: 'card' }, el('span', { class: 'label' }, 'Уровень'), el('span', { class: 'value' }, `${state.level}`)),
  );
}

function renderBridge() {
  const ship = state.ships[0];
  const active = state.expeditions.active;
  const claimLeft = left(state.nextClaimAt);
  return el('div', {},
    shipArt(ship?.type || 'scout'),
    cards(),
    el('h2', {}, 'Claim'),
    el('button', { type: 'button', 'data-claim': '', disabled: claimLeft > 0 || state.frozen ? '' : null, onClick: doClaim }, 'Забрать'),
    el('p', { class: 'muted', 'data-claim-note': '' }, claimLeft > 0 ? `Следующий Claim через ${fmtLeft(claimLeft)}` : 'Claim доступен. +5 ASTRA, не чаще раза в 15 минут.'),
    active ? el('div', { class: 'block' },
      el('h3', {}, 'Рейс идёт'),
      el('p', { class: 'muted', 'data-prefix': `${active.planet} · осталось `, 'data-until': active.endsAt }),
      el('button', { type: 'button', class: 'ghost', onClick: () => setView('flight') }, 'Открыть рейс'),
    ) : null,
    note ? el('p', { class: 'ok' }, note) : null,
  );
}

function renderFlight() {
  const active = state.expeditions.active;
  const ship = (active && state.ships.find((s) => s.id === active.shipId)) || state.ships[0] || null;
  if (active) {
    const remain = left(active.endsAt);
    const kids = [
      shipArt(ship?.type || 'scout'),
      el('h2', {}, active.status === 'waiting_choice' ? 'Событие в пути' : 'Рейс'),
      el('p', {}, `${active.planet} · ${active.kind}`),
      remain > 0
        ? el('p', { class: 'muted', 'data-prefix': 'До финиша ', 'data-until': active.endsAt }, `До финиша ${fmtLeft(remain)}. Награду начислит сервер.`)
        : el('p', { class: 'muted' }, 'Время вышло. Обновляем результат…'),
    ];
    if (active.event) {
      kids.push(el('div', { class: 'block' },
        el('h3', {}, active.event.title),
        el('p', {}, active.event.text),
        el('div', { class: 'choices' }, ...active.event.choices.map((c) =>
          el('button', {
            type: 'button',
            disabled: state.frozen ? '' : null,
            onClick: () => doChoose(active.id, c.id),
          }, `${c.label}${c.safe ? ' · тише' : ' · риск'}`),
        )),
      ));
    }
    if (Date.now() <= active.cancelUntil) {
      kids.push(el('button', { type: 'button', class: 'ghost', disabled: state.frozen ? '' : null, onClick: () => doCancel(active.id) }, 'Отменить (вернётся половина топлива)'));
    }
    if (active.reward) kids.push(rewardBlock(active.reward));
    if (note) kids.push(el('p', { class: 'ok' }, note));
    return el('div', {}, ...kids);
  }
  const last = state.expeditions.recent[0];
  // state.planets приходит с сервера; пустой массив — страховка от старого API,
  // иначе вкладка «Рейс» падала бы на filter и экран оставался пустым.
  const planets = Array.isArray(state.planets) ? state.planets : [];
  const open = planets.filter((p) => !p.locked);
  const planetId = open[0]?.id;
  const selected = planets.find((p) => p.id === (window.__planet || planetId)) || open[0];
  const kind = window.__kind || 'short';
  const opt = selected?.options.find((o) => o.kind === kind);
  return el('div', {},
    shipArt(ship?.type || 'scout'),
    el('h2', {}, 'Новый рейс'),
    el('label', {}, 'Планета', el('select', { onChange: (e) => { window.__planet = e.target.value; render(); } },
      ...planets.map((p) => el('option', { value: p.id, selected: p.id === selected?.id ? '' : null, disabled: p.locked ? '' : null },
        p.locked ? `${p.name} — ${p.lock}` : p.name)))),
    el('div', { class: 'choices' }, ...['short', 'medium', 'long'].map((k) => {
      const o = selected?.options.find((x) => x.kind === k);
      return el('button', { type: 'button', class: k === kind ? '' : 'ghost', onClick: () => { window.__kind = k; render(); } }, o ? o.label : k);
    })),
    opt ? el('p', { class: 'muted' }, `Топливо ${opt.fuel}, ${fmtDur(opt.durationMs)}, опыт ${opt.xp}. Оценка ASTRA ${opt.astra[0]}–${opt.astra[1]}, груз ${opt.units[0]}–${opt.units[1]}. Итог считает сервер, это не обещание.`) : null,
    el('button', {
      type: 'button',
      disabled: !opt || !ship || state.frozen || state.balances.fuel < (opt?.fuel ?? 99) || ship.durability <= 0 ? '' : null,
      onClick: () => doStart(ship?.id, selected?.id, kind),
    }, 'Старт'),
    ship && ship.durability > 0 && ship.durability <= 70 ? el('p', { class: 'error' }, 'Прочность низкая. Ниже 50% ремонт закрыт: нет alloy_plate.') : null,
    last?.reward ? rewardBlock(last.reward, 'Прошлый результат уже начислен') : null,
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
  );
}

function rewardBlock(reward, title = 'Результат уже начислен') {
  const res = (reward.resources || []).map((r) => `${r.amount} ${r.resource}`).join(', ');
  return el('div', { class: 'block' },
    el('h3', {}, title),
    el('p', {}, `+${reward.astra} ASTRA, +${reward.points} очков, +${reward.xp} опыта, износ ${reward.wear}%`),
    res ? el('p', { class: 'muted' }, res) : null,
  );
}

function renderFleet() {
  const owned = state.ships.map((s) => el('div', { class: 'block' },
    shipArt(s.type),
    el('h3', {}, `${s.name} · ${s.durability}%`),
    el('p', { class: 'muted' }, s.status === 'flying' ? 'В рейсе' : 'На базе'),
    s.repair.blocked === 'ok' ? el('button', { type: 'button', disabled: state.frozen ? '' : null, onClick: () => doRepair(s.id) }, `Ремонт за ${s.repair.cost} ASTRA`) : null,
    s.repair.blocked === 'needs_plate' ? el('p', { class: 'error' }, 'Ниже 50%. Нужен alloy_plate, крафт ещё не открыт.') : null,
    s.durability <= 70 && s.durability >= 50 ? el('p', { class: 'muted' }, 'Почините до следующего рейса, иначе можно просесть ниже 50%.') : null,
  ));
  const locked = state.catalog.filter((c) => !c.owned).map((c) => el('div', { class: 'block locked' },
    el('img', { src: `/sprites/${c.type}.svg`, alt: '', width: '96', height: '60' }),
    el('h3', {}, c.name),
    el('p', { class: 'muted' }, `Уровень ${c.unlockLevel}. ${c.price == null ? 'Чертёж, не продаётся' : `${c.price} ASTRA — покупка на этапе 2`}`),
  ));
  return el('div', {}, el('h2', {}, 'Флот'), ...owned, el('h2', {}, 'Закрыто'), ...locked, note ? el('p', { class: 'ok' }, note) : null);
}

function renderWallet() {
  const f = state.fuel;
  return el('div', {},
    el('h2', {}, 'Кошелёк'),
    cards(),
    el('p', { class: 'muted' }, 'ASTRA нельзя вывести и нельзя купить за деньги.'),
    el('div', { class: 'block' },
      el('h3', {}, 'Топливо'),
      el('p', {}, `${f.price} ASTRA за единицу. Сегодня ${f.boughtToday}/${f.dailyMax}. Бак ${state.balances.fuel}/${f.cap}.`),
      f.nextAt
        ? el('p', { class: 'muted', 'data-prefix': 'Следующая единица сама через ', 'data-until': f.nextAt })
        : el('p', { class: 'muted' }, 'Восстановление +1 каждые 2 часа'),
      el('button', {
        type: 'button',
        disabled: state.frozen || state.balances.fuel >= f.cap || f.boughtToday >= f.dailyMax || state.balances.astra < f.price ? '' : null,
        onClick: doBuyFuel,
      }, 'Купить 1'),
    ),
    state.resources.length ? el('div', { class: 'block' }, el('h3', {}, 'Трюм'), el('ul', { class: 'plain' },
      ...state.resources.map((r) => el('li', {}, el('span', {}, r.name), el('span', {}, String(r.amount)))))) : el('p', { class: 'muted' }, 'Трюм пуст. Ресурсы привезёт рейс.'),
    note ? el('p', { class: 'ok' }, note) : null,
  );
}

function renderLedger() {
  return el('div', {},
    el('h2', {}, 'Журнал'),
    el('p', { class: 'muted' }, 'Записи только добавляются. Подменить баланс из клиента нельзя.'),
    ledger.length ? el('ul', { class: 'plain' }, ...ledger.map((e) => el('li', {},
      el('span', {}, `${REASONS[e.reason] || e.reason}`),
      el('span', {}, `${e.delta > 0 ? '+' : ''}${e.delta} ${ASSETS[e.asset] || e.asset}`),
    ))) : el('p', { class: 'muted' }, 'Пока пусто'),
  );
}

function render() {
  if (!state) return;
  $('#world').textContent = `Мир ${state.world_id} · ур. ${state.level}`;
  $('#frozen').hidden = !state.frozen;
  const panel = $('#panel');
  panel.replaceChildren();
  const body = view === 'flight' ? renderFlight() : view === 'fleet' ? renderFleet() : view === 'wallet' ? renderWallet() : view === 'ledger' ? renderLedger() : renderBridge();
  panel.append(body);
  for (const b of document.querySelectorAll('.dock button')) b.classList.toggle('active', b.dataset.view === view);
}

async function loadGame() {
  const { status, data } = await authed('/me');
  if (status !== 200) { show('auth'); return; }
  state = data;
  syncServerTime(data.server_time);
  if (view === 'ledger') {
    const led = await authed('/ledger');
    ledger = led.status === 200 ? led.data.entries : [];
  }
  show('game');
  render();
}

async function act(scope, path, body) {
  note = '';
  const key = idemKey(scope);
  const { status, data } = await authed(path, { method: 'POST', headers: { 'Idempotency-Key': key }, body });
  idemDone(scope);
  if (status >= 400) note = `Ошибка: ${errText(data.error)}`;
  else note = 'Готово';
  await loadGame();
}

function doClaim() { return act('claim', '/claim', {}); }
function doStart(shipId, planet, kind) {
  if (!shipId || !planet) { note = 'Ошибка: выберите планету и корабль'; render(); return Promise.resolve(); }
  return act(`start:${shipId}:${planet}:${kind}`, '/expeditions/start', { shipId, planet, kind });
}
function doCancel(id) { return act(`cancel:${id}`, '/expeditions/cancel', { expeditionId: id }); }
function doChoose(id, choiceId) { return act(`choose:${id}:${choiceId}`, '/expeditions/choose', { expeditionId: id, choiceId }); }
function doRepair(id) { return act(`repair:${id}`, '/ships/repair', { shipId: id }); }
function doBuyFuel() { return act(`fuel:${state?.fuel.boughtToday}`, '/fuel/buy', {}); }

function setView(v) {
  view = v;
  note = '';
  loadGame();
}

$('#tab-register').addEventListener('click', () => setMode('register'));
$('#tab-login').addEventListener('click', () => setMode('login'));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit');
  btn.disabled = true;
  $('#auth-error').textContent = '';
  const body = { email: $('#email').value, password: $('#password').value };
  if (config.turnstile_site_key && turnstileToken) body.turnstileToken = turnstileToken;
  const { status, data } = await request(`/auth/${mode}`, { method: 'POST', body });
  btn.disabled = false;
  resetTurnstile();
  if (status === 200) {
    token = data.access_token;
    loginNeedsTurnstile = false;
    $('#password').value = '';
    await loadGame();
    return;
  }
  if (data.turnstile_required) {
    loginNeedsTurnstile = true;
    refreshTurnstileVisibility();
  }
  $('#auth-error').textContent = data.error === 'turnstile_required'
    ? 'Подтвердите, что вы не робот, и отправьте ещё раз'
    : errText(data.error);
});
$('#logout').addEventListener('click', async () => {
  await request('/auth/logout', { method: 'POST' });
  token = null;
  state = null;
  show('auth');
});
for (const b of document.querySelectorAll('.dock button')) b.addEventListener('click', () => setView(b.dataset.view));

// Раз в секунду обновляем только таймеры, а не весь DOM: иначе у пользователя
// закрывался бы список планет, открытый в <select>.
setInterval(() => {
  clock += 1;
  if (state) updateTimers();
  const active = state?.expeditions?.active;
  if (active && left(active.endsAt) === 0 && clock % 5 === 0) loadGame();
}, 1000);

(async () => {
  const health = await request('/health').catch(() => null);
  if (health?.status === 200) syncServerTime(health.data.now);
  await loadConfig();
  if (await refresh()) await loadGame();
  else show('auth');
})();
