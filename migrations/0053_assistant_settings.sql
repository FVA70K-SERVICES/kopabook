-- Assistant identity for Ask Kopa AI: a Solo/Pro owner can name the
-- assistant, voice gender selection is Solo/Pro, and the assistant
-- language is available on every tier.
ALTER TABLE business_chat_settings ADD COLUMN assistant_name TEXT;
ALTER TABLE business_chat_settings ADD COLUMN assistant_voice TEXT NOT NULL DEFAULT 'default';
ALTER TABLE business_chat_settings ADD COLUMN assistant_language TEXT NOT NULL DEFAULT 'en';
