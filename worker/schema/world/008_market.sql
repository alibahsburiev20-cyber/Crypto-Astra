-- Этап 2, срез 6: рынок.
-- Лот держит ресурс в эскроу: он списан у продавца при выставлении и вернётся
-- только отменой. market_sales — история цен для медианы и коридора.
CREATE TABLE IF NOT EXISTS market_lots (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled')),
  buyer_id TEXT,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_market_open ON market_lots (status, resource, unit_price);

CREATE TABLE IF NOT EXISTS market_sales (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  amount INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  gross INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_sales ON market_sales (resource, at);

-- Флаги не блокируют сделку: они нужны при разборе спорных случаев.
CREATE TABLE IF NOT EXISTS market_flags (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  gross INTEGER NOT NULL,
  at INTEGER NOT NULL
);
