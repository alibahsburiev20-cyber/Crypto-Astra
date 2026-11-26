# Данные в D1

D1 хранит только то, что нужно между мирами, до входа в мир или для отчётов.
Игровые данные мира сюда не попадают.

## Таблицы

### users

`id` (UUID), `email` (UNIQUE), `password_hash`, `telegram_id` (UNIQUE, позже),
`world_id`, `status` (`pending`, `active`, `blocked`, `deleted`), `created_at`.
Индекс по `world_id`.

### sessions

`id`, `user_id`, `token_hash` (UNIQUE), `expires_at`, `revoked_at`, `created_at`.
Индекс по `user_id`. Хранится только SHA-256 refresh-токена; сам токен — в
HttpOnly-cookie. Истёкшие и отозванные строки старше 30 дней удаляет cron.

### world_seats

Зеркало счётчика мест для отчётов: `world_id`, `capacity`, `taken`, `updated_at`.
**Источник истины — `WorldLobby`**, а не эта таблица. При недоступности лобби cron
использует её как список миров.

### season_history

Итоги закрытых сезонов: `world_id`, `season_id`, `season_number`, `starts_at`,
`ends_at`, `closed_at`, `players`, `points_total`, `rewards_total`, `top_json`
(первые десять мест с подписями), `created_at`. Первичный ключ
`(world_id, season_id)`: повторная запись того же сезона ничего не меняет.
Источник — снимок `season_close` из мира.

### world_snapshots

Архив снимков: `id`, `world_id`, `kind` (`weekly` / `season_close`), `season_id`,
`created_at`, `size`, `sha256`, `storage` (`r2` или `d1`), `r2_key`,
`head_seq`, `head_hash`, `ok`, `payload`. При подключённом бакете payload в D1 не
пишется — только ключ R2. Проверка: `npm run verify-snapshot`.

### pool_entries

Учёт пула (этап 5): `id`, `kind` (`in` / `out` / `ops`), `amount` (минимальные
единицы валюты), `currency` (`EUR` / `USD`), `ref` (уникальный номер платежа),
`note` (публичное пояснение без персональных данных), `season_id`, `created_at`.
Таблица append-only: `UPDATE` и `DELETE` запрещены триггерами. Игровых данных
здесь нет — только деньги вокруг игры, см. `POOL.md`.

### auth_limits

`key` (например `login_ip:203.0.113.7`, `login_email:<sha256>`), `attempts`,
`window_start`, `blocked_until`. Нужна только для ограничения частоты; старые
строки удаляет cron.

### admin_accounts

Доступы в админку (`0011_admin_accounts.sql`): `id`, `label`, `role`
(`owner` / `junior`), `key_hash` (SHA-256 от ключа, `UNIQUE`; открытого ключа в
базе нет нигде), `email` (необязательная вторая щеколда), `status`
(`active` / `revoked`), `grant_limit` (потолок одной выдачи ASTRA, 1…20000),
`created_at`, `created_by`, `expires_at`, `last_used_at`, `last_ip`, `revoked_at`,
`note`.

Роль `owner` здесь — формальность: вход владельца идёт секретом `ADMIN_TOKEN` и
строку в этой таблице не создаёт. Отсюда и правило: «отозвать всех» = перевыпустить
секрет, «отозвать помощника» = одна строка `status='revoked'`. Проверка ключа
смотрит в базу на каждый запрос, кэшей доступа нет — отзыв виден немедленно.

`last_used_at` пишется не чаще раза в 5 минут на доступ (`touchAdminAccount`):
отметка «воспользовались» не должна стоить строки D1 на каждый запрос.

### admin_audit

Журнал админ-действий: `actor` (`owner` или id доступа), `actor_role`, `action`
(`grant`, `player_block`, `player_close`, `invite_create`, `invite_revoke`, …),
`target`, `payload` (JSON), `created_at`. Это НЕ бухгалтерия: деньги и монеты
живут в `pay_ledger` и в журнале мира, здесь — «кто нажал» и с какой причиной.
Запись журнала не может утопить действие, которое уже совершено (ошибка пишется
в лог), поэтому `admin_audit` не участвует в сверке и не имеет триггеров.

## Миграции

Каталог `worker/migrations/d1`, применяются по порядку:

```
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply DB --remote
```

| Файл | Что создаёт |
|---|---|
| `0001_users.sql` | users |
| `0002_sessions.sql` | sessions |
| `0003_world_seats.sql` | world_seats |
| `0004_auth_limits.sql` | auth_limits |
| `0005_season_archive.sql` | season_history, world_snapshots |
| `0006_pool.sql` | pool_entries (append-only, `ref` уникален), индексы и триггеры |
| `0007_astra_pay.sql` | таблицы Astra Pay: `pay_addresses`, `pay_deposits`, `pay_ledger`, `pay_withdrawals`, `pay_audit_log` (append-only) |
| `0008_pay_addresses_chain.sql` | перестройка `pay_addresses` под колонку `chain` (адрес — на сеть, не на игрока) |
| `0009_pay_addresses_polygon.sql` | `polygon` в `CHECK (chain)` — вторая EVM-сеть того же рельса |
| `0010_pay_withdrawals_chain.sql` | `pay_withdrawals.chain`: у заявки своя сеть, платить — в неё |
| `0011_admin_accounts.sql` | admin_accounts (ключи помощников, только хеши) и admin_audit |

Правила: не менять уже применённые файлы, добавлять новый номер. Перед выкладкой
проверять на локальной D1.

**Самолечение.** Деплой идёт из браузера через Workers Builds, где
`wrangler d1 migrations apply --remote` недоступен. Поэтому `worker/src/db/bootstrap.ts`
идемпотентно создаёт таблицы пула (при первом запросе к `/pool.json`) и архива
(в cron перед первой выгрузкой), а доступы админки — `ensureAdminSchema` при
первом обращении к разделу «Доступы», к карточке игрока и к журналу. На мигрированной базе это no-op; миграции
остаются каноном для схемы и ревью.

## Резервные копии

D1 Time Travel (встроенный restore) и `wrangler d1 export`. Полный регламент —
`RUNBOOK_BACKUP.md`.
