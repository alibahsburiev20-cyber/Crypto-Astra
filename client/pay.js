// Витрина Astra Pay (этап 7).
//
// Браузер ничего не считает и ничем не распоряжается: он показывает то, что
// отдал сервер, и отправляет `productId` + ключ идемпотентности. Цены, баланс и
// правила покупки живут на сервере — подменить их из консоли нельзя.
//
// Токен берём обновлением сессии: refresh-cookie помечена HttpOnly, поэтому
// чужой скрипт её не прочитает и украсть вход не сможет.

import { applyI18n, pickLang, t } from '/i18n.js';

const $ = (selector) => document.querySelector(selector);
const $all = (selector) => Array.from(document.querySelectorAll(selector));

let token = '';
let lang = 'ru';

/** Язык интерфейса: выбор игрока важнее языка браузера. */
function setLang(next) {
  lang = applyI18n(document, next);
  try { localStorage.setItem('astra:lang', lang); } catch { /* приватный режим */ }
}

function initialLang() {
  let saved = null;
  try { saved = localStorage.getItem('astra:lang'); } catch { /* приватный режим */ }
  return pickLang(saved, navigator.language);
}

function setText(selector, text) {
  for (const node of $all(selector)) node.textContent = text;
}

function newKey() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* старый браузер — падаем на ручной ключ */ }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { credentials: 'include', ...options, headers });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

/** Обновление сессии: если cookie жива — получим токен, иначе предложим войти. */
async function bootSession() {
  const res = await api('/auth/refresh', { method: 'POST' });
  if (res.ok && res.data?.access_token) {
    token = res.data.access_token;
    return true;
  }
  return false;
}

const REASON_TEXT = {
  deposit: 'Пополнение',
  purchase: 'Покупка',
  payout: 'Вывод',
  fee: 'Комиссия',
  adjust: 'Корректировка',
  pool: 'Пул',
  sweep: 'Перенос в казну',
};

// Свои спрайты для косметики. Если спрайта нет — остаётся emoji из каталога,
// чтобы витрина не ломалась при добавлении товара.
function itemIcon(product) {
  const sprite = {
    skin_nebula: '/sprites/cosmetics/skin_nebula.png',
    skin_ember: '/sprites/cosmetics/skin_ember.png',
    badge_pioneer: '/sprites/cosmetics/badge_pioneer.png',
  }[product.id];
  if (!sprite) return null;
  const img = document.createElement('img');
  img.src = sprite;
  img.alt = '';
  img.width = 72;
  img.height = 72;
  img.loading = 'lazy';
  return img;
}

function renderProducts(catalog, purchasesEnabled, walletsReady = true) {
  const host = $('[data-pay="products"]');
  if (!host) return;
  host.innerHTML = '';
  const products = Array.isArray(catalog?.products) ? catalog.products : [];

  if (!products.length) {
    host.innerHTML = '<p class="pay-muted">Каталог пуст: товары появятся позже.</p>';
    return;
  }

  for (const product of products) {
    const card = document.createElement('article');
    card.className = 'pay-card';

    const art = document.createElement('div');
    art.className = 'pay-art';
    const sprite = itemIcon(product);
    if (sprite) art.append(sprite);
    else art.textContent = product.icon || '✦';

    const title = document.createElement('h4');
    title.textContent = product.title;

    const desc = document.createElement('p');
    desc.className = 'pay-desc';
    desc.textContent = product.description;

    const foot = document.createElement('div');
    foot.className = 'pay-card-foot';

    const price = document.createElement('span');
    price.className = 'pay-price';
    price.textContent = `${product.price} USDT`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cta cta-small';
    // Оплата может быть включена, а кошельки — ещё нет (не настроен Signer).
    // Честнее показать «Нужен кошелёк», чем дать нажать и получить отказ.
    button.textContent = !purchasesEnabled ? 'Скоро' : walletsReady ? 'Купить' : 'Нужен кошелёк';
    button.disabled = !purchasesEnabled || !walletsReady || !token;
    if (purchasesEnabled && !walletsReady) {
      button.title = 'Кошельки выдаются после настройки Signer — шаги в docs/PAY-SIGNER.md';
    }
    button.addEventListener('click', () => buy(product, button));

    foot.append(price, button);
    card.append(art, title, desc, foot);
    host.append(card);
  }
}

function renderHistory(history) {
  const body = $('[data-pay="history"]');
  if (!body) return;
  const rows = Array.isArray(history) ? history : [];
  body.innerHTML = '';
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3" class="pay-muted">Пока операций нет.</td></tr>';
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    const date = document.createElement('td');
    date.textContent = new Date(row.createdAt).toLocaleString('ru-RU');
    const what = document.createElement('td');
    what.textContent = REASON_TEXT[row.reason] || row.reason;
    const sum = document.createElement('td');
    sum.className = row.delta > 0 ? 'pay-plus' : 'pay-minus';
    sum.textContent = `${row.delta > 0 ? '+' : ''}${row.amount} USDT`;
    tr.append(date, what, sum);
    body.append(tr);
  }
}

async function loadAccount() {
  if (!token) {
    setText('[data-pay="balance"]', '—');
    setText('[data-pay="wallet-hint"]', 'Войдите в игру, чтобы увидеть баланс.');
    return;
  }
  const res = await api('/pay/account.json');
  if (!res.ok) {
    setText('[data-pay="wallet-hint"]', 'Не удалось загрузить баланс.');
    return;
  }
  setText('[data-pay="balance"]', `${res.data.balance} USDT`);
  setText(
    '[data-pay="wallet-hint"]',
    res.data.purchasesEnabled ? 'USDT зачисляются из подтверждённых переводов на ваш адрес.' : 'Покупки выключены в этой сборке.',
  );
  const premium = res.data.premium;
  setText(
    '[data-pay="premium"]',
    premium?.active
      ? `Premium активен${premium.until ? ` до ${new Date(premium.until).toLocaleDateString('ru-RU')}` : ''}.`
      : 'Premium не активен: 5 USDT за 30 дней — значок, эксклюзивный корпус, +1 ячейка гаража и +2 попытки арены.',
  );
  renderHistory(res.data.history);
}

const ERROR_TEXT = {
  insufficient_funds: 'Не хватает USDT на балансе.',
  unknown_product: 'Такого товара нет.',
  bad_idem_key: 'Ошибка ключа покупки — обновите страницу.',
  purchases_disabled: 'Покупки выключены в этой сборке.',
};

async function buy(product, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Покупаем…';
  const res = await api('/pay/purchase', {
    method: 'POST',
    headers: { 'Idempotency-Key': newKey() },
    body: JSON.stringify({ productId: product.id }),
  });
  if (res.ok) {
    button.textContent = 'Куплено';
    setText('[data-pay="wallet-hint"]', `${product.title}: выдано. Баланс ${res.data.balance} USDT.`);
    await loadAccount();
    return;
  }
  button.textContent = original;
  button.disabled = false;
  const message = ERROR_TEXT[res.data?.error] || 'Не получилось: попробуйте позже.';
  setText('[data-pay="wallet-hint"]', message);
}

// Адрес пополнения. До этого экрана игрок физически не мог пополнить баланс:
// маршрут на сервере был, а кнопки не было.
const DEPOSIT_ERRORS = {
  signer_not_configured: 'Адрес выдаётся после настройки Signer. Пока кошелёк не готов — пополнение недоступно.',
  // Причины, по которым сервер принципиально не выдаёт адрес. Каждая из них
  // значит «деньги уйдут в никуда», поэтому формулировка обязана быть человеческой.
  bsc_rail_not_wired: 'Выплаты в этой сети ещё настраиваются: адрес пока не выдаётся.',
  bsc_contract_missing: 'Для этой сети не задан контракт USDT — приём выключен намеренно.',
  usdt_contract_missing: 'Сервер не знает, какой контракт считать USDT — приём выключен.',
  pay_chain_unknown: 'В настройках указана неизвестная сеть, поэтому деньги не принимаются.',
  signer_unavailable: 'Сервис подписи недоступен. Попробуйте позже.',
  deposits_disabled: 'Приём USDT выключен в этой сборке.',
  pay_unavailable: 'Платёжная база недоступна. Попробуйте позже.',
  no_session: 'Войдите в игру, чтобы получить адрес.',
};

function addressBlock(state) {
  const node = $('[data-pay="address"]');
  if (node) {
    node.textContent = state.address;
    node.classList.toggle('is-ready', state.ready);
  }
  const copy = $('[data-pay="copy-btn"]');
  if (copy) copy.hidden = !state.ready;
  const note = $('[data-pay="deposit-note"]');
  if (note && state.note) note.textContent = state.note;
  const button = $('[data-pay="address-btn"]');
  if (button) {
    button.disabled = !state.canAsk;
    button.textContent = state.ready ? 'Адрес получен' : t(lang, 'deposit.get');
  }
}

async function loadDeposit() {
  if (!token) {
    addressBlock({
      address: t(lang, 'deposit.address'),
      ready: false, canAsk: false,
      note: t(lang, 'deposit.note'),
    });
    return;
  }
  const res = await api('/pay/address.json');
  if (res.ok) {
    addressBlock({
      address: res.data.address,
      ready: true,
      canAsk: false,
      // Сеть приходит с сервера. Раньше она выводилась из пути в URL и из
      // зашитого «TRON mainnet» — при смене цепи это означало бы «на экране одна
      // сеть, а деньги идут в другую».
      note: networkNote(res.data, lang),
    });
    return;
  }
  addressBlock({
    address: lang === 'en' ? 'Address is not available yet.' : 'Адрес пока недоступен.',
    ready: false,
    canAsk: true,
    note: DEPOSIT_ERRORS[res.data?.error] || (lang === 'en' ? 'No response. Try again later.' : 'Сервис не ответил. Попробуйте позже.'),
  });
}

function wireDeposit() {
  const button = $('[data-pay="address-btn"]');
  if (button) button.addEventListener('click', () => { button.disabled = true; loadDeposit(); });
  const copy = $('[data-pay="copy-btn"]');
  if (copy) copy.addEventListener('click', async () => {
    const node = $('[data-pay="address"]');
    const text = node ? node.textContent.trim() : '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = t(lang, 'deposit.copied');
      setTimeout(() => { copy.textContent = t(lang, 'deposit.copy'); }, 1600);
    } catch {
      copy.textContent = 'Выделите адрес вручную';
    }
  });
}

/** Строка под адресом: сеть, контракт и предупреждение про дробную часть. */
function networkNote(data, lang) {
  const label = data.networkLabel || data.network || '—';
  const contract = data.contract ? `, контракт ${data.contract}` : '';
  // На 18-значной сети хвост отбрасывается: «1.0000000000005» зачислится как «1».
  const rounding = Number(data.decimals) > 6
    ? (lang === 'en' ? ' Send a whole number: the fraction is not credited.' : ' Отправляйте целое число USDT: дробная часть не зачислится.')
    : '';
  return lang === 'en'
    ? `Network: ${label}. Token: USDT${contract}.${rounding}`
    : `Сеть: ${label}. Токен: USDT${contract}.${rounding}`;
}

async function boot() {
  const [catalog, session] = await Promise.all([api('/pay/products.json'), bootSession()]);

  if (catalog.ok) {
    setText('[data-pay="network"]', `Сеть: ${catalog.data.networkLabel || 'по данным сервера'}`);
    const walletsReady = catalog.data.wallets === 'ready';
    setText(
      '[data-pay="purchases"]',
      !catalog.data.purchasesEnabled
        ? 'Покупки: выключены'
        : walletsReady
          ? 'Покупки: включены'
          : 'Покупки: включены · кошельки: нужен Signer',
    );
    renderProducts(catalog.data, Boolean(catalog.data.purchasesEnabled), walletsReady);
  } else {
    setText('[data-pay="network"]', 'Сервис недоступен');
    setText('[data-pay="purchases"]', 'Покупки: выключены');
    renderProducts({ products: [] }, false, false);
  }

  setLang(initialLang());
  for (const b of $all('[data-lang]')) {
    b.addEventListener('click', () => { setLang(b.dataset.lang); loadDeposit(); });
  }
  wireDeposit();
  await loadDeposit();
  if (session) await loadAccount();
  else {
    setText('[data-pay="wallet-hint"]', 'Войдите в игру, чтобы увидеть баланс.');
    await loadAccount();
  }
}

boot();
