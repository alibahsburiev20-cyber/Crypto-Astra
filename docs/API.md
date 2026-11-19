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
| GET | `/market` | лоты, коридор цен по каждому ресурсу, лимиты |
| POST | `/market/lot` | выставить лот: `{ resource, amount, unitPrice }` |
| POST | `/market/buy` | купить лот целиком: `{ lotId }` |
| POST | `/market/cancel` | снять свой лот: `{ lotId }` |
| GET | `/season` | сезон, своё место, топ-20, призы, прошлые сезоны |

### `GET /season`

```json
{
  "season": { "id": "s1", "number": 1, "startsAt": 1700000000000, "endsAt": 1704838400000,
              "status": "active", "daysLeft": 42, "lengthDays": 56, "players": 24, "pointsTotal": 3140 },
  "me":   { "label": "Пилот A1B2C3", "rank": 7, "points": 180, "level": 5, "reward": 400 },
  "top":  [{ "rank": 1, "label": "Пилот 9F2C11", "points": 640, "level": 9, "ships": 4, "isMe": false }],
  "rewards": [{ "place": 1, "astra": 2000 }, { "place": "4–10", "astra": 400 }, { "place": "участие", "astra": 150 }],
  "past": [{ "id": "s1", "number": 1, "closedAt": 1704838400000, "players": 24,
             "winner": { "label": "Пилот 9F2C11", "points": 640, "reward": 2000 },
             "me": { "rank": 7, "points": 180, "reward": 400 } }]
}
```

Призы в `top` не дублируются: клиент показывает своё место и таблицу наград.
Правила сезона — `docs/SEASON.md`.

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
| `bad_resource`, `bad_amount`, `bad_price` | 400 | рынок: неизвестный ресурс, количество не 1…1000, цена ≤ 0 |
| `price_out_of_band` | 409 | цена вне коридора ±50 % от медианы |
| `market_lot_limit` | 409 | у игрока уже 10 открытых лотов |
| `lot_not_found` | 404 | лота нет |
| `lot_closed`, `own_lot` | 409 | лот уже продан/снят; попытка купить свой |
| `not_your_lot` | 403 | попытка снять чужой лот |
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

## POST /modules/install

Постановка или улучшение модуля. Требует `Idempotency-Key`, тело
`{ "shipId": "<id>", "module": "engine" | "fuel_system" | "scanner" | "cargo_bay" | "mining_drill" | "shield" | "repair_kit" }`.

- уровень 1..5, цена уровня `L` = `basePrice × 2^(L−1)`, компоненты — `amount × L`;
- ASTRA и компоненты списываются одной транзакцией (`module_buy`, `module_parts`);
- корабль должен быть «на базе»: в полёте установка запрещена (`ship_busy`);
- модуль занимает слот корпуса; снять его нельзя, только улучшить.

Ответ: `{ "shipId", "module", "level", "price", "astra" }`.
Ошибки: `bad_module` (400), `ship_not_found` (404), `ship_busy`,
`insufficient_funds`, `insufficient_resources`, `module_slots_full`,
`module_max_level` (409).

Состояние модулей приходит в `/me` в блоке `modules`: `maxLevel`, `catalog`
(все уровни с ценой и компонентами) и `ships` — по каждому кораблю `slots`,
`used`, установленные модули с текущим и следующим уровнем и множители `fx`.

## POST /ships/buy

Покупка корабля. Требует `Idempotency-Key`, тело `{ "type": "hauler" | "miner" | "explorer" | "cruiser" }`.

- цена из `SHIPS` спецификации (1 500 / 2 000 / 6 000 / 20 000), Flagship за ASTRA
  не продаётся — чертёж и крафт отдельно;
- один корпус каждого типа; уровень игрока не ниже `unlockLevel`;
- списание ASTRA (`ship_purchase`) и выдача корабля (`ship_delivery`) — одна
  транзакция, журнал сходится.

Ответ: `{ "ship": { "id", "type", "name" }, "price", "astra" }`.
Ошибки: `bad_ship_type`, `ship_not_for_sale` (400), `ship_locked` (403),
`ship_owned`, `insufficient_funds` (409).

## Рынок

Ресурсы и крафтовые компоненты продают сами игроки. Лот — это ресурс, количество
и цена **за единицу**; покупается целиком.

- при выставлении ресурс уходит в эскроу (`market_escrow`) — продать один и тот же
  ресурс дважды нельзя;
- покупатель платит всю сумму (`market_buy`) и получает ресурс;
- продавцу начисляется вся выручка (`market_sale`) и отдельной записью списывается
  налог 5 % (`market_tax`) — так налог видно в журнале, а сверка остаётся простой;
- отмена возвращает эскроу продавцу (`market_cancel`);
- один игрок держит не больше 10 открытых лотов, в лоте до 1000 единиц.

Цена ограничена коридором: ±50 % от медианы сделок по этому ресурсу за 7 дней, а
если сделок не было — ±50 % от базовой цены (`RESOURCE_BASE_PRICES`). Коридор
приходит в `/market` и в `/me` (`market.resources[].band`) — клиент не считает его сам.

Фрод-сигналы пишутся в `market_flags` и сделку не блокируют: `repeat_pair` (≥ 3
сделок одной пары за сутки) и `large_trade` (сделка от 20 000 ASTRA).

Ответ `/market`:

```json
{
  "tax": 5, "limit": 10, "maxAmount": 1000, "windowDays": 7,
  "lots": [{ "id", "resource", "name", "amount", "unitPrice", "total", "seller", "mine", "createdAt" }],
  "mine": 1,
  "resources": [{ "id": "iron_ore", "name": "Железная руда", "have": 40,
                  "band": { "base": 4, "median": 4, "min": 2, "max": 6, "sales": 0 } }],
  "astra": 500
}
```

`POST /market/buy` отвечает `{ lotId, resource, amount, unitPrice, gross, tax, astra }`.
