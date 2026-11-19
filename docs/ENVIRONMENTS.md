# Окружения: production, preview и локальная разработка

Три окружения живут на одном коде и различаются только ресурсами Cloudflare.
Переменные и секреты в репозиторий не попадают: в `wrangler.toml` лежат лишь
публичные значения (site key Turnstile), всё остальное — через `wrangler secret`.

## Что где

| | Production | Preview (Workers Builds) | Локально (`wrangler dev`) |
|---|---|---|---|
| Worker | `crypto-astra` | превью-версии того же Worker | процесс на 8787 |
| Адрес | `crypto-astra.cryptoastra.workers.dev` | `<ветка>-crypto-astra.cryptoastra.workers.dev` | `http://127.0.0.1:8787` |
| D1 | `astra-global` (`49cf3fff-…`) | `astra-preview` (`a9656807-…`) | локальный файл `.wrangler/state` |
| Durable Objects | боевые | изолированные (`[previews.durable_objects]`) | локальные |
| `TURNSTILE_SITE_KEY` | реальный | пустой — проверка выключена | из `.dev.vars`/`[vars]` |
| `JWT_SECRET` | секрет | секрет превью **другой** | `.dev.vars` |
| Cron / архив | включён | не срабатывает (превью не планировщик) | вручную |
| Снимки мира | D1 `world_snapshots` (R2 позже) | не пишутся | не пишутся |

Превью-база и отдельные Durable Objects нужны, чтобы тестовые регистрации и
миры не попадали в живой мир и не тратили его лимиты: у D1 и DO бесплатные
квоты общие на аккаунт.

## Миграции D1

```bash
npm run db:migrate            # production: astra-global
npm run db:migrate:preview    # preview: astra-preview (флаг --preview)
npx wrangler d1 migrations apply DB --local   # локальная база для dev
```

Это обёртки над `wrangler d1 migrations apply DB --remote [--preview]`. Для
удалённых команд нужен `CLOUDFLARE_API_TOKEN` (или интерактивный
`npx wrangler login`).

Побочный эффект `preview_database_id`: в локальной разработке `wrangler dev`
берёт идентификатор оттуда, поэтому локальный файл базы называется по id
превью-базы. Данные всё равно лежат на диске и в Cloudflare не уходят.
Команда `--preview` работает потому, что в `[[d1_databases]]` указан
`preview_database_id`; без него wrangler ищет базу только среди основных и
падает с `Please define a preview_database_id`.

Порядок выката: сначала миграции, потом деплой кода. Обратный порядок означает,
что новый код какое-то время работает со старой схемой. Если миграция не
применилась — деплой не считается выпущенным.

Проверить, что применено:

```bash
npx wrangler d1 migrations list DB --remote
npx wrangler d1 migrations list DB --remote --preview
```

## Секреты

```bash
# production — единственное место, где ключ подписи действительно секрет
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET      # если site key включён
```

- Боевой `JWT_SECRET` **обязан отличаться** от превью-ключа: иначе токен,
  выпущенный на превью, криптографически годится и для прода (спасает только то,
  что аккаунтов в боевой D1 у него нет, — но полагаться на это не надо).
- `TURNSTILE_SECRET` превью не нужен: в `[previews.vars]` site key пустой, и
  проверка выключается сама.

### Превью работает без секретов

У превью-сборки нет доступа к терминалу, поэтому ключ подписи для неё лежит
прямо в конфиге — `[previews.vars] JWT_SECRET`. Это осознанный компромисс:

- ключ **не секрет**: он в репозитории, значит токены превью может подписать
  кто угодно;
- поэтому он действует только на превью: там своя D1 `astra-preview` и свои
  Durable Objects, реальных аккаунтов и денег нет;
- значение само себя называет (`preview-only-not-a-secret-…`) и в боевом
  `[vars]` его быть не может — это проверяет
  `worker/test/unit/config.test.ts`;
- если у аккаунта появится `preview base-config secret put JWT_SECRET`, сначала
  удалите строку из `[previews.vars]`: одноимённые var и secret в одном
  окружении конфликтуют.

Без `JWT_SECRET` (или если он короче 32 символов) регистрация и вход отвечают
`500 server_misconfigured`: это ожидаемое поведение «окружение не настроено», а
не баг. Проверка готовности превью:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<превью>/health      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<превью>/season      # 401
```

## Архивирование: когда появляются снимки

Снимков на пустом проде нет не потому, что что-то сломано, а потому что их ещё
не от чего делать:

| Событие | Когда наступает |
|---|---|
| Первый снимок `weekly` | через 7 дней после создания мира |
| Первый снимок `season_close` | через 56 дней, при закрытии сезона |
| Строка в `season_history` | вместе с `season_close` |

Мир создаётся при регистрации первого игрока. Значит на новом мире `SELECT
count(*) FROM world_snapshots` законно возвращает 0 первые семь дней.

Конвейер при этом проверяется без ожидания:

```bash
npx vitest run worker/test/unit/archive.test.ts   # 9 тестов, включая 6 на syncArchive
```

Тесты держат свойства, которые важны на живых данных: запись в D1/R2 идёт
**до** подтверждения миру, сбой базы оставляет снимок в очереди на следующий
час, payload не дублируется при включённом бакете, а закрытие сезона пишет
историю с призами и топ-10.

На проде проверить так:

```bash
npx wrangler d1 execute astra-global --remote \
  --command "SELECT kind, storage, count(*), max(created_at) FROM world_snapshots GROUP BY kind, storage"
npx wrangler d1 execute astra-global --remote \
  --command "SELECT season_id, players, points_total, rewards_total FROM season_history ORDER BY closed_at DESC LIMIT 3"
```

Снимок из D1 выгружается и проверяется скриптом — см. `RUNBOOK_BACKUP.md`.

## R2

Бакет не подключён: он платный после бесплатной квоты, а доход появится позже.
Пока снимки лежат в D1 вместе с payload. Когда бакет появится:

```bash
npx wrangler r2 bucket create astra-archive
```

и раскомментировать блок `[[r2_buckets]]` в `wrangler.toml` (`npm run
config:sync`). Код менять не нужно: `env.ARCHIVE` необязателен, с бакетом
снимки уезжают туда, а в D1 остаются метаданные и ключ.

## Что не забыть при переезде на свой домен

1. Привязать домен к Worker: адреса в воркере не зашиты, сайт и API живут на
   одном origin, CORS нет.
2. Site key Turnstile выпустить на новый домен и обновить `[vars]`;
   секрет — через `secret put`.
3. Проверить куку refresh: она `Secure; HttpOnly; SameSite=Strict`, поэтому
   работает только по https.
