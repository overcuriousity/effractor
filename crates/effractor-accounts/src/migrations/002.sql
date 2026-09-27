-- effractor accounts, schema 2: the agent chat (spec 2026-09-27-assistant-chat-design §4.1).
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE assistant_grants (
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (group_id IS NULL))
);
CREATE UNIQUE INDEX assistant_grants_user ON assistant_grants (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX assistant_grants_group ON assistant_grants (group_id) WHERE group_id IS NOT NULL;
CREATE TABLE assistant_sessions (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  profile     TEXT NOT NULL CHECK (profile IN ('fault-tree', 'attack-tree', 'architecture')),
  title       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  -- The running turn: who, since when, with which tools, which turn, how many steps.
  turn_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  turn_since  INTEGER,
  turn_access TEXT CHECK (turn_access IN ('read', 'edit')),
  turn_no     INTEGER NOT NULL DEFAULT 0,
  turn_steps  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX assistant_sessions_document ON assistant_sessions (document_id);
CREATE TABLE assistant_messages (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  turn          INTEGER NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'marker')),
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE TABLE assistant_usage (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    INTEGER REFERENCES assistant_sessions(id) ON DELETE SET NULL,
  at            INTEGER NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER
);
CREATE INDEX assistant_usage_user ON assistant_usage (user_id, at);
