# Roadmap

Remaining work for effractor, as a DAG. The approved successor design is linked
below; the specs of what is built were removed once built (2026-09-25) and are
read from history (`docs/HANDOFF.md` says how). How work lands is in
`CONTRIBUTING.md`.

Approved successor spec:
[`2026-09-21-lecture-workflow-design.md`](docs/superpowers/specs/2026-09-21-lecture-workflow-design.md).
The [implementation plan](docs/superpowers/plans/2026-09-21-lecture-workflow.md)
was reviewed by the owner on 2026-09-22, who chose native in-session execution:
one feature branch per task, a pause for the owner at each task boundary. The
items below are its delivery decomposition. Plan tasks 1
(`architecture-document`), 2 (`component-generation`), 3
(`sequential-simulation`), 4 (`architecture-editor`), 5
(`architecture-links`), 6 (`attack-graph-inspection`) and 7
(`defense-comparison`, with an attacker speed per scenario) are done;
lecture-workflow = 8 remains. `library-extension`, added by the owner on
2026-09-23, is done, so comparisons cover its defenses from the start.
"securiCAD parity" in the owner's words means `lecture-workflow`, not the later
`mal-securicad-compatibility`.

**Rules.** `needs` = item ids that must be gone first. `cost` / `benefit` are
1–5. An item is *ready* when everything it needs has been deleted; pick the
ready item with the best benefit/cost. Delete an item in the PR that completes
it. Every item is built test-first. Its "done when" is checked in CI where it can
be; what a page looks like and how it handles is checked by eye — there is no
headless-browser harness, by decision.

**Global constraints.** Rust edition 2024 · `core`/`mal`/`format`/`solver` have
no I/O and compile to `wasm32-unknown-unknown` · all transcendental maths via
`libm` · RNG ChaCha8, 4096-sample chunks, stream = chunk index · no panics on
user input · no third-party origins, no telemetry · vanilla CSS + JS, no bundler
· unknown YAML keys are errors (except `x-`) · numerics monospace right-aligned.

---

## Successor direction

Owner decision, 2026-09-21: the first successor milestone reproduces the
lecture workflow with a small, transparent component library. Compatibility
with existing securiCAD/MAL models and libraries follows that milestone.
Effractor's purpose remains production security architecture analysis; the
lecture supplies a concrete acceptance scenario.

Reference: the owner's `extract.pdf`, printed pp. 112–134, sections 5.3–5.5.
The scenario has client, server and administration networks, a router/firewall,
a workstation running an SSH client, an SSH server, accounts/credentials and
permitted data flows. Start with the workstation already compromised; generate
routes to server compromise and compare defenses such as patching, credential
protection and network permissions. Keep the exercise in course documentation
and test fixtures; the app still opens an empty document for a new user.

The lecture milestone is decomposed into branch-sized work by the approved design. The
existing tree profiles, local-first operation and native/wasm determinism remain
requirements. The v1 spec's assumption that generated attack graphs need no
document-model changes is superseded: generated graphs use explicit
prerequisite-dependent attack steps with accumulated durations.

### lecture-workflow — Deliver the first successor milestone
needs: —            cost: 2   benefit: 5
Build the lecture's architecture → generated attack graph → simulation → defense
comparison workflow using a small, transparent component library. Cover
networks/zones, routers/firewalls, hosts, applications/services,
accounts/credentials and data flows, with explicit hosting, communication,
administration and privilege relationships. Generated steps expose their
originating rules and editable assumptions. Done when the owner can build the
reference scenario in the browser, choose the compromised workstation and
server target, inspect generated routes and compromise probabilities over time,
and see how defense changes affect results and remaining alternatives. Verify
sequential timing and graph generation with automated fixtures, native/wasm
agreement in CI, and the workflow by the owner's browser walkthrough. Numerical
agreement with the lecture's screenshots is not an acceptance criterion without
the underlying rules and calibrated inputs.

## Compatibility after the lecture milestone

### mal-securicad-compatibility — Reuse existing models and libraries
needs: lecture-workflow            cost: 5   benefit: 4
Prioritize compatibility with existing securiCAD/MAL models and libraries after
the first successor milestone. Start from representative files and document
supported versions and constructs, distinguishing MAL language libraries,
instance models and securiCAD export formats. Define and implement the supported
import subset without silently changing its meaning. Done when documented
fixtures import with their component/asset types, associations, defenses,
attacker entry points and TTC semantics preserved, unsupported constructs
produce actionable diagnostics, and compatibility tests cover the declared
subset. Broader format coverage and numerical equivalence require their own
evidence; parsing TTC expressions alone does not establish MAL compatibility.

## Accounts on the self-hosted server

Owner decision, 2026-09-26: the self-hosted server diverges from the Pages
build with opt-in accounts, stored documents and sharing with people. Design:
[`2026-09-26-accounts-design.md`](docs/superpowers/specs/2026-09-26-accounts-design.md)
(§12 is this decomposition). The lecture milestone and accounts are independent.

### install-systemd — The installer offers a systemd service
needs: —            cost: 1   benefit: 3
`install.sh` asks whether to install a systemd service (user unit when not
root, hardened system unit when root), reading the answer from `/dev/tty`,
defaulting to no without a terminal, `EFFRACTOR_SYSTEMD` answering without
asking. Never turns accounts on. Done when `scripts/install.test.sh` covers
yes, no, no terminal, no `systemctl`, root and not root (spec §13).

### accounts-core — Users, password login, sessions, CLI
needs: —            cost: 4   benefit: 4
The `effractor-accounts` crate with its schema and migrations, `--accounts`,
the `effractor user` CLI, password login, sessions, the Origin guard,
`/api/me`, the bar's *local only · Log in* and the login dialog (spec §2–§4,
§7.1–§7.3, §9.1). Done when the crate and server tests of spec §11 for these
parts pass, accounts off leaves the shell and routes as before, and the owner
has looked at the bar and dialog.

### stored-documents — Documents and folders on the server
needs: accounts-core            cost: 4   benefit: 5
Documents and folders, autosave with the version check and conflict notice,
the left panel's *Model · Documents* tab with search, recent, reveal, soft
delete with Undo and the 7-day purge, the offer to save the page's work at
login (spec §5 owner rows, §6, §9.2). Done when the §11 tests for these pass
and the owner finds documents easily in the preview.

### sharing-people — Share documents and folders with users and groups
needs: stored-documents            cost: 3   benefit: 4
Shares to users and groups with viewer/editor, folder shares covering their
contents, the strongest role winning, *Shared with me*, the share dialog's
people section (spec §5, §9.3). Done when the permission table test passes and
the owner has shared a folder with a group in the preview.

### administration — Users and groups in the GUI
needs: accounts-core            cost: 3   benefit: 4
The administration dialog: users (create, disable, delete, reset password,
promote), groups (members, roles, `admins_may_create_users`), group admins'
limited view (spec §5, §8, §9.4). Done when the §11 tests for these pass and
the owner has looked.

### passkeys — Log in with a passkey
needs: accounts-core            cost: 3   benefit: 3
`--public-url`, passkey registration in the account dialog for every account,
usernameless login (spec §7.1, §7.4). Done when registration and login pass
with webauthn-rs's software authenticator and the owner has logged in with one.

### oidc — Log in with the operator's OIDC issuer
needs: accounts-core            cost: 3   benefit: 4
Authorization code with PKCE, provisioning in no group, `name-2` on a taken
name, linking from the account dialog, never linking by name or email (spec
§7.1–§7.2). Done when the flow passes against an in-test fake issuer and the
owner has logged in through Nextcloud.

### e2e-vault — Evaluate end-to-end encrypted storage
needs: stored-documents            cost: 5   benefit: 2
Owner, 2026-09-26: stored documents are plaintext at rest for now; evaluate an
end-to-end encrypted vault (per-user keys, wrapped keys for group shares, what
OIDC-only users and password resets would mean). Done when a design is
approved or the idea is dropped.

### audit-log — Who did what, for admins
needs: administration            cost: 2   benefit: 2
Logins, shares and administrative actions recorded and shown to admins. Needs a
design first.

### api-tokens — A scripted API for users
needs: stored-documents            cost: 3   benefit: 2
Per-user tokens for scripts (e.g. pushing an nmap import into one's
documents). The routes the page uses are not this interface. Needs a design
first.
