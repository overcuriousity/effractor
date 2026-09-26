-- effractor accounts, schema 1 (spec §4). Timestamps are Unix seconds.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  admin         INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  webauthn_id   BLOB NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL
);
CREATE TABLE oidc_identities (
  issuer  TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE passkeys (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id BLOB NOT NULL UNIQUE,
  credential   TEXT NOT NULL,
  label        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE TABLE groups (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  admins_may_create_users INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE memberships (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE folders (
  id         INTEGER PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX folders_unique_name
  ON folders (owner_id, ifnull(parent_id, 0), name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE TABLE documents (
  id         INTEGER PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  profile    TEXT NOT NULL CHECK (profile IN ('fault-tree', 'attack-tree', 'architecture')),
  body       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at INTEGER
);
CREATE INDEX documents_folder ON documents (folder_id);
CREATE INDEX documents_owner ON documents (owner_id);
CREATE TABLE shares (
  id           INTEGER PRIMARY KEY,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('document', 'folder')),
  target_id    INTEGER NOT NULL,
  grantee_kind TEXT NOT NULL CHECK (grantee_kind IN ('user', 'group')),
  grantee_id   INTEGER NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at   INTEGER NOT NULL,
  UNIQUE (target_kind, target_id, grantee_kind, grantee_id)
);
CREATE INDEX shares_grantee ON shares (grantee_kind, grantee_id);
CREATE TABLE recent (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  opened_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, document_id)
);
