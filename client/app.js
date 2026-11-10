const $ = (s) => document.querySelector(s);

const ERRORS = {
  email_taken: 'Этот email уже зарегистрирован',
  invalid_credentials: 'Неверный email или пароль',
  invalid_email: 'Проверьте email',
  invalid_password: 'Пароль: от 8 до 128 символов',
  bad_request: 'Некорректный запрос',
  turnstile_failed: 'Проверка не пройдена',
  unauthorized: 'Нужно войти заново',
  world_full: 'Нет свободных мест, попробуйте позже',
  internal: 'Ошибка сервера, попробуйте позже',
  server_misconfigured: 'Сервер не настроен (нет JWT_SECRET)',
};
const errText = (code) => ERRORS[code] || 'Что-то пошло не так';

let token = null;          // access-токен живёт только в памяти страницы
let mode = 'register';
let nextClaimAt = null;   // миллисекунды, ответ сервера; таймер только рисует
let pendingKey = null;    // Idempotency-Key действия, пока нет ответа

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

// Запрос с автообновлением: access-токен живёт 15 минут.
async function authed(path, opts) {
  let res = await request(path, opts);
  if (res.status === 401 && (await refresh())) res = await request(path, opts);
  return res;
}

function show(view) {
  $('#auth').hidden = view !== 'auth';
  $('#game').hidden = view !== 'game';
}

function setMode(m) {
  mode = m;
  $('#tab-register').classList.toggle('active', m === 'register');
  $('#tab-login').classList.toggle('active', m === 'login');
  $('#auth-submit').textContent = m === 'register' ? 'Зарегистрироваться' : 'Войти';
  $('#password').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}

function renderState(s) {
  $('#world').textContent = `Мир ${s.world_id}`;
  $('#astra').textContent = s.balances.astra;
  $('#fuel').textContent = s.balances.fuel;
  $('#points').textContent = s.balances.points;
  $('#level').textContent = s.level;
  const list = $('#ships');
  list.replaceChildren();
  for (const ship of s.ships) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = ship.type;
    const dur = document.createElement('span');
    dur.className = 'muted';
    dur.textContent = `прочность ${ship.durability}%`;
    li.append(name, dur);
    list.append(li);
  }
  nextClaimAt = s.nextClaimAt;
  tick();
}

function tick() {
  const btn = $('#claim');
  const info = $('#claim-info');
  const left = nextClaimAt ? nextClaimAt - Date.now() : 0;
  if (left > 0) {
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    btn.disabled = true;
    info.textContent = `Следующий Claim через ${m}:${String(sec).padStart(2, '0')}`;
  } else {
    btn.disabled = false;
    if (info.dataset.keep !== '1') info.textContent = 'Claim доступен';
  }
}

async function loadGame() {
  const { status, data } = await authed('/me');
  if (status !== 200) { show('auth'); return; }
  renderState(data);
  show('game');
}

async function doClaim() {
  pendingKey = pendingKey || crypto.randomUUID(); // один ключ на действие, при повторе тот же
  const btn = $('#claim');
  btn.disabled = true;
  const { status, data } = await authed('/claim', { method: 'POST', headers: { 'Idempotency-Key': pendingKey } });
  if (status === 200 || status === 429) pendingKey = null; // ответ получен, действие закончено
  const info = $('#claim-info');
  info.dataset.keep = '1';
  if (status === 200) {
    $('#astra').textContent = data.balance;
    nextClaimAt = data.next_claim_at;
    info.textContent = `+${data.reward} ASTRA`;
  } else if (status === 429) {
    nextClaimAt = data.next_claim_at;
    info.textContent = data.error === 'daily_limit' ? 'Суточный лимит исчерпан' : 'Ещё рано';
  } else {
    info.textContent = errText(data.error);
  }
  setTimeout(() => { info.dataset.keep = '0'; }, 3000);
  tick();
}

$('#tab-register').addEventListener('click', () => setMode('register'));
$('#tab-login').addEventListener('click', () => setMode('login'));

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit');
  btn.disabled = true;
  $('#auth-error').textContent = '';
  const { status, data } = await request(`/auth/${mode}`, {
    method: 'POST',
    body: { email: $('#email').value, password: $('#password').value },
  });
  btn.disabled = false;
  if (status === 200) {
    token = data.access_token;
    $('#password').value = '';
    await loadGame();
  } else {
    $('#auth-error').textContent = errText(data.error);
  }
});

$('#claim').addEventListener('click', doClaim);

$('#logout').addEventListener('click', async () => {
  await request('/auth/logout', { method: 'POST' });
  token = null;
  show('auth');
});

setInterval(tick, 1000);

(async () => {
  if (await refresh()) await loadGame();
  else show('auth');
})();
