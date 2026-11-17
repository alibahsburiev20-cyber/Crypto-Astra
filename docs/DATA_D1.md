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

Правила: не менять уже применённые файлы, добавлять новый номер. Перед выкладкой
проверять на локальной D1.

## Резервные копии

D1 Time Travel (встроенный restore) и `wrangler d1 export`. Полный регламент —
`RUNBOOK_BACKUP.md`.
