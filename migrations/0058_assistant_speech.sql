-- Ask Kopa AI spoken answers on/off, per business. Lives in
-- business_chat_settings beside assistant_voice and assistant_language,
-- and is fully separate from the Admin AI voice settings
-- (admin_ai_settings, migration 0055). Default on.
ALTER TABLE business_chat_settings ADD COLUMN assistant_speech INTEGER NOT NULL DEFAULT 1;
