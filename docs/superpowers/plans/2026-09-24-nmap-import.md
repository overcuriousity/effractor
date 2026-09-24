# nmap import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place an nmap application on a host, paste the XML of a scan the
dialog offers, preview what it saw, and add the ticked hosts, services,
products, networks and flows to the architecture in one edit.

**Architecture:** Two optional entity fields (`addresses`, `tool`) enter the
Rust model and file format in place. Everything nmap-specific is one pure JS
module, `assets/js/nmap.js` (commands, a small XML reader, planning, applying
as a pure edit with the `architecture-edit.js` contract), Node-tested against
real nmap output; `assets/js/nmap-ui.js` is the dialog, checked by the
owner's eye. wasm validates the applied document like any other edit.

**Tech Stack:** Rust 2024 (`effractor-core`, `effractor-format`), vanilla
ES5-style JS in IIFEs (`node --test`), a `<dialog>` in
`crates/effractor-server/templates/shell.html`, CSS in `assets/css/`.

**Spec:** [`docs/superpowers/specs/2026-09-24-nmap-import-design.md`](../specs/2026-09-24-nmap-import-design.md)
— read it whole before Task 1; this plan argues from it.

## Global Constraints

- Read `AGENTS.md`, `CONTRIBUTING.md`, `docs/HANDOFF.md` first. Work lands by
  branch → PR → CI green for that exact commit → signed fast-forward of
  master; never the merge button. The owner runs the push to master.
- Three PRs, one branch each: `feature/nmap-fields` (Task 1),
  `feature/nmap-module` (Tasks 2–5), `feature/nmap-dialog` (Tasks 6–7). Each
  starts from master after the one before is released.
- Checks before every PR: `npm test`, `cargo test --workspace`,
  `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `node scripts/check-roadmap.js`. `scripts/build-wasm.sh` must have run once.
- Formats change in place, no version bump; every existing file and shared
  link keeps opening (`crates/effractor-format/tests/fixtures/shared/`).
- `core`/`format` have no I/O and compile to wasm32; no panics on user input;
  unknown YAML keys are errors (except `x-`).
- No third-party origins, no telemetry, no bundler, vanilla CSS + JS.
- Test-first for every unit. UI is checked by the owner in a preview on port
  8081 or 8082; do not drive the owner's browser.
- Words on the page are plain (`docs/HANDOFF.md`, "plain vocabulary"); quiet
  chrome, no button walls.
- Everything read from a scan is untrusted text: set with `textContent` /
  `value`, never `innerHTML`.
- Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  commits are signed (`git commit -S`).

## Review Focus

1. **A partial paste** (terminal scrollback cut off, Ctrl-C'd run) — the
   user expects "the result ends early", not a silent half import. Pinned in
   Task 3 (`truncated` tests).
2. **A range that smuggles an option or shell syntax** (`-iL /etc/shadow`,
   `10.0.0.1; rm -rf ~`, `$(…)`) — the copied command must never carry it.
   Pinned in Task 2.
3. **A big network** (`/16`, or 60 hosts × 20 ports) past 500 components or
   2000 associations+flows — the user expects to be told and to untick, not
   an Add that wasm then refuses. Pinned in Task 4 (`summary` limits).
4. **A hostile or odd PTR name** (`<img src=x onerror=…>`, 300 characters,
   non-ASCII) — shown as text, id still valid. Pinned in Task 3 (read keeps
   it verbatim) and Task 5 (applied doc has a valid id); the UI rule is in
   Task 7.
5. **Scanning again from the same nmap, or the same host from two nmaps** —
   nothing doubled: known hosts, known services and existing flows add
   nothing; a second nmap adds only its own flows. Pinned in Tasks 4 and 5.

---

## PR 1 — `feature/nmap-fields`

### Task 1: `addresses` and `tool` in the model and the file

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs` (struct `Entity` near
  line 435, `Entity::new`)
- Modify: `crates/effractor-format/src/architecture_read.rs` (`fn entity`
  near line 193; new helpers and `TOOLS` beside `KINDS`)
- Modify: `crates/effractor-format/src/architecture_write.rs` (entity block
  near line 60; import `TOOLS`)
- Test: `crates/effractor-format/tests/architecture.rs`
- Modify: `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` §4:
  one paragraph naming the two optional fields and linking the nmap spec.

**Interfaces:**
- Produces: `effractor_core::architecture::Tool { Nmap }` with
  `as_str() -> &'static str`; `Entity.addresses: Vec<String>`,
  `Entity.tool: Option<Tool>`. JSON image: `"addresses": ["10.0.1.5"]` on
  host/network, `"tool": "nmap"` on application, written after `description`.

- [ ] **Step 1: Write the failing tests** (append to
  `crates/effractor-format/tests/architecture.rs`; it already has `image`,
  `errors_of`, `has`, `LECTURE`, `canonicalize`, `from_document` in scope)

```rust
#[test]
fn hosts_and_networks_carry_addresses_and_an_application_may_be_nmap() {
    let mut image = image(LECTURE);
    image["entities"]["server"]["addresses"] = serde_json::json!(["10.0.1.5", "fd00::5"]);
    image["entities"]["server-net"]["addresses"] =
        serde_json::json!(["10.0.1.0/24", "fd00::/64"]);
    image["entities"]["ssh-client"]["tool"] = serde_json::json!("nmap");
    let text = from_document(&image).unwrap();
    assert!(text.contains("    label: Server\n    addresses: ["), "{text}");
    assert!(text.contains("    label: SSH client\n    tool: nmap\n"), "{text}");
    assert_eq!(canonicalize(&text).unwrap(), text);
    let back = self::image(&text);
    assert_eq!(back["entities"]["server"]["addresses"], serde_json::json!(["10.0.1.5", "fd00::5"]));
    assert_eq!(
        back["entities"]["server-net"]["addresses"],
        serde_json::json!(["10.0.1.0/24", "fd00::/64"])
    );
    assert_eq!(back["entities"]["ssh-client"]["tool"], serde_json::json!("nmap"));
    // Absent is absent: the reference file does not change.
    assert_eq!(canonicalize(LECTURE).unwrap(), LECTURE);
}

#[test]
fn addresses_and_tool_are_refused_where_they_do_not_belong() {
    let cases: [(&str, &str, serde_json::Value, &str, &str); 7] = [
        ("sshd", "addresses", serde_json::json!(["10.0.1.5"]), "misplaced-key", "entities.sshd.addresses"),
        ("server", "tool", serde_json::json!("nmap"), "misplaced-key", "entities.server.tool"),
        ("ssh-client", "tool", serde_json::json!("wireshark"), "wrong-type", "entities.ssh-client.tool"),
        ("server", "addresses", serde_json::json!(["10.0.1.0/24"]), "wrong-type", "entities.server.addresses[0]"),
        ("server", "addresses", serde_json::json!(["10.0.1.5", "srv-01"]), "wrong-type", "entities.server.addresses[1]"),
        ("server-net", "addresses", serde_json::json!(["10.0.1.5"]), "wrong-type", "entities.server-net.addresses[0]"),
        ("server-net", "addresses", serde_json::json!(["10.0.1.0/33"]), "wrong-type", "entities.server-net.addresses[0]"),
    ];
    for (entity, key, value, code, path) in cases {
        let mut image = image(LECTURE);
        image["entities"][entity][key] = value;
        let errors = errors_of(&image);
        assert!(has(&errors, code, path), "{entity}.{key}: {errors:?}");
    }
    let mut image = image(LECTURE);
    image["entities"]["server"]["addresses"] = serde_json::json!("10.0.1.5");
    assert!(!errors_of(&image).is_empty(), "a list, not one text");
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p effractor-format --test architecture addresses`
Expected: FAIL — `addresses` is an unknown key (`unknown-key`), so
`from_document` errs in the first test and the codes differ in the second.

- [ ] **Step 3: The model** — in `crates/effractor-core/src/architecture.rs`,
  beside `Entity`:

```rust
/// What a special application is (nmap import spec §2.2). It changes nothing
/// in generation; it says which menus the application offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Nmap,
}

impl Tool {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Nmap => "nmap",
        }
    }
}
```

and in `pub struct Entity`, after `description`:

```rust
    /// IP addresses of a host, CIDR ranges of a network; empty elsewhere.
    pub addresses: Vec<String>,
    /// Only on an application.
    pub tool: Option<Tool>,
```

`Entity::new` sets `addresses: Vec::new(), tool: None`. Fix every other
`Entity { .. }` literal the compiler names (the reader is the only other one).

- [ ] **Step 4: The reader** — in `architecture_read.rs`, next to `KINDS`:

```rust
pub(crate) const TOOLS: [(&str, Tool); 1] = [("nmap", Tool::Nmap)];
```

(match `KINDS`'s visibility and tuple type exactly; import `Tool`). In
`fn entity`, allow the keys:

```rust
        &["kind", "label", "description", "addresses", "tool", "parameters", "defenses"],
```

after `let kind = kind?;` read them:

```rust
    let addresses = match f.get("addresses") {
        Some(e) => addresses(cx, e, &f.path("addresses"), kind),
        None => Some(Vec::new()),
    };
    let tool = match f.get("tool") {
        Some(e) => tool(cx, e, &f.path("tool"), kind),
        None => Some(None),
    };
```

set `addresses: addresses?, tool: tool?,` in the `Entity` literal, and add:

```rust
/// A host's IP addresses or a network's CIDR ranges (nmap import spec §2.1).
fn addresses(cx: &mut Cx, entry: &Entry, path: &str, kind: EntityKind) -> Option<Vec<String>> {
    let cidr = match kind {
        EntityKind::Host => false,
        EntityKind::Network => true,
        _ => {
            let message = format!("`addresses` is not a field of a `{}`", kind.as_str());
            cx.error(Code::MisplacedKey, path, entry.key_pos, message);
            return None;
        }
    };
    let items = cx.list(&entry.value, path)?;
    let mut out = Vec::new();
    let mut ok = true;
    for (i, item) in items.iter().enumerate() {
        let at = format!("{path}[{i}]");
        let Some(text) = cx.string(item, &at) else {
            ok = false;
            continue;
        };
        let valid = if cidr {
            is_cidr(&text)
        } else {
            text.parse::<std::net::IpAddr>().is_ok()
        };
        if valid {
            out.push(text);
        } else {
            let want = if cidr {
                "a CIDR range such as 10.0.0.0/24"
            } else {
                "an IP address such as 10.0.0.5"
            };
            cx.error(Code::WrongType, at, item.pos, format!("expected {want}, found {text:?}"));
            ok = false;
        }
    }
    ok.then_some(out)
}

fn is_cidr(text: &str) -> bool {
    let Some((ip, bits)) = text.split_once('/') else {
        return false;
    };
    let Ok(ip) = ip.parse::<std::net::IpAddr>() else {
        return false;
    };
    let max = if ip.is_ipv4() { 32 } else { 128 };
    (1..=3).contains(&bits.len())
        && bits.bytes().all(|b| b.is_ascii_digit())
        && bits.parse::<u8>().is_ok_and(|b| b <= max)
}

/// Only an application names a tool.
fn tool(cx: &mut Cx, entry: &Entry, path: &str, kind: EntityKind) -> Option<Option<Tool>> {
    if kind != EntityKind::Application {
        let message = format!("`tool` is not a field of a `{}`", kind.as_str());
        cx.error(Code::MisplacedKey, path, entry.key_pos, message);
        return None;
    }
    cx.word(&entry.value, path, &TOOLS).map(Some)
}
```

If `EntityKind::as_str` is named differently, use what the association
`MisplacedKey` message near line 320 uses for kinds.

- [ ] **Step 5: The writer** — in `architecture_write.rs`, import `TOOLS`,
  and right after the `description` line:

```rust
        if !entity.addresses.is_empty() {
            let items: Vec<String> = entity
                .addresses
                .iter()
                .map(|a| string(a, Context::FlowValue))
                .collect();
            w.line(4, "addresses", &format!("[{}]", items.join(", ")));
        }
        if let Some(tool) = &entity.tool {
            w.line(4, "tool", word(&TOOLS, tool));
        }
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p effractor-format --test architecture addresses`
Expected: PASS. If `fd00::5` does not read back, `Context::FlowValue` does not
quote a leading or doubled `:` — quote in `string` for that context rather
than special-casing addresses, and keep the shared-link fixtures passing.

- [ ] **Step 7: Everything else still holds**

Run: `cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && npm test`
Expected: all PASS; no fixture changed (`git status` shows only the files above).

- [ ] **Step 8: Spec note and commit**

Add to the lecture design §4 one paragraph: hosts and networks may carry
`addresses`, an application `tool: nmap`, per the nmap import design.

```bash
git switch -c feature/nmap-fields
git add crates/effractor-core/src/architecture.rs crates/effractor-format/src/architecture_read.rs crates/effractor-format/src/architecture_write.rs crates/effractor-format/tests/architecture.rs docs/superpowers/specs/2026-09-21-lecture-workflow-design.md
git commit -S -m "Let hosts and networks carry addresses and an application be nmap"
```

Open the PR; after CI is green and the owner releases it, continue from
master.

---

## PR 2 — `feature/nmap-module`

`assets/js/nmap.js` is built over Tasks 2–5. Its skeleton (Task 2 creates it):

```js
// nmap results into the architecture (docs/superpowers/specs/
// 2026-09-24-nmap-import-design.md): the commands the dialog offers, the XML
// they print read into a scan, the preview planned against the document, and
// the ticked rows applied as one edit with the contract of
// architecture-edit.js. Pure: no DOM, no wasm; wasm says whether the result
// is valid.
(function () {
  var node = typeof module !== "undefined";
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
  var L = node ? require("./architecture-links.js") : window.effractorArchitectureLinks;

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  // … Task 2–5 code here …

  var api = { LEVELS: LEVELS, level: level, command: command, read: read, bytes: bytes, inCidr: inCidr, plan: plan, defaults: defaults, summary: summary, apply: apply, addNmap: addNmap, stampLine: stampLine };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmap = api;
})();
```

Add each name to `api` in the task that defines it (Task 2 starts with
`LEVELS, level, command`).

### Task 2: Scan levels and the command

**Files:**
- Create: `assets/js/nmap.js`
- Test: `scripts/nmap.test.js`

**Interfaces:**
- Produces: `LEVELS` — array of `{id, name, root, time, finds, args}` in the
  order discover, standard, deep, complete; `level(id) → entry | null`;
  `command(levelId, range) → {text} | {problem}`.

- [ ] **Step 1: Write the failing test** (`scripts/nmap.test.js`)

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../assets/js/nmap.js');

test('four levels, Standard first offered, root only where the scan needs it', () => {
  assert.deepEqual(N.LEVELS.map(l => l.id), ['discover', 'standard', 'deep', 'complete']);
  assert.deepEqual(N.LEVELS.map(l => l.root), [false, false, true, true]);
  assert.equal(N.level('standard').name, 'Standard');
  assert.equal(N.level('nope'), null);
});

test('each level prints XML to the terminal for the range', () => {
  const r = '10.0.1.0/24';
  assert.equal(N.command('discover', r).text, 'nmap -sn -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', r).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(N.command('deep', r).text, 'sudo nmap -sS -sU -sV -O --top-ports 1000 -oX - 10.0.1.0/24');
  assert.equal(N.command('complete', r).text, 'sudo nmap -sS -sU -sV -O -p T:1-65535,U:1-1024 -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', '  10.0.1.0/24   fd00::/64 ').text, 'nmap -sT -sV -oX - 10.0.1.0/24 fd00::/64');
  assert.equal(N.command('standard', 'srv-01.lab,10.0.2.1-20').text, 'nmap -sT -sV -oX - srv-01.lab,10.0.2.1-20');
});

test('a range never carries shell syntax or an nmap option', () => {
  for (const bad of ['10.0.0.1; rm -rf ~', '$(id)', '10.0.0.1 | tee x', '`id`', "10.0.0.1'", '10.0.0.1 -iL /etc/shadow', '-oN x 10.0.0.1', '10.0.0.1\n-sC']) {
    const c = N.command('standard', bad);
    assert.equal(c.text, undefined, bad);
    assert.match(c.problem, /range/, bad);
  }
  assert.match(N.command('standard', '   ').problem, /range/);
  assert.equal(N.command('bogus', '10.0.0.1'), null);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test scripts/nmap.test.js`
Expected: FAIL — `Cannot find module '../assets/js/nmap.js'`.

- [ ] **Step 3: Implement** (inside the skeleton)

```js
  // Spec §3.2. `finds` and `time` are the dialog's one line per level.
  var LEVELS = [
    { id: "discover", name: "Discover", root: false, time: "seconds", finds: "hosts", args: "-sn" },
    { id: "standard", name: "Standard", root: false, time: "minutes", finds: "hosts, top 1000 TCP ports, services, products", args: "-sT -sV" },
    { id: "deep", name: "Deep", root: true, time: "tens of minutes", finds: "hosts, top 1000 TCP and UDP ports, services, products, OS guess", args: "-sS -sU -sV -O --top-ports 1000" },
    { id: "complete", name: "Complete", root: true, time: "hours", finds: "hosts, every TCP port, UDP 1–1024, services, products, OS guess", args: "-sS -sU -sV -O -p T:1-65535,U:1-1024" },
  ];

  function level(id) {
    return LEVELS.filter(function (l) { return l.id === id; })[0] || null;
  }

  // Addresses, names, ranges and CIDR only; no word may start with "-",
  // which nmap would take as an option.
  var RANGE_CHARS = /^[0-9A-Za-z.:\/,\- ]+$/;
  function command(levelId, range) {
    var l = level(levelId);
    if (!l) return null;
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { problem: "Give the range to scan, such as 10.0.1.0/24." };
    var text = words.join(" ");
    if (!RANGE_CHARS.test(text) || words.some(function (w) { return w[0] === "-"; })) {
      return { problem: "The range may hold only addresses, names, ranges and CIDR, such as 10.0.1.0/24." };
    }
    return { text: (l.root ? "sudo " : "") + "nmap " + l.args + " -oX - " + text };
  }
```

Note `'10.0.0.1\n-sC'`: splitting on whitespace yields `-sC`, refused by the
leading-dash rule.

- [ ] **Step 4: Run it**

Run: `node --test scripts/nmap.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git switch -c feature/nmap-module
git add assets/js/nmap.js scripts/nmap.test.js
git commit -S -m "Offer nmap commands at four scan levels"
```

### Task 3: Reading nmap's XML

**Files:**
- Modify: `assets/js/nmap.js`
- Create: `scripts/fixtures/nmap/standard-localhost.xml`,
  `discover-localhost.xml`, `deep-lab.xml`, `error.xml`, `down.xml`,
  `truncated.xml`, `normal.txt`, `hostile.xml`
- Test: `scripts/nmap.test.js`

**Interfaces:**
- Produces: `read(text) → {scan} | {problem: {code, message}}` where
  `code ∈ "empty" | "not-xml" | "normal-output" | "not-nmap" | "truncated" | "nmap-error" | "no-host-up"`
  and
  `scan = {args, hosts: [{addresses: [ip…], hostname: string|null, os: {name, accuracy}|null, ports: [{protocol, port, state, service: {name, product, version}|null}]}], silentUdp}`.
  `silentUdp` counts UDP ports in state `open|filtered` over all hosts.
  `service` fields absent in the XML are `null`; `ports` is `[]` for a
  discover scan.

- [ ] **Step 1: Record the real fixtures** (nmap 7.92 is installed; no root
  needed for these two; scanning your own machine only):

```bash
mkdir -p scripts/fixtures/nmap
nmap -sT -sV --top-ports 100 -oX - 127.0.0.1 > scripts/fixtures/nmap/standard-localhost.xml
nmap -sn -oX - 127.0.0.1 > scripts/fixtures/nmap/discover-localhost.xml
nmap -sT --top-ports 100 127.0.0.1 > scripts/fixtures/nmap/normal.txt
head -c 1500 scripts/fixtures/nmap/standard-localhost.xml > scripts/fixtures/nmap/truncated.xml
```

Open `standard-localhost.xml` and note which ports are open and what
`<service>` says for each: the test below reads them from the file rather
than hard-coding this machine's services. It has a `<hosthint>` block before
`<host>` — keep it; the test depends on it.

Write the other fixtures by hand in nmap's real shape (these need root or a
lab network to record):

`scripts/fixtures/nmap/deep-lab.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<!-- Nmap 7.92 scan initiated as: nmap -sS -sU -sV -O -&#45;top-ports 1000 -oX - 10.0.1.0/24 -->
<nmaprun scanner="nmap" args="nmap -sS -sU -sV -O -&#45;top-ports 1000 -oX - 10.0.1.0/24" start="1790257747" version="7.92" xmloutputversion="1.05">
<hosthint><status state="up" reason="arp-response" reason_ttl="0"/>
<address addr="10.0.1.5" addrtype="ipv4"/>
<hostnames>
</hostnames>
</hosthint>
<host><status state="up" reason="arp-response" reason_ttl="0"/>
<address addr="10.0.1.5" addrtype="ipv4"/>
<address addr="52:54:00:12:34:56" addrtype="mac" vendor="QEMU virtual NIC"/>
<hostnames>
<hostname name="srv-01.lab" type="PTR"/>
</hostnames>
<ports><extraports state="closed" count="1996"></extraports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack" reason_ttl="64"/><service name="ssh" product="OpenSSH" version="9.6p1" extrainfo="protocol 2.0" method="probed" conf="10"><cpe>cpe:/a:openbsd:openssh:9.6p1</cpe></service></port>
<port protocol="tcp" portid="8443"><state state="open" reason="syn-ack" reason_ttl="64"/></port>
<port protocol="udp" portid="53"><state state="open" reason="udp-response" reason_ttl="64"/><service name="domain" product="dnsmasq" version="2.90" method="probed" conf="10"/></port>
<port protocol="udp" portid="123"><state state="open|filtered" reason="no-response" reason_ttl="0"/><service name="ntp" method="table" conf="3"/></port>
<port protocol="udp" portid="161"><state state="open|filtered" reason="no-response" reason_ttl="0"/><service name="snmp" method="table" conf="3"/></port>
</ports>
<os><osmatch name="Linux 5.0 - 5.4" accuracy="96" line="67000"></osmatch><osmatch name="Linux 4.15" accuracy="90" line="66000"></osmatch></os>
</host>
<host><status state="up" reason="arp-response" reason_ttl="0"/>
<address addr="10.0.1.7" addrtype="ipv4"/>
<hostnames>
</hostnames>
<ports><port protocol="tcp" portid="22"><state state="open" reason="syn-ack" reason_ttl="64"/><service name="ssh" product="OpenSSH" version="9.6p1" method="probed" conf="10"/></port>
<port protocol="tcp" portid="80"><state state="filtered" reason="no-response" reason_ttl="0"/><service name="http" method="table" conf="3"/></port>
</ports>
</host>
<host><status state="down" reason="no-response" reason_ttl="0"/>
<address addr="10.0.1.9" addrtype="ipv4"/>
</host>
<runstats><finished time="1790259000" elapsed="1253.10" exit="success"/><hosts up="2" down="254" total="256"/>
</runstats>
</nmaprun>
```

`scripts/fixtures/nmap/error.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sS -oX - 10.0.1.0/24" version="7.92" xmloutputversion="1.05">
<runstats><finished time="1790257747" elapsed="0.01" exit="error" errormsg="You requested a scan type which requires root privileges.&#10;QUITTING!"/><hosts up="0" down="0" total="0"/>
</runstats>
</nmaprun>
```

`scripts/fixtures/nmap/down.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sn -oX - 10.9.9.0/30" version="7.92" xmloutputversion="1.05">
<runstats><finished time="1790257747" elapsed="3.02" exit="success"/><hosts up="0" down="4" total="4"/>
</runstats>
</nmaprun>
```

`scripts/fixtures/nmap/hostile.xml` (a PTR name is whatever its DNS says):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sT -sV -oX - 10.0.3.0/24" version="7.92" xmloutputversion="1.05">
<host><status state="up" reason="syn-ack" reason_ttl="0"/>
<address addr="10.0.3.4" addrtype="ipv4"/>
<hostnames><hostname name="&lt;img src=x onerror=alert(1)&gt;&amp;ünï" type="PTR"/></hostnames>
<ports><port protocol="tcp" portid="80"><state state="open" reason="syn-ack" reason_ttl="0"/><service name="http" product="x&quot;&gt;y" method="probed" conf="10"/></port></ports>
</host>
<runstats><finished time="1" elapsed="1" exit="success"/><hosts up="1" down="0" total="1"/></runstats>
</nmaprun>
```

- [ ] **Step 2: Write the failing tests** (append to `scripts/nmap.test.js`)

```js
const fs = require('node:fs');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');

test('a real Standard scan reads its hosts, open ports and services; hints are not hosts', () => {
  const text = fixture('standard-localhost.xml');
  const { scan } = N.read(text);
  assert.equal(scan.hosts.length, 1, 'the <hosthint> is not a second host');
  const h = scan.hosts[0];
  assert.deepEqual(h.addresses, ['127.0.0.1']);
  assert.equal(h.hostname, 'localhost');
  assert.equal(h.os, null);
  const open = [...text.matchAll(/<port protocol="(\w+)" portid="(\d+)"><state state="open"/g)].map(m => m[1] + '/' + m[2]);
  assert.deepEqual(h.ports.filter(p => p.state === 'open').map(p => p.protocol + '/' + p.port), open);
  assert.ok(h.ports.every(p => p.service === null || typeof p.service.name === 'string'));
  assert.match(scan.args, /^nmap -sT -sV --top-ports 100 -oX - 127\.0\.0\.1$/, 'entities in attributes are decoded');
});

test('a discover scan has hosts without ports', () => {
  const { scan } = N.read(fixture('discover-localhost.xml'));
  assert.equal(scan.hosts.length, 1);
  assert.deepEqual(scan.hosts[0].ports, []);
});

test('a deep scan: MAC left out, TCP and UDP, products, OS guess, silent UDP counted, down hosts dropped', () => {
  const { scan } = N.read(fixture('deep-lab.xml'));
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.1.5'], ['10.0.1.7']]);
  const [srv, other] = scan.hosts;
  assert.equal(srv.hostname, 'srv-01.lab');
  assert.equal(other.hostname, null);
  assert.deepEqual(srv.os, { name: 'Linux 5.0 - 5.4', accuracy: 96 });
  assert.deepEqual(srv.ports.map(p => [p.protocol, p.port, p.state]), [
    ['tcp', 22, 'open'], ['tcp', 8443, 'open'], ['udp', 53, 'open'], ['udp', 123, 'open|filtered'], ['udp', 161, 'open|filtered'],
  ]);
  assert.deepEqual(srv.ports[0].service, { name: 'ssh', product: 'OpenSSH', version: '9.6p1' });
  assert.equal(srv.ports[1].service, null);
  assert.deepEqual(srv.ports[2].service, { name: 'domain', product: 'dnsmasq', version: '2.90' });
  assert.equal(scan.silentUdp, 2);
});

test('what is not a usable result says why', () => {
  const code = t => N.read(t).problem && N.read(t).problem.code;
  assert.equal(code(''), 'empty');
  assert.equal(code('   \n '), 'empty');
  assert.equal(code('hello'), 'not-xml');
  assert.equal(code(fixture('normal.txt')), 'normal-output');
  assert.equal(code('<?xml version="1.0"?><html><body/></html>'), 'not-nmap');
  assert.equal(code(fixture('truncated.xml')), 'truncated');
  assert.equal(code('<nmaprun><host>'), 'truncated');
  assert.equal(code('<nmaprun></host></nmaprun>'), 'not-xml');
  assert.equal(code(fixture('down.xml')), 'no-host-up');
  const error = N.read(fixture('error.xml')).problem;
  assert.equal(error.code, 'nmap-error');
  assert.match(error.message, /requires root privileges/);
  for (const t of ['', 'x', fixture('normal.txt'), '<a/>', '<nmaprun>', fixture('down.xml')]) {
    assert.ok(N.read(t).problem.message.length > 10, 'every problem is said in words');
  }
});

test('names from the network are kept verbatim, decoded, never interpreted', () => {
  const { scan } = N.read(fixture('hostile.xml'));
  assert.equal(scan.hosts[0].hostname, '<img src=x onerror=alert(1)>&ünï');
  assert.equal(scan.hosts[0].ports[0].service.product, 'x">y');
});

test('a byte-order mark and CRLF line ends read the same', () => {
  const text = fixture('deep-lab.xml');
  assert.deepEqual(N.read('﻿' + text.replace(/\n/g, '\r\n')), N.read(text));
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test scripts/nmap.test.js`
Expected: FAIL — `N.read is not a function`.

- [ ] **Step 4: Implement** (add to `nmap.js`, and `read` to `api`)

```js
  // ---- reading (spec §3.3) ----

  var ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return has(ENTITIES, e) ? ENTITIES[e] : m;
    });
  }

  // Where the tag opened at `lt` ends: the first ">" outside quotes, or -1.
  function tagEnd(text, lt) {
    var quote = null;
    for (var i = lt + 1; i < text.length; i++) {
      var c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") return i;
    }
    return -1;
  }

  // Elements and their attributes; text between tags is not needed. Returns
  // the document's root holder, or {error: "not-xml" | "truncated"}.
  var NAME = /^[A-Za-z_][-A-Za-z0-9_:.]*/;
  function parseXml(text) {
    var root = { name: "", attrs: {}, children: [] };
    var stack = [root];
    var i = 0;
    for (;;) {
      var lt = text.indexOf("<", i);
      if (lt < 0) break;
      var skip = text.startsWith("<!--", lt) ? "-->" : text.startsWith("<?", lt) ? "?>" : text.startsWith("<!", lt) ? ">" : null;
      if (skip) {
        var end = text.indexOf(skip, lt + 2);
        if (end < 0) return { error: "truncated" };
        i = end + skip.length;
        continue;
      }
      var gt = tagEnd(text, lt);
      if (gt < 0) return { error: "truncated" };
      var tag = text.slice(lt + 1, gt).trim();
      if (tag[0] === "/") {
        var name = tag.slice(1).trim();
        if (stack.length < 2 || stack[stack.length - 1].name !== name) return { error: "not-xml" };
        stack.pop();
      } else {
        var selfClosing = tag[tag.length - 1] === "/";
        if (selfClosing) tag = tag.slice(0, -1);
        var m = NAME.exec(tag);
        if (!m) return { error: "not-xml" };
        var el = { name: m[0], attrs: {}, children: [] };
        var ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        ATTR.lastIndex = m[0].length;
        var a;
        while ((a = ATTR.exec(tag))) el.attrs[a[1]] = decode(a[2] != null ? a[2] : a[3]);
        stack[stack.length - 1].children.push(el);
        if (!selfClosing) stack.push(el);
      }
      i = gt + 1;
    }
    return stack.length === 1 ? root : { error: "truncated" };
  }

  function kids(el, name) {
    return el ? el.children.filter(function (c) { return c.name === name; }) : [];
  }
  function kid(el, name) {
    return kids(el, name)[0] || null;
  }

  var PROBLEMS = {
    "empty": "Paste the output of the command above.",
    "not-xml": "This is not XML. The command writes XML with -oX -.",
    "normal-output": "This is nmap's normal output; run the command with -oX -.",
    "not-nmap": "This is not an nmap result.",
    "truncated": "The result ends early; copy the whole output, from <?xml to </nmaprun>.",
    "no-host-up": "No host answered. Check the range, or try from another host.",
  };
  function problem(code, detail) {
    return { problem: { code: code, message: code === "nmap-error" ? "nmap stopped: " + detail : PROBLEMS[code] } };
  }

  function serviceOf(port) {
    var s = kid(port, "service");
    if (!s) return null;
    return { name: s.attrs.name || null, product: s.attrs.product || null, version: s.attrs.version || null };
  }

  function hostOf(h) {
    var names = kids(kid(h, "hostnames"), "hostname");
    var match = kids(kid(h, "os"), "osmatch")[0];
    return {
      addresses: kids(h, "address").filter(function (a) {
        return a.attrs.addrtype === "ipv4" || a.attrs.addrtype === "ipv6";
      }).map(function (a) { return a.attrs.addr; }),
      hostname: names.length ? names[0].attrs.name || null : null,
      os: match ? { name: match.attrs.name, accuracy: Number(match.attrs.accuracy) } : null,
      ports: kids(kid(h, "ports"), "port").map(function (p) {
        var state = kid(p, "state");
        return { protocol: p.attrs.protocol, port: Number(p.attrs.portid), state: state ? state.attrs.state : "", service: serviceOf(p) };
      }),
    };
  }

  function read(text) {
    var t = String(text == null ? "" : text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!t) return problem("empty");
    if (t[0] !== "<") return problem(/Nmap scan report for|^# Nmap|^Host: /m.test(t) ? "normal-output" : "not-xml");
    var doc = parseXml(t);
    if (doc.error) return problem(doc.error);
    var run = kid(doc, "nmaprun");
    if (!run) return problem("not-nmap");
    var finished = kid(kid(run, "runstats"), "finished");
    if (!finished) return problem("truncated");
    if (finished.attrs.exit === "error") return problem("nmap-error", finished.attrs.errormsg || "no reason given");
    var hosts = kids(run, "host").filter(function (h) {
      var s = kid(h, "status");
      return s && s.attrs.state === "up";
    }).map(hostOf).filter(function (h) { return h.addresses.length; });
    if (!hosts.length) return problem("no-host-up");
    var silentUdp = 0;
    hosts.forEach(function (h) {
      h.ports.forEach(function (p) { if (p.protocol === "udp" && p.state === "open|filtered") silentUdp++; });
    });
    return { scan: { args: run.attrs.args || "", hosts: hosts, silentUdp: silentUdp } };
  }
```

`normal.txt` starts with `Starting Nmap`, so `t[0] !== "<"` holds and the
`Nmap scan report for` line marks it. `truncated.xml` is cut inside the
document, so either the stack is not empty or `<runstats>` is missing: both
say `truncated`.

- [ ] **Step 5: Run the tests**

Run: `node --test scripts/nmap.test.js`
Expected: PASS. If the Standard test fails on `scan.args`, check the
recorded file's `args` attribute and fix `decode`, not the test.

- [ ] **Step 6: Commit**

```bash
git add assets/js/nmap.js scripts/nmap.test.js scripts/fixtures/nmap
git commit -S -m "Read nmap's XML into hosts, ports and services"
```

### Task 4: Planning the preview

**Files:**
- Modify: `assets/js/nmap.js`
- Test: `scripts/nmap.test.js`

**Interfaces:**
- Consumes: `scan` from Task 3; the JSON image of an architecture.
- Produces:
  - `bytes(ip) → number[4|16] | null`; `inCidr(ip, cidr) → boolean`.
  - `plan(doc, appId, scan, range, merges) → Plan`, `merges` =
    `{hostKey: entityId}` (may be `{}`):

    ```
    Plan = {
      app, appHost: id|null,
      network: {label, addresses: [cidr]} | null,    // proposed new network
      candidates: [hostId…],                        // hosts without addresses
      silentUdp,
      hosts: [{
        key: "h0", label, addresses, os: string|null,
        known: id|null, merged: id|null,            // at most one is set
        networks: [networkId | "new"…],             // only for a new host
        route: [networkId] | [],                    // for flows to this host
        ports: [{
          key: "h0/tcp/22", proto: "tcp/22", label,
          product: {label, existing: id|null, identified: bool},
          known: serviceId|null, addsFlow: bool,
        }],
      }],
    }
    ```
  - `defaults(plan) → Ticks` = `{hosts: {h0: true…}, ports: {"h0/tcp/22": true…}, network: true}`;
    a port with `known && !addsFlow` is not in `ticks.ports` (nothing to add).
  - `summary(doc, plan, ticks, limits) → {hosts, networks, services, products, flows, entities, relationships, tooMany: string|null}`
    where `limits` is the catalog's `{entities, relationships}` and
    `entities`/`relationships` are the totals the document would have.

- [ ] **Step 1: Write the failing tests** (append)

```js
const E = require('../assets/js/architecture-edit.js');

// A small lab: an nmap on "Admin box" in 10.0.1.0/24, a known server with
// an SSH service reached by an existing flow, a hand-drawn host without
// addresses, an existing OpenSSH 9.6p1 product.
function lab() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.1.0/24'] },
    'admin-box': { kind: 'host', label: 'Admin box', parameters: { escape: { status: 'unknown' } } },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    srv: { kind: 'host', label: 'Server', addresses: ['10.0.1.5'] },
    sshd: { kind: 'service', label: 'ssh' },
    openssh: { kind: 'product', label: 'OpenSSH 9.6p1' },
    printer: { kind: 'host', label: 'Printer' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'admin-box', to: 'lan' },
    a2: { kind: 'attached', from: 'srv', to: 'lan' },
    a3: { kind: 'hosts', from: 'admin-box', to: 'nmap', privilege: 'user' },
    a4: { kind: 'hosts', from: 'srv', to: 'sshd', privilege: 'admin' },
    a5: { kind: 'instance-of', from: 'sshd', to: 'openssh' },
  };
  d.flows = { f1: { label: 'ssh on Server', source: 'nmap', target: 'sshd', route: ['lan'], protocol: 'tcp/22', parameters: { connect: { status: 'unknown' } } } };
  return d;
}
const deep = () => N.read(fixture('deep-lab.xml')).scan;

test('addresses and CIDR ranges compare as numbers, IPv4 and IPv6', () => {
  assert.deepEqual(N.bytes('10.0.1.5'), [10, 0, 1, 5]);
  assert.equal(N.bytes('10.0.1.256'), null);
  assert.equal(N.bytes('fd00::1').length, 16);
  assert.equal(N.bytes('nonsense'), null);
  assert.ok(N.inCidr('10.0.1.5', '10.0.1.0/24'));
  assert.ok(!N.inCidr('10.0.2.5', '10.0.1.0/24'));
  assert.ok(N.inCidr('10.0.1.5', '0.0.0.0/0'));
  assert.ok(N.inCidr('fd00::5', 'fd00::/64'));
  assert.ok(!N.inCidr('fd01::5', 'fd00::/64'));
  assert.ok(!N.inCidr('10.0.1.5', 'fd00::/64'));
  assert.ok(!N.inCidr('10.0.1.5', '10.0.1.0'));
});

test('a known host by address, a new one in a known network, a known port with its flow adds nothing', () => {
  const p = N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(p.appHost, 'admin-box');
  assert.equal(p.network, null, 'the range is a network already');
  assert.deepEqual(p.candidates, ['admin-box', 'printer']);
  assert.equal(p.silentUdp, 2);
  const [srv, other] = p.hosts;
  assert.equal(srv.known, 'srv');
  assert.equal(srv.label, 'Server');
  assert.deepEqual(srv.route, ['lan']);
  assert.deepEqual(srv.ports.map(x => [x.proto, x.label, x.known, x.addsFlow]), [
    ['tcp/22', 'ssh', 'sshd', false],
    ['tcp/8443', 'tcp/8443', null, true],
    ['udp/53', 'domain', null, true],
  ], 'open|filtered ports are not rows');
  assert.deepEqual(srv.ports[1].product, { label: 'unidentified tcp/8443 on Server', existing: null, identified: false });
  assert.deepEqual(srv.ports[2].product, { label: 'dnsmasq 2.90', existing: null, identified: true });
  assert.equal(other.known, null);
  assert.equal(other.label, '10.0.1.7');
  assert.deepEqual(other.networks, ['lan']);
  assert.deepEqual(other.route, ['lan']);
  assert.deepEqual(other.ports[0].product, { label: 'OpenSSH 9.6p1', existing: 'openssh', identified: true });
  assert.equal(other.ports.length, 1, 'filtered tcp/80 is not a row');
  const t = N.defaults(p);
  assert.deepEqual(t.hosts, { h0: true, h1: true });
  assert.deepEqual(Object.keys(t.ports), ['h0/tcp/8443', 'h0/udp/53', 'h1/tcp/22']);
});

test('merging a scanned host into a hand-drawn one makes it that host', () => {
  const p = N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h1: 'printer' });
  assert.equal(p.hosts[1].merged, 'printer');
  assert.equal(p.hosts[1].label, 'Printer');
  assert.deepEqual(p.hosts[1].networks, [], 'a merged host keeps its own links');
  assert.deepEqual(p.hosts[1].route, [], 'Printer is attached nowhere yet');
  // A merge into a host that has addresses, or into a known one, is ignored.
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h1: 'srv' }).hosts[1].merged, null);
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h0: 'printer' }).hosts[0].merged, null);
});

test('a range no network holds is proposed as a new network; a nmap on no host gives no routes', () => {
  const d = lab();
  delete d.entities.lan.addresses;
  const p = N.plan(d, 'nmap', deep(), ' 10.0.1.0/24 ', {});
  assert.deepEqual(p.network, { label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  assert.deepEqual(p.hosts[1].networks, ['new']);
  assert.deepEqual(p.hosts[1].route, [], 'nmap is not attached to the new network');
  assert.equal(N.plan(d, 'nmap', deep(), '10.0.1.0/24 10.0.2.0/24', {}).network, null, 'only one CIDR');
  assert.equal(N.plan(d, 'nmap', deep(), 'srv-01.lab', {}).network, null);
  const loose = lab();
  delete loose.associations.a3;
  const q = N.plan(loose, 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(q.appHost, null);
  assert.deepEqual(q.hosts[1].route, []);
});

test('a second nmap sees a known port but still needs its own flow', () => {
  const d = lab();
  d.entities.nmap2 = { kind: 'application', label: 'nmap 2', tool: 'nmap' };
  d.associations.a6 = { kind: 'hosts', from: 'srv', to: 'nmap2', privilege: 'user' };
  const p = N.plan(d, 'nmap2', deep(), '10.0.1.0/24', {});
  assert.deepEqual([p.hosts[0].ports[0].known, p.hosts[0].ports[0].addsFlow], ['sshd', true]);
  assert.ok(N.defaults(p).ports['h0/tcp/22']);
});

test('the summary counts what ticking adds and refuses to pass the limits', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  const t = N.defaults(p);
  const limits = { entities: 500, relationships: 2000 };
  const s = N.summary(d, p, t, limits);
  // New: host 10.0.1.7; services tcp/8443, domain, ssh(10.0.1.7); products
  // unidentified-8443, dnsmasq (OpenSSH reused). Flows: three.
  assert.deepEqual([s.hosts, s.networks, s.services, s.products, s.flows], [1, 0, 3, 2, 3]);
  assert.equal(s.entities, Object.keys(d.entities).length + 6);
  // attached 1 + hosts 3 + instance-of 3 + flows 3
  assert.equal(s.relationships, Object.keys(d.associations).length + Object.keys(d.flows).length + 10);
  assert.equal(s.tooMany, null);
  t.hosts.h1 = false;
  assert.deepEqual([N.summary(d, p, t, limits).hosts, N.summary(d, p, t, limits).services], [0, 2], 'an unticked host takes its ports along');
  const tight = N.summary(d, p, N.defaults(p), { entities: 10, relationships: 2000 });
  assert.match(tight.tooMany, /13 components; the limit is 10/);
  assert.match(N.summary(d, p, N.defaults(p), { entities: 500, relationships: 12 }).tooMany, /16 links and flows; the limit is 12/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nmap.test.js`
Expected: FAIL — `N.bytes is not a function`.

- [ ] **Step 3: Implement** (add; export `bytes, inCidr, plan, defaults, summary`)

```js
  // ---- addresses ----

  function bytes(ip) {
    var s = String(ip);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
      var four = s.split(".").map(Number);
      return four.every(function (n) { return n <= 255; }) ? four : null;
    }
    if (!/^[0-9A-Fa-f:]+$/.test(s) || s.indexOf(":") < 0) return null;
    var halves = s.split("::");
    if (halves.length > 2) return null;
    function groups(part) {
      return part ? part.split(":") : [];
    }
    var head = groups(halves[0]), tail = halves.length === 2 ? groups(halves[1]) : [];
    var fill = 8 - head.length - tail.length;
    if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
    var all = head.concat(Array(halves.length === 2 ? fill : 0).fill("0"), tail);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(all[i])) return null;
      var n = parseInt(all[i], 16);
      out.push(n >> 8, n & 255);
    }
    return out;
  }

  function inCidr(ip, cidr) {
    var parts = String(cidr).split("/");
    if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) return false;
    var a = bytes(ip), net = bytes(parts[0]), bits = Number(parts[1]);
    if (!a || !net || a.length !== net.length || bits > a.length * 8) return false;
    for (var i = 0; i < a.length; i++) {
      var take = Math.max(0, Math.min(8, bits - i * 8));
      var mask = take ? (0xff << (8 - take)) & 0xff : 0;
      if ((a[i] & mask) !== (net[i] & mask)) return false;
    }
    return true;
  }

  // ---- planning (spec §3.4, §4) ----

  function ids(doc, kind) {
    return Object.keys(doc.entities || {}).filter(function (id) { return doc.entities[id].kind === kind; });
  }
  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  function hostingOf(doc, executable) {
    var a = links(doc, "hosts").filter(function (x) { return x.to === executable; })[0];
    return a ? a.from : null;
  }
  function attachedNetworks(doc, machine) {
    var mine = links(doc, "attached").filter(function (a) { return a.from === machine; }).map(function (a) { return a.to; });
    return ids(doc, "network").filter(function (n) { return mine.indexOf(n) >= 0; });
  }
  function onlyCidr(range) {
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    return words.length === 1 && /\/\d{1,3}$/.test(words[0]) && inCidr(words[0].split("/")[0], words[0]) ? words[0] : null;
  }

  function plan(doc, appId, scan, range, merges) {
    merges = merges || {};
    var hosts = ids(doc, "host");
    var byAddress = Object.create(null);
    hosts.forEach(function (h) {
      (doc.entities[h].addresses || []).forEach(function (a) { byAddress[a] = byAddress[a] || h; });
    });
    var candidates = hosts.filter(function (h) { return !(doc.entities[h].addresses || []).length; });
    var networks = ids(doc, "network");
    var appHost = hostingOf(doc, appId);
    var appNets = appHost ? attachedNetworks(doc, appHost) : [];
    var cidr = onlyCidr(range);
    var proposed = cidr && !networks.some(function (n) { return (doc.entities[n].addresses || []).indexOf(cidr) >= 0; })
      ? { label: cidr, addresses: [cidr] } : null;
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) { products[doc.entities[p].label] = products[doc.entities[p].label] || p; });
    var usedNew = false;

    var planned = scan.hosts.map(function (h, i) {
      var key = "h" + i;
      var known = null;
      h.addresses.forEach(function (a) { if (!known && byAddress[a]) known = byAddress[a]; });
      var merged = !known && candidates.indexOf(merges[key]) >= 0 ? merges[key] : null;
      var target = known || merged;
      var label = target ? doc.entities[target].label : h.hostname || h.addresses[0];
      var nets = [];
      if (!target) {
        nets = networks.filter(function (n) {
          return (doc.entities[n].addresses || []).some(function (c) {
            return h.addresses.some(function (a) { return inCidr(a, c); });
          });
        });
        if (!nets.length && proposed && h.addresses.some(function (a) { return inCidr(a, cidr); })) {
          nets = ["new"];
          usedNew = true;
        }
      }
      var theirs = target ? attachedNetworks(doc, target) : nets;
      var shared = appNets.filter(function (n) { return theirs.indexOf(n) >= 0; });
      return {
        key: key,
        label: label,
        addresses: h.addresses.slice(),
        os: h.os ? "nmap OS guess: " + h.os.name + " (" + h.os.accuracy + "%)." : null,
        known: known,
        merged: merged,
        networks: nets,
        route: shared.length ? [shared[0]] : [],
        ports: h.ports.filter(function (p) { return p.state === "open"; }).map(function (p) {
          return portRow(doc, appId, target, key, label, p, products);
        }),
      };
    });

    return {
      app: appId,
      appHost: appHost,
      network: usedNew ? proposed : null,
      candidates: candidates,
      silentUdp: scan.silentUdp || 0,
      hosts: planned,
    };
  }

  function portRow(doc, appId, target, hostKey, hostLabel, p, products) {
    var proto = p.protocol + "/" + p.port;
    var s = p.service || {};
    var label = s.name || proto;
    var known = null;
    if (target) {
      var hosted = links(doc, "hosts").filter(function (a) {
        return a.from === target && doc.entities[a.to] && doc.entities[a.to].kind === "service";
      }).map(function (a) { return a.to; });
      Object.keys(doc.flows || {}).forEach(function (k) {
        var f = doc.flows[k];
        if (!known && f.protocol === proto && hosted.indexOf(f.target) >= 0) known = f.target;
      });
    }
    var addsFlow = !(known && Object.keys(doc.flows || {}).some(function (k) {
      var f = doc.flows[k];
      return f.source === appId && f.target === known && f.protocol === proto;
    }));
    var product = s.product
      ? { label: s.product + (s.version ? " " + s.version : ""), existing: null, identified: true }
      : { label: "unidentified " + label + " on " + hostLabel, existing: null, identified: false };
    if (product.identified && products[product.label]) product.existing = products[product.label];
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow };
  }

  function defaults(p) {
    var t = { hosts: {}, ports: {}, network: true };
    p.hosts.forEach(function (h) {
      t.hosts[h.key] = true;
      h.ports.forEach(function (r) { if (!r.known || r.addsFlow) t.ports[r.key] = true; });
    });
    return t;
  }

  // What the ticked rows add, and whether the result stays in the limits.
  function summary(doc, p, ticks, limits) {
    var s = { hosts: 0, networks: 0, services: 0, products: 0, flows: 0 };
    var rel = 0, newProducts = Object.create(null), needNetwork = false;
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      if (!h.known && !h.merged) {
        s.hosts++;
        rel += h.networks.length;
        if (h.networks.indexOf("new") >= 0) needNetwork = true;
      }
      h.ports.forEach(function (r) {
        if (!ticks.ports[r.key]) return;
        if (!r.known) {
          s.services++;
          rel += 2; // hosts, instance-of
          if (!r.product.existing && !newProducts[r.product.label]) {
            newProducts[r.product.label] = true;
            s.products++;
          }
        }
        if (r.addsFlow) s.flows++;
      });
    });
    if (needNetwork && p.network && ticks.network) s.networks = 1;
    rel += s.flows;
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.services + s.products;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel;
    s.tooMany = null;
    if (limits && s.entities > limits.entities) s.tooMany = "That makes " + s.entities + " components; the limit is " + limits.entities + ". Untick some hosts.";
    else if (limits && s.relationships > limits.relationships) s.tooMany = "That makes " + s.relationships + " links and flows; the limit is " + limits.relationships + ". Untick some hosts.";
    return s;
  }
```

A new host whose only network would be `"new"` while `ticks.network` is
false is added unattached (Task 5 does the same); unidentified products are
counted once per row because their labels are unique per host and service.

- [ ] **Step 4: Run the tests**

Run: `node --test scripts/nmap.test.js`
Expected: PASS. Check the summary arithmetic against the comments in the
test if it does not: the test is the spec's §4 read literally.

- [ ] **Step 5: Commit**

```bash
git add assets/js/nmap.js scripts/nmap.test.js
git commit -S -m "Plan an nmap import against the architecture"
```

### Task 5: Applying the import, and a new nmap application

**Files:**
- Modify: `assets/js/nmap.js`
- Create: `scripts/fixtures/nmap/imported.doc.json` (written by the test on
  first run with `NMAP_FIXTURE=write`, then committed)
- Modify: `crates/effractor-format/tests/json.rs` (pin the fixture)
- Test: `scripts/nmap.test.js`

**Interfaces:**
- Consumes: `plan`, `defaults` (Task 4); `A.addEntity(doc, kind, label, spec)`,
  `A.setDescription(doc, id, text)` from `architecture-edit.js`;
  `L.putAssociation(doc, null, {kind, from, to, privilege?, description?})`,
  `L.putFlow(doc, null, {label, source, target, route, protocol})` from
  `architecture-links.js` — each returns `{doc, select}` or `null`.
  `specOf(kind)` returns the catalog entry (`{parameters, defense}`) — in the
  app `kindSpec`, in tests from `scripts/fixtures/catalog.json`.
- Produces:
  - `apply(doc, plan, ticks, specOf, stamp) → {doc, select: "entity/<app>"} | null`,
    `stamp = {date: "2026-09-24", level: "Standard", range: "10.0.1.0/24"}`.
  - `stampLine(stamp) → "Last nmap import: 2026-09-24, Standard scan of 10.0.1.0/24."`
  - `addNmap(doc, hostId|null, label, specOf) → {doc, select, entity}`: an
    application with `tool: "nmap"`, hosted by `hostId` at `user` when given.
  - `ASSUMED = "Privilege assumed by the nmap import."` (hosts description).

- [ ] **Step 1: Write the failing tests** (append)

```js
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const STAMP = { date: '2026-09-24', level: 'Deep', range: '10.0.1.0/24' };

test('applying adds exactly what was ticked, once, and leaves the rest alone', () => {
  const d = lab();
  const before = JSON.stringify(d);
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  const edit = N.apply(d, p, N.defaults(p), specOf, STAMP);
  assert.equal(JSON.stringify(d), before, 'pure');
  assert.equal(edit.select, 'entity/nmap');
  const out = edit.doc;
  for (const id of Object.keys(d.entities)) {
    if (id !== 'nmap') assert.deepEqual(out.entities[id], d.entities[id], 'untouched: ' + id);
  }
  for (const id of Object.keys(d.associations)) assert.deepEqual(out.associations[id], d.associations[id]);
  assert.deepEqual(out.flows.f1, d.flows.f1);
  assert.equal(out.entities.nmap.description, 'Last nmap import: 2026-09-24, Deep scan of 10.0.1.0/24.');
  const host = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.7');
  assert.deepEqual(out.entities[host].addresses, ['10.0.1.7']);
  assert.equal(out.entities[host].kind, 'host');
  assert.ok(Object.values(out.associations).some(a => a.kind === 'attached' && a.from === host && a.to === 'lan'));
  const hosting = Object.values(out.associations).filter(a => a.kind === 'hosts' && a.privilege === 'admin' && a.description === 'Privilege assumed by the nmap import.');
  assert.equal(hosting.length, 3);
  const openssh = Object.values(out.associations).filter(a => a.kind === 'instance-of' && a.to === 'openssh');
  assert.equal(openssh.length, 2, 'the known product is shared');
  const flows = Object.values(out.flows).filter(f => f.source === 'nmap');
  assert.deepEqual(flows.map(f => [f.label, f.protocol, f.route]).sort(), [
    ['domain on Server', 'udp/53', ['lan']],
    ['ssh on 10.0.1.7', 'tcp/22', ['lan']],
    ['ssh on Server', 'tcp/22', ['lan']],
    ['tcp/8443 on Server', 'tcp/8443', ['lan']],
  ]);
  // Scanning again changes nothing but the stamp.
  const again = N.plan(out, 'nmap', deep(), '10.0.1.0/24', {});
  const s = N.summary(out, again, N.defaults(again), { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.services, s.products, s.flows], [0, 0, 0, 0]);
});

test('merging fills the chosen host; a proposed network is made and used', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', { h1: 'printer' });
  const merged = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  assert.deepEqual(merged.entities.printer.addresses, ['10.0.1.7']);
  assert.equal(merged.entities.printer.label, 'Printer');

  const bare = lab();
  delete bare.entities.lan.addresses;
  const one = { args: '', silentUdp: 0, hosts: [{ addresses: ['10.0.1.9'], hostname: null, os: null, ports: [] }] };
  const q = N.plan(bare, 'nmap', one, '10.0.1.0/24', {});
  const out = N.apply(bare, q, N.defaults(q), specOf, STAMP).doc;
  const net = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.0/24');
  assert.deepEqual(out.entities[net], { kind: 'network', label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  const h = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.9');
  assert.ok(Object.values(out.associations).some(a => a.kind === 'attached' && a.from === h && a.to === net));
});

test('nothing ticked is no edit; a second import keeps the rest of the description', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(N.apply(d, p, { hosts: {}, ports: {}, network: false }, specOf, STAMP), null);
  d.entities.nmap.description = 'Runs from the admin box.\nLast nmap import: 2026-09-01, Standard scan of 10.0.1.0/24.';
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  assert.equal(out.entities.nmap.description, 'Runs from the admin box.\nLast nmap import: 2026-09-24, Deep scan of 10.0.1.0/24.');
});

test('a hostile name becomes a label as it is and a valid id', () => {
  const d = lab();
  const scan = N.read(fixture('hostile.xml')).scan;
  const p = N.plan(d, 'nmap', scan, '10.0.3.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const id = Object.keys(out.entities).find(k => out.entities[k].label === '<img src=x onerror=alert(1)>&ünï');
  assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
  assert.match(id, /[a-z-]/);
});

test('a new nmap application runs on its host as user and says it is nmap', () => {
  const d = lab();
  const e = N.addNmap(d, 'srv', 'nmap', specOf);
  assert.equal(e.doc.entities[e.entity].tool, 'nmap');
  assert.equal(e.doc.entities[e.entity].kind, 'application');
  assert.ok(Object.values(e.doc.associations).some(a => a.kind === 'hosts' && a.from === 'srv' && a.to === e.entity && a.privilege === 'user'));
  assert.equal(e.select, 'entity/' + e.entity);
  const loose = N.addNmap(E.empty(), null, 'nmap', specOf);
  assert.deepEqual(Object.keys(loose.doc.associations), []);
});

test('the imported lab document is the one the Rust test validates', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', { h1: 'printer' });
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const file = 'scripts/fixtures/nmap/imported.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nmap.test.js`
Expected: FAIL — `N.apply is not a function`.

- [ ] **Step 3: Implement** (add; export `apply, addNmap, stampLine`)

```js
  // ---- applying (spec §4) ----

  var ASSUMED = "Privilege assumed by the nmap import.";
  var STAMP = /^Last nmap import: .*$/m;

  function stampLine(stamp) {
    return "Last nmap import: " + stamp.date + ", " + stamp.level + " scan of " + stamp.range + ".";
  }

  function apply(doc, p, ticks, specOf, stamp) {
    var s = summary(doc, p, ticks, null);
    if (!s.hosts && !s.services && !s.flows && !s.networks && !p.hosts.some(function (h) { return ticks.hosts[h.key] && h.merged; })) return null;
    var next = JSON.parse(JSON.stringify(doc));
    function step(edit) {
      if (!edit) throw new Error("the nmap import could not be applied");
      next = edit.doc;
      return edit;
    }
    function link(kind, from, to, extra) {
      step(L.putAssociation(next, null, Object.assign({ kind: kind, from: from, to: to }, extra || {})));
    }
    var network = null;
    if (s.networks) {
      network = step(A.addEntity(next, "network", p.network.label, specOf("network"))).entity;
      next.entities[network].addresses = p.network.addresses.slice();
    }
    var madeProducts = Object.create(null);
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      var host = h.known || h.merged;
      if (!host) {
        host = step(A.addEntity(next, "host", h.label, specOf("host"))).entity;
        next.entities[host].addresses = h.addresses.slice();
        if (h.os) next.entities[host].description = h.os;
        h.networks.forEach(function (n) {
          var to = n === "new" ? network : n;
          if (to) link("attached", host, to);
        });
      } else if (h.merged) {
        next.entities[host].addresses = h.addresses.slice();
      }
      h.ports.forEach(function (r) {
        if (!ticks.ports[r.key]) return;
        var service = r.known;
        if (!service) {
          service = step(A.addEntity(next, "service", r.label, specOf("service"))).entity;
          link("hosts", host, service, { privilege: "admin", description: ASSUMED });
          var product = r.product.existing || madeProducts[r.product.label];
          if (!product) {
            product = step(A.addEntity(next, "product", r.product.label, specOf("product"))).entity;
            if (r.product.identified) madeProducts[r.product.label] = product;
          }
          link("instance-of", service, product);
        }
        if (r.addsFlow) {
          step(L.putFlow(next, null, { label: r.label + " on " + h.label, source: p.app, target: service, route: h.route.slice(), protocol: r.proto }));
        }
      });
    });
    var old = next.entities[p.app].description || "";
    var line = stampLine(stamp);
    step(A.setDescription(next, p.app, STAMP.test(old) ? old.replace(STAMP, line) : (old ? old + "\n" : "") + line) || { doc: next });
    return { doc: next, select: "entity/" + p.app };
  }

  function addNmap(doc, hostId, label, specOf) {
    var added = A.addEntity(doc, "application", label, specOf("application"));
    if (!added) return null;
    added.doc.entities[added.entity].tool = "nmap";
    if (!hostId) return added;
    var hosted = L.putAssociation(added.doc, null, { kind: "hosts", from: hostId, to: added.entity, privilege: "user" });
    return hosted ? { doc: hosted.doc, select: added.select, entity: added.entity } : null;
  }
```

`next` starts as a clone and every step returns a new clone, so setting
`addresses` or a description on `next.entities[...]` never touches `doc`.

- [ ] **Step 4: Write the fixture and run**

Run: `NMAP_FIXTURE=write node --test scripts/nmap.test.js && node --test scripts/nmap.test.js`
Expected: PASS twice; `scripts/fixtures/nmap/imported.doc.json` exists.
Read it: a new host, services with `hosts` at admin and the assumed-privilege
description, products, flows with routes `["lan"]`, Printer with its
address, the nmap stamp.

- [ ] **Step 5: The Rust pin** (append to `crates/effractor-format/tests/json.rs`)

```rust
/// What the nmap import produces for the lab scan saves, and says nothing
/// worse than `incomplete` (the lab has no target yet).
#[test]
fn the_nmap_import_fixture_is_a_valid_architecture() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture =
        std::fs::read_to_string(root.join("scripts/fixtures/nmap/imported.doc.json")).unwrap();
    let fixture: Value = serde_json::from_str(&fixture).unwrap();
    let text = from_document(&fixture).unwrap_or_else(|d| panic!("{d:?}"));
    assert!(text.contains("tool: nmap"), "{text}");
    let (doc, diagnostics) = effractor_format::diagnose_document(&text);
    assert!(doc.is_some());
    let serious: Vec<_> = diagnostics
        .iter()
        .filter(|d| d.severity == effractor_core::Severity::Error)
        .collect();
    assert!(serious.is_empty(), "{serious:?}");
    // No service lacks its product or its host.
    assert!(
        !diagnostics.iter().any(|d| d.code == effractor_core::Code::Incomplete
            && (d.message.contains("product") || d.message.contains("runs nowhere"))),
        "{diagnostics:?}"
    );
}
```

Run: `cargo test -p effractor-format --test json nmap`
Expected: PASS.

- [ ] **Step 6: All checks, commit, PR**

Run the Global Constraints checks. Then:

```bash
git add assets/js/nmap.js scripts/nmap.test.js scripts/fixtures/nmap/imported.doc.json crates/effractor-format/tests/json.rs
git commit -S -m "Apply an nmap import as one edit and add nmap applications"
```

Open the PR for `feature/nmap-module`; after release continue from master.

---

## PR 3 — `feature/nmap-dialog`

### Task 6: Addresses in the inspector, nmap in the Add menus

**Files:**
- Modify: `assets/js/architecture-edit.js` (new `setAddresses`)
- Test: `scripts/architecture-edit.test.js`
- Modify: `assets/js/architecture-ui.js` (`kindMenu` near line 174,
  `addLinkedItems` near line 139, `renderProperties` near line 631, the
  `window.effractorArchitectureUi` object near line 687)

**Interfaces:**
- Produces: `A.setAddresses(doc, id, text) → {doc, select} | null` — splits
  on commas and whitespace, only for host/network, empty removes the key,
  unchanged returns null. `U.kindExtras` = `{kind: () => items}` and
  `U.linkedExtras` = `[(id) => items]`, filled by `nmap-ui.js`.

- [ ] **Step 1: Write the failing test** (append to
  `scripts/architecture-edit.test.js`)

```js
test('hosts and networks take addresses as one line; others do not', () => {
  const doc = E.empty();
  doc.entities.srv = { kind: 'host', label: 'Server' };
  doc.entities.lan = { kind: 'network', label: 'LAN' };
  doc.entities.app = { kind: 'application', label: 'App' };
  const set = E.setAddresses(doc, 'srv', ' 10.0.1.5,  fd00::5 ,,');
  assert.deepEqual(set.doc.entities.srv.addresses, ['10.0.1.5', 'fd00::5']);
  assert.equal(set.select, 'entity/srv');
  assert.equal(doc.entities.srv.addresses, undefined, 'pure');
  assert.equal(E.setAddresses(set.doc, 'srv', '10.0.1.5 fd00::5'), null, 'unchanged');
  assert.equal(E.setAddresses(set.doc, 'srv', '  ').doc.entities.srv.addresses, undefined);
  assert.deepEqual(E.setAddresses(doc, 'lan', '10.0.1.0/24').doc.entities.lan.addresses, ['10.0.1.0/24']);
  assert.equal(E.setAddresses(doc, 'app', '10.0.1.5'), null);
  assert.equal(E.setAddresses(doc, 'nowhere', '10.0.1.5'), null);
  // Not checked here: wasm says whether an address is one.
  assert.deepEqual(E.setAddresses(doc, 'srv', 'nonsense').doc.entities.srv.addresses, ['nonsense']);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test scripts/architecture-edit.test.js`
Expected: FAIL — `E.setAddresses is not a function`.

- [ ] **Step 3: Implement** in `architecture-edit.js`, and add
  `setAddresses: setAddresses` to `api`:

```js
  // A host's IP addresses or a network's CIDR ranges, typed as one line.
  function setAddresses(doc, id, text) {
    if (!has(doc.entities, id)) return null;
    var kind = doc.entities[id].kind;
    if (kind !== "host" && kind !== "network") return null;
    var list = String(text == null ? "" : text).split(/[\s,]+/).filter(Boolean);
    if (JSON.stringify(doc.entities[id].addresses || []) === JSON.stringify(list)) return null;
    var next = clone(doc);
    if (list.length) next.entities[id].addresses = list;
    else delete next.entities[id].addresses;
    return { doc: next, select: "entity/" + id };
  }
```

- [ ] **Step 4: Run it**

Run: `node --test scripts/architecture-edit.test.js`
Expected: PASS.

- [ ] **Step 5: The inspector line** — in `renderProperties` of
  `architecture-ui.js`, just before the `Note` field:

```js
    if (e.kind === "host" || e.kind === "network") {
      var addresses = field(form, "prop-addresses", e.kind === "host" ? "Addresses" : "Ranges", input("input", (e.addresses || []).join(", ")));
      addresses.placeholder = e.kind === "host" ? "10.0.1.5" : "10.0.1.0/24";
      addresses.addEventListener("change", function () {
        apply(function () {
          return A.setAddresses(doc(), id, addresses.value);
        }, null, true);
      });
    }
```

Check `input(tag, value)`'s actual signature near the other `field(...)`
calls and match it (a `textarea` is made the same way for the note).

- [ ] **Step 6: The menu hooks** — in `architecture-ui.js`:

```js
  // Filled in by nmap-ui.js: more ways to add a kind, and more to add
  // linked to a component. A kind with extras becomes a submenu.
  var kindExtras = {};
  var linkedExtras = [];
```

`kindMenu`:

```js
  function kindMenu() {
    return A.GROUPS.map(function (g) {
      return [g[0], "", g[1].map(function (kind) {
        var plain = [word(kind), "", function () { create(kind); }, { icon: icon(kind), title: W.meaning(catalog, kind) }];
        if (!kindExtras[kind]) return plain;
        return [word(kind), "", [plain].concat(kindExtras[kind]()), { icon: icon(kind) }];
      })];
    });
  }
```

At the end of `addLinkedItems`'s item list (before it is returned, after the
notes), append `linkedExtras` for this id:

```js
      linkedExtras.forEach(function (more) {
        items = items.concat(more(id));
      });
```

and export both on `window.effractorArchitectureUi`:
`kindExtras: kindExtras, linkedExtras: linkedExtras,` (`apply` is exported
already).

- [ ] **Step 7: Checks and commit**

Run: `npm test`
Expected: PASS.

```bash
git switch -c feature/nmap-dialog
git add assets/js/architecture-edit.js scripts/architecture-edit.test.js assets/js/architecture-ui.js
git commit -S -m "Edit addresses in the inspector and let other files add menu entries"
```

### Task 7: The nmap dialog

**Files:**
- Create: `assets/js/nmap-ui.js`
- Modify: `crates/effractor-server/templates/shell.html` (dialog markup
  after `#share-dialog`; `<script src="{{ asset_prefix }}assets/js/nmap.js" defer>`
  after `architecture-links.js`, `nmap-ui.js` after `architecture-links-ui.js`)
- Modify: `crates/effractor-server/src/shell.rs` (tests; the script-order
  assertion lists every script — add both where the template has them)
- Modify: `assets/css/60-architecture.css`
- Modify: `ROADMAP.md` (delete `nmap-import`), `docs/HANDOFF.md`
  (continuation section)

**Interfaces:**
- Consumes: `window.effractorNmap` (`LEVELS`, `command`, `read`, `plan`,
  `defaults`, `summary`, `apply`, `addNmap`); `window.effractorArchitectureUi`
  (`apply`, `menuItems`, `kindExtras`, `linkedExtras`, `loadCatalog`,
  `catalog`); `window.effractor` (`state.doc`, `select`).

- [ ] **Step 1: Failing shell test** — in `shell.rs`'s two shell tests add
  `assert!(html.contains("id=\"nmap-dialog\""));` and the two scripts to the
  script-order list.

Run: `cargo test -p effractor-server shell`
Expected: FAIL.

- [ ] **Step 2: Markup** (after `#share-dialog`):

```html
<dialog class="help-dialog nmap-dialog" id="nmap-dialog" aria-labelledby="nmap-title">
  <h2 class="label" id="nmap-title">nmap</h2>
  <p class="hint" id="nmap-unplaced" hidden>nmap is not on a host; the flows will have no route until you place it.</p>
  <div id="nmap-ask">
    <fieldset class="nmap-levels" id="nmap-levels"><legend class="label">Scan level</legend></fieldset>
    <p><label for="nmap-range">Range</label> <input id="nmap-range" type="text" autocomplete="off" spellcheck="false" placeholder="10.0.1.0/24"></p>
    <p class="hint">Real addresses go into the file, and into any link you share.</p>
    <div class="nmap-command"><code id="nmap-command"></code><button class="btn btn-ghost" id="nmap-copy" type="button">Copy</button></div>
    <p><label for="nmap-paste">Result</label></p>
    <textarea id="nmap-paste" rows="8" spellcheck="false" placeholder="Paste the output, or drop the .xml file here"></textarea>
    <p class="hint" id="nmap-problem" role="status"></p>
    <button class="btn" id="nmap-read" type="button">Read</button><button class="btn btn-ghost" id="nmap-cancel" type="button">Cancel</button>
  </div>
  <div id="nmap-preview" hidden>
    <ul class="nmap-rows" id="nmap-rows"></ul>
    <p class="hint" id="nmap-notes"></p>
    <p id="nmap-summary" role="status"></p>
    <button class="btn" id="nmap-add" type="button">Add</button><button class="btn btn-ghost" id="nmap-back" type="button">Back</button><button class="btn btn-ghost" id="nmap-close" type="button">Cancel</button>
  </div>
</dialog>
```

- [ ] **Step 3: `assets/js/nmap-ui.js`** — the whole file:

```js
// The nmap dialog (docs/superpowers/specs/2026-09-24-nmap-import-design.md
// §3): choose a level, copy the command, paste the XML, tick the preview,
// add. What it decides is nmap.js's; this file only shows it. Everything
// from a scan is set as text.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var N = window.effractorNmap;
  var P = window.effractorProfiles;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $("nmap-dialog");
  var at = { app: null, level: "standard", scan: null, merges: {}, ticks: null, plan: null };

  function doc() {
    return app.state.doc;
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function specOf(kind) {
    var c = U.catalog();
    return c ? c.entities.filter(function (e) { return e.kind === kind; })[0] : null;
  }
  function hostOf(id) {
    var d = doc();
    var k = Object.keys(d.associations || {}).filter(function (k) {
      var a = d.associations[k];
      return a.kind === "hosts" && a.to === id;
    })[0];
    return k ? d.associations[k].from : null;
  }
  function prefillRange(host) {
    var d = doc();
    if (!host) return "";
    return Object.keys(d.associations || {}).map(function (k) { return d.associations[k]; }).filter(function (a) {
      return a.kind === "attached" && a.from === host && d.entities[a.to];
    }).map(function (a) { return (d.entities[a.to].addresses || []).join(" "); }).filter(Boolean).join(" ");
  }

  // ---- the command ----

  function levels() {
    var box = $("nmap-levels");
    while (box.children.length > 1) box.removeChild(box.lastChild);
    N.LEVELS.forEach(function (l) {
      var label = el("label", null, "nmap-level");
      var radio = el("input");
      radio.type = "radio";
      radio.name = "nmap-level";
      radio.value = l.id;
      radio.checked = l.id === at.level;
      radio.addEventListener("change", function () { at.level = l.id; showCommand(); });
      label.appendChild(radio);
      label.appendChild(el("span", l.name));
      label.appendChild(el("span", l.finds + " · " + (l.root ? "needs root" : "no root") + " · " + l.time + " for a /24", "hint"));
      box.appendChild(label);
    });
  }
  function showCommand() {
    var c = N.command(at.level, $("nmap-range").value);
    $("nmap-command").textContent = c && c.text ? c.text : "";
    $("nmap-copy").disabled = !(c && c.text);
    $("nmap-problem").textContent = c && c.problem && $("nmap-range").value.trim() ? c.problem : "";
  }

  // ---- open ----

  function open(appId) {
    at = { app: appId, level: at.level, scan: null, merges: {}, ticks: null, plan: null };
    var host = hostOf(appId);
    $("nmap-title").textContent = host ? "nmap on " + doc().entities[host].label : "nmap (not on a host)";
    $("nmap-unplaced").hidden = !!host;
    $("nmap-range").value = prefillRange(host);
    $("nmap-paste").value = "";
    $("nmap-problem").textContent = "";
    $("nmap-ask").hidden = false;
    $("nmap-preview").hidden = true;
    levels();
    showCommand();
    U.loadCatalog().catch(function () {}).then(function () { dialog.showModal(); });
  }

  // ---- read and preview ----

  function read() {
    var r = N.read($("nmap-paste").value);
    if (r.problem) {
      $("nmap-problem").textContent = r.problem.message;
      return;
    }
    at.scan = r.scan;
    at.merges = {};
    at.ticks = null;
    preview();
  }

  function preview() {
    var old = at.ticks;
    at.plan = N.plan(doc(), at.app, at.scan, $("nmap-range").value, at.merges);
    var fresh = N.defaults(at.plan);
    at.ticks = old ? { hosts: keep(old.hosts, fresh.hosts), ports: keep(old.ports, fresh.ports), network: old.network } : fresh;
    var rows = $("nmap-rows");
    rows.textContent = "";
    if (at.plan.network) rows.appendChild(check(at.ticks.network, "New network " + at.plan.network.label, function (on) { at.ticks.network = on; count(); }));
    at.plan.hosts.forEach(function (h) {
      var li = el("li", null, "nmap-host");
      var head = check(at.ticks.hosts[h.key], h.label + " · " + h.addresses.join(", "), function (on) {
        at.ticks.hosts[h.key] = on;
        h.ports.forEach(function (r) { at.ticks.ports[r.key] = on && (!r.known || r.addsFlow); });
        preview();
      });
      head.appendChild(state(h));
      li.appendChild(head);
      var ports = el("ul", null, "nmap-ports");
      h.ports.forEach(function (r) {
        var nothing = r.known && !r.addsFlow;
        var what = nothing ? "known" : r.known ? "adds the flow" : "adds service, " + (r.product.existing ? "uses " : "") + r.product.label + ", flow";
        var row = check(!!at.ticks.ports[r.key], r.label + " · " + r.proto + " · " + what, function (on) { at.ticks.ports[r.key] = on; count(); });
        row.querySelector("input").disabled = nothing || !at.ticks.hosts[h.key];
        ports.appendChild(row);
      });
      li.appendChild(ports);
      rows.appendChild(li);
    });
    var notes = [];
    if (at.plan.hosts.some(function (h) { return h.ports.some(function (r) { return !r.known; }); })) notes.push("Services are assumed to run as admin.");
    if (at.plan.silentUdp) notes.push(at.plan.silentUdp + " UDP ports gave no answer (open|filtered); not added.");
    $("nmap-notes").textContent = notes.join(" ");
    $("nmap-ask").hidden = true;
    $("nmap-preview").hidden = false;
    count();
  }
  function keep(old, fresh) {
    var out = {};
    Object.keys(fresh).forEach(function (k) { out[k] = k in old ? old[k] : fresh[k]; });
    return out;
  }
  function check(on, text, change) {
    var label = el("label", null, "nmap-row");
    var box = el("input");
    box.type = "checkbox";
    box.checked = !!on;
    box.addEventListener("change", function () { change(box.checked); });
    label.appendChild(box);
    label.appendChild(el("span", text));
    return label;
  }
  // Known, merged, or a menu to merge into a hand-drawn host.
  function state(h) {
    if (h.known) return el("span", "known as “" + doc().entities[h.known].label + "”", "hint");
    var menu = el("select");
    menu.appendChild(new Option("new", ""));
    at.plan.candidates.forEach(function (id) {
      menu.appendChild(new Option("same as “" + doc().entities[id].label + "”", id));
    });
    menu.value = h.merged || "";
    menu.addEventListener("change", function () {
      if (menu.value) at.merges[h.key] = menu.value;
      else delete at.merges[h.key];
      preview();
    });
    return menu;
  }
  function count() {
    var c = U.catalog();
    var s = N.summary(doc(), at.plan, at.ticks, c ? c.limits : null);
    var parts = [[s.hosts, "host"], [s.networks, "network"], [s.services, "service"], [s.products, "product"], [s.flows, "flow"]].filter(function (x) { return x[0]; }).map(function (x) {
      return x[0] + " " + x[1] + (x[0] === 1 ? "" : "s");
    });
    $("nmap-summary").textContent = s.tooMany || (parts.length ? "Adds " + parts.join(", ") + "." : "Nothing new to add.");
    $("nmap-add").disabled = !!s.tooMany;
  }

  function add() {
    var level = N.level(at.level);
    var stamp = { date: new Date().toISOString().slice(0, 10), level: level.name, range: $("nmap-range").value.trim().replace(/\s+/g, " ") };
    var edit = N.apply(doc(), at.plan, at.ticks, specOf, stamp);
    dialog.close();
    if (!edit) return;
    U.apply(function () { return edit; });
  }

  // ---- menus ----

  function createNmap(hostId) {
    U.loadCatalog().then(function () {
      var made = null;
      U.apply(function () {
        var e = N.addNmap(doc(), hostId, "nmap", specOf);
        made = e && e.entity;
        return e;
      }).then(function (applied) {
        if (applied && made) open(made);
      });
    });
  }
  U.kindExtras.application = function () {
    return [["nmap", "", function () { createNmap(null); }, { title: "Scan from a host and add what it sees" }]];
  };
  U.linkedExtras.push(function (id) {
    var e = doc().entities[id];
    return e && e.kind === "host" ? [["nmap", "", function () { createNmap(id); }, { hint: "runs here as user" }]] : [];
  });
  U.menuItems.push(function (id) {
    var e = doc().entities[id];
    return e && e.tool === "nmap" ? [["Paste nmap result…", "", function () { open(id); }]] : [];
  });

  // ---- wiring ----

  $("nmap-range").addEventListener("input", showCommand);
  $("nmap-copy").addEventListener("click", function () {
    navigator.clipboard.writeText($("nmap-command").textContent).then(function () { app.say("command copied"); }, function () { app.say("copy failed; select the command instead"); });
  });
  $("nmap-read").addEventListener("click", read);
  $("nmap-back").addEventListener("click", function () { $("nmap-ask").hidden = false; $("nmap-preview").hidden = true; });
  $("nmap-add").addEventListener("click", add);
  $("nmap-cancel").addEventListener("click", function () { dialog.close(); });
  $("nmap-close").addEventListener("click", function () { dialog.close(); });
  var paste = $("nmap-paste");
  paste.addEventListener("dragover", function (e) { e.preventDefault(); });
  paste.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    file.text().then(function (t) { paste.value = t; read(); });
  });
})();
```

Before writing, check in `architecture-ui.js` and `app.js`: that
`U.apply` (already exported; `attacker-pins.js` uses it) resolves to
`applied`; that `app.say` exists; that the menu item format
`[label, key, action, {hint, title, icon}]` matches `menu.js`. Adjust names
to what is there; do not change those files' behaviour.

- [ ] **Step 4: Style** (`assets/css/60-architecture.css`; use tokens from
  `00-tokens.css`, as `.share-dialog` does in `50-editor.css`):

```css
.nmap-dialog { width: min(44rem, 94vw); }
.nmap-levels { border: 0; padding: 0; margin: 0 0 0.75rem; display: grid; gap: 0.25rem; }
.nmap-level { display: grid; grid-template-columns: auto 6rem 1fr; gap: 0.5rem; align-items: baseline; }
.nmap-dialog input[type="text"] { width: 100%; font-family: var(--font-mono); }
.nmap-command { display: flex; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
.nmap-command code { flex: 1; font-family: var(--font-mono); overflow-wrap: anywhere; user-select: all; }
.nmap-dialog textarea { width: 100%; font-family: var(--font-mono); }
.nmap-rows, .nmap-ports { list-style: none; margin: 0; padding: 0; }
.nmap-rows { max-height: 50vh; overflow: auto; }
.nmap-ports { padding-left: 1.5rem; }
.nmap-row { display: flex; gap: 0.5rem; align-items: baseline; }
.nmap-row span { overflow-wrap: anywhere; }
```

- [ ] **Step 5: Run the checks**

Run: `cargo test -p effractor-server shell && npm test && cargo test --workspace`
Expected: PASS.

- [ ] **Step 6: Owner's look** — start a preview on 8081 or 8082 (see
  `docs/HANDOFF.md` for how), and ask the owner to try: Add → Application →
  nmap; Tab from a host → nmap; the dialog's levels, range and Copy; pasting
  `scripts/fixtures/nmap/deep-lab.xml`; merging into a drawn host; Add; one
  undo; scanning again adds nothing; `hostile.xml` shows the name as text.
  Fix what the owner says before committing.

- [ ] **Step 7: Roadmap, handoff, commit, PR**

Delete the `nmap-import` item from `ROADMAP.md` (keep the section intro and
`nmap-scripts`, whose `needs:` becomes `—`); run `node scripts/check-roadmap.js`.
Add a dated continuation to `docs/HANDOFF.md` naming what landed, the files,
and anything the owner decided during the look.

```bash
git add assets/js/nmap-ui.js crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs assets/css/60-architecture.css ROADMAP.md docs/HANDOFF.md
git commit -S -m "Paste nmap results into the architecture from a dialog"
```

Open the PR; after CI is green the owner releases it.
