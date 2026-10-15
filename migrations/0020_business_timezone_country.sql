-- 0020 Worldwide: per-business timezone and country.
ALTER TABLE businesses ADD COLUMN timezone TEXT DEFAULT 'Africa/Lagos';
ALTER TABLE businesses ADD COLUMN country TEXT DEFAULT 'Nigeria';
