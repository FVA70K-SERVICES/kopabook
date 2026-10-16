-- 0021 Close business: soft-close keeps all records but hides the business.
ALTER TABLE businesses ADD COLUMN status TEXT DEFAULT 'active';
