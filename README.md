# Crypto Astra

Космическая браузерная игра с внутриигровой экономикой (ASTRA Coins). Только Cloudflare: Workers, Durable Objects (SQLite), D1.

Версия концепции: 2.1 (8 ноября 2026). Работа идёт только на бесплатных тарифах Cloudflare; платное (Workers Paid, R2, Email Service) подключается после появления дохода.

## Статус (этап 1 «Ядро», дорога к гейту 1)

Есть: Ledger с хеш-цепочкой и ежедневной сверкой, идемпотентность, Claim, WorldLobby, регистрация и вход с ротацией refresh-токена, Turnstile на регистрации и после трёх неудачных входов, лимиты частоты в D1, планировщик задач мира (один alarm), экспедиции (старт, события, финиш, отмена), ремонт, покупка и восстановление топлива, экраны мостика, рейса, флота, кошелька и журнала.

Готово к проверке: `docs/ROADMAP.md` (чек-лист гейта 1), `docs/AUDIT.md` (аудит и исправления). Тесты: 63 unit + 11 e2e, CI зелёный, `npm audit` — 0.

Ещё нет, и это следующие этапы: покупка кораблей, модули, крафт, рынок, сезоны, гильдии, реклама, пул, выплаты, админка. Крупный ремонт ниже 50 % требует `alloy_plate`; до этапа 2 его негде взять — это решение нужно принять до публичного запуска (см. `docs/ROADMAP.md`).

## Структура

- `wrangler.toml` — единственный конфиг Worker (в корне; wrangler запускается из корня)
- `client/` — сайт (статика, без сборки); отдаётся тем же Worker
- `worker/src/` — API, Durable Objects `World` и `WorldLobby`
- `worker/wrangler.toml` — генерируется из корневого (`npm run config:sync`), нужен только сборке Cloudflare, настроенной на этот путь
- `worker/migrations/d1/` — миграции глобальной базы D1
- `worker/schema/world/` — справочная схема SQLite мира (рабочая копия — `worker/src/world/schema.ts`)
- `worker/test/` — unit и e2e тесты
- `scripts/` — `seed-local`, `simulate-economy`, `check-ledger`
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
