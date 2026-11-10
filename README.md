# Crypto Astra

Космическая браузерная игра с внутриигровой экономикой (ASTRA Coins). Только Cloudflare: Workers, Durable Objects (SQLite), D1, Pages.

Версия концепции: 2.1 (8 ноября 2026).

## Статус

Этап 1 «Ядро»: инфраструктура, миграции D1, схема мира, Ledger, WorldLobby, Claim.

Работа идёт только на бесплатных тарифах Cloudflare. Платное (Workers Paid, R2, Email Service) подключается после появления дохода.

## Структура

- `worker/` — API (Worker), Durable Objects `World` и `WorldLobby`
- `worker/migrations/d1/` — миграции глобальной базы D1
- `worker/schema/world/` — схема SQLite внутри мира

## Запуск

```
npm install
npm run dev
```

Секреты: см. `.env.example`. Значения хранятся только в секретах Worker (`wrangler secret put`).
