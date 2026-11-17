-- 0064: SKUs are unique per business (Phase 7.3).
-- The application checks before insert/update, and this index is the
-- backstop against two concurrent creates racing the check. Case
-- insensitive: "KB-0001" and "kb-0001" are the same SKU.
-- Verified before shipping: live D1 has no duplicate (business_id, sku)
-- pair in any letter case and no NULL/empty SKU, so the index builds clean.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_business_sku
  ON products(business_id, sku COLLATE NOCASE);
