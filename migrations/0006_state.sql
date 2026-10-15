-- 0006: add state to businesses and waitlist signups (Nigerian state dropdown)
ALTER TABLE businesses ADD COLUMN state TEXT;
ALTER TABLE waitlist_signups ADD COLUMN state TEXT;
