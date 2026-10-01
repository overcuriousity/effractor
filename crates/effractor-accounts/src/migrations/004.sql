-- effractor accounts, schema 4: what the agent chat keeps beside schema 2.
-- The role a message's author had on the document when they wrote it: the
-- model is told who asked what, and with which rights.
ALTER TABLE assistant_messages ADD COLUMN author_role TEXT
  CHECK (author_role IN ('viewer', 'editor', 'owner'));
-- Tokens estimated from a request's size when the endpoint reported none,
-- so the daily budget counts it too.
ALTER TABLE assistant_usage ADD COLUMN estimated_tokens INTEGER;
