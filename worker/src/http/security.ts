// Заголовки безопасности — единый источник истины.
//
// Почему отдельный файл: их раздают и API (`http/response.ts`), и статика
// (`index.ts`), а `client/_headers` — зеркало для Pages. Три места с одной
// строкой неизбежно разъезжаются, и разъезжаются молча: CSP в одном месте,
// `nosniff` в другом, HSTS вообще забыт. Тест `attackSurface.test.ts` сверяет
// все три, поэтому добавить заголовок «только на одном маршруте» не выйдет.
//
// Что тут есть и чего нет сознательно:
//  • CSP без `unsafe-inline` и без `unsafe-eval`. Клиент собирает DOM через
//    `el()` и `textContent`, инлайновых обработчиков нет; CSSOM-свойства
//    (`fill.style.width`) политика не запрещает.
//  • В `script-src` только свой.origin и Turnstile. **Перед включением рекламной
//    сети сюда надо добавить адрес паблишера** — иначе скрипт рекламы будет
//    молча заблокирован (см. `docs/ADS.md`).
//  • `frame-ancestors 'none'` + `X-Frame-Options: DENY` — кликджекинг: клиника
//    игры не должна быть ничьим iframe.
//  • `Permissions-Policy` выключает всё, что игре не нужно (камера, микрофон,
//    геолокация, платёжный API, сенсоры). Буфер обмена не трогаем: им пользуются
//    «скопировать код гильдии» и адрес кошелька.

/** Разрешённые источники фреймов Turnstile. Совпадают для API и статики. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  // `object-src` не пускает Flash-подобные плагины; `upgrade-insecure-requests`
  // держит всё на HTTPS, даже если кто-то наберёт http://.
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** Год без HTTP: Cloudflare сам редиректит на HTTPS, но заголовок обязан быть у источника. */
export const HSTS = 'max-age=31536000';

const PERMISSIONS_POLICY = [
  'camera=()', 'microphone=()', 'geolocation=()', 'payment=()',
  'usb=()', 'serial=()', 'hid=()', 'bluetooth=()',
  'accelerometer=()', 'gyroscope=()', 'magnetometer=()',
  'fullscreen=()', 'wallpaper=()', 'idle-detection=()',
].join(', ');

/** Полный набор — для HTML и статики. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  // Ресурс виден только тому же origin: защита от «встрой чужой JSON картинкой».
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Политика для /crossdomain.xml — «нет». Устарело, но дешёво.
  'X-Permitted-Cross-Domain-Policies': 'none',
};

/** То же плюс HSTS — один список на все ответы, чтобы не плодать варианты. */
export function securityHeaders(): Record<string, string> {
  return { ...SECURITY_HEADERS, 'Strict-Transport-Security': HSTS };
}
