#!/usr/bin/env bash
# Проверка админки на живом воркере: роли, ссылка-ключ, потолок, игроки, журнал.
#
# Юнит-тесты не покрывают двух вещей, а ломаются первыми именно они: реальный D1
# с миграцией `0011_admin_accounts.sql` (схема `admin_accounts`, CHECK-границы) и
# реальный вызов в Durable Object (`adminPlayer`, `clearIdentity`). Здесь и то, и
# другое — через HTTP, ровно как это делает оператор в браузере.
#
# Запуск: `npm run dev` в одном терминале, `npm run check:admin` — в другом.
# BASE по умолчанию http://127.0.0.1:8787; ADMIN_TOKEN берётся из окружения или из
# `.dev.vars`. Нужен `jq`.
#
# Деньги этот скрипт не трогает: выплаты в локальном контуре выключены флагом, а
# «удаление игрока» проверяется на аккаунте, который скрипт сам и создал.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
TOKEN="${ADMIN_TOKEN:-$(sed -n 's/^ADMIN_TOKEN=//p' .dev.vars 2>/dev/null | tr -d '"')}"
EMAIL="admin-loopback-$(date +%s)@example.com"
PASSWORD="password123"

pass=0
fail=0
skip=0

# Каждый шаг — одна строка вывода: что проверяли, ждали, получили.
check() { # check <название> <ожидаемое> <полученное>
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); printf '  ok   %s\n' "$1"
  else
    fail=$((fail + 1)); printf '  FAIL %s: ждали «%s», получили «%s»\n' "$1" "$2" "$3"
  fi
}
skip_note() { skip=$((skip + 1)); printf '  —    %s: %s\n' "$1" "$2"; }

BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT
# code <ожидание?> — статус последнего запроса; тело остаётся в $BODY для jq.
code() { curl -s -o "$BODY" -w '%{http_code}' "$@"; }
get() { jq -r "$1 // \"\"" <"$BODY" 2>/dev/null; }

if [ -z "$TOKEN" ]; then
  echo "ADMIN_TOKEN не найден (ни в окружении, ни в .dev.vars) — админку проверить нельзя."
  exit 2
fi
command -v jq >/dev/null || { echo "нужен jq"; exit 2; }

echo "0) Воркер отвечает"
if [ "$(code "$BASE/health")" != "200" ]; then
  echo "  $BASE/health не отвечает — запустите \`npm run dev\` (и примените миграции: npx wrangler d1 migrations apply DB --local)."
  exit 2
fi

echo "1) Вход без документов"
check "GET /admin/session без токена → 401" 401 "$(code "$BASE/admin/session")"
check "код отказа" admin_token_required "$(get .error)"

echo "2) Тестовый игрок"
code -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
access=$(get .access_token); player=$(get .user.id)
if [ -z "$access" ]; then
  code -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
  access=$(get .access_token); player=$(get .user.id)
fi
check "аккаунт заведён" yes "$([ -n "$access" ] && echo yes || echo no)"
echo "     player=${player:-<нет>}"

echo "3) Владелец: роль и отсутствие потолка"
check "GET /admin/session с токеном" 200 "$(code -H "X-Admin-Token: $TOKEN" "$BASE/admin/session")"
check "роль" owner "$(get .role)"
# `//` в jq превращает null в пустую строку: для владельца потолка нет именно так.
check "потолка нет" "" "$(get .grantLimit)"

echo "4) Приглашение младшего админа"
check "POST /admin/accounts/invite → 201" 201 "$(code -X POST -H "X-Admin-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"label":"Проверка скриптом","days":1,"grantLimit":50}' "$BASE/admin/accounts/invite")"
key=$(get .key); link=$(get .link); inv_id=$(get .id)
check "ключ выдан" yes "$([ -n "$key" ] && echo yes || echo no)"
check "ключ с префиксом доступа" astra-admin_ "$(printf '%s' "$key" | cut -c1-12)"
check "ссылка ведёт во фрагмент, а не в ?k=" yes "$(case "$link" in *'#k='*"$key"*) case "$link" in *'?k='*) echo no ;; *) echo yes ;; esac ;; *) echo no ;; esac)"
check "потолок принят" 50 "$(get .grantLimit)"
check "срок — 1 день" yes "$(python3 -c "
import json,sys,datetime
d=json.load(open(sys.argv[1]))
now=datetime.datetime.now(datetime.timezone.utc).timestamp()*1000
print('yes' if 0 < d.get('expiresAt',0)-now <= 86_400_000 else 'no')" "$BODY" 2>/dev/null)"

echo "5) Ключ не хранится открытым текстом"
check "списка с ключом нет" 200 "$(code -H "X-Admin-Token: $TOKEN" "$BASE/admin/accounts")"
listed=$(jq -r '.accounts[0] | "\(.label)|\(.status)|\(.grantLimit)"' <"$BODY")
check "доступ виден: метка, статус, потолок" "Проверка скриптом|active|50" "$listed"
check "открытого ключа в списке нет" false "$(jq -r --arg k "$key" 'tostring | contains($k)' <"$BODY")"
check "хеши ключей тоже не отдают" false "$(jq -r 'tostring | test("[0-9a-f]{64}")' <"$BODY")"
check "срок виден" 1 "$(jq -r --arg i "$inv_id" '[.accounts[] | select(.id==$i and .expiresAt != null)] | length' <"$BODY")"

echo "6) Помощник входит по ключу"
check "GET /admin/session с ключом" 200 "$(code -H "X-Admin-Key: $key" "$BASE/admin/session")"
check "роль" junior "$(get .role)"
check "метка" "Проверка скриптом" "$(get .label)"
check "потолок виден клиенту" 50 "$(get .grantLimit)"
check "состояние мира — можно" 200 "$(code -H "X-Admin-Key: $key" "$BASE/admin/world?world=w1")"

echo "7) Чего помощнику нельзя"
check "список доступов" 403 "$(code -H "X-Admin-Key: $key" "$BASE/admin/accounts")"
check "код" owner_only "$(get .error)"
check "выдать себе доступ" 403 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' -d '{"label":"сам себе"}' "$BASE/admin/accounts/invite")"
check "отозвать доступ" 403 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' -d "{\"id\":\"$inv_id\"}" "$BASE/admin/accounts/revoke")"
check "стоп выплат" 403 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' -d '{"stop":true,"reason":"проверка"}' "$BASE/admin/pay/stop")"
check "журнал действий" 403 "$(code -H "X-Admin-Key: $key" "$BASE/admin/audit")"
check "заблокировать игрока" 403 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' -d "{\"player\":\"$player\",\"action\":\"block\",\"reason\":\"проверка\"}" "$BASE/admin/player/block")"
check "удалить игрока" 403 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' -d "{\"player\":\"$player\",\"reason\":\"проверка\",\"confirm\":\"DELETE\"}" "$BASE/admin/player/close")"
check "заморозить мир" 403 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' -d '{"frozen":true}' "$BASE/admin/world/freeze?world=w1")"

echo "8) Потолок одной выдачи"
if [ -z "$player" ]; then
  skip_note "выдача" "игрок не заведён"
else
  check "51 при потолке 50 → 409" 409 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"astra\":51,\"reason\":\"проверка потолка\"}" "$BASE/admin/world/grant?world=w1")"
  check "код" grant_limit "$(get .error)"
  check "минус 51 — тоже за потолком" 409 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"astra\":-51,\"reason\":\"проверка потолка\"}" "$BASE/admin/world/grant?world=w1")"
  # До начала выдач — иначе «после» сравнится само с собой.
  before=$(code -H "X-Admin-Key: $key" "$BASE/admin/player?player=$player" >/dev/null; get .world.astra)
  check "50 проходит" 200 "$(code -X POST -H "X-Admin-Key: $key" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"astra\":50,\"reason\":\"проверка потолка\"}" "$BASE/admin/world/grant?world=w1")"
  check "начислено" 50 "$(get .granted)"
  check "выдача легла на баланс мира" yes "$(python3 -c "
import sys
a, b = sys.argv[1:3]
print('yes' if int(b) == int(a) + 50 else 'no')" "$before" "$(code -H "X-Admin-Key: $key" "$BASE/admin/player?player=$player" >/dev/null; get .world.astra)")"

fi

echo "9) Карточка игрока"
if [ -z "$player" ]; then
  skip_note "карточка" "игрок не заведён"
else
  check "GET /admin/player" 200 "$(code -H "X-Admin-Key: $key" "$BASE/admin/player?player=$EMAIL")"
  check "нашли по email" "$player" "$(get .player.id)"
  check "баланс денег прочитан (0)" 0 "$(get .player.payBalanceMicro)"
  check "заявок в работе" 0 "$(get .player.openWithdrawals)"
  check "живых сессий" 1 "$(get .player.sessions)"
  check "мир ответил (DO reachable)" "$player" "$(get .world.id)"
  check "позывной пришёл из мира" yes "$(jq -r 'if (.world.label // "") | length > 1 then "yes" else "no" end' <"$BODY")"
  check "хеш пароля не утекает" false "$(jq -r 'tostring | contains("password_hash")' <"$BODY")"
fi

echo "10) Блокировка входа"
if [ -z "$player" ]; then
  skip_note "блокировка" "игрок не заведён"
else
  check "block" 200 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"action\":\"block\",\"reason\":\"проверка скриптом\"}" "$BASE/admin/player/block")"
  check "сессии отозваны" 1 "$(get .sessions)"
  check "статус" blocked "$(code -H "X-Admin-Token: $TOKEN" "$BASE/admin/player?player=$player" >/dev/null; get .player.status)"
  check "повторный block — не ошибка" 200 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"action\":\"block\",\"reason\":\"ещё раз\"}" "$BASE/admin/player/block")"
  check "alreadyBlocked" true "$(get .alreadyBlocked)"
  check "unblock" 200 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"action\":\"unblock\",\"reason\":\"проверка снята\"}" "$BASE/admin/player/block")"
  check "без причины — 400" 400 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"action\":\"block\"}" "$BASE/admin/player/block")"
  check "код" reason_required "$(get .error)"
fi

echo "11) Удаление аккаунта"
if [ -z "$player" ]; then
  skip_note "закрытие" "игрок не заведён"
else
  check "без DELETE — 400" 400 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"reason\":\"проверка\"}" "$BASE/admin/player/close")"
  check "код" confirm_required "$(get .error)"
  check "закрытие при нулевом балансе" 200 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"reason\":\"проверка скриптом\",\"confirm\":\"DELETE\"}" "$BASE/admin/player/close")"
  check "остаток денег в ответе" 0 "$(get .balanceMicro)"
  check "позывной освобождён в мире" true "$(get .identityReleased)"
  check "повторное закрытие → 409" 409 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"player\":\"$player\",\"reason\":\"ещё раз\",\"confirm\":\"DELETE\"}" "$BASE/admin/player/close")"
  check "код" player_already_closed "$(get .error)"
  # Отказ может быть и 429: на `auth/login` работают счётчики подбора, а мы только
  # что несколько раз входили с этим адресом. Значит проверяем «не 200», а не код.
  login_code=$(code -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/auth/login")
  check "вход по старому паролю невозможен" yes "$([ "$login_code" != 200 ] && echo yes || echo no)"
fi

echo "12) Журнал и отзыв доступа"
check "GET /admin/audit владельцу" 200 "$(code -H "X-Admin-Token: $TOKEN" "$BASE/admin/audit?limit=40")"
check "записи есть" yes "$(jq -r 'if (.entries|length) > 0 then "yes" else "no" end' <"$BODY")"
check "видно закрытие аккаунта" yes "$(jq -r 'if any(.entries[]; .action == "player_close") then "yes" else "no" end' <"$BODY")"
check "видно создание доступа" yes "$(jq -r 'if any(.entries[]; .action == "invite_create") then "yes" else "no" end' <"$BODY")"
# Выдача помощника обязана быть видна как `junior`: «кто выдал» отличается от
# «выдал owner», и это единственное, что остаётся после спора.
# В ответе поле роли называется `role`: «кто выдал» должно быть видно именно
# ролью, а не только id доступа.
check "видна роль помощника в выдаче" yes "$(jq -r 'if any(.entries[]; .action == "grant" and .role == "junior") then "yes" else "no" end' <"$BODY")"
check "отзыв" 200 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"id\":\"$inv_id\"}" "$BASE/admin/accounts/revoke")"
check "после отзыва ключ не работает" 403 "$(code -H "X-Admin-Key: $key" "$BASE/admin/session")"
check "код" admin_key_revoked "$(get .error)"
check "второй отзыв → 409" 409 "$(code -X POST -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"id\":\"$inv_id\"}" "$BASE/admin/accounts/revoke")"
check "в списке — отозван" revoked "$(code -H "X-Admin-Token: $TOKEN" "$BASE/admin/accounts" >/dev/null; jq -r --arg i "$inv_id" '.accounts[] | select(.id==$i) | .status' <"$BODY")"

echo
echo "Пройдено: $pass, провалено: $fail, пропущено: $skip."
[ "$fail" -eq 0 ] || exit 1
