import { offlineSummary } from '/welcome.js';
import { createBoxStage } from './box-stage.js';

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
  server_sleep: 'Сервер бережёт себя до полуночи UTC: прогресс сохранён, зайдите позже',
  server_lite: 'Сейчас высокая нагрузка: этот раздел временно недоступен, попробуйте позже',
  bad_run: 'Забег не найден, начните новый',
  run_not_found: 'Забег не найден, начните новый',
  run_expired: 'Забег просрочен: попытка сгорела',
  bad_trace: 'Трасса не прошла проверку: попытка сгорела',
  too_fast: 'Слишком резкое движение: попытка сгорела',
  short: 'Забег не дотянут до конца: попытка сгорела',
  daily_limit: 'Попытки на сегодня кончились',
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
  garage_full: 'Гараж полон: купите ещё одну ячейку',
  garage_max: 'Больше ячеек не бывает: максимум 8',
  bad_world: 'Неверный идентификатор мира',
  admin_disabled: 'Админка выключена: не задан ADMIN_TOKEN',
  admin_forbidden: 'Токен админки не подошёл',
  admin_email_forbidden: 'Почта не привязана к админке',
  callsign_taken: 'Этот позывной уже занят',
  callsign_cooldown: 'Позывной можно менять раз в сутки',
  style_not_owned: 'Эта косметика не куплена',
  too_many_requests: 'Слишком часто: подождите минуту',
  account_deleted: 'Аккаунт закрыт',
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
  bad_box: 'Такого бокса нет',
  bad_plane: 'Такой машины в звене нет',
  plane_not_owned: 'Этой машины у вас ещё нет — ищите её в боксах и в патрулях',
  patrol_busy: 'Машина уже в патруле: дождитесь возвращения',
  patrol_flying: 'Патруль ещё не вернулся',
  no_patrol: 'Активного патруля нет',
  box_cooldown: 'Этот бокс ещё закрыт: дождитесь таймера',
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
  box_purchase: 'Покупка бокса',
  box_open: 'Ресурсы из бокса',
  migration: 'Перенос истории',
};
const ASSETS = { astra: 'ASTRA', fuel: 'Топливо', points: 'Очки' };
const RESOURCES = {
  iron_ore: 'Железная руда', copper_ore: 'Медная руда', silicon: 'Кремний', ice: 'Лёд',
  helium3: 'Гелий-3', titanium: 'Титан', crystal: 'Кристалл',
  astralite: 'Астралит', void_crystal: 'Пустотный кристалл', quantum_dust: 'Квантовая пыль',
  energy_cell: 'Энергоячейка', circuit: 'Схема', alloy_plate: 'Сплавная пластина',
  helium_coolant: 'Гелиевый хладагент', titanium_frame: 'Титановая рама',
  crystal_lens: 'Кристаллическая линза', astralite_core: 'Астралитовое ядро',
  void_weave: 'Пустотное полотно', quantum_matrix: 'Квантовая матрица',
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
/** Купленное в Astra Pay: премиум и косметика. null — платежи выключены. */
let account = null;
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
// Арена: данные экрана и текущий забег. Расчёт поля приходит из общего модуля
// /minigame-sim.js — того же, что считает сервер.
let arenaData = null;
let arenaRun = null;
let arenaResult = null;
let arenaRaf = 0;
const arenaKeys = { left: false, right: false };
// Разница «серверное время − часы устройства». Все таймеры считаются по серверу,
// иначе при сбитых часах Claim и рейс выглядят недоступными.
let serverOffset = 0;
// Боксы (этап 5): таймеры бесплатных и каталог платных. Грузится при входе в
// раздел, как сезон и социальное, чтобы не утяжелять /me.
let boxData = null;
// Что выпало в последний раз — показываем до перезагрузки страницы.
let boxResult = null;
// Сцена открытия: создаётся один раз и переиспользуется.
let boxStage = null;

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

/** Класс цвета позывного по серверной рамке. Нет рамки — обычный цвет. */
function frameClass(frame) {
  const map = { nebula: 'cs-nebula', ember: 'cs-ember', premium: 'cs-premium' };
  return map[frame] || '';
}

function callsign() {
  // Сервер — источник истины: позывной видят другие игроки. localStorage остался
  // только как подсказка до первого ответа /me.
  if (state?.profile?.callsign) return state.profile.callsign;
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

/** Режим бережливости сервера: приходит заголовком, отдельный запрос не нужен. */
let serverMode = 'full';

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  try {
    const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    serverMode = r.headers.get('X-Astra-Mode') || serverMode;
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

// --- Очередь действий -------------------------------------------------------
//
// Если связь пропала или сервер в режиме экономии, действие не теряется: оно
// ложится в localStorage и уходит пачкой, когда сервер снова отвечает.
// Ключ идемпотентности постоянный (тот же, что у одиночного запроса), поэтому
// повтор безопасен: сервер узнает операцию и не начислит дважды.
const QUEUE_KEY = 'astra:queue:v1';
const QUEUE_MAX = 20;

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && x.path && x.idem) : [];
  } catch { return []; }
}

function writeQueue(list) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(0, QUEUE_MAX))); } catch { /* приватный режим */ }
}

function enqueueOp(item) {
  const list = readQueue();
  // Тот же ключ — та же операция: второй раз не кладём.
  if (list.some((x) => x.idem === item.idem)) return false;
  list.push(item);
  writeQueue(list);
  return true;
}

function queueSize() { return readQueue().length; }

/** Отправить накопленное пачками по 10. Возвращает, сколько ушло. */
let flushing = false;
async function flushQueue() {
  if (flushing || !token) return 0;
  let list = readQueue();
  if (!list.length) return 0;
  flushing = true;
  let sent = 0;
  try {
    while (list.length) {
      const chunk = list.slice(0, 10);
      const res = await authed('/batch', {
        method: 'POST',
        body: { ops: chunk.map((x) => ({ op: x.path, idem: x.idem, body: x.body || {} })) },
      });
      // Сервер занят или в режиме экономии — не выбрасываем, попробуем позже.
      if (res.status !== 200) break;
      const results = Array.isArray(res.data.results) ? res.data.results : [];
      if (!results.length) break;

      const left = [];
      results.forEach((r, i) => {
        // 5xx — вина сервера: операция могла не примениться, оставляем в очереди.
        if (i < chunk.length && r.status >= 500) left.push(chunk[i]);
        else sent += 1;
      });
      // Всё, что не попало в ответ (сервер остановился на бюджете), сохраняем.
      for (let i = results.length; i < chunk.length; i += 1) left.push(chunk[i]);

      list = [...left, ...list.slice(chunk.length)];
      writeQueue(list);
      if (res.data.blockedAt !== null && res.data.blockedAt !== undefined) break;
    }
  } catch { /* сеть — оставим на следующий раз */ }
  finally { flushing = false; }
  return sent;
}

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
  // Патруль: как только таймер дошёл до нуля, перезапрашиваем состояние — иначе
  // кнопка «Забрать» оставалась бы мёртвой до перезагрузки страницы.
  for (const n of document.querySelectorAll('[data-patrol-ready]')) {
    if (left(Number(n.getAttribute('data-until'))) > 0 || n.dataset.refresh) continue;
    n.dataset.refresh = '1';
    loadGame();
  }
  // Бокс: таймер вышел — кнопка должна ожить сама, без перезагрузки страницы.
  for (const n of document.querySelectorAll('[data-open-box]')) {
    if (left(Number(n.getAttribute('data-until'))) > 0 || n.dataset.refresh) continue;
    n.dataset.refresh = '1';
    loadBoxes();
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

// Скин — это не только окраска корпуса: он даёт цвет позывного, рамку профиля
// и след двигателя. Всё это видно другим игрокам (гильдия, рейтинг), поэтому
// скин имеет смысл покупать. На экономику он не влияет никак.
const SKIN_STYLE = {
  nebula: { cls: 'cs-nebula', frame: '/sprites/profile/frame_nebula.png', trail: '/sprites/profile/trail_nebula.png' },
  ember: { cls: 'cs-ember', frame: '/sprites/profile/frame_ember.png', trail: '/sprites/profile/trail_ember.png' },
  premium: { cls: 'cs-premium', frame: '/sprites/profile/frame_premium.png', trail: '/sprites/profile/trail_premium.png' },
};

function cosmeticsOwned() {
  const list = Array.isArray(account?.entitlements) ? account.entitlements : [];
  return new Set(list.map((item) => String(item.cosmetic || '')));
}

/** Что надето сейчас: выбор игрока на сервере, иначе последний купленный скин. */
function activeStyle() {
  const serverFrame = state?.profile?.frame;
  if (serverFrame && SKIN_STYLE[serverFrame]) return SKIN_STYLE[serverFrame];
  const owned = cosmeticsOwned();
  if (owned.has('skin:ember')) return SKIN_STYLE.ember;
  if (owned.has('skin:nebula')) return SKIN_STYLE.nebula;
  if (owned.has('premium')) return SKIN_STYLE.premium;
  return null;
}

// Что даёт скин: внешний вид корпуса. Купленная окраска применяется ко всем
// кораблям игрока — на бой, скорость и добычу она не влияет.
const SKIN_SPRITES = {
  'skin:nebula': '/sprites/cosmetics/skin_nebula.png',
  'skin:ember': '/sprites/cosmetics/skin_ember.png',
};

function ownedSkin() {
  const list = Array.isArray(account?.entitlements) ? account.entitlements : [];
  const owned = list.find((item) => SKIN_SPRITES[item.cosmetic]);
  return owned ? SKIN_SPRITES[owned.cosmetic] : null;
}

function shipArt(type) {
  const skin = ownedSkin();
  if (skin) {
    return el('div', { class: 'ship-viewer is-skinned' },
      el('img', { src: skin, alt: '', width: '256', height: '128' }),
      el('span', { class: 'skin-tag' }, 'скин'));
  }
  return el('div', { class: 'ship-viewer' }, el('img', { src: `/sprites/ships/${type}.png`, alt: '', width: '256', height: '128' }));
}

// «#3 из 24» или «пока без места», если игрок ещё не в рейтинге.
function rankText(season) {
  if (!season) return 'Сезон ещё не начался';
  if (!season.rank) return `Место в рейтинге появится после первого рейса · игроков ${season.players}`;
  return `#${season.rank} из ${season.players} · осталось ${season.daysLeft} дн.`;
}

// Шкала уровня: сколько XP уже есть, сколько нужно до следующего и сколько
// осталось. Считается из серверных порогов (xpPrev/xpNext), а не «на глаз».
function levelProgress() {
  const level = Number(state.level) || 1;
  const xp = Number(state.xp) || 0;
  const prev = Number(state.xpPrev) || 0;
  const next = Number(state.xpNext) || 0;
  const span = Math.max(1, next - prev);
  const done = Math.max(0, Math.min(span, xp - prev));
  return {
    level,
    xp,
    next,
    left: Math.max(0, next - xp),
    percent: Math.round((done / span) * 100),
  };
}

function levelBar(compact) {
  const p = levelProgress();
  return el('div', { class: `level-widget${compact ? ' is-compact' : ''}` },
    el('div', { class: 'level-head' },
      el('b', {}, `Уровень ${p.level}`),
      el('span', { class: 'muted' }, p.left > 0 ? `до ${p.level + 1}: ${p.left} XP` : 'максимум в этом секторе')),
    el('div', {
      class: 'level-bar',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(p.percent),
      'aria-label': `Опыт: ${p.percent}% до следующего уровня`,
    }, (() => {
      // Ширину ставим через CSSOM: CSP запрещает инлайновые style-атрибуты.
      const fill = el('div', { class: 'level-bar-fill' });
      fill.style.width = `${p.percent}%`;
      return fill;
    })()),
    el('p', { class: 'muted level-foot' }, `${p.xp} XP всего · нужно ${p.next} XP для уровня ${p.level + 1}`),
  );
}

// Карточка командира: рамка, цвет позывного, значок и выбор стиля.
// Всё это хранится на сервере — поэтому видно другим, а не только себе.
function profileCard() {
  const style = activeStyle();
  const owned = cosmeticsOwned();
  const profile = state.profile || {};
  const frames = ['nebula', 'ember', 'premium'].filter((id) => owned.has(`skin:${id}`) || (id === 'premium' && owned.has('premium')));
  const cooldownLeft = profile.nextCallsignAt ? Math.max(0, profile.nextCallsignAt - (Date.now() + serverOffset)) : 0;

  const nameInput = el('input', {
    type: 'text', maxlength: '16', value: profile.callsign || '', placeholder: 'Позывной',
    'aria-label': 'Позывной', autocomplete: 'off',
  });

  return el('div', { class: 'profile-card' },
    el('div', { class: 'profile-avatar' },
      el('img', { src: '/avatars/commander.png', alt: '', width: '64', height: '64', class: 'avatar' }),
      style ? el('img', { src: style.frame, alt: '', width: '96', height: '96', class: 'profile-frame' }) : null),
    el('div', { class: 'profile-info' },
      el('b', { class: `profile-name ${style ? style.cls : ''}` }, callsign(),
        profile.premium ? el('span', { class: 'badge' }, 'Premium') : null),
      el('p', { class: 'muted' },
        profile.callsign ? `Позывной видят другие игроки: лидерборд, гильдия, рейтинг.`
          : 'Позывной пока автоматический — придумайте свой, его увидят другие.'),
      el('div', { class: 'profile-medals' },
        profile.badge === 'pioneer' ? el('img', { src: '/sprites/cosmetics/badge_pioneer.png', alt: 'Значок первопроходца', width: '28', height: '28' }) : null,
        ...(state.minigame?.wins >= 25 ? [el('img', { src: '/sprites/profile/medal_25.png', alt: '25 побед на арене', width: '32', height: '32' })] : []),
        ...(state.minigame?.wins >= 50 ? [el('img', { src: '/sprites/profile/medal_50.png', alt: '50 побед на арене', width: '32', height: '32' })] : []),
        ...(state.minigame?.wins >= 100 ? [el('img', { src: '/sprites/profile/medal_100.png', alt: '100 побед на арене', width: '32', height: '32' })] : [])),
      el('div', { class: 'form profile-form' }, nameInput,
        el('button', {
          type: 'button',
          disabled: cooldownLeft > 0 || state.frozen ? '' : null,
          onClick: () => doSetCallsign(nameInput.value),
        }, cooldownLeft > 0 ? `Сменить через ${Math.ceil(cooldownLeft / 3600000)} ч` : 'Сменить позывной')),
      frames.length
        ? el('div', { class: 'style-row' },
          el('button', { type: 'button', class: 'ghost', onClick: () => doSetStyle({ frame: null, trail: null }) }, 'Без рамки'),
          ...frames.map((id) => el('button', {
            type: 'button',
            class: profile.frame === id ? '' : 'ghost',
            onClick: () => doSetStyle({ frame: id, trail: id === 'premium' ? 'premium' : id }),
          }, `Рамка «${STYLE_NAME[id]}»`)))
        : null,
      el('div', { class: 'btn-row' },
        el('a', { class: 'cta cta-small', href: '/pay.html' }, 'Магазин'),
        el('button', { type: 'button', class: 'ghost', onClick: () => doExportData() }, 'Скачать мои данные')),
    ),
  );
}

const STYLE_NAME = { nebula: 'Небула', ember: 'Уголь', premium: 'Гиперион' };

function doSetCallsign(value) {
  return act('callsign', '/profile/callsign', { callsign: value })
    .then(() => telCallsign(value));
}

function telCallsign(value) {
  try { localStorage.setItem('astra:callsign', value); } catch { /* приватный режим */ }
}

function doSetStyle(patch) {
  return act(`style:${patch.frame ?? 'none'}:${patch.trail ?? 'none'}`, '/profile/style', patch);
}

async function doExportData() {
  const res = await authed('/account/export');
  if (res.status !== 200) { note = `Ошибка: ${errText(res.data?.error)}`; render(); return; }
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crypto-astra-export.json';
  a.click();
  URL.revokeObjectURL(url);
  note = 'Файл с данными скачан';
  render();
}

async function doDeleteAccount() {
  const typed = window.prompt('Удаление аккаунта необратимо: почта и пароль стираются, позывной удаляется. Напишите DELETE, чтобы подтвердить.');
  if (typed !== 'DELETE') return;
  const res = await authed('/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
  if (res.status !== 200) { note = `Ошибка: ${errText(res.data?.error)}`; render(); return; }
  try { localStorage.clear(); } catch { /* приватный режим */ }
  token = null;
  state = null;
  show('landing');
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

/**
 * Первые шаги. Показываются один раз и только новичку: подсказка не должна
 * занимать экран у того, кто уже играет.
 */
function tutorialCard() {
  let seen = true;
  try { seen = localStorage.getItem('astra:tutorial') === 'done'; } catch { seen = true; }
  if (seen) return null;
  const finish = () => {
    try { localStorage.setItem('astra:tutorial', 'done'); } catch { /* приватный режим */ }
    render();
  };
  return el('div', { class: 'block tutorial' },
    el('h3', {}, 'С чего начать'),
    el('ol', { class: 'plain tutorial-steps' },
      el('li', {}, 'Заберите бонус кнопкой «Claim» — он копится по часам.'),
      el('li', {}, 'Отправьте корабль в рейс: «Куда летим» → планета → тип рейса.'),
      el('li', {}, 'Почините корабль, если прочность упала ниже 70 %.'),
      el('li', {}, 'Мини-игра «Арена» даёт ASTRA и медали: 5 попыток в день.'),
      el('li', {}, 'Придумайте позывной на карточке пилота — его увидят другие.')),
    el('button', { type: 'button', class: 'primary', onClick: finish }, 'Понятно, поехали'));
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
    levelBar(),
    profileCard(),
    el('div', { class: 'panel-grid' },
      el('div', { class: 'block' },
        el('h3', {}, 'Бонус каждые 15 минут'),
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

// Гараж: ячейки решают, сколько кораблей может быть одновременно. Без ячейки
// верфь не продаёт корпус — об этом честно говорит кнопка.
// Строка о находке звена: одна и та же в боксах и на полке гаража.
function planeFindLine(plane) {
  return el('span', { class: `ok plane-find rarity-${plane.rarity || 'common'}` },
    plane.firstTime ? 'Новая машина в звене: ' : 'Машина звена: ',
    el('b', {}, `${plane.name} (${plane.rarityName || plane.rarity || 'обычная'})`),
    plane.firstTime ? '' : ` ×${plane.count}`);
}

// Полка «Авиазвено»: восемь машин из боксов. Это коллекция, а не корабли —
// ячейки гаража они не занимают и в рейсы не летают, поэтому подписи
// «найдено 3 из 8», а не «в строю».
// «1 патруль · 6 ч», «2 патруля», «12 патрулей» — русское склонение вручную.
function patrolCountBadge(p) {
  if (!p.patrols) return null;
  const n = p.patrols;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'патруль' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'патруля' : 'патрулей';
  return el('span', { class: 'badge' }, `${n} ${word} · ${p.hours} ч налёта`);
}

// Патруль длится часами, поэтому показываем «6 ч», а не «360 мин».
function fmtDuration(ms) {
  const hours = ms / 3600000;
  if (hours >= 1) return `${Number(hours.toFixed(1))} ч`;
  return `${Math.round(ms / 60000)} мин`;
}

// Активный патруль: машина летает и возвращается либо с новой машиной, либо ни с
// чем. Ни ASTRA, ни ресурсов — иначе звеном можно было бы фармить мир в обход рейсов.
function planePatrolBlock() {
  const p = state.planes;
  const patrol = p && p.patrol;
  if (!patrol) return null;
  const ready = patrol.ready;
  const chance = Math.round(patrol.findChance * 1000) / 10;
  return el('div', { class: `block plane-patrol${ready ? ' is-ready' : ''}` },
    el('div', { class: 'plane-patrol-sky' },
      el('img', {
        src: patrol.sprite, alt: '', width: '64', height: '64', class: 'plane-patrol-art', loading: 'lazy',
      })),
    el('div', { class: 'plane-patrol-info' },
      el('h3', {}, `${patrol.name} в патруле`, el('span', { class: 'badge' }, patrol.rarityName || patrol.rarity)),
      el('p', { class: 'muted' }, `Шанс находки за вылет: ${chance} %`),
      // Когда патруль вернулся, таймер не показываем: updateTimers переписал бы
      // его в «Вернулась: 0:00» и оставил бы нули висеть до перерисовки.
      ready
        ? el('p', { class: 'ok' }, 'Машина вернулась — заберите находку')
        : el('p', {
          class: 'muted',
          'data-until': patrol.endsAt,
          'data-prefix': 'Вернётся через ',
        }, ''),
      el('button', {
        type: 'button',
        disabled: state.frozen || !ready ? '' : null,
        onClick: () => doClaimPatrol(),
      }, ready ? 'Забрать находку' : 'Ещё летит')),
    el('span', { class: 'plane-timer', 'data-patrol-ready': '1', 'data-until': patrol.endsAt }));
}

function planeShelf() {
  const p = state.planes;
  if (!p || !p.models) return null;
  const busy = !!p.patrol;
  const cells = p.models.map((m) => {
    const chance = Math.round(m.findChance * 1000) / 10;
    return el('div', {
      class: `plane-slot rarity-${m.rarity || 'common'}${m.count ? ' is-found' : ' is-locked'}`,
    },
      el('img', {
        src: m.sprite || `/sprites/planes/${m.id}.png`,
        alt: '', width: '72', height: '72', class: 'plane-art', loading: 'lazy',
      }),
      el('span', { class: 'plane-name' }, m.count ? m.name : '???'),
      el('span', { class: 'plane-meta' },
        m.count
          ? `${m.rarityName || m.rarity}${m.count > 1 ? ` ×${m.count}` : ''} · ${chance} %`
          : m.hint),
      m.count
        ? el('button', {
          type: 'button',
          class: 'ghost plane-fly-btn',
          disabled: state.frozen || busy ? '' : null,
          onClick: () => doStartPatrol(m.id),
        }, busy ? 'Занято' : `В патруль · ${fmtDuration(m.patrolMs)}`)
        : null);
  });
  return el('div', { class: 'block plane-block' },
    el('h3', {}, 'Авиазвено',
      el('span', { class: 'badge' }, `${p.found}/${p.total}`),
      patrolCountBadge(p)),
    el('p', { class: 'muted' },
      'Машины из боксов. Своя машина выходит в патруль и иногда возвращается с ещё одной — но ни ASTRA, ни ресурсов звено не даёт и ячейки под корабли не занимает. Это коллекция.'),
    planePatrolBlock(),
    el('div', { class: 'plane-grid' }, ...cells));
}

function garagePanel() {
  const g = state.garage;
  if (!g) return null;
  const cells = [];
  for (let i = 0; i < g.slots; i += 1) {
    const ship = state.ships[i];
    cells.push(el('div', { class: `garage-slot${ship ? ' is-filled' : ''}` },
      el('img', {
        src: ship ? '/sprites/garage/slot_filled.png' : '/sprites/garage/slot_empty.png',
        alt: '', width: '96', height: '96', class: 'garage-cell',
      }),
      el('span', { class: 'garage-label' }, ship ? ship.name : 'свободно')));
  }
  // Недоступные ячейки показываем призраком: видно, сколько ещё можно купить.
  for (let i = g.slots; i < g.max; i += 1) {
    cells.push(el('div', { class: 'garage-slot is-locked' },
      el('img', { src: '/sprites/garage/slot_locked.png', alt: '', width: '96', height: '96', class: 'garage-cell', loading: 'lazy' }),
      el('span', { class: 'garage-label' }, 'закрыто')));
  }
  return el('div', { class: 'block garage-block' },
    el('h3', {}, 'Гараж',
      el('span', { class: 'badge' }, `${g.used}/${g.slots}`),
      g.premiumBonus ? el('span', { class: 'badge' }, '+1 Premium') : null),
    el('p', { class: 'muted' },
      `Ячеек ${g.slots} из ${g.max}. Свободно: ${g.free}. Купить корабль можно только при свободной ячейке.`),
    el('div', { class: 'garage-grid' }, ...cells),
    g.canBuy
      ? el('button', {
        type: 'button', disabled: state.frozen || state.balances.astra < g.price ? '' : null,
        onClick: doBuySlot,
      },
      el('img', { src: '/icons/ui/garage.png', alt: '', width: '18', height: '18', class: 'icon-sm' }),
      `Ещё ячейка за ${astraNum(g.price)} ASTRA`)
      : el('p', { class: 'muted' }, `Больше ${g.max} ячеек не бывает.`),
  );
}

function doBuySlot() { return act('garage-slot', '/garage/buy', {}); }

function renderFleet() {
  const owned = state.ships.map((s) => el('div', { class: 'block' },
    shipArt(s.type),
    el('h3', {}, `${s.name} · ${s.durability}%`),
    el('p', { class: 'muted' }, s.status === 'flying' ? 'В рейсе' : 'На базе'),
    s.repair.blocked === 'ok' ? el('button', { type: 'button', disabled: state.frozen ? '' : null, onClick: () => doRepair(s.id) },
      el('img', { src: '/icons/ui/repair.png', alt: '', width: '20', height: '20', class: 'icon-sm', loading: 'lazy' }),
      `Ремонт за ${s.repair.cost} ASTRA${s.repair.plate ? ' + пластина' : ''}`) : null,
    s.repair.blocked === 'needs_plate' ? el('p', { class: 'error' }, 'Ниже 50% нужна сплавная пластина — скрафтите её в «Крафте» (железо 3 + медь 2, 60 ASTRA).') : null,
    el('button', { type: 'button', class: 'ghost', onClick: () => setView('modules') },
      el('img', { src: '/icons/nav/modules.png', alt: '', width: '18', height: '18', class: 'icon-sm' }), 'Модули'),
    s.durability <= 70 && s.durability >= 50 ? el('p', { class: 'muted' }, 'Почините до следующего рейса, иначе можно просесть ниже 50%.') : null,
  ));
  // Покупка корабля: цена в ASTRA, уровень ворот, один корпус каждого типа.
  // Полнота гаража считается до верфи: кнопка обязана знать ответ заранее.
  const garageFull = state.garage ? state.garage.free <= 0 : false;
  const shop = state.catalog.filter((c) => !c.owned).map((c) => {
    const tooLow = state.level < c.unlockLevel;
    const noMoney = c.price != null && state.balances.astra < c.price;
    const label = c.price == null ? 'Чертёж: крафт позже'
      : tooLow ? `Нужен уровень ${c.unlockLevel}`
        : noMoney ? `Не хватает ${astraNum(c.price - state.balances.astra)} ASTRA`
          : garageFull ? 'Гараж полон: купите ячейку'
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
        disabled: state.frozen || tooLow || c.price == null || noMoney || garageFull ? '' : null,
        onClick: () => doBuyShip(c.type),
      },
      c.price != null && !tooLow ? el('img', { src: '/icons/ui/buy.png', alt: '', width: '18', height: '18', class: 'btn-ico', loading: 'lazy' }) : null,
      label),
    );
  });
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Флот'), el('span', { class: 'badge' }, `${state.ships.length} в строю`)),
    garagePanel(),
    planeShelf(),
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
  const card = (r) => {
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
  };
  // Рецепты делятся на два круга, и это не косметика: первый собирается из
  // ресурсов первого сектора (доступен сразу), второй требует редких ресурсов
  // секторов 2–5 и нужен только модулям с 4-го уровня.
  const groups = [
    {
      tier: 1, title: 'Первый круг',
      hint: 'Железо, медь, кремний и лёд — первый сектор. Нужен для ремонта и первых модулей.',
    },
    {
      tier: 2, title: 'Дальний круг',
      hint: 'Редкие ресурсы секторов 2–5: гелий-3, титан, кристалл, астралит, пустотный кристалл, квантовая пыль. Идут в модули с 4-го уровня.',
    },
  ].map((g) => {
    const list = c.recipes.filter((r) => (r.tier || 1) === g.tier);
    if (!list.length) return null;
    return el('div', { class: 'craft-group' },
      el('h3', { class: 'craft-group-title' }, g.title),
      el('p', { class: 'muted' }, g.hint),
      ...list.map(card));
  }).filter(Boolean);

  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Крафт'), el('span', { class: 'badge' }, `слотов ${c.slots}` )),
    el('p', { class: 'muted' }, 'Ресурсы и плата в ASTRA списываются сразу, компонент приходит по таймеру. Компоненты нужны модулям и крупному ремонту.'),
    el('div', { class: 'block' },
      el('h3', {}, 'Очередь'),
      c.running.length
        ? el('p', { class: 'ok', 'data-prefix': 'Готовится: ', 'data-until': c.running[0].endsAt }, c.running[0].name)
        : el('p', { class: 'muted' }, 'Пусто. Готовый компонент начислится сам, даже если экран закрыт.'),
    ),
    ...groups,
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

// Модули: у каждого корабля свои слоты и свои эффекты. Раньше все корабли
// показывались одной простынёй, и казалось, что модули «общие». Теперь выбран
// один корабль — его слоты, его бонусы, его цены.
let moduleShipId = null;

function renderModules() {
  const m = state.modules;
  if (!m || !m.ships?.length) return el('div', { class: 'screen' }, el('p', { class: 'muted' }, 'Сервер ещё не отдаёт модули.'));
  if (!moduleShipId || !m.ships.some((ship) => ship.id === moduleShipId)) moduleShipId = m.ships[0].id;
  const ship = m.ships.find((x) => x.id === moduleShipId);

  const tabs = m.ships.map((x) => el('button', {
    type: 'button',
    class: x.id === moduleShipId ? '' : 'ghost',
    onClick: () => { moduleShipId = x.id; render(); },
  },
  el('img', { src: `/sprites/ships/${x.type}.png`, alt: '', width: '28', height: '20', class: 'icon-sm', loading: 'lazy' }),
  `${x.name} ${x.used}/${x.slots}`));

  const cells = [];
  for (let i = 0; i < ship.slots; i += 1) {
    const mod = ship.modules[i];
    cells.push(el('div', { class: `slot-cell${mod ? ' is-filled' : ''}` },
      el('img', {
        src: mod ? `/sprites/modules/${mod.id}.png` : '/sprites/garage/slot_empty.png',
        alt: '', width: '64', height: '64', class: 'slot-art', loading: 'lazy',
      }),
      el('span', { class: 'slot-label' }, mod ? `${mod.name} L${mod.level}` : 'пусто')));
  }

  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Модули'), el('span', { class: 'badge' }, `до L${m.maxLevel}`)),
    el('p', { class: 'muted' }, 'Модуль ставится на конкретный корабль и занимает его слот. Снять нельзя — только улучшить: вложенные ASTRA не возвращаются.'),
    el('div', { class: 'ship-tabs' }, ...tabs),
    el('div', { class: 'block' },
      el('h3', {}, ship.name, el('span', { class: 'badge' }, `слоты ${ship.used}/${ship.slots}`)),
      el('div', { class: 'slot-row' }, ...cells),
      el('p', { class: 'muted' }, ship.modules.length
        ? ship.modules.map((x) => `${x.name} L${x.level}: ${x.effectText}`).join(' · ')
        : 'Модулей нет: все слоты этого корабля свободны.')),
    el('div', { class: 'module-grid' }, ...m.catalog.map((entry) => moduleCard(ship, entry))),
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
async function loadBoxes() {
  const { status, data } = await authed('/boxes');
  if (status === 200) boxData = data;
  else if (status !== 0) note = `Ошибка: ${errText(data.error)}`;
  if (view === 'boxes') render();
}

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

function renderBonus() {
  const claimLeft = left(state.nextClaimAt);
  const p = levelProgress();
  const premium = account?.premium?.active ? account.premium : null;
  return el('div', { class: 'screen' },
    el('div', { class: 'bonus-hero' },
      el('span', { class: 'badge' }, 'Бонусы'),
      el('h2', {}, claimLeft > 0 ? 'Следующий бонус скоро' : 'Бонус готов'),
      el('p', { class: 'muted' }, claimLeft > 0
        ? `Забрать можно через ${fmtLeft(claimLeft)}. Бонус — +5 ASTRA, не чаще раза в 15 минут.`
        : 'Заберите +5 ASTRA. Следующий бонус — через 15 минут.'),
      el('div', { class: 'bonus-timer', 'data-bonus-timer': '', 'data-until': String(state.nextClaimAt || 0) },
        claimLeft > 0 ? fmtLeft(claimLeft) : 'готово'),
      el('button', {
        type: 'button', class: 'cta', 'data-claim': '',
        disabled: claimLeft > 0 || state.frozen ? '' : null,
        onClick: doClaim,
      }, 'Забрать бонус'),
    ),
    el('div', { class: 'panel-grid' },
      el('div', { class: 'block' }, el('h3', {}, 'Шкала уровня'), levelBar(true),
        el('p', { class: 'muted' }, `Сейчас ${p.xp} XP. До уровня ${p.level + 1} осталось ${p.left} XP.`)),
      el('div', { class: 'block' },
        el('h3', {}, 'Astra Pass'),
        el('p', { class: 'muted' }, 'Награды за очки сезона: 10 уровней, косметика и второй слот крафта.'),
        el('button', { type: 'button', class: 'ghost', onClick: () => setView('season') }, 'Открыть сезон')),
      el('div', { class: 'block' },
        el('h3', {}, 'Premium'),
        premium
          ? el('p', { class: 'muted' }, `Astra Premium активен до ${new Date(premium.until || 0).toLocaleDateString('ru-RU')}. Значок и эксклюзивный корпус — в профиле.`)
          : el('p', { class: 'muted' }, 'Значок Premium, эксклюзивный корпус, +1 ячейка гаража и +2 попытки арены. Без влияния на экономику.'),
        el('a', { class: 'cta cta-small', href: '/pay.html' }, premium ? 'Магазин' : 'Открыть магазин')),
      el('div', { class: 'block' },
        el('h3', {}, 'Как это работает'),
        el('ul', { class: 'bonus-rules' },
          el('li', {}, 'Бонус можно забрать раз в 15 минут — таймер идёт от сервера.'),
          el('li', {}, 'Опыт даёт рейсы и миссии, уровень открывает сектора и корабли.'),
          el('li', {}, 'ASTRA — внутриигровая валюта: купить её нельзя.')),
      ),
    ),
  );
}

// ── Арена: мини-игра «Астероидный залп» ─────────────────────────────────────
// 45 секунд, корабль внизу, падают астероиды, между ними кристаллы. Сервер
// присылает зерно, клиент рисует поле из него и отправляет обратно трассу —
// пары «время → x». Награду считает сервер, поэтому подделать счёт нельзя.

const ARENA_Y = 560;
const ARENA_MAX_SPEED = 900;

async function loadArena() {
  const res = await authed('/minigame');
  if (res.status === 200) arenaData = res.data;
  else note = ERRORS[res.data?.error] || 'Не удалось загрузить арену';
  if (view === 'arena') render();
}

function arenaTier(tier) {
  const pct = Math.min(100, Math.round((tier.progress / tier.wins) * 100));
  const fill = el('div', { class: 'level-bar-fill' });
  fill.style.width = `${pct}%`;
  return el('div', { class: `arena-tier${tier.awarded ? ' is-done' : ''}` },
    el('div', { class: 'arena-tier-head' },
      el('b', {}, `${tier.wins} побед`),
      el('span', { class: 'muted' }, tier.awarded ? 'медаль получена' : `${tier.progress}/${tier.wins}`)),
    el('div', { class: 'level-bar' }, fill),
    el('p', { class: 'muted' }, `${tier.title} · +${tier.astra} ASTRA`));
}

// Звук арены: короткие синтезированные сигналы. Файлов нет — значит, нет и
// лишних запросов; правило «весь арт — PNG» про картинки, звук живёт отдельно.
let arenaSoundOn = (() => {
  try { return localStorage.getItem('astra:sound') !== 'off'; } catch { return true; }
})();
let arenaAudio = null;

function soundToggle() {
  return el('button', {
    type: 'button',
    class: `sound-btn${arenaSoundOn ? '' : ' is-off'}`,
    'aria-pressed': arenaSoundOn ? 'true' : 'false',
    title: arenaSoundOn ? 'Звук включён' : 'Звук выключен',
    onClick: (e) => {
      e.stopPropagation();
      arenaSoundOn = !arenaSoundOn;
      try { localStorage.setItem('astra:sound', arenaSoundOn ? 'on' : 'off'); } catch { /* приватный режим */ }
      const btn = e.currentTarget;
      btn.classList.toggle('is-off', !arenaSoundOn);
      btn.setAttribute('aria-pressed', arenaSoundOn ? 'true' : 'false');
      btn.title = arenaSoundOn ? 'Звук включён' : 'Звук выключен';
      if (arenaSoundOn) sfx('pick');
    },
  }, el('img', { src: '/icons/ui/volume.png', alt: '', width: '20', height: '20', class: 'icon-sm' }));
}

function audioCtx() {
  if (arenaAudio) return arenaAudio;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { arenaAudio = new Ctx(); } catch { arenaAudio = null; }
  return arenaAudio;
}

/** Один короткий сигнал: частота от/до, тип волны, длина и громкость. */
function tone(from, to, kind = 'sine', dur = 0.09, volume = 0.05) {
  const ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = kind;
  osc.frequency.setValueAtTime(from, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), ctx.currentTime + dur);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.02);
}

function sfx(kind) {
  if (!arenaSoundOn) return;
  try {
    if (kind === 'pick') tone(880, 1320, 'sine', 0.08, 0.05);
    else if (kind === 'hit') tone(190, 55, 'sawtooth', 0.18, 0.07);
    else if (kind === 'win') { tone(660, 660, 'triangle', 0.12, 0.06); setTimeout(() => tone(990, 990, 'triangle', 0.16, 0.06), 120); }
    else if (kind === 'lose') tone(330, 180, 'triangle', 0.22, 0.05);
  } catch { /* звук — украшение, а не условие игры */ }
}

// Звук открытия бокса: короткий «взвод» и вспышка. Как и остальные звуки,
// подчиняется общему переключателю (astra:sound), который лежит в «Арене».
function boxSound() {
  if (!arenaSoundOn) return;
  try {
    tone(220, 420, 'triangle', 0.16, 0.05);
    setTimeout(() => tone(520, 1040, 'sine', 0.22, 0.06), 160);
    setTimeout(() => tone(780, 1560, 'sine', 0.26, 0.05), 300);
  } catch { /* звук — украшение */ }
}

function arenaHud() {
  return el('div', { class: 'arena-hud' },
    el('span', {}, el('b', { 'data-arena-time': '' }, '0:45')),
    el('span', {}, 'очки: ', el('b', { 'data-arena-score': '' }, '0')),
    el('span', {}, 'кристаллы: ', el('b', { 'data-arena-picks': '' }, '0')),
    el('span', {}, 'пробоины: ', el('b', { 'data-arena-hits': '' }, '0')),
    soundToggle());
}

function renderArena() {
  if (!arenaData) {
    loadArena();
    return el('div', { class: 'screen' }, el('p', { class: 'muted' }, 'Загружаем арену…'));
  }
  const a = arenaData;
  const running = !!arenaRun;
  return el('div', { class: 'screen' },
    el('div', { class: 'arena-hero' },
      el('span', { class: 'badge' }, 'Арена'),
      el('h2', {}, 'Астероидный залп'),
      el('p', { class: 'muted' },
        `45 секунд, ${a.attempts.limit} попыток в сутки${a.attempts.premium ? ' (Premium +2)' : ''}. `
        + 'Собирайте кристаллы, уходите от камней. Счёт считает сервер.'),
      el('div', { class: 'arena-stats' },
        el('span', {}, 'осталось попыток: ', el('b', {}, String(a.attempts.left))),
        el('span', {}, 'побед: ', el('b', {}, String(a.wins))),
        el('span', {}, 'лучший счёт: ', el('b', {}, String(a.best))),
        el('span', {}, 'сегодня: ', el('b', {}, `${a.today.astra}/${a.today.astraCap} ASTRA`)))),

    arenaResult ? arenaResultCard(arenaResult) : null,

    el('div', { class: 'arena-stage' },
      running ? arenaHud() : null,
      el('canvas', {
        class: 'arena-canvas', id: 'arena-canvas', width: '1000', height: '620',
        'aria-label': 'Поле мини-игры: корабль уклоняется от астероидов',
      }),
      running
        ? null
        : el('div', { class: 'arena-overlay' },
          el('button', {
            type: 'button', class: 'cta', 'data-arena-start': '', disabled: a.attempts.left <= 0 ? '' : null,
            onClick: arenaStart,
          }, a.attempts.left > 0 ? 'В бой' : 'Попытки на сегодня кончились'),
          el('p', { class: 'muted' }, a.attempts.left > 0
            ? 'Стрелки или A/D — движение. Можно тянуть пальцем по полю.'
            : 'Новые попытки появятся после полуночи UTC. Premium даёт +2 каждый день.')),
      running ? el('p', { class: 'muted arena-hint' }, 'Ушли из забега — попытка сгорает. Держитесь до конца.') : null),

    el('div', { class: 'panel-grid' },
      el('div', { class: 'block' },
        el('h3', {}, 'Задания арены'),
        el('p', { class: 'muted' }, 'Победа — 100 очков за забег. Медали выдаются один раз, ASTRA за них не входит в суточный потолок.'),
        ...a.tiers.map(arenaTier)),
      el('div', { class: 'block' },
        el('h3', {}, 'Последние забеги'),
        a.recent.length
          ? el('table', { class: 'arena-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Когда'), el('th', {}, 'Счёт'), el('th', {}, 'Итог'), el('th', {}, 'ASTRA'))),
            el('tbody', {}, ...a.recent.map((r) => el('tr', {},
              el('td', {}, fmtAgo(Date.now() + serverOffset - r.at)),
              el('td', {}, String(r.score)),
              el('td', {}, r.win ? 'победа' : `${r.picks} крист. / ${r.hits} пробоин`),
              el('td', {}, `+${r.astra}`)))))
          : el('p', { class: 'muted' }, 'Ещё ни одного забега. Первый — самый важный.')),
      el('div', { class: 'block' },
        el('h3', {}, 'Лидерборд арены'),
        a.leaderboard?.length
          ? el('table', { class: 'arena-table' },
            el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Пилот'), el('th', {}, 'Побед'), el('th', {}, 'Лучший'))),
            el('tbody', {}, ...a.leaderboard.map((row) => el('tr', { class: row.isMe ? 'is-me' : '' },
              el('td', {}, String(row.rank)),
              el('td', { class: frameClass(row.frame) }, row.label,
                row.premium ? el('span', { class: 'badge' }, 'Premium') : null,
                row.badge === 'pioneer' ? el('img', { src: '/sprites/cosmetics/badge_pioneer.png', alt: '', width: '18', height: '18', class: 'icon-sm' }) : null),
              el('td', {}, String(row.wins)),
              el('td', {}, String(row.best))))))
          : el('p', { class: 'muted' }, 'Пока никто не побеждал. Первое место свободно.')),
      el('div', { class: 'block' },
        el('h3', {}, 'Неделя в поясе',
          el('img', { src: '/sprites/profile/medal_week.png', alt: 'Недельная медаль', width: '22', height: '22', class: 'icon-sm', loading: 'lazy' }),
        el('span', { class: 'badge' }, a.weekly?.awarded ? 'получено' : `${a.weekly?.wins ?? 0}/${a.weekly?.target ?? 20}`)),
        el('p', { class: 'muted' }, `20 побед за календарную неделю — ${a.weekly?.reward ?? 150} ASTRA разово. Счёт сбрасывается в понедельник.`),
        el('div', { class: 'level-bar' }, (() => {
          const fill = el('div', { class: 'level-bar-fill' });
          fill.style.width = `${Math.min(100, Math.round(((a.weekly?.wins ?? 0) / (a.weekly?.target ?? 20)) * 100))}%`;
          return fill;
        })())),
      el('div', { class: 'block' },
        el('h3', {}, 'Правила'),
        el('ul', { class: 'bonus-rules' },
          el('li', {}, 'Попытки: 5 в сутки, Premium +2.'),
          el('li', {}, `Награда за забег: до 45 ASTRA и очки, потолок ${a.caps.astra} ASTRA в день.`),
          el('li', {}, 'Кривая трасса (рваная скорость) — попытка сгорает без награды.'),
          el('li', {}, 'Победы 25 / 50 / 100 дают медали и разовую награду.')))));
}

function arenaResultCard(r) {
  if (r.error) {
    const text = r.error === 'daily_limit' ? 'Попытки на сегодня кончились.'
      : r.error === 'run_expired' ? 'Забег просрочен: попытка сгорела.'
        : 'Трасса не прошла проверку: попытка сгорела.';
    return el('div', { class: 'arena-result is-bad' }, el('b', {}, 'Не засчитано'), el('p', { class: 'muted' }, text));
  }
  return el('div', { class: `arena-result${r.result.win ? ' is-win' : ''}` },
    el('b', {}, r.result.win ? 'Победа!' : 'Забег закрыт'),
    el('p', {}, `Очки ${r.result.score} · кристаллы ${r.result.picks} · пробоины ${r.result.hits}`),
    el('p', { class: 'muted' }, `Награда: +${r.rewards.astra} ASTRA, +${r.rewards.points} очков`
      + (r.rewards.capped ? ' (сработал суточный потолок)' : '')),
    ...r.awards.map((aw) => el('p', { class: 'arena-award' }, `Медаль «${aw.title}»: ${aw.wins} побед, +${aw.astra} ASTRA`)),
    el('p', { class: 'muted' }, `Побед всего: ${r.wins}. Попыток осталось: ${r.attempts.left}.`));
}

/** Поле из зерна + устойчивый вариант спрайта на каждый астероид. */
function arenaRunFields(sim, seed) {
  const field = sim.makeField(seed);
  field.asteroids.forEach((a, i) => { a.variant = i % 3; });
  return field;
}

async function arenaStart() {
  if (arenaRun) return;
  arenaResult = null;
  note = '';
  const res = await authed('/minigame/start', {
    method: 'POST',
    // Каждый старт — новое действие: ключ одноразовый.
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: {},
  });
  if (res.status !== 200) {
    if (res.status === 429) arenaResult = { error: 'daily_limit' };
    else note = ERRORS[res.data?.error] || 'Не удалось начать забег';
    render();
    return;
  }
  const sim = await arenaSim();
  await arenaAssets();
  arenaRunFields(sim, res.data.seed);
  arenaRun = {
    runId: res.data.runId,
    seed: res.data.seed,
    field: arenaRunFields(sim, res.data.seed),
    x: 500,
    targetX: null,
    startedAt: performance.now(),
    // Компактная трасса: x в десятых долях пикселя, шаг 40 мс. Сервер сам
    // восстановит время — так тело запроса влезает в лимит.
    xs: [5000],
    nextSampleAt: 40,
    picks: 0,
    hits: 0,
    nextAsteroid: 0,
    nextCrystal: 0,
    booms: [],
    finished: false,
  };
  render();
}

// Спрайты арены — PNG, как и весь интерфейс. Грузим один раз и держим в памяти.
let arenaArt = null;
const arenaTrailCache = {};
let arenaArtPromise = null;
function arenaAssets() {
  if (!arenaArtPromise) {
    const load = (src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    const files = [
      '/sprites/bg/arena.png', '/sprites/arena/ship.png', '/sprites/arena/crystal.png',
      '/sprites/arena/boom.png', '/sprites/arena/asteroid_1.png',
      '/sprites/arena/asteroid_2.png', '/sprites/arena/asteroid_3.png',
    ];
    arenaArtPromise = Promise.all(files.map(load)).then(([bg, ship, crystal, boom, a1, a2, a3]) => {
      arenaArt = { bg, ship, crystal, boom, asteroids: [a1, a2, a3].filter(Boolean) };
      return arenaArt;
    });
  }
  return arenaArtPromise;
}

let arenaSimPromise = null;
function arenaSim() {
  // Тот же модуль, что и на сервере; грузим один раз.
  if (!arenaSimPromise) arenaSimPromise = import('/minigame-sim.js');
  return arenaSimPromise;
}

function arenaStopLoop() {
  if (arenaRaf) cancelAnimationFrame(arenaRaf);
  arenaRaf = 0;
}

function arenaMount() {
  const canvas = document.getElementById('arena-canvas');
  if (!canvas) return;
  arenaDrawStatic(canvas);
  if (!arenaRun || arenaRun.finished) return;
  arenaStopLoop();
  const step = () => {
    if (!arenaRun || arenaRun.finished) return;
    arenaFrame(canvas);
    arenaRaf = requestAnimationFrame(step);
  };
  arenaRaf = requestAnimationFrame(step);
}

function arenaStars(seed) {
  // Звёзды тоже из зерна: поле не «прыгает» между кадрами и перерисовками.
  const out = [];
  let v = (seed || 1) >>> 0;
  for (let i = 0; i < 90; i += 1) {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    const x = v % 1000;
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    const y = v % 620;
    out.push({ x, y, r: ((v >>> 8) % 3) / 2 + 0.4 });
  }
  return out;
}

function arenaDrawStatic(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (arenaArt?.bg) {
    ctx.drawImage(arenaArt.bg, 0, 0, 1000, 620);
    return;
  }
  // Пока PNG не загрузился — тот же космос, но градиентом.
  const g = ctx.createLinearGradient(0, 0, 0, 620);
  g.addColorStop(0, '#081026');
  g.addColorStop(1, '#050a15');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1000, 620);
  ctx.fillStyle = 'rgba(160,200,255,0.5)';
  for (const star of arenaStars(arenaRun ? arenaRun.seed : 7)) {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ARENA_REDUCE = (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
})();

function arenaFrame(canvas) {
  const run = arenaRun;
  const ctx = canvas.getContext('2d');
  if (!ctx || !run) return;
  const now = performance.now();
  const t = Math.min(45_000, now - run.startedAt);

  // Движение: клавиши и «тяни пальцем» уважают один и тот же предел скорости.
  if (arenaKeys.left) run.x -= (ARENA_MAX_SPEED * 16) / 1000;
  if (arenaKeys.right) run.x += (ARENA_MAX_SPEED * 16) / 1000;
  if (!arenaKeys.left && !arenaKeys.right && run.targetX !== null) {
    const diff = run.targetX - run.x;
    const step = (ARENA_MAX_SPEED * 16) / 1000;
    run.x += Math.max(-step, Math.min(step, diff));
  }
  run.x = Math.max(0, Math.min(1000, run.x));

  // Пройденные события считаем локально только для HUD; итог всё равно серверный.
  while (run.nextAsteroid < run.field.asteroids.length && run.field.asteroids[run.nextAsteroid].t <= t) {
    const a = run.field.asteroids[run.nextAsteroid];
    if (Math.abs(run.x - a.x) < a.r + 30) {
      run.hits += 1;
      sfx('hit');
      run.booms.push({ x: a.x, y: ARENA_Y, at: t });
    }
    run.nextAsteroid += 1;
  }
  while (run.nextCrystal < run.field.crystals.length && run.field.crystals[run.nextCrystal].t <= t) {
    const c = run.field.crystals[run.nextCrystal];
    if (Math.abs(run.x - c.x) < c.r + 30) { run.picks += 1; sfx('pick'); }
    run.nextCrystal += 1;
  }

  // Ровная сетка отсчётов: сервер считает время как i * 40 мс.
  while (run.nextSampleAt <= t) {
    run.xs.push(Math.round(run.x * 10));
    run.nextSampleAt += 40;
  }

  arenaDrawStatic(canvas);
  // Астероиды — PNG-спрайты, слегка вращаются, чтобы поток не выглядел статикой.
  for (const a of run.field.asteroids) {
    const y = ARENA_Y - (a.t - t) * (a.speed || 0.4);
    if (y < -80 || y > 700) continue;
    const size = a.r * 2.6;
    const art = arenaArt?.asteroids?.length ? arenaArt.asteroids[(a.variant || 0) % arenaArt.asteroids.length] : null;
    if (art) {
      ctx.save();
      ctx.translate(a.x, y);
      ctx.rotate((t / 900 + (a.variant || 0)) % (Math.PI * 2));
      ctx.drawImage(art, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      const grad = ctx.createRadialGradient(a.x - 8, y - 8, 4, a.x, y, a.r);
      grad.addColorStop(0, '#b9c4df');
      grad.addColorStop(1, '#4a5674');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(a.x, y, a.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Кристаллы.
  for (const c of run.field.crystals) {
    const y = ARENA_Y - (c.t - t) * 0.42;
    if (y < -60 || y > 700) continue;
    if (arenaArt?.crystal) {
      const pulse = 1 + Math.sin((t + c.t) / 180) * 0.08;
      const size = c.r * 2.4 * pulse;
      ctx.save();
      ctx.translate(c.x, y);
      ctx.rotate(Math.sin(t / 700) * 0.25);
      ctx.drawImage(arenaArt.crystal, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(c.x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#66e6ff';
      ctx.fillRect(-c.r / 2, -c.r / 2, c.r, c.r);
      ctx.restore();
    }
  }
  // Вспышки от пробоин: короткий PNG-взрыв на месте столкновения.
  for (const boom of run.booms) {
    const age = t - boom.at;
    if (age > 320 || !arenaArt?.boom) continue;
    const size = 90 + age * 0.25;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age / 320);
    ctx.drawImage(arenaArt.boom, boom.x - size / 2, ARENA_Y - size / 2, size, size);
    ctx.restore();
  }
  // След двигателя: цвет зависит от купленного скина или Premium.
  const trailSrc = activeStyle()?.trail;
  if (trailSrc) {
    if (!arenaTrailCache[trailSrc]) {
      const img = new Image();
      img.src = trailSrc;
      arenaTrailCache[trailSrc] = img;
    }
    const trail = arenaTrailCache[trailSrc];
    if (trail.complete) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.drawImage(trail, run.x - 22, ARENA_Y + 30, 44, 110);
      ctx.restore();
    }
  }
  // Корабль.
  ctx.save();
  ctx.translate(run.x, ARENA_Y + 10);
  if (arenaArt?.ship) {
    ctx.drawImage(arenaArt.ship, -38, -46, 76, 95);
  } else {
    ctx.fillStyle = '#cfe1ff';
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(22, 22);
    ctx.lineTo(0, 12);
    ctx.lineTo(-22, 22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const timeEl = document.querySelector('[data-arena-time]');
  if (timeEl) timeEl.textContent = fmtLeft(Math.max(0, 45_000 - t));
  const score = Math.max(0, run.picks * 10 - run.hits * 20);
  const scoreEl = document.querySelector('[data-arena-score]');
  if (scoreEl) scoreEl.textContent = String(score);
  const picksEl = document.querySelector('[data-arena-picks]');
  if (picksEl) picksEl.textContent = String(run.picks);
  const hitsEl = document.querySelector('[data-arena-hits]');
  if (hitsEl) hitsEl.textContent = String(run.hits);

  if (t >= 45_000) arenaFinish();
}

async function arenaFinish() {
  const run = arenaRun;
  if (!run || run.finished) return;
  run.finished = true;
  arenaStopLoop();
  // Добиваем сетку до конца, чтобы последний отсчёт был на 45-й секунде.
  while (run.xs.length <= 1125) run.xs.push(Math.round(run.x * 10));
  const scope = `arena-run:${run.runId}`;
  const res = await authed('/minigame/finish', {
    method: 'POST',
    headers: { 'Idempotency-Key': idemKey(scope) },
    body: { runId: run.runId, stepMs: 40, xs: run.xs },
  });
  // Ключ нужен только для повтора при обрыве связи — после ответа он не нужен.
  if (res.status === 200) idemDone(scope);
  arenaResult = res.status === 200 ? res.data : { error: res.data?.error || 'bad_trace' };
  if (res.status === 200) sfx(res.data?.result?.win ? 'win' : 'lose');
  arenaRun = null;
  arenaData = null;
  if (state) state = { ...state, minigame: res.data?.attempts ? { attempts: res.data.attempts, wins: res.data.wins } : state.minigame };
  render();
  await loadArena();
  await loadGame();
}

// Клавиши и палец. Слушатели ставим один раз, иначе после каждого render их
// становится всё больше и корабль едет втрое быстрее.
window.addEventListener('keydown', (e) => {
  if (view !== 'arena' || !arenaRun) return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') { arenaKeys.left = true; e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') { arenaKeys.right = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') arenaKeys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') arenaKeys.right = false;
});
document.addEventListener('pointermove', (e) => {
  if (!arenaRun) return;
  const canvas = document.getElementById('arena-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const x = ((e.clientX - rect.left) / rect.width) * 1000;
  if (x >= 0 && x <= 1000) arenaRun.targetX = x;
});

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
      el('button', { type: 'button', class: 'ghost', onClick: () => { socialData = null; render(); loadSocial(); } },
      el('img', { src: '/icons/ui/refresh.png', alt: '', width: '18', height: '18', class: 'btn-ico', loading: 'lazy' }), 'Обновить')),
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
        el('span', { class: 'member-name' },
          el('span', { class: frameClass(m.frame) }, m.label),
          m.premium ? el('span', { class: 'badge' }, 'Premium') : null,
          m.badge === 'pioneer' ? el('img', { src: '/sprites/cosmetics/badge_pioneer.png', alt: 'Значок первопроходца', width: '18', height: '18', class: 'icon-sm' }) : null,
          m.isMe ? el('span', { class: 'rating-me' }, ' вы') : null,
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
    ? el('div', { class: 'block' },
      el('h3', {}, 'Управление'),
      guild.role === 'leader'
        ? (() => {
          const name = el('input', { type: 'text', maxlength: '24', value: guild.mine.name, 'aria-label': 'Новое название гильдии' });
          const tag = el('input', { type: 'text', maxlength: '5', value: guild.mine.tag, 'aria-label': 'Новый тег гильдии' });
          return el('div', { class: 'form' }, name, tag,
            el('button', { type: 'button', class: 'primary', onClick: () => doGuildRename(name.value, tag.value) }, 'Переименовать'));
        })()
        : null,
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'ghost danger', onClick: () => doGuildLeave() }, 'Покинуть гильдию')))
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
      el('h3', {}, 'Мои данные'),
      el('p', { class: 'muted' }, 'Экспорт — файл со всем, что мы знаем об аккаунте. Удаление стирает почту, пароль и позывной; записи журналов остаются обезличенными для учёта.'),
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'ghost', onClick: () => doExportData() }, 'Скачать данные'),
        el('button', { type: 'button', class: 'ghost danger', onClick: () => doDeleteAccount() }, 'Удалить аккаунт'))),
    el('div', { class: 'block' },
      el('h3', {}, 'Крафт'),
      el('p', { class: 'muted' }, 'Девять рецептов — от энергоячейки до квантовой матрицы — в отдельном разделе.'),
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


// ── Боксы (этап 5) ───────────────────────────────────────────────────────────
// Два бесплатных по таймеру и два платных за ASTRA. Состав выдаёт только
// сервер: здесь он показывает каталог, таймеры и то, что реально выпало.
function boxCard(b) {
  const wait = b.nextOpenAt ? left(b.nextOpenAt) : 0;
  const locked = b.cooldownMs > 0 && wait > 0;
  const poor = b.price > 0 && state.balances.astra < b.price;
  const label = locked
    ? 'Закрыт'
    : b.price > 0
      ? (poor ? `Нужно ${b.price} ASTRA` : `Открыть за ${b.price} ASTRA`)
      : 'Открыть бесплатно';
  return el('div', { class: `box-card${locked ? ' is-locked' : ''}${b.price > 0 ? ' is-paid' : ''}` },
    el('img', { src: b.sprite, alt: '', width: '128', height: '128', class: 'box-art', loading: 'lazy' }),
    el('div', { class: 'box-body' },
      el('div', { class: 'box-head' },
        el('h3', {}, b.name),
        el('span', { class: `badge${b.price > 0 ? ' badge-paid' : ''}` }, b.price > 0 ? `${b.price} ASTRA` : 'бесплатно')),
      el('p', { class: 'muted' }, b.hint),
      el('p', { class: 'muted' }, `Ресурсов за открытие: ${b.units[0]}–${b.units[1]}` + (b.price > 0 ? '' : ' · ресурсы, не ASTRA')),
      // Шансы машин — отдельная строка, и они маленькие нарочно.
      (b.planeChances || []).length
        ? el('p', { class: 'muted box-plane-chances' },
          'Машина звена: ',
          ...b.planeChances.map((c, i) => [
            i > 0 ? ' · ' : null,
            `${c.rarityName.toLowerCase()} ${Math.round(c.chance * 10000) / 100} %`,
          ].filter(Boolean)).flat())
        : null,
      locked
        ? el('p', { class: 'box-timer', 'data-until': String(b.nextOpenAt), 'data-open-box': b.id }, '')
        : (b.price > 0
          ? el('p', { class: 'muted' }, `Баланс: ${astraNum(state.balances.astra)} ASTRA`)
          : el('p', { class: 'ok' }, 'Бокс готов')),
      el('button', {
        type: 'button',
        class: b.price > 0 ? 'primary' : 'cta',
        disabled: locked || poor || state.frozen ? '' : null,
        'data-box-button': b.id,
        onClick: () => doOpenBox(b.id),
      }, label),
      b.opens ? el('p', { class: 'muted box-opens' }, `Открыт ${b.opens === 1 ? 'один раз' : `${b.opens} раз`}`) : null,
    ),
  );
}

function dropsLine(drops) {
  return (drops || []).map((d) => `${d.name || RESOURCES[d.resource] || d.resource} ×${d.amount}`).join(' · ');
}

function renderBoxes() {
  const data = boxData;
  const header = el('div', { class: 'screen-title' },
    el('h2', {}, 'Боксы'),
    el('span', { class: 'badge' }, data ? 'контейнеры базы' : 'загрузка'));
  if (!data) {
    return el('div', { class: 'screen' }, header,
      el('p', { class: 'muted' }, 'Загружаем боксы…'),
      el('button', { type: 'button', class: 'ghost', onClick: () => loadBoxes() }, 'Обновить'));
  }

  const result = boxResult && dropsLine(boxResult.drops)
    ? el('div', { class: 'box-result' },
      el('b', {}, `Из «${boxResult.name}» выпало:`),
      el('span', {}, dropsLine(boxResult.drops)),
      boxResult.components ? el('span', { class: 'ok' }, `компонентов: ${boxResult.components}`) : null,
      boxResult.plane ? planeFindLine(boxResult.plane) : null)
    : null;

  const history = (data.history || []).map((h) => el('li', {},
    el('span', { class: 'muted' }, `${fmtDay(h.at)} · ${data.boxes.find((b) => b.id === h.box)?.name || h.box}`),
    el('span', {}, dropsLine(h.drops))));

  return el('div', { class: 'screen' },
    header,
    el('p', { class: 'muted' }, 'Боксы — это ресурсы, а не валюта: ASTRA из них не выпадает. Дневной и недельный бесплатны по таймеру, платные — сток ASTRA. Доходность ниже, чем у рейсов: рейс приносит ещё очки и опыт.'),
    result,
    el('div', { class: 'box-grid' }, ...data.boxes.map(boxCard)),
    history.length ? el('div', { class: 'block' },
      el('h3', {}, 'Последние открытия'),
      el('ul', { class: 'plain box-history' }, ...history)) : null,
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
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
  const style = activeStyle();
  setText('#commander', callsign());
  setText('#commander-mobile', callsign());
  for (const sel of ['#commander', '#commander-mobile']) {
    const node = document.querySelector(sel);
    if (node) node.className = `profile-name ${style ? style.cls : ''}`;
  }
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
                  : view === 'bonus' ? renderBonus()
                    : view === 'boxes' ? renderBoxes()
                    : view === 'arena' ? renderArena()
            : view === 'wallet' ? renderWallet()
            : view === 'ledger' ? renderLedger() : renderBridge();
  panel.append(body);
  // Арена живёт на canvas: цикл перевешиваем на свежий элемент после перерисовки.
  if (view === 'arena') arenaMount();
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

/**
 * Купленное в магазине: премиум и скины. Спрашиваем только когда платежи
 * включены — иначе лишний запрос и создание таблиц там, где денег нет.
 */
async function loadPayAccount() {
  const status = await request('/pay/status.json').catch(() => null);
  if (status?.status !== 200 || !status.data?.flags?.payments) { account = null; return; }
  const res = await authed('/pay/account.json');
  account = res.status === 200 ? res.data : null;
  if (view === 'bonus' || view === 'bridge' || view === 'fleet') render();
}

/**
 * Сводка за время отсутствия. Метка «когда были» хранится на устройстве:
 * серверу для этого не нужны новые таблицы, а игрок видит понятный текст.
 */
function welcomeNote(data) {
  let lastSeen = 0;
  try { lastSeen = Number(localStorage.getItem('astra:lastSeen') || 0); } catch { /* приватный режим */ }
  const now = Date.now() + serverOffset;
  try { localStorage.setItem('astra:lastSeen', String(now)); } catch { /* приватный режим */ }
  return offlineSummary({
    lastSeen,
    now,
    expeditions: data.expeditions,
    fuel: data.fuel,
    season: data.season,
  });
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
  const welcome = welcomeNote(data);
  // Сервер сам сказал, что экономит (заголовок X-Astra-Mode): предупреждаем
  // игрока заранее, а не молчим до первого 503.
  if (!note && (serverMode === 'lite' || serverMode === 'sleep')) {
    note = serverMode === 'sleep'
      ? 'Сервер до полуночи UTC в режиме экономии: часть разделов недоступна, прогресс сохранён.'
      : 'Высокая нагрузка: часть разделов может быть недоступна до конца дня.';
  }
  if (welcome && !note) note = welcome;

  // Отложенные действия отправляем сразу после успешной загрузки: сервер жив.
  if (queueSize()) {
    const sent = await flushQueue();
    if (sent) {
      note = `Отправлено отложенных действий: ${sent}`;
      const again = await authed('/me');
      if (again.status === 200) state = again.data;
    }
  }

  if (view === 'ledger') {
    const led = await authed('/ledger');
    ledger = led.status === 200 ? led.data.entries : [];
  }
  show('game');
  render();
  mountAds();
  if (!account) loadPayAccount();
}

async function act(scope, path, body) {
  note = '';
  const key = idemKey(scope);
  const { status, data } = await authed(path, { method: 'POST', headers: { 'Idempotency-Key': key }, body });
  const result = { status, data };

  // Связь пропала или сервер экономит: сохраняем действие, а не теряем его.
  const offline = status === 0;
  const saving = status === 503 && String(data?.error || '').startsWith('server_');
  if (offline || saving) {
    const queued = enqueueOp({ path, body: body || {}, idem: key });
    note = queued
      ? 'Связь пропала: действие сохранено и отправится само'
      : 'Действие уже в очереди, отправим при связи';
    render();
    return result;
  }

  idemDone(scope);
  if (status >= 400) note = `Ошибка: ${errText(data.error)}`;
  else note = 'Готово';
  // Короткий сигнал: без него действие в другой вкладке выглядит «зависшим».
  if (view !== 'arena') sfx(status >= 400 ? 'lose' : 'pick');
  await loadGame();
  return result;
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
function doGuildRename(name, tag) { return act(`guild-rename:${name}:${tag}`, '/guild/rename', { name, tag }).then(loadGuild); }
function doGuildRole(playerId, role) { return act(`guild-role:${playerId}:${role}`, '/guild/role', { playerId, role }).then(loadGuild); }
function doOpenBox(boxId) {
  boxResult = null;
  // Пока сервер отвечает, кнопка занята: иначе легко нажать дважды и не понять,
  // почему пришло одно открытие.
  const btn = document.querySelector(`[data-box-button="${boxId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Открываем…';
  }
  // Аудиоконтекст создаём прямо в обработчике клика: после await браузер уже не
  // считает вызов «жестом пользователя» и звук открытия может не заиграть.
  try { audioCtx(); } catch { /* без звука тоже работает */ }
  // Ключ включает счётчик открытий: двойной клик — одно действие, а следующее
  // открытие того же бокса — уже новое.
  const opens = boxData?.boxes?.find((b) => b.id === boxId)?.opens ?? 0;
  return act(`box:${boxId}:${opens}`, '/boxes/open', { box: boxId }).then(async (res) => {
    // Что выпало — из ответа сервера: в /boxes этого нет.
    if (res && res.status < 400 && res.data?.drops) {
      boxResult = { ...res.data, at: Date.now() };
      const box = boxData?.boxes?.find((b) => b.id === boxId);
      // Сцена живёт на body, поэтому перерисовка экрана её не сносит.
      boxStage ||= createBoxStage();
      boxSound();
      boxStage.play({
        box: boxId,
        name: res.data.name || box?.name,
        sprite: box?.sprite,
        drops: res.data.drops,
        plane: res.data.plane || null,
      });
    }
    await loadBoxes();
  });
}
function doStartPatrol(plane) { return act(`patrol:${plane}`, '/planes/patrol', { plane }); }
function doClaimPatrol() {
  const id = state.planes?.patrol?.id || 0;
  return act(`patrol-claim:${id}`, '/planes/patrol/claim', {}).then((res) => {
    const found = res && res.status < 400 ? res.data?.found : null;
    note = found ? `Патруль нашёл машину: ${found.name}` : 'Патруль вернулся без находки';
    render();
  });
}
function doApplyReferral(code) { return act(`ref:${code}`, '/referrals/apply', { code }).then(loadGuild); }

function setView(v) {
  view = v;
  note = '';
  if (v === 'bonus') loadPayAccount();
  if (v === 'boxes') loadBoxes();
  if (v === 'arena') { arenaResult = null; if (!arenaData) loadArena(); }
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
// Кнопки, которые уводят на другую страницу (магазин), а не переключают раздел.
for (const b of document.querySelectorAll('[data-nav]')) b.addEventListener('click', () => { location.href = b.dataset.nav; });
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
