// Анти-флуд затвор для анонимных маршрутов.
//
// Зачем, если уже есть бюджет (`ops/budget.ts`) и счётчики входа (`auth/rateLimit.ts`):
//
//   * Критичные маршруты — `/auth/*`, `/health`, `/ops/*`, `/pay/*`, `/admin*` —
//     сознательно не тратят суточный бюджет и не блокируются деградацией: в
//     плохой день игрок должен войти и забрать оплаченное. Цена решения — по ним
//     можно лупить сколько угодно, и лимит Cloudflare тут не помощник.
//   * Счётчик входа живёт в D1. Это правильно (он обязан видеть все изоляты), но
//     каждая проверка — это запрос в базу. Флуд на `/auth/login` поэтому стоит
//     не «ноль», а два-три обращения к D1 плюс 100 000 итераций PBKDF2 на тупик:
//     ровно тот случай, когда базу и CPU хотят выжечь.
//   * Неизвестный путь тоже не бесплатен: он проходит через бюджет (одна запись
//     на 20 запросов). Миллион 404-х — это 50 000 записей в D1.
//
// Поэтому здесь простейший token bucket **в памяти изолята**: ни одного обращения
// к базе, стоимость проверки — пара операций на запрос. Он не заменяет счётчики
// входа (те общие для всех изолятов и считают неудачные пароли), а отрезает
// именно ливень с одного адреса.
//
// Почему «в памяти» — это честно:
//   * лимит приблизительный: у каждого изолята свой бакет, поэтому реальный
//     потолок выше номинального в число живых изолятов раз. Для «защиты от ливня»
//     этого достаточно — флудер бьёт по одному IP непрерывно, и любой изолят его
//     увидит;
//   * состояние аутентификации и деньги по-прежнему решают D1-счётчики и токены,
//     тут нет ни прав, ни баланса — только «подожди секунду».
//
// Пороги подобраны так, чтобы живой человек и штатный клиент не упёрлись никогда:
// 60 запросов к входу в минуту на адрес — это попытка в секунду, с запасом на общий
// NAT в офисе или кампусе; 3 000 в минуту на прочие маршруты — в 50 раз больше,
// чем делает браузер. Нагрузочный тест
// (`npm run pay:loadtest -- --requests …`) сознательно поднимает потолок переменной
// `FLOOD_GLOBAL_PER_MIN`: замер с выключенным затвором честнее, чем 429-е в
// выборке.

import { json } from './response';
import { ipOf } from '../auth/rateLimit';

/** Самые дорогие анонимные маршруты: PBKDF2, DNS и записи в D1. */
export const AUTH_EXPENSIVE = ['/auth/login', '/auth/register'];

export const DEFAULT_AUTH_PER_MIN = 60;
export const DEFAULT_REFRESH_PER_MIN = 600;
export const DEFAULT_GLOBAL_PER_MIN = 3_000;

/** Шаг, которым возвращаются токены (дискретный refill вместо дробных миллисекунд). */
export const REFILL_STEP_MS = 2_000;
/** Как давно недоступный IP обязан вылететь из памяти. */
export const IDLE_EVICT_MS = 10 * 60 * 1000;
/** Потолок ключей: 20 000 бакетов — десятки килобайт на изолят. */
export const MAX_KEYS = 20_000;
/**
 * До скольки ужимать карту, когда потолка коснулись.
 *
 * Цифра меньше `MAX_KEYS` — это гистерезис: убирай по одному ключу на каждый
 * запрос, и сам затвор начал бы стоить дороже, чем ливень (полное сканирование
 * карты на каждом запросе). С запасом в четверть карты чистка нужна раз на
 * 5 000 новых адресов.
 */
export const EVICT_TO = Math.floor(MAX_KEYS * 0.75);

export type FloodKind = 'auth' | 'refresh' | 'global';

export interface FloodLimit {
  /** Запросов в минуту. */
  perMin: number;
  /** Насколько можно выстрелить сразу (всплеск после простоя). */
  burst: number;
}

export interface FloodVerdict extends FloodLimit {
  allowed: boolean;
  retryAfterSec: number;
}

export interface Bucket {
  tokens: number;
  /** До какого момента начисленные токены уже учтены. */
  filledAt: number;
  seenAt: number;
}

/**
 * Один шаг бакета. Чистая функция — вся логика «сколько можно» проверяется здесь,
 * без часов и без памяти изолята.
 *
 * Токены возвращаются шагами по `REFILL_STEP_MS`, а не непрерывно: на миллисекундах
 * за год накопилась бы погрешность, а игроку разница в две секунды не видна.
 */
export function takeToken(
  bucket: Bucket | null, limit: FloodLimit, now: number, stepMs = REFILL_STEP_MS,
): { bucket: Bucket; allowed: boolean; retryAfterMs: number } {
  const rate = limit.perMin / (60_000 / stepMs);
  const base: Bucket = bucket
    ? { tokens: bucket.tokens, filledAt: bucket.filledAt, seenAt: now }
    : { tokens: limit.burst, filledAt: now, seenAt: now };
  const steps = Math.max(0, Math.floor((now - base.filledAt) / stepMs));
  const tokens = Math.min(limit.burst, base.tokens + steps * rate);
  const filledAt = base.filledAt + steps * stepMs;
  if (tokens >= 1) return { bucket: { tokens: tokens - 1, filledAt, seenAt: now }, allowed: true, retryAfterMs: 0 };
  // Что-то начислилось, но меньше токена — состояние обновляем всё равно: иначе
  // отставание копится и бакет никогда не открывается.
  const need = 1 - tokens;
  const retryAfterMs = Math.max(stepMs, Math.ceil(need / rate) * stepMs);
  return { bucket: { tokens, filledAt, seenAt: now }, allowed: false, retryAfterMs };
}

/** Класс маршрута — от него зависит порог. */
export function bucketKind(pathname: string): FloodKind {
  const p = String(pathname ?? '/');
  if (AUTH_EXPENSIVE.includes(p)) return 'auth';
  if (p === '/auth/refresh' || p === '/auth/logout') return 'refresh';
  return 'global';
}

/** Число из конфига; мусор, ноль или отрицательное — значение по умолчанию. */
function num(raw: string | number | undefined | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(1_000_000, Math.floor(n));
}

export interface FloodEnvLike {
  FLOOD_AUTH_PER_MIN?: string | number;
  FLOOD_REFRESH_PER_MIN?: string | number;
  FLOOD_GLOBAL_PER_MIN?: string | number;
}

export function floodLimits(env: FloodEnvLike): Record<FloodKind, FloodLimit> {
  const auth = num(env.FLOOD_AUTH_PER_MIN, DEFAULT_AUTH_PER_MIN);
  const refresh = num(env.FLOOD_REFRESH_PER_MIN, DEFAULT_REFRESH_PER_MIN);
  const global = num(env.FLOOD_GLOBAL_PER_MIN, DEFAULT_GLOBAL_PER_MIN);
  // Всплеск = две минутные нормы. Меньше — клиент на слабой сети не переживёт
  // «загрузил страницу, не успел, повторил»; больше — флудер успеет сделать
  // слишком много до первого отказа.
  return {
    auth: { perMin: auth, burst: auth * 2 },
    refresh: { perMin: refresh, burst: refresh * 2 },
    global: { perMin: global, burst: global * 2 },
  };
}

export function retryAfterSec(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

export interface FloodGuard {
  check(ip: string, kind: FloodKind, now?: number): FloodVerdict;
  size(): number;
  reset(): void;
}

/**
 * Бакеты в памяти изолята с жёстким потолком размера.
 *
 * Вытеснение — по давности последнего запроса: флудер, который сыплет с тысячи
 * адресов, не может раздуть карту до неограниченного размера, а живой игрок
 * остаётся ровно до тех пор, пока стучится.
 */
export function createFloodGuard(limits: Record<FloodKind, FloodLimit>): FloodGuard {
  const buckets = new Map<string, Bucket>();

  const evict = (now: number): void => {
    if (buckets.size <= MAX_KEYS) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.seenAt > IDLE_EVICT_MS) buckets.delete(key);
    }
    // Все ключи свежие — режем самые старые, но сразу до `EVICT_TO`, иначе в
    // следующий же запрос пришлось бы резать снова.
    if (buckets.size > MAX_KEYS) {
      const byAge = [...buckets.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
      const drop = buckets.size - EVICT_TO;
      for (let i = 0; i < drop; i += 1) buckets.delete(byAge[i][0]);
    }
  };

  return {
    check(ip, kind, now = Date.now()) {
      const limit = limits[kind] ?? limits.global;
      const key = `${kind}|${ip}`;
      const outcome = takeToken(buckets.get(key) ?? null, limit, now);
      buckets.set(key, outcome.bucket);
      evict(now);
      return { ...limit, allowed: outcome.allowed, retryAfterSec: retryAfterSec(outcome.retryAfterMs) };
    },
    size: () => buckets.size,
    reset: () => buckets.clear(),
  };
}

let guard: FloodGuard | null = null;
let guardFingerprint = '';

/** Отпечаток конфига: поменяли переменные — бакеты пересоздаются. */
export function floodFingerprint(env: FloodEnvLike): string {
  const limits = floodLimits(env);
  return `${limits.auth.perMin}/${limits.refresh.perMin}/${limits.global.perMin}`;
}

export function guardFor(env: FloodEnvLike): FloodGuard {
  const fp = floodFingerprint(env);
  if (!guard || guardFingerprint !== fp) {
    guard = createFloodGuard(floodLimits(env));
    guardFingerprint = fp;
  }
  return guard;
}

export function resetFloodGuardForTests(): void {
  guard = null;
  guardFingerprint = '';
}

/**
 * Проверить запрос. `null` — пускаем; иначе готовый ответ `429`.
 *
 * `X-Astra-Flood: 1` — чтобы мониторинг (docs/MONITORING.md) отличал «игрока
 * отрезал ливень-затвор» от «перебрал личный частотный лимит» (`too_many_requests`
 * бывает и там, и там).
 */
export function floodCheck(request: Request, env: FloodEnvLike, pathname: string): Response | null {
  const ip = ipOf(request);
  const who = ip && ip.trim() ? ip.trim() : '';
  // IP нет — атрибуть запрос не на чем. Молча пропускаем: локальный запуск,
  // юнит-тесты и превью не должны ловить 429 из-за отсутствующего заголовка,
  // а на бою `CF-Connecting-IP` ставит сам Cloudflare.
  if (!who) return null;
  const verdict = guardFor(env).check(who, bucketKind(pathname));
  if (verdict.allowed) return null;
  return json(
    {
      ok: false,
      error: 'too_many_requests',
      scope: 'flood',
      perMin: verdict.perMin,
      retryAfter: verdict.retryAfterSec,
    },
    429,
    { 'Retry-After': String(verdict.retryAfterSec), 'X-Astra-Flood': '1', 'Cache-Control': 'no-store' },
  );
}
