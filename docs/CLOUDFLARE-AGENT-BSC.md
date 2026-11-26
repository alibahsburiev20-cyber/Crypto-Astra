# Промпт: проверить тестнет EVM-рельса (BNB Chain + Polygon) и закрыть шаг 8

Самодостаточный текст: вставляется агенту целиком, ничего дописывать не нужно.
Жёсткие правила (1–7) — те же, что в `docs/CLOUDFLARE-AGENT-PROMPT.md`; они
обязательны, даже если ниже не повторены.

Сетей две — **BNB Chain testnet (97)** и **Polygon Amoy (80002)** — и прогон
обязан пройти ОБЕ. «Зелёный BNB» про Polygon не говорит ничего: там другой
контракт, другая шкала знаков (6 против 18), другой `chainId` и другое число
подтверждений, и всё это — конфигурация, а не код.

---

~~~~text
Ты — инженер с доступом к моему аккаунту Cloudflare и к машине, где есть git,
node 20+, npm и произвольный исходящий HTTPS. Задача: проверить EVM-рельс USDT (USDT
на вход и USDT на выход, без обмена на нативку) на тестнете от начала до конца —
в BNB Chain (97) и в Polygon Amoy (80002) — и принести мне доказательства, а не
слова. Это последнее, что стоит между «код готов» и
«можно включать сеть игрокам».

РЕПОЗИТОРИЙ: github.com/alibahsburiev20-cyber/Crypto-Astra
ВЕТКА: arena/aa380538-crypto-astra (не main — правки в git сегодня не нужны)
ПРОД (только чтение): https://crypto-astra.cryptoastra.workers.dev
D1: astra-global (прод), astra-preview (превью). Сеть прода сейчас TRON
(mainnet, USDT TRC-20). EVM-рельс (BNB + Polygon) в коде есть, в прод-
конфигурацию НЕ включён.

ЧТО УЖЕ СДЕЛАНО (не повторяй):
- Код BSC-рельса написан и покрыт юнит-тестами (118 кейсов на подставной ноде).
- Сквозной прогон существует: scripts/pay-bsc-rehearsal.ts, npm-скрипт
  `pay:rehearse`. Правила вердиктов — scripts/lib/rehearse.ts, покрыты тестом.
- Локальный прогон (без сети) зелёный для ОБОИХ сетей: 39 шагов OK, 3 помечены
  «не тронули». Твоя задача — именно прогон ПРОТИВ ЖИВОЙ НОДЫ тестнета.
- Документ с расшифровкой каждого шага: docs/BSC-TESTNET-RUNBOOK.md. Прочитай
  его до начала, там таблица «что значит красный шаг».

ЧЕГО ТЫ НЕ ДЕЛАЕШЬ НИ ПРИ КАКИХ УСЛОВИЯХ:
1. Не включаешь PAYOUTS_ENABLED, SWEEP_ENABLED, POOL_ENABLED. Не трогаешь
   PAY_CHAIN, PAY_EVM_CHAINS, PAY_NETWORK, PAY_USDT_CONTRACT, PAY_HOT_ADDRESS,
   PAY_EVM_CONTRACT, PAY_EVM_CONTRACT_BNB, PAY_EVM_CONTRACT_POL на проде.
   Прод — только GET-запросы и SELECT.
2. Не генерируешь, не просишь и не записываешь SIGNER_PRIVATE_KEY (ни в Signer,
   ни в переменные). Не печатаешь в чат, в лог, в файл отчёта НИ ОДНОГО
   приватного ключа и ни одного seed. Если тестовый ключ попал в команду —
   удали команду из истории и напиши мне, что так вышло.
3. SIGNER_SEED не перегенерируется никогда: из него адреса игроков.
4. Не пересоздаёшь таблицы D1, не пишешь в d1_migrations, не «зачисляешь
   депозит руками», не правь `pay_ledger` и `pay_audit_log` (они append-only —
   это не украшение, а проверка).
5. Никаких трат: домены, платные тарифы, платные RPC-провайдеры с ключом — нет.
   Публичный RPC тестнета бесплатный, его и используй.
6. Не деплоишь прод и не трогаешь превью: прогон живёт в твоём терминале,
   на своей SQLite-базе. Ему не нужен ни воркер, ни D1.
7. Если проверка шага не сошлась — стоп, отчёт мне с выводом команд. Не «чинить
   наугад» и не объявлять успех «в целом».

Я ПОДГОТОВИЛ (значения пришлю тебе отдельным сообщением, в git их нет):
  TESTNET_TOKEN=0x…          # адрес USDT-токена (18 знаков), который я задеплоил в BSC testnet
  TESTNET_TOKEN_POL=0x…      # то же в Polygon Amoy, но токен с decimals() = 6
  TESTNET_RPC_POL=https://rpc-amoy.polygon.technology
  TESTNET_HOT=0x…            # адрес моего тестового кошелька (на нём тестовый BNB и tPOL)
  TESTNET_HOT_KEY_FILE=…     # путь к файлу с приватным ключом ТЕСТОВОГО кошелька,
                             # если я попрошу настоящую отправку; читать только через stdin/env
  PLAYER_USDT_SENT=yes|no    # отправил ли я себе 5 токенов на адрес, который ты мне назовёшь
Если TESTNET_TOKEN пустой и я отказываюсь его давать — блокируй работу и напиши
мне «нужен контракт в сети, без него проверять нечего». Прогон против чужого
или несуществующего токена — не проверка, а имитация.

ШАГ 1. Окружение и базовая зелёность (10 минут)
  git clone https://github.com/alibahsburiev20-cyber/Crypto-Astra && cd Crypto-Astra
  git checkout arena/aa380538-crypto-astra && npm ci
  npm run check
  npm run pay:rehearse -- --loopback ; echo "exit=$?"
Ожидаю: `npm run check` — все тесты зелёные (сейчас 95 файлов / 1132 кейса);
loopback-прогон — 39 строк OK и 3 «ПРОПУСК», код выхода 2, в ОБОИХ запусках:
  npm run pay:rehearse -- --loopback
  npm run pay:rehearse -- --loopback --chain polygon
Код 2 означает «сошлось, но часть шагов не тронута» — это правильный ответ для
прогона без сети, не ошибка. Любое другое число или код = блокировка, пиши мне
с выводом.

ШАГ 2. Нода и контракт: существует ли то, с чем мы собираемся работать
  RPC=https://bsc-testnet-rpc.publicnode.com
  curl -s -m 12 -X POST $RPC -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'      # 0x61 = 97
  curl -s -m 12 -X POST $RPC -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}'
  # код контракта (0x — значит в сети его нет):
  curl -s -m 12 -X POST $RPC -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":3,"method":"eth_getCode","params":["'$TESTNET_TOKEN'","latest"]}'
  # decimals() = 0x12 (18):
  curl -s -m 12 -X POST $RPC -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":4,"method":"eth_call","params":[{"to":"'$TESTNET_TOKEN'","data":"0x95d89b41"},"latest"]}'
  # баланс тестового кошелька (газ для отправки):
  curl -s -m 12 -X POST $RPC -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":5,"method":"eth_getBalance","params":["'$TESTNET_HOT'","latest"]}'
Ожидаю: chainId 97; head растёт между двумя запросами подряд; код контракта
не 0x; decimals 18; BNB на кошельке > 0 (иначе настоящую отправку не делаем,
и это не провал, а строка «нет газа» в отчёте).

ШАГ 3. Только чтение, против сети: скан, зачисление, идемпотентность
  PAY_CHAIN=bsc PAY_NETWORK=testnet PAY_EVM_RPC=$RPC \
  PAY_EVM_CONTRACT=$TESTNET_TOKEN PAY_EVM_CONFIRMATIONS=3 \
  PAY_HOT_ADDRESS=$TESTNET_HOT \
  npx tsx scripts/pay-bsc-rehearsal.ts --blocks 3000 --amount-micro 5000000
  echo "exit=$?"
Скрипт сам напечатает адрес игрока (выведен из тестового семени, путь BIP-44
m/44'/60'/0'/0/1) — пришли его мне ОДНОЙ СТРОКОЙ и остановись на этом шаге,
если я ещё не отправил токены. Как только PLAYER_USDT_SENT=yes — повторяй ту же
команду с `--wait 900 --interval 20`: она ходит на ноду, ждёт перевод и
зачисляет его.
Ожидаю строки OK: «нода», «контракт USDT», «депозит → зачисление» (зачислено
ровно 5.0 USDT), «чужие переводы» (сирот 0), «идемпотентность зачисления»
(второй проход 0). Курсор блока обязан сдвинуться: сверь
  sqlite: SELECT height FROM pay_chain_cursor
в выводе прогона (строка «курсор») — он в начале и после.
Если написано «переводов на адрес нет» — это НЕ провал кода: это значит, что я
ещё не отправил. Так и напиши, не подделывай.

ШАГ 4. Настоящая отправка в сеть (нужен тестовый BNB; ключ — только из файла,
только тестнет)
  PAY_CHAIN=bsc PAY_NETWORK=testnet PAY_EVM_RPC=$RPC \
  PAY_EVM_CONTRACT=$TESTNET_TOKEN PAY_EVM_CONFIRMATIONS=3 \
  PAY_HOT_ADDRESS=$TESTNET_HOT \
  SIGNER_PRIVATE_KEY="$(cat $TESTNET_HOT_KEY_FILE)" \
  npx tsx scripts/pay-bsc-rehearsal.ts --blocks 3000 --send --wait 900 --interval 20
Эти деньги — тестовые фантики в сети 97; расход — только газ, доли цента.
Ожидаю OK на: «газ», «заявка на выплату» (id вида wd_…, одна строка на ключ),
«резерв» (баланс уменьшен записью reason=payout), «транзакция выплаты · to /
value / получатель / сумма / chainId / nonce», «замок nonce», «отправка в сеть»
(txid = keccak256 нашего тела), «квитанция» (status=1, глубина ≥ 3),
«подтверждение заявки» (status confirmed), «учёт · баланс», «учёт · реестр»,
«план сбора».
Сверь txid со мной и с тестнет-эксплорером (testnet.bscscan.com): транзакция
должна быть видна там же, с тем же хешем, к тому же контракту и тому же
получателю. Это единственный способ убедиться, что «OK» значит «в сети», а не
«в моём терминале».

ШАГ 5. Отрицательные проверки: конфигурацию ломает так, как мы думаем
Каждую — отдельным запуском того же скрипта с одним изменением. Ожидаю, что
прогон сам это поймает (это и есть проверка прогона как инструмента):
  a) PAY_EVM_CONTRACT=""            → ПРОВАЛ «контракт», дальше не идёт
  b) PAY_HOT_ADDRESS=TAzT9Qz1zaK5bJiLTNA8yPq1i7VJkXjnPB (TRON-форма)
                                    → ПРОВАЛ «кошелёк»: в BSC это не наш адрес
  c) PAY_EVM_RPC=https://bsc-mainnet-rpc.example.invalid
                                    → строка «нода недоступна», шаги сети —
                                      ПРОПУСК (не OK!), код выхода 2
  d) PAY_EVM_CONFIRMATIONS=0        → ПРОВАЛ «подтверждения»
  e) PAY_CHAIN=eth                  → ПРОВАЛ «сеть» (незнакомая цепь выключает
                                      деньги, а не «берёт первую попавшуюся»)

ШАГ 6. Прод: не трогая, убедиться, что переключение вообще безопасно
  curl -s https://crypto-astra.cryptoastra.workers.dev/health
  curl -s https://crypto-astra.cryptoastra.workers.dev/pay/status.json
  npx wrangler d1 execute DB --remote --command \
    "SELECT COUNT(*) AS n, SUM(address LIKE '0x%') AS evm, SUM(active) AS act FROM pay_addresses"
  npx wrangler d1 execute DB --remote --command \
    "SELECT chain, active, COUNT(*) AS n FROM pay_addresses GROUP BY chain"
  npx wrangler d1 execute DB --remote --command \
    "SELECT COUNT(*) AS n FROM pay_ledger"
Ожидаю и прикладываю вывод: сети в status.json (сейчас tron/nile-не-прод, сверь
факт), wallets:"ready", schema:"ready", payouts:false, sweep:false; адреса
игроков есть только в TRON-формате (колонка chain=tron) — переключение сети не
оставляет «сирот на BSC, о которых мы не знали». pay_ledger 0 строк — норма
(реальных депозитов ещё не было), но напиши число явно.
Плюс одна строка из логов за последний час (Cloudflare → Workers → Logs или
`wrangler tail --format pretty`, 60 секунд, не дольше): работает ли cron
индексатора и нет ли ошибок `pay`. Если в логах видно `pay payouts confirm` или
`orphan deposit` при выключенных флагах — это находка, напиши её полностью.

ШАГ 5b. Polygon Amoy: ШАГИ 2–5 ещё раз, с суффиксом _POL
  RPC_POL=$TESTNET_RPC_POL
  curl -s -m 12 -X POST $RPC_POL -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'        # 0x13882 = 80002
  curl -s -m 12 -X POST $RPC_POL -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":3,"method":"eth_getCode","params":["'$TESTNET_TOKEN_POL'",'latest"]}'
  curl -s -m 12 -X POST $RPC_POL -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":4,"method":"eth_call","params":[{"to":"'$TESTNET_TOKEN_POL'","data":"0x95d89b41"},"latest"]}'
Ожидания отличаются от BNB в трёх числах, и это ровно то, что мы проверяем:
`chainId` = 80002, `decimals()` = 0x06 (шесть, не восемнадцать), газ — POL
(tPOL с faucet), подтверждений 12. Прогон зовётся так (имена переменные — свои):
  PAY_CHAIN=polygon PAY_NETWORK=testnet PAY_EVM_CHAINS=polygon \
  PAY_EVM_RPC_POL=$RPC_POL PAY_EVM_CONTRACT_POL=$TESTNET_TOKEN_POL \
  PAY_EVM_CONFIRMATIONS_POL=12 PAY_HOT_ADDRESS=$TESTNET_HOT \
  npx tsx scripts/pay-bsc-rehearsal.ts --blocks 3000 --amount-micro 5000000
  # и с --send --hot-key <файл> — как в ШАГЕ 4
Отрицательные проверки a–e из ШАГА 5 повторяются для Polygon в тех же именах
(`PAY_EVM_CONTRACT_POL=""` → ПРОВАЛ «контракт»). Плюс одна своя:
  f) PAY_CHAIN=polygon без PAY_EVM_CHAINS → ПРОВАЛ «список сетей»: адреса
     выдаём в Polygon, а сканер по умолчанию смотрит BNB — прогон обязан это
     поймать, а не «зелёный».
Если мой токен в Amoy оказался 18-значным — СТОП и напиши мне: прогон с ним
проверяет не ту шкалу, что в бою, и «OK» на такой конфигурации хуже красного.

ШАГ 7. Отчёт (формат обязателен, он влезает в одно сообщение)
  1. npm run check: <число файлов>/<число кейсов>, green|red
  2. loopback: <число OK>, exit=<код> — ОТДЕЛЬНО для bnb и для polygon
  3. нода: chainId=<..>, head=<..>, decimals=<..>, BNB/POL на кошельке=<..>
     — по каждой сети
  4. адрес игрока для пополнения: 0x…
  5. скан+зачисление: OK|ПРОПУСК|ПРОВАЛ — <одна строяя причина>
  6. подпись и отправка: OK|ПРОПУСК|ПРОВАЛ — <txid, если был>
  7. квитанция и confirmed: OK|ПРОПУСК|ПРОВАЛ — <глубина, статус>
  8. учёт (баланс + цепочка хешей): OK|ПРОВАЛ
  9. отрицательные проверки a–e: <число>/<число> поймано
  10. прод-диагностика: <4–6 строк фактов>
  11. что осталось непроверенным: <список; пустой список должен быть невозможным —
      если ты пишешь «ничего», перепроверь: непроверенное всегда есть>
В конце одной строкой: «флаги не менял, ключи не трогал, прод не деплоил» — и
это должна быть правда.
~~~~

## Что остаётся мне, после его отчёта

| Что | Кто |
|---|---|
| Починить всё, что прогон показал красным | я (код, тесты, пуш) |
| Исполнение сбора USDT с адресов игроков + недельный цикл (`closeCycle`, строки `confirmed_in`, «приз → мне → остаток в пул») — сейчас в рантайме этого нет ни в TRON, ни в BSC | я, по твоему «делай» |
| Схема «общий адрес + тег суммой» вместо адреса на игрока (снимает ~90 % газа на выплатах) | я, по твоему «делай» |
| Включение `PAY_CHAIN`/`PAY_EVM_CHAINS` и USDT-контрактов на проде (по одному на сеть: `PAY_EVM_CONTRACT_BNB`, `PAY_EVM_CONTRACT_POL`), `PAYOUTS_ENABLED`/`SWEEP_ENABLED`, `SIGNER_PRIVATE_KEY` в Signer | только ты, письменно |
| Удаление TRON | я, после зелёного тестнета и нуля на TRON-адресах |
