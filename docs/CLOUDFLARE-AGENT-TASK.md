# Задание для агента с доступом к Cloudflare

Это готовое задание, которое можно целиком передать другой нейросети (или
человеку), у которой есть доступ к аккаунту Cloudflare владельца. Всё, что можно
было сделать кодом, уже сделано и влито в `main`; здесь — только то, что требует
дашборда, денег и подписи владельца.

**Репозиторий:** `github.com/alibahsburiev20-cyber/Crypto-Astra`
**База:** `main`, коммит `89d701b` (или новее). Все команды — из корня репозитория.
**Что уже работает в проде:** игра, этап 17 (позывные/косметика), Astra Pay
(флаги приёма и покупок `on`), админка (мир, пул, деньги), мониторинг и health.
**Чего не хватает:** Signer и его секреты, тестовая покупка 1 USDT, продовый
замер нагрузки, 7 дней сверки.

**Что НЕ нужно покупать:** домен. Работаем на бесплатном
`https://crypto-astra.cryptoastra.workers.dev`. Cloudflare Access на этом адресе
недоступен — админку защищают `ADMIN_TOKEN`, проверка `ADMIN_EMAIL` и блокировка
подбора по IP (10 ошибок → 15 минут). Домен и Access — необязательный апгрейд
на будущее, отдельной задачей и только с деньгами владельца.

---

## Как этим пользоваться

Владельцу: откройте этот файл на GitHub и передайте ссылку (или скопируйте текст
целиком) агенту, у которого есть доступ к Cloudflare. Ниже — короткая версия,
которую можно вставить как промпт; подробности — в разделах 0–7.

```text
Ты — инженер, у которого есть доступ к моему аккаунту Cloudflare (API token с
правами Workers Scripts:Edit, D1:Edit, DNS:Edit, Access:Edit) и к репозиторию
github.com/alibahsburiev20-cyber/Crypto-Astra.

Прочитай docs/CLOUDFLARE-AGENT-TASK.md в этом репозитории и выполни задачи
T1–T10 по порядку. Это продовая система, в которой уже есть настоящие деньги:
приём USDT включён, выплаты выключены.

Жёсткие правила:
1) Не включай PAYOUTS_ENABLED, SWEEP_ENABLED, POOL_ENABLED — это решение владельца.
2) Никаких трат: домен не покупаем, платные тарифы не подключаем. Денег нет.
   Работаем на бесплатном *.workers.dev. Единственное исключение — переводы
   TRX/USDT на горячий кошелёк, и только после моего «да».
3) Секреты не попадают в git, чат, логи и скриншоты.
4) SIGNER_SEED создаётся один раз и навсегда: сначала две бумажные копии, потом деплой.
5) После каждого шага выполняй проверку из документа. Если проверка не прошла —
   остановись и напиши мне, что именно не сошлось.
6) В конце пришли отчёт по форме из раздела 5.
```

---

## 0. Правила, которые нельзя нарушать

1. **Не включать выплаты, консолидацию и пул.** `PAYOUTS_ENABLED`,
   `SWEEP_ENABLED`, `POOL_ENABLED` остаются `"off"`. Это решение владельца, а не
   техническая настройка. Включение = прямая финансовая ошибка.
2. **Никаких трат без письменного «да» владельца.** Домен не покупать, платные
   тарифы не включать: работаем на бесплатном `*.workers.dev`. Пополнение
   горячего кошелька TRX/USDT — только после согласия.
3. **Секреты не попадают в git, чат, логи, скриншоты и issue.** Только
   `wrangler secret put` или Dashboard → Encrypt. Не печатать значения в выводе
   команд (см. `npm run pay:hot-address`: он выводит адрес, а не ключ).
4. **`SIGNER_SEED` создаётся один раз и навсегда.** Из него выводятся адреса
   пополнения всех игроков. Потеря или замена семени = игроки переводят USDT на
   старые адреса, а сервер их больше не видит. Перед деплоем — две бумажные копии
   в двух местах. Это единственный секрет, который нельзя «перевыпустить».
5. **Не менять цены, лимиты и схему БД** без отдельной задачи. Миграции только
   `wrangler d1 migrations apply` (идемпотентно), никаких ручных `DROP`.
6. **Останавливаться и спрашивать**, если что-то из проверок раздела 1 не
   сходится. Лучше остановиться, чем «починить» деньги наугад.

---

## 1. Доступ, который нужен

**Cloudflare API token** (My Profile → API Tokens → Create Custom Token):

| Права | Зачем |
|---|---|
| Account → Workers Scripts: Edit | деплой `crypto-astra` и `astra-pay-signer` |
| Account → D1: Edit | миграции и экспорт дампа |
| Account → Workers Tail / Observability: Read | логи при разборе |
| Zone → DNS: Edit, Zone: Edit | **необязательно**: только если владелец решит купить домен |
| Account → Access: Apps and Policies: Edit | **необязательно**: только вместе с доменом |
| Account → Account Settings: Read | `wrangler whoami` |

Обязательный минимум — первые три строки и Account Settings. Без домена всё
работает: админку защищают токен, почта и блокировка подбора.

**Аккаунт:** ID аккаунта Cloudflare (правый верхний угол дашборда).
**GitHub:** доступ к репозиторию на чтение (правки не нужны, кроме отчёта).

Переменные окружения для CLI:

```bash
export CLOUDFLARE_API_TOKEN=...   # из дашборда, не в репозиторий
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler whoami               # должно показать аккаунт и права
```

---

## 2. Префлайт (10 минут, ничего не меняет)

```bash
git clone https://github.com/alibahsburiev20-cyber/Crypto-Astra && cd Crypto-Astra
npm ci
npm run check                     # 49 файлов, 437 тестов, tsc — должно быть чисто
node scripts/embed-client.mjs && git diff --exit-code -- worker/src/static/site.ts
npm run health -- --base https://crypto-astra.cryptoastra.workers.dev
```

Дальше в командах используются переменные (экспортируйте их один раз):

```bash
BASE=https://crypto-astra.cryptoastra.workers.dev
ADMIN_TOKEN=<значение секрета>
```

Ожидаемо от `health`: `build=2026-11-17.2`, `schema=ready`, `tables=14`,
`payouts=false`, `sweep=false`, `problems: []`.
Если `schema != ready` — сначала раздел 3 (T1). Если `problems` не пуст — стоп,
разбор, отчёт владельцу.

Прочитать перед работой: `docs/PAY-SIGNER.md`, `docs/ASTRA-PAY-RUNBOOK.md`,
`docs/ADMIN.md`, `docs/MONITORING.md`, `docs/RUNBOOK_BACKUP.md`.

---

## 3. Задачи по порядку

Каждая задача: что сделать → чем проверить → что считается успехом. Если проверка
не прошла, дальше не идти.

### T1. Миграции D1 (без денег, безопасно)

```bash
npx wrangler d1 migrations list DB --remote
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 migrations apply DB --remote --preview   # база превью
```

**Проверка:** `GET /pay/status.json` → `"schema":"ready"`, `"tables":14`;
`GET /health` → `200`.
**Успех:** ошибок 5xx нет, `tables` = 14.
**Откат:** у D1 нет «отмены миграции»; восстанавливать из Time Travel
(Dashboard → D1 → astra-global → Time Travel). Поэтому миграции применяются
только вперёд и только из репозитория.

### T2. Секреты основного Worker `crypto-astra`

```bash
openssl rand -base64 48 | npx wrangler secret put JWT_SECRET
openssl rand -hex 32   | npx wrangler secret put ADMIN_TOKEN
echo 'alibahsburiev20@gmail.com' | npx wrangler secret put ADMIN_EMAIL
echo '<TURNSTILE_SECRET из дашборда Turnstile>' | npx wrangler secret put TURNSTILE_SECRET
```

- `JWT_SECRET` **не** равен значению из `wrangler.toml` (оно только для превью).
  Смена ключа разлогинивает всех — делать до анонса.
- `ADMIN_TOKEN` ≥ 32 символов, не пароль от почты.
- `ADMIN_EMAIL` — почта владельца, вход в админку сверяет её без учёта регистра.
- `TURNSTILE_SECRET` — обязательно, если задан `TURNSTILE_SITE_KEY`
  (`0x4AAAAAAGGq5Lt25F34cDiq`). После 3 неудачных входов сервер требует проверку.
- Опционально, но желательно: `TRONGRID_API_KEY` (бесплатный тариф TronGrid) —
  без него индексатор депозитов упирается в лимиты по IP.

**Проверка:**

```bash
curl -s https://<адрес>/health | grep -o '"build":"[^"]*"'
curl -s -o /dev/null -w '%{http_code}\n' https://<адрес>/me          # 401
curl -s -o /dev/null -w '%{http_code}\n' https://<адрес>/admin/pool  # 401
```

**Успех:** `/me` и `/admin/pool` отвечают 401 без токена, `/health` — 200.

### T3. Signer `astra-pay-signer` (ключи и деплой)

1. Сгенерировать и **сразу записать на бумагу** семя:

   ```bash
   openssl rand -hex 32        # SIGNER_SEED — 64 hex-символа, выводится один раз
   openssl rand -hex 32        # SIGNER_TOKEN — понадобится дважды
   ```

2. Приватный ключ горячего кошелька (`SIGNER_PRIVATE_KEY`, 64 hex). Если кошелёк
   новый — создать офлайн (Trust Wallet / аппаратный кошелёк), записать seed-фразу
   отдельно. На кошелёк нужно ~20–30 TRX на комиссии и небольшой запас USDT.

3. Узнать публичный адрес этого ключа **без вывода ключа в историю**:

   ```bash
   SIGNER_PRIVATE_KEY=<hex> npm run pay:hot-address
   # → {"address":"T...","ok":true}
   ```

4. Задать секреты Signer (значения — из шага 1–2):

   ```bash
   cd signer
   npx wrangler secret put SIGNER_TOKEN
   npx wrangler secret put SIGNER_SEED
   npx wrangler secret put SIGNER_PRIVATE_KEY
   npx wrangler deploy            # workers_dev = false: публичного адреса нет
   cd ..
   ```

5. Связать Worker'ы: в корневом `wrangler.toml` раскомментировать блок

   ```toml
   [[services]]
   binding = "SIGNER"
   service = "astra-pay-signer"
   ```

   затем задать в основном Worker те же `SIGNER_TOKEN` и `PAY_HOT_ADDRESS`
   (адрес из шага 3), выполнить `npm run config:sync` и `npx wrangler deploy`.

**Проверки:**

```bash
curl -s https://<адрес>/pay/status.json | grep -o '"wallets":"[^"]*"'   # "ready"
# с токеном игрока (JWT из /auth/login):
curl -s -H "Authorization: Bearer $TOKEN" https://<адрес>/pay/address.json
```

**Успех:**
- `wallets:"ready"`;
- `/pay/address.json` возвращает `T…`, `network:"mainnet"`, `asset:"USDT"`,
  `contract:"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"`;
- повторный вызов — **тот же адрес** (`index` тот же);
- без токена — 401; при неверном `SIGNER_TOKEN` — 503 `signer_not_configured`;
- у Signer нет публичного адреса: `https://astra-pay-signer.<sub>.workers.dev`
  не открывается (404/нет DNS).

**Откат:** убрать `[[services]]`, `npx wrangler deploy` — основной Worker снова
отвечает `signer_required`, деньги не двигаются.

### T4. Админка на бесплатном домене (без Access)

Доменов и Access здесь нет — всё держится на трёх вещах, которые уже в коде:

1. `ADMIN_TOKEN` (≥ 32 случайных символа, он же из T2) — без него `/admin/*`
   отвечает 401, с неверным — 403;
2. `ADMIN_EMAIL` — второй замок: без совпадающей почты в `X-Admin-Email` будет 403;
3. **блокировка подбора по IP**: 10 неверных токенов с одного адреса → 429 на
   15 минут (таблица `auth_limits`, сбрасывается после успешного входа).

**Проверки:**

```bash
BASE=https://crypto-astra.cryptoastra.workers.dev

curl -s -o /dev/null -w '%{http_code}\n' $BASE/admin/pool            # 401
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Admin-Token: wrong'  $BASE/admin/pool   # 403
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Admin-Token: $ADMIN_TOKEN" $BASE/admin/pool  # 200
```

**Успех:** коды ровно 401 / 403 / 200; после 10 ошибок подряд приходит 429 с
`Retry-After`, а через 15 минут снова 200.

**Важно:** токен вводится только в форме `/admin` (лежит в `sessionStorage`
вкладки), в URL и логи он не попадает. Не публиковать его в чатах и скриншотах.

**Откат:** `npx wrangler secret put ADMIN_TOKEN` с новым значением — старый сразу
перестаёт работать.

### T5. (Необязательно, только если появятся деньги) Домен и Access

Пропустить, если владелец не выделил деньги. Нужно только для того, чтобы
`/admin` прикрывался ещё и Cloudflare Access (он не работает на `*.workers.dev`).

1. Домен → зона в Cloudflare → NS у регистратора (TLS: Full strict).
2. Worker → Settings → Domains & Routes → Custom domain.
3. Zero Trust → Access → Self-hosted: path `admin`, policy `Allow` по e-mail
   владельца.
4. GitHub → Variables → `SITE_URL` = новый домен.

**Успех:** `$BASE/admin` в приватном окне показывает вход Cloudflare
Access; `curl` без cookie даёт 302/403, а не 401 от нашего кода. `ADMIN_TOKEN`
при этом остаётся.

### T6. Тестовая покупка 1 USDT (только с владельцем)

Проверяет весь путь «перевод → индексатор → баланс → покупка».

1. Владелец входит в игру, открывает `/pay`, нажимает **«Получить адрес»**,
   копирует адрес.
2. Переводит **ровно 1 USDT (TRC-20)** на этот адрес (не «похожий» токен, не
   другая сеть).
3. Ждёт 1–2 подтверждения (обычно < 1 мин).
4. Агент проверяет:

   ```bash
   curl -s $BASE/admin/pay -H "X-Admin-Token: $ADMIN_TOKEN" | python3 -m json.tool
   ```

   В `reconcile.totals.creditedDepositsMicro` появляется `1000000`,
   `reconcile.ok: true`, `issues: []`.
5. Владелец покупает самый дешёвый товар витрины; агент проверяет, что
   `pay_ledger` вырос на одну запись, баланс уменьшился на цену, товар выдан,
   повторный клик с тем же `Idempotency-Key` второй покупки не создаёт.

**Успех:** депозит зачислен один раз, покупка прошла один раз, `reconcile.ok`.
**Провал:** депозит не появился → `docs/ASTRA-PAY-RUNBOOK.md` §3 (смотреть
`contractRet`, контракт, адрес). Ничего не «докручивать» вручную, пока не понятна
причина.

### T7. Продовый замер нагрузки (только чтение)

```bash
npm run pay:loadtest -- --base $BASE --requests 500 --concurrency 25
# с токеном игрока добавляется чтение D1:
npm run pay:loadtest -- --base $BASE --requests 500 --concurrency 25 --token "$TOKEN"
```

**Порог:** ошибок ≤ 1 %, p95 ≤ 500 мс. Цифры внести в `docs/MONITORING.md`
(раздел 6), рядом с локальными, с пометкой «прод, дата».

### T8. Мониторинг и алерты

1. UptimeRobot/BetterStack: HTTP-монитор на `$BASE/health`, 1 минута,
   keyword `"ok":true`; второй — `/pay/status.json`, keyword `"schema":"ready"`.
2. Алерты: e-mail владельца + Telegram-бот.
3. Cloudflare → Notifications: включить уведомления об ошибках Worker и о лимитах.
4. GitHub Actions → workflow `health` — убедиться, что зелёный, и что он ходит на
   `SITE_URL`.
5. Проверить, что алерт действительно приходит: временно поставить монитору
   неверный путь, дождаться письма, вернуть путь. Прод при этом не трогать.

### T9. Бэкапы и репетиция восстановления на проде

```bash
npx wrangler d1 export DB --remote --output astra-$(date +%F).sql
sha256sum astra-$(date +%F).sql > astra-$(date +%F).sql.sha256
DUMP=astra-$(date +%F).sql bash scripts/restore-drill.sh
```

**Успех:** `integrity: ok`, `mismatches: []`, `restoreMs` < 60 000.
Дампы хранить вне репозитория (R2 или локально), минимум 7 последних дней.
Раз в неделю — повторять; результат писать в `docs/RUNBOOK_BACKUP.md`.

### T10. 7 дней сверки Ledger (наблюдение, не код)

Каждый день (5 минут):

```bash
BASE=https://crypto-astra.cryptoastra.workers.dev
npm run health -- --base $BASE
curl -s $BASE/admin/pay -H "X-Admin-Token: $ADMIN_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['reconcile']['ok'], d['reconcile']['issues'], d['queue'])"
```

Записывать в таблицу: дата, `reconcile.ok`, число `issues`, размер очереди,
суммы депозитов/выплат. Тревога, если: `issues` не пусто, `ok:false`,
`payouts` или `sweep` стали `true`, 5xx > 1 %, p95 > 1 с.
При любом из этого — `POST /admin/pay/stop {"stop":true,"reason":"..."}` и звать
владельца (`docs/ASTRA-PAY-RUNBOOK.md`).

---

## 4. Откаты (коротко)

| Что сделали | Как откатить |
|---|---|
| Деплой основного Worker | `npx wrangler rollback` (предыдущая версия) |
| Включили `[[services]]` | убрать блок, `npm run config:sync`, `npx wrangler deploy` |
| Секрет задан неверно | `npx wrangler secret put <ИМЯ>` заново; для `SIGNER_TOKEN` — в обоих Worker'ах |
| Access закрыл лишних | Access → Application → Policy: поправить include |
| Домен не тот (если он вообще был) | Domains & Routes → Remove; DNS вернуть как было |
| Деньги повели себя странно | **сначала** `POST /admin/pay/stop`, потом разбор |

`SIGNER_SEED` откатить нельзя. Если он потерян — это инцидент: старые адреса
перестают отслеживаться, новые выдаются с новым семенем; решение принимает
владелец, а не агент.

---

## 5. Формат отчёта

Прислать владельцу ровно это, без секретов в тексте:

```
1. Адрес: https://crypto-astra.cryptoastra.workers.dev, HTTPS: ok, /health build: <...>
2. D1: миграции применены, schema=ready, tables=14
3. Signer: задеплоен, wallets=ready, адрес игрока выдан и повторяется
4. PAY_HOT_ADDRESS совпадает с ключом (pay:hot-address --check): да
5. Админка: без токена 401, с неверным 403, 10 ошибок → 429, верный токен → 200 (Access не используется)
6. Тестовая покупка 1 USDT: депозит зачислен один раз, покупка одна, reconcile.ok
7. Нагрузка прод: rps <...>, p95 <...> мс, ошибок <...>%
8. Мониторинг: 2 внешних монитора, алерт проверен письмом
9. Бэкап: дамп <дата>, sha256 <...>, restore drill ok за <...> мс
10. Флаги: payouts=false, sweep=false, pool=false (не менялись)
11. Что осталось / где нужен владелец: <...>
```

---

## 6. Чего делать нельзя (ещё раз, списком)

- Включать `PAYOUTS_ENABLED`, `SWEEP_ENABLED`, `POOL_ENABLED`.
- Менять `SIGNER_SEED` после первого деплоя.
- Печатать или пересылать секреты, класть их в git/issue/чат.
- Покупать домен или включать платные тарифы: денег нет, работаем на бесплатном
  `*.workers.dev`. Траты только на TRX/USDT и только с явного согласия.
- Править цены, лимиты выплат и схему БД «по ходу дела».
- Делать `wrangler d1 delete`, `DELETE FROM` в прод-базе, `--force` миграции.
- Отключать Turnstile «чтобы проверить вход».
- Ослаблять админку: пустой `ADMIN_TOKEN`, токен короче 32 символов, отключение
  блокировки подбора или `ADMIN_EMAIL` «чтобы было проще».
- Проверять нагрузку записями: нагрузочный тест только читает.

---

## 7. Шпаргалка команд

```bash
# статус и логи
npx wrangler whoami
npx wrangler deployments list
npx wrangler tail crypto-astra --format pretty

# деплой (из корня, после embed)
node scripts/embed-client.mjs && npx wrangler deploy
cd signer && npx wrangler deploy

# секреты
npx wrangler secret list
npx wrangler secret put JWT_SECRET

# D1
npx wrangler d1 migrations list DB --remote
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 export DB --remote --output astra.sql
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM users"

# проверки
npm run health -- --base $BASE
npm run pay:loadtest -- --base $BASE --requests 500 --concurrency 25
DUMP=astra.sql bash scripts/restore-drill.sh

# адрес горячего кошелька (ключ не печатается)
SIGNER_PRIVATE_KEY=<hex> npm run pay:hot-address
npm run pay:hot-address -- --check T...
```
