# Crypto Astra

Космическая браузерная игра с внутриигровой экономикой (ASTRA Coins). Только Cloudflare: Workers, Durable Objects (SQLite), D1.

Версия концепции: 2.1 (8 ноября 2026). Работа идёт только на бесплатных тарифах Cloudflare; платное (Workers Paid, R2, Email Service) подключается после появления дохода.

## Статус (этап 1 «Ядро»)

Есть: Ledger с хеш-цепочкой, идемпотентность, Claim, WorldLobby, регистрация и вход (PBKDF2, JWT, refresh с ротацией), простой клиент.
Ещё нет: Turnstile на формах (проверка в коде есть, включается секретом), Telegram, планировщик jobs, экспедиции.

## Структура

- `client/` — сайт (статика, без сборки); отдаётся тем же Worker
- `worker/src/` — API, Durable Objects `World` и `WorldLobby`
- `worker/migrations/d1/` — миграции глобальной базы D1
- `worker/schema/world/` — схема SQLite мира (рабочая копия — `worker/src/world/schema.ts`)
- `worker/test/` — тесты

## Деплой через дашборд Cloudflare (бесплатно)

1. Workers & Pages → Create → Import a repository → этот репозиторий.
2. Deploy command: `npx wrangler deploy --config worker/wrangler.toml`.
3. После первого деплоя: Settings → Variables and Secrets → добавить секрет `JWT_SECRET` (случайная строка от 32 символов).
4. Открыть адрес `*.workers.dev`.

## Локально

```
npm install
npm test
npm run dev
```

Для `npm run dev` создайте `worker/.dev.vars` с строкой `JWT_SECRET=<от 32 символов>` (файл в `.gitignore`). Секреты: см. `.env.example`.
