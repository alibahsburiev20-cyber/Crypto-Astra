-- Этап 2, срез 4: модули на кораблях.
-- Модуль привязан к кораблю и занимает один из его слотов (SHIPS[type].slots).
-- Снять модуль нельзя — только поставить новый или улучшить существующий,
-- поэтому отдельных записей об удалении нет.
CREATE TABLE IF NOT EXISTS ship_modules (
  ship_id TEXT NOT NULL REFERENCES ships (id),
  module TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  installed_at INTEGER NOT NULL,
  PRIMARY KEY (ship_id, module)
);
