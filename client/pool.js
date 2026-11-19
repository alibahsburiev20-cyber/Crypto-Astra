// Публичный отчёт пула (этап 5, срез 5.2). Ничего не считает сам: берёт готовые
// числа с /pool.json, поэтому подменить суммы в браузере бессмысленно — отчёт
// пересобирается на сервере из append-only таблицы.

const $all = (selector) => Array.from(document.querySelectorAll(selector));

const KIND_LABELS = {
  in: 'Взнос',
  out: 'Приз',
  ops: 'Операции',
};

function money(amount, currency) {
  const value = Number(amount) || 0;
  const fraction = 2;
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency', currency, minimumFractionDigits: fraction, maximumFractionDigits: fraction,
    }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

function setText(selector, text) {
  for (const node of $all(selector)) node.textContent = text;
}

function totalsFor(report) {
  const list = Array.isArray(report.totals) ? report.totals : [];
  if (!list.length) {
    return { currency: 'EUR', in: 0, prizes: 0, ops: 0, feeReserved: 0, prizeFund: 0, balance: 0 };
  }
  if (list.length === 1) return list[0];
  // Мультивалютный пул: суммы не складываем, это было бы враньём без курса.
  return { currency: list[0].currency, multi: list };
}

function dateText(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

function renderEntries(report) {
  const body = document.querySelector('[data-pool="entries"]');
  const rows = Array.isArray(report.latest) ? report.latest : [];
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="muted">Пока операций нет: пул пуст, взносы не принимаются.</td></tr>';
    return;
  }
  body.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    const cells = [
      dateText(row.createdAt),
      KIND_LABELS[row.kind] || row.kind,
      money(row.amount, row.currency),
      row.note || '—',
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 2) td.className = 'num';
      tr.append(td);
    });
    body.append(tr);
  }
}

function render(report) {
  const t = totalsFor(report);
  if (t.multi) {
    setText('[data-pool="in"]', 'несколько валют');
    setText('[data-pool="fee"]', '—');
    setText('[data-pool="fund"]', '—');
    setText('[data-pool="prizes"]', '—');
    setText('[data-pool="ops"]', '—');
    setText('[data-pool="balance"]', t.multi
      .map((row) => `${money(row.balance, row.currency)}`)
      .join(' · '));
  } else {
    setText('[data-pool="in"]', money(t.in, t.currency));
    setText('[data-pool="fee"]', money(t.feeReserved, t.currency));
    setText('[data-pool="fund"]', money(t.prizeFund, t.currency));
    setText('[data-pool="prizes"]', money(t.prizes, t.currency));
    setText('[data-pool="ops"]', money(t.ops, t.currency));
    setText('[data-pool="balance"]', money(t.balance, t.currency));
  }

  const payouts = document.querySelector('[data-pool="payouts"]');
  if (payouts) {
    payouts.textContent = report.payoutsEnabled
      ? 'Выплаты игрокам: включены по правилам гейта 4'
      : 'Выплаты игрокам: выключены (до гейта 4)';
    payouts.classList.toggle('is-on', Boolean(report.payoutsEnabled));
  }

  const note = document.querySelector('[data-pool="note"]');
  if (note) {
    note.textContent = report.latest && report.latest.length
      ? `Резерв на операции: ${report.feePercent} %. Отчёт обновлён ${new Date(report.updatedAt).toLocaleString('ru-RU')}.`
      : 'Пул пуст. Приём взносов включится только после гейта 4; сейчас учитывать нечего, и это нормально.';
  }
  renderEntries(report);
}

async function load() {
  try {
    const res = await fetch('/pool.json', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const report = await res.json();
    render(report);
  } catch {
    setText('[data-pool="updated"]', 'Отчёт недоступен — обновите страницу позже');
    setText('[data-pool="note"]', 'Сервер не отдал отчёт. Это не «нули»: данные просто не загрузились.');
  }
}

const updated = document.querySelector('[data-pool="updated"]');
if (updated) {
  updated.textContent = 'Отчёт: публичный, только чтение';
}

load();
