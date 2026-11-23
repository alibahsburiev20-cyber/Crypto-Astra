#!/usr/bin/env bash
# Учебное восстановление базы: экспорт → импорт в чистую SQLite → сверка счётчиков.
#
# Локальный прогон (по умолчанию):
#   bash scripts/restore-drill.sh
# Продовый дамп, снятый вручную (wrangler d1 export DB --remote --output astra.sql):
#   DUMP=/path/astra.sql bash scripts/restore-drill.sh
#
# Скрипт ничего не удаляет и не пишет в рабочую базу: только читает.
set -euo pipefail

cd "$(dirname "$0")/.."
TMP="${TMPDIR:-/tmp}/astra-restore-drill"
mkdir -p "$TMP"

if [[ -n "${DUMP:-}" ]]; then
  echo "== Дамп из $DUMP"
else
  DUMP="$TMP/astra.sql"
  echo "== Экспорт локальной D1 в $DUMP"
  rm -f "$DUMP"
  npx wrangler d1 export DB --local --output "$DUMP" >/dev/null
fi

# Минифлейр держит локальную базу в .wrangler/state — берём файл базы, а не metadata.
SOURCE="$(find .wrangler/state/v3/d1 -name '*.sqlite' ! -name 'metadata.sqlite' -print 2>/dev/null | head -n 1 || true)"
if [[ -z "${SOURCE}" ]]; then
  echo "   локальную базу не нашли — сверять будем только целостность дампа"
fi

echo "== Импорт и сверка"
npx tsx scripts/restore-verify.ts --dump "$DUMP" ${SOURCE:+--source "$SOURCE"}

echo
echo "Репетиция пройдена. Что делать при настоящей аварии — docs/RUNBOOK_BACKUP.md."
