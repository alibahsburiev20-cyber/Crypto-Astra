# API

Все маршруты — на том же origin, что и сайт. Формат — JSON, `Content-Type:
application/json; charset=utf-8`. Ответы не кэшируются (`Cache-Control: no-store`),
кроме `/config`.

## Публичные

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `{ ok, service, build, now }` — `build` из `[vars].APP_BUILD`, `now` в миллисекундах |
| GET | `/config` | `{ turnstile_site_key, login_turnstile_after, server_time }` |
| POST | `/batch` | пачка игровых действий (до 10): `{ops:[{op, idem, body}]}` → `{results:[{op, status, data}], blockedAt, retryAfter}`; деньги, вход, админка и сам `/batch` в пачку не входят |
| GET | `/ops/status` | `{ ok, mode, used, limit, remaining, day, retryAfter, blocked }` — режим бережливости: `full` / `thrifty` / `lite` / `sleep` |
| POST | `/auth/register` | `{ access_token, user: { id, world_id } }` + refresh-cookie |
| POST | `/auth/login` | то же; может вернуть `turnstile_required` |
| POST | `/auth/refresh` | новый `access_token` + ротированная cookie |
| POST | `/auth/logout` | `{ ok: true }`, cookie очищается |

`/auth/register` принимает `email`, `password`, необязательные `ref` (id мира
пригласившего) и `turnstileToken`. `/auth/login` — `email`, `password`,
`turnstileToken` при требовании проверки.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/pool.json` | публичный отчёт пула: итоги по валютам, последние операции, флаг выплат |
| GET | `/pool/report` | алиас `/pool.json` |
| GET | `/pay/status.json` | состояние Astra Pay: сеть, контракт USDT, флаги, версия схемы |
| GET | `/pay/products.json` | каталог: косметика и услуги, цены строкой, `purchasesEnabled` |

Пул ведётся отдельно от Ledger: ASTRA — внутриигровая валюта, её нельзя купить
или вывести. Правила и запись — `docs/POOL.md`.

`/pay/status.json` — единственный публичный маршрут Astra Pay на этапе 1. Он
отдаёт `{ ok, service: "astra-pay", version, network, asset: "USDT", decimals: 6,
contract, flags, schema, tables, now }`, где `flags` — шесть переключателей
(`payments`, `deposits`, `purchases`, `pool`, `payouts`, `sweep`), а `schema` —
`"off"` (база не проверялась, деньги выключены), `"ready"` или `"error"`.
Ключей, адресов игроков и сумм в ответе нет. Пока все флаги `off`, денежных
маршрутов не существует: запросы к ним вернут `404`.

## Astra Pay (с авторизацией)

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/pay/account.json` | баланс USDT, история операций, купленная косметика |
| GET | `/pay/address.json` | личный адрес пополнения USDT (TRC-20) |
| GET | `/pay/withdrawals` | свои заявки на вывод, лимиты и стоп-флаг |
| POST | `/pay/withdraw` | заявка на вывод: `{ address, amountMicro }` + `Idempotency-Key` |
| POST | `/pay/purchase` | покупка за баланс: `{ productId }` + заголовок `Idempotency-Key` |

`/pay/account.json` отдаёт `{ ok, asset: "USDT", balanceMicro, balance,
purchasesEnabled, history[], entitlements[] }`. История — только своя: `delta`,
`reason`, `ref`, `amount` в USDT.

`POST /pay/purchase` списывает цену **серверного** каталога: клиент присылает
только `productId` и ключ идемпотентности, цену подменить нельзя. Ответы:

| Код | Когда |
|---|---|
| 201 | куплено и выдано |
| 200 | повтор с тем же `Idempotency-Key` — деньги не списаны второй раз |
| 400 | кривой ключ идемпотентности |
| 402 | не хватает баланса |
| 404 | товара нет или он выключен |
| 503 | `PURCHASES_ENABLED` выключен — покупки в этой сборке нет |

Деньги появляются на балансе только из подтверждённых переводов USDT на личный
адрес игрока: монитор блокчейна пишет событие, `applyDeposits` превращает его в
запись журнала. Вручную начислить деньги через API нельзя.

## Astra Pay: выплаты и админка

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/pay/address.json` | игрок | личный постоянный адрес для депозитов USDT |
| GET | `/pay/withdrawals` | игрок | заявки, баланс, лимиты, флаг «выплаты включены» |
| POST | `/pay/withdraw` | игрок | заявка на выплату: `{ address, amountMicro }` + `Idempotency-Key` |
| GET | `/admin/pay` | админ | сверка, стоп-флаг, очередь заявок |
| POST | `/admin/pay/withdrawal` | админ | `{ id, action }`: `approve`, `reserve`, `broadcast`, `sent`, `confirm`, `fail` |
| POST | `/admin/pay/stop` | админ | `{ stop: true/false, reason }` — стоп-флаг выплат |
| POST | `/admin/pay/send` | админ | `{ id }` — собрать, подписать в Signer и отправить заявку в состоянии `reserved` |
| GET | `/admin/pay/sweep/plan` | админ | план сбора: по каждому адресу USDT, TRX, хватает ли на комиссию; ничего не двигает |
| GET | `/admin/pay/prize` | админ | сколько в призовом фонде, сколько выдано, баланс кошелька (USDT/TRX) и последние призы |
| POST | `/admin/pay/prize/award` | админ | начислить приз из фонда на баланс игрока; `dryRun` по умолчанию, сумма не больше остатка фонда |
| POST | `/admin/pay/send` | админ | подпись и отправка зарезервированной выплаты; `409 hot_wallet_insufficient_usdt` / `409 hot_wallet_no_trx` — платить нечем, заявка остаётся `reserved` |
| GET | `/admin/pay/solvency` | админ | обязательства (балансы игроков + призовой фонд) против активов в блокчейне: покрытие, дефицит |

Админка пока закрыта заголовком `X-Admin-Token` (срез 5.3 заменит его на
Cloudflare Access, токен останется вторым замком).

Состояния заявки: `requested → approved → reserved → broadcasting → sent →
confirmed`, в сторону — только `failed` или `manual`. Резерв списывает деньги с
баланса, отказ возвращает их компенсирующей записью. Один `txid` не может
закрыть две заявки. Если ночная сверка нашла расхождение, она сама поднимает
стоп-флаг, и новые заявки получают `409 payouts_stopped`.

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
| GET | `/social` | миссии дня и недели, достижения, Astra Pass |
| POST | `/missions/claim` | `{ missionId }`, награда готовой миссии |
| POST | `/pass/claim` | `{ level }`, награда уровня Pass |
| GET | `/guild` | своя гильдия, участники, топ, код приглашения |
| POST | `/guild/create` | `{ name, tag }`, создание за 500 ASTRA |
| POST | `/guild/join` | `{ code }` |
| POST | `/guild/leave` | выйти; лидер передаёт роль или распускает гильдию |
| POST | `/guild/kick` | `{ playerId }` |
| POST | `/guild/role` | `{ playerId, role }`: `officer` или `member` |
| POST | `/guild/rename` | `{ name, tag }`, только лидер |
| POST | `/referrals/apply` | `{ code }`, применить код приглашения |
| POST | `/ships/buy` | `{ type }`, покупка корпуса за ASTRA |
| POST | `/craft/start` | `{ recipe }`, запуск крафта |
| POST | `/modules/install` | `{ shipId, module }`, установка модуля |
| GET | `/profile` | `{ profile, owned }` — позывной, стиль, премиум |
| POST | `/profile/callsign` | `{ callsign }`, 3–16 символов, смена раз в 24 часа |
| POST | `/profile/style` | `{ frame, trail }` — только из купленного |
| GET | `/account/export` | все данные игрока одним JSON |
| DELETE | `/account` | удаление: `{ confirm: "DELETE" }` |

Коды профиля и аккаунта: `400` кривой позывной, `403` стиль не куплен, `409`
позывной занят (уникальность по `callsign_key`, без учёта регистра), `429` смена
чаще раза в сутки.

`GET /pay/address.json` → `{ ok, address, index, created, network, asset: "USDT",
contract }`. Адрес выводится детерминированно из индекса аккаунта и не меняется
между запросами. Ошибки: `503 deposits_disabled` (приём выключен флагом),
`503 signer_not_configured` (не заданы секреты Signer), `503 pay_unavailable`
(нет базы D1). Клиент показывает адрес в `pay.html` с кнопкой копирования.

## Админка пула (этап 5)

Заголовок `X-Admin-Token: <ADMIN_TOKEN>`. Без секрета в окружении — 503
`admin_disabled`, без заголовка — 401, с неверным — 403.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/pool` | все записи пула с `ref` и `id` плюс итоги |
| POST | `/admin/pool/entry` | `{ kind: "in" \| "out" \| "ops", amount, currency: "EUR" \| "USD", ref, note? }` |

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

Запуск крафта. Требует `Idempotency-Key`, тело
`{ "recipe": "<id из RECIPE_ORDER>" }` — девять рецептов:

- первый круг: `energy_cell`, `circuit`, `alloy_plate` — только ресурсы первого сектора;
- второй круг: `helium_coolant`, `titanium_frame`, `crystal_lens`, `astralite_core`,
  `void_weave`, `quantum_matrix` — в каждом есть редкий ресурс секторов 2–5.

Списывает ресурсы и плату в ASTRA одной транзакцией и ставит задачу `craft_finish`;
готовый компонент начисляется сам. Очередь — один слот, второй будет за Astra Pass.
Ошибки: `bad_recipe` (400), `insufficient_resources` и `craft_queue_full` (409).
Каталог рецептов и запущенные задачи приходят в `/me` в блоке `craft`; у каждого
рецепта есть поле `tier` (1 или 2).

## POST /modules/install

Постановка или улучшение модуля. Требует `Idempotency-Key`, тело
`{ "shipId": "<id>", "module": "engine" | "fuel_system" | "scanner" | "cargo_bay" | "mining_drill" | "shield" | "repair_kit" }`.

- уровень 1..5, цена уровня `L` = `basePrice × 2^(L−1)`, компоненты — `amount × L`;
- с уровня `MODULE_LATE_LEVEL` (4) добавляются дальние компоненты второго круга,
  тоже `× L`: двигателю и топливной системе — `helium_coolant`, сканеру и
  ремкомплекту — `crystal_lens`, грузовому отсеку и буру — `titanium_frame`,
  буру — ещё `astralite_core`, щиту — `void_weave` и `quantum_matrix`;
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

### Состояние кошельков в `/pay/status.json` и `/pay/products.json`

Поле `wallets`:

| Значение | Что значит |
| --- | --- |
| `off` | деньги выключены |
| `signer_required` | маршруты открыты, но адрес игроку выдать нечем: не настроен Signer |
| `ready` | можно выдавать адрес, принимать USDT и покупать |

Витрина при `signer_required` показывает «Нужен кошелёк» вместо «Купить»:
без адреса игрок физически не может отправить USDT.

## Мини-игра (этап 13)

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/minigame` | — | `attempts`, `wins`, `best`, `tiers`, `today`, `weekly`, `leaderboard`, `caps`, `recent` |
| POST | `/minigame/start` | `{}` + `Idempotency-Key` | `runId`, `seed`, `endsAt`, `runMs`, `attempts` |
| POST | `/minigame/finish` | `{ runId, trace: [{ t, x }] }` + `Idempotency-Key` | `result`, `rewards`, `awards`, `attempts`, `wins`, `best` |

`trace` — пары «время от старта, мс» и «x корабля, 0…1000», 40–4000 точек.
Сервер проверяет монотонность времени, границы поля и предел скорости 900 px/с,
затем сам считает попадания и сборы. Ошибки: `daily_limit` (429), `run_not_found`
(404), `run_expired`, `bad_trace`, `too_fast`, `short` (409). Кривая трасса
сжигает попытку. Подробности и числа — `docs/MINIGAME.md`.

`weekly` — `{ wins, target, reward, awarded }`: цель 20 побед за календарную
неделю (с понедельника UTC), награда 150 ASTRA выдаётся один раз и помечается
медалью `arena_week_<начало недели в мс>`. `leaderboard` — топ-10 по победам,
затем по лучшему счёту; у своей строки `isMe: true`.

## Гараж

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/garage` | — | `slots`, `used`, `free`, `max`, `base`, `extra`, `premiumBonus`, `price`, `canBuy` |
| POST | `/garage/buy` | `{}` + `Idempotency-Key` | `slots`, `extra`, `astra`, `price` |

База — 3 ячейки, потолок — 8, ячейка стоит 200 ASTRA, Premium добавляет одну.
Корабль в полный гараж не продаётся (`garage_full`, 409) и ASTRA не списываются;
дальше потолка ячейки не продаются (`garage_max`, 409). Корабли с типом, ценой и
состоянием лежат в `/me` → `ships` и `catalog`.

## Админка мира

Только для оператора: заголовок `X-Admin-Token` (секрет `ADMIN_TOKEN`),
идентификатор мира — обязательный `?world=w1` (`[a-zA-Z0-9_-]`, до 32 символов;
иначе `bad_world`).

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/admin/world` | — | `world`, `frozen`, `totals`, `verify`, `players[]` |
| POST | `/admin/world/freeze` | `{ frozen: boolean }` | `frozen` |
| POST | `/admin/world/grant` | `{ player, astra, reason }` | `granted`, `astra`, `world`, `playerId`, `resolvedBy` |

`verify` — сверка журнала: `{ ok, rows, brokenAtSeq?, mismatches? }`. `totals` —
`players`, `astra`, `points`, `ships`, `adventures`. Начисление принимает
`astra` от −100000 до 100000, не ноль и не дробь (`bad_amount`), требует
непустую причину (`reason_required`) и пишет строку в `admin_log`; отрицательная
сумма работает как списание и упадёт с `insufficient_funds`, если баланса не
хватает. Ошибки: `admin_token_required` (401), `admin_forbidden` (403),
`admin_disabled` (503), `bad_world`, `bad_target`, `bad_amount`,
`reason_required`, `ambiguous_player` (409), `player_not_found` (404).

`player` — это id игрока, **начало** id (как в списке админки, от 4 символов) или
email; старое поле `playerId` принимается для совместимости. Мир определяется по
самому игроку из D1 (`users.world_id`), а не по `?world=`, — поэтому начисление
не улетает в чужой мир. `?world=` используется только как запасной вариант, если
игрока нет в D1. `resolvedBy` — `email`, `id`, `prefix` или `world`.

## Боксы (этап 5)

Два бесплатных бокса по таймеру и два платных за ASTRA. Внутри только ресурсы:
ASTRA из бокса не выпадает никогда.

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/boxes` | — | `boxes[]`, `history[]` |
| POST | `/boxes/open` | `{ box }` + `Idempotency-Key` | `box`, `name`, `price`, `drops[]`, `units`, `rare`, `components`, `astra`, `nextOpenAt`, `opens` |

`boxes[]` — по записи на бокс: `id` (`daily`, `weekly`, `crate_supply`, `crate_pro`),
`name`, `hint`, `sprite`, `price` (0 у бесплатных), `cooldownMs`, `units` (`[min, max]`),
`nextOpenAt` (0 — можно открывать), `ready`, `opens`. `history[]` — до пяти последних
открытий: `{ box, drops[], at }`.

Таймеры: `daily` — 24 часа, `weekly` — 7 дней от момента открытия. Повтор раньше
времени — `box_cooldown` (429) с заголовком `Retry-After`; платные боксы таймера не
имеют. Платный без денег — `insufficient_funds` (409), при этом ни ASTRA, ни ресурсы
не меняются. Неизвестный `box` — `bad_box` (400). Замороженный мир — `world_frozen` (423).
Открытие пишется в журнал: `box_purchase` (списание цены) и `box_open` (ресурсы),
причина и seed сохраняются в `box_opens`, поэтому выдачу можно перепроверить.

Состав боксов лежит в `worker/src/shared/gameData.ts` (`BOXES`). Платные боксы —
сток ASTRA: средняя выдача по базовым ценам рынка не больше 60 % цены (проверяется
тестом `boxes.test.ts`), иначе их было бы выгодно скупать и перепродавать.
