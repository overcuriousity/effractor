# Scanners that build on each other — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task; the owner chose native execution in the session (2026-09-28). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The canvas's bulb names what to run next from what the drawing lacks, every scanner's targets come from the drawing, and nmap's library grows to 19 blocks of options and 13 purposes.

**Architecture:** Two pure modules beside the tools: `scan-targets.js` (what a scan is aimed at) and `scan-gaps.js` (what the drawing lacks, as steps). Each host notes what it was asked (`asked`, a new key in the file), written by every import through the one plan in `nmap-plan.js`. nmap's options and purposes are data in `nmap-command.js`; two small readers live in `nmap-devices.js`. The page code only shows what these decide.

**Tech Stack:** Rust (core, format: the `asked` key), vanilla JavaScript without a bundler (pure modules that load in Node and the browser), `node --test`, nmap 7.92 on the developer's machine for probes against 127.0.0.1.

**Spec:** `docs/superpowers/specs/2026-09-28-scan-workflow-design.md` (approved by the owner, 2026-09-28; its §12 holds what this plan amended). Code comments cite it as "scan workflow spec §…".

## How the code travels

Everything in this plan was built and run before it was written down, in a copy of the repository at `19f3d67`. The code is stored beside this plan as ten patches, a tests patch and a code patch per part:

```
docs/superpowers/plans/2026-09-28-scan-workflow/
  1-host-asked-tests.patch      1-host-asked-code.patch
  2-scan-targets-tests.patch    2-scan-targets-code.patch
  3-nmap-options-tests.patch    3-nmap-options-code.patch
  4-nmap-purposes-tests.patch   4-nmap-purposes-code.patch
  5-scan-hint-tests.patch       5-scan-hint-code.patch
```

A tests patch holds test files, fixtures, pinned documents and the script-order test (`crates/effractor-server/src/shell.rs`); a code patch holds the rest. Replayed in order on a fresh copy of `19f3d67`, each tests patch fails first and each code patch turns it green; the numbers are in each part below.

**What was run:** `npm test` after every patch; `cargo test -p effractor-format`; `cargo test -p effractor-server --lib shell`; `cargo fmt --all --check`; `cargo clippy` on core, format, components, solver and wasm; `node scripts/check-roadmap.js`.

**What was not run:** any page in a browser (the owner looks, part by part); `scripts/build-wasm.sh` and `node scripts/check-nmap-wasm.js` (they need the wasm toolchain; part 1 and part 4 run them); `cargo test --workspace` and clippy on the server as a whole; nmap as root (§ *Probes the owner runs*).

**If a patch does not apply** because master moved: `git apply --3way <patch>`, resolve by reading both sides, run the part's tests. Never `--reject` and continue.

## Global Constraints

- No third party is ever asked; nothing offered hides a scan. Never offered: `-D`, `-S`, `--spoof-mac`, `-f`, `--mtu`, `--data-length`, `--source-port`, `-g`, `--badsum`, `-sI`, `-b`, `--proxies`, `-T0`, `-T1`, `--randomize-hosts`. `scripts/nmap-command.test.js` holds it for every purpose under every choice of every block.
- Every command the page offers runs unchanged in fish, bash and sh: single quotes only, no backslash anywhere, `;` and one `>` the only shell syntax. `scripts/shell-commands.test.js` holds it.
- Adults are offered dangerous options with a warning, not filtered.
- The file format changes in place, without a version change; files written before keep opening. Unknown YAML keys are errors; `asked` is refused off hosts.
- Nothing is drawn that the model does not use. effractor is a successor to securiCAD, no vulnerability manager: the bulb never names Greenbone, nuclei's checks or nmap's checks.
- **Do not overcomplicate it** (owner, 2026-09-28). Add nothing this plan does not name.
- Pure modules have no DOM and no wasm, and load in Node (`module.exports`) and the browser (`window.effractor…`).
- nmap is run only against 127.0.0.1 by the agent. Scans of a real network are the owner's to run.
- What a page looks like is checked by the owner's eye in a preview **before it lands**, said in plain words, as a short numbered list of what to try. Never drive the owner's browser.
- UI copy is a few words; say why, never nothing; no native selects; menus nest; left click acts, right click offers.
- Every part is one branch and one PR, landed with `scripts/dev/ship.sh <title> <pr-body-file> <commit-message-file>` (signed commits, fast-forward, never the merge button); every push to master is a release; wait for one release before the next push.
- Checks before every PR: `npm test`, `cargo test --workspace`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `node scripts/check-roadmap.js`. After any change to the Rust crates: `scripts/build-wasm.sh`.
- Every commit message ends with the attribution lines the session names. The PR body says what the part does, what was checked and how, and what the owner looked at.
- After any scripted edit to a DOM file, read the deleted lines of the diff (`git diff | grep '^-'`) before saying it is ready.

## Where this plan departs from the spec

Each is simpler than, or corrects, what the spec wrote. The spec's §12 lists them; the owner approves them with this plan.

1. **§3: `ports` is noted only by a scan of twenty TCP ports or more**; `products` whenever versions were asked of a scan that can find a port open. A few ports looked at for another purpose (SNMP, a VPN's ports) leave the question of which ports are open unanswered.
2. **§3: the row *Notes … as asked* is shown for nuclei only**, where the dialog stands in for what was asked. For nmap and masscan it is what the scan says it ran, and is said as `seen` is: in the summary, when it is all there is.
3. **§3: the file writes `asked: {ports: "2026-09-28", …}`**, days quoted, as `seen` is written.
4. **§5: 19 blocks.** *Other protocols* (SCTP, IP protocols) is cut: nothing of theirs is drawn. UDP's *a list* is cut: the Ports block's list takes `U:` ports already.
5. **§6.1: *Who announces itself* alone is `-sn`** with the scripts, as every purpose without ports is.
6. **§6.2: only `snmp-interfaces` runs**; `snmp-sysdescr` would be read by nothing.
7. **§6.3: *VPN endpoints* names no script**: `ike-version` is one of nmap's version scripts and runs with `-sV`.
8. **§6.1, §6.2: the role is said as *gateway by DHCP* and *3 interfaces by SNMP***, after the *nmap:* the row writes before every device word.
9. **§6: *managed from* is offered for any nmap import** in which a router has a management port open to the scanner (22, 23, 80, 443, 8080, 8443 on TCP, 161 on UDP): a port list is not read back, so the import cannot know the purpose ran.
10. **§2.2: *Say what to scan next* is in the canvas's own menu too**, where something is silenced: a bulb silenced whole is gone and has no right click.
11. **§2.1: a network counts as scanned once a host on it was seen**, attached to it or at an address its range holds. The scanner's own host counts, if a scan saw it.

**One fact for the owner:** nmap's `broadcast-dhcp-discover` sends its DHCP request with a fixed placeholder client address (`DE:AD:C0:DE:CA:FE`) inside the request, so that the server reserves no lease for the scanner. The packet leaves from the scanner's own interface and address; the page adds no option for it. If that is too close to the rule against spoofing, strike the script from `BROADCAST` in `nmap-command.js` and the DHCP reader from part 4.

## Review Focus

What the spec implies and a person will meet. Each has its test in the patches; none is left to the executor.

1. **A drawing made before hosts noted what they were asked:** hosts with ports and products are no gap; all count as not asked how they connect. `scripts/scan-gaps.test.js`, *3. a drawing made before…*.
2. **Hostile text typed into an option** (`;id`, `-iL /etc/passwd`, quotes, `$HOME`): refused by shape, never in a command. `scripts/nmap-command.test.js`, *what is typed into the command…*; every block's typed text in three shells in `scripts/shell-commands.test.js`.
3. **Hostile or odd words from a device** (an SNMP interface name of 500 characters, a netmask that is none, a DHCP router that is a name or markup): cut, or left out. `scripts/nmap-devices.test.js`.
4. **A network with IPv4 and IPv6 ranges, and a thousand drawn hosts as targets:** both ranges are given and nmap says they are two scans; the hosts are one line, none twice. `scripts/scan-targets.test.js`, *a network with ranges of both kinds…*.
5. **The same result imported twice:** the second import notes nothing, draws no address, network or router twice, and is no edit. `scripts/nmap-plan.test.js`, *…the same day again is no edit*; `scripts/nmap-devices.test.js`, *Again: …*.

Known and left as it is: a scan of a network where nobody answered cannot be imported (nmap's reader refuses a result without a host), so the bulb says that network again until silenced.

## File Structure

| File | Part | Responsibility |
|---|---|---|
| `crates/effractor-core/src/architecture.rs` | 1 | `Asked`, `Entity.asked` |
| `crates/effractor-format/src/architecture_read.rs`, `architecture_write.rs` | 1 | reads, refuses and writes `asked` |
| `assets/js/scan-targets.js` (new, pure) | 1, 2, 5 | `asked`, `hostOf` (1); `choices`, `words`, `drawnPorts` (2); `hostsOn`, `ported` exported (5) |
| `assets/js/nmap-read.js` | 1, 3, 4 | `asksOf` (1); `passing` (3); `scan.pre` (4) |
| `assets/js/masscan.js`, `nuclei.js` | 1 | `scan.asks`; `Nu.asking` |
| `assets/js/nmap-plan.js` | 1, 3, 4 | `asked` in plan, ticks, summary, apply (1); no port from a scan of filters (3); interfaces, gateway (4) |
| `assets/js/editor.js` | 2 | `showMenu(…, within)`: a menu inside a modal dialog |
| `assets/js/nmap-command.js` | 3, 4 | `GROUPS`, the blocks, typed texts (3); the purposes, `recipesOf` (4) |
| `assets/js/nmap-changes.js` | 3 | window, FIN, NULL, Xmas read as the ACK scan is |
| `assets/js/nmap-devices.js` (new, pure) | 4 | `gateways`, `prefixOf`, `interfaces` |
| `assets/js/nmap-connect.js` | 4 | *managed from* for a router in an nmap import |
| `assets/js/scan-gaps.js` (new, pure) | 5 | `steps`, `silenced` |
| `assets/js/scan-hint-ui.js` (new, DOM) | 5 | the bulb, its menu |
| `assets/js/nmap.js` | 5 | `hintWanted` goes |
| `assets/js/nmap-ui.js` | 1–5 | the row for nuclei (1); the targets row (2); Adjust in groups (3); the interfaces line (4); `effractorNmapUi`, the bulb's code goes (5) |
| `crates/effractor-server/templates/shell.html`, `src/shell.rs` | 1, 2, 4, 5 | markup, script order |
| `assets/css/60-architecture.css` | 2, 3 | the targets row; the groups |
| `scripts/*.test.js`, `scripts/fixtures/nmap/{snmp,announced}.xml`, `imported-snmp.doc.json` | 1–5 | tests, fixtures, pins |

## Interfaces the parts share

```js
// scan-targets.js
asked(doc, words) -> [hostId]                 // the drawn hosts the words hold
hostOf(word) -> string                        // a word without its port or URL
choices(doc, appHost, selection) -> { networks: [{id, label, range, items: [{choice, name, count?}]}],
                                      selection: {choice, count}, first: choice }
words(doc, choice, names?) -> { text, hosts, left, said }
drawnPorts(doc, text) -> ["tcp/443", …]
hostsOn(doc, network) -> [hostId];  ported(doc, host) -> boolean
// a choice: {kind: "range" | "hosts" | "unported" | "missed", network}
//         | {kind: "selection", networks: [id], hosts: [id]} | {kind: "typed", text}

// every reader's scan
scan.asks   // ["ports", "products", "route", "connections"], a subset
scan.covers // nuclei only: the targets' words
scan.pre    // nmap only: the scripts that ran before the scan

// nmap-plan.js
plan(doc, appId, scan, range, merges, today) -> { …, asked: {keys, day, also: [hostId]} }
row.unasked: [key];  row.interfaces: [{name, address, cidr}];  row.gains: [address]
ticks.asked: boolean
askedCount(p, ticks) -> number;  askedWords(keys) -> string

// nmap-command.js
GROUPS: [{id, name}];  BLOCKS[i].group;  choice.field: {key, name, placeholder, hint, flag}
command(recipeIds, adjust, range, extra)   // extra: portList, drawnPorts, ack, asDrawn, self,
                                           //        resolver, exclude, iface, rate
  -> { text, root, second?, note?, warning? } | { problem }

// scan-gaps.js
steps(doc, silenced) -> [{ id, tool, count, says, purposes, adjust, targets }]
silenced(stored, before) -> [id]           // ids: scanner, network, runs, way, connect

// nmap-ui.js, for the bulb
window.effractorNmapUi = { open(appId, preset), create(tool, hostId, preset) }
// preset: { recipes, adjust, targets }
```

## The preview

For every look, in a worktree of the part's branch so the main checkout stays free:

```bash
scripts/build-wasm.sh
cargo build -p effractor-server
target/debug/effractor --bind 127.0.0.1:8081 --accounts "$SCRATCH/preview.db" --data "$SCRATCH/preview-data" --public-url http://localhost:8081
```

`$SCRATCH` is the session's scratchpad directory. 8080 may be taken; use 8081 or 8082. Stop the server by port (`ss -ltnp | grep :8081`, then `kill` the pid), never `pkill -f`.

---

# Part 1 — what a host was asked (branch `host-asked`)

Spec §3. The file key, and every import writes it.

### Task 1.1: The tests

**Files:** `crates/effractor-format/tests/architecture.rs`, `crates/effractor-server/src/shell.rs`, `scripts/scan-targets.test.js` (new), `scripts/nmap-plan.test.js`, `scripts/masscan.test.js`, `scripts/nuclei-connect.test.js`, `scripts/fixtures/masscan/imported.doc.json`, `scripts/fixtures/nmap/imported-route.doc.json`

**Interfaces:** Consumes nothing. Produces the tests of everything Task 1.2 builds.

- [ ] **Step 1: Branch and apply**

```bash
git switch -c host-asked
git apply docs/superpowers/plans/2026-09-28-scan-workflow/1-host-asked-tests.patch
```

- [ ] **Step 2: Run them, and see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 12`, among them *what a scan asked is read from what nmap says it ran*, *an import notes what it asked on every host it adds or knows…*, *masscan asks which ports are open, and nothing else*, *nuclei says what it found, not what it asked…* and `scripts/scan-targets.test.js` (its module is missing).

Run: `cargo test -p effractor-format --test architecture asked`
Expected: both tests fail, `unknown-key` for `asked`.

### Task 1.2: The key, and every import writes it

**Files:** `crates/effractor-core/src/architecture.rs`, `crates/effractor-format/src/architecture_read.rs`, `crates/effractor-format/src/architecture_write.rs`, `assets/js/scan-targets.js` (new), `assets/js/nmap-read.js`, `assets/js/masscan.js`, `assets/js/nuclei.js`, `assets/js/nmap-plan.js`, `assets/js/nmap-ui.js`, `crates/effractor-server/templates/shell.html`

**Interfaces:**
- Produces: `Asked {ports, products, route, connections}` with `KEYS`, `get`, `set`, `is_empty`; the YAML key `asked` on a host, a flow map written after `missed`; `scan.asks`; `Nu.asking(scan, recipeIds, targets)`; `plan(…, today)`, `p.asked`, `row.unasked`, `ticks.asked`, `askedCount`, `askedWords`; `scan-targets.js` `asked`, `hostOf`.

- [ ] **Step 1: Apply**

```bash
git apply docs/superpowers/plans/2026-09-28-scan-workflow/1-host-asked-code.patch
```

- [ ] **Step 2: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# pass 852`, `# fail 0`.

Run: `cargo test -p effractor-format && cargo test -p effractor-server --lib shell && cargo fmt --all --check`
Expected: all pass, no output from the formatter.

- [ ] **Step 3: The wasm module and the pinned documents**

```bash
scripts/build-wasm.sh
node scripts/check-nmap-wasm.js
```

Expected: `scanner imports: the imported documents save and validate in wasm`. An old module refuses `asked`.

- [ ] **Step 4: Amend the lecture design, which names every key of the file**

In `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md`, where §4 names `identities`, `vendor`, `seen`, `missed` of a host, add: `asked` (a map of `ports`, `products`, `route`, `connections`, each a day: what scans have asked the host; scan workflow spec §3).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "A host notes what scans have asked it, and every import writes it"
```

### Task 1.3: The owner looks, and the part lands

- [ ] **Step 1: All checks**

Run: `npm test && cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && node scripts/check-roadmap.js`
Expected: all pass.

- [ ] **Step 2: The preview** (§ *The preview*), and say to the owner, in these words:

1. Add nuclei on a host, tick *How it connects*, paste a result of effractor's templates, press Read.
2. At the end of the list there is a new ticked row: *Notes n hosts as asked what runs there and how they connect*.
3. Untick it and add; open the source view: no host has `asked`. Tick it and add: the hosts have it.
4. An nmap import shows no such row; its hosts have `asked` in the source view all the same.

- [ ] **Step 3: On the owner's word, ship** with `scripts/dev/ship.sh`, wait for CI of that commit and for the release.

---

# Part 2 — targets from the drawing (branch `scan-targets`)

Spec §4.

### Task 2.1: The tests

**Files:** `scripts/scan-targets.test.js`

- [ ] **Step 1: Branch and apply**

```bash
git switch master && git pull --ff-only && git switch -c scan-targets
git apply docs/superpowers/plans/2026-09-28-scan-workflow/2-scan-targets-tests.patch
```

- [ ] **Step 2: Run them, and see them fail**

Run: `node --test scripts/scan-targets.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 7`: `T.choices`, `T.words` and `T.drawnPorts` are not functions.

### Task 2.2: The module and the row

**Files:** `assets/js/scan-targets.js`, `assets/js/editor.js`, `assets/js/nmap-ui.js`, `crates/effractor-server/templates/shell.html`, `assets/css/60-architecture.css`

**Interfaces:**
- Consumes: `asked`, `hostOf` of part 1.
- Produces: `choices`, `words`, `drawnPorts`; `app.showMenu(items, x, y, anchor, within)`; in the dialog `#nmap-targets`, `#nmap-left`, and for Greenbone `#greenbone-targets`, `#greenbone-hosts`, `#greenbone-copy`, `#greenbone-left`; `open(appId, preset)`.

- [ ] **Step 1: Apply**

```bash
git apply docs/superpowers/plans/2026-09-28-scan-workflow/2-scan-targets-code.patch
```

- [ ] **Step 2: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# pass 859`, `# fail 0`.

- [ ] **Step 3: Read what the patch deleted from the DOM files**

Run: `git diff -- assets/js/nmap-ui.js assets/js/editor.js | grep '^-'`
Expected: `prefillRange` and its one call, the old `at = {…}` lines, the old `open` head, the old `input` listener of the range, the old head of `showMenu`, `document.body.appendChild(list)`. Nothing else.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "A scan's targets come from the drawing: the selection, a network, its hosts"
```

### Task 2.3: The owner looks, and the part lands

- [ ] **Step 1: All checks**, as in Task 1.3 Step 1.

- [ ] **Step 2: The preview**, and say to the owner:

1. Select two hosts on the canvas, open nmap's dialog: the new row *Targets* says *the selection · 2 hosts*, and the range below holds their addresses.
2. Click the row: a menu with each drawn network; inside it *the whole range*, *drawn hosts only*, *hosts without ports*, *not seen since …*, each with its count. A choice with nothing in it is grey and says *nothing drawn there yet*.
3. Choose one: the row, the range and the command follow.
4. Type into the range: the row says *typed by hand*.
5. Esc with the menu open closes the menu, not the dialog.
6. The same row in masscan's and nuclei's dialog. In Greenbone's, the hosts stand as a list with commas and *Copy*.
7. With nothing selected the dialog opens on the scanner's own network, as before.

- [ ] **Step 3: On the owner's word, ship.**

---

# Part 3 — nmap's options (branch `nmap-options`)

Spec §5.

### Task 3.1: The tests

**Files:** `scripts/nmap-command.test.js`, `scripts/shell-commands.test.js`, `scripts/nmap-changes.test.js`

- [ ] **Step 1: Branch and apply**

```bash
git switch master && git pull --ff-only && git switch -c nmap-options
git apply docs/superpowers/plans/2026-09-28-scan-workflow/3-nmap-options-tests.patch
```

- [ ] **Step 2: Run them, and see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 9`, among them *the blocks stand in four groups…*, *what is typed into the command is held to its shape, or refused*, *a window, FIN, NULL or Xmas scan says what a filter passes, and draws no port*.

### Task 3.2: The blocks, the typed texts, the scans of filters

**Files:** `assets/js/nmap-command.js`, `assets/js/nmap-read.js`, `assets/js/nmap-changes.js`, `assets/js/nmap-plan.js`, `assets/js/nmap-ui.js`, `assets/css/60-architecture.css`

**Interfaces:**
- Consumes: `drawnPorts` of part 2 (the dialog hands it to `command` as `extra.asDrawn`).
- Produces: `GROUPS`; 19 blocks, each with `group`; `choice.field`; `command` with `extra.asDrawn`, `extra.self`, the typed texts, and `warning` in what it returns; `R.passing(scan)`.

- [ ] **Step 1: Apply**

```bash
git apply docs/superpowers/plans/2026-09-28-scan-workflow/3-nmap-options-code.patch
```

- [ ] **Step 2: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# pass 866`, `# fail 0`.

- [ ] **Step 3: Probe what is offered, against 127.0.0.1, without root**

```bash
for a in "-n" "-R --dns-servers 127.0.0.53" "--system-dns" "--exclude 127.0.0.2" "-e lo" "--top-ports 20" "-sV --version-light" "-sV --version-all" "-PS22,80,443,445 -PA80,443" "-T5" "--max-retries 1" "--max-retries 0" "--host-timeout 15m" "--host-timeout 1h" "--max-rate 100" "--min-rate 100" "--scan-delay 1s"; do
  nmap -sT -p 22 $a -oX - 127.0.0.1 > /dev/null 2>&1; echo "$? nmap $a"
done
```

Expected: `0` before every line (probed with nmap 7.92, 2026-09-28). What needs root (`-PU`, `-sU`, `-sA`, `-sW`, `-sF`, `-sN`, `-sX`, `-O`, and `-PE -PP -PM`, which falls back with a warning) is marked `root` in the table and is not run by the agent.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "nmap's options: nineteen blocks in four groups, what is typed held to its shape"
```

### Task 3.3: The owner looks, and the part lands

- [ ] **Step 1: All checks**, as in Task 1.3 Step 1.

- [ ] **Step 2: The preview**, and say to the owner:

1. In nmap's dialog open *Adjust*: four groups, *Finding hosts*, *Ports*, *Depth*, *Pace*. Opening one closes the other; a closed group says what is set in it.
2. *Finding hosts › Names › by a resolver of yours*: a field appears; the command has no `--dns-servers` until an address stands in it, and says what to give.
3. *Ports › Ports › as drawn* with targets that have ports drawn: the command lists them. With none: *Nothing is drawn there yet; choose 1000 most common.*
4. *Ports › TCP scan › FIN*: the hint says *says what a filter passes, not what is open*; the command starts with `sudo`.
5. *Pace › Pace › insane*: the warning stands under the command.
6. nuclei's *Adjust* is as it was.

- [ ] **Step 3: On the owner's word, ship.**

---

# Part 4 — nmap's purposes (branch `nmap-purposes`)

Spec §6.

### Task 4.1: The tests and fixtures

**Files:** `scripts/nmap-command.test.js`, `scripts/nmap-devices.test.js` (new), `scripts/fixtures/nmap/snmp.xml`, `announced.xml`, `imported-snmp.doc.json` (new), `crates/effractor-format/tests/json.rs`, `crates/effractor-server/src/shell.rs`, `scripts/check-nmap-wasm.js`

- [ ] **Step 1: Branch and apply**

```bash
git switch master && git pull --ff-only && git switch -c nmap-purposes
git apply docs/superpowers/plans/2026-09-28-scan-workflow/4-nmap-purposes-tests.patch
```

- [ ] **Step 2: Run them, and see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 5`: *thirteen recipes by purpose…*, *each new purpose alone prints the scan it names*, *the new purposes combine with the others…*, *the purposes that tell are read back…*, and `scripts/nmap-devices.test.js` (its module is missing).

### Task 4.2: The purposes, the two readers, what an import draws of them

**Files:** `assets/js/nmap-command.js`, `assets/js/nmap-devices.js` (new), `assets/js/nmap-read.js`, `assets/js/nmap-plan.js`, `assets/js/nmap-connect.js`, `assets/js/nmap-ui.js`, `crates/effractor-server/templates/shell.html`

**Interfaces:**
- Consumes: `extra.asDrawn` and `choice.field` of part 3; `setTargets` of part 2.
- Produces: `RECIPES` with `still`, `announced`, `udp`, `snmp`, `managed`, `vpn`, each with `sets` and, where it has them, `ports`, `scripts`, `scripts6`, `scriptArgs`, `root`, `targets`; `combine(…).recipes`; `Dv.gateways(scripts)`, `Dv.prefixOf(netmask)`, `Dv.interfaces(output)`; `scan.pre`; `row.interfaces`, `row.gains`; networks named `"new:<cidr>"` in `row.networks`.

- [ ] **Step 1: Apply**

```bash
git apply docs/superpowers/plans/2026-09-28-scan-workflow/4-nmap-purposes-code.patch
```

- [ ] **Step 2: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# pass 879`, `# fail 0`.

Run: `cargo test -p effractor-format --test json && cargo test -p effractor-server --lib shell`
Expected: all pass, *the_nmap_snmp_import_fixture_is_a_valid_architecture* among them.

Run: `scripts/build-wasm.sh && node scripts/check-nmap-wasm.js`
Expected: `scanner imports: the imported documents save and validate in wasm`.

- [ ] **Step 3: The scripts are there and ask no third party**

```bash
for s in broadcast-dhcp-discover broadcast-ping broadcast-dns-service-discovery broadcast-upnp-info targets-ipv6-multicast-echo targets-ipv6-multicast-slaac targets-ipv6-multicast-mld snmp-interfaces; do
  f=/usr/share/nmap/scripts/$s.nse; test -f $f && grep -o 'categories = {[^}]*}' $f | grep -v external > /dev/null && echo "ok $s" || echo "NO $s"
done
```

Expected: `ok` before every name.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Six purposes more for nmap; a DHCP answer's router and SNMP's interfaces are drawn"
```

### Task 4.3: Probes the owner runs

Two commands need root and a real device; the agent runs neither. Ask the owner to copy each from the dialog, run it, and paste the result into the dialog and into the session:

1. *Who announces itself*, on their own LAN.
2. *Routers by SNMP*, aimed at their router, if it answers SNMP.

- [ ] **Step 1:** With each result, compare its shape with the fixture (`<prescript>` with `broadcast-dhcp-discover` and its `Router` element; `snmp-interfaces` as text in `output`, lines `IP address: …  Netmask: …` and `Status: …`). Where it differs, change the reader test-first and say so.
- [ ] **Step 2:** Replace the hand-written fixture by the recorded one, with addresses, names and MACs rewritten to the lab's; rewrite the pinned document (`NMAP_FIXTURE=write npm test`), read its diff, run all checks.
- [ ] **Step 3:** If the owner has no such result, the hand-written fixtures stay, their first line says so, and `docs/HANDOFF.md` lists it as open.

### Task 4.4: The owner looks, and the part lands

- [ ] **Step 1: All checks**, as in Task 1.3 Step 1.

- [ ] **Step 2: The preview**, and say to the owner:

1. nmap's dialog has six tiles more: *Is it still so*, *Who announces itself*, *UDP services*, *Routers by SNMP*, *Management interfaces*, *VPN endpoints*.
2. Tick *Is it still so* with a whole network as target: the targets turn to its drawn hosts, the ports to those drawn.
3. Paste `scripts/fixtures/nmap/snmp.xml`: the first host is offered as a router (*nmap: 3 interfaces by SNMP*), a line lists its interfaces, the summary counts one network.
4. Under *How it connects* one unticked row: *udp/161 on gw.lab is open to the scanner · “gw.lab” is administered from …*.
5. Add, and look at the canvas: the router on its box, on three networks.
6. Paste `scripts/fixtures/nmap/announced.xml`: the first host is offered as a router (*nmap: gateway by DHCP*).

- [ ] **Step 3: On the owner's word, ship.**

---

# Part 5 — the bulb (branch `scan-hint`)

Spec §2.

### Task 5.1: The tests

**Files:** `scripts/scan-gaps.test.js` (new), `scripts/nmap.test.js`, `crates/effractor-server/src/shell.rs`

- [ ] **Step 1: Branch and apply**

```bash
git switch master && git pull --ff-only && git switch -c scan-hint
git apply docs/superpowers/plans/2026-09-28-scan-workflow/5-scan-hint-tests.patch
```

- [ ] **Step 2: Run them, and see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 2`: `scripts/scan-gaps.test.js` (its module is missing) and *the bulb says to scan with nmap on an architecture until it has a scanner…*.

### Task 5.2: The steps and the bulb

**Files:** `assets/js/scan-gaps.js` (new), `assets/js/scan-hint-ui.js` (new), `assets/js/scan-targets.js`, `assets/js/nmap-ui.js`, `assets/js/nmap.js`, `crates/effractor-server/templates/shell.html`

**Interfaces:**
- Consumes: `words`, `drawnPorts`, `hostsOn` of `scan-targets.js`; the purposes of part 4 (`route`, `snmp`, `managed`, `lan`, `services`) and nuclei's (`identify`, `connect`); `open(appId, preset)` of part 2.
- Produces: `steps`, `silenced`, `IDS`, `WIDE`; `window.effractorNmapUi`; `#nmap-hint-says`; in the browser `effractor.hint.silenced`.

- [ ] **Step 1: Apply**

```bash
git apply docs/superpowers/plans/2026-09-28-scan-workflow/5-scan-hint-code.patch
```

- [ ] **Step 2: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# pass 892`, `# fail 0`.

Run: `cargo test -p effractor-server --lib shell`
Expected: pass.

- [ ] **Step 3: Read what the patch deleted from the DOM files**

Run: `git diff -- assets/js/nmap-ui.js assets/js/nmap.js | grep '^-'`
Expected: the section *the light bulb* of `nmap-ui.js` (`HINT`, `dismissed`, `showHint`, its three listeners), `createNmap`, the two `preset` lines of part 2, and `hintWanted` with its export in `nmap.js`. Nothing else.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "The bulb names what to run next, from what the drawing lacks"
```

### Task 5.3: The owner looks

- [ ] **Step 1: All checks**, as in Task 1.3 Step 1.

- [ ] **Step 2: The preview**, and say to the owner:

1. An empty architecture: the bulb says *Scan a network with nmap*, as before.
2. Draw a network with a range and add nmap on a host of it: the bulb says *… not scanned · nmap*. A click opens nmap with *Who is on this LAN* and *What runs there* ticked and the whole range as target.
3. Import a scan: the bulb says the next step by itself, *n hosts not asked how they connect · nuclei*. A click adds nuclei beside nmap and opens it with both of effractor's templates ticked.
4. Right click on the bulb: the other steps, *Say nothing about this*, and *Say it again* where something is silenced.
5. × silences the step named; the next one is said.
6. With every step silenced the bulb is gone; a right click on the canvas offers *Say what to scan next*.
7. A drawing with a second network and no router between: *No way drawn to … · nmap*.

### Task 5.4: The hand-off, and the item is done

**Files:** `ROADMAP.md`, `docs/HANDOFF.md`, `docs/superpowers/specs/2026-09-28-scan-workflow-design.md`, `docs/superpowers/plans/2026-09-28-scan-workflow.md`, `docs/superpowers/plans/2026-09-28-scan-workflow/`

- [ ] **Step 1:** `python3 scripts/dev/roadmap-done.py scan-workflow`, then `node scripts/check-roadmap.js`.
- [ ] **Step 2:** In `docs/HANDOFF.md`, a section *Continuation — scanners that build on each other* at the top, in the manner of the sections there: what each module holds, the owner's decisions with their dates, what the owner looked at and what landed unseen, the deferred minors of the reviews, what is open (recorded fixtures of *Who announces itself* and *Routers by SNMP*; the network where nobody answered).
- [ ] **Step 3:** Delete the spec, this plan and the patches (`git rm -r`); the hand-off says how to read them from history.
- [ ] **Step 4: On the owner's word, ship.**

---

## After every part

One fresh reviewer reads the part's diff against the spec before the owner looks; what matters is fixed test-first, the rest is listed in the PR body and the hand-off as deferred.
