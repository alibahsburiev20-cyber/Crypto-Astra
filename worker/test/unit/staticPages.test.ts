// Отдача встроенных страниц: заголовки, алиасы и «ничего лишнего».
//
// `worker/src/http/static.ts` — единственный путь, по которому браузер получает
// HTML и JS. Живёт он на том же Worker, что и API, поэтому сюда приходят и
// сканеры, и случайные переходы по «очевидным» адресам. Проверяем три вещи:
// служебные страницы закрыты от индексации, короткие адреса ведут ровно туда,
// куда заявлено, и никакого «добавим .html сами» в резолвере нет.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_INDEX_PAGES, PAGE_ALIASES, staticResponse } from '../../src/http/static';
import { SITE_FILES } from '../../src/static/site';

const headersFile = readFileSync(new URL('../../../client/_headers', import.meta.url), 'utf8');

/** Пути, для которых `_headers` объявляет `X-Robots-Tag: noindex`. */
function noindexInHeadersFile(): Set<string> {
  const paths = new Set<string>();
  let pending: string[] = [];
  for (const line of headersFile.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const text = line.trim();
    // В `_headers` блок — это список путей и строки заголовков; заголовки
    // относятся ко всем путям блока, поэтому путь «сбрасывается» после пары.
    if (text.startsWith('/')) { pending.push(text); continue; }
    if (/X-Robots-Tag:\s*noindex/i.test(line)) {
      for (const path of pending) paths.add(path);
      pending = [];
      continue;
    }
    if (line.startsWith('  ')) continue;
    pending = [];
  }
  return paths;
}

describe('отдача страниц', () => {
  it('служебные страницы закрыты от индексации, публичные — нет', () => {
    expect(staticResponse('/admin.html', 'GET')?.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(staticResponse('/pay.html', 'GET')?.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(staticResponse('/pool.html', 'GET')?.headers.get('X-Robots-Tag')).toBeNull();
    expect(staticResponse('/index.html', 'GET')?.headers.get('X-Robots-Tag')).toBeNull();
  });

  it('алиасы существуют, чтобы ссылку на админку можно было переслать словом', () => {
    // `docs/ADMIN.md` зовёт оператора на `/admin`; в ключе встроенного клиента
    // лежит `/admin.html`. Без алиаса человек получил бы 404 на ровно тот адрес,
    // который ему написали в документации.
    for (const [from, to] of Object.entries(PAGE_ALIASES)) {
      expect(SITE_FILES[to], `${from} → ${to}`).toBeTruthy();
      const aliased = staticResponse(from, 'GET');
      const direct = staticResponse(to, 'GET');
      expect(aliased?.status).toBe(200);
      expect(aliased?.headers.get('Content-Type')).toBe(direct?.headers.get('Content-Type'));
      // Закрытость от индексации наследуется: алиас не «обходит» noindex.
      expect(aliased?.headers.get('X-Robots-Tag')).toBe(direct?.headers.get('X-Robots-Tag'));
    }
  });

  it('алиас — только точное имя, а не «попробуем .html»', () => {
    // Иначе следующий шаг у резолвера — отдать что-нибудь постороннее.
    // Ни «косой чертой больше», ни регистром, ни двойным расширением алиас не
    // подставляется: резолвер знает только точные ключи.
    for (const path of ['/admin/', '/Admin', '/ADMIN', '/admin.js.html', '/admin.html.html', '/..%2fadmin', '//admin', '/pay/']) {
      expect(staticResponse(path, 'GET'), path).toBe(null);
    }
    expect(staticResponse('/admin', 'GET')?.status).toBe(200);
    // Никаких приватных файлов в ключе быть не может в принципе: отдаётся только
    // то, что попало в `SITE_FILES` при сборке.
    expect(SITE_FILES['/worker/src/env.ts']).toBeUndefined();
    expect(SITE_FILES['/../wrangler.toml']).toBeUndefined();
  });

  it('список закрытых от индексации страниц не разъезжается с реальностью', () => {
    for (const path of NO_INDEX_PAGES) {
      expect(SITE_FILES[path], path).toBeTruthy();
      expect(staticResponse(path, 'GET')?.headers.get('X-Robots-Tag')).toBe('noindex');
    }
    // Алиасы обязаны вести на закрытую страницу, иначе `noindex` теряется.
    for (const to of Object.values(PAGE_ALIASES)) {
      if (NO_INDEX_PAGES.has(to)) continue;
      expect(['/pay.html', '/admin.html'].includes(to), to).toBe(false);
    }
  });

  it('закрытие от индексации зеркалится в client/_headers — вместе с каноническим адресом', () => {
    // На проде страницы отдаёт Assets, и он делает 307 с `/admin.html` на `/admin`:
    // заголовок, записанный только для `.html`, доезжает до редиректа, а не до
    // ответа. Значит в `_headers` обязаны быть оба написания.
    const declared = noindexInHeadersFile();
    for (const page of NO_INDEX_PAGES) {
      expect(declared.has(page), page).toBe(true);
      const clean = page.replace(/\.html$/, '');
      expect(declared.has(clean), `${clean} (канонический адрес из документации)`).toBe(true);
      expect(PAGE_ALIASES[clean], clean).toBe(page);
    }
  });

  it('HEAD не отдаёт тело, но отдаёт те же заголовки', async () => {
    const head = staticResponse('/admin', 'HEAD');
    const get = staticResponse('/admin', 'GET');
    expect(head?.status).toBe(200);
    expect(head?.headers.get('Content-Type')).toBe(get?.headers.get('Content-Type'));
    expect(await head?.text()).toBe('');
  });
});
