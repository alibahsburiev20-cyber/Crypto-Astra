# Данные мира (Durable Object SQLite)

Один мир = один объект `World` = одна SQLite. Схема применяется при старте
объекта (`worker/src/world/schema.ts`, справочная копия — `worker/schema/world/`).

## Таблицы

| Таблица | Назначение |
|---|---|
| `meta` | служебные пары: `frozen`, `last_verify_at`, `last_verify_ok`, `frozen_seq` |
| `players` | `id`, `level`, `xp`, `guild_id`, `created_at` |
| `balances` | `astra`, `fuel`, `points`; `amount >= 0`; версия для будущих проверок |
| `ships` | `id`, `player_id`, `type`, `durability` 0…100, `status` |
| `resources` | добыча по видам, `amount >= 0` |
| `ledger` | журнал с хеш-цепочкой, append-only |
| `claim_state` | последний Claim, день, счётчик |
| `expeditions` | рейс: планета, тип, seed, время, статус, бонус события, износ, награда |
| `expedition_events` | события рейса: вид, окно, статус, выбор |
| `daily_counters` | рейсы, покупка топлива и очки по дням |
| `idempotency_keys` | ключи запросов и сохранённые ответы |
| `jobs` | отложенные задачи мира |

## Инварианты

- `balances.amount >= 0`; уйти в минус нельзя, транзакция откатится.
- Любое изменение баланса идёт через `applyDelta`, которая пишет `ledger` в той же
  транзакции.
- `ledger` нельзя обновить или удалить (триггеры).
- Игрок не может иметь два активных рейса на одном корабле: проверка `ships.status`
  и `expeditions.status`.
- В мире не больше `WORLD_CAPACITY` (100) игроков.
- Все действия выполняются в `ctx.storage.transactionSync`; внешних `await`
  внутри транзакции нет.

## Что не хранится здесь

Аккаунты, сессии, места лобби — в D1. Мир ничего не знает про email и пароль,
кроме `player_id` (он же `users.id`).

## Миграция старой схемы рейсов

`migrateLegacyExpeditions` в `world/migrate.ts` при старте объекта находит таблицу
с колонкой `sector` и без `planet` (ранняя версия), возвращает топливо за активные
рейсы, снимает `away` с кораблей и пересоздаёт `expeditions` по текущей схеме.
Миграция идемпотентна и выполняется внутри транзакции до создания таблиц.

## Диагностика

Через Durable Object SQL (не D1):

```sql
SELECT * FROM meta;
SELECT player_id, asset, amount FROM balances WHERE amount < 0;
SELECT status, kind, COUNT(*) FROM jobs GROUP BY status, kind;
SELECT seq, hash, prev_hash FROM ledger ORDER BY seq DESC LIMIT 5;
```
