// Админка мира: чтение состояния, заморозка и ручные начисления.
// Токен не сохраняется на диск и не попадает в URL — только sessionStorage и
// заголовок X-Admin-Token.

const $ = (sel) => document.querySelector(sel);
const setText = (sel, text) => { const n = $(sel); if (n) n.textContent = text; };

function token() { return sessionStorage.getItem('astra:admin') || ''; }
function email() { return sessionStorage.getItem('astra:admin-email') || ''; }
function world() { return ($('#world').value || 'w1').trim(); }

async function call(path, options = {}) {
  // Мир указываем только там, где он нужен: пул и деньги живут в D1, а не в DO.
  const needsWorld = path.startsWith('/admin/world');
  const url = needsWorld
    ? `${path}${path.includes('?') ? '&' : '?'}world=${encodeURIComponent(world())}`
    : path;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Admin-Token': token(),
      'X-Admin-Email': email(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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

async function load() {
  const { status, data } = await call('/admin/world');
  if (status !== 200) {
    const reason = data.error === 'admin_disabled' ? 'ADMIN_TOKEN не задан в секретах Worker — добавьте секрет и задеплойте.'
      : data.error === 'admin_forbidden' ? 'Токен не совпал с ADMIN_TOKEN.'
        : data.error === 'admin_email_forbidden' ? 'Эта почта не привязана: нужен email из секрета ADMIN_EMAIL.'
          : data.error === 'admin_token_required' ? 'Введите токен.'
            : data.error === 'bad_world' ? 'Мир пишется латиницей: w1.'
              : `Отказ: ${data.error || status}.`;
    setText('#status', reason);
    return;
  }
  setText('#status', `Загружено. Мир ${data.world}.`);
  renderSummary(data);
  loadPool();
  loadPay();
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
$('#pay-stop').addEventListener('click', () => setStop(true));
$('#pay-resume').addEventListener('click', () => setStop(false));

$('#grant').addEventListener('click', async () => {
  const body = {
    playerId: $('#grant-player').value.trim(),
    astra: Number($('#grant-amount').value),
    reason: $('#grant-reason').value.trim(),
  };
  const { status, data } = await call('/admin/world/grant', { method: 'POST', body: JSON.stringify(body) });
  setText('#grant-status', status === 201 || status === 200
    ? `Начислено ${data.granted} ASTRA. Баланс: ${data.astra}.`
    : `Отказ: ${data.error || status}. Причина обязательна.`);
  load();
});

// Email подставляем из прошлой вкладки: токен придётся ввести заново.
$('#email').value = email();
if (token()) load();
