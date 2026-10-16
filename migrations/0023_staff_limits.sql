-- 0023 Staff control: per-staff discount cap and suspension.
ALTER TABLE business_members ADD COLUMN max_discount_percent REAL DEFAULT NULL;
ALTER TABLE business_members ADD COLUMN suspended INTEGER DEFAULT 0;
