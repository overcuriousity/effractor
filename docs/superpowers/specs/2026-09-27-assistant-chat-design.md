# effractor — an agent chat on the document

Date: 2026-09-27 · Status: approved by the owner, 2026-09-27.

Reference: `../Vestigo` (`docs/AGENT.md`, `src/vestigo/agent/`,
`src/vestigo/api/routers/agent.py`, `frontend/src/components/agent/`) — its
admin configuration, key handling and model enumeration are followed; its
server-side tool execution and propose/confirm writes are not (§2).

## 1. Purpose and boundary

effractor is used exclusively for teaching: students study the design and
development of secure systems at the University of Applied Sciences Mittweida.
The chat gives them an agent beside the canvas that **can do anything a person
can do in effractor on the open document, in the open mode**, with the
sender's rights, and whose edits appear on the canvas as they are made.

- Opt-in twice: the server must run with `--accounts`, and a site admin must
  configure an endpoint and grant the chat to groups or users (§5). Without
  both, nothing of it is visible and its routes answer 404.
- The Pages build and the server without `--accounts` carry no chat code
  (as `js/accounts/` today).
- Out of reach of a session, because a session belongs to one document and
  one mode: switching mode, opening or creating other documents, file open and
  save, sharing, account and admin actions, and the scanner dialogs.
- Scan results are not a tool. Output pasted into a message is text to the
  model, which may populate the architecture by hand through the ordinary
  tools (hosts, services, products, vulnerabilities as parameters and defense
  states, flows). The result depends on the model; that is accepted.
- The only place anything leaves to is the configured model endpoint; the
  agent has no tool that reaches a network. A cloud endpoint is the admin's
  choice, shown to every user in the panel (§7) — offered with a warning, not
  filtered.

## 2. Where the agent runs

The **browser runs the tools; the server talks to the model.** All editing
and analysis already live in the browser (pure edit functions, wasm solver in
a worker; the server never links the solver), so tools reuse them unchanged:
edits go through `window.effractor.applyEdit`, draw live, are checked by wasm,
autosaved under the user's own rights, and each is one Ctrl+Z step.

The server holds the key, checks grant, role and budget, builds every model
request itself, streams the reply to the page and stores the session. A turn
runs only while the page is open; closing it stops the turn (§8).

Rejected: running the agent on the server (every edit function and the solver
rewritten in Rust, edits fighting the open copy's autosave, a push channel for
live display); a server loop that delegates each tool to the browser (still
needs the page open, one extra round trip per tool, no gain).

## 3. Sessions

- A session belongs to **one account document and its profile**
  (`fault-tree`, `attack-tree`, `architecture`). The architecture's two views
  (drawing, generated attack graph) are one mode: one session sees both.
- Sessions are **shared**: everyone who may open the document *and* is
  granted the chat sees all of its sessions and may continue any of them.
  Each user message shows its author.
- **What the agent may do on a turn is decided by the sender of that turn**:
  a Viewer's turn gets read and view tools; an Editor's or Owner's turn also
  gets edit tools (§6). Nobody gains rights through someone else's session.
- One turn at a time per session. A second sender is told who is asking.
- Title: the first message, shortened; renamed in place by its starter or the
  document's owner. Deleting (same people) is soft and undoable through the
  usual notice. A deleted document hides its sessions; restoring brings them
  back.

## 4. Server

### 4.1 Tables (`effractor-accounts`, migration `002.sql`)

| Table | Columns |
|---|---|
| `settings` | `key` TEXT PK, `value` TEXT, `updated_by`, `updated_at` |
| `assistant_grants` | `user_id` NULL, `group_id` NULL (exactly one set), `granted_by`, `granted_at` |
| `assistant_sessions` | `id`, `document_id`, `profile`, `title`, `created_by`, `created_at`, `updated_at`, `deleted_at`, `turn_by` NULL, `turn_since` NULL |
| `assistant_messages` | `id`, `session_id`, `seq`, `turn`, `role` (`user`/`assistant`/`tool`/`marker`), `author_id` NULL, `content` (JSON, §4.4), `input_tokens` NULL, `output_tokens` NULL, `created_at` |
| `assistant_usage` | `user_id`, `session_id`, `at`, `input_tokens`, `output_tokens` |

Token columns are what the provider reported, NULL when it reported nothing —
never estimated.

`turn_by`/`turn_since` hold the session's running turn in the database; a turn
older than (step limit × request timeout) counts as stale and is released.

A user may use the chat when a grant names them or any group they belong to,
and they are not disabled.

### 4.2 Configuration

Settings live in `settings` under `assistant.*`:

- `provider`: `openai` (OpenAI-compatible: ollama, llama.cpp, vllm,
  OpenRouter, …) or `anthropic`
- `address`
- `key`
- `model`
- `steps` (50)
- `context` (tokens; taken from the endpoint when it reports one, else entered)
- `message_bytes` (262144)
- `daily_tokens` (off)
- `timeout_seconds` (120)

The chat is *configured* when `address` and `model` are set; a keyless local
endpoint is allowed. Changes apply without a restart.

The operator may pin the key with `--assistant-key-file FILE` or
`EFFRACTOR_ASSISTANT_KEY` (never a command-line value, as with the OIDC
secret). A pinned key wins, and the admin tab can neither show nor store one.
Otherwise the key is stored in `settings` in plain text, like documents.

### 4.3 Routes

All routes sit behind the existing `same_origin` guard and `CurrentUser`.

Chat routes need a grant; document routes also need Viewer or better on the
document (`perms::document_role`, `need()`), else 404/403 as today.

| Route | Purpose |
|---|---|
| `GET /api/assistant` | whether this user may use it; provider host, model, limits for the notice |
| `GET/POST /api/documents/{id}/assistant/sessions` | list / create (profile from the document) |
| `GET/PATCH/DELETE /api/assistant/sessions/{sid}`, `POST …/restore` | read with messages / rename / soft delete / restore |
| `POST /api/assistant/sessions/{sid}/messages` | a user message; answers with a stream (§4.5) |
| `POST /api/assistant/sessions/{sid}/results` | results of the tool calls the server has on record; answers with a stream |
| `POST /api/assistant/sessions/{sid}/stop` | stop the running turn |
| `GET/PUT /api/admin/assistant` | settings (the key only as `key_set`/`key_pinned`), usage of the last 24 h per user |
| `POST /api/admin/assistant/models` | list models, from the address and key as typed (unsaved) |
| `POST /api/admin/assistant/test` | one tiny request, answered in plain words |
| `PUT/DELETE /api/admin/assistant/grants` | grant or revoke for a user or group |

The admin routes are for site admins only (`Scope::All`); `PUT` and grant
changes need `session::fresh`.

### 4.4 Messages and providers

Messages are stored in one neutral shape, with content blocks `text`,
`thinking`, `tool_call {id, name, input}`, `tool_result {id, ok, output}` and
`marker {left_out_turns}`. Two adapters (`assistant/openai.rs`,
`assistant/anthropic.rs`, on the existing `reqwest`) translate the shape to each
wire protocol and parse their streams back into it, including tool calls, usage
and stop reasons.

### 4.5 A turn

1. `messages`: the server checks grant, role, budget, message size and that no
   turn is running, then claims the turn and stores the message with its
   author.
2. It builds the request **itself**:
   - the system prompt for this profile (§6.4);
   - a short state line sent by the page: view, selection, scenario;
   - the stored history, fitted to the context (§4.6);
   - the tools the sender's role allows (§6).

   The page cannot set the model, prompt, tools, history or limits.
3. It streams the model's reply to the page as server-sent events on the POST
   response (`text`, `thinking`, `tool_call`, `end {reason}`, `error {code,
   reason}`), storing as it goes.
4. `end {reason: tools}`: the page runs the calls (§6) and posts their results.
   The server accepts only results whose ids match the open calls of that turn,
   caps each at `message_bytes`, stores them and asks the model again — step 3.
5. The turn ends:
   - `done`;
   - `steps` reached → `end {reason: steps}` and the panel offers **Continue**;
   - `stopped`;
   - an error (§8).

   Usage is recorded, and the claim is released.

### 4.6 Fitting the context: truncate the middle

The start of the session (its first turn, where the task was set) and the
most recent turns are kept; whole turns are dropped from the middle outward
until the request fits `context` (estimated from characters; calibrated down
when the provider reports an overflow). A `marker` in the request says how many
turns were left out; the transcript shows it as a quiet line. A single result
too large on its own (e.g. `read_document` of a big architecture) is cut the
same way: head and tail kept, the middle marked left out.

Deterministic; the model is never asked to summarise; the stored session stays
complete.

### 4.7 The key stays on the server

- No route returns the key.
- Provider errors are passed on as a status and a short reason, never verbatim,
  and are scrubbed of the key.
- Request headers are never logged.
- Changing `address` clears a stored key.
- Model listing sends a stored key only to the stored address; with an edited
  address it uses only a key typed now.

## 5. Admin

A **Chat** tab in the admin dialog, beside Users and Groups, for site admins.

- **Endpoint:**
  - Provider and address (menus from `effractorMenu`).
  - Key: an always-empty password field reading *stored* or *set by the
    operator*.
  - Model: enumerated automatically once address and key are filled, even
    unsaved; free text with the reason when listing fails.
  - **Test.**
- **Limits:** steps per turn, context, message size, daily tokens per user.
- **Who may use it:** every group and user with a switch. The same switch sits
  in each row of the Users and Groups tabs.
- **Usage:** last 24 h per user, turns and reported tokens. Says so when the
  endpoint reports no counts, since the daily budget cannot then hold.

## 6. Tools

### 6.1 Catalog

One file, `assets/js/assistant/tools.json`, read by the server
(`include_str!`) and the page. Each tool has:

- `name`
- `profiles`
- `access`: `read` (reads), `view` (changes only what is shown) or `edit`
- a description per profile (fault trees speak of probabilities; attack trees
  and architectures of attacker time and cost)
- a JSON input schema

A Viewer's turn gets `read` and `view`; Editor and Owner get all three.

### 6.2 Execution in the page

`assistant-tools.js` maps each name to the existing pure functions and runs
calls through one queue (the `apply` pattern of `architecture-ui.js`).

- The page runs only tools of the turn's access, as a second check.
- Each `edit` call is one `applyEdit`: one undo step, validated by wasm.
- A refused or overtaken edit returns `ok: false` with the app's reason, so the
  model can correct itself.
- Results are compact JSON with ids and plain words (`effractorWords`).
- The agent sees the document as it is in *this* browser now, unsaved edits
  included, plus selection, view and scenario.

### 6.3 Tools by profile

**Every profile:**

| Access | Tools |
|---|---|
| `read` | `read_document` (YAML, as Ctrl+S saves it), `problems` |
| `view` | `show` (select and pan clear of both floating panels) |
| `edit` | `replace_document(yaml)` (validated whole, applied as one step), `rename_document` |

**Fault and attack tree:**

| Access | Tools |
|---|---|
| `read` | `analyse`: top result, ranked cut sets, controls, cost trade-off |
| `edit` | `add_node`, `set_node` (label, description, gate or k-of-n, leaf kind, TTC or probability, cost, detection, id), `link`, `unlink`, `move`, `delete_node`, `put_asset`, `put_control` (on/off, effects), `set_analysis` (horizon, time unit, samples, seed, confidence) |

**Architecture:**

| Access | Tools |
|---|---|
| `read` | `catalog`, `attack_graph` (support, chokepoints), `solve(scenario)` (headline, routes, assumptions), `compare` |
| `view` | `set_view`, `set_scenario`, `show_route`, `show_all_steps`, `fold_cluster` |
| `edit` | `add_entity`, `set_entity` (label, description, addresses, identities, vendor, parameters, defenses), `link` (associations), `put_flow`, `remove` (the app's safe cascade), `set_attacker` (footholds, targets), `cluster` (make, rename, take out, merge, dissolve), `put_scenario`, `set_change`, `set_speed`, `set_analysis` |

**Coverage test:** a node test enumerates the exported edit functions of
`edit.js`, `architecture-edit.js`, `architecture-links.js`, `clusters.js` and
`comparison.js` and fails for any not reached by a tool and not on a short
`excluded` list with its reason. A new edit feature must answer "and the
agent?" in the same change.

### 6.4 System prompt (per profile, on the server)

- The educational frame: a tutor in a Mittweida course on secure-systems design,
  working on students' models.
- The profile's vocabulary and rules.
- Read before editing.
- Use ids from results, never guessed.
- Say which values are assumed.
- Prefer one tool call per change, many calls per step.

## 7. The panel

- **Opening:**
  - A quiet chat icon at the canvas's top left, its key (a modifier chord, not
    a letter) in the tooltip.
  - Present only for granted users on an account document.
- **Placement:**
  - Floats over the canvas on the **left**, full height minus 8 px, opposite
    the inspector. Both may be open.
  - Fixed, not draggable; width dragged at its inner edge, 300–560 px.
  - A new z-index token, `--z-chat`.
  - Items the agent shows are panned clear of it.
- **Header:**
  - The session title and a menu:
    - new session;
    - this document's sessions, newest first, with starter and date;
    - delete (undoable notice).
  - Rename in place.
- **Transcript:**
  - Author names on user messages.
  - The agent's text in a small in-house markdown renderer (paragraphs, lists,
    bold, italics, inline and block code), never HTML.
  - Each tool call one quiet line in plain words ("Added firewall waf-1"):
    - click selects the item on the canvas;
    - a second click shows input and result;
    - a refused call shows the reason.
  - Thinking: one collapsed line.
  - Tokens only as reported.
  - The truncation marker as a quiet line.
- **Undo turn:**
  - Beside a finished turn that edited. Restores the text from before the turn
    in one step.
  - Offered only while the document is unchanged since the turn ended, and only
    in the page that ran it; otherwise it says why.
- **Input:**
  - Enter sends, Shift+Enter breaks the line; Send becomes **Stop** during a turn.
  - Esc leaves the field; a second Esc closes the panel.
  - Typing never reaches the app's keys (`keyElsewhere`/`textField`).
  - A paste over the message size or the context says so before sending.
- **Empty session** — two lines:
  - where messages go (host, model) and that this is for the course;
  - for a Viewer also *can read, not edit*.
- **Someone else's turn:**
  - The input names who is asking.
  - The transcript refreshes every 2 s until it ends.
  - Their agent's edits reach this page through the existing autosave and
    conflict flow ("Load theirs" / "Keep mine as copy").

## 8. Failing

Each failure is one plain line in the transcript giving the reason:

- endpoint unreachable
- key rejected
- rate-limited by the provider
- context overflow (retried once with a tighter fit)
- daily budget reached
- step limit (Continue)

Text already received is kept, marked *interrupted*.

On stop, closed page or lost stream, open tool calls are recorded as
`tool_result {ok: false, output: "not run"}` when the turn is released or the
next message arrives, so the history stays valid for both protocols.

## 9. Testing

`npm test` and `cargo test`; no real model is contacted.

- **Rust:**
  - Both adapters against a fake HTTP server on localhost: streams, tool calls,
    usage, errors.
  - Every route across the grant × role matrix.
  - Result ids matched to open calls.
  - One turn per session and stale release.
  - Budget, steps and message size.
  - Middle truncation.
  - Admin fresh-login.
  - Address change clears the key; listing never sends a stored key elsewhere.
  - A known key sent through every chat and admin route and error path must
    appear in no response and no log line.
- **node:**
  - Each tool against the pure edit functions.
  - The coverage test (§6.3).
  - Access filtering.
  - The markdown renderer (no HTML, no script, no attribute injection).
  - Transcript pairing of calls and results.
  - The Undo-turn condition.
- **UI:** looked at by the owner before it lands.

## 10. Delivery

One feature, one PR (`assistant-chat`), built test-first on its own branch in
this order: server (tables, configuration, adapters, admin), sessions and the
turn loop, the page's tools, the panel. The owner looks at the panel before it
lands.
