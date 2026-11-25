// Отдача встроенного клиента (то, что `scripts/embed-client.mjs` сложил в
// `static/site.ts`). Модуль сознательно чистый — ни D1, ни `cloudflare:workers`:
// так заголовки страниц проверяются обычным юнит-тестом (`staticPages.test.ts`),
// а не только «глазами на проде».
import { securityHeaders } from './security';
import { SITE_FILES } from '../static/site';

/**
 * Страницы, закрытые от индексирования. Витрина пополнения — про «выведи USDT»,
 * в выдаке это магнит для сайтов-клонов; админка не должна светиться вообще.
 * `pool.html` открыт намеренно: публичный отчёт пула существует для проверяющих.
 */
export const NO_INDEX_PAGES = new Set(['/pay.html', '/admin.html']);

export function staticResponse(pathname: string, method: string): Response | null {
  const path = pathname === '/' ? '/index.html' : pathname;
  const file = SITE_FILES[path];
  // Отдача строго по точному ключу из `SITE_FILES`: путь не склеивается и не
  // нормализуется, поэтому `/../worker/src/env.ts`, `//etc/passwd` и `%2e%2e%2f`
  // просто не находят файла (проверено тестом).
  if (!file) return null;
  const headers: Record<string, string> = {
    'Content-Type': file.type,
    'Cache-Control': 'no-cache',
    ...securityHeaders(),
  };
  // Метатег <meta name="robots"> дублирует это в разметке, но заголовок надёжнее:
  // его нельзя «забыть при правке HTML».
  if (NO_INDEX_PAGES.has(path)) headers['X-Robots-Tag'] = 'noindex';
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(file.body, { status: 200, headers });
}
