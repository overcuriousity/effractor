-- effractor accounts, schema 3: a share goes with what it names. A target is
-- one of two tables, so no foreign key can say so; these triggers do, for
-- every way a row goes, a cascade included. SQLite may hand a freed id out
-- again, and a new row must not inherit the shares of the one it replaced.
DELETE FROM shares WHERE
     (target_kind = 'document' AND target_id NOT IN (SELECT id FROM documents))
  OR (target_kind = 'folder' AND target_id NOT IN (SELECT id FROM folders))
  OR (grantee_kind = 'user' AND grantee_id NOT IN (SELECT id FROM users))
  OR (grantee_kind = 'group' AND grantee_id NOT IN (SELECT id FROM groups));
CREATE TRIGGER documents_shares AFTER DELETE ON documents BEGIN
  DELETE FROM shares WHERE target_kind = 'document' AND target_id = OLD.id;
END;
CREATE TRIGGER folders_shares AFTER DELETE ON folders BEGIN
  DELETE FROM shares WHERE target_kind = 'folder' AND target_id = OLD.id;
END;
CREATE TRIGGER users_shares AFTER DELETE ON users BEGIN
  DELETE FROM shares WHERE grantee_kind = 'user' AND grantee_id = OLD.id;
END;
CREATE TRIGGER groups_shares AFTER DELETE ON groups BEGIN
  DELETE FROM shares WHERE grantee_kind = 'group' AND grantee_id = OLD.id;
END;
