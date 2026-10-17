-- 0042: units of measure for products.
-- Every product gets a unit (default 'piece') so price/stock/sales
-- can read "NGN 500 per cup" instead of always per-piece.
-- Existing products keep working: they default to 'piece'.
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece';
