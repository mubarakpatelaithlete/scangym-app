-- First deploy of chat_messages wrote role/text/platform in the wrong columns.
DELETE FROM chat_messages WHERE role NOT IN ('user', 'assistant');
