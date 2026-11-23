# Задание для агента с доступом к Cloudflare

Это готовое задание, которое можно целиком передать другой нейросети (или
человеку), у которой есть доступ к аккаунту Cloudflare владельца. Всё, что можно
было сделать кодом, уже сделано и влито в `main`; здесь — только то, что требует
дашборда, денег и подписи владельца.

**Репозиторий:** `github.com/alibahsburiev20-cyber/Crypto-Astra`
**База:** `main`, коммит `89d701b` (или новее). Все команды — из корня репозитория.
**Что уже работает в проде:** игра, этап 17 (позывные/косметика), Astra Pay
(флаги приёма и покупок `on`), админка (мир, пул, деньги), мониторинг и health.
**Чего не хватает:** Signer и его секреты, домен, Cloudflare Access перед
`/admin`, тестовая покупка 1 USDT, продовый замер нагрузки, 7 дней сверки.

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
2) Никаких трат (домен, TRX/USDT, платные тарифы) без моего письменного «да».
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
2. **Никаких трат без письменного «да» владельца.** Покупка домена, пополнение
   горячего кошелька TRX/USDT, платные тарифы Cloudflare — только после согласия.
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
| Zone → DNS: Edit, Zone: Edit | домен и SSL |
| Account → Access: Apps and Policies: Edit | защита `/admin` |
| Account → Account Settings: Read | `wrangler whoami` |

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

### T4. Домен и HTTPS

1. Купить/подключить домен (после согласия владельца), добавить зону в Cloudflare,
   делегировать NS у регистратора.
2. Worker → Settings → Domains & Routes → Add → Custom domain
   (`astra.example.com`), дождаться статуса Active.
3. SSL/TLS → Overview → **Full (strict)**; Always Use HTTPS — on; HSTS — по желанию.
4. Проверить: `https://<домен>/health`, `https://<домен>/` и
   `https://<домен>/legal.html` отвечают 200; `http://` редиректит на `https://`.
5. Записать домен в GitHub → Settings → Variables → `SITE_URL`, чтобы workflow
   `health` проверял именно прод. Обновить упоминания адреса в `docs/` (по желанию
   владельца, отдельным PR).

**Успех:** `/health` на новом домене отдаёт `build` из `wrangler.toml`, а
`http://` → 301/308 на `https://`.

### T5. Cloudflare Access перед `/admin`

Access работает только на своём домене (на `*.workers.dev` — нет), поэтому после T4.

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Application domain: `<домен>`, path: `admin` (покрывает `/admin` и `/admin/*`).
3. Policy: `Allow`, include → Emails → `alibahsburiev20@gmail.com`. Второй policy
   можно не делать: остальным — deny по умолчанию.
4. Session duration — 8–24 часа, MFA — по возможности.

**Проверка:** в приватном окне `https://<домен>/admin` показывает страницу входа
Cloudflare Access, а не форму с токеном. После входа — обычная админка.
API-проверка: `curl -s -o /dev/null -w '%{http_code}\n' https://<домен>/admin/pool`
без cookie Access → 302/403 (не 401 от нашего кода).

**Важно:** Access — дополнение к `ADMIN_TOKEN`, а не замена. Оба слоя остаются.

### T6. Тестовая покупка 1 USDT (только с владельцем)

Проверяет весь путь «перевод → индексатор → баланс → покупка».

1. Владелец входит в игру, открывает `/pay`, нажимает **«Получить адрес»**,
   копирует адрес.
2. Переводит **ровно 1 USDT (TRC-20)** на этот адрес (не «похожий» токен, не
   другая сеть).
3. Ждёт 1–2 подтверждения (обычно < 1 мин).
4. Агент проверяет:

   ```bash
   curl -s https://<домен>/admin/pay -H "X-Admin-Token: $ADMIN_TOKEN" | python3 -m json.tool
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
npm run pay:loadtest -- --base https://<домен> --requests 500 --concurrency 25
# с токеном игрока добавляется чтение D1:
npm run pay:loadtest -- --base https://<домен> --requests 500 --concurrency 25 --token "$TOKEN"
```

**Порог:** ошибок ≤ 1 %, p95 ≤ 500 мс. Цифры внести в `docs/MONITORING.md`
(раздел 6), рядом с локальными, с пометкой «прод, дата».

### T8. Мониторинг и алерты

1. UptimeRobot/BetterStack: HTTP-монитор на `https://<домен>/health`, 1 минута,
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
npm run health -- --base https://<домен>
curl -s https://<домен>/admin/pay -H "X-Admin-Token: $ADMIN_TOKEN" \
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
| Домен не тот | Domains & Routes → Remove; DNS вернуть как было |
| Деньги повели себя странно | **сначала** `POST /admin/pay/stop`, потом разбор |

`SIGNER_SEED` откатить нельзя. Если он потерян — это инцидент: старые адреса
перестают отслеживаться, новые выдаются с новым семенем; решение принимает
владелец, а не агент.

---

## 5. Формат отчёта

Прислать владельцу ровно это, без секретов в тексте:

```
1. Домен: <...>, HTTPS: ok, /health build: <...>
2. D1: миграции применены, schema=ready, tables=14
3. Signer: задеплоен, wallets=ready, адрес игрока выдан и повторяется
4. PAY_HOT_ADDRESS совпадает с ключом (pay:hot-address --check): да
5. Access на /admin: включён, политика: 1 e-mail, проверено в приватном окне
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
- Тратить деньги владельца без явного согласия (домен, TRX, USDT, тарифы).
- Править цены, лимиты выплат и схему БД «по ходу дела».
- Делать `wrangler d1 delete`, `DELETE FROM` в прод-базе, `--force` миграции.
- Отключать Turnstile «чтобы проверить вход».
- Закрывать `/admin` только паролем без Access (и наоборот — только Access без
  `ADMIN_TOKEN`).
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
npm run health -- --base https://<домен>
npm run pay:loadtest -- --base https://<домен> --requests 500 --concurrency 25
DUMP=astra.sql bash scripts/restore-drill.sh

# адрес горячего кошелька (ключ не печатается)
SIGNER_PRIVATE_KEY=<hex> npm run pay:hot-address
npm run pay:hot-address -- --check T...
```
