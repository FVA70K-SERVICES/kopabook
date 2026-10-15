-- 0012: R2 file keys for customers and expense receipts
ALTER TABLE customers ADD COLUMN photo_key TEXT;
ALTER TABLE expenses ADD COLUMN receipt_key TEXT;
