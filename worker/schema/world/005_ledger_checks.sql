-- Справочная копия схемы мира. Рабочая версия — worker/src/world/schema.ts.
-- История сверки Ledger по дням: гейт 1 требует семь дней подряд без расхождений.
CREATE TABLE IF NOT EXISTS ledger_checks (
  day INTEGER PRIMARY KEY,
  at  INTEGER NOT NULL,
  ok  INTEGER NOT NULL CHECK (ok IN (0, 1))
);
