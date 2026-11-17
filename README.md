# Crypto Astra

Космическая браузерная игра с внутриигровой экономикой (ASTRA Coins). Только Cloudflare: Workers, Durable Objects (SQLite), D1.

Версия концепции: 2.1 (8 ноября 2026). Работа идёт только на бесплатных тарифах Cloudflare; платное (Workers Paid, R2, Email Service) подключается после появления дохода.

## Статус (этап 1 «Ядро»)

Есть: Ledger с хеш-цепочкой, идемпотентность, Claim, WorldLobby, регистрация и вход с ротацией refresh-токена, планировщик задач мира (один alarm), экспедиции (старт, события, финиш, отмена), ремонт, покупка и восстановление топлива, экраны мостика, рейса, флота, кошелька и журнала.

Актуальный аудит кода и список исправленных ошибок — `docs/AUDIT.md` (17 ноября 2026: 52 теста, `npm audit` — 0 уязвимостей).

Ещё нет, и это не этап 1: Turnstile на формах (проверка в коде есть, включается секретом), Telegram, покупка кораблей, модули, крафт, рынок, сезоны, гильдии, реклама, выплаты. Крупный ремонт ниже 50% честно ждёт компонент `alloy_plate`.

Гейт 1 (сверка журнала 7 суток подряд) начинается после деплоя этой версии, одним заходом его не закрыть. Базовые количества награды — стартовые: в концепции задана форма формулы, целые коэффициенты планет проверит симуляция.

## Структура

- `client/` — сайт (статика, без сборки); отдаётся тем же Worker
- `worker/src/` — API, Durable Objects `World` и `WorldLobby`
- `worker/migrations/d1/` — миграции глобальной базы D1
- `worker/schema/world/` — схема SQLite мира (рабочая копия — `worker/src/world/schema.ts`)
- `worker/test/` — тесты
- `scripts/embed-client.mjs` — встраивает `client/` в Worker (fallback, если слой Assets не отдал файл)
- `docs/AUDIT.md` — аудит, исправления, отклонения от концепции

## API этапа 1

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/health` | проверка живости, отдаёт `now` (серверное время) |
| POST | `/auth/register` | регистрация; email, пароль, `ref` (id мира пригласившего), `turnstileToken` |
| POST | `/auth/login` | вход |
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

Все действия, которые тратят или начисляют, требуют `Idempotency-Key`. Время в ответах серверное;
клиент считает таймеры от `server_time`, а не от часов устройства.

## Деплой через дашборд Cloudflare (бесплатно)

1. Workers & Pages → Create → Import a repository → этот репозиторий.
2. Deploy command: `npx wrangler deploy --config worker/wrangler.toml`.
3. Применить миграции D1: `npx wrangler d1 migrations apply DB --remote --config worker/wrangler.toml`.
4. После первого деплоя: Settings → Variables and Secrets → добавить секрет `JWT_SECRET` (случайная строка от 32 символов).
5. Открыть адрес `*.workers.dev`.

## Локально

```
npm ci
npm run check                    # типы + тесты
npx wrangler d1 migrations apply DB --local --config worker/wrangler.toml
npm run dev
```

Для `npm run dev` создайте `worker/.dev.vars` со строкой `JWT_SECRET=<от 32 символов>` (файл в `.gitignore`). Секреты: см. `.env.example`.
`npm run embed` пересобирает `worker/src/static/site.ts` из `client/`; CI проверяет, что файл не отстал.
`TURNSTILE_SECRET` включает проверку Turnstile на регистрации; без секрета проверка пропускается (только для локальной разработки).
