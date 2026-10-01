# Roadmap

Remaining work for effractor, as a DAG. The specs of what is built are removed
once built and read from history (`docs/HANDOFF.md` says how). How work lands
is in `CONTRIBUTING.md`.

The lecture milestone (`lecture-workflow`, plan tasks 1–8) closed on
2026-09-30; its spec and plan are read from history (`docs/HANDOFF.md` says
how) and its acceptance is `docs/LECTURE-ACCEPTANCE.md`. "securiCAD parity"
in the owner's words meant that milestone, not the later
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

The existing tree profiles, local-first operation and native/wasm determinism
remain requirements. Generated graphs use explicit prerequisite-dependent
attack steps with accumulated durations.

### securicad-extract — What the lecture extract draws that the library lacks
needs: —            cost: 4   benefit: 5
Built and released (2026-10-01; `docs/HANDOFF.md`, design
[`2026-09-30-securicad-extract-design.md`](docs/superpowers/specs/2026-09-30-securicad-extract-design.md)).
Outstanding: the owner's walk along the extract, 5.3–5.5 figure by figure, on
a preview, recorded in `docs/LECTURE-ACCEPTANCE.md`. Plan task D4 (ARP cache
poisoning, static ARP tables, a flow's `encrypted`/`carries`) was not built
and waits for the owner's word.

## Compatibility after the lecture milestone

### mal-securicad-compatibility — Reuse existing models and libraries
needs: —            cost: 5   benefit: 4
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
build with opt-in accounts, stored documents and sharing with people — built
(one PR, `accounts`); its design and plan are deleted and read from history
(`docs/HANDOFF.md` says how). What follows are the later items the design
named.

### audit-log — Who did what, for admins
needs: —            cost: 2   benefit: 2
Logins, shares and administrative actions recorded and shown to admins. Needs a
design first.

### api-tokens — A scripted API for users
needs: —            cost: 3   benefit: 2
Per-user tokens for scripts (e.g. pushing an nmap import into one's
documents). The routes the page uses are not this interface. Needs a design
first.

## Scanners beside nmap

Owner decision, 2026-09-27: other open-source scanners come in the way nmap
does — **one application per tool** (`tool: <name>`), with the reading shared
underneath: each format has its own reader into the neutral scan nmap.js
already plans from (hosts, addresses, open ports, products, OS guess, device
class, findings with CVEs); planning, the preview and adding stay one. Only
open-source scanners for now. General guideline for every import object:
the dialog that creates or fills it always guides explicitly, as nmap's does
(what to run, what to paste, what will be added), and what it adds is
deduplicated against the drawing by best effort (by address, then by name and
product), never drawn twice. Files with `tool: nmap` keep opening unchanged.

