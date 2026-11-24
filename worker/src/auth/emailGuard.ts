// Проверка почты при регистрации.
//
// Зачем: пока требование было «похоже на email», сюда писали `a@b.cc`,
// `qwe@asdasd.com` и сотни одноразовых ящиков — то есть фейковые аккаунты
// проходили и выгребали бонусы. Здесь четыре фильтра, и все они дешёвые:
//
// 1) формат — жёсткий ASCII-шаблон, а не «есть собачка и точка»;
// 2) домены-помойки — список известных одноразовых ящиков (он и ловит 90 % мусора);
// 3) домен принимает почту — обязан быть MX-запись (запрос через DNS-over-HTTPS
//    Cloudflare; ответа нет → отказ, `null MX` RFC 7505 тоже отказ);
// 4) адрес не алиас уже занятого — точки и `+хвост` нормализуются так же, как их
//    понимает Gmail, и ложатся в `users.email`, где стоит UNIQUE: дубль отсекает
//    сама база, отдельного поля не нужно.
//
// Чего здесь нет и не будет иллюзий: существования конкретного ящика. Без
// письма-подтверждения (или SMTP, а порт 25 в Workers доступен только на
// Enterprise) это не проверяется никак — см. docs/SECURITY.md, раздел «Регистрация».

/** Формат: локальная часть 1…64 из разрешённых символов, домен без подчёркиваний. */
export const EMAIL_STRICT =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;

/**
 * Одноразовые и «мусорные» почтовики. Список не полный и не претендует: он ловит
 * то, чем пользуются скрипты, а не то, чем пользуются люди.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  'grr.la', 'maildrop.cc', 'yopmail.com', 'yopmail.fr', '10minutemail.com',
  '20minutemail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'temp-mail.ru',
  'throwawaymail.com', 'throwaway.email', 'getnada.com', 'nada.email', 'mohmal.com',
  'emailondeck.com', 'trashmail.com', 'trashmail.de', 'dispostable.com', 'fakeinbox.com',
  'fakemail.net', 'mytemp.email', 'mailcatch.com', 'moakt.com', 'tempr.email',
  'tempm.com', 'mailnesia.com', 'mailsac.com', 'spam4.me', 'byom.de', '33mail.com',
  'inboxbear.com', 'mailzilla.com', 'guerrillamailblock.com', 'gustr.com', 'lanconship.com',
  'spamgourmet.com', 'mvrht.net', 'yopmail.co', 'dropmail.me', 'mailboxtemp.com',
  'receivemail.fr', 'tmpmail.org', 'tmpeml.com', '1secmail.com', 'incognitomail.org',
  'harakirimail.com', 'luxtr.dk', 'mailexpire.com', 'mailsloth.com', 'spamok.com',
]);

/**
 * Домены, где письма ходят точно: для них не действует суточный потолок
 * регистраций с одного домена (там и так миллионы людей).
 */
export const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru',
  'yandex.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'gmx.de', 'gmx.net', 'gmx.com',
  'web.de', 't-online.de', 'posteo.de', 'mailbox.org', 'freenet.de', 'mail.com',
  'wp.pl', 'onet.pl', 'interia.pl', 'poczta.onet.pl', 'seznam.cz', 'centrum.cz',
  'free.fr', 'orange.fr', 'laposte.net', 'wanadoo.fr', 'qq.com', '163.com', '126.com',
  'naver.com', 'daum.net', 'yahoo.co.jp', 'yahoo.fr', 'yahoo.de', 'yahoo.co.uk',
]);

/** Домены, где Gmail игнорирует точки в имени: ихRemoving-нормализация обязательна. */
const DOTTED_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

export type EmailProblem = 'bad_email' | 'disposable_email';

/** Что не так с адресом с точки зрения формата и списков. `null` — всё в порядке. */
export function emailProblem(email: string): EmailProblem | null {
  if (!EMAIL_STRICT.test(email)) return 'bad_email';
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  // Точка в начале/конце или двойная — уже не адрес, а конструктор дублей.
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return 'bad_email';
  // `+хвост` — не имя: если кроме него ничего не осталось, ящика не существует.
  if (!local.split('+')[0]) return 'bad_email';
  if (domain.startsWith('.') || domain.startsWith('-') || domain.includes('..')) return 'bad_email';
  // Запятая внутри домена — типичная подделка под «список получателей».
  if (domain.includes(',') || email.length > 254) return 'bad_email';
  if (DISPOSABLE_DOMAINS.has(domain)) return 'disposable_email';
  return null;
}

/**
 * Как почтовик видит этот адрес: `+хвост` отрезается у всех, точки внутри Gmail —
 * тоже, `googlemail.com` приводится к `gmail.com`, регистр не значим. Регистрация
 * алиаса после основного адреса упирается в `UNIQUE`, а вход алиасом находит
 * основной аккаунт.
 */
export function canonicalEmail(input: string): string {
  const email = input.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  let local = email.slice(0, at);
  const rawDomain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain;
  if (DOTTED_DOMAINS.has(domain)) local = local.replace(/\./g, '');
  // Пустая локальная часть после обрезки — значит адрес был `+tag@gmail.com`.
  return local ? `${local}@${domain}` : email;
}

export function isKnownProvider(domain: string): boolean {
  return KNOWN_PROVIDERS.has(domain);
}

// ── MX через DoH ───────────────────────────────────────────────────────────

/**
 * Кэш ответов в изоляте: запрос к DNS нужен раз на домен, а не на регистрацию.
 * Успех живёт 12 часов, «почты нет» — 15 минут (домен могли настроить только
 * что), сетевой сбой не кэшируется вовсе, чтобы повтор игрока не уткнулся в
 * закешированную ошибку.
 */
const TTL_OK_MS = 12 * 3600_000;
const TTL_BAD_MS = 15 * 60_000;
const CACHE_MAX = 2000;
const cache = new Map<string, { ok: boolean; at: number }>();

export interface MxResult { ok: boolean; reason?: 'no_mx' | 'email_check_unavailable' }

/** Только для тестов: чистим кэш, чтобы кейсы не зависели друг от друга. */
export function clearMxCache(): void {
  cache.clear();
}

function dnsUrl(name: string, type: number): string {
  return `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
}

interface DnsJson { Status?: number; Answer?: { type?: number; data?: string }[] }

/**
 * Принимает ли домен почту. Отвечаем «нет» на отсутствие MX: домены, которые
 * сознательно не принимают почту, объявляют `null MX` (RFC 7505), а те, у кого
 * MX нет вовсе, обычно вообще не почтовые.
 */
export async function domainAcceptsMail(domain: string, fetchImpl: typeof fetch = fetch): Promise<MxResult> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_OK_MS : TTL_BAD_MS)) return { ok: hit.ok, reason: hit.ok ? undefined : 'no_mx' };
  let json: DnsJson;
  try {
    const res = await fetchImpl(dnsUrl(domain, 15), {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, reason: 'email_check_unavailable' };
    json = await res.json() as DnsJson;
  } catch {
    // DNS не ответил — это не «почты нет». Честнее отказать и попросить повтор,
    // чем пропустить толпу фейков в тот момент, когда проверка слепа.
    return { ok: false, reason: 'email_check_unavailable' };
  }
  const status = Number(json.Status ?? -1);
  if (status !== 0) {
    // 3 = NXDOMAIN: домена нет вообще. Остальное — сбой resolver'а, просим повтор.
    if (status === 3) return refuseMail(domain);
    return { ok: false, reason: 'email_check_unavailable' };
  }
  const answers = Array.isArray(json.Answer) ? json.Answer : [];
  const mx = answers.filter((a) => Number(a.type) === 15 && typeof a.data === 'string');
  // `0 .` — отказ принимать почту (RFC 7505): такой адрес не существует по определению.
  const real = mx.filter((a) => !/^\s*0\s+\.?\s*$/.test(String(a.data)));
  if (!real.length) return refuseMail(domain);
  cache.set(domain, { ok: true, at: Date.now() });
  if (cache.size > CACHE_MAX) {
    // Map помнит порядок вставки: выкидываем самые старые ключи.
    for (const key of cache.keys()) { if (cache.size <= CACHE_MAX) break; cache.delete(key); }
  }
  return { ok: true };
}

/** «Почты тут нет» — и запись в кэш, чтобы не долбить DNS по каждому чужому домену. */
function refuseMail(domain: string): MxResult {
  cache.set(domain, { ok: false, at: Date.now() });
  return { ok: false, reason: 'no_mx' };
}

/**
 * Строгий контур регистрации: проверка MX и потолок регистраций на домен. По
 * умолчанию включён; `SIGNUP_GUARD = "off"` выключает обе — это режим локального
 * запуска и e2e, где DNS недоступен, а八-попытковый потолок сбивал бы каждую
 * восьмую проверку подряд. Формат адреса, список одноразовых ящиков и
 * нормализация алиасов остаются включёнными всегда: они ничего не стоят.
 *
 * Боевое окружение ничего не настраивает: значит контур включён.
 */
export function signupGuardEnabled(env: { SIGNUP_GUARD?: string }): boolean {
  return String(env.SIGNUP_GUARD ?? 'on').trim().toLowerCase() !== 'off';
}
