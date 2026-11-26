// Админка мира: состояние, заморозка, ручные начисления, карточка игрока и
// доступы (приглашение младшего админа).
//
// Ни токен, ни ключ помощника не сохраняются на диск и не попадают в URL:
// только sessionStorage этой вкладки и заголовки `X-Admin-Token` / `X-Admin-Key`.
// Ссылка-приглашение несёт ключ во фрагменте (`#k=`) — фрагмент не уходит ни в
// историю, ни в `Referer`, ни в логи прокси, в отличие от `?k=`. Фрагмент мы
// перекладываем в sessionStorage и тут же стираем из адресной строки.

const $ = (sel) => document.querySelector(sel);
const setText = (sel, text) => { const n = $(sel); if (n) n.textContent = text; };

const KEY_SESSION = 'astra:admin-key';

function token() { return sessionStorage.getItem('astra:admin') || ''; }
function email() { return sessionStorage.getItem('astra:admin-email') || ''; }
function adminKey() { return sessionStorage.getItem(KEY_SESSION) || ''; }
function world() { return ($('#world').value || 'w1').trim(); }

/** Ключ из ссылки-приглашения: `#k=astra-admin_…`. */
function adoptInviteFragment() {
  const hash = location.hash || '';
  const match = /[#&]k=([^&\s]+)/.exec(hash);
  if (!match) return false;
  try { sessionStorage.setItem(KEY_SESSION, decodeURIComponent(match[1])); } catch { /* приватный режим */ }
  // Стираем fragment: он больше не нужен, а оставаться в адресной строке ему
  // незачем — ключ не должен переживать закрытие вкладки.
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

async function call(path, options = {}) {
  // Мир указываем только там, где он нужен: пул, деньги и доступы живут в D1, а не в DO.
  const needsWorld = path.startsWith('/admin/world');
  const url = needsWorld
    ? `${path}${path.includes('?') ? '&' : '?'}world=${encodeURIComponent(world())}`
    : path;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(token() ? { 'X-Admin-Token': token() } : {}),
      ...(adminKey() ? { 'X-Admin-Key': adminKey() } : {}),
      ...(email() ? { 'X-Admin-Email': email() } : {}),
      // Content-Type только при теле: на GET лишний заголовок ломает CORS-предпроверку.
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Что доступно младшему админу: сервер всё равно проверяет сам, здесь только честный интерфейс. */
let role = 'owner';
/**
 * `reveal` — показывать ли разделы, которые видны только войдя. При старте
 * страницы они обязаны оставаться спрятанными: форма «выдать доступ»,
 * доступная до входа, выглядит как дыра, даже если сервер всё отвергает.
 */
function applyRole(data, reveal = true) {
  role = data.role === 'junior' ? 'junior' : 'owner';
  setText('#role', !reveal
    ? 'Вход: токен владельца или ключ помощника из ссылки.'
    : role === 'owner'
      ? 'Вы вошли как владелец: доступно всё.'
      : `Вы вошли как младший админ${data.label ? ` (${data.label})` : ''}: деньги, доступы и удаление игроков владельцу не отдают.`);
  if (reveal && role === 'owner') {
    for (const sel of ['#staff-block', '#audit-block']) {
      const node = $(sel);
      if (node) node.hidden = false;
    }
  }
  for (const sel of ['#player-block', '#player-unblock', '#player-close']) {
    const btn = $(sel);
    if (btn) btn.disabled = role !== 'owner';
  }
  for (const sel of ['#freeze', '#unfreeze', '#pay-stop', '#pay-resume', '#pool-add']) {
    const btn = $(sel);
    if (btn) btn.disabled = role !== 'owner';
  }
  // «Потолка нет» до входа — это обещание, которого мы дать не можем: роль ещё
  // не известна, поэтому при старте страницы строка пустая.
  setText('#grant-help', !reveal ? '' : role === 'owner'
    ? 'Потолка нет. Минус в сумме — списание.'
    : `Потолок одной выдачи: ${Number.isFinite(data.grantLimit) ? data.grantLimit : '—'} ASTRA.`);
}

// Коды отказа с сервера — в человеческий текст. Раньше любая ошибка показывалась
// как «Причина обязательна», поэтому настоящая причина (не тот мир, нет игрока,
// не задан ADMIN_TOKEN) была не видна.
const ERROR_TEXT = {
  admin_disabled: 'ADMIN_TOKEN не задан в секретах Worker — добавьте секрет и задеплойте.',
  admin_forbidden: 'Токен не совпал с ADMIN_TOKEN.',
  admin_email_forbidden: 'Почта не привязана: нужен email из секрета ADMIN_EMAIL.',
  admin_token_required: 'Введите токен (или вставьте ссылку-приглашение).',
  admin_weak_token: 'ADMIN_TOKEN слишком короткий: нужно 24+ случайных символа, админка не работает.',
  too_many_attempts: 'Слишком много неверных попыток с этого адреса. Подождите 15 минут — блокировка снимется сама.',
  bad_world: 'Мир пишется латиницей: w1.',
  bad_target: 'Укажите игрока: полный id, начало id или email.',
  bad_amount: 'Сумма — целое число от 1 до 100 000 (минус — списание).',
  reason_required: 'Заполните причину.',
  player_not_found: 'Игрок не найден ни в одном мире. Проверьте id или email.',
  ambiguous_player: 'Под это начало id подходит несколько игроков — введите id целиком или email.',
  bad_request: 'Проверьте поля: игрок, сумма, причина.',
  admin_key_unknown: 'Ключ не найден: доступ отозван или ссылка из другого окружения. Попросите владельца выдать новый.',
  admin_key_revoked: 'Этот доступ отозван владельцем.',
  admin_key_expired: 'Срок действия ключа истёк — попросите владельца продлить (новый ключ).',
  admin_store_unavailable: 'Таблицы доступов нет в базе: прогоните миграцию 0011_admin_accounts.sql (или перезагрузите — админка создаёт их сама).',
  owner_only: 'Это действие только для владельца: деньги, доступы и закрытие аккаунтов.',
  grant_limit: 'Сумма больше потолка этого доступа. Попросите владельца.',
  bad_label: 'Имя помощника — минимум 2 символа.',
  bad_email: 'Email не похож на адрес.',
  bad_days: 'Срок — целое число дней от 1 до 90.',
  bad_grant_limit: 'Потолок — целое число от 1 до 20 000 ASTRA.',
  bad_account: 'Не понят, какой доступ отзывать.',
  account_not_active: 'Этот доступ уже отозван.',
  bad_action: 'Непонятное действие с игроком.',
  confirm_required: 'Для удаления впишите DELETE.',
  not_blocked: 'Игрок не заблокирован — снимать нечего.',
  player_already_closed: 'Аккаунт уже закрыт.',
  player_has_funds: 'У игрока лежат USDT или висит незакрытая заявка на выплату: сначала урегулируйте деньги, потом удаляйте.',
  pay_unavailable: 'Баланс денег не прочитан — удаление невозможно, иначе можно потерять остаток игрока.',
  insufficient_funds: 'На балансе игрока меньше, чем вы списываете.',
};
function errorText(data, status) {
  const code = data && data.error;
  return ERROR_TEXT[code] || `Отказ: ${code || status}.`;
}

// ── Пул: сводка и добавление записи ────────────────────────────────────────
function money(amount, currency) {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

function totalsGrid(host, items) {
  host.replaceChildren(...items.map(([label, value]) => {
    const cell = document.createElement('div');
    cell.className = 'admin-total';
    const span = document.createElement('span');
    span.textContent = label;
    const b = document.createElement('b');
    b.textContent = String(value ?? 0);
    cell.append(span, b);
    return cell;
  }));
}

async function loadPool() {
  const { status, data } = await call('/admin/pool');
  const block = $('#pool-block');
  block.hidden = false;
  if (status !== 200) {
    setText('#pool-status', `Пул недоступен: ${data.error || status}.`);
    return;
  }
  // Итоги приходят по валютам: взносы, призы, резерв и свободный остаток.
  const totals = [];
  for (const t of data.totals || []) {
    totals.push(
      [`${t.currency} · взносы`, money(t.in, t.currency)],
      [`${t.currency} · призы`, money(t.prizes, t.currency)],
      [`${t.currency} · свободно`, money(t.available, t.currency)],
    );
  }
  totalsGrid($('#pool-totals'), totals.length ? totals : [['Записей пока нет', '—']]);
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Ссылка</th><th>Заметка</th></tr>';
  const body = document.createElement('tbody');
  for (const e of data.entries || []) {
    const tr = document.createElement('tr');
    for (const value of [new Date(e.createdAt).toLocaleString('ru-RU'), e.kind, money(e.amount, e.currency), e.ref, e.note || '—']) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  $('#pool-entries').replaceChildren(head, body);
  setText('#pool-status', `Записей: ${(data.entries || []).length}. Обновлено ${new Date(data.updatedAt).toLocaleTimeString('ru-RU')}.`);
}

async function addPoolEntry() {
  const amount = Number($('#pool-amount').value);
  const body = {
    kind: $('#pool-kind').value,
    // Ввод в евро/долларах, в базе — центы.
    amount: Math.round(amount * 100),
    currency: $('#pool-currency').value,
    ref: $('#pool-ref').value.trim(),
    note: $('#pool-note').value.trim(),
  };
  const { status, data } = await call('/admin/pool/entry', { method: 'POST', body: JSON.stringify(body) });
  setText('#pool-status', status === 201
    ? `Добавлено: ${body.kind} ${amount} ${body.currency}.`
    : `Отказ: ${data.error || status}. Ссылка должна быть уникальной.`);
  if (status === 201) { $('#pool-ref').value = ''; $('#pool-note').value = ''; }
  loadPool();
}

// ── Деньги: сверка, очередь выплат, стоп-флаг ───────────────────────────────
function usdt(micro) {
  return `${(Number(micro) / 1_000_000).toFixed(2)} USDT`;
}

async function loadPay() {
  const { status, data } = await call('/admin/pay');
  const block = $('#pay-block');
  block.hidden = false;
  if (status !== 200) {
    setText('#pay-status', `Платёжная база недоступна: ${data.error || status}.`);
    return;
  }
  const r = data.reconcile || {};
  totalsGrid($('#pay-totals'), [
    ['Депозиты', usdt(r.totals?.creditedDepositsMicro)],
    ['Выплаты', usdt(r.totals?.payoutsMicro)],
    ['Резерв заявок', usdt(r.totals?.reservedWithdrawalsMicro)],
    ['Балансы', usdt(r.totals?.balancesMicro)],
  ]);
  const verify = $('#pay-verify');
  const ok = Boolean(r.ok) && Boolean(r.ledger?.ok);
  verify.className = ok ? 'ok' : 'error';
  verify.textContent = `${ok ? 'Сходится' : 'Расхождение'}: журнал ${r.ledger?.rows ?? 0} записей`
    + (r.stop ? ' · выплаты на стопе' : ' · стоп-флаг снят')
    + (data.flags ? ` · payouts: ${data.flags.payouts ? 'вкл' : 'выкл'}` : '');

  // Сеть и курсор сканера — отдельной строкой: по ней видно, что приём встал,
  // ещё до того, как игрок напишет «мне не зачислили».
  const chain = data.chain || {};
  setText('#pay-chain', chain.name
    ? `Сеть: ${chain.label || chain.name} · знаков ${chain.decimals ?? '—'} · подтверждений ${chain.confirmations ?? '—'}`
      + ` · курсор блока ${chain.cursor ?? 0}`
      + (chain.contract ? ` · контракт ${chain.contract}` : ' · контракт не задан')
      + (chain.ready && chain.ready.reason ? ` · ${chain.ready.reason}` : '')
      // Что из рельса включено и сколько адресов относится к активной цепи:
      // «игрокам надо перевыпустить адреса» видно именно по этому числу.
      + (chain.ready ? ` · рельс: адреса ${chain.ready.addresses ? 'вкл' : 'выкл'}, приём ${chain.ready.deposits ? 'вкл' : 'выкл'}, выплаты ${chain.ready.payouts ? 'вкл' : 'выкл'}` : '')
      + (chain.addresses ? ` · адресов ${chain.addresses.active}${chain.addresses.otherChain ? ` · другой цепи ${chain.addresses.otherChain}` : ''}` : '')
    : 'Сеть: сервер не ответил.');

  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Заявка</th><th>Игрок</th><th>Сумма</th><th>Статус</th><th></th></tr>';
  const body = document.createElement('tbody');
  for (const w of data.queue || []) {
    const tr = document.createElement('tr');
    for (const value of [w.id.slice(0, 10), w.userId.slice(0, 8), w.amount, w.status]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    const actions = document.createElement('td');
    for (const action of ['approve', 'reserve', 'broadcast', 'sent', 'fail']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost';
      b.textContent = action;
      b.addEventListener('click', () => actWithdrawal(w.id, action));
      actions.append(b);
    }
    tr.append(actions);
    body.append(tr);
  }
  if (!body.children.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'muted';
    td.textContent = 'Очередь пуста.';
    tr.append(td);
    body.append(tr);
  }
  $('#pay-queue').replaceChildren(head, body);
  setText('#pay-status', `Проверено ${new Date(data.now || Date.now()).toLocaleTimeString('ru-RU')}.`);
}

async function actWithdrawal(id, action) {
  const { status, data } = await call('/admin/pay/withdrawal', { method: 'POST', body: JSON.stringify({ id, action }) });
  setText('#pay-status', status === 200 ? `Заявка ${id.slice(0, 10)}: ${action}.` : `Отказ: ${data.error || status}.`);
  loadPay();
}

async function setStop(stop) {
  const { status } = await call('/admin/pay/stop', { method: 'POST', body: JSON.stringify({ stop, reason: 'manual' }) });
  setText('#pay-status', status === 200 ? (stop ? 'Выплаты остановлены.' : 'Стоп снят.') : 'Не удалось изменить стоп-флаг.');
  loadPay();
}

function renderSummary(data) {
  $('#summary-block').hidden = false;
  $('#players-block').hidden = false;
  $('#grant-block').hidden = false;
  $('#pcard-block').hidden = false;
  if (role === 'owner') { $('#staff-block').hidden = false; $('#audit-block').hidden = false; }
  const t = data.totals || {};
  $('#totals').replaceChildren(...[
    ['Игроков', t.players], ['ASTRA в мире', t.astra], ['Очков', t.points],
    ['Кораблей', t.ships], ['Рейсов', t.adventures],
  ].map(([label, value]) => {
    const cell = document.createElement('div');
    cell.className = 'admin-total';
    cell.innerHTML = '<span></span><b></b>';
    cell.querySelector('span').textContent = label;
    cell.querySelector('b').textContent = String(value ?? 0);
    return cell;
  }));

  const v = data.verify || {};
  const verify = $('#verify');
  verify.className = v.ok ? 'ok' : 'error';
  verify.textContent = v.ok
    ? `Журнал сходится: ${v.rows} записей.`
    : `Журнал НЕ сходится (запись ${v.brokenAtSeq ?? '—'}, расхождений ${v.mismatches ?? 0}). Мир ${data.frozen ? 'заморожен' : 'не заморожен'}.`;

  const rows = (data.players || []).map((p) => {
    const tr = document.createElement('tr');
    for (const value of [p.label, p.id.slice(0, 8), p.level, p.astra, p.points, p.ships]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    tr.addEventListener('click', () => { $('#grant-player').value = p.id; });
    return tr;
  });
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Пилот</th><th>id</th><th>Ур.</th><th>ASTRA</th><th>Очки</th><th>Корабли</th></tr>';
  const body = document.createElement('tbody');
  body.append(...rows);
  $('#players').replaceChildren(head, body);
}

// ── Карточка игрока: найти, заблокировать, закрыть ─────────────────────────
let playerFound = null;

function fmtMoney(micro) {
  if (micro === null || micro === undefined) return 'нет данных';
  return `${(Number(micro) / 1e6).toFixed(6)} USDT`;
}

function renderPlayer(data) {
  const p = data.player || {};
  const g = data.world || {};
  playerFound = p.id || null;
  // Другой игрок — старое подтверждение не должно переехать за ним.
  $('#player-confirm-wrap').hidden = true;
  $('#player-confirm').value = '';
  const cells = [
    ['Позывной', g.label || '—'],
    ['id', (p.id || '').slice(0, 13)],
    ['Мир', p.worldId || '—'],
    ['Статус', p.status || '—'],
    ['ASTRA', g.astra ?? p.astra ?? 0],
    ['Очки', g.points ?? 0],
    ['USDT', fmtMoney(p.payBalanceMicro)],
    ['Заявок в работе', p.openWithdrawals ?? 0],
    ['Сессий', p.sessions ?? 0],
    ['Почта', p.email || 'нет'],
  ];
  totalsGrid($('#player-card'), cells);
  const addr = (p.addresses || []).map((a) => `${a.chain}:${a.address}`).join(' · ');
  setText('#player-note', addr ? `Адреса пополнения: ${addr}.` : 'Адресов пополнения нет.');
  const blocked = p.status === 'blocked';
  $('#player-block').disabled = role !== 'owner' || blocked;
  $('#player-unblock').disabled = role !== 'owner' || !blocked;
  $('#player-close').disabled = role !== 'owner' || p.status === 'deleted';
  setText('#player-status', blocked
    ? 'Игрок заблокирован: вход закрыт, данные на месте.'
    : `Игрок ${p.id ? p.id.slice(0, 8) : ''} найден.`);
}

async function findPlayer() {
  const ref = $('#player-ref').value.trim();
  if (!ref) { setText('#player-status', ERROR_TEXT.bad_target); return; }
  setText('#player-status', 'Ищем…');
  const { status, data } = await call(`/admin/player?player=${encodeURIComponent(ref)}`);
  if (status !== 200) { setText('#player-status', errorText(data, status)); playerFound = null; return; }
  renderPlayer(data);
}

async function playerAct(action) {
  if (!playerFound) { setText('#player-status', 'Сначала найдите игрока.'); return; }
  const reason = $('#player-reason').value.trim();
  if (!reason) { setText('#player-status', ERROR_TEXT.reason_required); return; }
  const body = { player: playerFound, action, reason };
  if (action === 'close') {
    if ($('#player-confirm').value.trim() !== 'DELETE') {
      setText('#player-status', ERROR_TEXT.confirm_required);
      $('#player-confirm').focus();
      return;
    }
    delete body.action;
  }
  const path = action === 'close' ? '/admin/player/close' : '/admin/player/block';
  setText('#player-status', action === 'close' ? 'Закрываем аккаунт…' : 'Меняем доступ…');
  try {
    const { status, data } = await call(path, { method: 'POST', body: JSON.stringify(body) });
    if (status !== 200) { setText('#player-status', errorText(data, status)); return; }
    // Сервер знает про последствия лучше нас (например, что позывной остался
    // занят, потому что мир не ответил) — показываем его формулировку.
    if (action === 'close' && data.note) {
      setText('#player-status', `Аккаунт закрыт: сессий отозвано ${data.sessions}. ${data.note}`);
    } else {
      setText('#player-status', action === 'close'
        ? `Аккаунт закрыт: сессий отозвано ${data.sessions}. Журналы остались.`
        : `${action === 'block' ? 'Вход закрыт' : 'Блокировка снята'}: сессий отозвано ${data.sessions}.`);
    }
    $('#player-confirm').value = '';
    $('#player-confirm-wrap').hidden = true;
    load();
    findPlayer();
  } catch (e) {
    setText('#player-status', `Сеть недоступна: ${e.message}.`);
  }
}

// ── Доступы: приглашения младших админов ───────────────────────────────────
function humanDate(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleString('ru-RU');
}

async function loadStaff() {
  const { status, data } = await call('/admin/accounts');
  if (status !== 200) { setText('#staff-status', `Доступы недоступны: ${errorText(data, status)}`); return; }
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Кого зовём</th><th>Роль</th><th>Потолок</th><th>Действует до</th><th>Последний вход</th><th>Статус</th><th></th></tr>';
  const body = document.createElement('tbody');
  const rows = (data.accounts || []).map((a) => {
    const tr = document.createElement('tr');
    const statusText = a.status === 'revoked' ? 'отозван' : a.expired ? 'срок вышел' : a.stale ? 'не используется' : 'активен';
    for (const value of [a.label, a.role, a.grantLimit, humanDate(a.expiresAt), a.lastUsedAt ? humanDate(a.lastUsedAt) : 'ещё не входил', statusText]) {
      const td = document.createElement('td');
      td.textContent = String(value ?? '—');
      tr.append(td);
    }
    const td = document.createElement('td');
    if (a.status === 'active') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.textContent = 'Отозвать';
      btn.addEventListener('click', () => revokeAccount(a.id));
      td.append(btn);
    }
    tr.append(td);
    return tr;
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7; td.className = 'muted'; td.textContent = 'Младших админов нет.';
    tr.append(td); rows.push(tr);
  }
  $('#staff').replaceChildren(head, ...rows);
  setText('#staff-status', `Доступов: ${(data.accounts || []).length}. Ключи в базе лежат только хешами — показать их повторно нельзя.`);
}

async function revokeAccount(id) {
  const { status, data } = await call('/admin/accounts/revoke', { method: 'POST', body: JSON.stringify({ id }) });
  setText('#staff-status', status === 200 ? 'Доступ отозван: ключ перестал работать немедленно.' : errorText(data, status));
  loadStaff();
}

async function createInvite() {
  const btn = $('#invite-create');
  btn.disabled = true;
  setText('#invite-status', 'Создаём…');
  try {
    const { status, data } = await call('/admin/accounts/invite', {
      method: 'POST',
      body: JSON.stringify({
        label: $('#invite-label').value.trim(),
        email: $('#invite-email').value.trim(),
        days: Number($('#invite-days').value),
        grantLimit: Number($('#invite-limit').value),
        note: $('#invite-note').value.trim(),
      }),
    });
    if (status !== 201) { setText('#invite-status', errorText(data, status)); return; }
    const link = data.link || data.key;
    const a = $('#invite-href');
    a.textContent = link;
    a.href = link;
    $('#invite-link').hidden = false;
    // Ключ живёт ровно в этом ответе: повторяем его текстом, чтобы его можно
    // было отправить в мессенджере, и больше нигде.
    navigator.clipboard?.writeText(link).catch(() => {});
    setText('#invite-status', `Готово. Отправьте ссылку помощнику и закройте окно — второго шанса показать ключ нет.`);
    loadStaff();
  } catch (e) {
    setText('#invite-status', `Сеть недоступна: ${e.message}.`);
  } finally {
    btn.disabled = false;
  }
}

async function loadAudit() {
  const { status, data } = await call('/admin/audit?limit=25');
  if (status !== 200) { setText('#audit-status', `Журнал недоступен: ${errorText(data, status)}`); return; }
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Над кем</th><th>Детали</th></tr>';
  const body = document.createElement('tbody');
  for (const e of data.entries || []) {
    const tr = document.createElement('tr');
    const payload = e.payload && Object.keys(e.payload).length ? JSON.stringify(e.payload) : '—';
    for (const value of [humanDate(e.createdAt), e.role === 'owner' ? 'владелец' : `помощник ${e.actor}`.trim(), e.action, String(e.target || '').slice(0, 10), payload]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  if (!body.children.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5; td.className = 'muted'; td.textContent = 'Действий пока нет.';
    tr.append(td); body.append(tr);
  }
  $('#audit').replaceChildren(head, body);
  setText('#audit-status', `Записей: ${(data.entries || []).length}.`);
}

async function load() {
  // Сначала «кто я»: младшему админу не зачем дёргать `/admin/world` владельца и
  // видеть кнопки, которые сервер всё равно отвергнет.
  const who = await call('/admin/session');
  if (who.status !== 200) {
    setText('#status', errorText(who.data, who.status));
    return;
  }
  applyRole(who.data);
  const { status, data } = await call('/admin/world');
  if (status !== 200) {
    setText('#status', `Отказ: ${errorText(data, status)}`);
    // Мир недоступен (например, wrong_world для помощника) — доступы и журнал
    // при этом читаемы, и их надо показать: иначе владелец не сможет отозвать
    // ключ, «потому что страница не загрузилась».
    if (role === 'owner') { $('#staff-block').hidden = false; $('#audit-block').hidden = false; loadStaff(); loadAudit(); }
    return;
  }
  setText('#status', `Загружено. Мир ${data.world}.`);
  renderSummary(data);
  loadPool();
  loadPay();
  if (role === 'owner') { loadStaff(); loadAudit(); }
}

$('#connect').addEventListener('click', () => {
  sessionStorage.setItem('astra:admin', $('#token').value.trim());
  sessionStorage.setItem('astra:admin-email', $('#email').value.trim());
  load();
});

$('#freeze').addEventListener('click', async () => {
  const { status } = await call('/admin/world/freeze', { method: 'POST', body: JSON.stringify({ frozen: true }) });
  setText('#status', status === 200 ? 'Мир заморожен.' : 'Не удалось заморозить.');
  load();
});

$('#unfreeze').addEventListener('click', async () => {
  const { status } = await call('/admin/world/freeze', { method: 'POST', body: JSON.stringify({ frozen: false }) });
  setText('#status', status === 200 ? 'Мир разморожен.' : 'Не удалось разморозить.');
  load();
});

$('#pool-add').addEventListener('click', addPoolEntry);
$('#player-find').addEventListener('click', findPlayer);
$('#player-block').addEventListener('click', () => playerAct('block'));
$('#player-unblock').addEventListener('click', () => playerAct('unblock'));
// Удаление — в два касания: сначала показываем поле подтверждения, только потом
// спрашиваем сервер. «Одно нажатие и аккаунта нет» для необратимого действия —
// не защита, а лотерея.
$('#player-close').addEventListener('click', () => {
  const wrap = $('#player-confirm-wrap');
  if (wrap.hidden) {
    wrap.hidden = false;
    $('#player-confirm').focus();
    setText('#player-status', 'Удаление необратимо: почта и пароль стираются сразу. Впишите DELETE и нажмите ещё раз.');
    return;
  }
  playerAct('close');
});
$('#player-reason').addEventListener('keydown', (e) => { if (e.key === 'Enter') findPlayer(); });
$('#player-ref').addEventListener('keydown', (e) => { if (e.key === 'Enter') findPlayer(); });
$('#invite-create').addEventListener('click', createInvite);
$('#invite-copy').addEventListener('click', () => {
  const link = $('#invite-href').href || $('#invite-href').textContent;
  navigator.clipboard?.writeText(link).then(() => setText('#invite-status', 'Ссылка скопирована.')).catch(() => setText('#invite-status', 'Скопируйте вручную: буфер обмена недоступен.'));
});
$('#pay-stop').addEventListener('click', () => setStop(true));
$('#pay-resume').addEventListener('click', () => setStop(false));

async function grant() {
  const player = $('#grant-player').value.trim();
  const astra = Number($('#grant-amount').value);
  const reason = $('#grant-reason').value.trim();
  const btn = $('#grant');
  if (!player) { setText('#grant-status', ERROR_TEXT.bad_target); return; }
  if (!reason) { setText('#grant-status', ERROR_TEXT.reason_required); return; }
  btn.disabled = true;
  setText('#grant-status', 'Начисляем…');
  try {
    const { status, data } = await call('/admin/world/grant', {
      method: 'POST',
      body: JSON.stringify({ player, astra, reason }),
    });
    if (status === 200 || status === 201) {
      const where = data.world ? ` Мир ${data.world}.` : '';
      const by = data.resolvedBy === 'email' ? ' (нашли по email)'
        : data.resolvedBy === 'prefix' ? ' (нашли по началу id)' : '';
      setText('#grant-status', `Готово: ${data.granted > 0 ? '+' : ''}${data.granted} ASTRA игроку ${data.playerId}${by}. Баланс: ${data.astra}.${where}`);
      $('#grant-reason').value = '';
      load();
    } else {
      setText('#grant-status', errorText(data, status));
    }
  } catch (e) {
    setText('#grant-status', `Сеть недоступна: ${e.message}. Повторите — запрос не дошёл.`);
  } finally {
    btn.disabled = false;
  }
}

$('#grant').addEventListener('click', grant);
for (const sel of ['#grant-player', '#grant-amount', '#grant-reason']) {
  $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') grant(); });
}

// Начисление/списание: минус меняет знак у уже введённой суммы, чтобы «забрать
// назад» не требовало вручную ставить «-».
$('#grant-flip').addEventListener('click', () => {
  const input = $('#grant-amount');
  input.value = String(-Math.abs(Number(input.value) || 0));
  setText('#grant-status', Number(input.value) < 0 ? 'Режим списания: сумма уйдёт с баланса игрока.' : 'Режим начисления.');
});

// Форму начисления показываем сразу: сервер всё равно проверит токен. Раньше она
// открывалась только после успешного /admin/world, и при сбое её не было вовсе.
$('#grant-block').hidden = false;
applyRole({ role: 'owner', grantLimit: null }, false);

// Email подставляем из прошлой вкладки: токен придётся ввести заново.
$('#email').value = email();
// Ссылка-приглашение: ключ во фрагменте. Подставляем и сразу идём дальше —
// вводить 43 символа с телефона никто не должен.
if (adoptInviteFragment()) {
  $('#status').textContent = 'Ключ из ссылки принят.';
  load();
} else if (token() || adminKey()) load();
