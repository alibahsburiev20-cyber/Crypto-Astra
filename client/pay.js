// Витрина Astra Pay (этап 7).
//
// Браузер ничего не считает и ничем не распоряжается: он показывает то, что
// отдал сервер, и отправляет `productId` + ключ идемпотентности. Цены, баланс и
// правила покупки живут на сервере — подменить их из консоли нельзя.
//
// Токен берём обновлением сессии: refresh-cookie помечена HttpOnly, поэтому
// чужой скрипт её не прочитает и украсть вход не сможет.

const $ = (selector) => document.querySelector(selector);
const $all = (selector) => Array.from(document.querySelectorAll(selector));

let token = '';

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

async function boot() {
  const [catalog, session] = await Promise.all([api('/pay/products.json'), bootSession()]);

  if (catalog.ok) {
    const network = location.pathname.includes('nile') ? 'nile' : 'по данным сервера';
    setText('[data-pay="network"]', `Сеть: ${network}`);
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

  if (session) await loadAccount();
  else {
    setText('[data-pay="wallet-hint"]', 'Войдите в игру, чтобы увидеть баланс.');
    await loadAccount();
  }
}

boot();
