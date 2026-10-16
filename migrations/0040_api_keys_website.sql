-- 0040: Connected websites - link a website URL to each API key
ALTER TABLE api_keys ADD COLUMN website_url TEXT NOT NULL DEFAULT '';
