-- 0028 Platform admin flag for the KopaBook owner.
ALTER TABLE users ADD COLUMN is_platform_admin INTEGER DEFAULT 0;
