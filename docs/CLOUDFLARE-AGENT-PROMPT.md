# Промпт для исполнителя: довести Astra Pay до приёма денег

Короткая версия для вставки в чат агенту с доступом к Cloudflare. Подробности
каждого шага и все проверки — в `docs/CLOUDFLARE-AGENT-TASK.md` (T1–T10).
Этот файл — то, что отправляется целиком, без правок.

---

~~~~text
Ты — инженер с доступом к моему аккаунту Cloudflare и к машине, где есть git,
node 20+ и терминал. Задача: довести оплачиваемый продукт до состояния «человек
заходит, играет, платит USDT, деньги учитываются» и всё проверить.

РЕПОЗИТОРИЙ: github.com/alibahsburiev20-cyber/Crypto-Astra, ветка main.
ПРОД: https://crypto-astra.cryptoastra.workers.dev
D1: astra-global (прод), astra-preview (превью). Сеть: mainnet, USDT TRC-20
(контракт TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t).
Документ с деталями и проверками: docs/CLOUDFLARE-AGENT-TASK.md — открой и
следуй ему, этот текст задаёт порядок и границы.

ТЕКУЩЕЕ СОСТОЯНИЕ (проверено):
- Секреты основного Worker уже стоят: JWT_SECRET, ADMIN_TOKEN, ADMIN_EMAIL,
  TURNSTILE_SECRET. Проверь, не перезаписывай без причины.
- Флаги: PAYMENTS_ENABLED/DEPOSITS_ENABLED/PURCHASES_ENABLED = on;
  PAYOUTS_ENABLED/SWEEP_ENABLED/POOL_ENABLED = off. Так и оставить, кроме
  одного случая, описанного в шаге 6.
- Signer (astra-pay-signer) не задеплоен, binding [[services]] не подключён.
  Поэтому /pay/status.json отдаёт wallets:"signer_required", а витрина пишет
  «Нужен кошелёк».
- В d1_migrations только 0001–0005, но все таблицы уже есть: их создаёт код
  (ensurePaySchema/ensurePoolSchema через IF NOT EXISTS). Это норма, не авария.

ЖЁСТКИЕ ПРАВИЛА (нарушение = остановка):
1. Не включать PAYOUTS_ENABLED, SWEEP_ENABLED, POOL_ENABLED без моего
   письменного «да». Выплаты и пул — не техническая кнопка.
2. Никаких трат: домен не покупать, платные тарифы не подключать. Денег нет.
   Работаем на бесплатном *.workers.dev.
3. Секреты не печатать в чат, не коммитить, не класть в скриншоты. Если команда
   печатает секрет — остановись и переделай через файл/пайп.
4. SIGNER_SEED генерируется один раз и навсегда: из него выводятся адреса
   игроков. Менять нельзя никогда.
5. Не удалять и не «пересоздавать» таблицы D1. Миграции только вперёд.
6. После каждого шага — проверка из документа. Не сошлось → стоп, отчёт мне,
   не «чинить наугад».
7. Не менять 0001–0005 и не вставлять строки в d1_migrations руками.

ШАГ 0. Окружение (5 минут)
  git clone https://github.com/alibahsburiev20-cyber/Crypto-Astra && cd Crypto-Astra
  git checkout main && git pull
  npm ci
  export CLOUDFLARE_API_TOKEN=...   # токен с правами Workers Scripts:Edit,
                                    # D1:Edit, Observability:Read, Account Settings:Read
  export CLOUDFLARE_ACCOUNT_ID=...
  npx wrangler whoami
Если wrangler не залогинен (нет CLOUDFLARE_API_TOKEN, `wrangler login` не
проходит из-за localhost-колбэка) — это ожидаемо, не тупик. Работай по пути B
из docs/CLOUDFLARE-AGENT-TASK.md, раздел «1a. Если нет wrangler»: API даёт те же
операции (деплой воркера, секреты, запросы к D1). Запрещено не API, а обход
процедуры: руками пересоздавать таблицы и писать в d1_migrations что-то кроме
точных имён существующих файлов. Если доступен только дашборд без git — скажи,
владелец поднимет Signer из дашборда (путь A), а ты продолжишь с шага 4.

ШАГ 1. Миграции D1
  npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table'"
  npx wrangler d1 execute DB --remote --command "SELECT name FROM d1_migrations ORDER BY name"
  npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS rows FROM pay_ledger"
  npx wrangler d1 migrations apply DB --remote
  npx wrangler d1 migrations apply DB --remote --preview
Проверка: число таблиц НЕ изменилось (в проде обычно 24 — счёт включает служебные
d1_migrations, _cf_KV, sqlite_sequence; сверяй с числом «до», а не с 22),
в журнале 0001–0007, pay_ledger не потерял строки.
Если wrangler нет — отметь «T1 отложен» и иди дальше, это не блокирует запуск.

ШАГ 2. Секреты основного Worker (только проверка и добор недостающего)
  npx wrangler secret list
Сверь: есть JWT_SECRET, ADMIN_TOKEN (≥32 символа), ADMIN_EMAIL
(alibahsburiev20@gmail.com), TURNSTILE_SECRET (site key 0x4AAAAAAGGq5Lt25F34cDiq).
Если TURNSTILE_SECRET отсутствует — попроси значение у меня, не выдумывай.
Опционально и желательно: TRONGRID_API_KEY (бесплатный тариф) — без него
индексатор депозитов упирается в лимиты по IP.
Проверка: GET /health → 200; GET /me без токена → 401; GET /admin/pool без
токена → 401.

ШАГ 3. Signer — единственное, что мешает приёму денег
  3.1 Сгенерируй секреты, но НЕ печатай их:
      openssl rand -hex 32 > /tmp/seed.txt    # SIGNER_SEED
      openssl rand -hex 32 > /tmp/token.txt   # SIGNER_TOKEN
  3.2 СТОП И ВОПРОС КО МНЕ: прежде чем заливать SIGNER_SEED, я должен записать
      его на бумагу двумя копиями. Покажи мне значение один раз в защищённом
      виде так, как я скажу (или дай мне выполнить `cat /tmp/seed.txt` сам),
      дождись моего «семя записано» и только потом продолжай. Если я не
      подтвердил — не деплой.
  3.3 Приватный ключ горячего кошелька (SIGNER_PRIVATE_KEY, 64 hex) я создаю
      сам офлайн; ты его не генерируешь и не просишь прислать в чат. Нужен
      только публичный адрес: я запущу
        SIGNER_PRIVATE_KEY=<hex> npm run pay:hot-address
      и пришлю тебе адрес T.... Проверь его формат и сохрани как PAY_HOT_ADDRESS.
  3.4 Деплой и секреты Signer:
        cd signer
        npx wrangler secret put SIGNER_SEED        # значение из /tmp/seed.txt
        npx wrangler secret put SIGNER_TOKEN       # значение из /tmp/token.txt
        npx wrangler secret put SIGNER_PRIVATE_KEY # значение даю я, через пайп
        npx wrangler deploy
        cd ..
      workers_dev=false: публичного адреса у Signer быть не должно.
  3.5 Связка: в корневом wrangler.toml раскомментируй
        [[services]]
        binding = "SIGNER"
        service = "astra-pay-signer"
      затем в основной Worker: SIGNER_TOKEN (тот же) и PAY_HOT_ADDRESS:
        npx wrangler secret put SIGNER_TOKEN
        npx wrangler secret put PAY_HOT_ADDRESS
        npm run config:sync && npx wrangler deploy

ШАГ 4. Проверка оплачиваемости (без денег)
  curl -s $BASE/pay/status.json        # wallets:"ready", payments:true, payouts:false
  # получить JWT игрока: POST /auth/register или /auth/login, взять access_token
  curl -s -H "Authorization: Bearer $TOKEN" $BASE/pay/address.json
  curl -s -H "Authorization: Bearer $TOKEN" $BASE/pay/address.json   # тот же адрес!
Ожидаемо: адрес T…, network mainnet, asset USDT, contract
TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t; повторный вызов — тот же адрес и index;
без токена 401; https://astra-pay-signer.<sub>.workers.dev не открывается.
Плюс админка: без токена 401, с неверным 403, с верным 200.
Если wallets всё ещё "signer_required" — binding не подхватился, разбирайся, не
объявляй успех.

ШАГ 5. Тестовая покупка 1 USDT — ТОЛЬКО С МОИМ ПИСЬМЕННЫМ «ДА»
(если денег нет — сделай вместо этого T6a из документа: среда staging на
тестнете nile, тестовые USDT бесплатные; прод не трогай)
  5.1 Подготовь: возьми мой адрес из /pay/address.json, сумму 1 USDT.
  5.2 Спроси меня и дождись «да» (это мои реальные деньги).
  5.3 После моего перевода проверь: GET /admin/pay (депозит виден, статус
      credited, ровно одна строка на txid), баланс в /pay/balance.json вырос на
      1000000 микро-USDT, reconcile.issues пуст, покупка проходит один раз и
      повторная попытка не списывает второй раз.
  5.4 Если депозит не появился — не «зачисляй вручную»: смотри explorer,
      проверь contractRet и адрес, напиши мне.

ШАГ 6. Сбор денег в мой кошелёк (sweep) — НЕ ВКЛЮЧАТЬ БЕЗ «ДА»
Подготовь всё, что нужно: PAY_HOT_ADDRESS задан, лимиты понятны, проверка на
тестовом адресе описана. Включение SWEEP_ENABLED — только по моему письменному
согласию, отдельным сообщением. Пока согласия нет — просто оставь как есть и
напиши в отчёте «готово к включению, ждёт решения».

ШАГ 7. Turnstile
Проверь, что /config отдаёт turnstile_site_key, и что после 3 неудачных входов
сервер требует токен. Если ключа нет — попроси у меня, не выдумывай.

ШАГ 8. Юридические страницы — не твоя зона
Правовой страницы в проекте нет: владелец решил её не публиковать. Не создавай
её, не придумывай реквизиты, адреса и сроки. В отчёте просто отметь: «правовой
страницы нет — решение владельца».

ШАГ 9. Мониторинг, бэкап, нагрузка
  9.1 Мониторы: https://uptimerobot.com (или BetterStack) → 2 HTTP-монитора:
      $BASE/health (keyword "ok":true, интервал 1 мин) и $BASE/pay/status.json
      (keyword "schema":"ready"). Алерты на мою почту + Telegram-бот.
  9.2 Проверь, что алерт реально приходит: временно поставь неверный путь,
      дождись письма, верни путь. Прод не ломай.
  9.3 Cloudflare → Notifications: ошибки Worker и лимиты — включить.
  9.4 GitHub Actions → workflow "health" — зелёный, ходит на SITE_URL
      (если нужен, поставь переменную репозитория SITE_URL=$BASE).
  9.5 Бэкап:
        npx wrangler d1 export DB --remote --output astra-$(date +%F).sql
        sha256sum astra-$(date +%F).sql > astra-$(date +%F).sql.sha256
        DUMP=astra-$(date +%F).sql bash scripts/restore-drill.sh
      Успех: integrity: ok, mismatches: [], restoreMs < 60000. Дампы — вне
      репозитория (R2 или локально), минимум 7 последних дней. В git не класть.
  9.6 Прод-нагрузка (только чтение):
        npm run pay:loadtest -- --base $BASE --requests 500 --concurrency 25
      Порог: ошибок ≤1 %, p95 ≤500 мс. Цифры внеси в docs/MONITORING.md с
      пометкой «прод, дата». Превысил — не «крути дальше», напиши мне.

ШАГ 10. Сверка журнала (T10 — не за один сеанс)
Сделай день 1 и подготовь рутину на 7 дней:
  npm run health -- --base $BASE
  curl -s $BASE/admin/pay -H "X-Admin-Token: $ADMIN_TOKEN"   # reconcile.issues == []
Напиши мне короткий чек-лист «5 минут в день» и что делать, если issues не пуст
(стоп-флаг POST /admin/pay/stop {stop:true, reason}).

ЧЕГО НЕ ДЕЛАТЬ НИКОГДА:
- не включать PAYOUTS_ENABLED, SWEEP_ENABLED, POOL_ENABLED без «да»;
- не обещать в интерфейсе доходность, «пул», «все разбогатеют» — этого в
  продукте нет и не будет; не добавлять таких текстов;
- не менять SIGNER_SEED, не пересоздавать таблицы;
- не покупать домен, не включать платные тарифы;
- не печатать секреты и не пересылать их в чат;
- не выдавать «сделано», пока проверка не сошлась.

ОТЧЁТ (ровно это, без секретов):
1. Адрес: $BASE, HTTPS ok, /health build <...>
2. D1: миграции <...>, schema ready, tables 14
3. Signer: задеплоен, wallets ready, адрес игрока выдан и повторяется
4. PAY_HOT_ADDRESS совпадает с ключом (pay:hot-address --check): да/нет
5. Админка: 401 без токена, 403 с неверным, 429 после 10 ошибок, 200 с верным
6. Тестовая покупка 1 USDT: депозит credited один раз, покупка одна, reconcile ok
7. Нагрузка прод: rps <...>, p95 <...> мс, ошибок <...>%
8. Мониторинг: 2 монитора, алерт проверен письмом
9. Бэкап: дамп <дата>, sha256 <...>, restore drill ok за <...> мс
10. Флаги: payouts=false, sweep=false, pool=false (не менялись)
11. Что осталось и где нужен я: <...>
~~~~
