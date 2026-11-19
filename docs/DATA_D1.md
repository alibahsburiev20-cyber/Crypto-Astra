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

### auth_limits

`key` (например `login_ip:203.0.113.7`, `login_email:<sha256>`), `attempts`,
`window_start`, `blocked_until`. Нужна только для ограничения частоты; старые
строки удаляет cron.

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

Правила: не менять уже применённые файлы, добавлять новый номер. Перед выкладкой
проверять на локальной D1.

## Резервные копии

D1 Time Travel (встроенный restore) и `wrangler d1 export`. Полный регламент —
`RUNBOOK_BACKUP.md`.
