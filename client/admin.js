// Админка мира: чтение состояния, заморозка и ручные начисления.
// Токен не сохраняется на диск и не попадает в URL — только sessionStorage и
// заголовок X-Admin-Token.

const $ = (sel) => document.querySelector(sel);
const setText = (sel, text) => { const n = $(sel); if (n) n.textContent = text; };

function token() { return sessionStorage.getItem('astra:admin') || ''; }
function email() { return sessionStorage.getItem('astra:admin-email') || ''; }
function world() { return ($('#world').value || 'w1').trim(); }

async function call(path, options = {}) {
  const url = `${path}${path.includes('?') ? '&' : '?'}world=${encodeURIComponent(world())}`;
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
