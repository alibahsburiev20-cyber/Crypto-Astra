// Мини-i18n для страниц без сборщика.
//
// Полный перевод игры — отдельная работа: там сотни строк внутри рендера. Здесь
// закрыт витринный контур (pay.html), потому что именно его видит новый игрок и
// покупатель. Ключи живут в data-i18n, выбор языка — в localStorage.
//
// Правила: не переводим юридические страницы (они на немецком по закону) и не
// подменяем серверные тексты — только статическую разметку.

export const LANGS = ['ru', 'en', 'de'];

const DICT = {
  ru: {
    'nav.game': 'В игру',
    'nav.pool': 'Пул',
    'pay.tagline': 'Astra Pay · магазин',
    'pay.kicker': 'Магазин внешнего вида',
    'pay.lead': 'Здесь покупается только внешний вид: корпуса кораблей, значки и разовые услуги. Купленное не даёт преимуществ и не превращается в деньги. ASTRA по-прежнему нельзя купить или вывести.',
    'wallet.title': 'Кошелёк',
    'wallet.hint': 'Войдите в игру, чтобы увидеть баланс.',
    'wallet.login': 'Войти',
    'deposit.title': 'Пополнить баланс',
    // Сеть здесь не называется намеренно: её показывает сервер (`networkLabel`).
    // Живой текст «TRC-20» пережил бы переезд на BEP-20 и соврал бы игроку.
    'deposit.lead': 'Пополнение идёт переводом USDT на личный адрес игрока. Адрес выдаётся один раз на сеть и не меняется: по нему сервер узнаёт, чей это перевод. Сеть указана под адресом — другая сеть или другая монета не дойдут, а адрес каждой сети свой.',
    'deposit.address': 'Войдите в игру, чтобы получить адрес.',
    'deposit.get': 'Получить адрес',
    'deposit.copy': 'Скопировать',
    'deposit.qrHint': 'Наведите камеру кошелька на код: в нём только ваш адрес, суммы в нём нет.',
    'deposit.qrAlt': 'QR код адреса пополнения',
    'deposit.explorer': 'Проверить адрес в эксплорере',
    'history.tx': 'перевод',
    'deposit.copied': 'Скопировано',
    'deposit.note': 'Сеть и токен — под адресом. Зачисление после подтверждений сети; отправляйте целое число USDT.',
    'shop.title': 'Витрина',
    'shop.loading': 'Загружаем каталог…',
    'history.title': 'Последние операции',
    'history.date': 'Дата',
    'history.what': 'Что',
    'history.amount': 'Сумма',
    'history.empty': 'Пока операций нет.',
    'skins.title': 'На что покупаются скины',
    'rules.title': 'Честно о деньгах',
  },
  en: {
    'nav.game': 'Play',
    'nav.pool': 'Pool',
    'pay.tagline': 'Astra Pay · shop',
    'pay.kicker': 'Cosmetics store',
    'pay.lead': 'Only appearance is sold here: ship hulls, badges and one-off services. Purchases give no advantage and never turn into money. ASTRA still cannot be bought or withdrawn.',
    'wallet.title': 'Wallet',
    'wallet.hint': 'Sign in to see your balance.',
    'wallet.login': 'Sign in',
    'deposit.title': 'Top up balance',
    'deposit.lead': 'Top-ups are USDT transfers to your personal address. Each network gets its own address, issued once and never changed: it is how the server knows whose transfer it is. The network is shown under the address — a different network or coin will not arrive.',
    'deposit.address': 'Sign in to get your address.',
    'deposit.get': 'Get address',
    'deposit.copy': 'Copy',
    'deposit.qrHint': 'Point your wallet camera at the code: it holds your address only, no amount.',
    'deposit.qrAlt': 'Deposit address QR code',
    'deposit.explorer': 'Check the address on the explorer',
    'history.tx': 'transfer',
    'deposit.copied': 'Copied',
    // Сеть здесь не называется намеренно: её даёт сервер. Зашитый «TRON (TRC-20)»
    // пережил бы переезд на BEP-20 и соврал бы игроку до первого ответа API.
    'deposit.note': 'Network and token are shown under the address. Credited after network confirmations; send a whole number of USDT.',
    'shop.title': 'Store',
    'shop.loading': 'Loading catalogue…',
    'history.title': 'Recent transactions',
    'history.date': 'Date',
    'history.what': 'Item',
    'history.amount': 'Amount',
    'history.empty': 'No transactions yet.',
    'skins.title': 'What skins affect',
    'rules.title': 'Honest about money',
  },
  de: {
    'nav.game': 'Spielen',
    'nav.pool': 'Pool',
    'pay.tagline': 'Astra Pay · Shop',
    'pay.kicker': 'Kosmetik-Shop',
    'pay.lead': 'Hier wird nur Aussehen verkauft: Schiffshüllen, Abzeichen und einmalige Dienste. Käufe bringen keinen Vorteil und werden nie zu Geld. ASTRA kann weiterhin weder gekauft noch ausgezahlt werden.',
    'wallet.title': 'Guthaben',
    'wallet.hint': 'Melde dich an, um dein Guthaben zu sehen.',
    'wallet.login': 'Anmelden',
    'deposit.title': 'Guthaben aufladen',
    'deposit.lead': 'Aufgeladen wird per USDT-Überweisung an deine persönliche Adresse. Jedes Netz hat eine eigene Adresse; sie wird einmal vergeben und bleibt gleich: daran erkennt der Server, wessen Überweisung es ist. Das Netz steht unter der Adresse — ein anderes Netz oder eine andere Münze kommt nicht an.',
    'deposit.address': 'Melde dich an, um die Adresse zu erhalten.',
    'deposit.get': 'Adresse anfordern',
    'deposit.copy': 'Kopieren',
    'deposit.qrHint': 'Richte die Wallet-Kamera auf den Code: er enthält nur deine Adresse, keinen Betrag.',
    'deposit.qrAlt': 'QR-Code der Einzahlungsadresse',
    'deposit.explorer': 'Adresse im Explorer prüfen',
    'history.tx': 'Transfer',
    'deposit.copied': 'Kopiert',
    'deposit.note': 'Netz und Token stehen unter der Adresse. Gutschrift nach Bestätigung im Netz; ganze Anzahl USDT senden.',
    'shop.title': 'Shop',
    'shop.loading': 'Katalog wird geladen…',
    'history.title': 'Letzte Transaktionen',
    'history.date': 'Datum',
    'history.what': 'Position',
    'history.amount': 'Betrag',
    'history.empty': 'Noch keine Transaktionen.',
    'skins.title': 'Was Skins bewirken',
    'rules.title': 'Ehrlich über Geld',
  },
};

/** Язык из localStorage, иначе из браузера, иначе русский. */
export function pickLang(saved, navigatorLang) {
  if (LANGS.includes(saved)) return saved;
  const base = String(navigatorLang || '').toLowerCase().slice(0, 2);
  return LANGS.includes(base) ? base : 'ru';
}

/** Перевод по ключу; неизвестный ключ возвращает сам ключ, а не пустоту. */
export function t(lang, key) {
  const table = DICT[LANGS.includes(lang) ? lang : 'ru'];
  return table[key] ?? DICT.ru[key] ?? key;
}

/**
 * Проставляет переводы в документ.
 * @param {Document} doc
 * @param {string} lang
 */
export function applyI18n(doc, lang) {
  doc.documentElement.lang = lang;
  for (const node of doc.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    if (key) node.textContent = t(lang, key);
  }
  for (const node of doc.querySelectorAll('[data-i18n-placeholder]')) {
    const key = node.getAttribute('data-i18n-placeholder');
    if (key) node.setAttribute('placeholder', t(lang, key));
  }
  for (const node of doc.querySelectorAll('[data-lang]')) {
    const active = node.getAttribute('data-lang') === lang;
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  return lang;
}
