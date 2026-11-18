# API

Все маршруты — на том же origin, что и сайт. Формат — JSON, `Content-Type:
application/json; charset=utf-8`. Ответы не кэшируются (`Cache-Control: no-store`),
кроме `/config`.

## Публичные

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `{ ok, service, now }` — `now` в миллисекундах, серверное время |
| GET | `/config` | `{ turnstile_site_key, login_turnstile_after, server_time }` |
| POST | `/auth/register` | `{ access_token, user: { id, world_id } }` + refresh-cookie |
| POST | `/auth/login` | то же; может вернуть `turnstile_required` |
| POST | `/auth/refresh` | новый `access_token` + ротированная cookie |
| POST | `/auth/logout` | `{ ok: true }`, cookie очищается |

`/auth/register` принимает `email`, `password`, необязательные `ref` (id мира
пригласившего) и `turnstileToken`. `/auth/login` — `email`, `password`,
`turnstileToken` при требовании проверки.

## С авторизацией

Заголовок `Authorization: Bearer <access_token>` (JWT HS256, 15 минут).

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/me` | состояние игрока и мира, `server_time` |
| POST | `/claim` | Claim; `Idempotency-Key` обязателен |
| GET | `/ledger?limit=N` | журнал игрока, N = 1…50 (по умолчанию 30) |
| POST | `/expeditions/start` | `{ shipId, planet, kind }`, `Idempotency-Key` |
| POST | `/expeditions/choose-event` | `{ expeditionId, choiceId }` (алиас `/expeditions/choose`) |
| POST | `/expeditions/cancel` | `{ expeditionId }`, первые 10 % рейса |
| POST | `/ships/repair` | `{ shipId }`, прочность ≥ 50 % |
| POST | `/fuel/buy` | одна единица топлива |

Суммы, балансы и награды клиент не передаёт: сервер считает их сам, лишние поля
тела игнорируются.

## Идемпотентность

Каждое действие, которое тратит или начисляет, требует `Idempotency-Key`
(1–128 символов). Ключ уникален в паре `(player_id, key)`:

- тот же ключ и то же тело — сохранённый ответ, изменений нет;
- тот же ключ и другое тело или маршрут — 409 `idempotency_key_reused`;
- ключей нет — 400 `idempotency_key_required`.

Ключи живут 30 дней, затем их удаляет `idem_cleanup`.

## Ошибки

Тело ошибки всегда `{ "error": "<код>" }`. Основные коды:

| Код | HTTP | Когда |
|---|---|---|
| `unauthorized` | 401 | нет или протух access-токен |
| `no_session` / `session_reuse` | 401 | refresh-cookie нет / повторное использование |
| `invalid_credentials` | 401 | неверная пара email/пароль (email не раскрывается) |
| `turnstile_required` | 403 | нужен токен Turnstile |
| `turnstile_failed` | 403 | токен не прошёл siteverify |
| `too_many_attempts` | 429 | сработал лимит частоты; есть `Retry-After` |
| `too_early` / `daily_limit` | 429 | Claim раньше 15 минут / суточный лимит |
| `insufficient_funds` | 409 | не хватает ASTRA |
| `ship_busy`, `ship_broken`, `not_enough_fuel` | 409 | рейс невозможен |
| `sector_locked`, `ship_range` | 403 | сектор закрыт уровнем или дальностью |
| `world_frozen` | 423 | сверка Ledger не сошлась, игры остановлены |
| `payload_too_large` | 413 | тело JSON больше 16 КиБ |

`Retry-After` есть у 429 от лимитов и Claim. Клиент считает таймеры от
`server_time`, а не от часов устройства.

## Пример

```bash
curl -s -X POST https://<worker>/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"pilot@example.com","password":"password123"}'

curl -s -X POST https://<worker>/claim \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d '{}'
```

## POST /craft/start

Запуск крафта. Требует `Idempotency-Key`, тело `{ "recipe": "energy_cell" | "circuit" | "alloy_plate" }`.
Списывает ресурсы и плату в ASTRA одной транзакцией и ставит задачу `craft_finish`;
готовый компонент начисляется сам. Очередь — один слот, второй будет за Astra Pass.
Ошибки: `bad_recipe` (400), `insufficient_resources` и `craft_queue_full` (409).
Каталог рецептов и запущенные задачи приходят в `/me` в блоке `craft`.
