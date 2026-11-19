// Признак «JS работает»: без него CSS не прячет секции перед анимацией появления.
document.documentElement.classList.add('js');

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
  season_not_found: 'Сезон не найден',
  bad_mission: 'Такой миссии нет',
  mission_claimed: 'Награда за эту миссию уже получена',
  mission_incomplete: 'Миссия ещё не выполнена',
  bad_pass_level: 'Такого уровня Pass нет',
  pass_locked: 'Уровень ещё закрыт: нужно больше очков',
  pass_claimed: 'Награда этого уровня уже получена',
  bad_guild_name: 'Название гильдии: от 3 до 24 символов',
  bad_guild_tag: 'Тег гильдии: 2–5 латинских букв или цифр',
  guild_not_found: 'Гильдия с таким кодом не найдена',
  guild_full: 'В гильдии нет свободных мест',
  guild_name_taken: 'Такое название уже занято',
  already_in_guild: 'Вы уже в гильдии',
  not_in_guild: 'Вы не в гильдии',
  guild_member_not_found: 'Такого участника нет в гильдии',
  not_allowed: 'Недостаточно прав',
  bad_role: 'Такой роли нет',
  bad_target: 'Выберите другого игрока',
  referral_not_found: 'Код приглашения не найден',
  self_referral: 'Свой код приглашения применить нельзя',
  referral_already_applied: 'Код приглашения уже применён',
  referral_limit: 'У пригласившего исчерпан лимит приглашений',
  ship_busy: 'Корабль уже в рейсе',
  ship_broken: 'Прочность 0%. Нужен ремонт',
  sector_locked: 'Сектор ещё закрыт',
  ship_range: 'Этот корабль так далеко не летает',
  not_enough_fuel: 'Не хватает топлива',
  too_late_to_cancel: 'Отмена уже недоступна',
  not_waiting: 'Событие уже закрыто',
  bad_choice: 'Такого варианта нет',
  nothing_to_repair: 'Чинить нечего',
  repair_needs_alloy_plate: 'Ниже 50% нужна сплавная пластина — она крафтится в разделе «Крафт»',
  fuel_tank_full: 'Бак полон',
  fuel_daily_limit: 'Суточный лимит топлива исчерпан',
  insufficient_funds: 'Не хватает ASTRA',
  insufficient_resources: 'Не хватает ресурсов',
  bad_recipe: 'Такого рецепта нет',
  craft_queue_full: 'Очередь крафта занята',
  bad_module: 'Такого модуля нет',
  module_slots_full: 'Свободных слотов на корабле нет',
  module_max_level: 'У модуля уже максимальный уровень',
  bad_ship_type: 'Такого корабля нет',
  ship_not_for_sale: 'Этот корабль не продаётся за ASTRA',
  ship_locked: 'Уровень ещё мал для этого корабля',
  ship_owned: 'Такой корабль уже в ангаре',
  bad_resource: 'Этот ресурс не торгуется',
  bad_amount: 'Количество от 1 до 1000',
  bad_price: 'Цена должна быть больше нуля',
  market_lot_limit: 'На рынке уже 10 ваших лотов — снимите один',
  price_out_of_band: 'Цена вне коридора: смотрите подсказку под полем',
  lot_not_found: 'Лот не найден — возможно, его уже купили',
  lot_closed: 'Лот уже закрыт',
  own_lot: 'Нельзя купить свой лот',
  not_your_lot: 'Это чужой лот',
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
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте снова',
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
  resource_gain: 'Ресурсы из рейса',
  expedition_wear: 'Износ корабля',
  ship_delivery: 'Выдача корабля',
  craft_fee: 'Плата за крафт',
  craft_input: 'Ресурсы в крафт',
  craft_output: 'Крафт готов',
  repair_plate: 'Пластина в ремонт',
  module_buy: 'Покупка модуля',
  module_parts: 'Компоненты модуля',
  ship_purchase: 'Покупка корабля',
  market_escrow: 'Ресурс на рынок (эскроу)',
  market_buy: 'Покупка на рынке',
  market_sale: 'Продажа на рынке',
  market_tax: 'Налог рынка',
  market_cancel: 'Снятие лота',
  migration: 'Перенос истории',
};
const ASSETS = { astra: 'ASTRA', fuel: 'Топливо', points: 'Очки' };
const RESOURCES = {
  iron_ore: 'Железная руда', copper_ore: 'Медная руда', silicon: 'Кремний', ice: 'Лёд',
  helium3: 'Гелий-3', titanium: 'Титан', crystal: 'Кристалл',
  astralite: 'Астралит', void_crystal: 'Пустотный кристалл', quantum_dust: 'Квантовая пыль',
  energy_cell: 'Энергоячейка', circuit: 'Схема', alloy_plate: 'Сплавная пластина',
};

// Запись журнала по ресурсу приходит как res:<имя>, а не как базовый актив.
function assetLabel(asset) {
  const a = String(asset || '');
  if (a.startsWith('res:')) {
    const id = a.slice(4);
    return RESOURCES[id] || id;
  }
  if (a === 'xp') return 'Опыт';
  if (a.startsWith('dur:')) return 'Прочность корабля';
  return ASSETS[a] || a;
}

const errText = (code) => ERRORS[code] || 'Что-то пошло не так';

let token = null;
let mode = 'register';
let view = 'bridge';
let state = null;
let ledger = [];
// Полный отчёт по сезону приходит из /season: в /me лежит только компактный блок.
let seasonData = null;
// Социальное (этап 4): «Задания» — миссии, достижения и Pass; «Команда» — гильдия и рефералы.
let socialData = null;
let guildData = null;
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

function setText(selector, value) {
  const n = document.querySelector(selector);
  if (n) n.textContent = String(value);
}

function callsign() {
  try { return localStorage.getItem('astra:callsign') || 'Пилот'; } catch { return 'Пилот'; }
}

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
  try {
    const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } catch {
    // Обрыв сети не должен оставлять кнопку заблокированной и «выкидывать» из игры.
    return { status: 0, data: { error: 'network' } };
  }
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

// Три состояния страницы: лендинг, лендинг + модалка входа, игра.
// `auth` — это модальное окно над лендингом, поэтому сам лендинг остаётся видимым.
function show(which) {
  const overlay = $('#auth-overlay');
  if (overlay) overlay.hidden = which !== 'auth';
  $('#game').hidden = which !== 'game';
  const landing = $('#landing');
  if (landing) landing.hidden = which === 'game';
  document.body.classList.toggle('modal-open', which === 'auth');
  // В игре шапка не должна предлагать вход и регистрацию: командир уже внутри.
  document.body.classList.toggle('in-game', which === 'game');
}

// Открыть окно регистрации или входа с лендинга.
function openAuth(m) {
  setMode(m === 'login' ? 'login' : 'register');
  show('auth');
  $('#auth-error').textContent = '';
  // Фокус ставим после отрисовки, иначе Safari игнорирует его на скрытом поле.
  setTimeout(() => { const field = $('#email'); if (field) field.focus(); }, 30);
}

function closeAuth() {
  show('landing');
  resetTurnstile();
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
function fmtAgo(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} ч назад` : `${Math.floor(h / 24)} дн назад`;
}

// Гейт 1 закрывается семью днями подряд; сервер считает стрик сам (verify.streak).
const VERIFY_GATE_DAYS = 7;

function verifyLine() {
  const v = state?.verify;
  if (!v || v.at == null) return el('p', { class: 'muted' }, 'Сверка журнала ещё не проходила.');
  const ago = fmtAgo(Math.max(0, Date.now() + serverOffset - v.at));
  if (!v.ok) return el('p', { class: 'error' }, `Сверка журнала: расхождение · ${ago}. Мир заморожен.`);
  const streak = Number(v.streak ?? 0);
  const tail = streak >= VERIFY_GATE_DAYS
    ? ` ${VERIFY_GATE_DAYS}/${VERIFY_GATE_DAYS} дней — гейт 1 закрыт.`
    : ` ${Math.min(streak, VERIFY_GATE_DAYS)}/${VERIFY_GATE_DAYS} дней до гейта 1.`;
  return el('p', { class: 'muted' }, `Сверка журнала: OK · ${ago}.${tail}`);
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// Дата сезона без года: сезон длиной восемь недель редко переходит год,
// а если переходит — месяц и день всё равно однозначны.
function fmtDay(ms) {
  const d = new Date(Number(ms) || 0);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function fmtDayFull(ms) {
  const d = new Date(Number(ms) || 0);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  return m < 120 ? `${m} мин` : `${Math.round(m / 60)} ч`;
}

function shipArt(type) {
  return el('div', { class: 'ship-viewer' }, el('img', { src: `/sprites/ships/${type}.png`, alt: '', width: '256', height: '128' }));
}

// «#3 из 24» или «пока без места», если игрок ещё не в рейтинге.
function rankText(season) {
  if (!season) return 'Сезон ещё не начался';
  if (!season.rank) return `Место в рейтинге появится после первого рейса · игроков ${season.players}`;
  return `#${season.rank} из ${season.players} · осталось ${season.daysLeft} дн.`;
}

function cards() {
  const b = state.balances;
  const label = (icon, text) => el('span', { class: 'label' },
    el('img', { src: `/icons/currency/${icon}.png`, alt: '', width: '18', height: '18', class: 'icon-sm' }), text);
  return el('div', { class: 'cards' },
    el('div', { class: 'card' }, label('astra', 'ASTRA'), el('span', { class: 'value' }, b.astra)),
    el('div', { class: 'card' }, label('fuel', 'Топливо'), el('span', { class: 'value' }, `${b.fuel}/${state.fuel.cap}`)),
    el('div', { class: 'card' }, label('points', 'Очки'), el('span', { class: 'value' }, b.points)),
    el('div', { class: 'card' }, el('span', { class: 'label' }, 'Уровень'), el('span', { class: 'value' }, `${state.level}`)),
  );
}

function renderBridge() {
  const season = state.season;
  const ship = state.ships[0];
  const active = state.expeditions.active;
  const claimLeft = left(state.nextClaimAt);
  const b = state.balances;
  return el('div', { class: 'screen' },
    el('div', { class: 'hero' },
      shipArt(ship?.type || 'scout'),
      el('div', { class: 'hero-copy' },
        el('span', { class: 'badge' }, 'Мостик'),
        el('h2', {}, active ? 'Рейс в пути' : 'Готовы к прыжку?'),
        el('p', { class: 'muted' }, active
          ? `${active.planet} · до финиша ${fmtLeft(left(active.endsAt))}`
          : 'Выберите планету, отправьте корабль и привезите ресурсы.'),
        el('button', {
          type: 'button',
          class: active ? 'cta cta-ghost' : 'cta',
          onClick: () => setView('flight'),
        }, active ? 'Открыть рейс' : 'Начать экспедицию'),
      ),
    ),
    el('div', { class: 'panel-grid' },
      el('div', { class: 'block' },
        el('h3', {}, 'Ежедневный Claim'),
        el('p', { class: 'muted', 'data-claim-note': '' }, claimLeft > 0
          ? `Следующий Claim через ${fmtLeft(claimLeft)}`
          : 'Claim доступен. +5 ASTRA, не чаще раза в 15 минут.'),
        el('button', {
          type: 'button', 'data-claim': '',
          disabled: claimLeft > 0 || state.frozen ? '' : null,
          onClick: doClaim,
        }, el('img', { src: '/icons/ui/claim.png', alt: '', width: '22', height: '22', class: 'icon-sm' }), 'Забрать'),
      ),
      el('div', { class: 'block' },
        el('h3', {}, 'Корабль'),
        el('p', { class: 'muted' }, `${ship?.name || 'Scout'} · прочность ${ship?.durability ?? 0}% · ${b.fuel}/${state.fuel.cap} топлива`),
        el('button', { type: 'button', class: 'ghost', onClick: () => setView('fleet') }, 'Открыть флот'),
      ),
      el('div', { class: 'block' },
        el('h3', {}, 'Кошелёк'),
        el('p', { class: 'muted' }, `${b.astra} ASTRA · ${b.points} очков`),
        el('button', { type: 'button', class: 'ghost', onClick: () => setView('wallet') }, 'Открыть кошелёк'),
      ),
      season ? el('div', { class: 'block season-block' },
        el('h3', {},
          el('img', { src: '/icons/nav/season.png', alt: '', width: '18', height: '18', class: 'icon-sm' }),
          `Сезон ${season.number}`),
        el('p', { class: 'muted' }, `${rankText(season)} · ${season.points} очков`),
        el('p', { class: 'muted', 'data-prefix': 'До конца сезона ', 'data-until': season.endsAt },
          `До конца сезона ${fmtLeft(left(season.endsAt))}`),
        el('button', { type: 'button', class: 'ghost', onClick: () => setView('season') }, 'Открыть сезон'),
      ) : null,
    ),
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
  let selected = planets.find((p) => p.id === (window.__planet || planetId)) || open[0];
  // window.__planet переживает перезагрузку, а уровень/корабль могли измениться.
  // Закрытую планету молча заменяем первой доступной, иначе «Старт» всегда выключен.
  if (!selected || selected.locked) selected = open[0];
  const kind = window.__kind || 'short';
  const opt = selected?.options.find((o) => o.kind === kind);

  const planetArt = (p, big) => el('span', { class: `planet-art p-${p.id}${big ? ' big' : ''}` },
    el('img', {
      src: `/icons/planets/${p.id}.png`, alt: '', width: big ? '96' : '84', height: big ? '96' : '84',
      loading: 'lazy',
      // Пока иконка не сгенерирована, остаётся градиентный шар из CSS.
      onError: (e) => e.currentTarget.remove(),
    }));

  const grid = el('div', { class: 'planet-grid', role: 'list' }, ...planets.map((p) => {
    const isSel = p.id === selected?.id;
    return el('button', {
      type: 'button',
      class: `planet-card${isSel ? ' selected' : ''}${p.locked ? ' locked' : ''}`,
      disabled: p.locked ? '' : null,
      'aria-pressed': isSel ? 'true' : 'false',
      title: p.locked ? p.lock : p.name,
      onClick: () => { window.__planet = p.id; render(); },
    },
      planetArt(p, false),
      el('span', { class: 'planet-name' }, p.name),
      el('span', { class: 'planet-meta' }, p.locked
        ? el('span', { class: 'lock-meta' },
            el('img', { src: '/icons/ui/lock.png', alt: '', width: '12', height: '12', class: 'icon-xs', loading: 'lazy' }),
            p.lock)
        : `Сектор ${p.sector} · сложность ${p.difficulty}`),
      !p.locked && p.resources?.length ? el('span', { class: 'planet-res' },
        ...p.resources.slice(0, 3).map((r) => el('img', {
          src: `/icons/resources/${r.id}.png`, alt: '', width: '14', height: '14', class: 'icon-xs', loading: 'lazy',
        }))) : null,
    );
  }));

  const detail = selected ? el('div', { class: 'planet-detail' },
    planetArt(selected, true),
    el('div', { class: 'planet-detail-info' },
      el('h3', {}, selected.name),
      el('p', { class: 'muted' }, `Сектор ${selected.sector} · ${selected.sectorName} · сложность ${selected.difficulty}`),
      el('div', { class: 'res-list' }, ...(selected.resources || []).map((r) => el('span', {},
        el('img', { src: `/icons/resources/${r.id}.png`, alt: '', width: '14', height: '14', class: 'icon-xs', loading: 'lazy' }),
        r.name))),
    ),
  ) : null;

  return el('div', {},
    shipArt(ship?.type || 'scout'),
    el('div', { class: 'screen-title' }, el('h2', {}, 'Куда летим'), el('span', { class: 'badge' }, 'Экспедиция')),
    grid,
    detail,
    el('div', { class: 'choices kinds' }, ...['short', 'medium', 'long'].map((k) => {
      const o = selected?.options.find((x) => x.kind === k);
      return el('button', { type: 'button', class: k === kind ? '' : 'ghost', onClick: () => { window.__kind = k; render(); } },
        el('img', { src: `/icons/ui/route_${k}.png`, alt: '', width: '20', height: '20', class: 'icon-sm', loading: 'lazy' }),
        o ? o.label : k);
    })),
    opt ? el('div', { class: 'block' },
      el('p', { class: 'muted' },
        `Топливо ${opt.fuel} · ${fmtDur(opt.durationMs)} · опыт ${opt.xp}`),
      el('p', { class: 'muted' },
        `Оценка ASTRA ${opt.astra[0]}–${opt.astra[1]}, груз ${opt.units[0]}–${opt.units[1]}. Итог считает сервер.`),
    ) : null,
    el('button', {
      type: 'button',
      class: 'cta',
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
    s.repair.blocked === 'ok' ? el('button', { type: 'button', disabled: state.frozen ? '' : null, onClick: () => doRepair(s.id) },
      el('img', { src: '/icons/ui/repair.png', alt: '', width: '20', height: '20', class: 'icon-sm', loading: 'lazy' }),
      `Ремонт за ${s.repair.cost} ASTRA${s.repair.plate ? ' + пластина' : ''}`) : null,
    s.repair.blocked === 'needs_plate' ? el('p', { class: 'error' }, 'Ниже 50% нужна сплавная пластина — скрафтите её в «Крафте» (3 руды + 1 титан, 60 ASTRA).') : null,
    el('button', { type: 'button', class: 'ghost', onClick: () => setView('modules') },
      el('img', { src: '/icons/nav/modules.png', alt: '', width: '18', height: '18', class: 'icon-sm' }), 'Модули'),
    s.durability <= 70 && s.durability >= 50 ? el('p', { class: 'muted' }, 'Почините до следующего рейса, иначе можно просесть ниже 50%.') : null,
  ));
  // Покупка корабля: цена в ASTRA, уровень ворот, один корпус каждого типа.
  const shop = state.catalog.filter((c) => !c.owned).map((c) => {
    const tooLow = state.level < c.unlockLevel;
    const noMoney = c.price != null && state.balances.astra < c.price;
    const label = c.price == null ? 'Чертёж: крафт позже'
      : tooLow ? `Нужен уровень ${c.unlockLevel}`
        : noMoney ? `Не хватает ${astraNum(c.price - state.balances.astra)} ASTRA`
          : `Купить за ${astraNum(c.price)} ASTRA`;
    return el('div', { class: `block${tooLow || c.price == null ? ' locked' : ''}` },
      el('img', { src: `/sprites/ships/${c.type}.png`, alt: '', width: '96', class: 'sprite-thumb' }),
      el('h3', {},
        tooLow ? el('img', { src: '/icons/ui/lock.png', alt: '', width: '14', height: '14', class: 'icon-xs', loading: 'lazy' }) : null,
        ` ${c.name}`),
      el('p', { class: 'muted' },
        `Груз ${c.cargo} · бак ${c.tank} · добыча ×${c.mining} · уровень ${c.unlockLevel}`),
      el('button', {
        type: 'button',
        disabled: state.frozen || tooLow || c.price == null || noMoney ? '' : null,
        onClick: () => doBuyShip(c.type),
      }, label),
    );
  });
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Флот'), el('span', { class: 'badge' }, `${state.ships.length} в строю`)),
    ...owned,
    el('div', { class: 'screen-title' }, el('h2', {}, 'Верфь'), el('span', { class: 'badge' }, `${astraNum(state.balances.astra)} ASTRA`)),
    el('p', { class: 'muted' }, 'Один корпус каждого типа. Новый корабль расширяет бак флота и открывает дальние сектора.'),
    ...shop,
    note ? el('p', { class: 'ok' }, note) : null,
  );
}

// Крафт — отдельный раздел. Три рецепта, один слот: пока идёт задача, кнопки
// заблокированы, потому что очередь на сервере тоже одна.
function renderCraftScreen() {
  const c = state.craft;
  if (!c) return el('div', { class: 'screen' }, el('p', { class: 'muted' }, 'Сервер ещё не отдаёт крафт.'));
  const busy = c.slots - c.running.length <= 0;
  const have = (id) => (state.resources.find((r) => r.id === id)?.amount ?? 0);
  const rows = c.recipes.map((r) => {
    const enough = r.inputs.every((i) => have(i.resource) >= i.amount) && state.balances.astra >= r.fee;
    return el('div', { class: 'block craft-card' },
      el('img', { src: `/icons/resources/${r.id}.png`, alt: '', width: '56', height: '56', class: 'craft-art', loading: 'lazy' }),
      el('div', { class: 'craft-info' },
        el('h3', {}, r.name),
        el('p', { class: 'muted' }, r.inputs.map((i) => `${RESOURCES[i.resource] || i.resource} ${have(i.resource)}/${i.amount}`).join(' · ')),
        el('p', { class: 'muted' }, `Плата ${r.fee} ASTRA · ${fmtDur(r.ms)}`),
        el('button', {
          type: 'button',
          disabled: state.frozen || busy || !enough ? '' : null,
          onClick: () => doCraft(r.id),
        }, busy ? 'Очередь занята' : enough ? 'Скрафтить' : 'Не хватает'),
      ),
    );
  });
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Крафт'), el('span', { class: 'badge' }, `слотов ${c.slots}` )),
    el('p', { class: 'muted' }, 'Ресурсы и плата в ASTRA списываются сразу, компонент приходит по таймеру. Компоненты нужны модулям и крупному ремонту.'),
    el('div', { class: 'block' },
      el('h3', {}, 'Очередь'),
      c.running.length
        ? el('p', { class: 'ok', 'data-prefix': 'Готовится: ', 'data-until': c.running[0].endsAt }, c.running[0].name)
        : el('p', { class: 'muted' }, 'Пусто. Готовый компонент начислится сам, даже если экран закрыт.'),
    ),
    ...rows,
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
  );
}

// Модули: один экран на весь флот. Снять модуль нельзя, поэтому у каждого
// пункта только «Установить» или «Улучшить до уровня N».
function astraNum(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function moduleCard(ship, entry) {
  const owned = (ship.modules || []).find((m) => m.id === entry.id);
  const level = owned ? owned.level : 0;
  const next = entry.levels[level] || null;
  const slotsFree = level > 0 || ship.used < ship.slots;
  const have = (id) => (state.resources.find((r) => r.id === id)?.amount ?? 0);
  const partsOk = !next || next.parts.every((p) => have(p.resource) >= p.amount);
  const astraOk = !next || state.balances.astra >= next.price;
  const blocked = state.frozen || !next || !slotsFree || !partsOk || !astraOk;
  const label = !next ? 'Максимум' : !slotsFree ? 'Нет слота' : level === 0 ? 'Установить' : `Улучшить до ${next.level}`;
  const parts = next
    ? next.parts.map((p) => `${RESOURCES[p.resource] || p.resource} ${have(p.resource)}/${p.amount}`).join(' · ')
    : '';
  return el('div', { class: `block module-card${level ? ' installed' : ''}${blocked && !next ? ' locked' : ''}` },
    el('img', { src: `/sprites/modules/${entry.id}.png`, alt: '', width: '52', height: '52', class: 'module-art', loading: 'lazy' }),
    el('div', { class: 'module-info' },
      el('h3', {}, entry.name, level ? el('span', { class: 'badge' }, `L${level}`) : null),
      el('p', { class: 'muted' }, owned ? owned.effectText : 'Не установлен'),
      next
        ? el('p', { class: 'muted' }, `Дальше: ${next.effectText} · ${astraNum(next.price)} ASTRA${parts ? ` + ${parts}` : ''}`)
        : el('p', { class: 'muted' }, 'Дальше уровней нет'),
      el('button', {
        type: 'button',
        disabled: blocked ? '' : null,
        onClick: () => doInstall(ship.id, entry.id),
      }, label),
    ),
  );
}

function renderModules() {
  const m = state.modules;
  if (!m) return el('div', { class: 'screen' }, el('p', { class: 'muted' }, 'Сервер ещё не отдаёт модули.'));
  const blocks = [];
  for (const ship of m.ships) {
    blocks.push(el('div', { class: 'screen-title' },
      el('h2', {}, ship.name),
      el('span', { class: 'badge' }, `слоты ${ship.used}/${ship.slots}`),
    ));
    blocks.push(ship.modules.length
      ? el('p', { class: 'muted' }, ship.modules.map((x) => `${x.name} L${x.level}: ${x.effectText}`).join(' · '))
      : el('p', { class: 'muted' }, 'Модулей нет. Слоты пустые.'));
    blocks.push(el('div', { class: 'module-grid' }, ...m.catalog.map((entry) => moduleCard(ship, entry))));
  }
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Модули'), el('span', { class: 'badge' }, `до L${m.maxLevel}`)),
    el('p', { class: 'muted' }, 'Модуль ставится на корабль и занимает слот. Снять его нельзя — только улучшить: поэтому вложенные ASTRA не возвращаются.'),
    ...blocks,
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
  );
}

// Рынок — отдельный раздел. Лот держит ресурс в эскроу, поэтому продать один
// и тот же ресурс дважды нельзя. Цена ограничена коридором вокруг медианы
// сделок за неделю: подсказка под полем считается на сервере (market.band).
function marketLotRow(lot) {
  const short = state.balances.astra < lot.total;
  return el('div', { class: 'block market-row' },
    el('img', { src: `/icons/resources/${lot.resource}.png`, alt: '', width: '44', height: '44', class: 'market-art', loading: 'lazy' }),
    el('div', { class: 'market-info' },
      el('h3', {}, lot.name, el('span', { class: 'badge' }, `${lot.amount} шт`), lot.mine ? el('span', { class: 'badge' }, 'ваш') : null),
      el('p', { class: 'muted' }, `${astraNum(lot.unitPrice)} ASTRA за единицу · всего ${astraNum(lot.total)}`),
      el('p', { class: 'muted' }, lot.mine ? 'Ваш лот. Ресурс лежит в эскроу, пока лот открыт.' : `Продавец: ${lot.seller}`),
      lot.mine
        ? el('button', {
          type: 'button', class: 'ghost',
          disabled: state.frozen ? '' : null,
          onClick: () => doCancelLot(lot.id),
        }, 'Снять лот и вернуть ресурс')
        : el('button', {
          type: 'button',
          disabled: state.frozen || short ? '' : null,
          onClick: () => doBuyLot(lot.id),
        }, short ? `Не хватает ${astraNum(lot.total - state.balances.astra)} ASTRA` : `Купить за ${astraNum(lot.total)} ASTRA`),
    ),
  );
}

function renderMarket() {
  const m = state.market;
  if (!m) return el('div', { class: 'screen' }, el('p', { class: 'muted' }, 'Сервер ещё не отдаёт рынок.'));
  const saved = window.__mkt || {};
  const resource = m.resources.find((r) => r.id === saved.resource) || m.resources.find((r) => r.have > 0) || m.resources[0];
  const band = resource.band;
  const amount = Math.max(1, Math.min(m.maxAmount, Number(saved.amount) || Math.min(resource.have || 1, 10)));
  const price = Number(saved.price) || band.median;
  const total = amount * price;
  const tax = Math.floor(total * m.tax / 100);
  const outOfBand = price < band.min || price > band.max;
  // Кнопка активна, пока есть что продавать: количество и цену читаем в момент
  // клика (onClick ниже), иначе после правки поля уходили бы старые значения.
  const canSell = !state.frozen && resource.have >= 1 && m.mine < m.limit;

  const resSelect = el('select', {
    onChange: (e) => { window.__mkt = { resource: e.currentTarget.value }; render(); },
  }, ...m.resources.map((r) => el('option', { value: r.id, selected: r.id === resource.id ? '' : null },
    `${r.name} · в трюме ${r.have}`)));

  const amountInput = el('input', {
    type: 'number', min: '1', max: String(m.maxAmount), step: '1', value: String(amount), inputmode: 'numeric',
    onChange: (e) => { window.__mkt = { ...(window.__mkt || {}), amount: Number(e.currentTarget.value) }; render(); },
  });
  const priceInput = el('input', {
    type: 'number', min: String(band.min), max: String(band.max), step: '1', value: String(price), inputmode: 'numeric',
    onChange: (e) => { window.__mkt = { ...(window.__mkt || {}), price: Number(e.currentTarget.value) }; render(); },
  });

  const form = el('div', { class: 'block market-form' },
    el('h3', {}, 'Выставить лот'),
    el('label', {}, 'Ресурс', resSelect),
    el('label', {}, 'Количество', amountInput),
    el('label', {}, 'Цена за единицу, ASTRA', priceInput),
    el('p', { class: `market-band${outOfBand ? ' error' : ''}` },
      `Коридор ${band.min}–${band.max} ASTRA · медиана ${band.median}`,
      band.sales ? ` по ${band.sales} сделкам за ${m.windowDays} дн.` : ' — сделок ещё не было, берём базовую цену.',
      ' Налог ', el('b', {}, `${m.tax}%`), ': получите ', el('b', {}, `${astraNum(total - tax)} ASTRA`), ` из ${astraNum(total)}.`),
    el('p', { class: 'muted' }, outOfBand
      ? `Цена вне коридора. Поставьте от ${band.min} до ${band.max}.`
      : resource.have >= amount
        ? `Ресурс уйдёт в эскроу: ${amount} из ${resource.have} шт.`
        : `В трюме только ${resource.have} шт — уменьшите количество.`),
    el('button', {
      type: 'button',
      disabled: canSell ? null : '',
      onClick: () => doSellLot(resource.id, Number(amountInput.value) || amount, Number(priceInput.value) || price),
    }, resource.have < 1 ? 'В трюме нет ресурса' : m.mine >= m.limit ? 'Лимит лотов' : outOfBand ? 'Выставить (цена вне коридора)' : 'Выставить лот'),
  );

  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Рынок'), el('span', { class: 'badge' }, `налог ${m.tax}%`)),
    el('p', { class: 'muted' },
      `Торгуют игроки между собой. Лот покупается целиком, цена — за единицу. Ваших лотов ${m.mine} из ${m.limit}, максимум ${astraNum(m.maxAmount)} единиц в лоте.`),
    cards(),
    form,
    el('div', { class: 'screen-title' }, el('h2', {}, 'Лоты'), el('span', { class: 'badge' }, `${m.lots.length}`)),
    m.lots.length
      ? el('div', {}, ...m.lots.map(marketLotRow))
      : el('p', { class: 'muted' }, 'Открытых лотов нет. Можно выставить свой — его купят другие пилоты.'),
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
  );
}

// ── Сезон ─────────────────────────────────────────────────────────────────────
// Экран рейтинга. Компактный блок сезона приходит в /me, полный рейтинг — из
// /season: так /me не тащит сто строк на каждую загрузку мостика.
async function loadSeason() {
  const { status, data } = await authed('/season');
  if (status === 200) seasonData = data;
  else if (status !== 0) note = `Ошибка: ${errText(data.error)}`;
  if (view === 'season') render();
}

function rankCell(rank) {
  if (rank <= 3) {
    return el('span', { class: 'rating-place' },
      el('img', { src: `/icons/season/medal_${rank}.png`, alt: `${rank} место`, width: '26', height: '26', loading: 'lazy' }));
  }
  return el('span', { class: 'rating-place muted' }, `#${rank}`);
}

function renderSeason() {
  const brief = state.season;
  const data = seasonData;
  if (!data) {
    return el('div', { class: 'screen' },
      el('div', { class: 'screen-title' }, el('h2', {}, `Сезон ${brief ? brief.number : 1}`), el('span', { class: 'badge' }, '8 недель')),
      el('p', { class: 'muted' }, 'Считаем рейтинг…'),
      note ? el('p', { class: 'error' }, note) : null,
    );
  }
  const season = data.season;
  const me = data.me;
  const total = Math.max(1, season.lengthDays);
  const passed = Math.max(0, Math.min(total, total - season.daysLeft));
  const pct = Math.round((passed / total) * 100);

  const hero = el('div', { class: 'season-hero' },
    el('img', { class: 'season-emblem', src: '/icons/season/trophy.png', alt: '', width: '116', height: '116' }),
    el('div', { class: 'season-hero-body' },
      el('h3', {}, `Сезон ${season.number}`),
      el('p', { class: 'muted' }, `${fmtDayFull(season.startsAt)} — ${fmtDayFull(season.endsAt)} · осталось ${season.daysLeft} дн.`),
      el('div', { class: 'season-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
        el('span', { style: `width:${pct}%` })),
      el('ul', { class: 'season-stats' },
        el('li', {}, el('span', { class: 'muted' }, 'Ваше место'), el('b', {}, me.rank ? `#${me.rank} из ${season.players}` : `— из ${season.players}`)),
        el('li', {}, el('span', { class: 'muted' }, 'Очки сезона'), el('b', {}, String(me.points))),
        el('li', {}, el('span', { class: 'muted' }, 'Приз при таком месте'), el('b', {}, me.reward ? `${me.reward} ASTRA` : 'пока нет')))),
  );

  const rating = data.top.length
    ? el('ol', { class: 'rating' }, ...data.top.map((row) => el('li', { class: `rating-row${row.isMe ? ' is-me' : ''}` },
      rankCell(row.rank),
      el('span', { class: 'rating-name' },
        row.label,
        row.isMe ? el('span', { class: 'rating-me' }, ' вы') : null,
        el('span', { class: 'rating-sub' }, `уровень ${row.level} · кораблей ${row.ships}`)),
      el('span', { class: 'rating-points' }, `${row.points}`))))
    : el('p', { class: 'muted' }, 'В этом сезоне ещё никто не летал. Первый рейс — и вы в рейтинге.');

  const rewards = el('div', { class: 'block' },
    el('h3', {}, 'Награды за сезон'),
    el('ul', { class: 'plain' }, ...data.rewards.map((r) => el('li', {},
      el('span', {}, r.place === 'участие' ? 'Всем, кто набрал очки' : `${r.place} место`),
      el('span', {}, `${astraNum(r.astra)} ASTRA`)))),
    el('p', { class: 'muted' }, 'Призы начисляются один раз при закрытии сезона. Затем очки обнуляются, а мир получает следующий сезон.'));

  const past = data.past.length
    ? el('div', { class: 'block' },
      el('h3', {}, 'Прошлые сезоны'),
      ...data.past.map((p) => el('div', { class: 'past-season' },
        el('div', {}, el('b', {}, `Сезон ${p.number}`), el('span', { class: 'muted' }, ` · закрыт ${fmtDayFull(p.closedAt)}`)),
        el('p', { class: 'muted' }, p.winner
          ? `Победитель: ${p.winner.label} · ${p.winner.points} очков · ${astraNum(p.winner.reward)} ASTRA`
          : 'Никто не набрал очков — призы не начислялись.'),
        el('p', { class: 'muted' }, p.me
          ? `Ваше место: #${p.me.rank} из ${p.players} · ${p.me.points} очков · ${astraNum(p.me.reward)} ASTRA`
          : `Ваше место: вне итогов (в сезоне участвовало ${p.players})`))))
    : el('p', { class: 'muted' }, 'Это первый сезон мира: списка прошлых сезонов пока нет.');

  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Сезон'), el('span', { class: 'badge' }, `${season.players} игроков`)),
    el('p', { class: 'muted' }, 'Восемь недель, очки за рейсы и призы за места. Очки нельзя купить, передать или получить за деньги.'),
    hero,
    el('div', { class: 'screen-title' }, el('h2', {}, 'Рейтинг'), el('span', { class: 'badge' }, `топ ${data.top.length}`)),
    rating,
    rewards,
    past,
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'ghost', onClick: () => { seasonData = null; render(); loadSeason(); } }, 'Обновить рейтинг')),
    note ? el('p', { class: 'note' }, note) : null,
  );
}

// ── Задания и Astra Pass (этап 4) ────────────────────────────────────────────
// Прогресс миссий считает сервер по журналу и таблицам игры, поэтому клиент
// только рисует то, что пришло: никаких счётчиков на стороне браузера.
async function loadSocial() {
  const { status, data } = await authed('/social');
  if (status === 200) socialData = data;
  else if (status !== 0) note = `Ошибка: ${errText(data.error)}`;
  if (view === 'missions') render();
}

function missionCard(m) {
  const pct = Math.round((m.progress / m.target) * 100);
  return el('div', { class: `mission${m.claimed ? ' is-done' : ''}` },
    el('div', { class: 'mission-head' },
      el('b', {}, m.title),
      el('span', { class: 'badge' }, m.claimed ? 'получено' : `${m.progress}/${m.target}`)),
    el('p', { class: 'muted' }, m.hint),
    el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
      el('span', { style: `width:${pct}%` })),
    el('div', { class: 'mission-foot' },
      el('span', { class: 'muted' }, `+${m.astra} ASTRA · +${m.points} очков`),
      m.claimed
        ? el('span', { class: 'ok' }, '✓')
        : el('button', { type: 'button', class: 'primary', disabled: m.ready ? null : 'disabled', onClick: () => doClaimMission(m.id) }, m.ready ? 'Забрать' : 'В процессе')),
  );
}

function passRow(level) {
  return el('li', { class: `pass-level${level.claimed ? ' is-claimed' : ''}${level.unlocked ? '' : ' is-locked'}` },
    el('span', { class: 'pass-num' }, String(level.level)),
    el('span', { class: 'pass-label' },
      level.label,
      el('span', { class: 'rating-sub' }, level.unlocked ? 'уровень открыт' : `нужно ${level.threshold} очков`)),
    level.claimed
      ? el('span', { class: 'ok' }, '✓')
      : el('button', { type: 'button', class: 'ghost', disabled: level.ready ? null : 'disabled', onClick: () => doClaimPass(level.level) }, 'Забрать'));
}

function renderMissions() {
  const data = socialData;
  if (!data) {
    return el('div', { class: 'screen' },
      el('div', { class: 'screen-title' }, el('h2', {}, 'Задания'), el('span', { class: 'badge' }, 'день и неделя')),
      el('p', { class: 'muted' }, 'Считаем прогресс…'),
      note ? el('p', { class: 'error' }, note) : null,
    );
  }
  const { missions, achievements, pass } = data;
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Задания'), el('span', { class: 'badge' }, `${missions.ready} готово`)),
    el('p', { class: 'muted' }, 'Миссии обновляются по UTC: дневные — каждый день, недельная — в понедельник. Прогресс считается по фактам игры, а не по кнопкам.'),
    el('div', { class: 'mission-grid' }, ...missions.daily.map(missionCard)),
    el('div', { class: 'block' },
      el('h3', {}, 'Миссия недели'),
      missionCard(missions.weekly)),

    el('div', { class: 'screen-title' }, el('h2', {}, 'Astra Pass'), el('span', { class: 'badge' }, `уровень ${pass.level}`)),
    el('div', { class: 'pass-head' },
      el('img', { class: 'pass-icon', src: '/icons/social/pass.png', alt: '', width: '72', height: '72' }),
      el('div', {},
        el('p', {}, `Очки сезона: ${pass.points}`),
        el('p', { class: 'muted' }, pass.next ? `До уровня ${pass.next.level}: ${Math.max(0, pass.next.threshold - pass.points)} очков` : 'Все уровни открыты — забирайте награды.'),
        pass.slotActive ? el('p', { class: 'ok' }, 'Второй слот крафта открыт') : null)),
    el('ul', { class: 'pass-track' }, ...pass.levels.map(passRow)),
    el('p', { class: 'muted' }, 'Pass бесплатный: платного трека нет, ASTRA и очки за деньги не продаются.'),

    el('div', { class: 'screen-title' }, el('h2', {}, 'Достижения'), el('span', { class: 'badge' }, `${achievements.unlocked} из ${achievements.list.length}`)),
    el('div', { class: 'ach-grid' }, ...achievements.list.map((a) => el('div', { class: `ach${a.unlocked ? ' is-open' : ''}` },
      el('img', { src: '/icons/social/badge.png', alt: '', width: '40', height: '40', loading: 'lazy' }),
      el('b', {}, a.title),
      el('span', { class: 'rating-sub' }, a.unlocked ? 'получено' : a.hint)))),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'ghost', onClick: () => { socialData = null; render(); loadSocial(); } }, 'Обновить')),
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
  );
}

// ── Гильдия и рефералы (этап 4) ──────────────────────────────────────────────
async function loadGuild() {
  const { status, data } = await authed('/guild');
  if (status === 200) guildData = data;
  else if (status !== 0) note = `Ошибка: ${errText(data.error)}`;
  if (view === 'guild') render();
}

function roleName(role) {
  return role === 'leader' ? 'лидер' : role === 'officer' ? 'офицер' : 'участник';
}

function guildTopList(top) {
  return top.length
    ? el('ol', { class: 'rating' }, ...top.map((row) => el('li', { class: `rating-row${row.isMine ? ' is-me' : ''}` },
      el('span', { class: 'rating-place muted' }, `#${row.rank}`),
      el('span', { class: 'rating-name' }, `${row.name}`,
        el('span', { class: 'rating-sub' }, `[${row.tag}] · ${row.members} участников`)),
      el('span', { class: 'rating-points' }, `${row.points}`))))
    : el('p', { class: 'muted' }, 'Гильдий пока нет. Первая — ваша.');
}

function renderGuild() {
  const data = guildData;
  if (!data) {
    return el('div', { class: 'screen' },
      el('div', { class: 'screen-title' }, el('h2', {}, 'Команда'), el('span', { class: 'badge' }, 'гильдии')),
      el('p', { class: 'muted' }, 'Загружаем…'),
      note ? el('p', { class: 'error' }, note) : null,
    );
  }
  const { guild, referrals } = data;
  const head = guild.mine
    ? el('div', { class: 'guild-hero' },
      el('img', { class: 'guild-emblem', src: '/icons/social/banner.png', alt: '', width: '76', height: '76' }),
      el('div', { class: 'guild-hero-body' },
        el('h3', {}, `${guild.mine.name} [${guild.mine.tag}]`),
        el('p', { class: 'muted' }, `Место в рейтинге: #${guild.rank ?? '—'} · очки гильдии: ${guild.mine.points}`),
        el('p', { class: 'muted' }, `Вы: ${roleName(guild.role)} · участников ${guild.members.length} из ${guild.maxMembers}`),
        el('div', { class: 'guild-code' },
          el('span', { class: 'muted' }, 'Код приглашения'),
          el('b', {}, guild.mine.inviteCode),
          el('button', { type: 'button', class: 'ghost', onClick: () => {
            try { navigator.clipboard.writeText(guild.mine.inviteCode); note = 'Код скопирован'; render(); } catch { note = `Код: ${guild.mine.inviteCode}`; render(); }
          } }, 'Копировать'))))
    : el('div', { class: 'block' },
      el('h3', {}, 'Создать гильдию'),
      el('p', { class: 'muted' }, `Стоимость — ${guild.cost} ASTRA (уходит из экономики, а не другому игроку). До ${guild.maxMembers} человек.`),
      (() => {
        const name = el('input', { type: 'text', maxlength: '24', placeholder: 'Название гильдии', 'aria-label': 'Название гильдии' });
        const tag = el('input', { type: 'text', maxlength: '5', placeholder: 'ТЕГ', 'aria-label': 'Тег гильдии' });
        return el('div', { class: 'form' }, name, tag,
          el('button', { type: 'button', class: 'primary', onClick: () => doCreateGuild(name.value, tag.value) }, `Создать за ${guild.cost} ASTRA`));
      })());

  const joinBlock = guild.mine ? null : el('div', { class: 'block' },
    el('h3', {}, 'Вступить по коду'),
    (() => {
      const code = el('input', { type: 'text', maxlength: '6', placeholder: 'ABC123', 'aria-label': 'Код приглашения гильдии' });
      return el('div', { class: 'form' }, code,
        el('button', { type: 'button', class: 'primary', onClick: () => doJoinGuild(code.value) }, 'Вступить'));
    })());

  const members = guild.mine
    ? el('div', { class: 'block' },
      el('h3', {}, 'Участники'),
      el('ul', { class: 'members' }, ...guild.members.map((m) => el('li', { class: 'member' },
        el('span', { class: 'member-name' }, m.label, m.isMe ? el('span', { class: 'rating-me' }, ' вы') : null,
          el('span', { class: 'rating-sub' }, `${roleName(m.role)} · уровень ${m.level}`)),
        el('span', { class: 'rating-points' }, `${m.points}`),
        guild.role === 'leader' && !m.isMe && m.role !== 'leader'
          ? el('span', { class: 'member-actions' },
            el('button', { type: 'button', class: 'ghost', onClick: () => doGuildRole(m.playerId, m.role === 'officer' ? 'member' : 'officer') },
              m.role === 'officer' ? 'Разжаловать' : 'Офицер'),
            el('button', { type: 'button', class: 'ghost danger', onClick: () => doGuildKick(m.playerId) }, 'Исключить'))
          : guild.role === 'officer' && !m.isMe && m.role === 'member'
            ? el('button', { type: 'button', class: 'ghost danger', onClick: () => doGuildKick(m.playerId) }, 'Исключить')
            : null))))
    : null;

  const guildActions = guild.mine
    ? el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'ghost danger', onClick: () => doGuildLeave() }, 'Покинуть гильдию'))
    : null;

  const referralsBlock = el('div', { class: 'block' },
    el('h3', {}, 'Приглашения'),
    el('p', { class: 'muted' }, `Код: ${referrals.code} · награда ${referrals.reward} ASTRA каждому после ${referrals.qualifyAt} завершённых рейсов приглашённого.`),
    referrals.myInviter
      ? el('p', { class: 'ok' }, `Вас пригласил ${referrals.myInviter.label}` + (referrals.myInviter.status === 'qualified' ? ' — награда уже выплачена' : ` — прогресс ${referrals.myProgress}/${referrals.qualifyAt}`))
      : (() => {
        const code = el('input', { type: 'text', maxlength: '7', placeholder: 'КОД', 'aria-label': 'Код приглашения' });
        return el('div', { class: 'form' }, code,
          el('button', { type: 'button', class: 'primary', onClick: () => doApplyReferral(code.value) }, 'Применить код'));
      })(),
    el('p', { class: 'muted' }, `Приглашено: ${referrals.invited.length} из ${referrals.limit} · выплачено ${referrals.earned} ASTRA`),
    referrals.invited.length
      ? el('ul', { class: 'plain' }, ...referrals.invited.map((r) => el('li', {},
        el('span', {}, r.label),
        el('span', { class: r.status === 'qualified' ? 'ok' : 'muted' }, r.status === 'qualified' ? 'награда выплачена' : 'ещё летает'))))
      : el('p', { class: 'muted' }, 'Пока никого. Код можно отправить другу — награда придёт, когда он отлетает пять рейсов.'));

  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Команда'), el('span', { class: 'badge' }, guild.mine ? `${guild.members.length}/${guild.maxMembers}` : 'свободный пилот')),
    el('p', { class: 'muted' }, 'Гильдия — это круг общения и общий рейтинг, а не множитель дохода: очков и ASTRA она не добавляет.'),
    head,
    joinBlock,
    members,
    guildActions,
    el('div', { class: 'screen-title' }, el('h2', {}, 'Рейтинг гильдий'), el('span', { class: 'badge' }, `топ ${guild.top.length}`)),
    guildTopList(guild.top),
    referralsBlock,
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
  );
}

function renderWallet() {
  const f = state.fuel;
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Кошелёк'), el('span', { class: 'badge' }, 'ASTRA')),
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
    el('div', { class: 'block' },
      el('h3', {}, 'Рынок'),
      el('p', { class: 'muted' }, 'Ресурсы и компоненты можно продать другим пилотам. Лот держит ресурс в эскроу, налог 5%.'),
      el('button', { type: 'button', class: 'ghost', onClick: () => setView('market') },
        el('img', { src: '/icons/nav/market.png', alt: '', width: '18', height: '18', class: 'icon-sm' }), 'Открыть рынок'),
    ),
    el('div', { class: 'block' },
      el('h3', {}, 'Крафт'),
      el('p', { class: 'muted' }, 'Энергоячейка, схема и сплавная пластина — в отдельном разделе.'),
      el('button', { type: 'button', class: 'ghost', onClick: () => setView('craft') },
        el('img', { src: '/icons/nav/craft.png', alt: '', width: '18', height: '18', class: 'icon-sm' }), 'Открыть крафт'),
    ),
    state.resources.length ? el('div', { class: 'block' }, el('h3', {}, 'Трюм'), el('ul', { class: 'plain' },
      ...state.resources.map((r) => el('li', {},
      el('span', { class: 'res-name' },
        el('img', { src: `/icons/resources/${r.id}.png`, alt: '', width: '20', height: '20', class: 'icon', loading: 'lazy' }),
        r.name),
      el('span', {}, String(r.amount)))))) : el('p', { class: 'muted' }, 'Трюм пуст. Ресурсы привезёт рейс.'),
    note ? el('p', { class: 'ok' }, note) : null,
  );
}

function renderLedger() {
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Журнал'), el('span', { class: 'badge' }, 'append-only')),
    el('p', { class: 'muted' }, 'Записи только добавляются. Подменить баланс из клиента нельзя.'),
    verifyLine(),
    ledger.length ? el('ul', { class: 'plain' }, ...ledger.map((e) => el('li', {},
      el('span', {}, `${REASONS[e.reason] || e.reason}`),
      el('span', {}, `${e.delta > 0 ? '+' : ''}${e.delta} ${assetLabel(e.asset)}`),
    ))) : el('p', { class: 'muted' }, 'Пока пусто'),
  );
}

// Плашка «мир заморожен» появляется только когда сверка действительно не сошлась.
// В статическом HTML её нет: иначе рекламная модерация и поисковик видят на живой
// странице строку «мир заморожен» и решают, что игра сломана.
function renderFrozen() {
  const content = document.querySelector('.content');
  if (!content) return;
  const node = document.getElementById('frozen');
  if (!state.frozen) {
    if (node) node.remove();
    return;
  }
  if (node) return;
  const banner = el('p', { id: 'frozen', class: 'error' },
    'Мир заморожен: сверка журнала не сошлась. Игровые действия остановлены.');
  const panel = content.querySelector('#panel');
  content.insertBefore(banner, panel);
}

function render() {
  if (!state) return;
  const b = state.balances;
  setText('#world', `Мир ${state.world_id}`);
  setText('#commander', callsign());
  setText('#commander-mobile', callsign());
  setText('#top-astra', b.astra);
  setText('#top-fuel', `${b.fuel}/${state.fuel.cap}`);
  setText('#top-points', b.points);
  setText('#top-level', state.level);
  renderFrozen();
  const panel = $('#panel');
  panel.replaceChildren();
  const body = view === 'flight' ? renderFlight()
    : view === 'fleet' ? renderFleet()
      : view === 'craft' ? renderCraftScreen()
        : view === 'modules' ? renderModules()
          : view === 'market' ? renderMarket()
            : view === 'season' ? renderSeason()
              : view === 'missions' ? renderMissions()
                : view === 'guild' ? renderGuild()
            : view === 'wallet' ? renderWallet()
            : view === 'ledger' ? renderLedger() : renderBridge();
  panel.append(body);
  for (const btn of document.querySelectorAll('[data-view]')) btn.classList.toggle('active', btn.dataset.view === view);
}

// Рекламный слот один на всё приложение: он висит под топбаром и остаётся на
// экране при переключении разделов. Так сеть видит показ (у CryptoCoinsAd
// учитываются только видимые блоки), а мы не плодим невидимые вставки.
function mountAds() {
  const ads = config?.ads;
  const slot = document.getElementById('ad-slot');
  if (!slot || !ads?.enabled || !ads.script_url) return;
  if (slot.dataset.mounted === '1') return;
  slot.dataset.mounted = '1';
  if (ads.provider) slot.dataset.provider = String(ads.provider);
  if (ads.unit_id) slot.dataset.unitId = String(ads.unit_id);
  slot.hidden = false;
  // Подпись обязательна: сеть требует, чтобы реклама отличалась от контента игры.
  // Награды за клик или просмотр нет — ASTRA за рекламу не начисляется.
  if (!slot.querySelector('.ad-label')) {
    slot.append(el('span', { class: 'ad-label' }, 'Реклама'));
  }
  const s = document.createElement('script');
  s.src = ads.script_url;
  s.async = true;
  s.defer = true;
  s.dataset.adsProvider = String(ads.provider || 'ads');
  if (ads.unit_id) s.dataset.unitId = String(ads.unit_id);
  slot.append(s);
}

async function loadGame() {
  const { status, data } = await authed('/me');
  if (status === 401) { openAuth('login'); return; }
  if (status !== 200) {
    // 0 — сеть, истёкший токен уже обработан выше. Не сбрасываем экран молча.
    note = `Ошибка: ${errText(data.error)}`;
    if (state) render(); else openAuth('login');
    return;
  }
  state = data;
  syncServerTime(data.server_time);
  if (view === 'ledger') {
    const led = await authed('/ledger');
    ledger = led.status === 200 ? led.data.entries : [];
  }
  show('game');
  render();
  mountAds();
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
function doCraft(recipe) { return act(`craft:${recipe}`, '/craft/start', { recipe }); }
function doInstall(shipId, module) { return act(`module:${shipId}:${module}`, '/modules/install', { shipId, module }); }
function doBuyShip(type) { return act(`buy-ship:${type}`, '/ships/buy', { type }); }
function doSellLot(resource, amount, unitPrice) {
  // Ключ включает параметры: исправленная цена — новое действие, а не повтор.
  return act(`mkt-lot:${resource}:${amount}:${unitPrice}`, '/market/lot', { resource, amount, unitPrice })
    .then(() => { window.__mkt = {}; });
}
function doBuyLot(lotId) { return act(`mkt-buy:${lotId}`, '/market/buy', { lotId }); }
function doCancelLot(lotId) { return act(`mkt-cancel:${lotId}`, '/market/cancel', { lotId }); }
function doClaimMission(missionId) { return act(`mission:${missionId}`, '/missions/claim', { missionId }).then(loadSocial); }
function doClaimPass(level) { return act(`pass:${level}`, '/pass/claim', { level }).then(loadSocial); }
function doCreateGuild(name, tag) { return act(`guild-create:${name}:${tag}`, '/guild/create', { name, tag }).then(loadGuild); }
function doJoinGuild(code) { return act(`guild-join:${code}`, '/guild/join', { code }).then(loadGuild); }
function doGuildLeave() { return act('guild-leave', '/guild/leave', {}).then(loadGuild); }
function doGuildKick(playerId) { return act(`guild-kick:${playerId}`, '/guild/kick', { playerId }).then(loadGuild); }
function doGuildRole(playerId, role) { return act(`guild-role:${playerId}:${role}`, '/guild/role', { playerId, role }).then(loadGuild); }
function doApplyReferral(code) { return act(`ref:${code}`, '/referrals/apply', { code }).then(loadGuild); }

function setView(v) {
  view = v;
  note = '';
  // Рейтинг в /me не лежит: при входе в раздел подтягиваем полный отчёт.
  if (v === 'season') loadSeason();
  if (v === 'missions') loadSocial();
  if (v === 'guild') loadGuild();
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
    try {
      const em = ($('#email')?.value || '').trim();
      if (em) localStorage.setItem('astra:callsign', em.split('@')[0]);
    } catch { /* приватный режим */ }
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
  closeAuth();
});
for (const b of document.querySelectorAll('[data-open-auth]')) {
  b.addEventListener('click', () => openAuth(b.dataset.openAuth));
}
$('#auth-close').addEventListener('click', closeAuth);
$('#auth-overlay').addEventListener('click', (e) => {
  // Клик мимо карточки закрывает окно, клик внутри — нет.
  if (e.target === $('#auth-overlay')) closeAuth();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#auth-overlay').hidden) closeAuth();
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
for (const b of document.querySelectorAll('[data-soon]')) b.addEventListener('click', () => {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = `${b.dataset.soon} — появится на следующем этапе`;
  document.querySelector('.content')?.append(toast);
  setTimeout(() => toast.remove(), 2400);
});

// Раз в секунду обновляем только таймеры, а не весь DOM: иначе у пользователя
// закрывался бы список планет, открытый в <select>.
setInterval(() => {
  clock += 1;
  if (state) updateTimers();
  const active = state?.expeditions?.active;
  if (active && left(active.endsAt) === 0 && clock % 5 === 0) loadGame();
}, 1000);

(async () => {
  try {
    const health = await request('/health');
    if (health.status === 200) syncServerTime(health.data.now);
    await loadConfig();
    if (await refresh()) await loadGame();
    else show('landing');
  } catch (e) {
    console.error('boot failed', e);
    openAuth('login');
    $('#auth-error').textContent = errText('network');
  }
})();

// Появление секций при прокрутке. При `prefers-reduced-motion` всё показываем сразу:
// анимация — украшение, а не условие читаемости.
(() => {
  const blocks = document.querySelectorAll('.reveal');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    for (const b of blocks) b.classList.add('in');
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
  for (const b of blocks) io.observe(b);
})();
