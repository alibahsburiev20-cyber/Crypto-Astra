# Crypto Astra

Космическая браузерная игра с внутриигровой экономикой (ASTRA Coins). Только Cloudflare: Workers, Durable Objects (SQLite), D1.

Версия концепции: 2.1 (8 ноября 2026). Работа идёт только на бесплатных тарифах Cloudflare; платное (Workers Paid, R2, Email Service) подключается после появления дохода.

## Статус (этапы 1–4 сданы, этап 5 начат)

Есть: Ledger с хеш-цепочкой и ежедневной сверкой, идемпотентность, Claim,
WorldLobby, регистрация и вход с ротацией refresh-токена, Turnstile, лимиты
частоты, планировщик задач мира, экспедиции с событиями, топливо и ремонт,
крафт, модули, верфь, рынок с налогом и коридором цен, сезоны на восемь недель
(рейтинг, призы, закрытие, архив снимков в D1/R2), публичный лендинг с
модальной регистрацией и разделы мостика, рейса, флота, модулей, крафта, рынка,
сезона, заданий, команды, кошелька и журнала.

Этап 4 «Социальное»: гильдии до 10 человек с ролями и рейтингом, три дневные и
одна недельная миссия с прогрессом по фактам игры, рефералы, 10 достижений
(только косметика) и бесплатный Astra Pass из 10 уровней. Ни платежей, ни чата,
ни выплат.

Этап 5 начат с учёта: `pool_entries` в D1 (append-only, резерв 20 % на операции)
и публичный отчёт `/pool.html` + `/pool.json`; выплаты выключены до гейта 4.
Гараж, админка мира и недельная арена — в коде; статус запуска и чек-лист
`docs/LAUNCH-READINESS.md`. Админка мира открывается по адресу `/admin`
(нужен токен оператора), в меню игры её нет.

Тесты: **228 unit + 24 e2e**, CI зелёный, `npm audit` — 0. Экономика на симуляции
8 недель: поглощение 83.2 % без призов и 81.8 % с ними; с миссиями, Pass и
рефералами — 72.4 % на 30 днях (цель 70–90 %).

Открыты внешние гейты: гейт 1 — семь дней сверки без расхождений (счётчик идёт
сам); гейт 2 — домен, юридические страницы, кабинет Bitmedia и рабочий unit id;
гейт 3 — фактическое закрытие первого живого сезона через 8 недель (код готов).
Дальше по плану: этап 5 «Деньги и админка» (пул, админка за Cloudflare Access,
платежи на малых суммах и юридическое заключение). См. `docs/ROADMAP.md`.

## Структура

- `wrangler.toml` — единственный конфиг Worker (в корне; wrangler запускается из корня)
- `client/` — сайт (статика, без сборки); отдаётся тем же Worker
- `worker/src/` — API, Durable Objects `World` и `WorldLobby`
- `worker/wrangler.toml` — генерируется из корневого (`npm run config:sync`), нужен только сборке Cloudflare, настроенной на этот путь
- `worker/migrations/d1/` — миграции глобальной базы D1
- `worker/schema/world/` — справочная схема SQLite мира (рабочая копия — `worker/src/world/schema.ts`)
- `worker/test/` — unit и e2e тесты
- `scripts/` — `seed-local`, `simulate-economy`, `check-ledger`, `verify-snapshot`
- `docs/` — архитектура, API, Ledger, планировщик, безопасность, данные, дорожная карта, runbook'и, аудит

## Документация

| Файл | О чём |
|---|---|
| `docs/ARCHITECTURE.md` | компоненты, путь запроса, регистрация, границы этапа |
| `docs/API.md` | маршруты, ошибки, идемпотентность |
| `docs/LEDGER.md` | хеш-цепочка, сверка, проверка снимка |
| `docs/SCHEDULER.md` | jobs, alarm, повторы, cron |
| `docs/SECURITY.md` | пароли, сессии, Turnstile, лимиты, CSP |
| `docs/DATA_D1.md`, `docs/DATA_WORLD.md` | таблицы и инварианты |
| `docs/ROADMAP.md` | этапы, гейты, чек-лист гейта 1 |
| `docs/STAGE2.md`, `docs/STAGE3.md`, `docs/STAGE4.md`, `docs/STAGE5.md` | что сделано по срезам: экономика, сезоны, социальное, деньги |
| `docs/POOL.md` | правила пула, API и публичный отчёт |
| `docs/ASTRA-PAY-AUDIT.md` | аудит и план Astra Pay Core: USDT TRC-20, депозиты, выплаты, Signer |
| `docs/PAY-SIGNER.md` | как включить Signer через дашборд: секреты, биндинг, проверка |
| `docs/ASTRA-PAY-RUNBOOK.md` | что делать при аварии: стоп-флаг, зависшая выплата, утечка ключа, чек-лист mainnet |
| `docs/SPRITES.md` | правило «весь арт — PNG»: иконки, спрайты арены, фоны, скрипт сборки |
| `docs/MINIGAME.md` | мини-игра «Астероидный залп»: правила, награды, почему счёт нельзя накрутить |
| `docs/RETENTION.md` | что подсмотреть у Lightning Miner: энергия, оффлайн-прогресс, streak, Premium без P2W |
| `docs/LAUNCH-READINESS.md` | что работает, что заблокировано, чек-лист перед анонсом |
| `docs/SEASON.md` | правила сезона: очки, рейтинг, призы, закрытие, архив |
| `docs/ENVIRONMENTS.md` | production, превью-сборки, локальная разработка: миграции, секреты, когда появляются снимки |
| `docs/ECONOMY.md` | симуляция экономики и её числа |
| `docs/RUNBOOK_BACKUP.md`, `docs/RUNBOOK_INCIDENTS.md` | эксплуатация |
| `docs/AUDIT.md` | что проверено и исправлено 17 ноября 2026 |

## API этапа 1

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/health` | проверка живости, отдаёт `now` |
| GET | `/config` | site key Turnstile, порог проверки, `server_time` |
| POST | `/auth/register` | регистрация; `email`, `password`, `ref`, `turnstileToken` |
| POST | `/auth/login` | вход; Turnstile после трёх неудач |
| POST | `/auth/refresh` | ротация refresh-токена (cookie `HttpOnly`, `Path=/auth`) |
| POST | `/auth/logout` | отзыв сессии |
| GET | `/me` | состояние игрока, флот, планеты, топливо, рейсы, `server_time` |
| POST | `/claim` | Claim; нужен `Idempotency-Key`; при отказе 429 и `Retry-After` |
| GET | `/ledger?limit=` | журнал игрока (1–50) |
| POST | `/expeditions/start` | старт рейса; `Idempotency-Key` |
| POST | `/expeditions/choose-event` | выбор в событии (алиас `/expeditions/choose`) |
| POST | `/expeditions/cancel` | отмена в первые 10 % рейса |
| POST | `/ships/repair` | ремонт выше 50 % |
| POST | `/fuel/buy` | покупка единицы топлива |

Все действия, которые тратят или начисляют, требуют `Idempotency-Key`. Время в ответах серверное; клиент считает таймеры от `server_time`, а не от часов устройства.

## Деплой через дашборд Cloudflare (бесплатно)

В `package.json` есть скрипт `build` (`npm run build`), потому что Cloudflare Workers Builds запускает его по умолчанию. Он пересобирает встроенный клиент, чтобы `site.ts` не отставал.

1. Workers & Pages → Create → Import a repository → этот репозиторий.
2. Deploy command: `npx wrangler deploy` (конфиг лежит в корне).
3. Применить миграции D1: `npx wrangler d1 migrations apply DB --remote`.
4. Settings → Variables and Secrets:
   - секрет `JWT_SECRET` — случайная строка от 32 символов, обязателен;
   - для Turnstile: публичный `TURNSTILE_SITE_KEY` (можно в `wrangler.toml`, `[vars]`) и секрет `TURNSTILE_SECRET`. Без них проверка выключена — только для разработки.
5. Включить правила Cloudflare Rate Limiting на `/auth/*`.
6. Открыть адрес `*.workers.dev`.

## Локально

```
npm ci
npm run check                    # типы (включая скрипты) + тесты
npx wrangler d1 migrations apply DB --local
npm run dev
```

Для `npm run dev` создайте `.dev.vars` в корне со строкой `JWT_SECRET=<от 32 символов>` (файл в `.gitignore`). Секреты: см. `.env.example`.

### Скрипты

```
npm run seed -- --users 3                     # тестовые игроки (нужен запущенный dev)
npm run simulate -- --players 200 --days 30   # источники и стоки экономики
npm run check-ledger -- --file snapshot.json  # проверка хеш-цепочки и балансов
```

### E2E

```
npm run dev                                     # в отдельном терминале
E2E_BASE_URL=http://127.0.0.1:8787 npm run test:e2e
```

E2E проверяет регистрацию, Claim с идемпотентностью, старт и отмену рейса, попытку передать суммы в теле, лимиты, ротацию refresh и закрытые маршруты. В CI он поднимает `wrangler dev` и локальную D1 автоматически.

`npm run embed` пересобирает `worker/src/static/site.ts` из `client/`; CI проверяет, что файл не отстал.
