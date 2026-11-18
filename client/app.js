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
  insufficient_resources: 'Не хватает ресурсов',
  bad_recipe: 'Такого рецепта нет',
  craft_queue_full: 'Очередь крафта занята',
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

function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  return m < 120 ? `${m} мин` : `${Math.round(m / 60)} ч`;
}

function shipArt(type) {
  return el('div', { class: 'ship-viewer' }, el('img', { src: `/sprites/ships/${type}.png`, alt: '', width: '256', height: '128' }));
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
    s.repair.blocked === 'needs_plate' ? el('p', { class: 'error' }, 'Ниже 50% нужен alloy_plate — скрафтите его в «Кошельке» (3 руды + 1 титан, 60 ASTRA).') : null,
    s.durability <= 70 && s.durability >= 50 ? el('p', { class: 'muted' }, 'Почините до следующего рейса, иначе можно просесть ниже 50%.') : null,
  ));
  const locked = state.catalog.filter((c) => !c.owned).map((c) => el('div', { class: 'block locked' },
    el('img', { src: `/sprites/ships/${c.type}.png`, alt: '', width: '96', class: 'sprite-thumb' }),
    el('h3', {},
      el('img', { src: '/icons/ui/lock.png', alt: '', width: '14', height: '14', class: 'icon-xs', loading: 'lazy' }),
      ` ${c.name}`),
    el('p', { class: 'muted' }, `Уровень ${c.unlockLevel}. ${c.price == null ? 'Чертёж, не продаётся' : `${c.price} ASTRA — покупка на этапе 2`}`),
  ));
  return el('div', { class: 'screen' },
    el('div', { class: 'screen-title' }, el('h2', {}, 'Флот'), el('span', { class: 'badge' }, `${state.ships.length} в строю`)),
    ...owned,
    el('div', { class: 'screen-title' }, el('h2', {}, 'Закрыто'), el('span', { class: 'badge' }, 'этап 2')),
    ...locked,
    note ? el('p', { class: 'ok' }, note) : null,
  );
}

// Крафт: три рецепта, один слот. Пока идёт задача, кнопки заблокированы —
// очередь на сервере тоже одна, интерфейс это отражает.
function renderCraft() {
  const c = state.craft;
  if (!c) return null;
  const busy = c.slots - c.running.length <= 0;
  const have = (id) => (state.resources.find((r) => r.id === id)?.amount ?? 0);
  const rows = c.recipes.map((r) => {
    const enough = r.inputs.every((i) => have(i.resource) >= i.amount) && state.balances.astra >= r.fee;
    return el('div', { class: 'block' },
      el('h3', {}, r.name),
      el('p', { class: 'muted' }, `${r.inputs.map((i) => `${RESOURCES[i.resource] || i.resource} ${have(i.resource)}/${i.amount}`).join(' · ')}`),
      el('p', { class: 'muted' }, `Плата ${r.fee} ASTRA · ${fmtDur(r.ms)}`),
      el('button', {
        type: 'button',
        disabled: state.frozen || busy || !enough ? '' : null,
        onClick: () => doCraft(r.id),
      }, busy ? 'Очередь занята' : enough ? 'Скрафтить' : 'Не хватает'),
    );
  });
  return el('div', { class: 'block' },
    el('h3', {}, 'Крафт'),
    c.running.length
      ? el('p', { class: 'ok', 'data-prefix': 'Готовится: ', 'data-until': c.running[0].endsAt }, c.running[0].name)
      : el('p', { class: 'muted' }, `Слотов ${c.slots}. Готовый компонент начислится сам.`),
    ...rows,
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
    renderCraft(),
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
  $('#frozen').hidden = !state.frozen;
  const panel = $('#panel');
  panel.replaceChildren();
  const body = view === 'flight' ? renderFlight() : view === 'fleet' ? renderFleet() : view === 'wallet' ? renderWallet() : view === 'ledger' ? renderLedger() : renderBridge();
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
  if (status === 401) { show('auth'); return; }
  if (status !== 200) {
    // 0 — сеть, истёкший токен уже обработан выше. Не сбрасываем экран молча.
    note = `Ошибка: ${errText(data.error)}`;
    if (state) render(); else show('auth');
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
  show('auth');
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
    else show('auth');
  } catch (e) {
    console.error('boot failed', e);
    show('auth');
    $('#auth-error').textContent = errText('network');
  }
})();
