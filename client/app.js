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
  bad_idem_key: 'Слишком короткий ключ повторения — обновите страницу',
  turnstile_failed: 'Проверка «я человек» не пройдена — подтвердите ещё раз',
  bad_email: 'Адрес выглядит выдуманным — напишите настоящую почту',
  disposable_email: 'Одноразовые ящики не подходят — нужна настоящая почта',
  no_mx: 'Этот домен не принимает письма — возьмите другой адрес',
  email_check_unavailable: 'Проверка почты не ответила — попробуйте ещё раз через минуту',
  too_many_signup_from_domain: 'С этого домена уже много регистраций — попробуйте позже',
  unauthorized: 'Нужно войти заново',
  no_session: 'Сессия истекла, войдите заново',
  ship_not_found: 'Корабль не найден',
  world_full: 'Нет свободных мест, попробуйте позже',
  internal: 'Ошибка сервера, попробуйте позже',
  server_misconfigured: 'Сервер не настроен',
  server_sleep: 'Сервер бережёт себя до полуночи UTC: прогресс сохранён, зайдите позже',
  server_lite: 'Сейчас высокая нагрузка: этот раздел временно недоступен, попробуйте позже',
  bad_run: 'Забег не найден, начните новый',
  bad_game: 'Такой игры в аркаде нет — обнови страницу',
  run_not_found: 'Забег не найден, начните новый',
  run_expired: 'Забег просрочен: попытка сгорела',
  bad_trace: 'Трасса не прошла проверку: попытка сгорела',
  too_fast: 'Слишком резкое движение: попытка сгорела',
  short: 'Забег не дотянут до конца: попытка сгорела',
  daily_limit: 'Попытки на сегодня кончились',
  registration_incomplete: 'Регистрация не завершилась, попробуйте войти или обратитесь в поддержку',
  turnstile_required: 'Сначала пройдите проверку «я человек» — без неё бонус не выдаётся',
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
  blueprint_required: 'Нужен чертёж: соберите «Чертёж Flagship» в разделе «Крафт» — он из квантовой пыли и пустотного кристалла 4-го сектора',
  ship_locked: 'Уровень ещё мал для этого корабля',
  ship_owned: 'Такой корабль уже в ангаре',
  garage_full: 'Гараж полон: купите ещё одну ячейку',
  garage_max: 'Больше ячеек не бывает: максимум 6 — по числу кораблей',
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
  patrol_slots_full: 'Все слоты звена заняты: сдайте вернувшиеся борта или подождите',
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
  ship_blueprint: 'Чертёж в сборку',
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
  plane_salvage: 'Добыча авиазвена',
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
  // Чертёж флагмана — ресурс такой же, как компонент: лежит в трюме и сгорает в
  // сборке. Без имени в этой карте карточка крафта показывала бы `flagship_plans`.
  flagship_plans: 'Чертёж Flagship',
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
// Какой раздел отрисован в #panel сейчас: нужно, чтобы отличать плановое
// обновление того же экрана от перехода — у него свои правила прокрутки.
let renderedView = null;

// Раздел, на котором игрока застала перезагрузка страницы. Без этого F5 в
// «Флоте» возвращал в «Обзор»: список кораблей и верфь приходилось искать
// заново, а на телефоне ещё и прокрутку. Значение берётся из хэша URL (можно
// поделиться ссылкой «.../#fleet»), а хэш — из localStorage.
function knownViews() {
  return new Set(Array.from(document.querySelectorAll('[data-view]')).map((b) => b.dataset.view));
}

function savedView() {
  const known = knownViews();
  const fromHash = (location.hash || '').replace(/^#/, '').trim();
  if (known.has(fromHash)) return fromHash;
  try {
    const v = localStorage.getItem('astra:view');
    return known.has(v) ? v : 'bridge';
  } catch {
    return 'bridge';
  }
}

function rememberView(v) {
  try { localStorage.setItem('astra:view', v); } catch { /* приватный режим */ }
  // replaceState, а не location.hash: история не наполняется кликами по меню,
  // а ссылка на раздел всё равно остаётся в адресной строке.
  if ((location.hash || '').replace(/^#/, '') !== v) {
    try { history.replaceState(null, '', `#${v}`); } catch { /* file:// и старые браузеры */ }
  }
}
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
// Флаги загрузки — как в аркаде: ошибка ответа не должна запускать цикл запросов.
let arenaLoading = false;
let arenaError = '';
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
let turnstileScript = null;
// Шлюз «я человек» — ТОЛЬКО вокруг бонусов (этап 6): Claim и бесплатные боксы
// сервер выдаёт по одноразовому токену Turnstile. Виджет живёт прямо в разделе,
// токен — в bonusToken; после любого бонусного действия он сбрасывается, потому
// что Cloudflare одноразовый. Со входа и регистрации проверка снята: там вместо
// неё сервер проверяет почту (docs/SECURITY.md, «Регистрация»).
let bonusToken = null;
let bonusWidget = null;
/**
 * Состояние шлюза: 'loading' — скрипт ещё грузится, 'ready' — виджет ждёт
 * нажатия, 'done' — токен получен, 'error' — виджет не поднялся.
 *
 * Раньше про любую беду (нельзя скачать challenges.cloudflare.com, ключ не
 * подходит к домену, игрок сидит через блокировщик) интерфейс молчал: кнопка
 * оставалась серой, а рядом висел «сбой». Теперь у каждой беды есть своё слово и
 * своя кнопка «Повторить» — проверка это внешний сервис, и что она недоступна,
 * надо сказать прямо, а не превращать в таймаут.
 */
let bonusGate = 'loading';
let bonusGateNote = '';
/**
 * Контейнер под виджет. Один и тот же node переезжает из карточки в карточку:
 * перерисовка экрана не рвёт живой challenge, иначе каждые несколько секунд
 * Turnstile начинала бы сначала и в итоге падала в error-callback.
 */
const bonusGateHost = (() => {
  const node = document.createElement('div');
  node.id = 'turnstile-claim';
  node.className = 'ts-host';
  return node;
})();

function setBonusGate(status, noteText = '') {
  bonusGate = status;
  bonusGateNote = noteText;
}

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

// Ключ повторения: 8…64 символа [A-Za-z0-9._:-] — такое правило на сервере и для
// одиночных действий, и для пачки. `randomUUID` есть только в защищённом
// контексте, поэтому как в pay.js держим запасной вариант: без него любое
// действие падало бы на TypeError.
function newIdem() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* старый браузер или http — падаем на ручной ключ */ }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function idemKey(scope) {
  const k = `idem:${scope}`;
  let v = sessionStorage.getItem(k);
  if (!v) { v = newIdem(); sessionStorage.setItem(k, v); }
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
}

function setMode(m) {
  mode = m;
  $('#tab-register').classList.toggle('active', m === 'register');
  $('#tab-login').classList.toggle('active', m === 'login');
  $('#auth-submit').textContent = m === 'register' ? 'Зарегистрироваться' : 'Войти';
  $('#password').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}

async function loadConfig() {
  const res = await request('/config').catch(() => null);
  if (res?.status === 200) config = res.data;
  // Site key приезжает асинхронно: как только он есть, бонусный шлюз перерисовывается
  // и может ставить виджет (до этого он бы просто не знал, что включаться надо).
  refreshBonusGateView();
}

/**
 * Скрипт Turnstile грузится один раз на страницу и переиспользуется формами.
 *
 * Таймаут обязателен: запрос к challenges.cloudflare.com может ни выполниться,
 * ни отвалиться — блокировщик скриптов, корпоративный прокси, preview-домен без
 * сети. Без `onload` и без `onerror` промис не завершается никогда: шлюз
 * остаётся в «Загружаем проверку…», а кнопка Claim — мёртвой. Именно так игрок
 * и видит проверку: «она есть, но ничего не происходит».
 */
const TURNSTILE_LOAD_MS = 12000;

function ensureTurnstileScript() {
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('turnstile_load_timeout'));
      }, TURNSTILE_LOAD_MS);
      s.onload = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      s.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('turnstile_load_error')); };
      document.head.append(s);
    });
  }
  return turnstileScript;
}

/** Включён ли шлюз: сервер отдал site key — значит секрет настроен и требует. */
function bonusGateOn() {
  return Boolean(config.turnstile_site_key);
}

/**
 * Разметка шлюза: блок с подписью и контейнером под виджет. Один id на
 * «Мостик», «Бонусы» и «Боксы» — эти экраны не живут одновременно.
 */
function bonusGateBlock() {
  if (!bonusGateOn()) return null;
  if (bonusToken) {
    return el('div', { class: 'bonus-check is-done' },
      el('p', { class: 'ok' }, 'Человек подтверждён — можно забирать.'));
  }
  const hint = {
    loading: 'Загружаем проверку…',
    ready: 'Подтвердите, что вы человек: Claim и бесплатные бонусы выдаются только после проверки.',
    error: bonusGateNote || 'Проверка не ответила. Попробуйте ещё раз.',
  }[bonusGate] || '';
  return el('div', { class: `bonus-check is-${bonusGate}` },
    el('p', { class: bonusGate === 'error' ? 'error' : 'muted' }, hint),
    bonusGate === 'error' ? el('div', { class: 'bonus-check-actions' },
      el('button', { type: 'button', class: 'ghost', onClick: () => retryBonusGate() }, 'Повторить проверку'),
      el('button', { type: 'button', class: 'link', onClick: () => location.reload() }, 'Перезагрузить страницу'))
      : null,
    // Контейнер не пересоздаётся: в нём живёт iframe Turnstile. В ошибке он
    // просто скрыт — «Повторить» должен найти тот же node, а не новый.
    el('div', { class: `ts-wrap${bonusGate === 'error' ? ' is-hidden' : ''}` }, bonusGateHost));
}

/** Навешиваем виджет после перерисовки экрана. Токен уже есть — перерисовка не нужна. */
function mountBonusGate() {
  if (!bonusGateOn()) { setBonusGate('ready'); return; }
  if (bonusToken) { setBonusGate('done'); return; }
  const box = document.getElementById('turnstile-claim');
  if (!box) return;
  // Живой виджет уже стоит в нужном контейнере (node переезжает между экранами
  // целиком) — значит ничего пересаживать нельзя: каждый повторный render()
  // обрывал бы challenge на середине и приводил бы к «сбою».
  if (bonusWidget !== null && window.turnstile && box.firstChild) return;
  // ...но если перерисовка всё-таки вынесла iframe из контейнера, виджет мёртв:
  // без пересоздания игрок остался бы с пустым слотом и вечной «загрузкой».
  if (bonusWidget !== null && window.turnstile && !box.firstChild) {
    try { window.turnstile.remove(bonusWidget); } catch { /* уже снят */ }
    bonusWidget = null;
  }
  if (window.turnstile) { renderBonusWidget(box); return; }
  setBonusGate('loading');
  ensureTurnstileScript().then(() => {
    if (!window.turnstile) {
      setBonusGate('error', 'Скрипт проверки загрузился, но не запустился: его блокирует расширение или сеть. Отключите блокировщик и повторите.');
      refreshBonusGateView();
      return;
    }
    const target = document.getElementById('turnstile-claim');
    if (target) renderBonusWidget(target);
    else refreshBonusGateView();
  }).catch(() => {
    // Сбросить промис, чтобы следующая попытка снова попробовала загрузить скрипт.
    turnstileScript = null;
    setBonusGate('error', 'Проверка Cloudflare не открылась: нет связи, или её блокирует расширение, или этот адрес не пропускает чужие скрипты. Бонусы никуда не денутся — повторите, когда связь вернётся.');
    refreshBonusGateView();
  });
}

function renderBonusWidget(box) {
  if (bonusWidget !== null) {
    try { window.turnstile.remove(bonusWidget); } catch { /* уже снят */ }
    bonusWidget = null;
  }
  setBonusGate('ready');
  try {
    bonusWidget = window.turnstile.render(box, {
      sitekey: config.turnstile_site_key,
      theme: 'dark',
      callback: (token) => { bonusToken = token; setBonusGate('done'); refreshBonusButtons(); refreshBonusGateView(); },
      'expired-callback': () => { bonusToken = null; setBonusGate('ready', ''); refreshBonusButtons(); refreshBonusGateView(); },
      'timeout-callback': () => { bonusToken = null; setBonusGate('ready', ''); refreshBonusButtons(); refreshBonusGateView(); },
      // Ошибка виджета — это не «вы робот». Чаще всего ключ Turnstile не привязан
      // к домену (на превью так и есть) или challenge не дожил до ответа сети.
      // Гасим молчание словом и кнопкой повтора, а не серой кнопкой «Claim».
      'error-callback': (err) => {
        bonusToken = null;
        setBonusGate('error', turnstileErrorText(err));
        refreshBonusButtons();
        refreshBonusGateView();
      },
    });
  } catch {
    setBonusGate('error', 'Виджет проверки не запустился на этом браузере. Попробуйте перезагрузить страницу.');
    refreshBonusButtons();
    refreshBonusGateView();
  }
}

/**
 * Что Turnstile имел в виду под своей ошибкой. Коды приходят и строкой, и
 * объектом — Cloudflare нигде не обещает формат, поэтому разбираем оба.
 *
 * Смысл ровно один: «сбой» — это не обвинение игрока в роботизме. Домен без
 * ключа, блокировщик, сеть — всё это лечится повтором или другим адресом, и
 * игрок обязан увидеть что именно попробовать.
 */
function turnstileErrorText(err) {
  const raw = typeof err === 'string' ? err : String((err && (err.code || err.message)) || '');
  const code = raw ? ` (код ${raw})` : '';
  // 600010 — invalid sitekey / hostname не в списке виджета.
  if (/600010|400010|300020/.test(raw)) {
    return `Этот адрес не настроен для проверки Cloudflare${code}. На боевом домене всё работает; здесь можно повторить или перезагрузить страницу.`;
  }
  // 300030 — несколько виджетов на странице; 110700 — challenge истёк в сети.
  if (/300030/.test(raw)) {
    return `Проверка уже открыта в другом окне${code}. Закройте лишнюю вкладку и повторите.`;
  }
  return `Проверка не дошла до конца${code} — обычно это сеть или блокировщик скриптов. Попробуйте ещё раз, бонусы никуда не денутся.`;
}

/** «Повторить» из состояния ошибки: пробуем и скрипт, и виджет заново. */
function retryBonusGate() {
  setBonusGate('loading');
  refreshBonusGateView();
  if (bonusWidget !== null && window.turnstile) {
    try { window.turnstile.remove(bonusWidget); } catch { /* уже снят */ }
    bonusWidget = null;
  }
  const box = document.getElementById('turnstile-claim');
  if (window.turnstile && box) { renderBonusWidget(box); return Promise.resolve(); }
  turnstileScript = null;
  return mountBonusGateAsync(box);
}

function mountBonusGateAsync(box) {
  return ensureTurnstileScript().then(() => {
    const target = box || document.getElementById('turnstile-claim');
    if (window.turnstile && target) renderBonusWidget(target);
    else {
      setBonusGate('error', 'Проверка всё ещё не загружается. Проверьте связь или отключите блокировщик скриптов.');
      refreshBonusGateView();
    }
  }).catch(() => {
    turnstileScript = null;
    setBonusGate('error', 'Не удалось загрузить проверку Cloudflare: нет связи или её блокирует расширение.');
    refreshBonusGateView();
  });
}

/**
 * Обновить только блок шлюза, не перерисовывая весь экран: перерисовка убила бы
 * живой виджет, и игрок не досмотрел быchallenge до конца.
 */
function refreshBonusGateView() {
  const host = document.querySelector('.bonus-check');
  if (!host) return;
  const fresh = bonusGateBlock();
  if (fresh) host.replaceWith(fresh);
  refreshBonusButtons();
}

/** Кнопки бонусов активны только со свежим токеном (и когда таймер позволил). */
function refreshBonusButtons() {
  const blocked = bonusGateOn() && !bonusToken;
  const claimLeft = left(state?.nextClaimAt);
  for (const btn of document.querySelectorAll('[data-claim]')) {
    btn.disabled = blocked || claimLeft > 0 || !!state?.frozen;
    btn.title = blocked
      ? (bonusGate === 'error' ? 'Сначала пройдите проверку «я человек»' : 'Нужно подтвердить, что вы человек')
      : '';
  }
  for (const btn of document.querySelectorAll('[data-box-button][data-free="1"]')) {
    if (btn.dataset.busy === '1') continue;
    btn.disabled = blocked || !!state?.frozen;
    btn.title = blocked ? 'Нужно подтвердить, что вы человек' : '';
  }
}

/** Токен одноразовый: после любого бонусного действия просим подтверждение заново. */
function resetBonusGate() {
  bonusToken = null;
  setBonusGate(window.turnstile ? 'ready' : 'loading');
  if (bonusWidget !== null && window.turnstile) {
    // reset() возвращает виджет в исходное состояние. Убираем его совсем: на
    // некоторых браузерах reset после ошибки оставляет мёртвый iframe, и кнопка
    // выглядит живой, а токен не приходит никогда.
    try { window.turnstile.remove(bonusWidget); } catch { /* виджет уже снят */ }
    bonusWidget = null;
  }
  refreshBonusButtons();
}

function left(ts) { return ts ? Math.max(0, ts - (Date.now() + serverOffset)) : 0; }

function updateTimers() {
  const claimLeft = left(state?.nextClaimAt);
  const blockedByGate = bonusGateOn() && !bonusToken;
  for (const btn of document.querySelectorAll('[data-claim]')) {
    btn.disabled = claimLeft > 0 || !!state?.frozen || blockedByGate;
  }
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
  // Claim: подтверждение показываем только когда бонус можно забрать. Значит в
  // момент, когда таймер дошёл до нуля, блок нужно доставить в размеченный слот —
  // иначе игрок смотрит на пустой слот и ждёт, пока он сам появится (не появится).
  if (!claimLeft && bonusGateOn() && !bonusToken && !document.querySelector('.bonus-check')) {
    const slot = document.querySelector('[data-gate-slot]');
    const block = slot ? bonusGateBlock() : null;
    if (block) {
      slot.append(block);
      mountBonusGate();
    }
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

/** Состояние модулей одного корабля из /me (id → слоты, что стоит, эффекты). */
function shipMods(shipId) {
  const list = state?.modules?.ships || [];
  return list.find((x) => x.id === shipId) || null;
}

/**
 * Гнёзда под модули. Рисунок простой и читаемый сразу: пустой слот — пунктирное
 * гнездо, занятый — иконка модуля и точки уровня. Чем больше слотов у корпуса,
 * тем длиннее полоса: «корабль накачан» видно не открывая раздел.
 */
function moduleRig(view, size) {
  if (!view) return null;
  const pips = [];
  for (let i = 0; i < view.slots; i += 1) {
    const mod = view.modules[i];
    const dots = [];
    for (let l = 1; l <= (state.modules.maxLevel || 5); l += 1) {
      dots.push(el('i', { class: mod && mod.level >= l ? 'on' : null }));
    }
    pips.push(el('div', {
      class: `rig-pip${mod ? ' is-on' : ''}`,
      title: mod ? `${mod.name} · уровень ${mod.level} · ${mod.effectText}` : `Свободный слот ${i + 1}`,
    },
    mod
      ? el('img', { src: `/sprites/modules/${mod.id}.png`, alt: mod.name, width: String(size), height: String(size), loading: 'lazy' })
      : null,
    el('div', { class: 'rig-dots' }, ...dots)));
  }
  return el('div', { class: 'rig-pips' }, ...pips);
}

/** Картинка корпуса: скин, если куплен, иначе обычный спрайт типа. */
function shipArtSrc(type) {
  return ownedSkin() || `/sprites/ships/${type}.png`;
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
    // Раньше опыт капал только за рейс, и «очки есть, а уровень 1» выглядело
    // сломанным. Теперь список полный — игрок видит, за что растёт уровень.
    el('p', { class: 'muted level-foot' }, 'Опыт: Claim, рейсы, арена, миссии, боксы, крафт и каждый уровень модуля.'),
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

/** Активные рейсы всегда массив: раньше сервер отдавал один, и второй борт
 * флота оставался невидимкой. Одиночный объект от старого API тоже принимается. */
function activeExpeditions() {
  const a = state?.expeditions?.active;
  if (Array.isArray(a)) return a;
  return a ? [a] : [];
}

/** Корабль, под который планируем рейс: выбранный игроком или первый свободный. */
function flightShipId() {
  const picked = (state?.ships || []).find((s) => s.id === window.__ship);
  // Выбор живёт до перезагрузки страницы, а корабль за это время мог улететь:
  // занятому борту планет не планируем, берём первого свободного.
  if (picked && picked.status === 'idle' && picked.durability > 0) return picked.id;
  const idle = (state?.ships || []).find((s) => s.status === 'idle' && s.durability > 0);
  return idle ? idle.id : (state?.ships?.[0]?.id || null);
}

/** Свободные корабли: те, что можно отправить прямо сейчас. */
function idleShips() {
  return (state?.ships || []).filter((s) => s.status === 'idle' && s.durability > 0);
}

/** Смена корабля — серверный запрос: варианты рейса и радиус считает сервер. */
function pickShip(id) {
  window.__ship = id;
  loadGame().then(render);
}

function renderBridge() {
  const season = state.season;
  const ship = state.ships[0];
  const actives = activeExpeditions();
  const active = actives[0] || null;
  const claimLeft = left(state.nextClaimAt);
  const b = state.balances;
  return el('div', { class: 'screen' },
    el('div', { class: 'hero' },
      shipArt(ship?.type || 'scout'),
      el('div', { class: 'hero-copy' },
        el('span', { class: 'badge' }, 'Мостик'),
        el('h2', {}, actives.length > 1 ? `${actives.length} рейса в пути` : active ? 'Рейс в пути' : 'Готовы к прыжку?'),
        el('p', { class: 'muted' }, active
          ? actives.length > 1
            ? `${actives.length} бортов · ближайший финиш через ${fmtLeft(Math.min(...actives.map((a) => left(a.endsAt))))}`
            : `${active.planet} · до финиша ${fmtLeft(left(active.endsAt))}`
          : 'Выберите планету и корабль — свободные борта могут лететь одновременно.'),
        el('button', {
          type: 'button',
          class: active ? 'cta cta-ghost' : 'cta',
          onClick: () => setView('flight'),
        }, actives.length > 1 ? `Открыть рейсы (${actives.length})` : active ? 'Открыть рейс' : 'Начать экспедицию'),
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
          disabled: claimLeft > 0 || state.frozen || (bonusGateOn() && !bonusToken) ? '' : null,
          onClick: doClaim,
        }, el('img', { src: '/icons/ui/claim.png', alt: '', width: '22', height: '22', class: 'icon-sm' }), 'Забрать'),
        // Пока таймер не истёк, подтверждение не нужно: нечего показывать. Слот
        // остаётся в разметке — updateTimers положит в него блок, как только Claim
        // станет доступен, и игроку не придётся ждать перезагрузки страницы.
        el('div', { 'data-gate-slot': '' }, claimLeft > 0 ? null : bonusGateBlock()),
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

/**
 * Один рейс: карточка с таймером, выбором корабля, событием и отменой.
 * Вынесено из «Рейса» в функцию, потому что карточек теперь несколько —
 * по числу кораблей в воздухе.
 */
function expeditionCard(x) {
  const ship = state.ships.find((s) => s.id === x.shipId);
  const remain = left(x.endsAt);
  const kids = [
    el('div', { class: 'expedition-head' },
      el('div', { class: 'expedition-who' },
        el('img', { src: shipArtSrc(ship?.type || 'scout'), alt: '', width: '56', height: '28', class: 'expedition-ship', loading: 'lazy' }),
        el('div', {},
          el('h3', {},
            x.status === 'waiting_choice' ? 'Событие в пути' : 'Рейс',
            el('span', { class: 'badge' }, ship ? ship.name : x.shipId)),
          el('p', { class: 'muted' }, `${x.planet} · ${x.kind}`))),
      remain > 0
        ? el('p', { class: 'muted', 'data-prefix': 'До финиша ', 'data-until': x.endsAt }, `До финиша ${fmtLeft(remain)}`)
        : el('p', { class: 'muted' }, 'Время вышло. Обновляем результат…')),
    ];
  if (x.event) {
    kids.push(el('div', { class: 'block' },
      el('h3', {}, x.event.title),
      el('p', {}, x.event.text),
      el('div', { class: 'choices' }, ...x.event.choices.map((c) =>
        el('button', {
          type: 'button',
          disabled: state.frozen ? '' : null,
          onClick: () => doChoose(x.id, c.id),
        }, `${c.label}${c.safe ? ' · тише' : ' · риск'}`),
      )),
    ));
  }
  if (Date.now() <= x.cancelUntil) {
    kids.push(el('button', { type: 'button', class: 'ghost', disabled: state.frozen ? '' : null, onClick: () => doCancel(x.id) }, 'Отменить (вернётся половина топлива)'));
  }
  if (x.reward) kids.push(rewardBlock(x.reward));
  return el('div', { class: `block expedition-card${x.event ? ' has-event' : ''}` }, ...kids);
}

function renderFlight() {
  const actives = activeExpeditions();
  const idle = idleShips();
  // Планируем рейс по кораблю, который выбрал игрок (window.__ship). Сервер
  // считает под него планеты и варианты, поэтому оценки всегда про тот борт,
  // который реально полетит, а не всегда про первый в ангаре.
  const ship = idle.find((sh) => sh.id === flightShipId()) || idle[0] || null;
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
  // Выбранный борт не дотягивает до планеты — флот при этом долетает. Подбираем
  // того, кто может: кнопка смены корабля дешевле, чем догадка игрока.
  const tooFar = !!selected?.shipTooFar;
  const betterShip = tooFar
    ? idle.find((sh) => (sh.maxSector ?? 0) >= (selected?.sector ?? 0)) || null
    : null;

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
      // Замок и «этот борт не дотягивает» — разные вещи: первое лечится уровнем
      // или новым кораблём, второе — одним кликом по чипу рядом.
      el('span', { class: 'planet-meta' }, p.locked || p.shipTooFar
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

  // Выбор корабля. Пока свободных бортов много, «Старт» должен быть понятен:
  // летит тот, что подсвечен, а остальные остаются на земле и ждут своей пары.
  const picker = idle.length
    ? el('div', { class: 'ship-picker' },
        el('span', { class: 'picker-label' }, 'Корабль'),
        ...idle.map((sh) => el('button', {
          type: 'button',
          class: `ship-chip${sh.id === ship?.id ? ' selected' : ''}`,
          'aria-pressed': sh.id === ship?.id ? 'true' : 'false',
          onClick: () => pickShip(sh.id),
        },
          el('img', { src: shipArtSrc(sh.type), alt: '', width: '40', height: '20', class: 'chip-art', loading: 'lazy' }),
          el('span', {}, sh.name),
          // Радиус борта прямо на чипе: «не долетает» и «выбери другой» — это один
          // взгляд сюда, а не пять кликов по планетам.
          el('em', {}, `до ${sh.maxSector ?? '?'} сект. · ${sh.durability}%`))))
    : null;

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

  const planner = el('div', { class: 'flight-plan' },
    shipArt(ship?.type || 'scout'),
    el('div', { class: 'screen-title' },
      el('h2', {}, 'Куда летим'),
      el('span', { class: 'badge' }, actives.length ? `${actives.length} в пути · ${idle.length} свободных` : 'Экспедиция')),
    picker,
    grid,
    detail,
    el('div', { class: 'choices kinds' }, ...['short', 'medium', 'long'].map((k) => {
      const o = selected?.options.find((x) => x.kind === k);
      return el('button', { type: 'button', class: k === kind ? '' : 'ghost', onClick: () => { window.__kind = k; render(); } },
        el('img', { src: `/icons/ui/route_${k}.png`, alt: '', width: '20', height: '20', class: 'icon-sm', loading: 'lazy' }),
        o ? o.label : k);
    })),
    tooFar ? el('p', { class: 'error' },
      selected.lock || 'Выбранный корабль сюда не долетит') : null,
    tooFar && betterShip ? el('button', {
      type: 'button', class: 'ghost', onClick: () => pickShip(betterShip.id),
    }, `Взять ${betterShip.name} — он долетает`) : null,
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
    }, tooFar ? 'Не долетит' : idle.length > 1 ? `Старт · ${ship?.name || ''}` : 'Старт'),
    ship && ship.durability > 0 && ship.durability <= 70 ? el('p', { class: 'error' }, 'Прочность низкая. Ниже 50% ремонт закрыт: нет alloy_plate.') : null,
    !idle.length ? el('p', { class: 'muted' }, 'Свободных кораблей нет: все борта в рейсе или требуют ремонта. Дождитесь возвращения — и можно лететь дальше.') : null,
    idle.length > 1 ? el('p', { class: 'muted' }, `Свободных бортов: ${idle.length}. Каждый может лететь своей планетой одновременно с остальными.`) : null,
  );

  return el('div', {},
    actives.length ? el('div', { class: 'flight-live' }, ...actives.map((x) => expeditionCard(x))) : null,
    planner,
    note ? el('p', { class: note.startsWith('Ошибка') ? 'error' : 'ok' }, note) : null,
    last?.reward ? rewardBlock(last.reward, 'Прошлый результат уже начислен') : null,
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

/**
 * Борта звена в воздухе. Их несколько — до `slots` сразу, и каждый тащит свою
 * закладку. Сдаётся всё одной кнопкой: гонять игрока по карточкам незачем.
 */
function planePatrolBlock() {
  const p = state.planes;
  const list = p.active || (p.patrol ? [p.patrol] : []);
  if (!list.length) return null;
  const readyCount = list.filter((x) => x.ready).length;
  return el('div', { class: `block plane-patrol${readyCount ? ' is-ready' : ''}` },
    el('div', { class: 'plane-patrol-head' },
      el('h3', {}, 'Звено в воздухе',
        el('span', { class: 'badge' }, `${list.length}/${p.slots || 1}`)),
      readyCount
        ? el('button', {
          type: 'button',
          class: 'primary',
          disabled: state.frozen ? '' : null,
          onClick: () => doClaimPatrol(),
        }, `Забрать ${readyCount > 1 ? `${readyCount} борта` : 'находку'}`)
        : null),
    el('div', { class: 'plane-patrol-list' }, ...list.map((patrol) => {
      const chance = Math.round(patrol.findChance * 1000) / 10;
      return el('div', { class: `plane-patrol-row${patrol.ready ? ' is-ready' : ''}` },
        el('span', { class: 'plane-patrol-sky' },
          el('img', { src: patrol.sprite, alt: '', width: '48', height: '48', class: 'plane-patrol-art', loading: 'lazy' })),
        el('div', { class: 'plane-patrol-info' },
          el('p', { class: 'plane-patrol-name' }, patrol.name,
            el('span', { class: 'badge' }, patrol.rarityName || patrol.rarity)),
          el('p', { class: 'muted' }, `Закладка: ${patrol.salvageText || 'ресурсы'} · опыт ${patrol.xp} · находка новой машины ${chance} %`),
          // Когда борт вернулся, таймер не показываем: updateTimers переписал бы
          // его в «Вернётся через 0:00» и оставил нули висеть до перерисовки.
          patrol.ready
            ? el('p', { class: 'ok' }, 'Вернулась — заберите добычу')
            : el('p', {
              class: 'muted',
              'data-until': patrol.endsAt,
              'data-prefix': 'Вернётся через ',
            }, '')),
        el('span', { class: 'plane-timer', 'data-patrol-ready': '1', 'data-until': patrol.endsAt }));
    })));
}

function planeShelf() {
  const p = state.planes;
  if (!p || !p.models) return null;
  const slots = p.slots || 1;
  // Полка собрана — и это надо сказать честно: патруль по-прежнему приносит
  // закладку, но искать ему больше нечего.
  const complete = p.total > 0 && (p.found || 0) >= p.total;
  const free = p.freeSlots != null ? p.freeSlots : Math.max(0, slots - (p.flying || 0));
  const cells = p.models.map((m) => {
    const chance = Math.round(m.findChance * 1000) / 10;
    const busy = !!m.flying;
    const blocked = state.frozen || busy || free <= 0;
    const label = busy ? 'В патруле'
      : free <= 0 ? 'Слотов нет'
        : `В патруль · ${fmtDuration(m.patrolMs)}`;
    return el('div', {
      class: `plane-slot rarity-${m.rarity || 'common'}${m.count ? ' is-found' : ' is-locked'}${busy ? ' is-flying' : ''}`,
    },
      el('img', {
        src: m.sprite || `/sprites/planes/${m.id}.png`,
        alt: '', width: '72', height: '72', class: 'plane-art', loading: 'lazy',
      }),
      el('span', { class: 'plane-name' }, m.count ? m.name : '???'),
      el('span', { class: 'plane-meta' },
        m.count
          ? `${m.rarityName || m.rarity}${m.count > 1 ? ` ×${m.count}` : ''} · находка новой ${chance} %`
          : m.hint),
      m.count
        ? el('span', { class: 'plane-salvage' },
            `+${m.salvageText || 'ресурсы'} · ${m.xp} опыта`)
        : null,
      m.count
        ? el('button', {
          type: 'button',
          class: 'ghost plane-fly-btn',
          disabled: blocked ? '' : null,
          onClick: () => doStartPatrol(m.id),
        }, label)
        : null);
  });
  return el('div', { class: 'block plane-block' },
    el('h3', {}, 'Авиазвено',
      el('span', { class: 'badge' }, `${p.found}/${p.total}`),
      el('span', { class: 'badge' }, `слоты ${(p.flying || 0)}/${slots}`),
      patrolCountBadge(p)),
    el('p', { class: 'muted' },
      `Машины из боксов. Свободный борт выходит в патруль и возвращается с закладкой ресурсов и опыта; шанса на ASTRA нет — валюту дают рейсы. В воздухе до ${slots} бортов, ячейки под корабли звено не занимает.`),
    el('p', { class: 'muted' },
      'Повторных машин боксы и патрули не выдают: приходит только та модель, которой у вас ещё нет.'),
    complete
      ? el('p', { class: 'ok' },
          'Звено собрано целиком: патрули по-прежнему приносят закладку и опыт, но находить больше нечего.')
      : null,
    planePatrolBlock(),
    el('div', { class: 'plane-grid' }, ...cells));
}

function garagePanel() {
  const g = state.garage;
  if (!g) return null;
  const cells = [];
  for (let i = 0; i < g.slots; i += 1) {
    const ship = state.ships[i];
    if (!ship) {
      cells.push(el('div', { class: 'garage-slot' },
        el('div', { class: 'garage-cell' }),
        el('span', { class: 'garage-label' }, 'свободно')));
      continue;
    }
    const mods = shipMods(ship.id);
    const hurt = ship.durability < 50;
    cells.push(el('div', { class: `garage-slot is-filled${hurt ? ' is-hurt' : ''}` },
      el('div', { class: 'garage-cell' },
        el('img', {
          src: shipArtSrc(ship.type), alt: ship.name,
          width: '72', height: '36', class: 'garage-ship', loading: 'lazy',
        }),
        // Полоса модулей прямо в ячейке: видно, что в корабле вложено.
        moduleRig(mods, 14),
        el('span', { class: 'garage-dur' }, `${ship.durability}%`)),
      el('span', { class: 'garage-label' }, ship.name),
      el('span', { class: 'garage-sub' }, ship.status === 'flying'
        ? 'в рейсе'
        : (mods ? `модули ${mods.used}/${mods.slots}` : 'на базе'))));
  }
  // Недоступные ячейки показываем призраком: видно, сколько ещё можно купить.
  for (let i = g.slots; i < g.max; i += 1) {
    cells.push(el('div', { class: 'garage-slot is-locked' },
      el('div', { class: 'garage-cell' }),
      el('span', { class: 'garage-label' }, 'закрыто')));
  }
  // Цены ячеек растут: и за каждую следующую, и с уровнем. Показываем всю
  // лестницу сразу — иначе «ещё одна за 200» выглядит обещанием, а не ценой.
  const ladder = (g.nextPrices || []).slice(1);
  return el('div', { class: 'block garage-block' },
    el('h3', {}, 'Гараж',
      el('span', { class: 'badge' }, `${g.used}/${g.slots}`),
      g.premiumBonus ? el('span', { class: 'badge' }, '+1 Premium') : null),
    el('p', { class: 'muted' },
      `Ячеек ${g.slots} из ${g.max}. Свободно: ${g.free}. Купить корабль можно только при свободной ячейке.`),
    el('div', { class: 'garage-grid' }, ...cells),
    g.canBuy
      ? el('div', { class: 'garage-buy' },
        el('button', {
          type: 'button', disabled: state.frozen || state.balances.astra < g.price ? '' : null,
          onClick: doBuySlot,
        },
        el('img', { src: '/icons/ui/garage.png', alt: '', width: '18', height: '18', class: 'icon-sm' }),
        `Ещё ячейка за ${astraNum(g.price)} ASTRA`),
        el('p', { class: 'muted garage-ladder' },
          `Каждая следующая дороже: ${ladder.length ? ladder.map((p) => astraNum(p)).join(' → ') : 'потолок'}`
          + ` · надбавка за уровень ${g.level} уже в цене`))
      : el('p', { class: 'muted' }, `Больше ${g.max} ячеек не бывает.`),
  );
}

function doBuySlot() { return act('garage-slot', '/garage/buy', {}); }

function renderFleet() {
  const owned = state.ships.map((s) => el('div', { class: 'block' },
    shipArt(s.type),
    // Рядом с кораблём — его слоты: сколько занято и чем. Это и есть ответ на
    // «модули должны быть заметны»: накачанный корпус выглядит иначе пустого.
    el('p', { class: 'rig-summary' }, (() => {
      const mods = shipMods(s.id);
      if (!mods) return '';
      return mods.used
        ? `слоты ${mods.used}/${mods.slots} · ${mods.modules.map((m) => `${m.name} L${m.level}`).join(', ')}`
        : `слоты ${mods.used}/${mods.slots} · пусто`;
    })()),
    moduleRig(shipMods(s.id), 22),
    el('h3', {}, `${s.name} · ${s.durability}%`),
    // Дальность прямо в карточке: без неё «странная дальность» лечится только
    // тыканьем в планеты, а игрок должен видеть радиус борта до вылета.
    el('p', { class: 'muted' }, `${s.status === 'flying' ? 'В рейсе' : 'На базе'} · до ${s.maxSector ?? '?'} сект.`),
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
    // Корабль без цены собирается из чертежа: у него своя готовность — не
    // «много ASTRA», а «чертёж в трюме». Числом показываем, сколько уже есть.
    const plans = c.blueprint ? (c.blueprintCount ?? 0) : 0;
    const needsPlans = c.blueprint != null && c.price == null;
    const shortPlans = needsPlans && plans < 1;
    const label = needsPlans
      ? shortPlans
        ? `Нужен чертёж: «Чертёж Flagship» в «Крафте» (есть ${plans} из 1)`
        : `Собрать из чертежа (${plans} из 1)`
      : tooLow ? `Нужен уровень ${c.unlockLevel}`
        : noMoney ? `Не хватает ${astraNum(c.price - state.balances.astra)} ASTRA`
          : garageFull ? 'Гараж полон: купите ячейку'
            : `Купить за ${astraNum(c.price)} ASTRA`;
    const blocked = state.frozen || tooLow || garageFull || (needsPlans ? shortPlans : noMoney);
    return el('div', { class: `block${blocked && !shortPlans ? ' locked' : ''}` },
      el('img', {
        src: `/sprites/ships/${c.type}.png`, alt: '', width: '96', height: '48', class: 'sprite-thumb', loading: 'lazy',
      }),
      el('h3', {},
        tooLow ? el('img', { src: '/icons/ui/lock.png', alt: '', width: '14', height: '14', class: 'icon-xs', loading: 'lazy' }) : null,
        ` ${c.name}`),
      el('p', { class: 'muted' },
        // Дальность — то, ради чего вообще смотрят в конец списка верфи: без неё
        // выбор корабля превращается в угадывание.
        `Груз ${c.cargo} · бак ${c.tank} · добыча ×${c.mining} · до ${c.maxSector ?? '?'} сект. · уровень ${c.unlockLevel}`),
      el('button', {
        type: 'button',
        disabled: blocked ? '' : null,
        onClick: () => doBuyShip(c.type),
      },
      !needsPlans && c.price != null && !tooLow
        ? el('img', { src: '/icons/ui/buy.png', alt: '', width: '18', height: '18', class: 'btn-ico', loading: 'lazy' }) : null,
      label),
      // Кнопка прямо в верфи: чертёж — тот же крафт, и ходить за ним в другой
      // раздел, где его ещё надо найти в списке, лишняя работа.
      needsPlans && shortPlans
        ? el('button', { type: 'button', class: 'ghost', onClick: () => setView('craft') }, 'К чертежу в «Крафт»')
        : null,
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
      hint: 'Редкие ресурсы секторов 2–5: гелий-3, титан, кристалл, астралит, пустотный кристалл, квантовая пыль. Идут в модули с 4-го уровня — и в чертежи кораблей верфи.',
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

/** Пять делений — по одному на уровень модуля: прогресс виден без цифр. */
function levelDots(level, max) {
  const dots = [];
  for (let i = 1; i <= (max || 5); i += 1) dots.push(el('i', { class: level >= i ? 'on' : null }));
  return el('span', { class: 'lv-dots' }, ...dots);
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
      el('h3', {}, entry.name, level ? el('span', { class: 'badge' }, `L${level}`) : null,
        levelDots(level, entry.maxLevel)),
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
        alt: mod ? mod.name : 'свободный слот', width: '64', height: '64', class: 'slot-art', loading: 'lazy',
      }),
      el('span', { class: 'slot-label' }, mod ? `${mod.name} L${mod.level}` : 'пусто'),
      el('span', { class: 'slot-effect' }, mod ? mod.effectText : `слот ${i + 1} свободен`)));
  }
  // Корпус показан так же, как в гараже и во флоте: полоса слотов над силуэтом.
  const rig = el('div', { class: 'module-rig' },
    el('img', {
      src: shipArtSrc(ship.type), alt: ship.name, width: '192', height: '96', class: 'module-ship', loading: 'lazy',
    }),
    moduleRig(ship, 20));

  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Модули'), el('span', { class: 'badge' }, `до L${m.maxLevel}`)),
    el('p', { class: 'muted' }, 'Модуль ставится на конкретный корабль и занимает его слот. Снять нельзя — только улучшить: вложенные ASTRA не возвращаются. У больших корпусов слотов больше, а два модуля одного эффекта складываются: движок и навигатор режут длительность вдвоём.'),
    el('p', { class: 'muted' }, `Каталог: ${m.catalog.length} модулей, у этого корпуса ${ship.slots} слота(ов). Прокачка даёт опыт.`),
    el('div', { class: 'ship-tabs' }, ...tabs),
    el('div', { class: 'block' },
      el('h3', {}, ship.name, el('span', { class: 'badge' }, `слоты ${ship.used}/${ship.slots}`)),
      rig,
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
  // Список обязано быть массивом: ответ 200 без `boxes` ронял весь экран на
  // `data.boxes.some`, и раздел оставался пустым до перезагрузки страницы.
  if (status === 200 && Array.isArray(data?.boxes)) boxData = data;
  else if (status === 200) note = 'Ошибка: сервер вернул боксы без списка — попробуйте обновить раздел';
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
        disabled: claimLeft > 0 || state.frozen || (bonusGateOn() && !bonusToken) ? '' : null,
        onClick: doClaim,
      }, 'Забрать бонус'),
      el('div', { 'data-gate-slot': '' }, claimLeft > 0 ? null : bonusGateBlock()),
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
          el('li', {}, 'Перед выдачей бонуса игра просит подтвердить, что ты человек: Cloudflare Turnstile, токен одноразовый.'),
          el('li', {}, 'Опыт капает за Claim, рейсы, миссии, боксы, крафт и каждый уровень модуля; уровень открывает сектора и верфь.'),
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
  if (arenaLoading) return;
  arenaLoading = true;
  try {
    const res = await authed('/minigame');
    if (res.status === 200) { arenaData = res.data; arenaError = ''; }
    else arenaError = ERRORS[res.data?.error] || 'Не удалось загрузить арену';
  } finally {
    arenaLoading = false;
  }
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
    if (!arenaLoading && !arenaError) loadArena();
    return el('div', { class: 'screen' },
      el('p', { class: 'muted' }, arenaError ? 'Арена сейчас не отвечает.' : 'Загружаем арену…'),
      arenaError ? el('p', { class: 'error' }, arenaError) : null,
      arenaError ? el('button', {
        type: 'button', class: 'ghost',
        onClick: () => { arenaError = ''; loadArena(); },
      }, 'Повторить') : null);
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

// ── Аркада: десять мини-игр (этап 18) ───────────────────────────────────────
//
// Общее правило для всех десяти: браузер рисует и собирает ввод, а счёт считает
// сервер. Поэтому сюда из /arcade-sim.js (тот же код, что в воркере) приходят
// только поля и правила — «я набрал 600 очков» на сервер не отправляется.
// Отправка одна: трасса/списки ходов в /arcade/finish.

const ARCADE_W = 1000;
const ARCADE_H = 620;
const ARCADE_SAMPLE_MS = 40;

/** Как игра снимает ввод: `axis` — позиция по сетке, `dirs`/`moves` — списки, `dom` — поле кнопками. */
const ARCADE_INPUT = {
  maze: 'keys', sudoku: 'dom', memory: 'dom', sequence: 'dom', reaction: 'pointer',
  runner: 'axis-y', breakout: 'axis-x', snake: 'dirs', aim: 'shots', catch: 'axis-x',
};

/** Спрайты, нужные игре. Список — источник истины для предзагрузки. */
const ARCADE_SPRITES = {
  common: ['/sprites/bg/arcade.png'],
  maze: ['/sprites/arcade/wall.png', '/sprites/arcade/exit.png', '/sprites/arcade/cell.png'],
  sudoku: ['/sprites/arcade/cell.png'],
  memory: ['/sprites/arcade/card_back.png', '/sprites/arcade/card_open.png', '/sprites/arcade/gem.png',
    '/sprites/arcade/food.png', '/sprites/arcade/crate.png', '/sprites/arcade/rock.png',
    '/sprites/arcade/debris.png', '/sprites/arcade/brick.png', '/sprites/arcade/ball.png',
    '/sprites/arcade/target.png', '/sprites/arcade/drone.png', '/sprites/arcade/node_1.png'],
  sequence: ['/sprites/arcade/node_1.png', '/sprites/arcade/node_2.png', '/sprites/arcade/node_3.png', '/sprites/arcade/node_4.png'],
  reaction: ['/sprites/arcade/beacon.png'],
  runner: ['/sprites/arcade/rock.png', '/sprites/arcade/drone.png', '/sprites/arcade/gem.png', '/sprites/arcade/runner_hero.png'],
  breakout: ['/sprites/arcade/ball.png', '/sprites/arcade/brick.png', '/sprites/arcade/paddle.png'],
  snake: ['/sprites/arcade/snake_head.png', '/sprites/arcade/snake_body.png', '/sprites/arcade/food.png'],
  aim: ['/sprites/arcade/target.png'],
  catch: ['/sprites/arcade/hook.png', '/sprites/arcade/crate.png', '/sprites/arcade/debris.png'],
};

let arcadeData = null;
let arcadeGameId = null;
let arcadeRun = null;
let arcadeResult = null;
let arcadeRaf = 0;
let arcadeSimPromise = null;
// Одна попытка загрузки на экран: без флага ошибка ответа превращалась бы в цикл
// «render → loadArcade → ошибка → render», который долбит сервер без паузы.
let arcadeLoading = false;
let arcadeError = '';
let arcadeArt = null;
let arcadeArtKey = '';
let arcadeArtPromise = null;
const arcadeKeys = { up: false, right: false, down: false, left: false };

function arcadeSim() {
  // Тот же модуль, что считает на сервере: грузим один раз.
  if (!arcadeSimPromise) arcadeSimPromise = import('/arcade-sim.js');
  return arcadeSimPromise;
}

function arcadeGame(id) {
  return arcadeData?.games.find((g) => g.id === id) ?? null;
}

function arcadeAssets(id) {
  const key = `${id}`;
  const files = [...(ARCADE_SPRITES.common ?? []), ...(ARCADE_SPRITES[id] ?? [])];
  if (arcadeArtPromise && arcadeArtKey === key) return arcadeArtPromise;
  arcadeArtKey = key;
  const load = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  arcadeArtPromise = Promise.all(files.map(load)).then((images) => {
    const byName = {};
    images.forEach((img, i) => { if (img) byName[files[i]] = img; });
    arcadeArt = byName;
    return byName;
  });
  return arcadeArtPromise;
}

const artOf = (src) => arcadeArt?.[src] ?? null;

async function loadArcade() {
  if (arcadeLoading) return;
  arcadeLoading = true;
  try {
    const res = await authed('/arcade');
    if (res.status === 200) { arcadeData = res.data; arcadeError = ''; }
    else arcadeError = ERRORS[res.data?.error] || 'Не удалось загрузить аркаду';
  } finally {
    arcadeLoading = false;
  }
  if (view === 'arcade') render();
}

function arcadeStopLoop() {
  if (arcadeRaf) cancelAnimationFrame(arcadeRaf);
  arcadeRaf = 0;
}

/** Осталось до конца раунда: по серверному времени, а не по часам телефона. */
function arcadeLeft() {
  if (!arcadeRun) return 0;
  return Math.max(0, arcadeRun.endsAt - (Date.now() + serverOffset));
}

async function arcadeOpen(id) {
  arcadeGameId = id;
  arcadeResult = null;
  arcadeStopLoop();
  arcadeRun = null;
  render();
}

async function arcadeStartRun() {
  if (!arcadeGameId || !arcadeData) return;
  const scope = `arcade-run:${arcadeGameId}:${Date.now()}`;
  const res = await authed('/arcade/start', {
    method: 'POST',
    headers: { 'Idempotency-Key': idemKey(scope) },
    body: { game: arcadeGameId },
  });
  if (res.status !== 200) {
    arcadeResult = { error: res.data?.error || 'internal' };
    idemDone(scope);
    render();
    return;
  }
  idemDone(scope);
  const d = res.data;
  arcadeResult = null;
  arcadeRun = {
    runId: d.runId,
    game: d.game,
    seed: d.seed >>> 0,
    runMs: d.runMs,
    endsAt: d.endsAt,
    startedAt: Date.now() + serverOffset,
    t0: Date.now() + serverOffset,
    axis: [], dirs: [], moves: [], taps: [], shots: [], presses: [],
    answers: new Array(81).fill(0),
    nextSampleAt: 0,
    finished: false,
    // Локальное состояние поля: только для отрисовки.
    st: { x: 500, targetX: 500, dir: 1, cells: [], reveal: -1, seqStep: 0, flash: 0, sel: -1, booms: [] },
  };
  await arcadeAssets(d.game);
  const sim = await arcadeSim();
  await arcadePrepare(sim);
  render();
}

/** Разминка состояния: поле/колода/раскладка строятся из зерна тем же кодом, что и на сервере. */
async function arcadePrepare(sim) {
  const run = arcadeRun;
  if (!run) return;
  const id = run.game;
  if (id === 'maze') {
    run.st.grid = sim.makeMaze(run.seed);
    run.st.cursor = 0;
    run.st.cols = run.st.grid.cols;
    run.st.rows = run.st.grid.rows;
  } else if (id === 'sudoku') {
    const p = sim.makeSudoku(run.seed);
    run.st.givens = p.grid;
    run.st.solution = p.solution;
    run.answers = p.grid.slice();
  } else if (id === 'memory') {
    run.st.deck = sim.makeMemoryDeck(run.seed);
    run.st.opened = [];
    run.st.solved = new Array(run.st.deck.length).fill(false);
  } else if (id === 'sequence') {
    run.st.want = sim.makeSequence(run.seed);
    run.st.showing = true;
    run.st.pos = 0;
    arcadeSequenceShow();
  } else if (id === 'reaction') {
    run.st.targets = sim.makeReactionTargets(run.seed);
    run.st.duration = sim.reactionDuration(run.st.targets);
    run.runMs = run.st.duration;
  } else if (id === 'runner') {
    run.st.track = sim.makeRunnerTrack(run.seed);
  } else if (id === 'breakout') {
    run.st.state = sim.makeBreakoutState(run.seed);
  } else if (id === 'snake') {
    run.st.state = sim.makeSnakeState(run.seed);
    run.st.cell = sim.SNAKE_CELL;
    run.st.cols = sim.SNAKE_COLS;
    run.st.rows = sim.SNAKE_ROWS;
  } else if (id === 'aim') {
    run.st.targets = sim.makeAimTargets(run.seed);
  } else if (id === 'catch') {
    run.st.field = sim.makeCatchField(run.seed);
  }
}

function arcadeSequenceShow() {
  const run = arcadeRun;
  if (!run || run.finished || run.game !== 'sequence') return;
  const want = run.st.want;
  // Показываем уровень: 3 + уже пройденные сигналы.
  const len = Math.min(want.length, simLevelLength(run));
  let i = 0;
  run.st.showing = true;
  const tick = () => {
    if (!arcadeRun || arcadeRun.finished) return;
    if (i >= len) {
      arcadeRun.st.showing = false;
      arcadeRun.st.flash = 0;
      arcadeRefreshBoard();
      return;
    }
    arcadeRun.st.flash = want[i] + 1;
    arcadeRefreshBoard();
    setTimeout(() => {
      if (!arcadeRun) return;
      arcadeRun.st.flash = 0;
      arcadeRefreshBoard();
      i += 1;
      setTimeout(tick, 160);
    }, 460);
  };
  setTimeout(tick, 400);
}

function simLevelLength(run) {
  const solved = run.st.level ?? 0;
  return 3 + solved;
}

/** Перерисовка только DOM-полей (судоку, пары, цепь): canvas живёт своим циклом. */
function arcadeRefreshBoard() {
  if (!arcadeRun || !['sudoku', 'memory', 'sequence'].includes(arcadeRun.game)) return;
  const host = document.getElementById('arcade-board');
  if (!host) return;
  host.replaceChildren(arcadeBoardInner(arcadeRun.game));
}

async function arcadeSubmit(extra = {}) {
  const run = arcadeRun;
  if (!run || run.finished) return;
  run.finished = true;
  arcadeStopLoop();
  arcadePadTrace(run);
  const body = { runId: run.runId, ...extra };
  const mode = ARCADE_INPUT[run.game];
  if (mode === 'axis-x' || mode === 'axis-y') {
    body.axis = run.axis;
    body.stepMs = ARCADE_SAMPLE_MS;
  } else if (mode === 'dirs') body.dirs = run.dirs;
  else if (mode === 'shots') body.shots = run.shots;
  else if (mode === 'keys') body.moves = run.moves;
  else if (mode === 'pointer') body.taps = run.taps;
  if (run.game === 'sudoku') body.answers = run.answers;
  if (run.game === 'memory') body.moves = run.moves;
  if (run.game === 'sequence') body.presses = run.presses;
  const scope = `arcade-finish:${run.runId}`;
  const res = await authed('/arcade/finish', {
    method: 'POST',
    headers: { 'Idempotency-Key': idemKey(scope) },
    body,
  });
  if (res.status === 200) idemDone(scope);
  arcadeResult = res.status === 200 ? res.data : { error: res.data?.error || 'bad_trace' };
  if (res.status === 200) sfx(res.data?.result?.win ? 'win' : 'lose');
  arcadeRun = null;
  render();
  // Данные раздела не обнуляем: карточка результата должна остаться на экране,
  // а свежий счётчик попыток принесёт loadArcade.
  await loadArcade();
  await loadGame();
}

// ── Цикл canvas-игр ─────────────────────────────────────────────────────────

function arcadeMount() {
  const canvas = document.getElementById('arcade-canvas');
  if (canvas) {
    arcadeDrawFrame(canvas, 0);
    if (!arcadeRun || arcadeRun.finished) return;
  }
  if (!arcadeRun || arcadeRun.finished) return;
  arcadeStopLoop();
  const step = () => {
    if (!arcadeRun || arcadeRun.finished) return;
    const node = document.getElementById('arcade-canvas');
    if (node) arcadeFrame(node);
    arcadeRaf = requestAnimationFrame(step);
  };
  arcadeRaf = requestAnimationFrame(step);
}

/** Один шаг: снимает трассу, двигает локальную симуляцию и рисует. */
function arcadeFrame(canvas) {
  const run = arcadeRun;
  if (!run) return;
  const t = Math.min(run.runMs, Date.now() + serverOffset - run.t0);
  const mode = ARCADE_INPUT[run.game];
  const dt = Math.max(0, Math.min(120, t - (run.st.lastT ?? t)));
  run.st.lastT = t;
  if (mode === 'axis-x') arcadeSteer(run, dt, run.game === 'breakout' ? 1100 : 900);
  if (mode === 'axis-x' || mode === 'axis-y') {
    while (run.nextSampleAt <= t) {
      const value = run.game === 'runner' ? (run.st.jumpY ?? 0) : run.st.x;
      run.axis.push(Math.round(value * 10));
      run.nextSampleAt += ARCADE_SAMPLE_MS;
    }
  } else if (mode === 'dirs') {
    while (run.nextSampleAt <= t) {
      run.dirs.push(run.st.dir);
      run.st.step = (run.st.step ?? 0) + 1;
      run.nextSampleAt += run.game === 'snake' ? 150 : ARCADE_SAMPLE_MS;
    }
  }
  if (run.game === 'runner') arcadeRunnerPhysics(run, t);
  if (run.game === 'snake') arcadeSnakeAdvance(run);
  if (run.game === 'breakout') arcadeBreakoutAdvance(run, t);
  arcadeDrawFrame(canvas, t);
  const timeEl = document.querySelector('[data-arcade-time]');
  if (timeEl) timeEl.textContent = fmtLeft(Math.max(0, run.runMs - t));
  const scoreEl = document.querySelector('[data-arcade-score]');
  if (scoreEl) scoreEl.textContent = String(arcadeLiveScore(run));
  if (t >= run.runMs) arcadeFinishRun();
  else if (arcadeLeft() <= 0) arcadeSubmit({});
}

/**
 * Добивка сетки: сервер сверяет трассу с длиной раунда, а вкладка могла
 * притормозить. Хвост повторяет последнюю позицию — то есть «игрок стоял»,
 * что и есть правда для замершего кадра.
 */
function arcadePadTrace(run) {
  const mode = ARCADE_INPUT[run.game];
  if (mode === 'axis-x' || mode === 'axis-y') {
    const need = Math.ceil(run.runMs / ARCADE_SAMPLE_MS) + 1;
    const last = run.axis.length ? run.axis[run.axis.length - 1] : 0;
    while (run.axis.length < need) run.axis.push(last);
  } else if (mode === 'dirs') {
    const need = Math.ceil(run.runMs / 150) + 1;
    const last = run.dirs.length ? run.dirs[run.dirs.length - 1] : run.st.dir;
    while (run.dirs.length < need) run.dirs.push(last);
  }
}

/** Авто-финиш: у таймера и у сервера один ориентир — конец раунда. */
function arcadeFinishRun() {
  if (!arcadeRun || arcadeRun.finished) return;
  arcadeSubmit({});
}

/** Платформа и крюк едут за пальцем, но не быстрее физического предела. */
function arcadeSteer(run, dt, maxSpeed) {
  const target = run.st.targetX ?? run.st.x;
  const step = (maxSpeed * dt) / 1000;
  const dx = target - run.st.x;
  run.st.x = Math.max(0, Math.min(ARCADE_W, run.st.x + Math.max(-step, Math.min(step, dx))));
}

function arcadeLiveScore(run) {
  const st = run.st;
  if (run.game === 'maze') return String(st.cursor === (st.grid ? st.grid.cols * st.grid.rows - 1 : -1) ? 'выход!' : `шагов: ${run.moves.length}`);
  if (run.game === 'memory') return `пары: ${(st.openedCount ?? 0)}`;
  if (run.game === 'sudoku') return `верно: ${st.checked ?? 0}`;
  if (run.game === 'sequence') return `уровень: ${st.level ?? 0}`;
  if (run.game === 'reaction') return `попаданий: ${st.hits ?? 0}`;
  if (run.game === 'runner') return `чисто: ${st.passed ?? 0} · пробоин: ${st.crashes ?? 0}`;
  if (run.game === 'breakout') return `щит: ${st.state?.destroyed ?? 0} · жизни: ${st.state?.lives ?? 3}`;
  if (run.game === 'snake') return `фракции: ${st.state?.eaten ?? 0}`;
  if (run.game === 'aim') return `попаданий: ${st.hits ?? 0}`;
  if (run.game === 'catch') return `груз: ${st.picked ?? 0}`;
  return '';
}

// ── Локальная физика (только для картинки: решение всё равно за сервером) ───

function arcadeRunnerPhysics(run, t) {
  const st = run.st;
  if (st.jumpAt == null) { st.jumpY = 0; return; }
  const p = (t - st.jumpAt) / 1000;
  const g = 2400;
  const v0 = 900;
  const y = v0 * p - (g * p * p) / 2;
  if (y <= 0 || p > 0.8) {
    st.jumpY = 0;
    st.jumpAt = null;
  } else {
    st.jumpY = y;
  }
}

function arcadeSnakeAdvance(run) {
  const st = run.st;
  const step = Math.floor(((Date.now() + serverOffset) - run.t0) / 150);
  if (st.advanced === step) return;
  st.advanced = step;
  const sim = arcadeSimRef;
  if (!sim || !st.state) return;
  st.state = sim.stepSnake(st.state, run.st.dir, run.seed);
  if (st.state.food >= 0) arcadeSnakeAdvance.noop = true;
  if (st.state.dead) arcadeSubmit({});
}

let arcadeSimRef = null;
arcadeSim().then((m) => { arcadeSimRef = m; }).catch(() => { /* модуль догрузится на следующем шаге */ });

function arcadeBreakoutAdvance(run, t) {
  const sim = arcadeSimRef;
  const st = run.st;
  if (!sim || !st.state) return;
  const last = st.lastT ?? run.t0;
  const dt = Math.max(0, Math.min(120, t - last));
  st.lastT = t;
  if (!st.state.over) sim.stepBreakout(st.state, dt, run.st.x);
  if (st.state.over) arcadeSubmit({});
}

// ── Отрисовка ────────────────────────────────────────────────────────────────

function arcadeDrawFrame(canvas, t) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const run = arcadeRun;
  ctx.clearRect(0, 0, ARCADE_W, ARCADE_H);
  const bg = artOf('/sprites/bg/arcade.png');
  if (bg) ctx.drawImage(bg, 0, 0, ARCADE_W, ARCADE_H);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, ARCADE_H);
    g.addColorStop(0, '#081026');
    g.addColorStop(1, '#050a15');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ARCADE_W, ARCADE_H);
  }
  if (!run) return;
  const game = run.game;
  if (game === 'maze') arcadeDrawMaze(ctx, run);
  else if (game === 'reaction') arcadeDrawReaction(ctx, run, t);
  else if (game === 'runner') arcadeDrawRunner(ctx, run, t);
  else if (game === 'breakout') arcadeDrawBreakout(ctx, run);
  else if (game === 'snake') arcadeDrawSnake(ctx, run);
  else if (game === 'aim') arcadeDrawAim(ctx, run, t);
  else if (game === 'catch') arcadeDrawCatch(ctx, run, t);
}

function arcadeDrawMaze(ctx, run) {
  const g = run.st.grid;
  if (!g) return;
  const cw = Math.floor(ARCADE_W / (g.cols + 1));
  const ch = Math.floor(ARCADE_H / (g.rows + 1));
  const size = Math.min(cw, ch);
  const ox = (ARCADE_W - size * g.cols) / 2;
  const oy = (ARCADE_H - size * g.rows) / 2;
  const wall = artOf('/sprites/arcade/wall.png');
  const cellArt = artOf('/sprites/arcade/cell.png');
  const exit = artOf('/sprites/arcade/exit.png');
  for (let i = 0; i < g.mask.length; i += 1) {
    const x = i % g.cols;
    const y = Math.floor(i / g.cols);
    const px = ox + x * size;
    const py = oy + y * size;
    if (cellArt) ctx.drawImage(cellArt, px, py, size, size);
    ctx.strokeStyle = '#7fa8ff';
    ctx.lineWidth = 3;
    const m = g.mask[i];
    ctx.beginPath();
    if (m & 1) { ctx.moveTo(px, py); ctx.lineTo(px + size, py); }
    if (m & 2) { ctx.moveTo(px + size, py); ctx.lineTo(px + size, py + size); }
    if (m & 4) { ctx.moveTo(px, py + size); ctx.lineTo(px + size, py + size); }
    if (m & 8) { ctx.moveTo(px, py); ctx.lineTo(px, py + size); }
    ctx.stroke();
    if (i === g.mask.length - 1 && exit) ctx.drawImage(exit, px + 4, py + 4, size - 8, size - 8);
    if (wall && (m & 1) === 0 && false) ctx.drawImage(wall, px, py, size, size);
  }
  const cx = run.st.cursor % g.cols;
  const cy = Math.floor(run.st.cursor / g.cols);
  ctx.fillStyle = '#7de2b0';
  ctx.beginPath();
  ctx.arc(ox + cx * size + size / 2, oy + cy * size + size / 2, size * 0.24, 0, Math.PI * 2);
  ctx.fill();
}

function arcadeDrawReaction(ctx, run, t) {
  const targets = run.st.targets ?? [];
  const beacon = artOf('/sprites/arcade/beacon.png');
  for (const target of targets) {
    const active = t >= target.at && t <= target.at + target.window;
    const done = (run.st.done ?? new Set()).has(target.at);
    const size = active ? 150 + Math.sin(t / 60) * 16 : 96;
    ctx.save();
    ctx.globalAlpha = done ? 0.25 : active ? 1 : 0.4;
    const x = ARCADE_W / 2 - size / 2;
    const y = ARCADE_H / 2 - size / 2;
    if (beacon) ctx.drawImage(beacon, x, y, size, size);
    else {
      ctx.fillStyle = active ? '#ffcf6b' : '#3a4a70';
      ctx.beginPath();
      ctx.arc(ARCADE_W / 2, ARCADE_H / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function arcadeDrawRunner(ctx, run, t) {
  const track = run.st.track;
  if (!track) return;
  const ground = ARCADE_H - 90;
  ctx.strokeStyle = 'rgba(140,180,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, ground + 4);
  ctx.lineTo(ARCADE_W, ground + 4);
  ctx.stroke();
  const px = 160;
  for (const e of track.events) {
    const x = px + ((e.t - t) / 1000) * 520;
    if (x < -80 || x > ARCADE_W + 80) continue;
    const src = e.kind === 'rock' ? '/sprites/arcade/rock.png'
      : e.kind === 'drone' ? '/sprites/arcade/drone.png' : '/sprites/arcade/gem.png';
    const img = artOf(src);
    const y = e.kind === 'rock' ? ground - e.y : ground - e.y - 40;
    const size = e.kind === 'gem' ? 48 : 64;
    if (img) ctx.drawImage(img, x - size / 2, y, size, e.kind === 'drone' ? 48 : size);
    else {
      ctx.fillStyle = e.kind === 'rock' ? '#8fa4cf' : e.kind === 'drone' ? '#ff7b7b' : '#66e6ff';
      ctx.fillRect(x - size / 2, y, size, size);
    }
  }
  const hero = artOf('/sprites/arcade/runner_hero.png');
  const y = ground - 76 - (run.st.jumpY ?? 0);
  if (hero) ctx.drawImage(hero, px - 28, y, 56, 76);
  else {
    ctx.fillStyle = '#cfe1ff';
    ctx.fillRect(px - 18, y, 36, 72);
  }
}

function arcadeDrawBreakout(ctx, run) {
  const st = run.st.state;
  if (!st) return;
  const brick = artOf('/sprites/arcade/brick.png');
  for (let i = 0; i < st.bricks.length; i += 1) {
    if (!st.bricks[i]) continue;
    const col = i % 10;
    const row = Math.floor(i / 10);
    const x = 20 + col * 96;
    const y = 90 + row * 36;
    if (brick) ctx.drawImage(brick, x, y, 96, 36);
    else {
      ctx.fillStyle = '#ff9ac4';
      ctx.fillRect(x, y, 94, 34);
    }
  }
  const ball = artOf('/sprites/arcade/ball.png');
  if (ball) ctx.drawImage(ball, st.bx - 12, st.by - 12, 24, 24);
  else {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(st.bx, st.by, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  const pad = artOf('/sprites/arcade/paddle.png');
  if (pad) ctx.drawImage(pad, run.st.x - 66, 560, 132, 22);
  else {
    ctx.fillStyle = '#9fc7ff';
    ctx.fillRect(run.st.x - 62, 560, 124, 20);
  }
}

function arcadeDrawSnake(ctx, run) {
  const st = run.st.state;
  const cell = run.st.cell ?? 40;
  if (!st) return;
  const ox = (ARCADE_W - cell * run.st.cols) / 2;
  const oy = (ARCADE_H - cell * run.st.rows) / 2;
  const head = artOf('/sprites/arcade/snake_head.png');
  const body = artOf('/sprites/arcade/snake_body.png');
  const food = artOf('/sprites/arcade/food.png');
  ctx.strokeStyle = 'rgba(140,180,255,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, cell * run.st.cols, cell * run.st.rows);
  if (st.food >= 0 && food) {
    ctx.drawImage(food, ox + (st.food % run.st.cols) * cell, oy + Math.floor(st.food / run.st.cols) * cell, cell, cell);
  }
  st.body.forEach((idx, i) => {
    const x = ox + (idx % run.st.cols) * cell;
    const y = oy + Math.floor(idx / run.st.cols) * cell;
    const img = i === 0 ? head : body;
    if (img) ctx.drawImage(img, x, y, cell, cell);
    else {
      ctx.fillStyle = i === 0 ? '#7de2b0' : '#57b98c';
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
    }
  });
}

function arcadeDrawAim(ctx, run, t) {
  const targets = run.st.targets ?? [];
  const img = artOf('/sprites/arcade/target.png');
  for (const target of targets) {
    const age = t - target.t;
    if (age < 0 || age > 900) continue;
    const size = target.r * 2 * (1 - age / 3000);
    const alpha = Math.max(0.15, 1 - age / 900);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (img) ctx.drawImage(img, target.x - size / 2, target.y - size / 2, size, size);
    else {
      ctx.strokeStyle = '#ff7b7b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(target.x, target.y, size / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const shot of run.st.recentShots ?? []) {
    if (t - shot.at > 420) continue;
    ctx.strokeStyle = shot.hit ? '#7de2b0' : 'rgba(255,120,120,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(shot.x - 12, shot.y - 12);
    ctx.lineTo(shot.x + 12, shot.y + 12);
    ctx.moveTo(shot.x + 12, shot.y - 12);
    ctx.lineTo(shot.x - 12, shot.y + 12);
    ctx.stroke();
  }
}

function arcadeDrawCatch(ctx, run, t) {
  const field = run.st.field;
  if (!field) return;
  ctx.strokeStyle = 'rgba(143,211,255,0.5)';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 520);
  ctx.lineTo(ARCADE_W, 520);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const item of field.items) {
    const y = 520 - (item.t - t) * 0.42;
    if (y < -60 || y > ARCADE_H + 60) continue;
    const src = item.kind === 'cargo' ? '/sprites/arcade/crate.png' : '/sprites/arcade/debris.png';
    const img = artOf(src);
    const size = item.kind === 'cargo' ? 56 : 64;
    if (img) ctx.drawImage(img, item.x - size / 2, y - size / 2, size, size);
    else {
      ctx.fillStyle = item.kind === 'cargo' ? '#a8845c' : '#8fa4cf';
      ctx.fillRect(item.x - 22, y - 22, 44, 44);
    }
  }
  const hook = artOf('/sprites/arcade/hook.png');
  if (hook) ctx.drawImage(hook, run.st.x - 36, 470, 72, 72);
  else {
    ctx.fillStyle = '#8fd3ff';
    ctx.fillRect(run.st.x - 30, 500, 60, 16);
  }
}

// ── DOM-поля: судоку, пары, сигнальная цепь ─────────────────────────────────

function arcadeBoardInner(id) {
  const run = arcadeRun;
  if (id === 'sudoku') return arcadeSudoku(run);
  if (id === 'memory') return arcadeMemory(run);
  if (id === 'sequence') return arcadeSequence(run);
  return null;
}

function arcadeSudoku(run) {
  const givens = run.st.givens ?? new Array(81).fill(0);
  const cells = [];
  for (let i = 0; i < 81; i += 1) {
    const given = givens[i] !== 0;
    const btn = el('button', {
      type: 'button',
      class: `arcade-cell${given ? ' is-given' : ''}${run.st.sel === i ? ' is-sel' : ''}`,
      disabled: given ? '' : null,
      'aria-label': `Клетка ${Math.floor(i / 9) + 1}-${(i % 9) + 1}`,
      onClick: () => {
        run.st.sel = i;
        arcadeRefreshBoard();
      },
    }, String(run.answers[i] !== 0 ? run.answers[i] : (given ? givens[i] : '')));
    cells.push(btn);
  }
  const pad = [];
  for (let d = 1; d <= 9; d += 1) {
    pad.push(el('button', {
      type: 'button', class: 'ghost arcade-digit',
      onClick: () => {
        if (run.st.sel < 0 || givens[run.st.sel] !== 0) return;
        run.answers[run.st.sel] = d;
        // Живая подсказка «сколько верно»: solution клиента не знает, поэтому
        // считаем только непротиворечивость строки/столбца/блока.
        run.st.checked = run.answers.filter((v, i) => v !== 0 && v === (run.st.solution?.[i] ?? -1)).length;
        arcadeRefreshBoard();
      },
    }, String(d)));
  }
  pad.push(el('button', {
    type: 'button', class: 'ghost arcade-digit',
    onClick: () => {
      if (run.st.sel < 0 || givens[run.st.sel] !== 0) return;
      run.answers[run.st.sel] = 0;
      arcadeRefreshBoard();
    },
  }, 'Стереть'));
  return el('div', { class: 'arcade-sudoku' },
    el('div', { class: 'arcade-grid9' }, ...cells),
    el('div', { class: 'arcade-pad' }, ...pad),
    el('p', { class: 'muted' }, 'Клик по клетке, затем цифра. Сданное поле сверяет сервер: правильная раскладка здесь одна.'));
}

function arcadeMemory(run) {
  const deck = run.st.deck ?? [];
  const faces = ['/sprites/arcade/gem.png', '/sprites/arcade/food.png', '/sprites/arcade/crate.png',
    '/sprites/arcade/rock.png', '/sprites/arcade/debris.png', '/sprites/arcade/brick.png',
    '/sprites/arcade/ball.png', '/sprites/arcade/target.png', '/sprites/arcade/drone.png', '/sprites/arcade/node_1.png'];
  const cards = deck.map((sprite, i) => {
    const open = run.st.opened.includes(i) || run.st.solved[i];
    return el('button', {
      type: 'button',
      class: `arcade-card${open ? ' is-open' : ''}${run.st.solved[i] ? ' is-done' : ''}`,
      'aria-label': `Карта ${(i % 10) + 1}-${Math.floor(i / 10) + 1}`,
      onClick: () => arcadeMemoryPick(run, i),
    }, el('img', {
      src: open ? (faces[sprite] ?? faces[0]) : '/sprites/arcade/card_back.png',
      alt: '', width: '56', height: '56', loading: 'lazy',
    }));
  });
  return el('div', { class: 'arcade-cards' }, ...cards);
}

function arcadeMemoryPick(run, i) {
  if (run.st.solved[i] || run.st.lock) return;
  if (run.st.opened.includes(i)) return;
  run.st.opened.push(i);
  run.moves.push(i);
  sfx('pick');
  if (run.st.opened.length < 2) {
    arcadeRefreshBoard();
    return;
  }
  const [a, b] = run.st.opened;
  run.st.lock = true;
  const match = run.st.deck[a] === run.st.deck[b];
  if (match) {
    run.st.solved[a] = true;
    run.st.solved[b] = true;
    run.st.openedCount = (run.st.openedCount ?? 0) + 1;
    sfx('win');
  }
  setTimeout(() => {
    if (!arcadeRun) return;
    arcadeRun.st.opened = [];
    arcadeRun.st.lock = false;
    const done = arcadeRun.st.solved.every(Boolean);
    arcadeRefreshBoard();
    if (done) arcadeSubmit({});
  }, match ? 240 : 760);
  arcadeRefreshBoard();
}

function arcadeSequence(run) {
  const nodes = [];
  const sprites = ['/sprites/arcade/node_1.png', '/sprites/arcade/node_2.png', '/sprites/arcade/node_3.png', '/sprites/arcade/node_4.png'];
  for (let i = 0; i < 4; i += 1) {
    nodes.push(el('button', {
      type: 'button',
      class: `arcade-node${run.st.flash === i + 1 ? ' is-flash' : ''}`,
      'aria-label': `Узел ${i + 1}`,
      disabled: run.st.showing ? '' : null,
      onClick: () => arcadeSequencePress(run, i),
    }, el('img', { src: sprites[i], alt: '', width: '72', height: '72', loading: 'lazy' })));
  }
  return el('div', { class: 'arcade-sequence' },
    el('div', { class: 'arcade-nodes' }, ...nodes),
    el('p', { class: 'muted' }, run.st.showing
      ? 'Смотри на узлы: сейчас повторим сигнал.'
      : `Повтори последовательность. Уровень ${run.st.level ?? 0} из 12.`));
}

function arcadeSequencePress(run, i) {
  if (run.st.showing) return;
  const want = run.st.want ?? [];
  const pos = run.presses.length;
  run.presses.push(i);
  run.st.flash = i + 1;
  setTimeout(() => { if (arcadeRun) { arcadeRun.st.flash = 0; arcadeRefreshBoard(); } }, 160);
  if (want[pos] !== i) {
    sfx('lose');
    arcadeSubmit({});
    return;
  }
  sfx('pick');
  // Прессы накопительные: сервер сверяет префикс всей последовательности,
  // поэтому «сбросить список после уровня» означало бы потерять зачёт.
  const levelEnd = 3 + (run.st.level ?? 0) - 1;
  if (pos === levelEnd) {
    run.st.level = (run.st.level ?? 0) + 1;
    arcadeRefreshBoard();
    arcadeSequenceShow();
    if (run.st.level >= 12) arcadeSubmit({});
    return;
  }
  arcadeRefreshBoard();
}

// ── Экран «Аркада» ──────────────────────────────────────────────────────────

function arcadeTier(tier, total) {
  // Прогресс — общие победы в аркаде против порога ступени. Раньше здесь стояло
  // `Math.min(tier.wins, 75) / tier.wins`, и полоса всегда была полной: игрок
  // видел «почти готово», не сыграв ни одного забега.
  const pct = Math.max(0, Math.min(100, Math.round((Math.min(total, tier.wins) / tier.wins) * 100)));
  const fill = el('div', { class: 'level-bar-fill' });
  fill.style.width = `${pct}%`;
  return el('div', { class: `arena-tier${tier.awarded ? ' is-done' : ''}` },
    el('div', { class: 'arena-tier-head' },
      el('b', {}, `${tier.wins} побед`),
      el('span', { class: 'muted' }, tier.awarded ? 'медаль получена' : `+${tier.xp} XP`)),
    el('div', { class: 'level-bar' }, fill),
    el('p', { class: 'muted' }, tier.title));
}

/** Разбор серверного detail в одну строку. Числа приходят с сервера, текст — наш. */
function arcadeDetailText(game, detail) {
  const d = detail ?? {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (game === 'maze') return `шагов ${n(d.steps)} из ${n(d.shortest)} возможных`;
  if (game === 'sudoku') return `верно ${n(d.correct)} из ${n(d.cells)} клеток`;
  if (game === 'memory') return `${n(d.matched)} пар за ${n(d.turns)} ходов`;
  if (game === 'sequence') return `уровень ${n(d.level)} (${n(d.correct)} сигналов)`;
  if (game === 'reaction') return `${n(d.hits)} попаданий, средняя реакция ${n(d.avg_ms)} мс`;
  if (game === 'runner') return `${n(d.passed)} чистых, ${n(d.gems)} грузов, ${n(d.crashes)} пробоин`;
  if (game === 'breakout') return `щит: ${n(d.destroyed)} из ${n(d.bricks)}, срывов ${n(d.lost)}`;
  if (game === 'snake') return `${n(d.eaten)} фракций, длина ${n(d.length)}`;
  if (game === 'aim') return `${n(d.hits)} из ${n(d.targets)}, промахов ${n(d.misses)}`;
  if (game === 'catch') return `${n(d.picked)} из ${n(d.cargo)} грузов, пробоин ${n(d.hits)}`;
  return '';
}

function arcadeResultCard(r) {
  if (!r || r.error) {
    return el('p', { class: 'error' }, ERRORS[r?.error] || 'Забег не засчитан');
  }
  const res = r.result ?? {};
  const bad = !res.ok;
  return el('div', { class: `arena-result${res.win ? ' is-win' : ''}${bad ? ' is-bad' : ''}` },
    el('h3', {}, bad ? 'Забег не засчитан' : res.win ? `Победа · ${res.score} очков` : `${res.score} очков`),
    el('p', { class: 'muted' }, bad
      ? 'Сервер не принял ввод: попытка сгорела, награды нет. Это защита от подбора ответов.'
      : arcadeDetailText(r.game, res.detail)),
    !bad ? el('p', {}, `Опыт: +${r.rewards?.xp ?? 0} XP${r.rewards?.capped ? ' (суточный потолок аркады выбран)' : ''}`) : null,
    ...(r.awards ?? []).map((a) => el('p', { class: 'arena-award' },
      `Медаль «${a.title}» · +${a.xp} XP`)));
}

function arcadeTile(g) {
  return el('div', { class: 'arcade-tile' },
    el('img', { class: 'arcade-tile-art', src: g.sprite, alt: '', width: '64', height: '64', loading: 'lazy' }),
    el('div', { class: 'arcade-tile-body' },
      el('h4', {}, g.title),
      el('p', { class: 'muted' }, g.rules),
      el('p', { class: 'arcade-tile-meta' },
        el('span', {}, g.kind === 'logic' ? 'голова' : 'реакция'),
        el('span', {}, `лучший счёт ${g.best}`),
        el('span', {}, `${g.wins} побед из ${g.runs} забегов`)),
      el('p', { class: 'muted' }, `Управление: ${g.controls} · раунд ${Math.round(g.runMs / 1000)} с`)),
    el('button', {
      type: 'button', class: 'cta cta-small',
      disabled: arcadeData.attempts.left <= 0 ? '' : null,
      onClick: () => { arcadeGameId = g.id; arcadeResult = null; arcadeStartRun(); },
    }, arcadeData.attempts.left > 0 ? 'Играть' : 'Попыток нет'));
}

function arcadeHud() {
  return el('div', { class: 'arena-hud' },
    el('span', {}, el('b', { 'data-arcade-time': '' }, '0:00')),
    el('span', {}, el('b', { 'data-arcade-score': '' }, '—')),
    soundToggle());
}

function arcadeStage(game) {
  const running = !!arcadeRun;
  const needsCanvas = ['maze', 'reaction', 'runner', 'breakout', 'snake', 'aim', 'catch'].includes(game.id);
  const domBoard = ['sudoku', 'memory', 'sequence'].includes(game.id);
  return el('div', { class: 'arena-stage arcade-stage' },
    running ? arcadeHud() : null,
    needsCanvas
      ? el('canvas', {
        class: 'arena-canvas', id: 'arcade-canvas', width: '1000', height: '620',
        'aria-label': `Поле игры «${game.title}»`,
      })
      : el('div', { class: 'arcade-board', id: 'arcade-board' }, running ? arcadeBoardInner(game.id) : null),
    running
      ? el('div', { class: 'arcade-running-bar' },
        el('span', { class: 'muted' }, game.controls),
        domBoard
          ? el('button', { type: 'button', class: 'ghost', onClick: () => arcadeSubmit({}) }, 'Сдать результат')
          : el('button', { type: 'button', class: 'ghost', onClick: () => arcadeSubmit({}) }, 'Закончить'))
      : el('div', { class: 'arena-overlay' },
        el('h3', {}, game.title),
        el('p', { class: 'muted' }, game.rules),
        el('p', { class: 'muted' },
          `Управление: ${game.controls}. Режим выше (Авто / Мышь / Тач / Кнопки) решает, что вообще считать вводом. Счёт и победа — на совести сервера: он пересчитывает твой ввод по зерну забега.`),
        el('button', {
          type: 'button', class: 'cta', 'data-arcade-start': '',
          disabled: arcadeData.attempts.left <= 0 ? '' : null,
          onClick: arcadeStartRun,
        }, arcadeData.attempts.left > 0 ? 'Начать забег' : 'Попытки на сегодня кончились')),
    running
      ? el('p', { class: 'muted arena-hint' }, 'Ушёл из забега — попытка сгорает. Ответы принимает сервер до конца раунда.')
      : null);
}

function renderArcade() {
  if (!arcadeData) {
    if (!arcadeLoading && !arcadeError) loadArcade();
    return el('div', { class: 'screen' },
      el('p', { class: 'muted' }, arcadeError ? 'Аркада сейчас не отвечает.' : 'Загружаем аркаду…'),
      arcadeError ? el('p', { class: 'error' }, arcadeError) : null,
      arcadeError ? el('button', {
        type: 'button', class: 'ghost',
        onClick: () => { arcadeError = ''; loadArcade(); },
      }, 'Повторить') : null);
  }
  const a = arcadeData;
  const game = arcadeGame(arcadeGameId);
  const xpPct = Math.min(100, Math.round((a.today.xp / (a.caps.xp || 1)) * 100));
  const xpFill = el('div', { class: 'level-bar-fill' });
  xpFill.style.width = `${xpPct}%`;
  const weekPct = Math.min(100, Math.round((a.weekly.wins / (a.weekly.target || 1)) * 100));
  const weekFill = el('div', { class: 'level-bar-fill' });
  weekFill.style.width = `${weekPct}%`;
  return el('div', { class: 'screen' },
    el('div', { class: 'arena-hero' },
      el('span', { class: 'badge' }, 'Аркада'),
      el('h2', {}, 'Десять мини-игр'),
      el('p', { class: 'muted' },
        `Поле, колода, лабиринт и трасса строятся из серверного зерна. Награда — опыт${a.attempts.premium ? ' (Premium +4 попытки)' : ''}: ASTRA аркада не выдаёт.`),
      el('div', { class: 'arena-stats' },
        el('span', {}, 'попыток сегодня: ', el('b', {}, `${a.attempts.left}/${a.attempts.limit}`)),
        el('span', {}, 'побед всего: ', el('b', {}, String(a.wins))),
        el('span', {}, 'лучший счёт: ', el('b', {}, String(a.best))),
        el('span', {}, 'опыт за день: ', el('b', {}, `${a.today.xp}/${a.caps.xp} XP`))),
      el('div', { class: 'level-bar' }, xpFill)),

    // Режим управления доступен и в каталоге: выбирать его надо до забега, а не
    // на ходу, когда поле перерисовывается каждую секунду.
    game ? null : arcadeControlRow(null),
    game ? null : el('div', { class: 'arcade-catalog' }, ...a.games.map(arcadeTile)),
    game ? el('div', { class: 'arcade-open' },
      el('div', { class: 'arcade-open-head' },
        el('img', { src: game.sprite, alt: '', width: '40', height: '40' }),
        el('h3', {}, game.title),
        el('button', {
          type: 'button', class: 'ghost',
          onClick: () => { arcadeStopLoop(); arcadeRun = null; arcadeOpen(null); },
        }, 'К каталогу')),
      // Выбор типа управления — до старта забега и во время него: игрок
      // меняется на ходу («играл мышью, потом взял телефон»).
      arcadeControlRow(game),
      arcadeResult ? arcadeResultCard(arcadeResult) : null,
      arcadeStage(game)) : null,

    el('div', { class: 'panel-grid' },
      el('div', { class: 'block' },
        el('h3', {}, 'Медали аркады'),
        el('p', { class: 'muted' }, 'Опыт за медали не входит в суточный потолок: это разовые достижения.'),
        ...a.tiers.map((t) => arcadeTier(t, a.wins)),
        el('div', { class: `arcade-allten${a.allTen.awarded ? ' is-done' : ''}` },
          el('img', { src: '/sprites/arcade/medal_arcade_all.png', alt: '', width: '28', height: '28', class: 'icon-sm' }),
          el('div', {},
            el('b', {}, 'Десять игр — десять побед'),
            el('p', { class: 'muted' }, a.allTen.awarded
              ? `Медаль получена · +${a.allTen.xp} XP`
              : `Победи в каждой игре каталога: ${a.allTen.have}/${a.allTen.need}.`)))),
      el('div', { class: 'block' },
        el('h3', {}, 'Неделя в аркаде'),
        el('p', { class: 'muted' }, `${a.weekly.target} побед за календарную неделю (UTC) → +${a.weekly.xp} XP разово.`),
        el('div', { class: 'level-bar' }, weekFill),
        el('p', { class: 'muted' }, a.weekly.awarded ? 'Неделя закрыта, медаль выдана.' : `Сейчас ${a.weekly.wins}/${a.weekly.target}.`)),
      el('div', { class: 'block' },
        el('h3', {}, 'Последние забеги'),
        a.recent.length
          ? el('table', { class: 'arena-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Игра'), el('th', {}, 'Счёт'), el('th', {}, 'Итог'), el('th', {}, 'XP'))),
            el('tbody', {}, ...a.recent.map((r) => el('tr', {},
              el('td', {}, arcadeGame(r.game)?.title ?? r.game),
              el('td', {}, String(r.score)),
              el('td', {}, r.win ? 'победа' : arcadeDetailText(r.game, r.detail) || 'без победы'),
              el('td', {}, `+${r.xp}`)))))
          : el('p', { class: 'muted' }, 'Ещё ни одного засчитанного забега.')),
      el('div', { class: 'block' },
        el('h3', {}, 'Лидерборд аркады'),
        a.leaderboard?.length
          ? el('table', { class: 'arena-table' },
            el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Пилот'), el('th', {}, 'Побед'), el('th', {}, 'Лучший'))),
            el('tbody', {}, ...a.leaderboard.map((row) => el('tr', { class: row.isMe ? 'is-me' : '' },
              el('td', {}, String(row.rank)),
              el('td', { class: frameClass(row.frame) }, row.label,
                row.premium ? el('span', { class: 'badge' }, 'Premium') : null),
              el('td', {}, String(row.wins)),
              el('td', {}, String(row.best))))))
          : el('p', { class: 'muted' }, 'Побед пока нет. Первая — самая вкусная.'))),
    el('p', { class: 'muted arcade-note' },
      'Правила для всех десяти: попытка тратится на старте, кривой или физически невозможный ввод не засчитывается, а не «подбирается» бесплатно. '
      + `Суточный потолок опыта — ${a.caps.xp} XP.`));
}

// ── Ввод: клавиши, мышь, палец ───────────────────────────────────────────────
// Слушатели вешаются один раз: после каждой перерисовки их число не растёт.

// Тип управления аркадой. Поле следует за мышью — на телефоне это «палец уехал
// на пиксель, щит уехал», а с клавиатуры играть было нельзя вовсе. Режим
// выбирается один раз и живёт в localStorage: игрок не перетыкает его каждый
// забег, а экранная крестовина появляется только там, где она нужна.
const ARCADE_CONTROL_MODES = ['auto', 'mouse', 'touch', 'keys'];
const ARCADE_CONTROL_HINTS = {
  auto: 'мышь, палец и клавиши — что удобнее',
  mouse: 'поле идёт за мышью; палец не управляется',
  touch: 'палец по полю плюс экранные кнопки',
  keys: 'только клавиши (стрелки, W/A/S/D)',
};
const ARCADE_CONTROL_NAMES = { auto: 'Авто', mouse: 'Мышь', touch: 'Тач', keys: 'Кнопки' };
/** Шаг экранной крестовины и клавиш; край поля — чтобы щит не уходил за борт. */
const ARCADE_PAD_STEP = 46;
const ARCADE_PAD_EDGE = 40;

let arcadeControl = (() => {
  try {
    const v = localStorage.getItem('astra:arcade-control');
    return ARCADE_CONTROL_MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
})();

/** Принимает ли этот режим данный указатель. */
function arcadePointerAllowed(e) {
  if (arcadeControl === 'keys') return false;
  const type = e && e.pointerType;
  if (arcadeControl === 'touch') return type === 'touch' || type === 'pen';
  if (arcadeControl === 'mouse') return type === 'mouse';
  return true;
}

function arcadeControlRow(game) {
  const padGames = ['maze', 'snake', 'breakout', 'catch', 'runner', 'reaction'];
  return el('div', { class: 'arcade-controls' },
    el('span', { class: 'arcade-controls-label' }, 'Управление'),
    ...ARCADE_CONTROL_MODES.map((mode) => el('button', {
      type: 'button',
      class: `arcade-control-btn${arcadeControl === mode ? ' is-on' : ''}`,
      'aria-pressed': arcadeControl === mode ? 'true' : 'false',
      title: ARCADE_CONTROL_HINTS[mode],
      onClick: () => {
        arcadeControl = mode;
        try { localStorage.setItem('astra:arcade-control', mode); } catch { /* приватный режим */ }
        render();
      },
    }, ARCADE_CONTROL_NAMES[mode])),
    el('span', { class: 'muted' }, ARCADE_CONTROL_HINTS[arcadeControl]),
    // Экранные кнопки — только там, где они на что-то влияют, и только в тач-режиме:
    // полупрозрачный крест поверх поля в другой игре только мешает.
    arcadeControl === 'touch' && game && padGames.includes(game.id) && arcadeRun ? arcadePad(game) : null);
}

/**
 * Экранные кнопки. Держать дольше — шаг повторяется, как с зажатыми стрелками.
 *
 * Повтор обязан остановиться, если кнопку вынесли из DOM: экран перерисовывается
 * вместе с `/me` (а на «Флоте» — ещё и по завершении рейса), и интервал,
 * повешенный только на `pointerup`, остался бы жить на мёртвом узле. Итог для
 * игрока выглядел бы поломкой: платформа уезжает в одну сторону сама, а «отпустил
 * — не реагирует».
 */
function arcadePadBtn(label, onStep, extraClass) {
  const btn = el('button', {
    type: 'button',
    class: `arcade-pad-btn${extraClass ? ` ${extraClass}` : ''}`,
    'aria-label': label,
  }, label);
  let timer = null;
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onStep();
    stop();
    timer = setInterval(() => {
      if (!btn.isConnected) { stop(); return; }
      onStep();
    }, 120);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  return btn;
}

function arcadePad(game) {
  const dirBtn = (label, dir) => arcadePadBtn(label, () => arcadeNudge(dir));
  // Дирекции нужны лабиринту и змейке, щит — разбивателю и ловцу, действие —
  // бегунку и реакции. Для остальных игр крест на поле лишний.
  const dirs = ['maze', 'snake', 'breakout', 'catch'].includes(game.id);
  const action = game.id === 'runner' ? 'ПРЫЖОК' : game.id === 'reaction' ? 'ТАП' : null;
  const row = [];
  if (dirs) {
    row.push(el('div', { class: 'arcade-pad-dpad' },
      el('span'), dirBtn('▲', 0), el('span'),
      dirBtn('◀', 3), el('span', { class: 'arcade-pad-mid' }, '·'), dirBtn('▶', 1),
      el('span'), dirBtn('▼', 2), el('span')));
  }
  if (action) row.push(arcadePadBtn(action, () => arcadeTapAction(), 'is-action'));
  return el('div', { class: 'arcade-pad' }, ...row);
}

const ARCADE_DIR_CODES = {
  ArrowUp: 0, w: 0, 'ц': 0,
  ArrowRight: 1, d: 1, 'в': 1,
  ArrowDown: 2, s: 2, 'ы': 2,
  ArrowLeft: 3, a: 3, 'ф': 3,
};

function arcadePointer(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return null;
  const x = ((event.clientX - rect.left) / rect.width) * ARCADE_W;
  const y = ((event.clientY - rect.top) / rect.height) * ARCADE_H;
  if (x < 0 || x > ARCADE_W || y < 0 || y > ARCADE_H) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Один ход в направлении. `dir`: 0 вверх, 1 вправо, 2 вниз, 3 влево.
 * Общий для клавиатуры и экранного креста: два ввода обязаны вести себя
 * одинаково, иначе «играл кнопками, а на телефоне сломалось».
 */
function arcadeNudge(dir) {
  const run = arcadeRun;
  if (!run || run.finished) return;
  if (run.game === 'maze') {
    run.moves.push(dir);
    const g = run.st.grid;
    const x = run.st.cursor % g.cols;
    const y = Math.floor(run.st.cursor / g.cols);
    const wall = [1, 2, 4, 8][dir];
    if (g.mask[run.st.cursor] & wall) {
      // Сквозь стену не пройти: попытка обрывается, как и на сервере.
      sfx('hit');
      arcadeSubmit({});
      return;
    }
    const nx = x + [0, 1, 0, -1][dir];
    const ny = y + [-1, 0, 1, 0][dir];
    run.st.cursor = ny * g.cols + nx;
    sfx('pick');
    if (run.st.cursor === g.cols * g.rows - 1) arcadeSubmit({});
    return;
  }
  if (run.game === 'snake') {
    run.st.dir = dir;
    return;
  }
  if (run.game === 'breakout' || run.game === 'catch') {
    // Шаги, а не «прицел»: с клавиатуры и пальцом плавно ведут себя одинаково.
    const delta = dir === 3 ? -ARCADE_PAD_STEP : dir === 1 ? ARCADE_PAD_STEP : dir === 0 ? -ARCADE_PAD_STEP : ARCADE_PAD_STEP;
    const base = run.st.targetX ?? run.st.x ?? ARCADE_W / 2;
    run.st.targetX = Math.max(ARCADE_PAD_EDGE, Math.min(ARCADE_W - ARCADE_PAD_EDGE, base + delta));
  }
}

/** Главное действие: прыжок в бегунке и тап в реакции. */
function arcadeTapAction() {
  const run = arcadeRun;
  if (!run || run.finished) return;
  if (run.game === 'runner') {
    if (run.st.jumpAt == null) {
      run.st.jumpAt = Math.min(run.runMs, Date.now() + serverOffset - run.t0);
      sfx('pick');
    }
    return;
  }
  if (run.game === 'reaction') arcadeReactTap(run);
}

window.addEventListener('keydown', (e) => {
  if (view !== 'arcade' || !arcadeRun || arcadeRun.finished) return;
  if (arcadeControl === 'mouse' || arcadeControl === 'touch') return;
  const run = arcadeRun;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const dir = ARCADE_DIR_CODES[key];
  if (dir != null && (run.game === 'maze' || run.game === 'snake'
    || run.game === 'breakout' || run.game === 'catch')) {
    e.preventDefault();
    arcadeNudge(dir);
    return;
  }
  if (run.game === 'runner' && (key === ' ' || key === 'ArrowUp' || key === 'w')) {
    e.preventDefault();
    arcadeTapAction();
  }
  if (run.game === 'reaction' && key === ' ') {
    e.preventDefault();
    arcadeTapAction();
  }
});

function arcadeReactTap(run) {
  const t = Date.now() + serverOffset - run.t0;
  run.taps.push(Math.round(t));
  sfx('pick');
  const canvas = document.getElementById('arcade-canvas');
  if (canvas) arcadeDrawFrame(canvas, t);
}

document.addEventListener('pointermove', (e) => {
  const run = arcadeRun;
  if (!run || run.finished) return;
  if (run.game !== 'breakout' && run.game !== 'catch') return;
  // Режим управления решает, чьё движение поля вообще считать вводом. В «Авто»
  // работает и мышь, и палец — как было до выбора режима.
  if (!arcadePointerAllowed(e)) return;
  const canvas = document.getElementById('arcade-canvas');
  if (!canvas) return;
  const p = arcadePointer(e, canvas);
  if (p) run.st.targetX = p.x;
});

document.addEventListener('pointerdown', (e) => {
  const run = arcadeRun;
  if (!run || run.finished || view !== 'arcade') return;
  const canvas = document.getElementById('arcade-canvas');
  if (!canvas || e.target !== canvas) return;
  const p = arcadePointer(e, canvas);
  if (!p) return;
  const t = Math.round(Date.now() + serverOffset - run.t0);
  if (run.game === 'aim') {
    run.shots.push({ t, x: p.x, y: p.y });
    const hit = (run.st.targets ?? []).some((target) => (
      t >= target.t && t <= target.t + 900 && Math.hypot(p.x - target.x, p.y - target.y) <= target.r + 10
    ));
    run.st.recentShots = [...(run.st.recentShots ?? []), { at: t, x: p.x, y: p.y, hit }].slice(-24);
    run.st.hits = (run.st.hits ?? 0) + (hit ? 1 : 0);
    sfx(hit ? 'win' : 'hit');
    if (run.shots.length >= 18) arcadeSubmit({});
    return;
  }
  if (run.game === 'reaction') {
    arcadeReactTap(run);
    return;
  }
  if (run.game === 'runner') {
    if (run.st.jumpAt == null) {
      run.st.jumpAt = t;
      sfx('pick');
    }
    return;
  }
  if (run.game === 'catch' || run.game === 'breakout') {
    if (!arcadePointerAllowed(e)) return;
    run.st.targetX = p.x;
    run.st.x = p.x;
  }
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
      // Шансы машин — отдельная строка, и они маленькие нарочно. Повторов бокс
      // не выдаёт, поэтому честно показываем, сколько моделей ступени ещё не
      // собрано: при «0 из 4» шанса на машину нет, и это надо сказать заранее.
      (b.planeChances || []).length
        ? el('p', { class: 'muted box-plane-chances' },
          'Машина звена: ',
          ...b.planeChances.map((c, i) => [
            i > 0 ? ' · ' : null,
            `${c.rarityName.toLowerCase()} ${Math.round(c.chance * 10000) / 100} %`
              + (c.fresh != null ? ` (${c.fresh} из ${c.models} не собрано)` : ''),
          ].filter(Boolean)).flat())
        : null,
      boxData?.planesAllOwned
        ? el('p', { class: 'muted box-plane-chances' }, 'Коллекция звена собрана целиком — бокс отдаёт только ресурсы.')
        : null,
      locked
        ? el('p', { class: 'box-timer', 'data-until': String(b.nextOpenAt), 'data-open-box': b.id }, '')
        : (b.price > 0
          ? el('p', { class: 'muted' }, `Баланс: ${astraNum(state.balances.astra)} ASTRA`)
          : el('p', { class: 'ok' }, 'Бокс готов')),
      el('button', {
        type: 'button',
        class: b.price > 0 ? 'primary' : 'cta',
        // Бесплатный бокс — бонус: без подтверждения «я человек» кнопка спит.
        disabled: locked || poor || state.frozen || (b.price === 0 && bonusGateOn() && !bonusToken) ? '' : null,
        'data-box-button': b.id,
        'data-free': b.price === 0 ? '1' : null,
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

  const boxes = Array.isArray(data.boxes) ? data.boxes : [];
  const gate = bonusGateOn() && boxes.some((b) => b.price === 0)
    ? el('div', { class: 'block bonus-check-block' }, bonusGateBlock())
    : null;

  const result = boxResult && dropsLine(boxResult.drops)
    ? el('div', { class: 'box-result' },
      el('b', {}, `Из «${boxResult.name}» выпало:`),
      el('span', {}, dropsLine(boxResult.drops)),
      boxResult.components ? el('span', { class: 'ok' }, `компонентов: ${boxResult.components}`) : null,
      boxResult.plane ? planeFindLine(boxResult.plane) : null)
    : null;

  const history = (data.history || []).map((h) => el('li', {},
    el('span', { class: 'muted' }, `${fmtDay(h.at)} · ${boxes.find((b) => b.id === h.box)?.name || h.box}`),
    el('span', {}, dropsLine(h.drops))));

  return el('div', { class: 'screen' },
    header,
    el('p', { class: 'muted' }, 'Боксы — это ресурсы, а не валюта: ASTRA из них не выпадает. Дневной и недельный бесплатны по таймеру — и только после подтверждения, что ты человек; платные — сток ASTRA. Доходность ниже, чем у рейсов.'),
    gate,
    result,
    el('div', { class: 'box-grid' }, ...boxes.map(boxCard)),
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
  // Экран меняется ОДНОЙ операцией и с сохранением прокрутки. Раньше сначала
  // шёл `replaceChildren()` без аргументов: на этот миг высота страницы
  // обнулялась, браузер обрезал scrollY, и игрока, дочитывающего длинный
  // список в «Флоте», выбрасывало наверх. Плановое обновление тикера и любой
  // клик по кнопке выглядели как «вкладки скачут сами по себе».
  //
  // Возвращаем позицию только там, где игрок никуда не уходил (обновление,
  // ремонт, покупка). Переход в другой раздел — наверх, к его заголовку:
  // оставлять игрока на 800 px внутри нового экрана — значит «скачут».   
  const sameView = renderedView === null || renderedView === view;
  const scrollKeep = sameView
    ? Math.round(window.scrollY || document.documentElement.scrollTop || 0)
    : 0;
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
                        : view === 'arcade' ? renderArcade()
            : view === 'wallet' ? renderWallet()
            : view === 'ledger' ? renderLedger() : renderBridge();
  panel.replaceChildren(body);
  renderedView = view;
  if (Math.abs(Math.round(window.scrollY || 0) - scrollKeep) > 1) {
    window.scrollTo(0, scrollKeep);
  }
  // Арена живёт на canvas: цикл перевешиваем на свежий элемент после перерисовки.
  if (view === 'arena') arenaMount();
  // Аркада — тот же приём: у каждого своей игры свой цикл и свой canvas.
  if (view === 'arcade') arcadeMount();
  // Виджет «я человек» живёт в разметке экрана — ставим его после каждой перерисовки.
  // Раньше список был жёсткий (мости́к, бонусы, боксы): как только слот проверки
  // оказывался в другом разделе, контейнер пустовал — подпись «подтвердите, что вы
  // человек» есть, а самой проверки нет, и кнопка не разблокируется никогда.
  // Теперь условие смотрит на DOM: есть контейнер — ставим виджет.
  if (bonusGateOn() && document.getElementById('turnstile-claim')) mountBonusGate();
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
  // Для экрана «Рейс» просим состояние под выбранный корабль: сервер считает
  // радиус, топливо и оценку награды именно для него.
  const ship = view === 'flight' ? flightShipId() : null;
  const { status, data } = await authed(`/me${ship ? `?ship=${encodeURIComponent(ship)}` : ''}`);
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
  if (status >= 400) {
    note = `Ошибка: ${errText(data.error)}`;
    // Сервер отверг токен — протух, одноразовый, не с того домена. Если его не
    // сбросить, игрок жал бы «Забрать» и получал ту же ошибку по кругу: код
    // Turnstile живёт секунды, а не до перезагрузки страницы.
    if (String(data?.error || '').startsWith('turnstile')) {
      resetBonusGate();
      mountBonusGate();
    }
  }
  else note = 'Готово';
  // Короткий сигнал: без него действие в другой вкладке выглядит «зависшим».
  if (view !== 'arena') sfx(status >= 400 ? 'lose' : 'pick');
  await loadGame();
  return result;
}

function doClaim() {
  // Сервер с настроенным секретом не отдаст бонус без токена; тело мягкое —
  // пустой POST старых версий отвечает 403 turnstile_required, а не 400.
  return act('claim', '/claim', { turnstileToken: bonusToken }).then((r) => {
    resetBonusGate();
    return r;
  });
}
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
    btn.dataset.busy = '1';
    btn.textContent = 'Открываем…';
  }
  // Аудиоконтекст создаём прямо в обработчике клика: после await браузер уже не
  // считает вызов «жестом пользователя» и звук открытия может не заиграть.
  try { audioCtx(); } catch { /* без звука тоже работает */ }
  // Ключ включает счётчик открытий: двойной клик — одно действие, а следующее
  // открытие того же бокса — уже новое.
  const opens = boxData?.boxes?.find((b) => b.id === boxId)?.opens ?? 0;
  const wasFree = (boxData?.boxes?.find((b) => b.id === boxId)?.price ?? 1) === 0;
  return act(`box:${boxId}:${opens}`, '/boxes/open', { box: boxId, turnstileToken: bonusToken }).then(async (res) => {
    if (wasFree) resetBonusGate();
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
// Сдача всего патруля сразу: сервер забирает все вернувшиеся борта, поэтому
// ключ идемпотентности привязан к числу бортов в воздухе, а не к одному id.
function doClaimPatrol() {
  const id = (state.planes?.active?.length || 0) + ':' + (state.planes?.patrol?.id || 0);
  return act(`patrol-claim:${id}`, '/planes/patrol/claim', {}).then((res) => {
    if (!res || res.status >= 400) { render(); return; }
    const data = res.data || {};
    const parts = [];
    if (data.claimed) parts.push(`бортов сдано: ${data.claimed}`);
    const salvage = (data.salvage || []).map((r) => `${r.amount} ${r.name}`).join(', ');
    if (salvage) parts.push(`+${salvage}`);
    if (data.xp) parts.push(`+${data.xp} опыта`);
    const fresh = (data.foundList || []).filter((f) => f.firstTime).map((f) => f.name);
    if (fresh.length) parts.push(`находка: ${fresh.join(', ')}`);
    note = parts.length ? `Патруль: ${parts.join(' · ')}` : 'Патруль вернулся без находки';
    render();
  });
}
function doApplyReferral(code) { return act(`ref:${code}`, '/referrals/apply', { code }).then(loadGuild); }

function setView(v) {
  view = v;
  rememberView(v);
  note = '';
  if (v === 'bonus') loadPayAccount();
  if (v === 'boxes') loadBoxes();
  if (v === 'arena') { arenaResult = null; if (!arenaData) loadArena(); }
  if (v === 'arcade') { arcadeResult = null; if (!arcadeData) loadArcade(); }
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
  const { status, data } = await request(`/auth/${mode}`, { method: 'POST', body });
  btn.disabled = false;
  if (status === 200) {
    token = data.access_token;
    try {
      const em = ($('#email')?.value || '').trim();
      if (em) localStorage.setItem('astra:callsign', em.split('@')[0]);
    } catch { /* приватный режим */ }
    $('#password').value = '';
    await loadGame();
    return;
  }
  // Отказ обязан назвать причину: «почта не настоящая» и «повторите позже» —
  // это разные действия, и игрок не должен гадать.
  $('#auth-error').textContent = errText(data.error);
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
  // Любое завершение — сигнал перезапросить /me: наград там сразу несколько,
  // и «в пути» обязано перестать считаться, пока игрок смотрит на экран.
  const arrived = activeExpeditions().some((a) => left(a.endsAt) === 0);
  if (arrived && clock % 5 === 0) loadGame();
}, 1000);

(async () => {
  try {
    const health = await request('/health');
    if (health.status === 200) syncServerTime(health.data.now);
    await loadConfig();
    if (await refresh()) {
      view = savedView();
      // Раздел восстановлен — значит и хэш обязан встать: адресная строка
      // описывает экран, на котором игрок реально сидит.
      rememberView(view);
      await loadGame();
    } else show('landing');
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
