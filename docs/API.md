# API

Все маршруты — на том же origin, что и сайт. Формат — JSON, `Content-Type:
application/json; charset=utf-8`. Ответы не кэшируются (`Cache-Control: no-store`),
кроме `/config`.

## Публичные

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `{ ok, service, build, now }` — `build` из `[vars].APP_BUILD`, `now` в миллисекундах |
| GET | `/config` | `{ turnstile_site_key, server_time, ads }` |
| POST | `/batch` | пачка игровых действий (до 10): `{ops:[{op, idem, body}]}` → `{results:[{op, status, data}], blockedAt, retryAfter}`; деньги, вход, админка и сам `/batch` в пачку не входят |
| GET | `/ops/status` | `{ ok, mode, used, limit, remaining, day, retryAfter, blocked }` — режим бережливости: `full` / `thrifty` / `lite` / `sleep` |
| POST | `/auth/register` | `{ access_token, user: { id, world_id } }` + refresh-cookie |
| POST | `/auth/login` | то же |
| POST | `/auth/refresh` | новый `access_token` + ротированная cookie |
| POST | `/auth/logout` | `{ ok: true }`, cookie очищается |

`/auth/register` принимает `email`, `password` и необязательный `ref` (id мира
пригласившего). `/auth/login` — `email`, `password`. Проверки «я человек» на входе
и при регистрации нет: Turnstile остался только там, где выдаётся бонус
(`POST /claim`, бесплатные `POST /boxes/open`).

Против фейковых аккаунтов работает проверка почты: жёсткий формат, список
одноразовых доменов, наличие MX-записи (DNS-over-HTTPS) и нормализация алиасов
(`a+shop@gmail.com` = `a@gmail.com`, точки внутри Gmail не значимы) — в
`users.email` лежит канонический адрес, поэтому UNIQUE сам отсекает «второй аккаунт
тем же ящиком». Отказ: 400 `bad_email`, 400 `disposable_email`, 400 `no_mx`,
503 `email_check_unavailable` (DNS не ответил — повторите), 409 `email_taken`,
429 `too_many_signup_from_domain` (более 7 регистраций в час с незнакомого домена;
крупным почтовикам потолок не мешает). MX и потолок на домен выключаются только
явно — `SIGNUP_GUARD = "off"` для локального запуска и e2e; формат, список
одноразовых доменов и нормализация алиасов работают всегда.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/pool.json` | публичный отчёт пула: итоги по валютам, последние операции, флаг выплат |
| GET | `/pool/report` | алиас `/pool.json` |
| GET | `/pay/status.json` | состояние Astra Pay: сеть, контракт USDT, флаги, версия схемы |
| GET | `/pay/products.json` | каталог: косметика и услуги, цены строкой, `purchasesEnabled` |

Пул ведётся отдельно от Ledger: ASTRA — внутриигровая валюта, её нельзя купить
или вывести. Правила и запись — `docs/POOL.md`.

`/pay/status.json` — единственный публичный маршрут Astra Pay на этапе 1. Он
отдаёт `{ ok, service: "astra-pay", version, network, chain, networkLabel, asset:
"USDT", decimals, contract, confirmations, rail, flags, schema, tables, now }`,
где `flags` — шесть переключателей (`payments`, `deposits`, `purchases`, `pool`,
`payouts`, `sweep`), а `schema` — `"off"` (база не проверялась, деньги выключены),
`"ready"` или `"error"`.

`chain` — активная цепь (`tron` | `bsc`), `decimals` — знаки USDT в ней (6 и 18
соответственно), `networkLabel` — как сеть называть для игрока. `rail` —
готовность рельса этой цепи в текущей сборке: `{ addresses, deposits, payouts,
reason }`. Это не украшение: «сеть выбрана» и «код умеет» — разные вещи, и пока
`rail.addresses` ложный, `/pay/address.json` отвечает `503` с тем же `reason`,
а не выдаёт адрес, который никто не умеет смотреть.
Ключей, адресов игроков и сумм в ответе нет. Пока все флаги `off`, денежных
маршрутов не существует: запросы к ним вернут `404`.

## Astra Pay (с авторизацией)

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/pay/account.json` | баланс USDT, история операций, купленная косметика |
| GET | `/pay/address.json` | личный адрес пополнения USDT: `{ address, chain, networkLabel, contract, decimals, confirmations }` |
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
| GET | `/admin/pay/sweep/plan` | админ | план сбора: по каждому адресу USDT и нативная монета на комиссию (TRX в TRON, BNB в BSC), хватает ли на газ, и сколько газа занести, чтобы собрать остальное; ничего не двигает |
| GET | `/admin/pay/prize` | админ | сколько в призовом фонде, сколько выдано, баланс кошелька (USDT/TRX) и последние призы |
| POST | `/admin/pay/prize/award` | админ | начислить приз из фонда на баланс игрока; `dryRun` по умолчанию, сумма не больше остатка фонда |
| POST | `/admin/pay/send` | админ | подпись и отправка зарезервированной выплаты; `409 hot_wallet_insufficient_usdt` / `hot_wallet_no_trx` (TRON) / `hot_wallet_no_bnb` (BSC) — платить нечем, заявка остаётся `reserved`; `502 chain_id_mismatch`, `gas_price_too_high`, `nonce_busy`, `hot_address_mismatch`, `signer_contract_mismatch` — конфигурация, деньги не двинулись |
| (cron) | — | — | в BSC подтверждение выплаты по квитанции сети (`pay/evm/payouts.ts`) делает cron: `sent → confirmed`, реверт → `failed` с возвратом. Вручную подтверждения не требуются |
| GET | `/admin/pay/solvency` | админ | обязательства (балансы игроков + призовой фонд) против активов в блокчейне: покрытие, дефицит. `plan.truncated: true` означает «адресов больше, чем мы прочитали» — в этом случае активы считаются неполными и «покрыто» не утверждается |

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
| GET | `/me` | состояние игрока и мира, `server_time`; `?ship=<id>` — считать планеты и варианты рейса под этот корабль |
| POST | `/claim` | Claim; `Idempotency-Key` обязателен; при настроенном Turnstile — `body.turnstileToken` |
| GET | `/ledger?limit=N` | журнал игрока, N = 1…50 (по умолчанию 30) |
| POST | `/expeditions/start` | `{ shipId, planet, kind }`, `Idempotency-Key`; свободные корабли летят одновременно |
| POST | `/expeditions/choose-event` | `{ expeditionId, choiceId }` (алиас `/expeditions/choose`) |
| POST | `/expeditions/cancel` | `{ expeditionId }`, первые 10 % рейса |

Рейсов у игрока столько, сколько свободных кораблей: `ship_busy` (409) стоит по
занятости **борта**, а не игрока. В `/me` блок `expeditions` — `{ active[], recent[],
activeCount }`: `active` отсортирован по времени старта, и в нём лежат **все**
летящие рейсы (раньше был `LIMIT 1` — второй борт флота в интерфейс не попадал).
`GET /me?ship=<id>` просит посчитать `planets[].options` под конкретный корабль:
у разных корпусов разные радиус, расход и груз, поэтому оценки обязаны быть про
тот борт, который нажмёт «Старт». Несуществующий или чужой `ship` не ошибка —
сервер молча считается на первый корабль.
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
| `turnstile_required` | 403 | нужен токен Turnstile (только бонусные маршруты) |
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
| `idempotency_key_required` | 400 | нет заголовка `Idempotency-Key` |
| `bad_idem_key` | 400 | ключ не по формату: 8…64 символа `[A-Za-z0-9._:-]` |

Лимит тела в 16 КиБ считывается потоком (`http/response.ts`), а не по
`Content-Length`: chunked-передача и врущий заголовок длины дают тот же 413.
Формат `Idempotency-Key` проверяется и в одиночных маршрутах, и в `/batch` —
одним и тем же правилом, чтобы в `idempotency_keys` не осился мусор произвольной
длины.

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

## Аркада: десять мини-игр (этап 18)

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/arcade` | — | `attempts`, `wins`, `best`, `games`, `tiers`, `allTen`, `weekly`, `today`, `leaderboard`, `recent`, `caps`, `winScore`, `maxScore` |
| POST | `/arcade/start` | `{ game }` + `Idempotency-Key` | `runId`, `game`, `seed`, `endsAt`, `runMs`, `attempts` |
| POST | `/arcade/finish` | `{ runId, …ввод игры }` + `Idempotency-Key` | `game`, `result`, `rewards`, `awards`, `attempts`, `wins`, `best` |

`game` — один из `maze`, `sudoku`, `memory`, `sequence`, `reaction`, `runner`,
`breakout`, `snake`, `aim`, `catch`; список живёт в `ARCADE_GAMES`
(`worker/src/shared/arcade.ts`) и проверяется и в маршруте (`bad_game`, 400), и
CHECK-ограничением таблицы `arcade_runs`.

Второе поле запроса зависит от игры — и только от неё:

| Игра | Поле | Что внутри |
| --- | --- | --- |
| `maze` | `moves` | поворот 0…3 (вверх/вправо/вниз/влево), ≤400 |
| `sudoku` | `answers` | 81 число 0…9; 0 — клетка не заполнена |
| `memory` | `moves` | индексы карт 0…19, ≤200 |
| `sequence` | `presses` | цвета узлов 0…3, ≤400 |
| `reaction` | `taps` | метки времени тапов, мс; не чаще раза в 150 мс |
| `runner`, `breakout`, `catch` | `axis`, `stepMs` | трасса позиции ×10 по ровной сетке (шаг 20…200 мс) |
| `snake` | `dirs` | направление на каждом шаге поля (150 мс) |
| `aim` | `shots` | `[{ t, x, y }]`, не чаще раза в 120 мс |

Сервер не принимает ни `score`, ни «я выиграл»: он сам строит поле из `seed`,
сам проигрывает трассу и сам считает очки (0…600, победа с 300). Отсюда отказы:
`bad_trace` (ход против правил поля — стена в лабиринте, правка подсказки в
судоку, путь короче кратчайшего), `too_fast` (движение быстрее физического
предела, спам тапами), `short` (раунд не доигран). `run_not_found` — 404,
`daily_limit` — 429, остальные — 409. Кривой ввод сжигает попытку: перебирать
ответы бесплатно нельзя. Награда — только опыт: `rewards.xp` (3…27 XP за забег,
суточный потолок 200 XP) и разовые `awards`. ASTRA, очки сезона и ресурсы
аркада не начисляет и не списывает. Подробности — `docs/ARCADE.md`.

## Гараж

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/garage` | — | `slots`, `used`, `free`, `max`, `base`, `extra`, `premiumBonus`, `level`, `price`, `nextPrices`, `canBuy` |
| POST | `/garage/buy` | `{}` + `Idempotency-Key` | `slots`, `extra`, `astra`, `price` |

База — 3 ячейки, потолок — 6: ровно по числу кораблей в игре (Scout, Hauler,
Miner, Explorer, Cruiser, Flagship). Восьмая клетка при шести корпусах была бы
вечно пустым слотом, за который просят ASTRA. Premium добавляет одну ячейку
сверх купленных — но не сверх потолка. Цена не плоская:
`200 × 1.8^купленных × (1 + 0.05 × (уровень − 1))`, округление до 10 ASTRA.
То есть каждая следующая ячейка дороже предыдущей, и дорожает она вместе с
уровнем игрока — доход у ветерана выше, и сток обязан масштабироваться.
`price` — сколько стоит следующая ячейка прямо сейчас, `nextPrices` — лестница
всех оставшихся (клиент рисует её под кнопкой, чтобы «ещё одна» не выглядела
обещанием). `level` отдаётся, чтобы подпись надбавки не считалась на клиенте.
Корабль в полный гараж не продаётся (`garage_full`, 409) и ASTRA не списываются;
дальше потолка ячейки не продаются (`garage_max`, 409). Корабли с типом, ценой и
состоянием лежат в `/me` → `ships` и `catalog`; в UI занятая ячейка показывает
сам корпус (спрайт типа), прочность, полосу модулей и подпись `модули N/M`.

## Опыт и уровень

Опыт — актив журнала (`asset: xp`), уровень игрока — его производная
(`levelFromXp`, кривая `40 × (L−1)^1.3`: L2 = 40, L5 = 242, L12 = 903 XP).
Начисляется за всю обычную активность, а не только за рейсы: Claim +1, дневная
миссия +10/+16, недельная +60, забег на арене +4 (+8 за победу), открытие бокса
+2…+10, уровень модуля +2×L, готовый крафт +3, завершённый рейс — по типу.
Ответы `claim`, `missions/claim`, `minigame/finish`, `boxes/open`, `modules/install`
несут поле `xp` — сколько начислено именно за это действие. Игрокам, набежавшим
до правки, опыт догоняется миграцией `catchUpXpFromPoints` (1 XP за каждые 4
очка сезона, разово, через журнал). Забег аркады — +3 XP (+6 за победу и до +18 сверху за очки),
медаль аркады — +60…+300 XP разово.

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
| GET | `/planes` | полка звена, слоты патруля и все борта в воздухе |
| POST | `/planes/patrol` | `{ plane }` + `Idempotency-Key` — отправить машину в патруль |
| POST | `/planes/patrol/claim` | `Idempotency-Key` — сдать **все** вернувшиеся борта |
| POST | `/boxes/open` | `{ box }` + `Idempotency-Key` | `box`, `name`, `price`, `drops[]`, `units`, `rare`, `components`, `plane`, `astra`, `nextOpenAt`, `opens` |

## Проверка «человек» на бесплатных наградах

Claim и открытие бесплатных боксов (`daily`, `weekly`) закрыты шлюзом Turnstile:
если на воркере задан `TURNSTILE_SECRET`, тело запроса обязано нести
одноразовый `turnstileToken`, полученный виджетом на экране. Платные боксы не
проверяются — там подтверждением служит списание ASTRA. Отказ приходит до
обращения к миру, поэтому ошибка проверки ничего не списывает и не начисляет, а
ключ идемпотентости остаётся свободным для повтора. Коды: `turnstile_required`
(403, токена нет) и `turnstile_failed` (403, siteverify отклонил). Без секрета
(разработка, тесты) шлюз пропускает запросы целиком, и клиент не показывает
виджет: `config.turnstile_site_key` в этом случае `null`.

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

### Авиазвено (этап 6)

`GET /planes` → `{ found, total, models[], patrol, active[], slots, ready, flying,
freeSlots, patrols, hours }`. В `models[]` все восемь машин, включая не найденные
(`count: 0`): `{ id, name, rarity, rarityName, hint, sprite, count, firstAt,
patrolMs, findChance, salvage[], salvageText, xp, flying }`.

Звено **летает и добывает**. Патруль — это спасательный вылет: борт возвращается с
закладкой ресурсов и опытом. ASTRA патрулём не капает никогда: валюта уже идёт из
рейсов, арены и Claim, а звено бесплатно в содержании — ни топлива, ни износа.
Ресурсы же становятся деньгами только через рынок, то есть через второе действие.

| Редкость | Полёт | Закладка | Опыт | Шанс находки |
| --- | --- | --- | --- | --- |
| обычная | 6 ч | 1 железа | 4 | 1 % |
| редкая | 12 ч | 2 железа + 1 кремний | 8 | 2 % |
| легендарная | 24 ч | 3 железа + 1 кристалл | 16 | 4 % |

Тормозов три: слоты (`slots` = 4 борта в воздухе), длительность (4 / 2 / 1 вылет
в сутки на борт) и необходимость самому прийти и сдать добычу — в стол она не
капает. Шанс находки в таблице — для пустой коллекции: найденное не повторяется
(см. ниже про `rollPlane`), поэтому чем полнее звено, тем реже патруль приносит
`found` — а при собранной коллекции он приносит только закладку.

`POST /planes/patrol` `{ "plane": "strizh" }` отправляет **свою** машину в патруль.
Одна модель — один вылет: второй `patrol_busy`, пятый борт при четырёх слотах —
`patrol_slots_full` (409). Ответ: `{ patrol, planes }`.
Коды: `bad_plane` (400), `plane_not_owned` (409), `patrol_busy` (409),
`patrol_slots_full` (409), `world_frozen` (423).

`POST /planes/patrol/claim` сдаёт **все** вернувшиеся борта одним нажатием —
иначе игроку пришлось бы кликать по числу слотов. Ответ:
`{ found, foundList[], claimed, xp, salvage[], plane, planes }`, где `found` —
первая находка (`{ id, name, rarity, rarityName, sprite, count, firstTime }`,
всегда новая: уже собранное патруль не приносит) или
`null`, `foundList` — все находки залпа, `claimed` — сколько бортов принято,
`salvage` — суммарная закладка (`{ resource, name, amount }`). Раньше времени —
`patrol_flying` (409), без патруля — `no_patrol` (404). Сколько осталось ждать,
клиент берёт из `patrol.endsAt`: ошибка из мира приходит строкой кода, поэтому
`Retry-After` на этих 409 не уходит.

Начисление идёт в тот же журнал, что и рейсы: `plane_salvage` с `source_ref` = id
патруля, по одной записи на ресурс и на опыт каждого борта. Поэтому сдача
параллельных патрулей не может «начислить дважды»: повтор закрыт идемпотентным
ключом, а сверка видит ровно те же суммы.

`plane` в `/boxes/open` — машина звена (этап 6) или `null`:

```
plane: { id, name, rarity, rarityName, hint, sprite, count, firstTime } | null
```

Машина идёт сверху ресурсов и на них не влияет: `units` и `drops` считаются как
раньше, тем же seed. Она не тратит ASTRA, не занимает ячейку гаража и в рейсы не
летит — это коллекция.

**Повторов нет.** `rollPlane(def, seed, owned)` выбирает модель только из тех, что
у игрока ещё не собраны, поэтому второй «Стриж» из бокса не выпадает физически.
Выпавшая ступень собрана целиком — бросок переезжает на соседнюю (сначала ниже,
потом выше): бокс остаётся полезным до конца коллекции, но не превращается в
джекпот. Собраны все восемь машин — `plane: null`, бокс отдаёт только ресурсы.
Функция детерминирована: тот же seed и тот же набор `owned` — та же машина, а для
пустого `owned` результат совпадает со старым байт в байт, поэтому уже выданные
боксы перепроверяются по сохранённому seed. Счётчик `player_planes.count` остаётся
единственным местом, где дубль мог бы копиться, — патрульные находки он и дальше
складывает в `count`, `firstTime` говорит, новая ли это модель.

В `GET /boxes` к списку боксов добавлены честные счётчики коллекции:
`planesFound`, `planesTotal`, `planesAllOwned`, а у каждого бокса в
`planeChances[]` — `{ rarity, rarityName, chance, models, fresh }`, где `fresh` —
сколько моделей ступени ещё не собрано (`fresh: 0` шанса на машину не даёт, и UI
обязан сказать это до покупки.

Полка целиком приходит в `/me` в блоке `planes` — тот же ответ, что и `GET /planes`
(включая `active[]` и `slots`), чтобы клиенту не нужен был второй запрос на экран
гаража. Не найденные модели там тоже есть — с `count: 0`.

Состав боксов лежит в `worker/src/shared/gameData.ts` (`BOXES`). Платные боксы —
сток ASTRA: средняя выдача по базовым ценам рынка не больше 60 % цены (проверяется
тестом `boxes.test.ts`), иначе их было бы выгодно скупать и перепродавать.
