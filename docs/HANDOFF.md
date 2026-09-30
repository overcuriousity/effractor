# Handoff

For the next session — whoever or whatever picks it up; everything needed is in
the repository, nothing lives in an agent's private notes. Read `CONTRIBUTING.md`, `ROADMAP.md` and the design still to be built
(`docs/superpowers/specs/`, when there is one) first — built designs are read from history, see
*Repository cleanup* below; this file
says where things stand, how the owner wants the UI to be, and what bit today.

## Continuation — what the extract draws: operating systems, ASLR, DEP (2026-09-30)

Branch B, `host-products` (plan tasks B1–B5), pushed, **not landed**: all
checks green at its tip, a fresh review's 3 critical and 4 important
findings fixed with tests, the owner's look deferred to the autonomous
session that finishes the milestone. Ledger: `.superpowers/sdd/2026-09-30-securicad-extract/progress.md`
(git-ignored, on this machine) has every ruling and deferred minor.

- **Several switches per kind:** `EntityKind::defenses() -> &[Defense]`;
  catalog `entities[].defenses: [...]` (was `defense`).
- **Optional slots and switches** (spec §5.1, widened): `Slot::optional(kind)`
  and `Defense::optional(kind)`. Absent from a file: an optional slot's step
  is not drawn; an optional switch is off. Neither is filled in on read nor
  written on save, so existing files keep text, graph and numbers (verified
  on all 33 fixtures and examples). Catalog: `entities[].optional`,
  `entities[].optional_defenses`. The page (`architecture-edit`
  `setParameter/setDefense(…, spec)`, `architecture-view.slotRows/defenseRows`)
  and the assistant take the kind's spec; rows show only where they can
  change something and say what absence means there.
- **Products on hosts and applications** (§3.3): `instance-of` from host or
  application; `host.reachable` from the services it runs,
  `application.reachable` from content in front of it (the spec's "own flow
  connected" is circular), both only for an instance of a product; rules
  `host-reachable`, `application-reachable`, `host-deploy-exploit`,
  `application-deploy-exploit` (optional `deploy-exploit` gates them).
  Fixture `crates/effractor-components/tests/fixtures/architectures/extract-products.yaml`.
- **ASLR and DEP** (§4): optional host switches; `Binding::Hardened {owner,
  base, host}` reads `deploy-exploit-aslr` (ASLR on) else `deploy-exploit-dep`
  (DEP on), used only where the file or a scenario says ASLR or DEP of that
  host — elsewhere the plain binding, so frozen images are byte-identical.
- The lecture's graph and three solves are frozen in
  `crates/effractor-solver/tests/snapshots/lecture-graph.json`; Branch E
  must keep the old lecture file as a test fixture when it rebuilds the
  course file.
- Deferred minors: a host with ASLR on and only `deploy-exploit-aslr` draws
  no host step; Compare's "as written" treats an unset optional switch as
  unknown; nmap's OS guess does not yet become an `instance-of`.

Next: land Branch B, then Branch C `sensors` (plan C1–C4), then plan and
build D2 onward and E (the plan stops after Task D1).

## Continuation — what the extract draws: access control (2026-09-30)

Roadmap `securicad-extract`, spec
`docs/superpowers/specs/2026-09-30-securicad-extract-design.md`, plan
`docs/superpowers/plans/2026-09-30-securicad-extract.md` (branches A–E; D2
onward and E are planned before Branch D starts). Owner: native execution,
one branch per plan branch, each looked at before it lands. Branch A,
`access-control`, looked at and approved 2026-09-30.

- **Access control** (extract Fig. 5.18, 5.19): kind `access-control`, link
  `controls-access` (host | router → it, one each way, as `filters`). A
  `grants` may name it; that is a grant on its machine (generation resolves
  it; provenance names both links). A router's access control is granted
  admin only; a grant to one nothing controls is unfinished; one grant per
  account and machine however it is said (`cardinality`). Existing files
  generate unchanged (tests freeze it).
- **Containment** (Fig. 5.20, 5.21): no new field. Dragging a component onto
  another already clusters them, target first; the cluster's inspector lists
  its members with *Take out*. Spec §6 says so.
- **Words:** `effractorWords.kind(kind)` names a kind in words ("Access
  control"); the page never shows a hyphenated kind id. The assistant's tool
  lists are held to the catalog by a test.
- A fresh review: 0 critical, 4 important (all fixed with tests), 6 minor
  (4 fixed, 2 kept with reasons in the plan's ledger).
- Dependabot: its six PRs of 2026-09-27 were already folded into master and
  closed; this landing adds the four patch releases `cargo update` found.

Next: Branch B, `host-products` (plan tasks B1–B6).

## Continuation — the lecture milestone is closed (2026-09-29/30)

Plan Task 8 (`lecture-workflow`), branch `lecture-acceptance`, landed as
`ac3705a` (#178, released `v0.1.0+ac3705a`), then closed by this
documentation change. The spec
`docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` and the plan
`docs/superpowers/plans/2026-09-21-lecture-workflow.md` are deleted with it;
`git log --diff-filter=D --format=%h -1 -- <path>` names the deleting commit
and `git show <that>^:<path>` prints either. Code comments cite them as
"lecture spec §…" / "spec §…" in `crates/effractor-components`,
`crates/effractor-solver` and the architecture JS. `docs/superpowers/` is
empty now and gone; it comes back with the next design.

- **Course files.** `docs/course/lecture-unknown.yaml` moved there from
  `crates/effractor-components/tests/fixtures/` (one copy; the tests, the
  agreement check and `graph-fixtures.js` read it from the course folder).
  `docs/course/lecture-partial-defenses.yaml` is new: patched discovery
  `Exponential(mean 100)`, protected extraction `Exponential(mean 50)`.
- **Course text.** `docs/course/README.md` has the exercise: what is drawn,
  building it from empty (the defence switches start *Unknown* and must be
  set *Off*; scenarios are made in Compare with +; the baseline comes back
  by choosing *nothing · baseline only*, not by undo), every time with its
  step, what to read from it, what it does not say. Its table of numbers is
  held by `crates/effractor-solver/tests/course_files.rs`
  (`the_course_text_quotes_what_the_solver_says`): a change that moves one
  fails there, and the table is then rewritten from the solver, not the test
  loosened. The two variant files are held to the exercise's exact text with
  their replacements. The course files are compiled into that test
  (`include_str!`), because the solver's tests also run under wasmtime, which
  sees no directory above the crate.
- **Performance.** `node scripts/check-graph-performance.js [file]
  [scenario]` after `build-wasm.sh`; not in CI. Measurements are in
  `docs/LECTURE-ACCEPTANCE.md`.
- **The owner's walkthrough (2026-09-30)** went along the extract itself,
  not the spec's five steps, and found that 5.3.3 does not rebuild as
  drawn. The acceptance record has the figure-by-figure comparison. Owner's
  ruling: the differences are the small library the design chose; close as
  scoped, record the gaps, open `host-products` (a host or an application as
  an instance of a product; a host defence or two). The larger vocabulary
  (IDS/IPS, escalation, ARP, physical access, views) is
  `mal-securicad-compatibility`'s.
- **Left as is:** the spec's "restore the baseline with undo" — a scenario
  choice is workspace state (Task 7's design); the owner did not ask for a
  change. A fresh review's one deferred minor: no `npm test` runs the
  performance measurement against the real wasm module.

## Roadmap pruned (2026-09-29)

Owner, 2026-09-29: two items were dropped, not built.

- `e2e-vault` — not needed any more; stored documents stay plaintext at rest.
- `firewall-denies` — a service is reached only along a drawn flow
  (`service-reachable` needs an inbound `flow.connected`; membership of a
  network implies no flow permission), so a denial toward a port nothing is
  drawn to could not change a route or a number. The nmap preview keeps
  saying it (`nmap-changes.js`, *what is blocked with nothing drawn to say
  it on*).

Left after that day: `lecture-workflow` (closed 2026-09-30), then
`mal-securicad-compatibility`; `audit-log` and `api-tokens`, each needing a
design first.

## Continuation — scanners that build on each other (2026-09-29)

Roadmap `scan-workflow`, built from the spec
`2026-09-28-scan-workflow-design.md` (its §12 amends the sections it names)
and its plan `docs/superpowers/plans/2026-09-28-scan-workflow.md`, whose
code travelled as ten patches beside it; all deleted with this landing.
`git log --diff-filter=D --format=%h -1 --
docs/superpowers/specs/2026-09-28-scan-workflow-design.md` names the
deleting commit, and `git show <that>^:<path>` prints any of them. Code
comments cite the spec as "scan workflow spec §…". Five parts, each a
branch and a PR, built in the session (native execution), each read by a
fresh reviewer and looked at by the owner before it landed: `host-asked`
(#173), `scan-targets` (#174), `nmap-options` (#175), `nmap-purposes`
(#176), `scan-hint`.

- **What a host was asked** (`asked` in the file, beside `seen`, in place:
  `ports`, `products`, `route`, `connections`, each a quoted day; refused
  off hosts, with another key, or without a day). nmap notes what it says
  it ran (`asksOf` in `nmap-read.js`): `ports` only for a scan of 20 TCP
  ports or more that can find one open, `products` where versions were
  asked (`-sV`, `-sCV`, `-A`), `route` with `--traceroute`; several
  pasted results of different scans note nothing. masscan notes `ports`.
  nuclei writes only what it found, so the ticked templates and the targets
  stand in: a ticked row in its preview only (*Notes n hosts as asked …*).
  Greenbone and nuclei's checks note nothing. Generation never reads it.
- **Targets from the drawing** (`scan-targets.js`, pure): one *Targets* row
  in every scanner's dialog, the app's own nested menu (`app.showMenu(…,
  within)`, a menu inside a modal dialog; Esc closes the menu only): each
  drawn network with a range, and in it *the whole range*, *drawn hosts
  only*, *hosts without ports*, *not seen since …*. The range field shows
  the words and stays editable (*typed by hand*); Greenbone gets them as a
  comma list with *Copy*. **Owner, 2026-09-29: targets are chosen in the
  dialog only** — the spec's *the selection* (select hosts, then open the
  scanner) "makes no sense" and was dropped; the pure `{kind:
  "selection"}` choice stays for the bulb's host lists.
- **nmap's options** (`nmap-command.js`): 19 blocks in four groups
  (*Finding hosts*, *Ports*, *Depth*, *Pace*), one open at a time, a
  closed one saying what is set in it. Typed texts (resolver, what is left
  out, interface, rate) are held to their shape or refused, kept for the
  session only. ACK, window, FIN, NULL and Xmas scans are read as the ACK
  scan is, for the firewall check, and draw no port. A UDP scan asks for
  root however its ports were named; the TCP scan beside it is then SYN
  unless a connect scan was chosen by hand. Never offered, held over every
  recipe and choice: `-D -S --spoof-mac -f --mtu --data-length
  --source-port -g --badsum -sI -b --proxies -T0 -T1 --randomize-hosts`.
- **nmap's purposes**: *Is it still so*, *Who announces itself*, *UDP
  services*, *Routers by SNMP*, *Management interfaces*, *VPN endpoints*.
  `nmap-devices.js` (pure) reads the router a DHCP answer names (one elem,
  or several as nmap's nested table) and SNMP's interfaces (up, IPv4, of a
  network; loopback, link-local, 0.0.0.0/8, multicast, /31, /32 left out).
  An import adds a device's interface addresses and networks (`new:<cidr>`
  rows, routes included) and preselects *router* (*gateway by DHCP*, *3
  interfaces by SNMP*); *managed from* is offered for a router with a
  management port open to the scanner. **Owner, 2026-09-29:**
  `broadcast-dhcp-discover` stays, with `--script-args
  broadcast-dhcp-discover.mac=EE:FF:AC:70:00:00` — a fixed, locally
  administered client address inside the request, so a DHCP server's log
  tells the scan was effractor's (the packet still leaves from the
  scanner's own address). IPv4 only.
- **The bulb** (`scan-gaps.js`, pure; `scan-hint-ui.js` the page's part;
  `nmap-ui.js` gives it `effractorNmapUi {open, create}`): names the first
  step the drawing lacks — a scanner; a network no scan saw a host on
  (masscan past 1,024 addresses, its IPv4 ranges only); what runs on drawn
  hosts; a way to a network no drawn router joins; how services connect
  (nuclei). It never names Greenbone or any check. Right click: the other
  steps, *Say nothing about this*, *Say it again*; × silences on this
  browser (`effractor.hint.silenced`; the old `effractor.hint.nmap` reads
  as `scanner` silenced). Silenced whole, the canvas's menu offers *Say
  what to scan next*. It reads the associations once per answer: it is
  answered on every change of the page (2,000 hosts: about 20 ms).
- **What the owner looked at:** every part, in a preview. Part 3 landed on
  "an edge case, proceed" after one sighting of no command and no reason,
  not reproduced (every recipe pair under every pair of block choices, and
  half-typed fields, give a command or a reason).
- **Deferred minors of the reviews:** hand-written `x-` keys inside
  `asked` are dropped when an import rewrites the map; a nuclei host whose
  answer was left out as a conflict is still noted as asked; the targets
  menu is quadratic in associations (about 0.4 s at 1,000 hosts, on
  opening only); each keystroke in the range redraws nmap's Adjust
  blocks; *typed by hand* is said for a scanner on several or no networks,
  in Greenbone too; a closed *Ports* group does not say *ACK scan*;
  version effort and OS guess fall back to nmap's without a word when
  Depth does not ask for them; the firewall recipe's ACK tick beside a
  chosen ACK scan gives two identical runs; the *Is it still so* tile
  shows no root tag where the drawn ports need it (the command's tag does).
- **Open:** the fixtures of *Who announces itself* and *Routers by SNMP*
  (`scripts/fixtures/nmap/announced.xml`, `snmp.xml`) are hand-written
  from the scripts' source; the owner's recordings are to replace them
  (the commands need root and a real LAN and router). A network where
  nobody answered cannot be imported, so the bulb says it again until
  silenced. A large nuclei result draws very many hosts (owner: "we will
  contain this later").

## Continuation — nuclei templates of effractor's own (2026-09-28)

Roadmap `nuclei-templates`, built from the spec
`2026-09-28-nuclei-templates-design.md` and its plan
`docs/superpowers/plans/2026-09-28-nuclei-templates.md`, both deleted with
this landing. `git log --diff-filter=D --format=%h -1 --
docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` names the
deleting commit, and `git show <that>^:<path>` prints either. Code comments
cite the spec as "nuclei templates spec §…". Five parts, each a branch and a
PR: `host-names`, `nuclei-own-templates`, `nuclei-identify`,
`nuclei-connect`, `nuclei-dialog`.

- **The table and the templates.** `nuclei-templates.js` (pure) holds
  everything a template can answer (`ANSWERS`: what it is, the product's
  name, how it is found) and writes the five templates from it (`text`);
  `assets/nuclei/*.yaml` are that text, held equal by a test
  (`node scripts/dev/nuclei-templates-write.js` writes them: change the
  table, not the files). The rules of spec §2.1 are held by
  `scripts/nuclei-templates.test.js`: no backslash, no single quote,
  printable ASCII; `tcp`, `http`, `ssl`, `dns` only; they only read; every
  extractor named and in the table. 49 applications; Prometheus, QNAP QTS
  and RabbitMQ were struck (known by their title alone). An application
  that names itself in its `Server` header has that word in the table
  (`server`), so it is one piece and not an application behind itself.
- **The command** (`T.targets`, `T.command`): the drawn hosts the range
  covers, each with 32 usual ports and the ports drawn on it; what is typed
  by hand is asked too; a range with nothing drawn is asked itself, up to
  1,024 addresses. A word of the range is an address as nuclei reads
  one, a range of them, or a name, with a port or in a URL; anything else
  is refused, since nuclei would look it up at public resolvers
  (`10.0.1.300`, `010.0.1.9`, `fe80::1%eth0`). A port typed by hand is
  asked. One paste writes the templates (`echo '…' >`), the
  targets (`awk`, one line whatever the number of hosts) and runs nuclei;
  the names *How it connects* asks go to `names.txt` and a second run with
  the DNS template alone, so a name that points outside is never sent a
  request. The page shows it short and copies it whole (about 17 KB).
- **Reading** (`T.read`, folded in `nuclei.js`): records whose template id
  begins with `effractor-` are facts about a port, a host or a name, not
  findings; one paste may hold them beside nuclei's own. Host and port come
  from `matched-at`. An extractor the table does not hold is counted and
  said (*n answers this version does not know*); a value without its shape
  is refused and counted; neither is drawn. What a port said is said where
  it named nothing. What a port comes to does not depend on the order of
  the answers: its facts are put in one order first (`settle`), then the
  first application of the table, its own server or the one that names
  its version, the sign-on that names its product.
- **Products** (`nmap-products.js`, pure): one comparison for every
  scanner, by name and by the first word of the version, whatever their
  case; a year or an edition before a version with a dot belongs to the
  name (`Microsoft SQL Server 2019 15.00.2000.00`). A product keeps the
  label of whoever named it first. An unnamed
  product takes the name, one without a version the version; what differs
  is said (*drawn: … · nuclei: …*) and not changed. A product that other
  services are instances of, drawn or of the same import, keeps its name
  and one of the new name is made. Naming is decided once, for the
  summary and for apply, whatever the order of the hosts (`naming` in
  `nmap-plan.js`); what was written on a product that goes (a finding,
  a note, the author's words) is kept on the one its service takes
  (`carry`).
- **Applications:** the server is the service on the port; the application
  a service of its own on the same host, at `privilege: unknown`, which the
  server passes on to by a flow of protocol `http`. On a later import it is
  the service on the host that a flow from the port's service reaches and
  whose product is the application's, else the one reached by `http`; a
  database the server talks to is none (this narrows spec §5.4, from the
  review).
- **Names on hosts:** `names` in the file, beside `addresses`, in place;
  every scanner's names are kept, ticked. A scanned host without an address
  is the one drawn host that keeps its name, and is folded into the row
  that already is that host. The wasm module must be rebuilt for a page to
  read the key.
- **Connections** (`nmap-connect.js`, pure): a login (a stand-in account
  the service accepts), single sign-on (one account per sign-on and the
  sign-on's host, by name, without an address, outside ones too), a
  management page (administration from the scanner's network; an account
  with admin rights on the machine or its router), what a name points to
  (the name on the host it points to; who stands in front; a host nobody
  drew, several names on one address being one host; outside is only
  said). Every row unticked at first but a name kept on the host it points
  to. A login's and a management page's account is its service's own and
  never joined by its label: where `pfSense accounts` is taken, the next
  is `pfSense accounts on fw2`; only a sign-on's account is shared (from
  the review: a shared account is a path in the attack graph, and nothing
  was seen that says two machines share theirs). A row whose host, port or
  application is left out is neither counted, said nor applied
  (`Cn.hangs`, `N.connectionThere`).
- **The lab and the fixtures:** `scripts/dev/nuclei-lab.py` starts
  throwaway servers on 127.0.0.1 that say what
  `scripts/fixtures/nuclei/lab.json` holds (69 hosts: the twelve the tests
  speak of by address, sign-ons from 10.0.2.70, 44 applications from
  10.0.2.100, and at 10.0.2.63 and 10.0.2.81 a page of links and a
  redirect that only mention others and must name nothing; every page
  written by hand from the table's trace) and
  records `identify.jsonl` and `connect.jsonl`, **recorded with nuclei
  3.11.0**. CI has no nuclei: a test holds that every named extractor has a
  record. `imported-identify.doc.json` and `imported-connect.doc.json` are
  pinned by Node, `tests/json.rs` and `check-nmap-wasm.js`.
- **Probed with nuclei 3.11.0** (spec §12, all on 127.0.0.1): unsigned
  `tcp`, `http`, `ssl` and `dns` templates run as they are, one record per
  named extractor; one file holding three protocols answers with one, so
  the templates are separate files; a target given as `host:port` is asked
  by all templates on that port; for a port a template names in a path the
  record's `port` says 80 and `matched-at` the real one; closed ports do
  not make nuclei give up on a host; `-preflight-portscan` dropped every
  web and certificate answer; with `-resolvers` naming one resolver the DNS
  template asked that one only.
- **Owner decisions (2026-09-28):** templates before `scan-workflow`; new
  ports are drawn; server and application as two pieces ("we have
  clustering for that"); the command writes the templates, nothing is
  downloaded; about fifty applications, corporate ones included; names are
  kept on the host; *connect* stays in this item; a login is offered, not
  ticked; one shared account per sign-on and the sign-on's host; a
  management page's two rows unticked; the name on the host it points to,
  the pass-on offered. With the plan: `targets.txt` by `awk`; the page
  fetches no template; *Names* a field of its own in the inspector; two
  modules more; 49 applications. After the reviews: the command's size is
  fine pasted into fish ("the user sees it before executing"); a login's
  account is its service's own ("seems logical"); the narrowed rule for
  the application of a port ("fine, KISS but correct").
- **Looked at by the owner** (2026-09-28): the *Names* field and the
  import's line *keeps the name …* in the 8081 preview, and the dialog with
  everything in the 8082 preview ("both deployments look good,
  approved"). **Landed unseen:** parts 2 to 4 (nothing of them shows
  without the dialog). What the reviews changed afterwards in what the
  page says was told to the owner in plain words before it landed, and
  answered; the owner did not say they looked at it in the preview.
- **Reviews:** a fresh reviewer read each part; none found anything
  critical, twenty findings that mattered were fixed with tests that
  failed first, most of them in the plan's own code.
- **Deferred minors** of the fresh reviews, none fixed:
  Part 1: a name the reader cut at 120 characters is kept as a name the
  host does not bear; lower-casing turns a non-ASCII letter (Kelvin sign)
  into an ASCII one before the name is tested; the agent's list items are
  joined with a space and split again: names ["my server"] writes two names
  (addresses do the same since before); the 253-character limit is tested by
  cases that fail for another reason, in both languages; no test holds the
  Rust and the JavaScript rule of a name together; no test for ticks without
  `names`, nor for the name match beside takenBy, a known row, a chosen
  "new".
  Part 2: no ceiling on drawn hosts; past about 9,700 the awk argument
  passes the kernel's limit and nuclei still runs on an empty list; one IPv6
  host under several spellings is asked several times; the 1,024 check
  counts before removing duplicates; a range with nothing drawn beside one
  that has something is skipped without a note; `said` counts drawn hosts
  only where some were typed beside them; a prefix that is too long (/33)
  gets the message of an undrawn range; several version patterns are
  identical or fire on prose; part 3 takes a version only with its
  application; the recorder's port run does not name the lab's resolver
  though its docstring says so; the recorder ignores nuclei's exit status;
  spec §9 rows of nuclei-templates.js and nmap-ui.js are stale (the spec is
  deleted with part 5); targets(null, …) throws; no test sends a hostile
  document or the odd range characters through the three shells.
  Part 3: an answer without a usable place (port 0, no host) is dropped
  without being counted; a Server word "unidentified" draws a product every
  later import takes for unnamed; an author's product beginning
  "Unidentified …" is offered a rename; one application on two ports of a
  host is drawn twice; an application whose flow the author deleted is drawn
  again; a drawn service without any product is told nothing; the host is
  read from `host` before `matched-at` (spec §4 says matched-at first; the
  port follows the spec); cleanName lets bidi controls through (older
  helper); tests of hostile values cover extracted-results only; "Exchange
  Server 2019 CU12" and "CU14", "Windows 10" and "Windows 10 Pro" are still
  one product by the comparison.
  Part 4: a sign-on's account the author renamed is offered again; a
  pass-on whose front service this import made is drawn again where the name
  row was unticked; two drawn hosts keep the sign-on's name: a third is
  drawn; the sentence counts sign-ons per row, not per account; a name
  pointing to loopback or link-local is offered as a host; a management page
  is known by the exact product name only (nmap's "VMware vCenter Server
  8.0" is none); test gaps named by the reviewer beyond the fixes' own
  tests.
  Part 5: ticking one group unticks the other without the line that says
  why (spec §10); the headings' hints may be that line — the owner's to say;
  Nu.combine(['identify','nope']) answers the line about nuclei's checks
  though nothing of nuclei's is ticked; a recipe list that is no array
  throws in nuclei.js's wrappers; Show all outlives a change of recipes
  within one open dialog; rows disabled by an unticked host or port do not
  say why; ticking a port that rebuilds the preview loses the keyboard's
  place, as host ticks do.
- **Open:** a real result of the owner's network; the list of
  applications, for the owner to strike and add.

## Continuation — nuclei beside nmap (2026-09-28)

Roadmap `nuclei-import`, built from the roadmap's text and a short design
the owner approved in the session; no spec or plan was written. A fourth
application, `tool: nuclei` (core `Tool::Nuclei`), read into the scan
`nmap-plan.js` plans from.

- **`nuclei.js`** reads nuclei's JSON lines (`-jsonl`) and its export file
  (a JSON list); what nuclei says between the lines is skipped, a cut-off
  line is said. A host is known by `ip`, else by its name alone (matched by
  name against the drawing; new, it is drawn without an address). The port
  is nuclei's `port`, else the URL's, else the scheme's; always TCP; a DNS
  result has none. Severity low and above is a finding (`nuclei: High 7.5,
  CVE-… (title).`), once per port, on the host where there is no port
  (shown *not applied*); `info` and `unknown` only say the port is open, and
  the preview counts them. nuclei draws no product and no OS. A port is
  named by nmap's table only: named by the scheme, two ports called "http"
  would share one unidentified product, and a finding on one would mark the
  other's.
- **`nuclei-command.js`** is the library of commands (owner: "a nuclei
  reference command library for me, too (like with nmap)"): thirteen
  recipes that are nuclei's tags, ticked into one list; *Everything
  standard*, *Fit the checks to the site* (`-automatic-scan`) and *Fuzz the
  parameters* (`-dast`, which runs the fuzzing checks and no others) go
  alone; eighteen *Adjust* blocks, the first choice of each nuclei's own.
  A choice may need a typed text (`field`): the interactsh server, the
  login header; they are kept for the session, never in the file. A block
  may belong to one recipe (`only`). Every offered command was run through
  nuclei 3.11.0 with `-tl` (it lists the templates and scans nothing).
- **Nothing offered asks a third party or hides a scan**
  (`scripts/nuclei-command.test.js` holds both): always
  `-disable-update-check`; `-no-interactsh` unless the user names an
  interactsh server of their own, and nuclei's public ones are refused by
  name; no upload, no search engines, no AI prompt, no template from a URL,
  no proxy, no source address, no TLS impersonation. **nuclei asks public
  resolvers** (8.8.8.8, 8.8.4.4, 1.1.1.1, 1.0.0.1) for every name, and
  `-system-resolvers` does not stop it (traced in a network namespace
  without a network); only a list does, and `-resolvers` takes a file. So a
  range with a name, or the DNS protocol chosen, writes this machine's
  resolvers first (`awk … /etc/resolv.conf > resolvers.txt; nuclei …
  -resolvers resolvers.txt`), and a range of addresses leaves the DNS
  checks out (`-exclude-type dns`).
- **Every command the page offers runs as it stands in fish, bash and sh**
  (owner, 2026-09-28; the owner's shell is fish).
  `scripts/shell-commands.test.js` runs each command of nmap, masscan and
  nuclei in each shell with stand-ins for the programs and compares the
  arguments they were handed; CI installs fish for it. What keeps them so:
  single quotes only, no backslash anywhere, nothing a shell reads as its
  own outside the quotes, `;` and one `>` as the only shell syntax. A new
  command goes into that test's `commands()`.
- **Dialog:** `nmap-ui.js` `library()` gives `recipes()` and `blocks()` the
  open scanner's commands, state and elements; nuclei's step 1 is
  `#nmap-step-nuclei`.
- **Fixtures:** `scripts/fixtures/nuclei/lab.jsonl` is what nuclei 3.11.0
  wrote against throwaway servers on 127.0.0.1 (the owner allowed exactly
  that), with addresses, names, ports, times and the home directory
  rewritten; `imported.doc.json` is pinned by Node, `tests/json.rs` and
  `check-nmap-wasm.js`. nuclei writes CVE and CWE ids in lower case, and
  waits on stdin when it is a pipe (`< /dev/null` in a script).
- **Owner, 2026-09-28, for what follows:** effractor draws network diagrams
  and attack vectors and is to replace securiCAD; it is no vulnerability
  manager. The scanners are to build on each other in a workflow the page
  quietly leads through, and effractor is to ship nuclei templates of its
  own. Both are on the roadmap (`scan-workflow`, `nuclei-templates`) and
  need a design with the owner first.
- **Open:** a real nuclei result of the owner's; whether the first recipe
  ticked (*Exploited in the wild*) is the right one.

## Continuation — the agent chat on the document (2026-09-27)

Roadmap `assistant-chat`, built from the spec
`2026-09-27-assistant-chat-design.md` and its plan
`docs/superpowers/plans/2026-09-27-assistant-chat.md` (both deleted with this
landing; read them with `git show 6f775de:docs/superpowers/specs/2026-09-27-assistant-chat-design.md`
and `git show 6f775de:docs/superpowers/plans/2026-09-27-assistant-chat.md`;
the spec's §11 says where the build differs; code comments cite it as "chat
spec §…"). An opt-in agent beside the canvas that can do what a person can do
on the open account document in the open mode, with the sender's rights; its
edits land on the canvas as it makes them.

- **Where it runs:** the browser runs the tools (the page's own edit path:
  wasm-checked, one undo step each, autosaved); the server holds the key,
  checks grant, role, budget and message size, builds every model request,
  streams the reply (SSE on the POST) and stores the session. A turn runs only
  while the page is open; open calls of a turn left hanging are recorded
  "not run" when the next message arrives or the claim goes stale.
- **Server:** `effractor-accounts/src/assistant.rs` and migration `002.sql`
  (settings, grants, sessions with the running turn, messages, usage);
  `effractor-server/src/assistant/` — `mod.rs` (the config from `settings`,
  defaults), `provider.rs`, `openai.rs`, `anthropic.rs` (one neutral message
  shape, two wire protocols; Kimi and Moonshot hosts get thinking replayed
  unsigned), `catalog.rs` (reads `tools.json`), `prompt.rs`, `window.rs`
  (fitting the context); `api/assistant.rs` (sessions, turns, results, stop),
  `api/assistant_admin.rs` (settings, models, Test, grants, usage).
- **Page:** `assets/js/assistant/` — `tools.json` (the one tool catalog, read
  by server and page), `tools.js` (each edit tool over the pure edit
  functions), `page.js` (runs calls, one queue; reads, views, the compact
  catalog), `client.js` (routes and the stream), `transcript.js` (rows, what a
  call selects, tokens per turn), `markdown.js` (in-house, never HTML),
  `panel.js`, `admin.js` (the admin's Chat tab); `css/80-assistant.css`.
  Nothing of it exists without `--accounts`: the routes 404, and the Pages
  build carries no `js/assistant/` and no `80-assistant.css`.
- **To run it:** start with `--accounts`; a site admin opens Admin › Chat,
  sets provider, address, key and model (listed from the endpoint), presses
  **Test**, and grants the chat to users or groups (the same switch is in the
  Users and Groups tabs). A document kept only in the browser offers *Save to
  documents* first. Kimi works through the Anthropic provider at
  `https://api.kimi.com/coding` with User-Agent `claude-code/0.1.0`, and on
  the OpenAI-compatible endpoint.
- **The key:** stored in `settings` in plain text like documents, or pinned by
  the operator (`--assistant-key-file`, `EFFRACTOR_ASSISTANT_KEY`), which wins
  and cannot be changed in the tab. No route returns it; provider errors are
  scrubbed of it (`tests/assistant_leak.rs` sends a known key through every
  route and error path). **Changing the address keeps the key** (owner,
  2026-09-27; saving needs a fresh login); listing models at an edited address
  sends the stored key only for a fresh login.
- **Tool schemas** are one catalog for every provider, in the strictest form
  (one `type` per node, unions as `anyOf` of typed children) — Moonshot
  refuses anything looser; a Rust test holds it. Every `ttc` is an expression
  string whose description lists the notation (the first real turn sent bare
  numbers). **A new edit function must answer "and the agent?"**:
  `scripts/assistant-tools.test.js` fails for any exported edit function that
  no tool reaches and no `EXCLUDED` entry explains.
- **Nothing is cut that fits** (owner, 2026-09-27: "this unnecessary
  truncation is a huge problem"). The page sends outputs whole; the server
  sends a history that fits as it is, drops whole middle turns next, and cuts
  large texts (head and tail, marked) only when the first and the latest turn
  do not fit whole. The first real turns had the catalog reach the model
  without its middle; audit what the provider was *sent*, not only what the
  database holds.
- **The panel:** a round button bottom left on the canvas (Ctrl+.; Firefox
  keeps Ctrl+Shift+K) that grows into the panel; width dragged at its edge,
  300–560 px. It streams in place (rows kept and patched, one draw per frame,
  a caret while the agent writes, a pulsing *Thinking…* before the first
  token and between steps), follows only when at the end; the user's message
  a tinted bubble, the agent's text plain (the owner's other project's chat
  was the model for the look), calls with a running/done/refused mark that
  select their item, one tokens line per turn. Undo turn, the session menu
  (new, open, rename, delete with Undo), Continue at the step limit; during
  someone else's turn the field says who is asking.
- **Owner decisions (2026-09-27):** sessions are shared per document; the
  sender's role decides the tools (a Viewer's turn gets read and view tools);
  site admins grant per user and per group; no per-hour turn limit, 50 steps
  per turn; truncate the middle, never summarise; scan results only as pasted
  text; no invented framing in the prompt (no "course", no personal details or
  place names anywhere); answers in English unless the user writes otherwise.
- **Looked at by the owner** in the 8082 preview: the button and panel, the
  admin tab, real turns with Kimi (both providers), the streaming and the
  look. The local branch `assistant-chat-steps` holds the per-task history
  and must never be pushed (its old commits contain a place name the owner
  had removed); `1b4fcbd` and `f34be1b` on master contain it too — a history
  rewrite was deferred by the owner.
- **Open:** a real-model check of the viewer path by a second person; cost
  display (tokens are shown as reported, never priced).

## Continuation — masscan and Greenbone beside nmap (2026-09-27)

Roadmap `scanner-readers` (#161) and `greenbone-import` (#162, stacked),
built in one session from the roadmap's text; no spec or plan was written.
One application per tool (`tool: nmap | masscan | greenbone`, core `Tool`),
each reading into the scan `nmap-plan.js` plans from; planning, the preview
and adding stay one.

- **`scanners.js`** is the registry: `TOOLS` (id, name, `read`, `stampFor`,
  `looks`), `tool(entity)`, `addScanner`, `read(id, text)` (a result pasted
  into the wrong tool's dialog says where it goes), `stampFor`. Every
  scanner's stamp is its own line (`Last masscan import: …`); `apply` takes
  `{line, pattern}` or nmap's stamp as before.
- **masscan** (`masscan.js`): its `-oX` is nmap's XML (checked against
  masscan's `src/out-xml.c`: a `<host>` per port, no `<status>`, banners as
  `<service name banner>`), read by `nmap-read.js` with `{scanner:
  "masscan"}`. A listed host answered; a listing that names a port beats one
  that does not; a page title or certificate is not a service; a port is
  named by `portName` (nmap's own table, shared). The command: ports (common
  / all TCP / all TCP + common UDP) and speed (100 / 1,000 / 10,000 per
  second, a warning at the last); addresses only in the range.
- **Greenbone** (`greenbone.js`): the XML report (a download, or a GMP
  answer). Hosts, names, OS (`best_os_txt`), MAC, open ports from the
  details, the ports list and every result; products from application CPEs
  (`cpeLabel`: `openssh 9.6p1`); a result with severity above 0 is a
  finding, on its port or (`general/…`) on the host, where it is shown *not
  applied*. Fixture hand-written in the shape of GVM 9 and 22.6 exports (the
  DefectDojo test reports were the reference for the shape).
- **Plan:** findings are neutral (`{source, key, title, state, ids}` on a
  port's or host's `findings`) beside nmap's scripts; the note line names
  the source (`Greenbone: High 8.1, CVE-… (…)`). Product labels match
  whatever their case. A flow that another scanner on the same host already
  draws to that service is not drawn again. Only nmap offers a product in
  another version.
- **Dialog:** one dialog; step 1 is the tool's (nmap's recipes, masscan's
  ports and speed, Greenbone's export steps), then the shared range/command
  (not for Greenbone), paste and preview. Add menus list all three; the
  light bulb stays nmap's.
- **Checks:** `scripts/masscan.test.js`, `scripts/greenbone.test.js`;
  `scripts/fixtures/{masscan,greenbone}/imported.doc.json` pinned by Node,
  `tests/json.rs` and `check-nmap-wasm.js`. nmap's tests did not change.
- **The owner's first real report** (2026-09-27, Greenbone CE on rootless
  podman, `~/Tools/GreenboneCE`, a /20): two hosts. The scanner container
  sits behind podman's NAT (every traceroute starts at `10.89.5.17`), where
  its raw-socket alive test cannot reach the LAN; and the export's filter
  (`levels=chml`) left out all Log results. The reader now says both in the
  preview (`greenbone.notes`: results the filter left out, from
  `result_count`; a first hop every host shares that is no scanned host;
  checks that failed), step 1 of the dialog says what to do (alive test
  *Consider Alive*, or the scanner rootful on the host's network), IETF
  protocol CPEs are no products, and `Services` details name ports.
  Fixture `container.xml` is that report's shape, anonymised; the real one
  stays out of the repository.
- **Menus** (owner): one *Scanners ›* item with the three tools nested, in
  Add › Application and in a host's add-linked menu.
- **Open:** real masscan output; `nuclei-import` is ready on the roadmap.

## Continuation — nmap recipes (2026-09-27)

Built from the spec `2026-09-27-nmap-recipes-design.md` (deleted with this
landing; read it with
`git show 003cba9:docs/superpowers/specs/2026-09-27-nmap-recipes-design.md`,
its §9 says where the build differs; code comments cite it as "nmap recipes
spec §…"). No implementation plan was written. One branch, a commit per
part. The owner looked at the dialog in the 8081 preview, found the first
form plain ("it just doesn't look nice": a flat list, ten dropdowns in one
column) and accepted the second: three numbered steps, recipes as tiles,
*Adjust* in two columns that says what is set while closed, the command as a
terminal line, the actions in sight. **Not looked at by the owner:** the
preview's *Changes* and *On the way* sections, the *not seen* ring, the
inspector's *Identity* row — they landed with the rest on the owner's word.

- **File:** hosts carry `identities` (`mac:…`, `ssh-<keytype>:…`), `vendor`,
  `seen`, `missed` (`YYYY-MM-DD`), in place, no version change. Refused off
  hosts and in the wrong shape; two hosts may share an identity. Generation
  and results never read them. The wasm module must be rebuilt.
- **`nmap.js` is a facade** over `nmap-address.js` (bytes, CIDR, private
  space, what a scan covered), `nmap-read.js` (the XML), `nmap-command.js`
  (BLOCKS, RECIPES, `combine`, `command`, the stamp), `nmap-route.js` (hops →
  routers, link networks, flow routes), `nmap-changes.js` (what differs, the
  firewall check, `drawnPorts`), `nmap-plan.js` (matching, rows, summary,
  apply). `window.effractorNmap` has every name of all of them.
- **Commands:** seven recipes, ticked, combined block by block (the stronger
  choice wins; a root scan takes SYN unless told not to; *Names only* goes
  alone). `LEVELS`, `CHECKS`, `level`, `checksOffered` are gone; Standard is
  `['services']`, Deep and Complete are its *Adjust* settings
  (`scripts/nmap.test.js`, `DEEP`, `COMPLETE`). Nothing offered hides a scan
  or asks a third party (`scripts/nmap-command.test.js` holds that).
- **Matching:** MAC, then SSH key, then address, then name. Ticks grew:
  `identities`, `moves`, `renames` (ticked), `strips`, `changes` (unticked),
  `routers` (ticked), `seen`. A tick group an old caller leaves out is off.
- **An import that only notes the day** is an edit now: a rescan that finds
  nothing new still sets `seen` (*Notes 4 hosts as seen.*); untick
  `ticks.seen`, or a scan without `start`, and it is none.
- **Fixtures**, all hand-written in nmap's shape: `lan-arp`, `identity`,
  `route`, `firewall`, `firewall-ack`, `day1`, `day10`; `imported-route.doc.json`
  is pinned three ways like the others, which gained identities, vendor,
  seen and the new stamp line.
- **Open:** a real `--traceroute` scan of the owner's against `route.xml`.
  What the preview can only say (*nothing drawn to say it on*, *filtered by
  … itself*) stays said: `firewall-denies` was dropped, see *Roadmap pruned*.

## Continuation — visual and ergonomic review, landed (2026-09-27)

The review below was worked through one small PR per part, the owner looking
at each on a preview (`target/debug/effractor --bind 127.0.0.1:8082 --accounts
<db> --data <dir> --public-url http://localhost:8082`; a worktree gets its own
build and port, since debug builds read `assets/` and the compiled-in
`shell.html` from their own checkout).

- **Landed:** quick fixes (#126); number fields and forms (#127–#130); a step
  comes into view and walks by key (#131–#132); ranked routes (#133); the
  canvas card (#134); *Components | Attack graph* and an empty canvas that says
  how to begin (#135); a Compare scenario drawn on the canvas (#136);
  chokepoints, "every route" (#137); colour grammar — quiet plates (#138), one
  meaning per line (#139), charts with round ticks and drawn keys (#141),
  flows twice a relationship's weight with an arrowhead at the middle (#142);
  a find field over the outline (#143, `model-find`); attack graph tags that
  fit, a grey ground for what is held at once, a legend of every state
  (#144).
- **Then** the fold that finished `attack-graph-density`: a fact with one
  producer drawn in its producer's box, the drawn node and line carrying the
  step ids they stand for (`aliases`; the renderer lights and reveals by
  them). With it the review is built and its spec deleted: `git show
  70b3b3e:docs/superpowers/specs/2026-09-26-ui-review-design.md` prints it
  (code comments cite its sections, "UI review §11"). Not done, optional in
  §11: re-windowing keeps positions or glides.
- **Owner decisions (2026-09-26/27):** routes ranked by how often they occur;
  chokepoints marked (structural, exact); family plates low-chroma, the icon
  carries the kind, saturated colour only for states and selection; flows drawn
  solid and heavy with an arrowhead, no longer dashed; the canvas switch is
  *Components | Attack graph*.
- **#139 landed before the owner had seen it** (a handoff said "land after
  CI"); on the canvas flows then looked like relationships. #142 fixed it and
  the owner approved both. A handoff note is not the owner's word: every UI
  change is shown, in plain words ("the coloured circle behind each icon", not
  "family plates"), before it lands.

Lessons:

- A tab hook that redrew the selection looped with a change handler that
  switches tabs and killed the page: guard any hook that calls notify/select
  against re-entry.
- `setTimeout`/`clearTimeout` kept as methods of an object throw "Illegal
  invocation" in browsers, not in node.
- The preview's browser is logged into a test account, so autosave runs there.
- ELK's layered algorithm ignores `elk.margins`: room for a tag is given by
  widening the node and drawing the box `overhang(n).left` into it.
- Owner rules: UI copy is a few words; say why, never nothing; left click
  acts, right click offers; menus nest and never replace one another; no
  native selects; detail on demand.

## Continuation — second full review (2026-09-26)

The owner asked again for a review of the whole application, every finding
fixed ("KISS, your best assumption"). Eight area reviewers, eight fixer
branches (#116–#123), landed together through `review-fixes`. The owner's
calls that were left to the agents: a cluster stores only a label someone
typed (the page says "first +n" otherwise); an IPv6 scan can merge into hosts
already drawn; `--trusted-proxy` counts shares per client too. Still open: a
fault tree of ~20,000 leaves takes ~13 s in `Solve::begin` (Birnbaum makes two
passes over the diagram per leaf) and cannot be cancelled.

**No currency (owner, 2026-09-26):** costs and losses are plain numbers, in
whatever a model counts in — money, hours, AI tokens. `currency` is gone from
the model, the writer, the results and the page; the reader still accepts the
key and forgets it, so files and links written before keep opening
(`crates/effractor-format/tests/shared.rs`).

## Continuation — visual and ergonomic review (2026-09-26)

A code-only review (four parallel readers: inputs, attacker paths, colour,
placement) and the owner's answers are
`docs/superpowers/specs/2026-09-26-ui-review-design.md`; its items are in
`ROADMAP.md` under *Visual and ergonomic review*. Owner decisions: ranked
routes and chokepoints (amending the lecture spec §8), low-chroma family
plates, flows may be redrawn, the canvas switch becomes *Components | Attack
graph*.

## Continuation — accounts (2026-09-26)

The self-hosted server diverges from the Pages build: opt-in accounts. The
spec and plan are built and deleted; read them from history, e.g.
`git log --diff-filter=D --format=%h -1 -- docs/superpowers/specs/2026-09-26-accounts-design.md`
names the deleting commit, and `git show <that>^:docs/superpowers/specs/2026-09-26-accounts-design.md`
prints it (the plan likewise, `docs/superpowers/plans/2026-09-26-accounts.md`).
Code comments cite its sections ("spec §6.2"); the owner's decisions are dated
in it (amendments: OIDC needs `--public-url`; the OIDC start route; editors
rename, 2026-09-26).
**Owner, 2026-09-26: the whole account system was one branch, `accounts`, and
one PR (#114) left open until the owner said merge** — merged 2026-09-26 as a
fast-forward of master. PR #113 (the installer's systemd question,
`install-systemd`) was separate and merged after it, the same day.

- **Off unless `--accounts <db>`.** Then every account route answers 404 and
  the shell has no trace of them; the static export skips `js/accounts/` and
  `css/70-accounts.css` (`static_site.rs`).
- **`crates/effractor-accounts`** — SQLite (WAL, `fallible_uint` for u64
  timestamps), `migrations/001.sql` is the whole schema, `PRAGMA user_version`
  counts migrations (the DB is the one place with versioning; YAML stays
  unversioned). Synchronous; the server calls it through
  `Accounts::blocking`. `perms.rs` is the permission rule (owner, else the
  strongest share on the item or a folder above it, for the user or a group;
  recursive CTEs capped at 32); no role = 404, too little = 403.
- **Server** — `accounts.rs` (state), `auth/` (cookie `effractor_session`,
  `guard.rs` same-Origin for every non-GET, password login limited per
  address, `passkey.rs` webauthn-rs with discoverable login and mediation
  cleared, `oidc.rs` PKCE/state/nonce plus an `effractor_oidc` cookie binding
  the callback to the starting browser, its path under `--public-url`'s path),
  `api/` (account, documents,
  sharing, admin), `cli.rs` (`effractor user list|add|promote|demote|passwd`).
  The hourly sweep also ends sessions and purges what was deleted 7 days ago.
- **Build** — webauthn-rs needs OpenSSL, vendored: building the server needs
  perl (Fedora `perl-core`), make and a C compiler. CI builds the musl binary.
- **Page** — `assets/js/accounts/`: `client.js` (fetch wrapper, never
  rejects), `account-ui.js` (bar, login and account dialogs; sections for
  passkeys and OIDC via `A.accountSections`), `documents.js` (pure tree) +
  `documents-ui.js` (the left panel's *Model · Documents*, `data-left-tab`
  because `controls.js` owns every `[data-tab]`), `autosave.js` (pure queue,
  version check, retries, 409 stops) + `sync.js` (which server document each
  mode is: `store.binding`; New/file become documents, links and local work
  are offered), `people-ui.js`, `admin-ui.js`, `passkeys.js` (pure
  conversions). `app.js` gained `say(text, actions, sticky)`, `onText`, and
  `replaceDocument(…, {origin, fresh})` — a server document starts a fresh
  undo history so an undo never writes one document into another.
- **Sync** — `sync-core.js` is pure and node-tested (`scripts/accounts-sync.test.js`):
  per mode a record `{user, id, base, saved, text}` written with every edit,
  one save queue per document, records survive a logout, the page announces
  its first text (`app.js` `load()`, origin `load`/`new`) and every text with
  its name (the page's own state is updated after its listeners). The test
  harness calls the core before updating the page, as app.js does — keep it
  so; a neater fake hid a real bug once.
- **Reviews** — two fresh whole-branch reviews (units and security; then
  every flow through the page). Both found data-loss paths in the page's
  sync layer that unit tests passed; everything they found is fixed. A third
  (`/code-review` of PR #114) found four, all fixed with tests: the OIDC
  cookie's path behind a prefix; a first password on a passkey/OIDC-only
  account needs a fresh login (`session::fresh`, like adding a passkey);
  a wrong current password in `PATCH /api/account` counts against the login
  limit; a one-letter directory query matches a whole name only (names may
  be one letter).
- **Looks** — owner looked at login (fixed: account inputs used the browser's
  serif) and documents (fixed: a rename showed late). Passkeys need
  `--public-url`; locally use `--public-url http://localhost:8082` and browse
  `http://localhost:8082` (WebAuthn allows localhost; the Origin guard then
  wants exactly that origin).
- There is no O key for Documents: every letter already starts a node
  rename. Ways in: the tab, the crumb's path, the file menu.
- Rulings made during the work are in the PR description.

## Continuation — sample collection (2026-09-25)

`assets/examples/` holds thirteen models again (README there is the catalog):
fault trees 01–03, attack trees 04–06, architectures 07–13. At the owner's
word 01–12 are set in **Sodium City**, an invented cyberpunk megacity (invented
corporations and products; no franchise-specific terms); re-theming changed
names only, never structure or numbers. Every architecture carries clusters
(closed and open, labelled and not, `shown` footholds and targets), since
clustering was demonstrated nowhere. 13 (owner: "hyperrealistic blue-teaming,
crypto wallet on a machine") is realistic, not cyberpunk: a fund's hot wallet
on a workstation, seven defence scenarios; multisig is the one that moves the
number. `crates/effractor-solver/tests/examples.rs` holds every file
canonical, diagnostic-free and solving (baseline and each scenario); add a new
file there.

## Repository cleanup (2026-09-25)

At the owner's word, specs and plans of what is built were deleted, and so
were all shipped examples (renewed the same day: *sample collection* above).

- **Deleted specs and plans**, all built: v1 design (trees, sharing, charts,
  Pareto; v1 accepted), readable time notation, library extension, nmap import
  (routers, checks, network choice included), clustering, nmap recipes (in
  `003cba9`), the agent chat and its plan (in `6f775de`). Code comments and
  the sections below still cite them ("spec §4.2", "clustering spec §5.3");
  read them from history, e.g.
  `git show 9bbfa73:docs/superpowers/specs/2026-09-24-clustering-design.md`
  (`git show 9bbfa73 --stat -- docs/superpowers` lists them). The nmap spec's
  last amendment (the network row) is in `ec9dd1e`.
- **Kept then:** the lecture-workflow spec and plan, until Task 8 closed
  the milestone (2026-09-30, see the continuation of that date).
- **Examples:** the old `assets/examples/` went (fault/attack trees 01–13,
  the catalog); the thirteen there now are the new collection. The five
  architectures 14–18 are test fixtures now,
  `crates/effractor-components/tests/fixtures/architectures/` — they are what
  proves every generation rule is used, and two graph-agreement cases. The
  share and notation tests read the templates and course files instead.

## Continuation — full code review (2026-09-25)

The owner asked for a review of the whole application with every finding
fixed, minors included. Eight reviewers (one per area) verified each finding
by code or a scratch repro; fixes landed as #98 (server, release, Pages),
#103 (solver: a control whose flip left a leaf without a distribution
panicked the worker), #104 (format and validation; trees now also stop at
100,000 samples — the owner chose refusing over raising the limit), and
#99–#102 (architecture, canvas/app, nmap/attack/comparison, tree editor)
through #105, which also brought the owner's **exposed** ring (see "Vulnerable
ring"). Kept on purpose: deleting a member of a closed cluster still writes
stored places for it, so an undo puts the cluster back where it stood; quoted
`decrypts: "true"` / `contained: "true"` still read (shared since 2026-09-24).

Afterwards (owner): the nmap preview's network row offers *new* or *same as
“…”* (a drawn network without addresses, which it fills), preselected with
*nmap is on it?* when nmap's host is on exactly one such network (nmap spec
§4.2).
- Pages now deploys only commits whose CI passed and skips (not fails) a
  documentation-only push.

## Continuation — clustering (2026-09-25)

`clustering` is done (spec `2026-09-24-clustering-design.md`, plan
`2026-09-24-clustering.md`, both deleted and read from history);
the owner shaped it over eight looks in the 8081 preview. The spec records
each of the owner's decisions with its date; read it before changing any.

- **File:** top-level `clusters: {id: {label?, members, shown?, closed}}`,
  in place, no version change. `shown` = members of a closed cluster drawn
  beside its stack, inside its outline. The validator refuses a non-entity
  member, an entity in two clusters, fewer than two members, a `shown` entry
  that is not a member. Generation and results never read it
  (`crates/effractor-solver/tests/graph_clusters.rs`).
- **`clusters.js` (pure):** every cluster edit (`make`, `build`, `gather`,
  `toggleAll`, `pressK`, `takeOut`, `moveTo`, `merge`, `stack` via `merge`,
  `peel`/`unpeel`, `dissolve`, `rename`, `setClosed`), `together` (what runs
  together: a host with its router + firewall, software and products only it
  uses; a router on no box with its firewall), `forget` (used by
  `architecture-links.remove`; ids are fixed once made, so nothing renames
  one), and the drawing's geometry
  (`segments`/`arc` ring sectors, `within` rectangle, `closeAt`/`reopen` in
  place, `transitions`/`opened` for the glide, `spread` to push aside what an
  opened cluster covers, `lit`). Loads right after `graph.js`; `edit.js`'s
  `slug` is looked up lazily.
- **Drawing:** `architecture-view.describe` folds a closed cluster into one
  node (`cluster/<id>`, most specific member's icon, stacked plate, ring
  sectors per member: red vulnerable, amber unknown inputs), merges lines per
  pair of drawn ends (`links/…`, `flows/…`, `permits/…`, listed in
  `bundles`), and lists outlines in `groups`; `hidden` says where a member is
  drawn (`app.js` `shown`). `graph.blocks` lays out every outline's contents as a
  block with room for the outline and its name tab. The renderer glides
  between drawings (`render(layout, styles, motion)`, not under reduced
  motion), draws outlines (above lines; a 14 px hit band and a name tab),
  draws the rectangle (Shift + drag), drags selections and outlines as
  groups, lights a merge target with a small pull, and emits `pick` and
  (free layout, onto a node) `drop`.
- **Selecting:** `state.picked` (qualified ids) beside `state.selected`;
  Ctrl-click, Shift + drag, Esc; Del and dragging act on all.
- **`cluster-ui.js` (DOM):** K (nothing selected: cluster · uncluster all;
  one cluster or member: open/close; several: merge; C was dropped as a
  narrower copy of it, owner 2026-09-25), the rail icon, the
  menus (component, cluster — also on a right-click anywhere inside an
  outline —, selection, background incl. *Hide cluster outlines*), the
  cluster inspector (label, shown, members: click selects, right-click is
  the member's menu without leaving, × takes out, drag out peels it beside
  the stack), and merging by dragging one onto another. Places kept in place
  on open/close are `app.js` `paint`'s (`clusters.inPlace` from the glide's
  transitions), so undo, redo and source edits get them too, and only
  accepted edits write them (`positions.moveAll`, one write). Everything else
  drawn before keeps its place too (`clusters.held`, owner 2026-09-25: only
  what is involved moves), so opening or closing counts as arranging by hand. The bottom bar's *cluster outline* switch hides
  outlines (`effractor.outlines`). Pins dropped on a cluster ask which member.
- **nmap import:** clusters what it brought in by host, open (`gather`), and
  arranges a drawing nobody arranged by hand.
- The wasm module must be rebuilt (`scripts/build-wasm.sh`) for a page to
  read `clusters`; an old module refuses the key.

## Continuation — nmap checks (2026-09-24)

`nmap-scripts` (nmap design §3.2, §3.4, §4.6; owner's design in
conversation): a **Checks** choice beside the level, none · safe · all
(`N.CHECKS`, not for Discover), adds `--script 'vuln and safe and not
external'` or `'vuln and not external'`. The owner: nothing may ask a third
party (so never `vulners`, and `not external` always), and users are
responsible adults (*all* runs exploits and DoS checks; one warning line, no
filtering). `read` keeps `<elem>` text; ports and hosts carry `scripts`
(`{id, output, vulns}`). A `state` of (LIKELY) VULNERABLE is a finding:
`patched: false` on the port's product and one line on its `find-exploit`
note (`nmap ssl-heartbleed: VULNERABLE, CVE-2014-0160 (…).`), status and time
untouched; an author's `patched: true` stands. Host checks (SMB) go to
tcp/445, else tcp/139, else show *not applied*. UNKNOWN shows *could not
test*; `version`-category scripts are left out; anything else shows *not
read*. `summary.unpatched` counts products. Fixtures: `checks-lab.xml`
(hand-written in nmap's shape; findings need a vulnerable target),
`imported-checks.doc.json` (pinned by Node, `tests/json.rs`,
`check-nmap-wasm.js`). The roadmap's infrastructure section is empty now.

**Vulnerable ring** (owner, after Chainalysis Reactor's exposure ring, from
the look: a finding was invisible from the host). `architecture-view.describe`
gives each node `rings: [{state, why}]`; the one state so far is
`vulnerable`: a product with `patched: false`, the software that is an
`instance-of` it, and the host that `hosts` that software. The renderer draws
a red (`--color-danger`) ring outside the halo; lines of a ringed component
end outside it (`graph.js` `ringed` hub); the tooltip carries each product's
"unpatched" line and its `find-exploit` note, which is where the CVE shows.
The bottom bar's legend has *vulnerable*. More states (foothold, target,
reached) could become further rings; none is asked for yet.
**Exposed** (owner, 2026-09-25, after Reactor's exposure colours: three
equal red rings read as three findings): only the product with the finding
is `vulnerable` (red); the software running it and its host are `exposed`,
in violet (`--color-exposed`; orange could not be told from the red; blue is the selection's, yellow the unknowns'), and a closed cluster's sectors say the same.
Amber stays for unknown inputs.

## Continuation — nmap hint (2026-09-24)

Owner request: a light bulb in the canvas's bottom-right corner
(`#nmap-hint`, architecture view only) says *Scan a network with nmap*
while the architecture has no nmap application (`nmap.hintWanted`); a click
adds nmap as the Add menu does (on the selected host, if one is) and opens
its dialog; × dismisses it for good on this browser (`effractor.hint.nmap`
in localStorage, a convenience: storage that fails only shows it again).

## Continuation — grouped layout (2026-09-24)

Owner, after an nmap import made a tangle: "Arrange automatically" now lays
an architecture out grouped by host (the owner chose it over tuned springs,
and to leave flows drawn as they are). `graph.blocks(graph)` gathers each
host with the software it `hosts` and the products only that software uses:
host on top, centred; software in rows of five under it, in file order; each
product under its first user. A product used on two hosts, a router or guest
on a box, networks and everything else keep places of their own. ELK stress
then places blocks and single components, pulled by links only: **flows no
longer pull** (a scanner dragged everything to itself), firewall pulls stay.
`separate` pushes blocks apart as wholes; blocks land on whole pixels.
Positions a visitor dragged still win; the background menu's "Arrange
automatically" forgets them.

## Continuation — unknown hosting privilege (2026-09-24)

Owner, from the look at an import: "hosts · admin" was a guess. Now a
host's application or service may say `privilege: unknown`
(`Privilege::Unknown`; reader `HOSTING_PRIVILEGES` for `hosts` only; the
validator refuses it for a router or guest on a box). Generation keeps what
holds either way (host admin → control, control → host user) and makes the
two privilege-dependent steps actions with `Binding::UnknownPrivilege(aid)`:
`action/host-execution/<host>/<sw>` ("Runs as user? · …") and
`action/execution-privilege/<sw>/<host>` ("Runs as admin? · …"), resolved as
unknown with the path `associations.<id>.privilege`. Rule names and every
existing graph are unchanged. In the page the link form offers `unknown`
(`fieldsOf`), never the Link menu or Tab (`variants`, `addChoices`); the
canvas says `hosts · unknown`. The nmap import writes `unknown` (no more
"Privilege assumed" note) and leaves `tcpwrapped` ports out with a note.
Lecture design §4 and nmap design §1, §3.4, §4.3 amended.

## Continuation — routers from nmap (2026-09-24)

`nmap-routers` (spec §4.5 of the nmap design, owner's design in
conversation): each host row of the preview has a role, **host** ·
**router** · **router with firewall**, preselected only from nmap's device
class of its best OS match (`router`, `broadband router`, `WAP` → router;
`firewall` → router with firewall; Deep/Complete only), said as *nmap: WAP*.
FRITZ!Boxes are classed WAP more often than router, hence WAP. *Router* adds
`<host> router` run by the box at admin and attached to every network the box
is on; *router with firewall* adds `<host> firewall` filtered by it. A host
that already runs a router is offered no role. `read` gives `device` (the
classes), `plan` gives `role`/`roleOffered`/`device`/`on`, ticks carry
`roles`, `summary` counts `routers`/`firewalls` (exact against the limits).
Fixtures: `router-lab.xml` (hand-written Deep shape, needs root to record),
`imported-router.doc.json` (pinned by Node, `tests/json.rs`,
`check-nmap-wasm.js`). Also on this branch (owner): the proposed network
comes from the targets in nmap's own `args` (`targetsOf`), so an old scan
pasted without a range still names its network; the range field decides only
when the args name no single CIDR.

## Continuation — nmap import (2026-09-24)

`nmap-import` is done (spec `2026-09-24-nmap-import-design.md`, plan
`2026-09-24-nmap-import.md`, both deleted and read from history);
the owner accepted it in the 8082 preview. Three stacked PRs:
`feature/nmap-fields` (#87), `feature/nmap-module` (#88),
`feature/nmap-dialog`; master fast-forwards to the dialog branch's tip.

- **File:** `addresses` on host (IPs) and network (CIDR), `tool: nmap` on an
  application; in place, no version change. Lecture design §4 names them.
- **`assets/js/nmap.js` (pure):** `LEVELS`, `command` (a range with shell
  syntax or a leading `-` is refused; IPv6 gets `-6`, mixed IPv4/IPv6 is
  refused, wider than /112 gets a note), `read` (own small XML reader; text
  before `<?xml`/`<nmaprun>` is skipped, a cut-off paste says so, a host nmap
  lists twice is folded, `self` from `localhost-response`), `plan`, `defaults`,
  `summary` (exact against the catalog's limits), `apply` (one edit),
  `addNmap`, `stampFor`/`stampLine` (from nmap's own `args`).
- **Owner decisions in the look:** every scanned host is attached to each
  network whose range holds its address (known and merged ones too, only
  adding); the host nmap runs on is preselected as the merge when the scan
  names it (`altiera.fritz.box` for "altiera") or a root scan marks it, shown
  as *nmap runs here?*; a proposed network is written from its own address
  (`192.168.2.0/24`). Spec §3–§4 amended. Routers from a scan are the next
  item, `nmap-routers` (roadmap), designed with the owner.
- **Also on this branch at the owner's word:** a small × closes each side
  panel (`data-close`, `workspace.js`); the nmap dialog uses the inspector's
  input style.
- **Checks:** `scripts/nmap.test.js` (31) against fixtures in
  `scripts/fixtures/nmap/` (Standard, Discover, normal output and a
  duplicate-target scan recorded on localhost; Deep, error, down, hostile
  hand-written in nmap's shape: Deep needs root); `imported.doc.json` is
  pinned by the Node test, `tests/json.rs` and `scripts/check-nmap-wasm.js`
  (new CI step, browser wasm).
- **Deferred minors** (from the fresh review), fixed on
  `fix/review-nmap-attack` (2026-09-25) except where said: the read error
  is cleared, a merge is summarised as "addresses for n drawn hosts", the
  limit says what to untick (hosts or a smaller range; ports of one host)
  and an "all hosts" box unticks everything, a dropped file that fails is
  said, `slug()` drops accents. A drawn network without addresses: the
  plan can fill it (`merges.network`), but the preview does not offer the
  choice yet (owner's to decide). Deep/Complete fixtures stay hand-written.

## Continuation — top bar and modes (2026-09-24)

The owner found the top bar dense and the three modes hard to see and to
switch (chose "each mode keeps its own document"). Committed straight to
master at the owner's word.

- **Mode tabs** (`#mode-fault-tree`, `#mode-attack-tree`, `#mode-architecture`,
  `role="radio"`), keys 1/2/3, replace the profile chip. `app.switchMode(p)`
  goes to the text last worked on in that mode, or its template; the latest
  choice wins (`gate` channel `mode`; a `replaceDocument` cancels a pending
  switch).
- **Per mode**: `store.js` keeps `document:<profile>` and `mode` (the last
  used); the old single `document` entry is filed once under its profile
  (`legacy`/`dropLegacy`). `app.js` keeps one undo history per profile
  (`historyOf`) and the last text per profile (`slots`, set in `loaded`). A
  document opened from anywhere lands in its own mode; what it replaces there
  is one Ctrl+Z away. File → New is one item: an empty document of the mode
  on the page.
- **Bar**: brand · modes · name ▾ · … · horizon · status · theme icon (sun,
  moon, half disc for System; name in the tooltip) · Share · Calculate. Below
  860 px the tabs show icons only. The architecture's view switch moved to the
  canvas, top left (`.hud-top-left`).

## Continuation — defense comparison (2026-09-24)

Plan Task 7 (`defense-comparison`) is done; the owner accepted it in the 8081
preview after two layout rounds. Next is `lecture-workflow` (plan Task 8).

- **Attacker speed** (owner's choice of the "attacker profile"): a scenario may
  say `attacker: {speed: n}`, n > 0. Every sampled time on that side is
  divided by n on the same draws (`graph_mc.rs`, one division after the draw),
  so structure, chances, logical steps and Never/Immediate stay. Speed 2 is
  bit-identical to the model with every average halved (test); no fingerprint
  moved; the agreement check has a speed-3 case. The assumption reads
  "n × speed", status `attacker` ("Attacker speed"). Spec §9 amended.
- **Compare tab** (right panel, architectures only). `comparison.js` (pure):
  scenario edits (`putScenario`, `rename`, `removeScenario`, `setChange`,
  `setSpeed`, keeping x- fields), `switches`, `settings` (with `asWritten`: a
  switch set to what the file says changes nothing), `rows` (both CDFs on one
  grid), `summary` (the solver's paired delta, never a difference of Wilson
  ends), `changedSteps`, `routes` ({targetBlocked, blocked, changed,
  remaining} from the solver's per-side states), `state` (current / stale /
  none), and the table's number words. `comparison-ui.js` is the DOM.
- **App:** `state.scenario` is workspace state, set by `app.setScenario`; the
  solve sends it; an answer for another choice is dropped; a scenario the
  document loses falls back to the baseline. `state.solvedRevision` says
  which text a graph result belongs to; the tab fades an outdated one and
  reads no routes from it. The route lists need the attack graph, built on
  request by a button (a build of its own would overtake a view switch).
- **Time tab:** baseline dashed, scenario dotted, each in its band, a table
  with both. **Results tab:** assumptions are a plain-word list
  (`effractorWords.path`), a CI that prints as one number is left out.
- Only baseline vs one scenario, by design (spec §9). The owner asked about
  comparing two scenarios directly and was fine without it for now; a paired
  A-vs-B solve would need the reference side to be a scenario in Rust.
- Deferred minors, fixed on `fix/review-nmap-attack` (2026-09-25): a
  structural baseline is solid in the comparison chart; the Results tab
  adds "Only in “scenario”" assumptions; `scripts/check-scenario-wasm.js`
  (CI) sends duplicate and wrong-kind scenario changes through wasm.

## Continuation — unfinished flows and plain problems (2026-09-24)

The owner could not get an attack graph from a model that used the removed
time names and had three half-drawn routes, and asked for clearer messages
and for unknowns not to block. One PR, `feature/unfinished-flows`:

- **`unfinished` (new code) no longer blocks generation.** A route that is
  empty, ends at a router, has not reached the target's network, or crosses a
  router whose firewall has no permission for the flow is `unfinished`, not
  `incomplete`. The flow's connect step binds `Binding::Unfinished {flow,
  missing}`; `resolve` makes it Unknown with those route paths (plus the
  connect slot if that is unknown too). It keeps the permissions of routers
  already on the route. Complete models generate exactly as before; no
  fingerprint moved. `incomplete` (hosting, filters, target, foothold) and
  errors still block. Spec §4 of the lecture design says so.
- **A router's firewall is optional** (owner, 2026-09-24): a router without
  one filters nothing, so a flow crosses it with no permission and a known
  time; a firewall still needs its router. The flow panel says "no firewall ·
  lets it through" for such a hop.
- **`problems.js` (pure):** `blocks`, `named` (quoted ids → canvas labels),
  `hint` (next hops via `architecture-links.nearHops`, where a permission or
  firewall goes, where a target/foothold/host is set), `items`, `headline`.
  `attack-view.sourceTarget` now also leads a route path to its flow's
  route + (`focusField("route")`) and a bare `entities.x` / `flows.x` to it.
- **The page:** a refused graph stores `state.blockers`; the note and the
  chip say "no attack graph · n things to finish"; *Attack graph* (or G) and
  the chip then open a menu of them, each with its hint, choosing one goes
  where it is set. The inspector's problems use labels, show the hint, and
  mark what blocks (■). The source list marks blocking warnings. A file that
  does not read now opens in the source view with every problem listed
  (`app.showSourceText`), the canvas keeping its document; before, only the
  first problem was said and the file was dropped.

## Continuation — readable time notation (2026-09-24)

Spec `2026-09-23-readable-time-notation-design.md` and plan
`2026-09-23-readable-time-notation.md`, both deleted and read from history.

- effractor files write `30%`, `50% * Exponential(mean 12.5)`, `Never`,
  `Immediate`. `expr::parse` refuses MAL's `Bernoulli`, rates, presets,
  `Infinity`/`Zero`/`Enabled`/`Disabled`, naming the replacement; a whole
  document still reads them (`lower.rs` falls back to `effractor_mal`), because
  links shared before the notation carry them. The owner requires every link
  already shared to keep opening (2026-09-24); the fixture is
  `crates/effractor-format/tests/fixtures/shared/`.
- The grammar is `effractor_format::expr` (`parse`, `write`, `chance`); the
  reader, the canonical writer, result JSON and wasm `ttc_sketch` use it.
  `effractor-mal` keeps MAL's spelling, for old documents and the import.
- `Distribution::ExponentialMean(m)` is what files produce: stored as written,
  so every save reads back exactly. It samples with rate `1/m`, the same bits
  as `Exponential(1/m)`; no frozen fingerprint moved. `Exponential(rate)`
  remains for fault-tree `rate:`, the import and internal draws.
- A chance is read by moving the decimal point in its text (`33.3%` is
  exactly `0.333`) and written the same way back: exact for every value.
- `crates/effractor-format/examples/rewrite_ttc.rs` rewrote every file,
  asserting equivalence. Tidied averages (only illustrative examples' results
  changed): 0.000012 → mean 83300, 6e-7 → 1670000, 0.035 → 28.6, 0.03 → 33.3,
  0.015 → 66.7, 3 → 0.333 (examples 03, 07, 08, 10, 11, 16).
- `ttc.js` presets write the new spelling (Easy/Hard/Very hard, each certain or
  50%, Never, Immediate); `split`/`join` turn an expression into Chance and
  Average time for the timing form (PR B).

## Continuation — plain vocabulary (2026-09-23)

Released in `07cbb71` (PRs #73, #74). The page no longer shows library ids:

- The component catalog carries the words: `states[].word` ("admin control",
  "held"), `parameters[].name` ("Find an exploit (patched)"), `rules[].title`
  ("Use the exploit") and `entities[].meaning` (one line per kind; a service
  *accepts* connections, an application *makes* them). `vocabulary.js`
  (`window.effractorWords`) maps ids to them and falls back to the id.
  Generated step labels use the same words (`generate.rs`).
- The `?` dialog's Components legend shows each kind's meaning; the bottom
  bar's family swatches open it. The Add menus carry it as a tooltip.
- Solve → *Calculate*, Generate → *Build*, Evidence/Basis → *Confidence*/*Reason*,
  TTC → *Time*, Missing → *Unknown inputs*, Sample route → *Simulated path*.
  *Route* is only a flow's hops; an attack has a *path*.
- `profiles.words(doc)`: an attack tree says *goal*, P(goal), *Step*; a fault
  tree keeps *top event*, P(top), *Basic event*. The tree's second-parent action
  is *Reuse an existing node…* (L) and *Remove from under …* (Del); *Link* is
  only the architecture's.
- #73 was merged with GitHub's merge button while CI ran; its merge commit had
  no CI run and the release gate refused it. #74 was rebased onto it and master
  fast-forwarded to #74's tested tip, which released both. In this tooling the
  agent's push to master is refused ("CI bypass"): the owner runs the push.


## Continuation — automatic solving (2026-09-22)

The owner asked for trees to be solved without pressing Solve and accepted the
result in the 8081 preview. `assets/js/autosolve.js` decides when: 300 ms after
a load, open, share link or accepted edit; a newer change cancels a run still
busy with the older text; runs never overlap. Sampling is automatic until a
sampled run took more than 2 s, then only the exact part refreshes and Solve
samples on request. Results of an older text stay, faded (`data-results` on
`#app`), until replaced; the wasm `solve_begin` answer now carries `leaves` so
the canvas is coloured before sampling ends. Spec §7.2 is updated. Lesson: a
browser's `setTimeout` throws when called as another object's method, Node's
does not; the app test's fake timers now throw the same way. Folded in: the
`shared · n parents` badge is gone — the incoming edges say it.

## Continuation — architecture documents (2026-09-22)

The owner reviewed the lecture implementation plan on 2026-09-22 and chose
native, in-session execution: one feature branch per task, no worktree, a
pause at each task boundary. "securiCAD parity" in the owner's words means
the lecture-workflow milestone, not the later `mal-securicad-compatibility`
import item. Task 1 (`architecture-document`) is merged (19e7791, with the
review fixes d2566e9 and cd12e4c).

What Task 1 adds, all test-first: `effractor_core::architecture` (the typed
`Architecture`, `Document::{Tree, Architecture}`, the closed vocabulary with
`states()`, `slots()` and `defense()` per kind) and `validate_architecture`;
the format's `profile: architecture` reader/writer, schema version 2 with a
v1→v2 step that changes only the version and refuses an architecture that
claims version 1; `diagnose_document`/`load_document`/`save_document`, with
`load`/`diagnose` staying tree-only and answering an architecture with an
`unsupported` diagnostic at `profile`; the new `effractor-components` crate
whose `catalog()` describes `core-components@1` (eight kinds, nine
associations, five states, eight slots, fifteen rules — sixteen since `hosted-router`, see the sequential-simulation continuation — limits) and holds no
numeric duration; wasm `component_catalog()` and profile dispatch for
validate/parse/serialize; a worker `catalog` request; and a narrow app guard
that keeps the current document and says `Architecture editor unavailable`
when an architecture arrives from Open, the source view or persistence
(the architecture-editor task replaces it). A fresh reviewer checked the
branch; its two important findings (a router hosting at `user` privilege was
accepted, and an oversized library version was reported as a clamped number)
are fixed with tests, along with the tree-only diagnostic on an invalid
architecture and a block-form route test.

Decisions worth knowing that the plan left open: canonical form materializes
every slot a kind carries, so every account writes `admin-login` (not only
those with a management grant); a `note` is allowed on an `unknown` slot; a
scenario naming a permission that was deleted is an `unknown-reference`
error, so a permission is removed together with the scenarios that name it;
`effractor-solver` does not yet depend on the components crate, since nothing
in Task 1 uses it there — Task 2 adds that dependency with the generator.
`effractor-components` lists `effractor-mal` and dev-depends on
`effractor-format` for Task 2's provenance and fixtures; the catalog test
uses `effractor-mal` to prove no catalog string parses as a TTC.

Fixtures: `crates/effractor-format/tests/fixtures/canonical/lecture-architecture.yaml`
is the spec §11 scenario with its illustrative inputs, canonical and complete
(no diagnostics); `empty-architecture.yaml` is the spec §3 empty document;
`migrations/v2/` holds their flow-style sources plus a copied tree. Canonical
tree fixtures, templates and the JS fixture changed only their version line;
every solver fingerprint and result snapshot is unchanged. Examples and course
files stay version 1 and migrate on load.

Local `scripts/build-wasm.sh`, `npm test` (152), `cargo test --workspace`,
`cargo fmt --all --check`, Clippy with `-D warnings` and the roadmap check
passed on the candidate tree. No UI changed beyond the guard, so there is no
walkthrough for this task; the exact-SHA CI and fast-forward release process
applies.

## Continuation — architecture editor (2026-09-23)

Task 4 (`architecture-editor`) is merged; the owner accepted it in the 8081
preview. File → New architecture opens `assets/templates/new-architecture.yaml`
(the empty spec §3 document; `?new=architecture` too). Components are added
with the rail's +, the + beside "Model", **A**, or a right-click on the empty
canvas (one type picker); the inspector edits label, note, the kind's defense
switch and parameters. A parameter is a local draft until status, TTC and
note are applied together; wasm refuses a half one and the draft stays. A
component that is still named anywhere is refused deletion with a notice until
`architecture-links` adds reference cleanup.

Structure: pure `profiles.js` (qualified selection `entity/…`, capabilities,
`treeActionAllowed`), `revisions.js` (tokens per channel), `architecture-edit.js`,
`architecture-view.js` (components as `symbol: "component"` boxes with a kind
strip; associations and flows as edges, flows dashed); DOM `architecture-ui.js`
loads after `editor.js`, which returns early for an architecture. Tree-only
chrome carries `.tree-only` and is hidden by `60-architecture.css` via
`data-profile` on `#app`. `app.js` now tokens every parse, layout and solve:
`markSourceDirty()` (called on source input) expires parses and solves but not
the committed document's layout; undo is pushed only when an edit commits; a
repeated Ctrl+Z while one is in flight is ignored; a dropped edit says so.
`app.showSourcePath(path)` (source.js, `pathLine`) opens the source at a
document path; `app.setMode` refuses `attack` until generation exists;
`state.documents` counts document replacements. A fresh reviewer's nine
findings (races, drafts, tab keys, stale titles) are fixed with tests.

## Continuation — component generation (2026-09-23)

Task 2 (`component-generation`) is merged (fa48833) and released.
`effractor-components` now has `generate` (architecture → `GeneratedGraph`),
`resolve` (durations under the baseline or one scenario) and `graph_image`
(the `effractor-graph: 1` JSON); wasm `generate(text, revision)` returns
`{ok: {revision, source, graph}}`, and `solver.generate(text, revision)` /
the worker's `generate` message carry it. No UI uses it yet (Task 6 does).

Decisions the plan left open:

- **Generation refuses an incomplete model**, not only an invalid one: any
  error or `incomplete` warning comes back instead of a graph. Nothing missing
  becomes a permissive default; relax per case if the owner wants to generate
  half-built models.
- **Ids.** Facts are `state/<kind>/<entity>/<state>` (generated states:
  `reachable`, `exploit-ready`, `material`), plus `state/flow/<flow>/connected`,
  `state/permission/<firewall>/<flow>`, `state/session/<account>/<service>`.
  Actions are `action/<rule>/<entity ids…>` (extraction by store holder and
  credential, admin login by network/account/machine); inputs are
  `input/foothold/<entity>/<state>` and `input/flow-permission/<firewall>/<flow>`.
  Ids are built from entity/flow ids, never association ids, so renaming an
  association keeps them.
- Every declared state of every entity is a fact, reached or not; a fact
  nothing produces (the isolated `admin-net` access) has no origin and no
  inputs. Logical rules are edges into Any facts, which list every producing
  rule as an origin; timed rules are All actions.
- `resolve` puts an active switch's path (or the scenario change that set it)
  next to the slot path; an unknown switch resolves to `Unknown` with no
  evidence; a policy is `Zero`/`Infinity`/`Unknown`.
- The dependency limit cannot be reached within the document's own limits;
  it is tested through a private `generate_within` with small limits. The
  node limit is tested for real with a 20×20×20 management mesh.

A fresh reviewer found no correctness bug; fixed from its report: the worker
answers a `generate` without text/revision instead of crashing the module,
origins are sorted canonically so exports ignore authoring order, the
filters association is indexed, `graph_image` refuses a mismatched
resolution. Left as is: a `permits` for a flow whose route does not cross
that firewall's router still yields unused permission nodes (the validator
does not flag it yet), and an unknown switch reports only the switch path.

Fixtures: `docs/course/lecture-architecture.yaml` follows the plan's
inventory exactly (router `bridge`, firewall `filter`, keys, admin account
granted on the router, isolated `admin-net`; scenarios `patch`, `protect`,
`both`, `deny`). It differs from the format crate's
`lecture-architecture.yaml` of Task 1 (whose login only grants `server.user`);
both stay, for their own tests. `tests/fixtures/lecture-unknown.yaml` leaves
discovery unknown. Test-first caveat: Cycle 1 went red then green, but the
generator was written whole in that cycle, so Cycles 2–3 were green on first
run; a deliberate mutation (grants used on any machine) was checked to fail
them.

Local `scripts/build-wasm.sh`, `npm test` (201), `cargo test --workspace`,
fmt, Clippy `-D warnings` and the roadmap check passed; the built wasm module
generated the lecture graph (28 nodes) under node.

## Continuation — sequential simulation (2026-09-23)

Task 3 (`sequential-simulation`) is merged (`0a1665a`). No UI
changed: the app still gates solving by `profiles.capabilities(doc).solve`,
false for an architecture, until Task 6 wires it. What exists:

- `effractor-solver` now depends on `effractor-components` and `effractor-mal`.
  `graph_plan` (`EventPlan`, `GraphOp`, `Witness`): an event queue, times in
  nondecreasing order, ties by node index, each node finalized once. A fact's
  own duration is not read. `graph_support::analyze` gives per-node
  `seeded`/`possible`/`blocked`/`unreachable`, the unknown source paths each
  node's number would rest on (its own support: every prerequisite of an
  action, possible producers of a fact, nothing behind an always-zero fact),
  and the target support; `never(d)` judges impossibility by meaning.
  `graph_mc` (private) samples baseline and one scenario on the same windows
  (`256 * (iteration * nodes + slot)`, slot = sorted graph index);
  `graph_results` (`GraphConfig`, `GraphSolve`, `GraphResults`) is the
  stepped solve and the result envelope of the plan.
- Choices the plan left open: `seed` is always a decimal string; the delta is
  `{mean, ci, ci_reason}`; witness nodes are ordered by time then index;
  assumptions are the parameters and policies in the target support plus the
  always-zero inputs seeding facts in it (so an allowed permission on the route
  is listed); unknown durations sample as never internally and nothing resting
  on one reports a number; a structural target still samples, for the nodes.
- Wasm: `Session` holds a tree or a graph solve; `begin(text)` on an
  architecture begins the baseline graph (it used to answer `unsupported`);
  `begin_graph` / `solve_graph_begin(text, scenario, revision)`, empty scenario
  = baseline; a graph finish is `{ok: {revision, source, result}}`. The worker
  posts `begun` (never `exact`) for a graph and takes optional `scenario` /
  `revision`; `solver.solve(text, on, {scenario, revision})` calls
  `on.onBegin`.
- Checks: `tests/snapshots/lecture-graph.json` freezes the lecture graph and
  the patch/deny results at 8192 samples (native and wasip1 agree; tree
  snapshots unchanged). `scripts/check-graph-agreement.js` (CI, after the
  workspace tests) compares native `examples/graph-agreement` with browser
  wasm on baseline, patch, deny, the unknown fixture and a seed above 2^53.
  The lecture at 10,000 samples took about 37 ms in node-hosted wasm, parse and
  generation included.
- `wasmtime` 48.0.2 is installed with `cargo install` (49 needs rustc 1.96).
- Owner requests folded into this branch (2026-09-23), both checked by eye:
  an `administration` link is drawn from the managed machine to the network
  it is managed from, labelled `managed from`, and a component's form says
  "managed from there" (the file keeps `from: network, to: machine`); and a
  router may run on a host (`hosts: host → router`, `user|admin`, one host
  per router, never router → router), with the rule `hosted-router`: control
  of the host at that privilege is router admin, with no reverse rule. The
  addition stays in `core-components@1`: nothing an existing document says
  changes meaning, and graph ids are unchanged.
- Owner decision (2026-09-23): only a `calibrated` parameter must carry a
  nonempty `note`; an `illustrative` or `assumed` one may omit it, and the
  inspector's tooltip then says "no reason given" (spec §5 updated).
- Menus open beside what opened them at their measured size
  (`effractorView.menuAt`); a submenu sits flush against its list.
- Examples 14–16 were architectures: a gateway on its appliance, a web shop
  behind two routers, clinic records with an unknown input. Since the
  cleanup of 2026-09-25 they are fixtures,
  `crates/effractor-components/tests/fixtures/architectures/`, and
  `crates/effractor-solver/tests/graph_examples.rs` holds them canonical and
  to what they were written to show.
- Merged and pushed to master as `0a1665a` on the owner's word (2026-09-23).
- A fresh reviewer found no correctness bug. Fixed from its report: the
  assumption list now also names the known blockers (denials, never-TTCs) in
  the target's region, so a structural zero shows its premise, and each entry
  carries every source `paths` entry (the switch that chose a replacement
  slot included); a test for an unknown behind a known-blocked step; a frozen
  and agreement-checked `slower both` case with a real paired interval.
  Deferred for Task 6: `graph_support::analyze` walks each tainted node's
  support separately — about 0.2 s native at 5,000 nodes / 20,000
  dependencies with one early unknown; propagate bitsets over support edges
  before generation calls it every time. The worker treats a `solve` with a
  `scenario` or `revision` as a graph solve; a tree sent with a revision gets
  `unsupported`.

## Continuation — attack graph inspection (2026-09-23)

Task 6 (`attack-graph-inspection`) is on `feature/attack-graph-inspection`.
What exists:

- **Generation answers carry support.** wasm `generate` returns
  `{revision, source, graph, support}`; `support.nodes` is aligned with
  `graph.nodes` (`{id, status, missing}`), plus `target_support` ids.
  `graph_support::analyze` now unions missing inputs over the support graph's
  condensation (iterative Tarjan, bitsets); the old per-node walk is the test
  oracle (the Task 3 deferred minor).
- **Pure modules.** `attack-view.js`: `stepsFor`, `originOf` (the component
  a step falls back to),
  `sourceTarget` (a source path → the form field that sets it, or its source
  line), `inspect`, `search`, `describe` (a window of at most 500 steps round
  the focus or the target, "+n not shown" on its edge), `refuse`, `ownsKey`.
  `graph-results.js`: headline P(target) with interval and qualifiers, the CDF
  rows as the solver gave them, `nodeFacts`, `assumptions`, `witness` (the
  Sample route, never ranked), `timeTo` ("not reached by …"), `cdfKey`.
- **Fixtures are exported, not written.** `scripts/graph-fixtures.js --write`
  (after `build-wasm.sh`) writes `scripts/fixtures/graph/*.json` from the real
  module; `check-graph-agreement.js` fails when one is stale.
- **The page.** Top bar *Architecture | Attack graph* (G; `data-view` on
  `#app`, `.attack-only` / `.architecture-view-only`). The attack graph is the
  tree's layered layout run upwards: target on top, lines from prerequisite
  into the dependent's ALL/ANY symbol with arrowheads, states as words and
  stroke patterns. A step's inspector (`sections.step`) shows rule, state,
  TTC and evidence, components and Source links (`openParameter`,
  `focusField`, `showSourcePath`, which now finds list items). A component
  lists its attack steps. Results: headline, missing, assumptions, Sample
  route, searchable step table; the TTC tab plots the target compromise
  probability. Edit keys and rail are refused in the attack view.
- **Solving.** Architectures solve like trees, automatically while quick,
  with `{scenario: "", revision}`; generation and graph solves are accepted
  only for the text and revision still on the page. In the attack view every
  edit regenerates; a vanished step falls back to its component; a failed
  generation returns to the architecture and says why; the latest view choice
  wins over a generation on its way.
- **Owner report folded in:** a new flow could not be created (validator made
  an unfinished route an error). Empty, router-ended and not-yet-arrived
  routes are now `incomplete`; a sweep of all 669 edits the editor offers on
  the examples found one more (a second firewall offered) and none remain.
- A fresh reviewer's four important findings and all eight minors are fixed
  with tests.
- **`node_modules` had been committed as a symlink** (in `b5bd15a`, and again
  in `e549439`): `.gitignore` said `node_modules/`, which matches directories
  only, so a worktree's `ln -s` was staged with the next commit and every
  checkout brought the self-loop back (ELOOP in tests). It is untracked and
  the ignore rule is now `node_modules`. Stage files by name, never `-A`.

Next: `library-extension` (roadmap), whose section 1 the owner approved;
sections 2–3 still need the owner's design look before a spec.
Modelling answer given to the owner: a router VM on a hypervisor is `hosts:
host → router` today; a host on a host arrives with `library-extension`.

## Continuation — architecture links (2026-09-23)

Task 5 (`architecture-links`) is merged after the owner's look in the 8081
preview. What exists:

- `architecture-links.js` (pure): `putAssociation`, `putFlow`, `setFoothold`,
  `setTarget`, `remove` (reference-safe: a delete takes along the
  associations, flows from/to/over it or needing a removed attachment, their
  permissions, attacker states and scenario changes; a firewall's permission
  goes when its router leaves the flow's route or stops being filtered by
  it); ids are fixed once made, never renamed; catalog-driven
  `linkChoices`, `addChoices` (the same fields as the Link menu), `addLinked`, `nextHops`,
  `flowPermissions`, `phrase`, and the explanations `notes`, `emptyLink`,
  `emptyFlow`, `emptyHop`. Fixtures `scripts/fixtures/architecture.doc.json`
  and `catalog.json` are pinned to the real format/catalog by Rust tests.
- `architecture-links-ui.js`: the Link action (L, rail chain button, menu),
  links/flows/foothold/target in a component's form, forms for a selected
  association or flow (route hop by hop, per-router permission, connect).
  **Tab** (or the rail's + with a selection) adds a component linked to the
  selected one in one undoable edit, flows included.
- **Dragging** (owner's choice: positions in *this browser only*, per
  document name, `positions.js` over localStorage; never in the file). An
  architecture is drawn "free": stored positions over ELK's, straight edges
  box to box with arrow and label (owner 2026-09-24: curves were unnecessary,
  Reactor draws straight), parallel links side by side; "Arrange automatically"
  on the background menu forgets the moves. Trees keep ELK routes and
  drag-onto-to-move. The renderer interface gained `move` and `reveal`.
- An architecture's automatic layout is ELK **stress** (`graph.toStress`), not
  the tree's layered one (since 2026-09-24 over host blocks, see "grouped
  layout"), then `graph.separate` pushes overlapping components
  apart (deterministic, tested against real ELK). A firewall is pulled to both
  ends of each flow it `permits`, so it sits by its router among its traffic.
  Each permission is drawn as a dotted line from the firewall to its flow's
  middle (`positions.attach`), worded allows/blocks/?; the bottom bar's
  architecture legend (families, line kinds) has a *permission* switch that
  hides them, remembered per browser (`effractor.permits`), and the
  background menu offers the same.
- The v1 spec's "the canvas never stores a position" now holds for trees only.

Known limits: positions are keyed by document name (two "Untitled" share);
an automatically placed component may land on a dragged one after an edit.

## Continuation — self-contained links (2026-09-22)

The owner approved optional self-contained sharing. Branch
`feature/self-contained-links` adds `#tree=v1.<base64url(gzip(YAML))>` links to
both hosting modes. Pages offers self-contained links; the server keeps its
encrypted links as default and adds a mode picker. Inline links upload nothing,
are not encrypted, and have no expiry or revocation. Limits are 8,192 URL
characters and 1 MiB of expanded UTF-8 YAML. The additional contract is in
the v1 spec's hosting/sharing section and README.

Opening uses the validating, undoable document replacement and detaches to the
deployment base only after success. A live navigation guard prevents a link
that finishes parsing after Back/navigation from changing the document,
persistence or undo history. The reviewer identified this race; regression
tests cover each asynchronous parse/serialize/adopt stage and normal file undo.

Local npm/workspace tests, fmt, Clippy and roadmap checks passed. The WASM build
ran, and all 13 shipped examples encoded, decoded and parsed in the real WASM
module. Code review has no remaining findings. **The owner accepted the UI and
authorized merging on 2026-09-22.** No agent drove a browser. The preview worktree
is `/tmp/effractor-self-contained-links`; static preview is
`http://127.0.0.1:8082/effractor/`, server preview is `http://127.0.0.1:8081/`.
The previews cover create/copy/open, editing and re-sharing, Ctrl+Z, and both
server modes. Follow the exact-commit CI and fast-forward release process.

## Continuation — successor scope

The owner selected the lecture workflow with a small, transparent component
library as the first successor milestone. Compatibility with existing
securiCAD/MAL models and libraries is recorded as later work in `ROADMAP.md`,
dependent on that milestone. The reference is `extract.pdf`, printed
pp. 112–134: model a client/router/SSH-server architecture, start from a
compromised workstation, generate attack routes and compare defenses.

The written successor design is now
`2026-09-21-lecture-workflow-design.md` (deleted 2026-09-30, in history),
**approved by the owner on 2026-09-21**. It separates the architecture/generated graph from
the existing tree model, specifies accumulated action durations and justified
cycle entry, and defines a versioned transparent component library, explicit
unknown/illustrative assumptions, defense overlays and linked views. All 23
reference pages were rendered and inspected, with detailed renders of figures
5.36 and 5.38; the page-to-requirement record is in the spec.

`successor-design` is complete: the written spec is approved and `ROADMAP.md`
contains the branch-sized implementation decomposition. The detailed
implementation plan `2026-09-21-lecture-workflow.md` (deleted 2026-09-30, in history) is written
and was reviewed on 2026-09-22; the owner chose native execution (see the
architecture-documents continuation above). No product code has changed; `lecture-workflow` remains
pending. The starting checkout was clean `master` at `c58d0cf`; the written-spec
review commit is signed `c2e748b`.

The owner requested that this session end after committing and pushing the plan
directly to master. Stop at that documentation checkpoint; the next step is
plan review and execution-method selection, not implementation without review.

Baseline `npm test`, `cargo test --workspace`, `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings` and the roadmap check
passed, and `scripts/build-wasm.sh` ran successfully. The wasip1 target is
installed but wasmtime was not on PATH; resolve the verification tool before
the sequential-simulation task. These are baseline checks, not implementation
acceptance. The lecture does not supply calibrated distributions needed for
numerical equivalence. Compatibility work remains on the roadmap and is outside
this session's implementation.

Delivery observation: the starting documentation commit's
[release run](https://github.com/overcuriousity/effractor/actions/runs/35653913216)
failed at `gate / this commit passed ci`, since release.yml requires PR CI
although documentation-only commits go straight to master. The implementation
plan records that existing mismatch; code branches still require exact-SHA CI
and a successful release. Do not describe a documentation push as a published
code release.

## Continuation — v1 acceptance

Sharing (#43), timing (#48), charts (#44), and Pareto (#46) are merged and
released in `v0.1.0+361b206`. PR #47 now records the completed release
acceptance, the course docs/files, and the reproducible wasm budget check.
The owner explicitly requested an agent-driven browser/headless-browser
walkthrough for this acceptance, overriding the earlier browser restriction
for this task. The agent ran isolated Chromium profiles against the released
binary and inspected screenshots; no owner's personal browser was driven.

Both keyboard-built trees, charts in both themes, Pareto interaction, timing
edits/undo, control deltas, encrypted sharing/local persistence/deletion,
clean-container installation, browser performance, and native/browser result
agreement passed. See `docs/V1-ACCEPTANCE.md` for exact scope and measurements.
The `v1-acceptance` roadmap item is complete. The installation check used a
fresh Alpine userspace, not a physical machine or VM.

The walkthrough found and this PR fixed two keyboard bugs: Enter on More
failed to open the disclosure, and Enter on a cut-set row could also add a
sibling. Graph shortcuts now respect controls that own the key. Both failures
were reproduced before the fix; the focused regression and full browser
walkthroughs were rerun on the corrected branch.

The remainder of this document records the original handoff and conventions.

## Where things stood before this session

Master is `2e6166c` plus this file; CI and the release are green; no PR is open.
The Rust side (`core`, `mal`, `solver`, `format`, `wasm`, share server) is
tested and released, deterministic native vs wasm. The browser UI has now been
**walked by the owner in a browser, piece by piece**: canvas, editor, solving,
results, file menu and persistence, source view, assets, controls. Nothing is
known to be broken.

Four items are left on the roadmap, and the owner wants **all of them done in
the next session**, so cost is no criterion — only an efficient order:

1. **`share-ui`** — the server side (`POST/GET/DELETE /api/share`, spec §8) is
   built and tested; this is WebCrypto AES-256-GCM with the key in the fragment,
   a share dialog with TTL, `/s/{id}` loading a local copy, a "My shares" list
   with delete. The `Share` button in the top bar is there, disabled.
   `store.js` already wraps IndexedDB (one object store, `working`); the share
   list belongs in the same database — that needs a version bump and a second
   store. Crypto and list logic get `node --test` tests.
2. **`ui-charts`** — TTC CDF (exact + sampled with band) and LEC, hand-rolled
   SVG, crosshair tooltip, a table view each. The numbers are in the results
   already: `exact.ttc_cdf`, `sampled.ttc_cdf` (with band), `sampled.loss`
   `exceedance`. New tabs in the right panel (`controls.js` has the tab code;
   the tablist is in `shell.html`). Charts must read in both themes and never rely
   on colour alone (spec 7.3).
3. **`ui-pareto`** — attack-tree profile only; `results.attacker` has the sets
   with `on_front`. Table with the cheapest path pinned, scatter with axis
   pickers, two-way highlight with the canvas (`renderer.highlight(ids, kind)`
   and the cut-set table in `app.js` show how).
4. **`v1-acceptance`** — spec §12 by hand against a release binary, the
   performance budget, the course docs page. Needs the three above.

Order 1–3 is free (none needs another); charts and pareto both add right-panel
tabs, so doing them back to back saves a rebase. Sample documents that exercise
everything (shared nodes, vote gate, assets, controls, both profiles) are in
`~/effractor-samples/` on the owner's machine — outside the repo on purpose.

## How the owner wants the UI

The reference is Chainalysis Reactor: quiet chrome, detail on demand. Decided
today, all of it after seeing the alternative:

- **Examples ship as opt-in YAML files** in `assets/examples/`, per the owner's
  2026-09-21 request; what ships is the collection of 2026-09-25 (*sample
  collection* above). The catalog is `assets/examples/README.md`. This
  supersedes the earlier no-examples decision. `/` opens the working text from IndexedDB, else an empty
  document. Shipped examples, fixtures and the spec's example are English.
- **Nothing is shown unless asked for** (owner, 2026-09-22). A first visit is
  the canvas alone: both panels closed, the HUD cards hidden until a solve. A
  solve opens the results panel; the controls tool and the source view open
  theirs; the selection shows the inspector on the canvas and nothing else.
  A panel the visitor opened stays open on that origin.
- **Left click acts, right click offers options** (owner, 2026-09-22). One
  context menu (`app.showMenu`) serves nodes, assets, controls, the theme and
  the measure button; a click on the last two cycles. Double-click renames.
  The file crumb's labelled dropdown is the one left-click menu.
- **The selected node's form is an inspector on the canvas**, *floating* over
  its right edge (owner, 2026-09-23: the docked column resized the canvas and
  made the clicked node jump). Resized at its free corner, the bottom
  left (owner, 2026-09-28): never below 240 by 120 or beyond the canvas, the
  size kept on this browser (`effractor.inspector`), a double click on the
  corner back to as tall as what it holds, the arrow keys on the focused
  corner; `workspace.js` `dragInspector`, `inspectorSize`. The HUD steps aside; a node it
  would cover is panned into view (`renderer.reveal`). Not in either panel:
  the left is the model, the right is the analysis.
- **Menus are hierarchical** (owner, 2026-09-23): an item may carry a submenu
  (`[label, key, items]`, or `{items: fn}` answered when it opens), one item
  is active at a time, greyed notes (`run` null) explain what is not offered.
  The right-hand column is only a key, plus a clear `›` on an item that nests.
- **Menus nest, never replace** (owner, 2026-09-23, after Paradox games' menus):
  any depth, each list beside its item, and every list stays open while the
  pointer is in something it opened; the items on the way in stay quietly
  lit. No menu item closes its menu to open another one in its place.
- **Architecture components are icons, not boxes** (owner, 2026-09-23, "lean
  on Chainalysis Reactor"): each kind's line icon (`architecture-icons.js`:
  Cisco's cloud, router, brick wall and server; window, gear, person, key)
  white on a round plate in its family's colour (`--viz-family-*`: network,
  compute, identity; contrast-checked), the name under it, lines ending on
  the plate's ring. The kind is the tooltip, the `?` dialog has the legend,
  the Add menus show the icons. Trees keep their boxes.
- **Say why, never nothing** (owner, 2026-09-23): an empty menu or list states
  what is missing and how to add it.
- **Relationships are said in plain words** from the selected component
  (*runs here as admin*, *is admin here*, *may log in*); the file's relation
  name is the tooltip. Canvas lines keep the technical `hosts · admin`,
  except where the term reads backwards along the arrow (owner, 2026-09-23):
  *may log in to* (authorizes), *admin on* (grants), *filtered by*
  (filters), *managed from* (administration), the term in the tooltip.
  Arrows point as the file writes the relation (said in the legend). A
  selected flow lights the networks and routers of its route.
- **No walls of buttons.** Actions are icons in the rail with the key in the
  tooltip; the context menu (canvas *and* model tree) and the `?` list spell
  them out. Every interaction has a button and every key is listed.
- **UI copy is a few words** — a unit, a range, a format — never sentences. **No
  other product is named** in the product (securiCAD is our orientation, not the
  user's; the preset names stay because they are the file format).
- **No native form pop-ups.** `menu.js` has the app's own dropdown (answers to
  `value` / `change` like a select); use it, not `<select>`, and no
  `<datalist>` (its suggestions under a text field went unused and were
  removed; write them into `menu.js` again if one is needed).
- **No confirm dialogs.** Destructive things are undoable and say so in the
  canvas notice (`app.say`): delete, unlink, remove asset/control, New/Open.
- **No made-up numbers.** A likelihood kind opens an empty field; a leaf without
  a number is drawn dashed with `?`.
- Things are named by what they do: *Delete "X" and 3 below*, *Unlink from "P"*.

## How UI work is verified

No headless-browser harness in the repo, and the owner said **no** to an agent
driving their browser: they look, you hand them a short numbered list of what
to try. What worked today:

- One interaction per PR; pure logic (`edit.js`, `results-view.js`, `store.js`,
  `source.js` helpers, `view.js`, `graph.js`) under `node --test`; then run the
  server, say what to try, wait for the look, merge only on the owner's word.
- `cargo run -p effractor-server` serves `assets/` **from disk** in debug, so
  the page follows whatever branch the main checkout is on; `shell.html` is
  compiled in, so a change there needs a restart. To keep working while the
  owner looks, use a `git worktree` and a second server
  (`-- --bind 127.0.0.1:8081`, own `CARGO_TARGET_DIR`, copy `assets/wasm/` in).
  A different port is a different origin: separate IndexedDB and localStorage.
- Everything that refuses or fails says so through `app.say` — blind debugging
  of "nothing happens" cost an hour before that existed.
- A scratch script can drive the real wasm module under node
  (`new Function(src + "; return wasm_bindgen;")()`, then `initSync`) to check
  that an edit serialises, parses and solves; ELK runs under node too
  (`elkjs/lib/elk.bundled.js`). Good for ruling the logic out.

## What bit today

- **A scripted edit cut 90 lines too many** out of `editor.js` (rail wiring, the
  keys dialog). `node --check` and every test passed; the page was dead. After
  any scripted edit to a DOM file, read the *deleted* lines of the diff
  (`git diff | grep '^-'`) before saying it is ready.
- **Pointer capture moves the click.** `setPointerCapture` on every press made
  the browser send `click` to the svg, so nothing could be selected. Capture
  only once a press becomes a drag; select from `pointerup`.
- **Stacking.** The svg is mounted after the HUD and covered it; `.hud` has
  `z-index: 1`.
- **`solver.onCrash` was never set**, so a crash with nothing pending was
  silent. It is set now.
- In the last session's tooling `git push --force` and deleting branches were
  blocked. A rebased branch goes up under a new name with a new PR and
  the old PR is closed; a stacked PR whose base is not `master` shows as closed,
  not merged, after the fast-forward — close it with a comment.
- The process stands (see `CONTRIBUTING.md`): branch → PR → `wait-ci.sh ci.yml
  <sha>` for that exact commit, unpiped → `git merge --ff-only` on master →
  push → `wait-ci.sh release.yml <sha>`. Wait for one release before pushing
  master again. **Documentation-only commits go straight to master** — the owner
  does not want CI waited on for a text file. `commit.gpgsign` is on; master stays signed.
- `pkill -f target/debug/effractor` kills the shell that runs it. Stop the
  server by port: `ss -ltnp | grep :8080`, then `kill` the pid.

## Housekeeping left behind

- Two finished worktrees, `../SecGraph-noexamples` and `../SecGraph-source`, and
  some twenty merged branches, local and on origin. All are merged into master;
  removing them was blocked by the tooling, so it is the owner's to run:
  `git worktree remove --force <dir>`, `git branch -d …`,
  `git push origin --delete …`.

## What exists, briefly

- `effractor-format`: `load` / `save` / `canonicalize` / `diagnose`, and
  `document` / `from_document` — the JSON image the browser edits. `x-` keys are
  not in `core::Model`; the reader hands them to the writer by path.
- `effractor-wasm`: `validate`, `parse`, `serialize`, `component_catalog`,
  `generate`, `ttc_sketch`, `solve_begin`, `solve_graph_begin`,
  `solve_step/finish/cancel`, `crash`; JSON text in and out. `scripts/build-wasm.sh
  [--fetch-cli]` → `assets/wasm/` (git-ignored; a server test fails without it).
- Page scripts: `assets/js/`, one IIFE module each, in the load order of
  `crates/effractor-server/templates/shell.html` — the one list; `app.js`
  holds state, solving, undo and the file menu.
- `window.effractor` is how they talk: `state`, `select`, `applyEdit`,
  `adoptSource`, `solve`, `undo`/`redo`, `say`, `format`, `onChange`.
- Every edit goes document → `serialize` → `parse` in wasm; JS never judges a
  model. Maps keyed by node id are prototype-less.

## Known limits and loose ends

- A node id of digits only moves to the front of `nodes` on a trip through the
  editor (JavaScript orders such keys first). Forbid them in `core::id` or
  carry order explicitly.
- Via JSON, a bare `x-` string that looks typed (`2026-09-01`) comes back
  quoted; a description with line breaks is written as one quoted line.
- `fresh` ids (id derived from the first label) live in `editor.js` memory; an
  undo or a reload forgets which nodes were still unnamed.
- The theme switch has three states (Light → Dark → System); with the OS in
  dark mode two of them look the same. The owner noticed once; a two-state
  toggle was offered and not asked for.
- Tab order and ARIA of the custom dropdown are basic (arrows, Enter, Esc).
- Behind a reverse proxy the share rate limit sees one address, by design.
- ELK may order a shared node's siblings differently from the document.
