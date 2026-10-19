-- 0047: let the business owner grant staff access to the live Chat Center.
-- Adds staff_chat_enabled to business_chat_settings (default off: owner/partner only).
-- When on, staff members of the business can open the Chat Center and handle chats.

ALTER TABLE business_chat_settings ADD COLUMN staff_chat_enabled INTEGER NOT NULL DEFAULT 0;
