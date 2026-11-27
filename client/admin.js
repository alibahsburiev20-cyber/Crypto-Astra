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
    // Раздел списания USDT помощнику не показываем вовсе: сервер отвергнет его
    // `owner_only`, а висящая неактивная кнопка — это «сломано», а не «не для вас».
    for (const sel of ['#staff-block', '#audit-block', '#usdt-block', '#sweep-block']) {
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
  not_blocked: 'Игрок не заблокирован — снимать нечего.',
  player_already_closed: 'Аккаунт уже закрыт.',
  player_has_funds: 'У игрока лежат USDT или висит незакрытая заявка на выплату: сначала урегулируйте деньги, потом удаляйте.',
  pay_unavailable: 'Баланс денег не прочитан — удаление невозможно, иначе можно потерять остаток игрока.',
  insufficient_funds: 'На балансе игрока меньше, чем вы списываете.',
  confirm_required: 'Нужно слово подтверждения: DELETE — удаление аккаунта, ADJUST — запись в денежный журнал, SWEEP — сбор USDT с адресов.',
  bad_idem_key: 'Не поняли ключ операции — обновите страницу, он сгенерируется заново.',
  amount_too_big: 'Одна корректировка — не больше 5 000 USDT: столько же, сколько можно вывести за заявку.',
  balance_below_zero: 'Столько списать нельзя: баланс уйдёт в минус, а он означает «сколько мы должны игроку».',
  below_pending_withdrawals: 'У игрока висит заявка на вывод: сначала откажите ей или отправьте, иначе списание съест обещанные деньги.',
  idem_conflict: 'Под этим ключом уже записана другая сумма — нажмите «Показать итог» ещё раз, получите новый ключ.',
  // Флаг называется `PAYMENTS_ENABLED` (worker/src/pay/flags.ts), а не
  // `PAY_PAYMENTS_ENABLED`: подсказка с выдуманным именем отправляет оператора
  // искать в `wrangler secrets` переменную, которой там не бывает.
  payments_disabled: 'Денежный контур выключен (PAYMENTS_ENABLED=on не стоит): читать балансы можно, писать нельзя.',
  // ── Конфигурация сетей и сбора USDT ──────────────────────────────────────
  hot_wallet_missing: 'PAY_HOT_ADDRESS не задан: сбор некому отправлять, пока не укажете адрес горячего кошелька.',
  usdt_contract_missing: 'Контракт USDT для сети не задан: PAY_EVM_CONTRACT_BNB (BNB) или PAY_EVM_CONTRACT_POL (Polygon).',
  chain_not_configured: 'Сеть не настроена: нужны контракт USDT и свой RPC (PAY_EVM_CONTRACT_…, PAY_EVM_RPC_…). Публичный узел для сбора не годится.',
  chain_id_missing: 'У сети нет chain id (56/97 — BNB, 137/80002 — Polygon): подпись «для другой сети» — это потерянные деньги, поэтому сбор остановлен. Проверьте PAY_NETWORK и PAY_EVM_CHAINS.',
  chain_not_enabled: 'Сеть не включена в PAY_EVM_CHAINS: добавьте bsc или polygon и перезагрузите Worker.',
  pay_chain_unknown: 'PAY_CHAIN не понятен: ожидаем tron, bsc или polygon.',
  payouts_disabled: 'Выплаты выключены (PAYOUTS_ENABLED=on не стоит): сбор это не касается, заявки просто не уходят в сеть.',
  payouts_stopped: 'Выплаты на стопе (флаг «Стоп выплат»): заявки накопятся, но в сеть не уйдут, пока не снимете стоп.',
  deposits_disabled: 'Приём депозитов выключен (DEPOSITS_ENABLED): новые поступления не увидим, старое на адресах — можно собрать.',
  purchases_disabled: 'Покупки выключены (PURCHASES_ENABLED): балансы не меняются, сбор это не трогает.',
  sweep_disabled: 'Сбор USDT выключен: нужен PAYMENTS_ENABLED=on и SWEEP_ENABLED=on. План («что соберём») доступен и без него.',
  signer_not_configured: 'Worker не видит Signer: нет привязки сервиса SIGNER или секрета SIGNER_TOKEN. Подписи нет — транзакции нет.',
  signer_unavailable: 'Signer не ответил: деньги не подписаны и не ушли. Проверьте, что воркер Signer задепложен.',
  signer_unreachable: 'Signer недоступен: ни одна подпись не получена, транзакции не уходили. Адреса можно пробовать снова.',
  tx_hash_mismatch: 'Нода назвала не тот хеш, что мы подписали: транзакцию не записываем как подтверждённую — сверьте на обозревателе вручную.',
  chain_error: 'Сеть не ответила или ответила непонятно: ничего не записано как успешное. Повторите позже — ключ операции защитит от двойного сбора.',
  no_candidates: 'Собирать нечего: на адресах нет USDT не меньше минимума, или нативки на газ не хватает (план показывает причины по каждому адресу).',
  address_not_ours: 'Этот адрес не из нашего дерева выводимых (pay_addresses): собрать его нельзя — чужой кошелёк.',
  sweep_in_progress: 'По этому адресу уже есть незакрытая попытка сбора: сначала дождитесь подтверждений сети, потом повторяйте.',
  bad_contract: 'Контракт USDT в запросе не совпадает с настроенным для сети: сбор остановлен, иначе перевод ушёл бы на чужой токен.',
  bad_destination_chain: 'Получатель указан для другой сети: адрес горячего кошелька обязан принадлежать той же сети, откуда собираем.',
  address_chain_mismatch: 'Адрес игрока относится к другой сети: в выборке этой сети его нет.',
  above_maximum: 'Сумма больше потолка одной операции: сделайте две записи или поднимите лимит осознанно.',
  bad_address: 'Не похож на адрес EVM: нужно 0x и 40 шестнадцатеричных символов.',
  bad_chain: 'Сеть не понята: для сбора бывают bsc и polygon.',
  bad_id: 'Не понят номер записи.',
  unknown_product: 'Товара с таким id нет: цены и товары читаются с сервера, а не с клиента.',
  not_reserved: 'Покупка уже не в состоянии «забронировано»: повторите операцию со свежими данными.',
  not_found: 'Записи нет: заявка или строка сбора не найдены. Обновите список.',
};
function errorText(data, status) {
  const code = data && data.error;
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  // Signer отвечает своим списком причин (`signer_<код>`), и перечислять его в
  // клиенте — верный способ однажды показать оператору `Отказ: signer_...`.
  // Смысл у группы один: подпись не выдана, значит деньги не ушли.
  if (typeof code === 'string' && code.startsWith('signer_')) {
    return `Signer отказал в подписи (${code.slice(7)}): транзакция не подписана и никуда не ушла.`;
  }
  return `Отказ: ${code || status}.`;
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
  if (role === 'owner') { $('#staff-block').hidden = false; $('#audit-block').hidden = false; $('#sweep-block').hidden = false; loadSweeps(); }
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
    tr.addEventListener('click', () => {
      $('#grant-player').value = p.id;
      $('#adj-player').value = p.id;
      markAdjDirty();
      adjBalance();
    });
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
  // Карточка и форма корректировки ищут игрока одинаково: держать два разных
  // ввода, где один уже заполнен, — способ списать не тому.
  $('#adj-player').value = p.id || '';
  markAdjDirty();
  adjBalance();
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
    if (role === 'owner') { $('#staff-block').hidden = false; $('#audit-block').hidden = false; loadStaff(); loadAudit(); loadSweeps(); }
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

// ── USDT: начислить или списать проводкой adjust ───────────────────────────
//
// Двухшаговость не для красоты. Первое: итог считает сервер (баланс «до», «станет»,
// сколько уже обещано незакрытым заявкам) — угадывать эти числа в браузере нельзя,
// потому что `payBalanceMicro` включает и резервы выплат. Второе: ключ
// идемпотентности переживает повторный клик — «Применить» дважды возвращает ту же
// запись вместо двойного списания, и именно поэтому повторный клик обязан идти с
// ТЕМ ЖЕ ключом, а не со свежим.
let adjKey = '';
let adjKeyUsed = false;
let adjReady = false;

function adjMarkKey() {
  if (!adjKey || adjKeyUsed) {
    adjKey = `adj-${Date.now().toString(36)}-${(crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))}`;
    adjKeyUsed = false;
  }
  return adjKey;
}

/** Цифры поменялись — превью больше не описывает эту операцию. */
function markAdjDirty() {
  adjReady = false;
  adjKeyUsed = true;
  $('#adj-confirm-wrap').hidden = true;
  $('#adj-confirm').value = '';
  $('#adj-preview').hidden = true;
}

function adjInput() {
  const player = $('#adj-player').value.trim();
  const amount = $('#adj-amount').value.trim();
  const reason = $('#adj-reason').value.trim();
  if (!player) { setText('#adj-status', ERROR_TEXT.bad_target); return null; }
  if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(amount) || Number(amount) === 0) {
    setText('#adj-status', 'Сумма — число до шести знаков после запятой (не ноль). Минус = списание.');
    return null;
  }
  if (reason.length < 3) { setText('#adj-status', ERROR_TEXT.reason_required); return null; }
  return { player, amount, reason };
}

/** «Баланс и заявка»: серверные лимиты, а не наши догадки. */
async function adjBalance() {
  const player = $('#adj-player').value.trim();
  if (!player) { setText('#adj-balance', 'Введите игрока — покажем баланс, лимит и незакрытые заявки.'); return; }
  setText('#adj-balance', 'Читаем баланс…');
  try {
    const { status, data } = await call(`/admin/pay/adjust?player=${encodeURIComponent(player)}`);
    if (status !== 200) { setText('#adj-balance', errorText(data, status)); return; }
    const p = data.player || {};
    setText('#adj-balance', p.id
      ? `Баланс ${p.balance} USDT, из них обещано заявкам на вывод ${p.pending} USDT — списать можно не больше ${p.canAdjustDown} USDT. Потолок одной операции: ${data.maxAdjust} USDT.`
      : `Потолок одной операции: ${data.maxAdjust} USDT. Игрока ещё не нашли.`);
  } catch (e) {
    setText('#adj-balance', `Сеть недоступна: ${e.message}.`);
  }
}

async function adjRun(dryRun) {
  const v = adjInput();
  if (!v) return;
  if (dryRun) adjMarkKey();
  else if (!adjKey) { setText('#adj-status', 'Сначала «Показать итог»: он считает числа, по которым вы решаете.'); return; }
  else if (!adjReady) { setText('#adj-status', 'Сумма или игрок изменились — нажмите «Показать итог» заново.'); return; }
  const btn = dryRun ? $('#adj-preview-btn') : $('#adj-apply');
  btn.disabled = true;
  setText('#adj-status', dryRun ? 'Считаем, что станет с балансом…' : 'Пишем проводку…');
  try {
    const { status, data } = await call('/admin/pay/adjust', {
      method: 'POST',
      body: JSON.stringify({ ...v, idem: adjKey, dryRun, confirm: $('#adj-confirm').value.trim() }),
    });
    if (status !== 200 && status !== 201) { setText('#adj-status', errorText(data, status)); return; }
    const a = data.adjust;
    totalsGrid($('#adj-preview'), [
      ['Направление', a.direction === 'debit' ? 'списание' : 'начисление'],
      ['Сумма', `${a.direction === 'debit' ? '−' : '+'}${a.delta} USDT`],
      ['Баланс был', `${a.balanceBefore} USDT`],
      ['Баланс станет', `${a.balanceAfter} USDT`],
      ['Обещано заявкам', `${a.pending} USDT`],
      ['Ключ операции', a.idemKey],
    ]);
    $('#adj-preview').hidden = false;
    // Превью прошло — значит именно эти числа и можно применить; меняем флаг
    // только здесь, а сбрасываем при любом изменении полей (markAdjDirty).
    if (dryRun) adjReady = true;
    if (dryRun) {
      $('#adj-confirm-wrap').hidden = false;
      setText('#adj-status', 'Это превью: в базе ничего не изменилось. Впишите ADJUST и нажмите «Применить».');
      $('#adj-confirm').focus();
    } else {
      adjKeyUsed = true;
      adjReady = false;
      $('#adj-confirm').value = '';
      $('#adj-confirm-wrap').hidden = true;
      setText('#adj-status', a.duplicated
        ? `Эта операция уже записана (ключ ${a.idemKey}) — ничего не удвоено. Баланс: ${a.balanceAfter} USDT.`
        : `Записано ${a.direction === 'debit' ? 'списание' : 'начисление'} ${a.delta} USDT: баланс ${a.balanceBefore} → ${a.balanceAfter} USDT. Причина: ${a.reason}.`);
      $('#adj-reason').value = '';
      load();
      findPlayer();
      adjBalance();
    }
  } catch (e) {
    setText('#adj-status', `Сеть недоступна: ${e.message}. ${dryRun ? '' : 'Повторите с тем же ключом — проводка либо есть, либо её нет.'}`);
  } finally {
    btn.disabled = false;
  }
}

$('#adj-preview-btn').addEventListener('click', () => adjRun(true));
$('#adj-apply').addEventListener('click', () => adjRun(false));
$('#adj-load').addEventListener('click', adjBalance);
$('#adj-flip').addEventListener('click', () => {
  const input = $('#adj-amount');
  input.value = String(-Math.abs(Number(input.value) || 0));
  markAdjDirty();
  setText('#adj-status', Number(input.value) < 0
    ? 'Режим списания: уйдёт с баланса игрока проводкой adjust.'
    : 'Режим начисления: придёт на баланс игрока.');
});
for (const sel of ['#adj-player', '#adj-amount', '#adj-reason']) {
  $(sel).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter — только посмотреть: деньги не должны записываться от случайного
    // нажатия «ввод» в поле суммы.
    adjRun(true);
  });
}
// А вот в поле подтверждения Enter означает «применяю»: слово уже введено,
// и требовать ещё один клик — просто плодить клики по деньгам.
$('#adj-confirm').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  adjRun(false);
});
for (const sel of ['#adj-player', '#adj-amount', '#adj-reason']) {
  $(sel).addEventListener('input', markAdjDirty);
}

// ── Сбор USDT с адресов приёма (sweep) ─────────────────────────────────────
//
// Единственное место админки, где Worker по нажатию кнопки подписывает и отправляет
// транзакцию. Отсюда три правила: `dryRun` по умолчанию, отдельное слово
// подтверждения и ключ операции на одну попытку. Ключ генерируется заново после
// живой сборки: «повторить то же самое» здесь означало бы «второй перевод», а
// сервер на открытый по адресу сбор ответит `sweep_in_progress` — это правильно,
// но объяснять его должен текст кнопки, а не догадки оператора.
let sweepKey = '';
let sweepReady = false;

function newSweepKey() {
  const rand = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  sweepKey = `swp-${Date.now().toString(36)}-${rand}`;
  sweepReady = false;
}

/** Любая правка в форме — превью больше не описывает этот сбор. */
function markSweepDirty() {
  sweepReady = false;
  $('#sweep-confirm-wrap').hidden = true;
  $('#sweep-confirm').value = '';
  $('#sweep-preview').hidden = true;
}

function sweepInput() {
  const chain = $('#sweep-chain').value;
  const address = $('#sweep-address').value.trim();
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    setText('#sweep-status', ERROR_TEXT.bad_address);
    return null;
  }
  return { chain, ...(address ? { address } : {}) };
}

function sweepChainLabel(chain) {
  return chain === 'polygon' ? 'Polygon' : 'BNB Chain';
}

function renderSweepLog(rows) {
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Запись</th><th>Сеть</th><th>Адрес</th><th>Сумма</th><th>Статус</th><th>Когда</th><th>Сеть</th></tr>';
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of [
      String(row.id || '').slice(0, 12),
      sweepChainLabel(row.chain),
      `${String(row.address || '').slice(0, 10)}…${String(row.address || '').slice(-4)}`,
      `${row.amount} USDT`,
      row.error ? `${row.status}: ${row.error}` : row.status,
      row.createdAt ? new Date(row.createdAt).toLocaleString('ru-RU') : '—',
    ]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    const linkCell = document.createElement('td');
    if (row.explorerTx) {
      const a = document.createElement('a');
      a.href = row.explorerTx;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = row.txid ? `${String(row.txid).slice(0, 10)}…` : 'открыть';
      linkCell.append(a);
    } else {
      linkCell.className = 'muted';
      linkCell.textContent = row.txid ? '—' : 'транзакции нет';
    }
    tr.append(linkCell);
    body.append(tr);
  }
  if (!body.children.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'muted';
    td.textContent = 'Строк сбора ещё нет: это значит, что кнопка «Собрать» не нажималась (или всё отказали до намерения).';
    tr.append(td);
    body.append(tr);
  }
  $('#sweep-log').replaceChildren(head, body);
}

/** «Обновить список сборов»: журнал намерений — что ушло, что висит, что отказало. */
async function loadSweeps() {
  const chain = $('#sweep-chain').value;
  setText('#sweep-status', 'Читаем журнал сборов…');
  try {
    const { status, data } = await call(`/admin/pay/sweeps?chain=${encodeURIComponent(chain)}&limit=20`);
    if (status !== 200) { setText('#sweep-status', errorText(data, status)); return; }
    const f = data.flags || {};
    setText('#sweep-flags', `Флаги: PAYMENTS_ENABLED=${f.payments ? 'on' : 'выкл'}, SWEEP_ENABLED=${f.sweep ? 'on' : 'выкл'}, `
      + `сеть ${f.network === 'mainnet' ? 'продакшн' : 'тестнет'}. За одно нажатие — до ${data.runLimit} адресов, `
      + `слово подтверждения — «${data.confirm}».`);
    renderSweepLog(data.sweeps || []);
    const open = (data.sweeps || []).filter((r) => r.status === 'queued' || r.status === 'broadcasting' || r.status === 'sent');
    setText('#sweep-status', open.length
      ? `Открытых сборов: ${open.length} — их сверит cron, повторно не собираем.`
      : 'Открытых сборов нет.');
  } catch (e) {
    setText('#sweep-status', `Сеть недоступна: ${e.message}.`);
  }
}

async function sweepRun(dryRun) {
  const v = sweepInput();
  if (!v) return;
  if (dryRun) newSweepKey();
  else if (!sweepKey) { setText('#sweep-status', 'Сначала «Показать, что соберём»: он читает балансы, по которым вы решаете.'); return; }
  else if (!sweepReady) { setText('#sweep-status', 'Сеть или адрес изменились — нажмите «Показать, что соберём» заново.'); return; }
  const btn = dryRun ? $('#sweep-plan-btn') : $('#sweep-run');
  btn.disabled = true;
  setText('#sweep-status', dryRun ? 'Читаем балансы адресов (ничего не подписываем)…' : 'Подписываем и отправляем сбор…');
  try {
    const { status, data } = await call('/admin/pay/sweep/run', {
      method: 'POST',
      body: JSON.stringify({ ...v, idem: sweepKey, dryRun, confirm: $('#sweep-confirm').value.trim() }),
    });
    if (status !== 200 && status !== 201) { setText('#sweep-status', errorText(data, status)); return; }
    const s = data.sweep || {};
    const rows = s.rows || [];
    const sent = rows.filter((r) => r.status !== 'skipped' && r.status !== 'would_sweep');
    totalsGrid($('#sweep-preview'), [
      ['Режим', dryRun ? 'просмотр' : 'сбор'],
      ['Сеть', sweepChainLabel(s.chain || v.chain)],
      ['Соберём', `${s.total || '0'} USDT`],
      ['Адресов', rows.length],
      ['Пропусков', (s.skipped || []).length + (s.unreadable || 0)],
      ['Минимум', `${s.minAmount} USDT`],
      ['Газ на перевод', `${s.gasLimit}`],
      ['Горячий кошелёк', s.destination || '—'],
      ['Ключ операции', sweepKey],
    ]);
    $('#sweep-preview').hidden = false;
    const why = (s.skipped || []).slice(0, 6).map((r) => `${r.address.slice(0, 10)}… ${r.reason}`);
    setText('#sweep-plan', why.length
      ? `Пропущено: ${why.join(', ')}${(s.skipped || []).length > 6 ? ' …' : ''}.`
      : 'Пропущенных адресов нет.');
    if (dryRun) {
      sweepReady = true;
      $('#sweep-confirm-wrap').hidden = false;
      $('#sweep-confirm').value = '';
      setText('#sweep-status', rows.length
        ? `Посмотрели: ${rows.length} адрес(ов) готовы, ${s.total || 0} USDT. Впишите ${data.confirm} и нажмите «Собрать» — это уже транзакции.`
        : 'Собирать нечего: адресов с USDT не меньше минимума и нативкой на газ нет.');
      $('#sweep-confirm').focus();
    } else {
      sweepReady = false;
      sweepKey = '';
      $('#sweep-confirm').value = '';
      $('#sweep-confirm-wrap').hidden = true;
      const failed = rows.filter((r) => r.status === 'failed');
      setText('#sweep-status', sent.length
        ? `Отправлено ${sent.length} из ${rows.length}: ${s.total || 0} USDT. Подтверждения допишет cron (статусы — в таблице ниже).${failed.length ? ` Отказали: ${failed.length}.` : ''}`
        : `Ничего не отправлено: ${rows.length ? 'все адреса отказали или уже в работе' : 'кандидатов не осталось'}.`);
      renderSweepLog(rows.map((r) => ({
        id: r.id, chain: s.chain, address: r.address, amount: r.amount,
        status: r.status, error: r.error, txid: r.txid, explorerTx: r.explorerTx, createdAt: Date.now(),
      })));
      loadPay();
      loadSweeps();
    }
  } catch (e) {
    setText('#sweep-status', `Сеть недоступна: ${e.message}. ${dryRun ? '' : 'Не повторяйте вслепую: откройте журнал сборов — транзакция либо есть, либо её нет.'}`);
  } finally {
    btn.disabled = false;
  }
}

$('#sweep-plan-btn').addEventListener('click', () => sweepRun(true));
$('#sweep-run').addEventListener('click', () => sweepRun(false));
$('#sweep-load').addEventListener('click', loadSweeps);
for (const sel of ['#sweep-chain', '#sweep-address']) {
  $(sel).addEventListener('change', markSweepDirty);
  $(sel).addEventListener('input', markSweepDirty);
  $(sel).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter — только просмотр: сбор денег не должен начинаться со случайного «ввод».
    sweepRun(true);
  });
}
// Enter в поле подтверждения — «подтверждаю»: слово уже набрано.
$('#sweep-confirm').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  sweepRun(false);
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
