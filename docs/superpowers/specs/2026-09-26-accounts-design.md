# effractor — accounts, stored documents and sharing with people

Date: 2026-09-26 · Status: designed with the owner in conversation, 2026-09-26;
awaiting the owner's review of this document.

## 1. Purpose and boundary

The self-hosted server gains an optional account system: people log in, their
fault trees, attack trees and architectures are kept on the server, found again
in a document browser, and shared with other users and groups. This is where
the self-hosted deployment diverges from the GitHub Pages ("lite") build, which
stays as it is: no accounts, no server storage, self-contained links.

Owner decisions, 2026-09-26:

- **Opt-in.** Accounts exist only when the server is started with a database
  (§3). A plain `effractor` is today's application, unchanged.
- **Plaintext at rest.** Documents are stored readable in SQLite. Protecting
  the database file (disk encryption, permissions) is the operator's job.
  Encrypting at rest with a key kept beside the database was rejected as
  useless ("an attacker who gets the db finds the key next to it"). An
  end-to-end encrypted vault is to be evaluated later (§12).
- **The server still never solves.** It stores and serves YAML text; parsing,
  generation and solving stay in the browser.
- **Public links are unchanged.** Encrypted in the browser, key in the
  fragment, opaque to the server, the existing share API and store.
- **Anonymous use stays.** With accounts on, a visitor who is not logged in
  gets today's application (IndexedDB working text, public links, the full
  solver), and is told plainly that nothing is kept on the server (§9.1).
- **Out of scope:** real-time collaboration, revision history, named
  snapshots, backup and bulk import (the YAML file is the export and the
  backup; users take it with them as they like), quotas, an audit log and API
  tokens (the last two are roadmap items, §12).
- OIDC talks only to the issuer the operator configures (the owner uses
  Nextcloud). That is the operator's own infrastructure, not a third party;
  nothing else is contacted.

## 2. Structure

- **`crates/effractor-accounts`** (new): the SQLite schema and migrations,
  users, groups, memberships, folders, documents, shares, sessions, and the
  permission rule (§5). Plain Rust, no HTTP. It does I/O, so it is not one of
  the wasm crates and the no-I/O rule does not apply to it.
- **`crates/effractor-server`** gains `auth/` (password, passkey and OIDC
  flows, sessions, the CSRF guard) and `api/` (documents, folders, sharing,
  administration), both thin over the crate. `share/` is untouched.
- **Libraries** (pure Rust, keep the static musl builds): `rusqlite` with
  bundled SQLite; `argon2` (argon2id); `webauthn-rs`; `openidconnect` with
  rustls. Database calls run on `spawn_blocking`: one writer connection and a
  small pool of readers (WAL allows readers beside the writer).
- **Front end**, vanilla JS as today: pure modules (`documents.js`: tree,
  search filtering, reveal; `autosave.js`: the save queue, retry, conflict;
  `roles.js`: what a role permits) and DOM modules (`account-ui.js`: login,
  account dialog, the bar; `documents-ui.js`: the Documents tab;
  `admin-ui.js`: administration; the share dialog's people section in
  `share-ui.js`).
- **The static export** (`export_static`, Pages) renders the shell without
  accounts and does not ship the account modules.

## 3. Running it

- `effractor --accounts <file.db>` turns accounts on. The file is created with
  WAL and `foreign_keys=ON` on first start.
- **OIDC:** `--oidc-issuer <url>`, `--oidc-client-id <id>`, `--oidc-name
  <label>` (the button's word, e.g. "Nextcloud"). The client secret comes from
  `--oidc-secret-file <path>` or `EFFRACTOR_OIDC_SECRET`, never from argv,
  where `ps` shows it. Without an issuer there is no OIDC button.
- **Passkeys:** `--public-url <https://…>`, the origin WebAuthn binds
  credentials to. Without it, passkeys are not offered.
- **CLI** against the same database; safe while the server runs (WAL):
  - `effractor user list` — name, login methods, admin, disabled, groups
  - `effractor user add <name>` — asks for a password (twice, no echo)
  - `effractor user promote <name>` / `effractor user demote <name>`
  - `effractor user passwd <name>` — for the last admin who forgot theirs
  - each takes `--accounts <file.db>`; demoting the last admin is refused.
- **Schema migrations.** The owner's rule "no versioning, change formats in
  place" governs the YAML format and stays. A database holding users' data
  cannot be edited in place, so the schema has numbered migrations, embedded,
  run at startup, tracked by `PRAGMA user_version`. The CLI refuses a database
  newer than itself.
- The hourly sweep that removes expired shares also purges deleted documents
  and folders older than 7 days (§6.4) and expired sessions.

## 4. Data model

| table | columns (besides `id`) |
|---|---|
| `users` | `name` (unique, the login, case-insensitive), `display_name`, `password_hash` (argon2id, null when none), `admin`, `disabled`, `created_at` |
| `oidc_identities` | `issuer`, `subject` (unique together), `user_id` |
| `passkeys` | `user_id`, `credential` (webauthn-rs's serialized passkey), `label`, `created_at`, `last_used_at` |
| `sessions` | `token_hash` (SHA-256 of the cookie's token), `user_id`, `created_at`, `last_seen_at`, `expires_at` |
| `groups` | `name` (unique), `admins_may_create_users` |
| `memberships` | `group_id`, `user_id` (unique together), `role`: `member` · `admin` |
| `folders` | `owner_id`, `parent_id` (null at the owner's root), `name` (unique per parent), `deleted_at` |
| `documents` | `owner_id`, `folder_id` (null at the root), `name`, `profile` (`fault-tree` · `attack-tree` · `architecture`), `body` (the YAML text), `version`, `updated_at`, `updated_by`, `deleted_at` |
| `shares` | `target_kind` (`document` · `folder`), `target_id`, `grantee_kind` (`user` · `group`), `grantee_id`, `role`: `viewer` · `editor`, `created_at`; unique per target and grantee |
| `recent` | `user_id`, `document_id`, `opened_at` (last five kept per user) |

Ids are integers inside the database and never appear in a shared public link.
A document is at most 1 MiB, as a share is. Folder depth is at most 32.

## 5. Permissions

A user's **role on a document** is:

1. `owner` if they own it;
2. otherwise the strongest role among the shares on the document or on any
   folder above it, granted to them or to a group they are a member of
   (`editor` beats `viewer`);
3. otherwise none.

A folder's role follows the same rule. Deleted items are none for everyone but
the owner (who may restore them, §6.4). A disabled owner's items stay shared
(§8). The
folder chain is walked by a recursive CTE in SQL, never by Rust recursion on
user-sized input. The rule is one function in `effractor-accounts` and is
tested as a table (§11).

| action | viewer | editor | owner |
|---|---|---|---|
| open, download YAML, make a public link, save a copy of one's own | yes | yes | yes |
| save content | — | yes | yes |
| rename, move, delete, share | — | — | yes |

Having no role on something means **404**, never 403, as the share API does:
the API does not tell which documents exist. **Admins** manage people and
groups, not content: an admin sees a user's documents only when they are
shared with them. (The operator can read the database; the UI does not make
that a feature.)

**Group admins** are members an admin has given the group's `admin` role. They
add existing users to their group and remove members. Where an admin has set
the group's `admins_may_create_users`, they also create password users, who
land in that group. They cannot disable, delete or promote anyone, reset
passwords, or touch other groups. A user a group admin created is an ordinary
user.

## 6. Documents

### 6.1 Autosave

Logged in, the open document lives on the server. An accepted edit is written a
moment later (debounced, as IndexedDB is written today) with `PUT` carrying the
`version` it was based on; the answer carries the new version. The working text
is still kept in IndexedDB, so nothing is lost while the server cannot be
reached; the status slot says *saved*, *saving…* or *not saved · retrying*.

### 6.2 Conflicts

Without real-time collaboration, two editors can save the same document. A
`PUT` whose base version is not the current one is refused with **409** and
who saved it and when. The page shows one notice line: *Changed by Alice ·
14:02 · Load theirs · Keep mine as copy*. The copy goes to the saver's own
root with the name suffixed. Nothing is overwritten silently.

### 6.3 Modes

A document has the profile it was created with; opening one lands it in its
own mode, as opening a file does today. Each mode still has its own slot: logged
in, the slot remembers which server document it holds. New (the crumb's
dropdown, or the tree's menu) creates a server document of the mode on the page,
in the folder selected in the tree, else the root.

### 6.4 Deleting

No confirm dialogs (the owner's rule). Deleting a document or folder in the
browser sets `deleted_at` and says *Deleted "X" · Undo* in the canvas notice;
Undo clears it. Deleted items are invisible to everyone, their shares are
inactive, and the hourly sweep purges them after 7 days. There is no trash view.

### 6.5 Search

A case-insensitive substring match on names and content over everything the
user can read, in SQL; no full-text index.

### 6.6 Logging in with work on the page

When someone logs in while the page holds local work that is not a server
document, the app offers once, as a notice: *Save "X" to your documents ·
Save*. Only the document on screen; there is no bulk import.

## 7. Signing in

### 7.1 Methods

One login dialog (the app's own, not a separate page) shows the configured
methods:

- **Username and password.** argon2id; at least 12 characters; no composition
  rules.
- **Passkey.** Usernameless (discoverable credential); a FIDO2 security key
  works the same way. **Every account may add passkeys** as a login method,
  whatever it was created with — password, OIDC, or by an admin (owner,
  2026-09-26). A passkey is a login method of its own, not a second factor
  after a password.
- **OIDC** (*Sign in with Nextcloud*): authorization code with PKCE, `state`
  and `nonce`; the pending state is kept server-side for 10 minutes.

A wrong password, an unknown user and a disabled user get the same message.
Failed attempts are limited per address (the share API's `Limiter`).

### 7.2 Where accounts come from

- **No public sign-up** (owner, 2026-09-26).
- The CLI creates the first user and promotes admins (§3). There can be several
  admins.
- Admins create password users in the GUI; group admins too, where allowed
  (§5).
- **OIDC provisions** an account at the first login, **in no group** until an
  admin assigns one. The name is `preferred_username`; if it is taken, the new
  account is `name-2` (then `-3`, …). An OIDC login is **never** linked to an
  existing account by name or email (that is an account takeover). A user who
  wants Nextcloud login on an existing account links it from the account
  dialog while logged in. Identities match on `(issuer, subject)`.

### 7.3 Sessions and requests

- A session is a random 128-bit token in an `HttpOnly; SameSite=Lax` cookie,
  `Secure` whenever `--public-url` is `https`; the database keeps its
  SHA-256. Accounts without `--public-url` on a non-loopback address start
  with a warning that logins travel unencrypted unless a TLS proxy is in front.
- It expires 30 days after login or 7 days after last use. Changing one's
  password, being disabled, or an admin's password reset revokes the user's
  other sessions (all of them, for a reset or disable).
- Every state-changing request must carry a same-origin `Origin` header; one
  without is refused. `SameSite=Lax` is what lets the OIDC callback's redirect
  carry the cookie.
- The shell tells the page whether accounts are on; the page asks
  `GET /api/me` who is logged in.

### 7.4 The account dialog

Display name · change password (OIDC-only users may set one) · passkeys (add,
rename, remove) · linked OIDC identity (link, unlink) · log out · log out
everywhere else. A user cannot remove their last way of logging in.

## 8. Administration

- **Disable** — cannot log in, sessions revoked, everything owned stays and
  stays shared.
- **Delete** — removes the user, their documents and folders, and every share to
  or from them (owner, 2026-09-26: no transfer). Not undoable, so the button
  asks for a second click and names the count (*Delete · 12 documents*).
  Deleting, disabling or demoting the last admin is refused.
- **Reset password** — sets a new one; all the user's sessions end.
- **Promote / demote admin** — in the GUI as in the CLI; never the last admin.
- **Groups** — create, rename, delete; members and their role; the
  `admins_may_create_users` switch.

## 9. The page

The owner's standing UI rules apply (`docs/HANDOFF.md`, "How the owner wants
the UI"): quiet chrome, detail on demand, the app's own menus, no confirm
dialogs, copy of a few words. What it looks like is decided in the owner's
preview.

### 9.1 The bar

- **Accounts on, logged out:** a muted *local only · Log in* beside the name
  crumb — always visible, never modal.
- **Logged in:** the crumb is the path, *Folder / name ▾*; clicking it opens the
  Documents tab with the document revealed. At the far right, the user's name
  with a menu: *Account*, *Administration* (admins and group admins), *Log
  out*. The status slot carries the save state (§6.1).
- **Accounts off:** none of this exists.

### 9.2 The Documents tab

The owner asked that it not conflict with the rest of the UI and that people
find what they look for easily.

- The left panel gets the right panel's tab strip, **Model · Documents**, the
  same component and behaviour. Left is what one works on, right is analysis.
- The tab is there whenever accounts are on. Logged out it says *Log in to keep
  documents on this server · Log in*.
- Top to bottom: search field · **Recent** (last five opened) · **My
  documents** (folders, then documents with their mode's icon) · **Shared with
  me** (grouped by who shared).
- Search filters as one types and keeps the tree's structure, so a hit shows
  its folder.
- Left click opens. Right click: *Open*, *Rename*, *Move to ›* (folders
  nested), *Share…*, *Download YAML*, *Delete* — each only where the role
  allows (§5), else greyed with why. The background's menu: *New document*,
  *New folder*. Documents drag onto folders.
- Empty places say why and what to do (*No documents yet · New ▾*; *Nothing
  shared with you*).
- The crumb's dropdown lists *Documents* first. A single-letter key opens the
  tab; it is chosen at implementation against the editor's keys and listed in
  `?`. Ctrl+O and Ctrl+S keep their meaning (open a file, download YAML).

### 9.3 The share dialog

For owners, the existing dialog gains *People and groups* above the public
link: a name field with the app's own suggestions (users and groups), a role
dropdown (*can view* · *can edit*), and the grants with ×. A folder's dialog
says the grant covers everything inside, now and later. Non-owners see the
public link part only. The public link part is unchanged.

### 9.4 Administration and account dialogs

Large dialogs in the nmap dialog's manner. **Users:** list (name, login
methods, admin, groups); a selected row shows its detail and actions (§8);
*New user*. **Groups:** list; a selected group shows members with their role,
add and remove, the switch. A group admin sees only their groups, and *New
user* only where allowed. The account dialog holds §7.4.

## 10. HTTP API (accounts on only)

All under `/api/`, JSON, errors as status codes. Every route below answers 404
when accounts are off.

- `GET /me` · `POST /auth/password` · `POST /auth/logout` ·
  `POST /auth/logout-others`
- `POST /auth/passkey/start` · `POST /auth/passkey/finish` (login);
  `POST /account/passkeys/start` · `…/finish` (register) · `PATCH|DELETE
  /account/passkeys/{id}`
- `GET /auth/oidc` (redirect) · `GET /auth/oidc/callback` ·
  `POST /account/oidc/link` · `DELETE /account/oidc`
- `PATCH /account` (display name, password)
- `GET /documents?q=` (tree: recent, mine, shared) · `POST /documents` ·
  `GET|PUT|PATCH|DELETE /documents/{id}` · `POST /documents/{id}/restore`
- `POST /folders` · `PATCH|DELETE /folders/{id}` · `POST /folders/{id}/restore`
- `GET|POST /{documents|folders}/{id}/shares` · `DELETE /shares/{id}`
- `GET /directory?q=` (user and group names for the share field)
- `GET|POST /admin/users` · `PATCH|DELETE /admin/users/{id}` ·
  `GET|POST /admin/groups` · `PATCH|DELETE /admin/groups/{id}` ·
  `PUT|DELETE /admin/groups/{id}/members/{user}`

## 11. Testing

- **`effractor-accounts`:** migrations from an empty database; the permission
  rule as a table (owner, direct share, folder-chain share at depth, group
  share, strongest wins, deleted, disabled owner still shared, none); group admin powers;
  delete cascades; the version check; soft delete and the 7-day purge with a
  fixed clock; search scoped to what one can read; last-admin refusals.
- **Server** (axum `oneshot`, as the share tests): every route logged out and
  in; missing or foreign `Origin` refused; session expiry both ways; login rate
  limit; one message for every login failure; OIDC against an in-test fake
  issuer (no network): state, nonce, PKCE, provisioning and the name collision;
  passkey registration and login with webauthn-rs's software authenticator;
  the CLI against a temporary database; accounts off: every new route 404 and
  the shell as before.
- **Static export:** contains no account module.
- **Pure JS** (`node --test`): tree and search filtering, reveal, what a role
  offers, the autosave queue (debounce, retry, 409).
- **Looks:** the owner, in a preview on 8081.

## 12. Delivery and later items

Roadmap items, each a branch and PR of its own, in this order:

1. `install-systemd` — independent of accounts (§13).
2. `accounts-core` — the crate, migrations, CLI, password login, sessions,
   `/api/me`, the bar's logged-out line and login dialog.
3. `stored-documents` — documents and folders, autosave and conflicts, the
   Documents tab, search, recent, soft delete and purge.
4. `sharing-people` — shares to users and groups, *Shared with me*, the share
   dialog's people section.
5. `administration` — users and groups in the GUI, group admins.
6. `passkeys` — login and the account dialog's passkeys.
7. `oidc` — login, provisioning, linking.

Later, as roadmap items without a design yet: `e2e-vault` (end-to-end
encrypted storage; evaluate), `audit-log`, `api-tokens`.

## 13. Installer: systemd service

`install.sh` (`curl … | sh`) asks after installing the binary: *Install a
systemd service? [y/N]*.

- The answer is read from `/dev/tty`, since stdin is the script. Without a
  terminal the answer is no, and it says so. `EFFRACTOR_SYSTEMD=yes|no` answers
  without asking.
- Skipped cleanly, with a line, when `systemctl` is missing.
- **Not root:** a user unit, `~/.config/systemd/user/effractor.service`, data in
  `~/.local/share/effractor`, `systemctl --user enable --now effractor`; it
  mentions `loginctl enable-linger` for running without a login session.
- **Root:** a system unit with its own system user, data in
  `/var/lib/effractor`, hardened (`NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateTmp`, `StateDirectory=effractor`).
- Both bind `127.0.0.1:8080` and carry a commented line showing how to turn on
  accounts (`--accounts …`). The installer never turns them on.
- Tested in `scripts/install.test.sh` with a fake `systemctl` on `PATH` and the
  answer supplied through the environment and a fake tty.
