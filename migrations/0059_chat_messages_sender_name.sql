-- Team replies carry the agent's display name in chat_messages.sender_name.
-- The original FVAChat migration (0030) defined chat_messages without that
-- column, so on databases built from the migrations every team reply insert
-- failed. The reply endpoints also self-heal this at runtime
-- (ensureChatSenderName in functions/api/chat/_cases.js); this migration
-- records the change for databases maintained through the D1 console.
ALTER TABLE chat_messages ADD COLUMN sender_name TEXT;
