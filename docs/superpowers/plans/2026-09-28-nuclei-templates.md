# nuclei templates of effractor's own — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** effractor ships five nuclei templates of its own; the page writes the command that carries them and takes its targets from the drawing, and their answers are read into products, services, names, accounts and links.

**Architecture:** One pure module, `nuclei-templates.js`, holds the table of everything a template can answer and writes the templates' text, the targets and the command from it; the files in `assets/nuclei/` are what it writes, pinned by a test. `nuclei.js` hands records of `effractor-` templates to it and folds the facts into the scan every scanner's plan reads. `nmap-plan.js` gains the rows for products and applications; a new pure module, `nmap-connect.js`, plans and applies the connections. The dialog only shows what these decide.

**Tech Stack:** Rust (core, format: the `names` field), vanilla JavaScript without a bundler (pure modules that load in Node and the browser), `node --test`, nuclei 3.11.0 on the developer's machine for recording fixtures (CI has none), Python 3 for the throwaway lab servers.

**Spec:** `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` (approved by the owner, 2026-09-28). Code comments cite it as "nuclei templates spec §…".

## Global Constraints

- No third party is ever asked: every command has `-no-interactsh -disable-update-check`; names are asked of this machine's resolvers only (`-resolvers resolvers.txt`), else `-exclude-type dns`. Never `-preflight-portscan`.
- Every command the page offers runs unchanged in fish, bash and sh: single quotes only, no backslash anywhere, `;` and `>` the only shell syntax. `scripts/shell-commands.test.js` holds it.
- A template holds no backslash, no single quote, and no character outside printable ASCII and the line feed.
- Templates only read: HTTP `GET` without a body, one line feed, a TLS handshake, a DNS `A` question. Protocols `tcp`, `http`, `ssl`, `dns` only.
- nuclei is run only against throwaway servers on 127.0.0.1 (owner, 2026-09-28).
- The file format changes in place, without a version change; files written before keep opening.
- Unknown YAML keys are errors; `names` is refused off hosts.
- Pure modules have no DOM and no wasm, and load in Node (`module.exports`) and the browser (`window.effractor…`).
- What a page looks like is checked by the owner's eye in a preview (`target/debug/effractor --bind 127.0.0.1:8081 --accounts <db> --data <dir> --public-url http://localhost:8081`) **before it lands**, said in plain words. Never drive the owner's browser.
- Every part is one branch and one PR, landed with `scripts/dev/ship.sh` (signed commits, fast-forward, never the merge button); every push to master is a release.
- Checks before every PR: `npm test`, `cargo test --workspace`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `node scripts/check-roadmap.js`. `scripts/build-wasm.sh` must have run after any change to the Rust crates.
- UI copy is a few words; say why, never nothing; no native selects; detail on demand.
- `scripts/dev/ship.sh <title> <pr-body-file> <commit-message-file>` commits what is tracked and changed with the message in the file, so each part's last commit may be left to it. The PR body says what the part does, what was checked and how, and what the owner looked at; it ends with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `$SCRATCH` in the commands is the session's scratchpad directory.

## Where this plan departs from the spec

Three places, each simpler than what the spec wrote. The spec is amended in the task that builds each; the owner approves them with this plan.

1. **Spec §3: `targets.txt` is written by `awk`, not by `echo`.** `awk 'BEGIN { … }' > targets.txt` crosses the hosts with the usual ports in one line, where `echo` would carry one line per host and port (fifty hosts: 1,750 lines). Probed 2026-09-28: fish, bash and sh write the same file. `awk` is already in the commands nuclei is offered with.
2. **Spec §9: the page does not fetch the templates.** `nuclei-templates.js` writes their text from its table; the files in `assets/nuclei/` are that text, pinned by a test, and served for reading. The table and the templates cannot disagree, and the command needs no request.
3. **Spec §8: names are a field of their own in the inspector**, *Names*, under *Addresses* and edited the same way (a text field, names separated by commas), not part of the *Identity* row.
4. **Spec §9: two modules more, and `nuclei-command.js` stays as it is.** The comparison of products is `nmap-products.js` and the connections are `nmap-connect.js`, each pure and tested by itself, so that `nmap-plan.js` (848 lines today) does not take both; the two recipes are added by `nuclei.js`, which is what the dialog reads, and nuclei's own library of commands is untouched.
5. **Spec §5.3: 49 applications, not 52.** Prometheus, QNAP QTS and RabbitMQ are struck: the collection knows them by their title alone.

Everything in this plan was run before it was written down: its code and tests in a copy of the repository (777 Node tests pass; the Rust tests of `names`, of the pinned documents and of the script order pass), the five templates through `nuclei -validate`, the command in fish, bash and sh, and the reading, the rows and the connections against records nuclei 3.11.0 wrote against a lab of twelve hosts. What was not run: the dialog and the preview in a browser (Tasks 3, 12 and 13 change them; the owner looks), and the lab for all 49 applications (Task 6 completes it; two tests wait for it and say what is missing).

## Review Focus

1. **A paste holding both nuclei's own results and effractor's**: both are read; an `info` record of nuclei's still only opens its port.
2. **A newer template's answers pasted into an older page** (an extractor name the table does not hold): counted and said, nothing drawn, nothing thrown.
3. **Hostile values in `extracted-results`** (control characters, 5,000 characters, markup, a version that is no version, a name that is an address): cleaned, cut, or refused by shape; never reach a label unread.
4. **A drawing with hundreds of hosts in the range**: the command stays one paste; the summary refuses past the catalog's limits with what to untick, as today.
5. **The same result imported twice, and nmap's before or after**: the second import adds nothing; no host, service, product, account or flow is drawn twice.

Each has its test in the task that owns the code (Tasks 7, 7, 7, 5, and 9 and 10).

## File Structure

| File | Part | Responsibility |
|---|---|---|
| `crates/effractor-core/src/architecture.rs` | 1 | `Entity.names` |
| `crates/effractor-format/src/architecture_read.rs` | 1 | reads and refuses `names` |
| `crates/effractor-format/src/architecture_write.rs` | 1 | writes `names` after `addresses` |
| `assets/js/architecture-edit.js` | 1 | `isName`, `setNames` |
| `assets/js/architecture-ui.js` | 1 | the inspector's *Names* field |
| `assets/js/assistant/tools.js`, `tools.json` | 1 | `set_entity` takes `names` |
| `assets/js/nmap-plan.js` | 1, 3 | names kept and matched; product and application rows |
| `assets/js/nmap-products.js` (new, pure) | 3 | `productKey`, `sameProduct`: one comparison for every scanner |
| `assets/js/nmap-changes.js` | 3 | the version change uses that comparison |
| `assets/js/nuclei-templates.js` (new, pure) | 2, 3, 4 | the table, `text`, `targets`, `command`, `read` |
| `assets/nuclei/effractor-*.yaml`, `README.md` (new) | 2 | the templates as written by the table; source and licence |
| `assets/js/nuclei.js` | 3, 4, 5 | folds effractor's facts into the scan; in part 5 offers the two recipes |
| `assets/js/nmap-connect.js` (new, pure) | 4 | plans and applies logins, sign-ons, administration, names that point |
| `assets/js/nmap-ui.js`, `crates/effractor-server/templates/shell.html`, `assets/css/60-architecture.css` | 1, 5 | the dialog and the preview |
| `crates/effractor-server/src/shell.rs` | 2, 3, 4 | script order |
| `scripts/dev/nuclei-lab.py` (new) | 2 | throwaway servers on 127.0.0.1 |
| `scripts/dev/nuclei-templates-write.js` (new) | 2 | writes `assets/nuclei/*.yaml` from the table |
| `scripts/nuclei-templates.test.js` (new) | 2–4 | rules, table, targets, command, reading |
| `scripts/nuclei-identify.test.js`, `scripts/nuclei-connect.test.js` (new) | 3, 4 | plan, apply, both orders, pinned documents |
| `scripts/fixtures/nuclei/identify.jsonl`, `connect.jsonl`, `imported-identify.doc.json`, `imported-connect.doc.json` (new) | 3, 4 | recorded results, pinned documents |
| `scripts/shell-commands.test.js`, `scripts/check-nmap-wasm.js`, `crates/effractor-format/tests/json.rs` | 2–4 | the existing pins, extended |

---

# Part 1 — names on hosts (branch `host-names`)

### Task 1: The file keeps a host's names

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs:464-500`
- Modify: `crates/effractor-format/src/architecture_read.rs:170-240` and after `fn identities`
- Modify: `crates/effractor-format/src/architecture_write.rs:83-98`
- Modify: `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md:139-143`
- Test: `crates/effractor-format/tests/architecture.rs` (after `identity_fields_are_refused_off_hosts_and_in_the_wrong_shape`)

**Interfaces:**
- Consumes: nothing.
- Produces: `Entity.names: Vec<String>`; the YAML key `names` on a host, a flow list written after `addresses`. A name is lower-case ASCII letters, digits, `-` and `_` in labels of 1–63 characters joined by `.`, at most 253 characters, no label starting or ending with `-`, and not made of digits and dots alone.

- [ ] **Step 1: Write the failing tests**

Add to `crates/effractor-format/tests/architecture.rs`:

```rust
#[test]
fn a_host_keeps_its_names() {
    let mut image = image(LECTURE);
    let names = serde_json::json!(["grafana.corp.example", "metrics.corp.example", "srv01"]);
    image["entities"]["server"]["addresses"] = serde_json::json!(["10.0.1.5"]);
    image["entities"]["server"]["names"] = names.clone();
    image["entities"]["server"]["identities"] = serde_json::json!(["mac:52:54:00:12:34:56"]);
    let text = from_document(&image).unwrap_or_else(|d| panic!("{d:?}"));
    let at = |key: &str| {
        text.find(&format!("\n    {key}: ["))
            .unwrap_or_else(|| panic!("no {key} in {text}"))
    };
    assert!(at("addresses") < at("names") && at("names") < at("identities"), "{text}");
    assert_eq!(canonicalize(&text).unwrap(), text);
    assert_eq!(self::image(&text)["entities"]["server"]["names"], names);
    // Two hosts may bear one name: a certificate sits on several machines.
    let mut twins = image.clone();
    twins["entities"]["workstation"]["names"] = serde_json::json!(["grafana.corp.example"]);
    from_document(&twins).unwrap_or_else(|d| panic!("{d:?}"));
    // A file without the key reads as before.
    let plain = from_document(&self::image(LECTURE)).unwrap_or_else(|d| panic!("{d:?}"));
    assert!(!plain.contains("names:"), "{plain}");
}

#[test]
fn names_are_refused_off_hosts_and_in_the_wrong_shape() {
    let long = format!("{}.example", "a".repeat(250));
    let cases: [(&str, serde_json::Value, &str, &str); 10] = [
        ("sshd", serde_json::json!(["a.example"]), "misplaced-key", "entities.sshd.names"),
        ("server-net", serde_json::json!(["a.example"]), "misplaced-key", "entities.server-net.names"),
        ("server", serde_json::json!(["Grafana.corp.example"]), "wrong-type", "entities.server.names[0]"),
        ("server", serde_json::json!(["*.corp.example"]), "wrong-type", "entities.server.names[0]"),
        ("server", serde_json::json!(["10.0.1.5"]), "wrong-type", "entities.server.names[0]"),
        ("server", serde_json::json!(["a..example"]), "wrong-type", "entities.server.names[0]"),
        ("server", serde_json::json!(["-a.example"]), "wrong-type", "entities.server.names[0]"),
        ("server", serde_json::json!(["a.example", "a.example"]), "wrong-type", "entities.server.names[1]"),
        ("server", serde_json::json!([long]), "wrong-type", "entities.server.names[0]"),
        ("server", serde_json::json!(["a.example", 7]), "wrong-type", "entities.server.names[1]"),
    ];
    for (entity, value, code, path) in cases {
        let mut image = image(LECTURE);
        image["entities"][entity]["names"] = value;
        let errors = errors_of(&image);
        assert!(has(&errors, code, path), "{entity}: {errors:?}");
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p effractor-format --test architecture names`
Expected: both FAIL; the first with an `unknown-key` diagnostic at `entities.server.names`.

- [ ] **Step 3: Add the field**

In `crates/effractor-core/src/architecture.rs`, in `struct Entity` after `addresses`:

```rust
    /// DNS names of a host, in lower case (nuclei templates spec §8). Two
    /// hosts may bear one; empty elsewhere. Generation never reads them.
    pub names: Vec<String>,
```

and in `Entity::new`, after `addresses: Vec::new(),`:

```rust
            names: Vec::new(),
```

- [ ] **Step 4: Read it**

In `crates/effractor-format/src/architecture_read.rs`, in `fn entity`: add `"names",` after `"addresses",` in the list of keys; after the `let addresses = …;` statement add

```rust
    let names = match f.get("names") {
        Some(e) if host_only(cx, &f, "names", kind) => names(cx, e, &f.path("names")),
        Some(_) => None,
        None => Some(Vec::new()),
    };
```

add `names: names?,` after `addresses: addresses?,` in the `Entity { … }` literal, and after `fn identities` add:

```rust
/// Whether `text` is a DNS name as a host keeps it (nuclei templates spec
/// §8): lower case, no wildcard, and not an address.
fn is_name(text: &str) -> bool {
    let label = |l: &str| {
        (1..=63).contains(&l.len())
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    };
    text.len() <= 253
        && text.split('.').all(label)
        && !text.bytes().all(|b| b.is_ascii_digit() || b == b'.')
}

/// A host's DNS names, each once.
fn names(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Vec<String>> {
    let items = cx.list(&entry.value, path)?;
    let mut out: Vec<String> = Vec::new();
    let mut ok = true;
    for (i, item) in items.iter().enumerate() {
        let at = format!("{path}[{i}]");
        let Some(text) = cx.string(item, &at) else {
            ok = false;
            continue;
        };
        if !is_name(&text) {
            let message =
                format!("expected a DNS name in lower case such as app.corp.example, found {text:?}");
            cx.error(Code::WrongType, at, item.pos, message);
            ok = false;
        } else if out.contains(&text) {
            cx.error(
                Code::WrongType,
                at,
                item.pos,
                format!("{text:?} is listed twice"),
            );
            ok = false;
        } else {
            out.push(text);
        }
    }
    ok.then_some(out)
}
```

- [ ] **Step 5: Write it**

In `crates/effractor-format/src/architecture_write.rs`, between the `addresses` block and the `identities` block:

```rust
        if !entity.names.is_empty() {
            let items: Vec<String> = entity
                .names
                .iter()
                .map(|n| string(n, Context::FlowValue))
                .collect();
            w.line(4, "names", &format!("[{}]", items.join(", ")));
        }
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p effractor-format --test architecture names`
Expected: both PASS.
Run: `cargo test --workspace`
Expected: PASS; no solver fingerprint moved (generation never reads `names`).

- [ ] **Step 7: Say it in the lecture design**

In `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` §4, after the sentence ending "Neither changes generation." add:

```markdown
A `host` may also carry `names`, its DNS names in lower case (owner,
2026-09-28; nuclei templates design §8). Generation never reads them.
```

- [ ] **Step 8: Rebuild wasm and commit**

```bash
scripts/build-wasm.sh
cargo fmt --all --check
git add crates/effractor-core/src/architecture.rs crates/effractor-format/src/architecture_read.rs crates/effractor-format/src/architecture_write.rs crates/effractor-format/tests/architecture.rs docs/superpowers/specs/2026-09-21-lecture-workflow-design.md
git commit -m "A host keeps its DNS names in the file"
```

### Task 2: Names are edited by hand and by the agent

**Files:**
- Modify: `assets/js/architecture-edit.js:98-108,155`
- Modify: `assets/js/assistant/tools.js:210-225,343-346,377,403`
- Modify: `assets/js/assistant/tools.json` (the `set_entity` entry)
- Modify: `assets/js/architecture-ui.js:786-795`
- Modify: `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` §8 (last paragraph)
- Test: `scripts/architecture-edit.test.js`, `scripts/assistant-tools.test.js`

**Interfaces:**
- Consumes: the `names` key of Task 1 (the page's wasm validation refuses what the file refuses).
- Produces:
  - `A.isName(text: string): boolean` — the rule of Task 1, the same in JavaScript.
  - `A.setNames(doc, id, text: string): {doc, select} | null` — `text` is names separated by spaces or commas; each is lower-cased and loses a final dot; each once; `null` when `id` is no host or nothing changes. It does not refuse what is no name: validation does, as for addresses.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/architecture-edit.test.js` (the file already requires `architecture-edit.js` as `E`; use the document its address test uses, which has the host `srv`, the network `lan` and the application `app`):

```js
test('a host\'s names: lower case, each once, only on hosts', () => {
  const doc = E.empty();
  doc.entities = { srv: { kind: 'host', label: 'Server' }, lan: { kind: 'network', label: 'LAN' } };
  const set = E.setNames(doc, 'srv', ' Grafana.Corp.Example., metrics.corp.example grafana.corp.example ,,');
  assert.deepEqual(set.doc.entities.srv.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.equal(set.select, 'entity/srv');
  assert.equal(E.setNames(set.doc, 'srv', 'grafana.corp.example metrics.corp.example'), null, 'unchanged');
  assert.equal(E.setNames(set.doc, 'srv', '  ').doc.entities.srv.names, undefined);
  assert.equal(E.setNames(doc, 'lan', 'a.example'), null);
  assert.equal(E.setNames(doc, 'nope', 'a.example'), null);
  assert.equal(doc.entities.srv.names, undefined, 'the document given is not changed');
});

test('what a name is', () => {
  for (const good of ['a', 'srv01', 'app.corp.example', 'x_y.example', 'a-b.example', '1a.example', 'a'.repeat(63) + '.example']) assert.equal(E.isName(good), true, good);
  for (const bad of ['', 'A.example', '*.corp.example', '10.0.1.5', '1.2.3', 'fd00::5', 'a..example', '.a', 'a.', '-a.example', 'a-.example', 'a b', 'a'.repeat(64) + '.example', ('a'.repeat(60) + '.').repeat(5), 7, null]) assert.equal(E.isName(bad), false, String(bad));
});
```

Add to `scripts/assistant-tools.test.js`:

```js
test('set_entity sets and clears a host\'s names', () => {
  let d = T.edit('add_entity', { kind: 'host', label: 'Web 1' }, arch()).doc;
  d = T.edit('set_entity', { id: 'web-1', names: ['App.Corp.Example', 'app.corp.example'] }, arch(d)).doc;
  assert.deepEqual(d.entities['web-1'].names, ['app.corp.example']);
  assert.equal(T.edit('set_entity', { id: 'web-1', names: null }, arch(d)).doc.entities['web-1'].names, undefined);
  d = T.edit('add_entity', { kind: 'service', label: 'ssh' }, arch(d)).doc;
  assert.equal(T.edit('set_entity', { id: 'ssh', names: ['a.example'] }, arch(d)).refused, 'only hosts have names');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/architecture-edit.test.js scripts/assistant-tools.test.js`
Expected: FAIL with `E.setNames is not a function`, `E.isName is not a function`; the agent's test fails on `names`.

- [ ] **Step 3: Write the edit**

In `assets/js/architecture-edit.js`, after `setAddresses`:

```js
  // A DNS name as a host keeps it (nuclei templates spec §8): lower case,
  // no wildcard, not an address. The file's reader has the same rule.
  function isName(text) {
    if (typeof text !== "string" || !text || text.length > 253 || /^[0-9.]+$/.test(text)) return false;
    return text.split(".").every(function (l) {
      return /^[a-z0-9_-]{1,63}$/.test(l) && l[0] !== "-" && l[l.length - 1] !== "-";
    });
  }

  // Names as typed, separated by spaces or commas: lower case, without a
  // final dot, each once. What is no name is refused by validation, as an
  // address is.
  function setNames(doc, id, text) {
    if (!has(doc.entities, id) || doc.entities[id].kind !== "host") return null;
    var list = [];
    String(text == null ? "" : text).split(/[\s,]+/).filter(Boolean).forEach(function (n) {
      var name = n.toLowerCase().replace(/\.$/, "");
      if (name && list.indexOf(name) < 0) list.push(name);
    });
    if (JSON.stringify(doc.entities[id].names || []) === JSON.stringify(list)) return null;
    var next = clone(doc);
    if (list.length) next.entities[id].names = list;
    else delete next.entities[id].names;
    return { doc: next, select: "entity/" + id };
  }
```

and add `isName: isName, setNames: setNames` to `api`.

- [ ] **Step 4: Give it to the agent**

In `assets/js/assistant/tools.js`, in `setEntity` after the `addresses` block:

```js
    if (i.names !== undefined) {
      if (e.kind !== "host") return { refused: "only hosts have names" };
      c.apply(AE.setNames(c.doc(), id, (i.names || []).join(" ")));
    }
```

In `LISTS` make `set_entity: ["addresses", "identities", "names"]`; in `NULLABLE` add `names: true`; in `USES["architecture-edit.js"]` add `"setNames"`; in `NOT_EDIT["architecture-edit.js"]` add `"isName"`.

In `assets/js/assistant/tools.json`, in the `set_entity` entry: in `description` write `addresses (hosts: IPs; networks: CIDR), names (hosts: DNS names in lower case), identities` in place of `addresses (hosts: IPs; networks: CIDR), identities`; in `schema.properties` add after `"addresses"`:

```json
"names": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]},
```

- [ ] **Step 5: Run the tests**

Run: `node --test scripts/architecture-edit.test.js scripts/assistant-tools.test.js`
Expected: PASS.
Run: `cargo test -p effractor-server assistant`
Expected: PASS (the catalog's schemas stay in the strict form: one `type` per node, unions as `anyOf`).

- [ ] **Step 6: The inspector's field**

In `assets/js/architecture-ui.js`, after the `if (e.kind === "host" || e.kind === "network") { … }` block of the addresses:

```js
    // Nuclei templates spec §8: a host's DNS names, edited as its addresses are.
    if (e.kind === "host") {
      var names = field(form, "prop-names", "Names", input("text", (e.names || []).join(", ")));
      names.placeholder = "app.corp.example";
      names.spellcheck = false;
      names.addEventListener("change", function () {
        apply(function () {
          return A.setNames(doc(), id, names.value);
        }, null, true);
      });
    }
```

- [ ] **Step 7: Amend the spec**

In `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` §8 replace the last paragraph with:

```markdown
The inspector has a field *Names* under *Addresses*, edited the same way
(names separated by commas; amended with the plan, 2026-09-28). The agent's
tools reach the same edit (`scripts/assistant-tools.test.js`).
```

- [ ] **Step 8: Commit**

```bash
npm test
git add assets/js/architecture-edit.js assets/js/architecture-ui.js assets/js/assistant/tools.js assets/js/assistant/tools.json scripts/architecture-edit.test.js scripts/assistant-tools.test.js docs/superpowers/specs/2026-09-28-nuclei-templates-design.md
git commit -m "A host's names are edited in the inspector and by the agent"
```

### Task 3: Every import keeps the names it reads and matches by them

**Files:**
- Modify: `assets/js/nmap-plan.js` (`plan`, `defaults`, `doing`, `summary`, `said`, `apply`)
- Modify: `assets/js/nmap-ui.js` (`about`)
- Modify: `scripts/nmap.test.js:251`
- Modify (regenerated): `scripts/fixtures/nmap/imported.doc.json`, `imported-router.doc.json`, `imported-checks.doc.json`, `scripts/fixtures/greenbone/imported.doc.json`, `scripts/fixtures/masscan/imported.doc.json`, `scripts/fixtures/nuclei/imported.doc.json`
- Test: `scripts/nmap-plan.test.js`

**Interfaces:**
- Consumes: `A.isName` (Task 2); the scan's `hosts[].names: [{name, from}]` every reader already fills.
- Produces, on each planned host row `h` of `N.plan(…).hosts`:
  - `h.names: string[]` — the scan's names that are names, lower case, each once;
  - `h.newNames: string[]` — those the drawn host does not keep yet (all of them for a new host);
  - `h.saidNames: string[]` — what the scan called a name and is none (a wildcard, a NetBIOS name with a space, an address), as written.
  - `ticks.names[h.key]: boolean`, `true` at first.
  - `summary(…).named: number` — drawn hosts that gain names.
  - A scanned host **without an address** is the one drawn host that keeps one of its names (`matchedBy: "name"`, `guessed: true`, `guessedBy: "name"`), before the label is tried.
  - A new host's label, and the better name offered to a host labelled by its address, is the first of the scan's names that is a name: a wildcard labels nothing.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/nmap-plan.test.js` (it has `N`, `E` and `specOf`):

```js
const named = (names, addresses) => ({
  tool: 'nuclei', args: '', date: '2026-09-28', silentUdp: 0, probed: {}, types: [], sharedMacs: 0,
  hosts: [{ addresses: addresses || [], hostname: names[0] || null, names: names.map(n => ({ name: n, from: 'certificate' })), identities: [], os: null, device: [], self: false, ports: [{ protocol: 'tcp', port: 443, state: 'open', reason: null, service: { name: 'https', product: null, version: null }, scripts: [], findings: [] }], scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [] }],
});
function drawing() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'LAN', addresses: ['10.0.1.0/24'] },
    box: { kind: 'host', label: 'Admin box' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.1.40'], names: ['grafana.corp.example'] },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a2: { kind: 'attached', from: 'web', to: 'lan' },
    a3: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
  };
  return d;
}

test('names a scan reads are kept on the host, each once, in lower case', () => {
  const d = drawing();
  const scan = named(['Grafana.corp.example', 'metrics.corp.example.', '*.corp.example', 'WEB 01'], ['10.0.1.40']);
  const p = N.plan(d, 'nuclei', scan, '10.0.1.0/24', {});
  const [h] = p.hosts;
  assert.equal(h.known, 'web');
  assert.deepEqual(h.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.deepEqual(h.newNames, ['metrics.corp.example']);
  assert.deepEqual(h.saidNames, ['*.corp.example', 'WEB 01']);
  const t = N.defaults(p);
  assert.equal(t.names[h.key], true);
  assert.equal(N.summary(d, p, t, null).named, 1);
  const out = N.apply(d, p, t, specOf, { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m }).doc;
  assert.deepEqual(out.entities.web.names, ['grafana.corp.example', 'metrics.corp.example']);
  // Unticked, they are not kept.
  t.names[h.key] = false;
  const without = N.apply(d, p, t, specOf, { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m }).doc;
  assert.deepEqual(without.entities.web.names, ['grafana.corp.example']);
  // Again: nothing to name.
  const again = N.plan(out, 'nuclei', scan, '10.0.1.0/24', {});
  assert.deepEqual(again.hosts[0].newNames, []);
  assert.equal(N.summary(out, again, N.defaults(again), null).named, 0);
});

test('a new host is drawn with its names', () => {
  const d = drawing();
  const scan = named(['wiki.corp.example'], ['10.0.1.41']);
  const p = N.plan(d, 'nuclei', scan, '10.0.1.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m }).doc;
  const id = Object.keys(out.entities).find(k => out.entities[k].label === 'wiki.corp.example');
  assert.deepEqual(out.entities[id].names, ['wiki.corp.example']);
  assert.equal(N.summary(d, p, N.defaults(p), null).named, 0, 'a new host is counted as a host');
});

test('a host known only by name is the drawn host that keeps the name', () => {
  const d = drawing();
  const p = N.plan(d, 'nuclei', named(['grafana.corp.example']), '', {});
  assert.deepEqual([p.hosts[0].merged, p.hosts[0].guessedBy, p.hosts[0].matchedBy], ['web', 'name', 'name']);
  // Kept on two hosts, it names neither.
  d.entities.other = { kind: 'host', label: 'Web 2', addresses: ['10.0.1.42'], names: ['grafana.corp.example'] };
  const q = N.plan(d, 'nuclei', named(['grafana.corp.example']), '', {});
  assert.equal(q.hosts[0].merged, null);
  // With an address of its own it is not matched by a name: names are shared.
  const r = N.plan(drawing(), 'nuclei', named(['grafana.corp.example'], ['10.0.1.99']), '10.0.1.0/24', {});
  assert.deepEqual([r.hosts[0].known, r.hosts[0].merged], [null, null]);
});

test('a wildcard labels nothing and renames nothing', () => {
  const scan = named(['*.corp.example', 'Wiki.corp.example'], ['10.0.1.41']);
  const p = N.plan(drawing(), 'nuclei', scan, '10.0.1.0/24', {});
  assert.deepEqual([p.hosts[0].label, p.hosts[0].names, p.hosts[0].saidNames], ['Wiki.corp.example', ['wiki.corp.example'], ['*.corp.example']]);
  const d = drawing();
  d.entities.web.label = '10.0.1.40';
  const q = N.plan(d, 'nuclei', named(['*.corp.example'], ['10.0.1.40']), '10.0.1.0/24', {});
  assert.equal(q.hosts[0].rename, null);
  const r = N.plan(d, 'nuclei', named(['*.corp.example', 'shop.corp.example'], ['10.0.1.40']), '10.0.1.0/24', {});
  assert.deepEqual(r.hosts[0].rename, { to: 'shop.corp.example', from: 'certificate' });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nmap-plan.test.js`
Expected: the four new tests FAIL (`h.names` is undefined; the host known by name is not matched; the wildcard is the label).

- [ ] **Step 3: Plan, tick, count and apply the names**

In `assets/js/nmap-plan.js`, 14 edits, in this order. Each *find* stands in the file exactly once.

**1.** The names drawn hosts keep, and the scan's names that are names. Find:

```js
    function whoIs(h) {
```

Write in its place:

```js
    // Nuclei templates spec §8: the names drawn hosts keep.
    var byName = Object.create(null);
    hosts.forEach(function (h) {
      (doc.entities[h].names || []).forEach(function (n) { (byName[n] = byName[n] || []).push(h); });
    });
    function namesOf(h) {
      var good = [], said = [];
      (h.names || []).forEach(function (x) {
        var n = String(x.name || "").toLowerCase().replace(/\.$/, "");
        if (A.isName(n)) {
          if (good.indexOf(n) < 0) good.push(n);
        } else if (said.indexOf(x.name) < 0) said.push(x.name);
      });
      return { good: good, said: said };
    }
    // The first of its names that is one: a wildcard labels nothing.
    function bestName(h) {
      return (h.names || []).filter(function (x) { return A.isName(String(x.name || "").toLowerCase().replace(/\.$/, "")); })[0] || null;
    }
    function whoIs(h) {
```

**2.** A better name is the first that is a name. Find:

```js
      var best = (h.names || [])[0];
      if (!best ||
```

Write in its place:

```js
      var best = bestName(h);
      if (!best ||
```

**3.** A host without an address is the one drawn host that keeps its name. Find:

```js
    // A drawn host without addresses that has the scanned host's name is
    // guessed to be it, as nmap's own host is (spec §3.3).
```

Write in its place:

```js
    // A scanned host without an address is the one drawn host that keeps
    // its name; one with an address is not, since hosts share names.
    rows.forEach(function (r) {
      if (r.known || r.merged || r.conflict || has(merges, r.key) || r.scan.addresses.length) return;
      var keepers = [];
      namesOf(r.scan).good.forEach(function (n) {
        (byName[n] || []).forEach(function (h) { if (keepers.indexOf(h) < 0) keepers.push(h); });
      });
      if (keepers.length !== 1 || takenBy[keepers[0]]) return;
      r.merged = keepers[0];
      r.guessed = true;
      r.guessedBy = "name";
      r.matchedBy = "name";
      takenBy[keepers[0]] = r.key;
    });
    // A drawn host without addresses that has the scanned host's name is
    // guessed to be it, as nmap's own host is (spec §3.3).
```

**4.** The row's label and its names. Find:

```js
      var label = target ? doc.entities[target].label : ((h.names || [])[0] || {}).name || h.hostname || h.addresses[0];
      var have = target ? doc.entities[target].identities || [] : [];
```

Write in its place:

```js
      var label = target ? doc.entities[target].label : (bestName(h) || {}).name || h.hostname || h.addresses[0];
      var have = target ? doc.entities[target].identities || [] : [];
      var called = namesOf(h);
      var kept = target ? doc.entities[target].names || [] : [];
```

**5.** The row carries them. Find:

```js
        vendor: h.vendor || null,
        seen: target ?
```

Write in its place:

```js
        vendor: h.vendor || null,
        names: called.good,
        newNames: called.good.filter(function (n) { return kept.indexOf(n) < 0; }),
        saidNames: called.said,
        seen: target ?
```

**6.** A tick group for them. Find:

```js
identities: {}, moves: {}, strips: {}, renames: {}, seen: true, routers: {} };
```

Write in its place:

```js
identities: {}, names: {}, moves: {}, strips: {}, renames: {}, seen: true, routers: {} };
```

**7.** Ticked at first: they only add knowledge. Find:

```js
      t.identities[h.key] = true;
      t.moves
```

Write in its place:

```js
      t.identities[h.key] = true;
      t.names[h.key] = true;
      t.moves
```

**8.** What a ticked row does. Find:

```js
      identities: on("identities") || same ? h.newIdentities : [],
```

Write in its place:

```js
      identities: on("identities") || same ? h.newIdentities : [],
      names: on("names") ? h.newNames : [],
```

**9.** Counted. Find:

```js
identified: 0, moved: 0,
```

Write in its place:

```js
identified: 0, named: 0, moved: 0,
```

**10.** Counted per drawn host. Find:

```js
      if (!added && does.identities.length) s.identified++;
```

Write in its place:

```js
      if (!added && does.identities.length) s.identified++;
      if (!added && does.names.length) s.named++;
```

**11.** Said. Find:

```js
    if (s.identified) parts.push("identities for " + n(s.identified, "drawn host"));
```

Write in its place:

```js
    if (s.identified) parts.push("identities for " + n(s.identified, "drawn host"));
    if (s.named) parts.push("names for " + n(s.named, "drawn host"));
```

**12.** An import that only names is an edit. Find:

```js
!s.identified && !s.moved
```

Write in its place:

```js
!s.identified && !s.named && !s.moved
```

**13.** A new host is drawn with them. Find:

```js
        if (h.identities.length) next.entities[host].identities = h.identities.slice();
```

Write in its place:

```js
        if (h.identities.length) next.entities[host].identities = h.identities.slice();
        if (h.names.length && ticks.names && ticks.names[h.key]) next.entities[host].names = h.names.slice();
```

**14.** A drawn host gains them. Find:

```js
        if (does.move) {
          without(host, h.moved.from);
```

Write in its place:

```js
        if (does.names.length) e.names = (e.names || []).concat(does.names);
        if (does.move) {
          without(host, h.moved.from);
```

In `scripts/nmap.test.js`, 1 edit, in this order. Each *find* stands in the file exactly once.

**1.** A host the scan saw gains its names too. Find:

```js
    const { identities, vendor, seen, ...rest } = out.entities[id];
```

Write in its place:

```js
    const { identities, vendor, seen, names, ...rest } = out.entities[id];
```

In `scripts/nmap.test.js`, in the same test, add after the line that asserts `out.entities.srv.seen`:

```js
  assert.deepEqual(out.entities.srv.names, ['srv-01.lab'], 'and the name the scan read');
```

- [ ] **Step 4: Run the tests**

Run: `node --test scripts/nmap-plan.test.js`
Expected: PASS.

- [ ] **Step 5: Regenerate the pinned documents and read the difference**

Run: `NMAP_FIXTURE=write npm test; git diff --stat scripts/fixtures`
Expected: six `imported*.doc.json` files change. Read `git diff scripts/fixtures`: every changed line belongs to a `"names": […]` list added to a host (thirteen lists; `srv-01.lab`, `fritz.box`, `app.lab` among them), and nothing else moves. If anything else moved, stop and find out why before going on.
Run: `npm test && cargo test -p effractor-format --test json && scripts/build-wasm.sh && node scripts/check-nmap-wasm.js`
Expected: PASS; `scanner imports: the imported documents save and validate in wasm`.

- [ ] **Step 6: Say it in the preview**

In `assets/js/nmap-ui.js`, 1 edit, in this order. Each *find* stands in the file exactly once.

**1.** Said in the preview, under the host. Find:

```js
    if (h.rename) offer("renames", "rename to “" + h.rename.to + "” · its " + h.rename.from + " name");
```

Write in its place:

```js
    if (h.rename) offer("renames", "rename to “" + h.rename.to + "” · its " + h.rename.from + " name");
    // Nuclei templates spec §8: the names it bears, kept on the host.
    if (h.newNames.length) {
      if (target) offer("names", "keeps " + (h.newNames.length === 1 ? "the name " : "the names ") + h.newNames.join(", "));
      else list.appendChild(plain(h.newNames.join(", ")));
    }
    if (h.saidNames.length) list.appendChild(plain("not kept, no DNS name: " + h.saidNames.join(", ")));
```

- [ ] **Step 7: Commit**

```bash
npm test
git add assets/js/nmap-plan.js assets/js/nmap-ui.js scripts/nmap-plan.test.js scripts/nmap.test.js scripts/fixtures
git commit -m "Every import keeps the names it reads and knows a host by them"
```

### Task 3a: Show part 1 to the owner, then land it

- [ ] **Step 1: Build and start a preview**

```bash
scripts/build-wasm.sh && cargo build -p effractor-server
target/debug/effractor --bind 127.0.0.1:8081 --accounts "$SCRATCH/preview.db" --data "$SCRATCH/preview-data" --public-url http://localhost:8081
```

(`$SCRATCH` is the session's scratchpad directory; run the server in the background.)

- [ ] **Step 2: Tell the owner what to look at, in plain words**

> On http://localhost:8081: select a host. Under *Addresses* there is a new field *Names*; type `app.corp.example, www.corp.example` and leave the field. Type `*.corp.example`: it is refused and says why. Then paste an nmap result of a host with a name: under the host, the preview has a new ticked line *keeps the name …*.

Wait for the owner's word. Change what they ask, show again.

- [ ] **Step 3: Land**

Write the PR body and the commit message to files in the scratchpad, then:

```bash
scripts/dev/ship.sh "A host keeps its DNS names" "$SCRATCH/pr-names.md" "$SCRATCH/commit-names.txt"
```

Expected: CI green for that commit, master fast-forwarded, the release run green.

---

# Part 2 — the templates and their command (branch `nuclei-own-templates`)

Nothing of this part shows in the page yet: the dialog offers the templates in part 5.

### Task 4: The table of answers, and the templates written from it

**Files:**
- Create: `assets/js/nuclei-templates.js`
- Create: `scripts/dev/nuclei-templates-write.js`
- Create (written by that script): `assets/nuclei/effractor-banner.yaml`, `effractor-web.yaml`, `effractor-certificate.yaml`, `effractor-login.yaml`, `effractor-points-to.yaml`
- Create: `assets/nuclei/README.md`
- Modify: `crates/effractor-server/templates/shell.html:48` (one script tag), `crates/effractor-server/src/shell.rs:119-123` (its order)
- Modify: `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` §5.3, §9
- Test: `scripts/nuclei-templates.test.js` (new)

**Interfaces:**
- Consumes: nothing of part 1.
- Produces (`window.effractorNucleiTemplates`, `require('../assets/js/nuclei-templates.js')`):
  - `TEMPLATES: [{id, group: "identify" | "connect", protocol: "tcp" | "http" | "ssl" | "dns", name}]`
  - `ANSWERS: [{name, template, is, …}]` — `is` is one of `product`, `server`, `application`, `version`, `names`, `login`, `sso`, `address`, `alias`, `said`. Fields by kind: `product` (the label without version), `gives: "version"` (the value is the version), `of` (the application a `version` belongs to), `manages: true`, `signs: true`, `server` (the `Server` word that is the application itself), `kind` (a sign-on's product), `decode`, `unless`; and how it is found: `paths` (http only), `part`, `regex` (a string or a list, one part), `group`, `kval`, `json`.
  - `answer(name): object | null`
  - `text(templateId): string | null` — the template, ending in one line feed.
  - `pattern(answer): RegExp[]` — the answer's patterns as JavaScript reads them, for tests.
  - `VERSION: string` — `([0-9][0-9A-Za-z._-]*)`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/nuclei-templates.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const T = require('../assets/js/nuclei-templates.js');

// effractor's own nuclei templates (nuclei templates spec §2): the table of
// what they answer, and their text written from it.
const texts = () => T.TEMPLATES.map(t => [t.id, T.text(t.id)]);

test('five templates, in two groups', () => {
  assert.deepEqual(T.TEMPLATES.map(t => [t.id, t.group, t.protocol]), [
    ['effractor-banner', 'identify', 'tcp'],
    ['effractor-web', 'identify', 'http'],
    ['effractor-certificate', 'identify', 'ssl'],
    ['effractor-login', 'connect', 'http'],
    ['effractor-points-to', 'connect', 'dns'],
  ]);
  assert.equal(T.text('nope'), null);
});

test('spec §2.1: no backslash, no single quote, printable ASCII; they only read', () => {
  for (const [id, text] of texts()) {
    assert.doesNotMatch(text, /[\\']/, id);
    assert.doesNotMatch(text, /[^\n\x20-\x7e]/, id);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), id);
    assert.ok(text.startsWith('id: ' + id + '\ninfo:\n  name: '), id);
    assert.match(text, /\n  author: effractor\n  severity: info\n(tcp|http|ssl|dns):\n/, id);
    assert.equal((text.match(/^(tcp|http|ssl|dns|javascript|code|headless|file|workflows?|websocket|whois):/gm) || []).length, 1, id);
    assert.doesNotMatch(text, /interactsh|payloads?:|body:|raw:|fuzzing:|attack:|\{\{(?!BaseURL|Hostname|Host|Port|FQDN)[^}]*\}\}/, id);
    for (const m of text.match(/^\s+- method: .*$/gm) || []) assert.equal(m.trim(), '- method: GET', id);
    // A value that holds a double quote is a folded block; any other is quoted.
    for (const line of text.split('\n')) if (/^\s+- "/.test(line)) assert.match(line, /^\s+- "[^"]*"$/, id + ': ' + line);
  }
});

test('spec §2.1: every extractor is named, each name once, and the table knows each', () => {
  const names = T.ANSWERS.map(a => a.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  for (const a of T.ANSWERS) {
    assert.match(a.name, /^[a-z][a-z0-9-]*$/, a.name);
    assert.ok(T.TEMPLATES.some(t => t.id === a.template), a.name);
    assert.equal(T.answer(a.name), a);
    assert.ok(['product', 'server', 'application', 'version', 'names', 'login', 'sso', 'address', 'alias', 'said'].includes(a.is), a.name);
    if (a.is === 'version') assert.equal((T.answer(a.of) || {}).is, 'application', a.name + ' of ' + a.of);
    if (a.is === 'product' || a.is === 'application') assert.ok(a.product && !/[0-9]$/.test(a.product), a.name);
    if (a.unless) assert.ok(T.answer(a.unless), a.name);
    const http = T.TEMPLATES.find(t => t.id === a.template).protocol === 'http';
    assert.equal(Array.isArray(a.paths) && a.paths.length > 0, http, a.name + ': paths are an http answer\'s');
    for (const p of T.pattern(a)) assert.ok(p instanceof RegExp, a.name);
  }
  for (const [id, text] of texts()) {
    const written = (text.match(/^        name: .*$/gm) || []).map(l => l.trim().slice(6));
    const mine = T.ANSWERS.filter(a => a.template === id).map(a => a.name);
    assert.deepEqual([...new Set(written)].sort(), mine.slice().sort(), id);
    assert.equal((text.match(/^      - type: /gm) || []).length, written.length, id + ': an extractor without a name');
  }
});

test('spec §5.3: the web template asks the root page and at most sixteen further paths', () => {
  const paths = [...new Set(T.ANSWERS.filter(a => a.paths).flatMap(a => a.paths))];
  assert.ok(paths.includes('/'));
  assert.ok(paths.length - 1 <= 16, paths.join(' '));
  for (const p of paths) assert.match(p, /^\/[0-9A-Za-z._\/?=+-]*$/, p);
  const web = T.text('effractor-web');
  assert.equal((web.match(/host-redirects: true\n    max-redirects: 3/g) || []).length, 1, 'redirects are followed from the root page, on the same host');
  assert.doesNotMatch(web, /\n    redirects: true/);
});

test('about fifty applications, the management pages and sign-ons among them marked', () => {
  const apps = T.ANSWERS.filter(a => a.is === 'application');
  assert.equal(apps.length, 49);
  assert.deepEqual(apps.filter(a => a.signs).map(a => a.name), ['keycloak', 'adfs']);
  assert.deepEqual(apps.filter(a => a.manages).map(a => a.name), ['fortigate', 'big-ip', 'sonicwall', 'vcenter', 'esxi', 'proxmox-ve', 'hpe-ilo', 'dell-idrac', 'synology-dsm', 'pfsense', 'opnsense', 'fritzbox', 'mikrotik-routeros', 'webmin', 'portainer']);
});

test('the files the page serves are what the table writes', () => {
  for (const [id, text] of texts()) assert.equal(fs.readFileSync('assets/nuclei/' + id + '.yaml', 'utf8'), text, id + ': run node scripts/dev/nuclei-templates-write.js');
  assert.deepEqual(fs.readdirSync('assets/nuclei').sort(), ['README.md'].concat(T.TEMPLATES.map(t => t.id + '.yaml')).sort());
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nuclei-templates.test.js`
Expected: FAIL with `Cannot find module '../assets/js/nuclei-templates.js'`.

- [ ] **Step 3: Write the module**

Create `assets/js/nuclei-templates.js`:

```js
// nuclei templates of effractor's own (nuclei templates spec): the table of
// everything a template can answer, the templates' text written from it,
// what they are pointed at, the command that carries them, and the reading
// of their answers. The traces of the applications are taken from the
// nuclei-templates collection (MIT, ProjectDiscovery; assets/nuclei/README.md),
// rewritten without backslash and single quote: the command holds the text
// between single quotes, where fish reads a backslash and sh does not. Pure.
(function () {
  var node = typeof module !== "undefined";

  var TEMPLATES = [
    { id: "effractor-banner", group: "identify", protocol: "tcp", name: "What answers on a port" },
    { id: "effractor-web", group: "identify", protocol: "http", name: "Which web server and application" },
    { id: "effractor-certificate", group: "identify", protocol: "ssl", name: "Which names a certificate bears" },
    { id: "effractor-login", group: "connect", protocol: "http", name: "Where someone logs in" },
    { id: "effractor-points-to", group: "connect", protocol: "dns", name: "What a name points to" },
  ];

  // A version as every answer gives it.
  var VERSION = "([0-9][0-9A-Za-z._-]*)";
  var B = "effractor-banner", W = "effractor-web", L = "effractor-login";
  var ROOT = ["/"];

  function product(name, label, regex, more) {
    return Object.assign({ name: name, template: B, is: "product", product: label, regex: regex }, regex.indexOf(VERSION) >= 0 ? { gives: "version", group: 1 } : {}, more || {});
  }
  // `found`: [part, pattern]; `more`: manages, signs, server, paths.
  function app(name, label, found, more) {
    return Object.assign({ name: name, template: W, is: "application", product: label, paths: ROOT, part: found[0], regex: found[1] }, more || {});
  }
  function version(of, found, more) {
    return Object.assign({ name: of + "-version", template: W, is: "version", of: of, paths: ROOT, part: found[0], regex: found[1], group: 1 }, more || {});
  }
  function sso(name, kind, part, regex) {
    return { name: name, template: L, is: "sso", kind: kind, paths: ROOT, part: part, regex: regex, group: 1 };
  }
  // Where a sign-on is named: in a redirect that leaves the host, in a link.
  function sent(to) {
    return ["(?i)location:[[:space:]]*(https?://[^[:space:]]*" + to + "[^[:space:]]*)"];
  }
  function linked(to) {
    return ["(?i)(?:href|action)=\"(https?://[^\"[:space:]]*" + to + "[^\"[:space:]]*)\""];
  }

  var ANSWERS = [
    // ---- what answers on a port (spec §5.1), spelled as nmap spells it ----
    product("openssh", "OpenSSH", "SSH-[0-9.]+-OpenSSH_" + VERSION),
    product("dropbear", "Dropbear sshd", "SSH-[0-9.]+-dropbear_" + VERSION),
    product("vsftpd", "vsftpd", "220[ -][(]?vsFTPd " + VERSION),
    product("proftpd", "ProFTPD", "220[ -]ProFTPD " + VERSION),
    product("pure-ftpd", "Pure-FTPd", "220-+ Welcome to Pure-FTPd"),
    product("postfix", "Postfix smtpd", "220 [^ ]+ ESMTP Postfix"),
    product("exim", "Exim smtpd", "220 [^ ]+ ESMTP Exim " + VERSION),
    product("sendmail", "Sendmail", "ESMTP Sendmail " + VERSION),
    product("exchange-smtp", "Microsoft Exchange smtpd", "Microsoft ESMTP MAIL Service"),
    product("dovecot", "Dovecot", "[*+] ?OK.*Dovecot"),
    product("courier", "Courier", "[*+] ?OK.*Courier"),
    product("cyrus", "Cyrus", "[*+] ?OK.*Cyrus (?:IMAP|POP3)[^ ]* v?" + VERSION),
    product("mariadb", "MariaDB", "([0-9]+[.][0-9]+[.][0-9]+)-MariaDB", { gives: "version", group: 1 }),
    // MariaDB's handshake names the same plugins: where both answer, it is MariaDB.
    product("mysql", "MySQL", "(?s)([0-9]+[.][0-9]+[.][0-9]+)[^[:cntrl:]]*[[:cntrl:]].*(?:mysql_native_password|caching_sha2_password)", { gives: "version", group: 1, unless: "mariadb" }),
    { name: "banner", template: B, is: "said", regex: "^[ -~]{4,120}" },

    // ---- the web server and the page's own words (spec §5.2) ----
    { name: "server", template: W, is: "server", paths: ROOT, kval: "server" },
    { name: "title", template: W, is: "said", paths: ROOT, part: "body", regex: "(?i)<title>([^<]{1,120})</title>", group: 1 },

    // ---- the web application (spec §5.3): monitoring and data ----
    app("grafana", "Grafana", ["body", "window[.]grafanaBootData"]),
    version("grafana", ["body", "\"version\":\"" + VERSION + "\""]),
    app("kibana", "Kibana", ["header", "(?i)kbn-name:"]),
    version("kibana", ["header", "(?i)kbn-version:[[:space:]]*" + VERSION]),
    app("elasticsearch", "Elasticsearch", ["body", "You Know, for Search"]),
    version("elasticsearch", ["body", "\"number\"[[:space:]]*:[[:space:]]*\"" + VERSION + "\""]),
    app("zabbix", "Zabbix", ["body", "Zabbix SIA|zbxCallPostScripts"]),
    app("prtg", "PRTG Network Monitor", ["header", "(?i)server:[[:space:]]*PRTG"], { server: "prtg" }),
    version("prtg", ["header", "(?i)server:[[:space:]]*PRTG/" + VERSION]),
    app("splunk", "Splunk", ["header", "(?i)server:[[:space:]]*Splunkd"], { server: "splunkd" }),
    version("splunk", ["body", "\"VERSION_LABEL\":[[:space:]]*\"" + VERSION + "\""]),
    // ---- development ----
    app("gitlab", "GitLab", ["body", "about[.]gitlab[.]com"]),
    app("gitea", "Gitea", ["body", "Powered by Gitea"]),
    version("gitea", ["body", "Gitea Version:[[:space:]]*" + VERSION]),
    app("jenkins", "Jenkins", ["header", "(?i)x-jenkins:"]),
    version("jenkins", ["header", "(?i)x-jenkins:[[:space:]]*" + VERSION]),
    app("sonarqube", "SonarQube", ["body", "/css/sonar[.]css"]),
    version("sonarqube", ["body", "/css/sonar[.]css[?]v=" + VERSION]),
    app("nexus-repository", "Nexus Repository", ["body", "nexus-coreui-bundle|Sonatype Nexus Repository"]),
    version("nexus-repository", ["body", "nexus-coreui-bundle[^\"]*_v=" + VERSION]),
    app("harbor", "Harbor", ["body", "<harbor-app>"]),
    version("harbor", ["body", "\"harbor_version\":[[:space:]]*\"v?" + VERSION + "\""], { paths: ["/api/v2.0/systeminfo"] }),
    // ---- collaboration and mail ----
    app("confluence", "Confluence", ["body", "confluence-base-url"]),
    version("confluence", ["body", "<meta name=\"ajs-version-number\" content=\"" + VERSION + "\""]),
    app("jira", "Jira", ["body", "com[.]atlassian[.]jira"]),
    version("jira", ["body", "title=\"JiraVersion\" value=\"" + VERSION]),
    app("bitbucket", "Bitbucket", ["body", "com[.]atlassian[.]bitbucket[.]server|bitbucket-webpack-INTERNAL"]),
    version("bitbucket", ["body", "id=\"product-version\"[^>]*>[[:space:]]*v?" + VERSION]),
    app("nextcloud", "Nextcloud", ["body", "var nc_lastLogin|var nc_pageLoad"]),
    version("nextcloud", ["body", "\"version\":\"" + VERSION + "\""]),
    app("wordpress", "WordPress", ["body", "name=\"generator\" content=\"WordPress|/wp-content/"]),
    version("wordpress", ["body", "name=\"generator\" content=\"WordPress " + VERSION + "\""]),
    app("roundcube", "Roundcube Webmail", ["body", "\"rcversion\":"]),
    // 10611 is 1.6.11.
    version("roundcube", ["body", "\"rcversion\":([0-9]{5,6})"], { decode: "rcversion" }),
    app("zimbra", "Zimbra", ["header", "(?i)set-cookie:[[:space:]]*ZM_(?:LOGIN_CSRF|TEST)"]),
    version("zimbra", ["body", "CLIENT_VERSION\"[^\"]*defaultValue:\"" + VERSION], { paths: ["/js/zimbraMail/share/model/ZmSettings.js"] }),
    app("outlook-web", "Outlook on the web", ["header", "(?i)x-owa-version:"], { paths: ["/", "/owa/auth/logon.aspx"] }),
    version("outlook-web", ["header", "(?i)x-owa-version:[[:space:]]*" + VERSION], { paths: ["/", "/owa/auth/logon.aspx"] }),
    app("sharepoint", "SharePoint", ["header", "(?i)microsoftsharepointteamservices:"]),
    version("sharepoint", ["header", "(?i)microsoftsharepointteamservices:[[:space:]]*" + VERSION]),
    // ---- identity ----
    app("keycloak", "Keycloak", ["body", "kc-form-buttons|<span>Keycloak</span>"], { signs: true }),
    app("adfs", "AD FS", ["body", "/adfs/portal/css/style[.]css"], { signs: true, paths: ["/adfs/ls/idpinitiatedsignon.aspx"] }),
    // ---- remote access and edge ----
    app("citrix-gateway", "Citrix Gateway", ["header", "(?i)set-cookie:[[:space:]]*(?:NSC_|citrix_ns_id)"], { paths: ["/", "/vpn/index.html"] }),
    app("globalprotect", "GlobalProtect", ["body", "(?s)GlobalProtect Portal.*global-protect|global-protect.*GlobalProtect Portal"], { paths: ["/global-protect/login.esp"] }),
    app("ivanti-connect-secure", "Ivanti Connect Secure", ["body", "/dana-na/"]),
    app("cisco-asa", "Cisco Secure Firewall ASA", ["body", "/[+]CSCOU[+]/portal[.]css"], { paths: ["/", "/+CSCOE+/logon.html"] }),
    app("guacamole", "Apache Guacamole", ["body", "guacamole-logo"]),
    app("fortigate", "FortiGate", ["body", "top[.]location=\"/remote/login\""], { manages: true }),
    app("big-ip", "F5 BIG-IP", ["body", "(?s)Configuration Utility.*F5 Networks|F5 Networks.*Configuration Utility"], { manages: true, paths: ["/tmui/login.jsp"] }),
    app("sonicwall", "SonicWall", ["header", "(?i)server:[[:space:]]*SonicWALL"], { manages: true, server: "sonicwall", paths: ["/", "/cgi-bin/welcome"] }),
    version("sonicwall", ["header", "(?i)server:[[:space:]]*SMA/" + VERSION], { paths: ["/", "/cgi-bin/welcome"] }),
    // ---- machines and their management ----
    app("vcenter", "VMware vCenter", ["body", "content=\"VMware vCenter"], { manages: true }),
    app("esxi", "VMware ESXi", ["body", "(?i)esxUiApp|content=\"VMware ESXi"], { manages: true }),
    app("proxmox-ve", "Proxmox VE", ["body", "PVEAuthCookie"], { manages: true }),
    version("proxmox-ve", ["body", "pvemanagerlib[.]js[?]ver=" + VERSION]),
    app("hpe-ilo", "HPE iLO", ["body", "(?s)<RIMP>.*<HSI>"], { manages: true, paths: ["/xmldata?item=all"] }),
    version("hpe-ilo", ["body", "<FWRI>" + VERSION + "</FWRI>"], { paths: ["/xmldata?item=all"] }),
    app("dell-idrac", "Dell iDRAC", ["body", "<idrac-start-screen|thisIDRACText"], { manages: true, paths: ["/", "/login.html"] }),
    version("dell-idrac", ["body", "\"FwVer\"[[:space:]]*:[[:space:]]*\"" + VERSION + "\""], { paths: ["/sysmgmt/2015/bmc/info"] }),
    app("synology-dsm", "Synology DSM", ["body", "content=\"Synology DiskStation|class=\"logo-synology\""], { manages: true }),
    app("pfsense", "pfSense", ["body", "(?s)pfSense - Login.*Netgate|Netgate.*pfSense - Login"], { manages: true }),
    // The title and the login field: the title alone names nothing.
    app("opnsense", "OPNsense", ["body", "(?s)[|] OPNsense</title>.*usernamefld"], { manages: true }),
    app("fritzbox", "FRITZ!Box", ["body", "<e:BoxInfo"], { manages: true, paths: ["/juis_boxinfo.xml"] }),
    app("mikrotik-routeros", "MikroTik RouterOS", ["body", "RouterOS router configuration page"], { manages: true, server: "mikrotik" }),
    version("mikrotik-routeros", ["body", "RouterOS v?" + VERSION]),
    app("webmin", "Webmin", ["header", "(?i)server:[[:space:]]*MiniServ"], { manages: true, server: "miniserv" }),
    version("webmin", ["header", "(?i)server:[[:space:]]*MiniServ/" + VERSION]),
    app("portainer", "Portainer", ["body", "ng-app=\"portainer|portainer[.]auth"], { manages: true }),
    // ---- middleware and stores ----
    app("tomcat", "Apache Tomcat", ["body", "(?s)Apache Tomcat.*/manager/html"]),
    version("tomcat", ["body", "Apache Tomcat/" + VERSION]),
    app("weblogic", "Oracle WebLogic Server", ["body", "WebLogic Server Version:"], { paths: ["/console/login/LoginForm.jsp"] }),
    version("weblogic", ["body", "WebLogic Server Version: " + VERSION], { paths: ["/console/login/LoginForm.jsp"] }),
    app("sap-netweaver", "SAP NetWeaver", ["header", "(?i)sap-server:"]),
    app("phpmyadmin", "phpMyAdmin", ["body", "name=\"pma_username|phpMyAdmin[.]css[.]php"], { paths: ["/", "/phpmyadmin/"] }),
    version("phpmyadmin", ["body", "PMA_VERSION:\"" + VERSION], { paths: ["/", "/phpmyadmin/"] }),
    app("vault", "HashiCorp Vault", ["body", "vault/config/environment"]),
    version("vault", ["body", "\"version\":[[:space:]]*\"" + VERSION + "\""], { paths: ["/v1/sys/health"] }),
    // Its root page sends on to /login.aspx, which is followed.
    app("veeam", "Veeam Backup Enterprise Manager", ["body", "(?s)Veeam Backup Enterprise Manager.*login[.]bundle[.]js"]),
    version("veeam", ["body", "login[.]bundle[.]js[?]v=" + VERSION]),

    // ---- the names a certificate bears (spec §5.5) ----
    { name: "names", template: "effractor-certificate", is: "names", json: ".subject_an[]" },
    { name: "subject", template: "effractor-certificate", is: "names", json: ".subject_cn" },

    // ---- logins and where they are sent (spec §6.1, §6.2) ----
    { name: "login", template: L, is: "login", paths: ROOT, part: "body", regex: "(?i)<input[^>]*type=[\"]?password" },
    sso("sso-keycloak", "Keycloak", "header", sent("/realms/[^/[:space:]]+/protocol/(?:openid-connect|saml)")),
    sso("sso-adfs", "AD FS", "header", sent("/adfs/(?:ls|oauth2)")),
    sso("sso-entra", "Microsoft Entra ID", "header", sent("login[.]microsoftonline[.]com")),
    sso("sso-okta", "Okta", "header", sent("[.]okta[.]com")),
    sso("sso-google", "Google sign-in", "header", sent("accounts[.]google[.]com")),
    sso("sso-saml", null, "header", sent("[?&]SAMLRequest=")),
    sso("sso-oidc", null, "header", sent("[?&]response_type=[^[:space:]]*client_id=|[?&]client_id=[^[:space:]]*response_type=")),
    // The same, as a link or a form on the login page.
    sso("sso-keycloak-link", "Keycloak", "body", linked("/realms/[^/\"[:space:]]+/protocol/(?:openid-connect|saml)")),
    sso("sso-adfs-link", "AD FS", "body", linked("/adfs/(?:ls|oauth2)")),
    sso("sso-entra-link", "Microsoft Entra ID", "body", linked("login[.]microsoftonline[.]com")),
    sso("sso-okta-link", "Okta", "body", linked("[.]okta[.]com")),
    sso("sso-google-link", "Google sign-in", "body", linked("accounts[.]google[.]com")),

    // ---- what a name points to (spec §6.4) ----
    { name: "address", template: "effractor-points-to", is: "address", regex: "IN[[:space:]]+A[[:space:]]+([0-9.]+)", group: 1 },
    { name: "alias", template: "effractor-points-to", is: "alias", regex: "IN[[:space:]]+CNAME[[:space:]]+([0-9A-Za-z._-]+)", group: 1 },
  ];

  var byName = Object.create(null);
  ANSWERS.forEach(function (a) { byName[a.name] = a; });
  function answer(name) {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : null;
  }
  function template(id) {
    return TEMPLATES.filter(function (t) { return t.id === id; })[0] || null;
  }
  function patterns(a) {
    return a.regex == null ? [] : [].concat(a.regex);
  }

  // ---- the templates' text (spec §2) ----

  // A value between double quotes; one that holds a double quote as a
  // folded block, which needs no escape.
  function value(indent, text) {
    return text.indexOf('"') < 0 ? ' "' + text + '"' : " >-\n" + indent + "  " + text;
  }
  function extractor(a) {
    var type = a.kval ? "kval" : a.json ? "json" : "regex";
    var out = ["      - type: " + type, "        name: " + a.name];
    if (a.part) out.push("        part: " + a.part);
    if (a.group != null) out.push("        group: " + a.group);
    out.push("        " + type + ":");
    (type === "regex" ? patterns(a) : [a.kval || a.json]).forEach(function (p) {
      out.push("          -" + value("          ", p));
    });
    return out;
  }
  function text(id) {
    var t = template(id);
    if (!t) return null;
    var mine = ANSWERS.filter(function (a) { return a.template === id; });
    var out = ["id: " + t.id, "info:", "  name: " + t.name, "  author: effractor", "  severity: info", t.protocol + ":"];
    function extractors(list) {
      out.push("    extractors:");
      list.forEach(function (a) { out = out.concat(extractor(a)); });
    }
    if (t.protocol === "tcp") {
      // One line feed: what speaks first has spoken, what waits answers.
      out.push("  - host:", '      - "{{Hostname}}"', "    inputs:", '      - data: "0a"', "        type: hex", "    read-size: 256");
      extractors(mine);
    } else if (t.protocol === "ssl") {
      out.push('  - address: "{{Host}}:{{Port}}"');
      extractors(mine);
    } else if (t.protocol === "dns") {
      out.push('  - name: "{{FQDN}}"', "    type: A", "    class: inet", "    recursion: true");
      extractors(mine);
    } else {
      // One request per path, each with the answers found there; redirects
      // are followed from the root page only, and only on the same host.
      var paths = [];
      mine.forEach(function (a) {
        a.paths.forEach(function (p) { if (paths.indexOf(p) < 0) paths.push(p); });
      });
      paths.forEach(function (p) {
        out.push("  - method: GET", "    path:", '      - "{{BaseURL}}' + p + '"');
        if (p === "/") out.push("    host-redirects: true", "    max-redirects: 3");
        extractors(mine.filter(function (a) { return a.paths.indexOf(p) >= 0; }));
      });
    }
    return out.join("\n") + "\n";
  }

  // The answer's patterns as JavaScript reads them: Go's classes and its
  // leading flags written JavaScript's way. For tests; nuclei reads the
  // templates.
  function pattern(a) {
    return patterns(a).map(function (p) {
      var flags = "";
      var m = /^\(\?([is]+)\)/.exec(p);
      if (m) {
        flags = m[1];
        p = p.slice(m[0].length);
      }
      return new RegExp(p.replace(/\[\[:space:\]\]/g, "\\s").replace(/\[\^([^\]]*)\[:space:\]\]/g, "[^$1\\s]").replace(/\[\[:cntrl:\]\]/g, "[\\x00-\\x1f]").replace(/\[\^\[:cntrl:\]\]/g, "[^\\x00-\\x1f]"), flags);
    });
  }

  var api = { TEMPLATES: TEMPLATES, ANSWERS: ANSWERS, VERSION: VERSION, answer: answer, text: text, pattern: pattern };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNucleiTemplates = api;
})();
```

A pattern that uses `(?i)` or `(?s)` inside an alternation is written with the flag at its very start only; `pattern` reads no other place.

- [ ] **Step 4: Write the files from the table**

Create `scripts/dev/nuclei-templates-write.js`:

```js
#!/usr/bin/env node
// Writes assets/nuclei/*.yaml from the table in assets/js/nuclei-templates.js
// (nuclei templates spec §2); scripts/nuclei-templates.test.js holds them equal.
const fs = require('node:fs');
const path = require('node:path');
const T = require('../../assets/js/nuclei-templates.js');

const dir = path.resolve(__dirname, '../../assets/nuclei');
fs.mkdirSync(dir, { recursive: true });
for (const t of T.TEMPLATES) fs.writeFileSync(path.join(dir, t.id + '.yaml'), T.text(t.id));
console.log('wrote ' + T.TEMPLATES.length + ' templates to assets/nuclei');
```

Create `assets/nuclei/README.md`:

```markdown
# effractor's nuclei templates

Five templates that ask what the drawing needs: what answers on a port, which
web server and application, which names a certificate bears, where someone
logs in, and what a name points to. They only read: `GET` requests, one line
feed, a TLS handshake, a DNS question. The page writes the command that
carries them; nothing here has to be downloaded.

The files are written from the table in `assets/js/nuclei-templates.js`
(`node scripts/dev/nuclei-templates-write.js`); change the table, not the
files.

The traces by which applications are known are taken from the
[nuclei-templates](https://github.com/projectdiscovery/nuclei-templates)
collection, © ProjectDiscovery, Inc., MIT licence, and rewritten: reduced to
what needs no login, without backslashes and single quotes.
```

Run: `node scripts/dev/nuclei-templates-write.js`
Expected: `wrote 5 templates to assets/nuclei`.

- [ ] **Step 5: Run the tests**

Run: `node --test scripts/nuclei-templates.test.js`
Expected: PASS.

- [ ] **Step 6: Let nuclei read them**

Run: `nuclei -t assets/nuclei/ -validate -disable-update-check -no-interactsh < /dev/null 2>&1 | tail -1`
Expected: `[INF] All templates validated successfully`. (`-validate` reads the files and contacts nothing.) A pattern nuclei refuses is named in its output: correct it in the table, write the files again.

- [ ] **Step 7: Load the module in the page**

In `crates/effractor-server/templates/shell.html`, before the line that loads `nuclei.js`:

```html
<script src="{{ asset_prefix }}assets/js/nuclei-templates.js" defer></script>
```

In `crates/effractor-server/src/shell.rs`, in `assert_script_order`, replace the two nuclei lines with:

```rust
        // nuclei's reader has its commands' names (roadmap nuclei-import) and
        // effractor's own templates (nuclei templates spec §9).
        assert!(at("nmap-read.js") < at("nuclei-command.js"));
        assert!(at("nuclei-command.js") < at("nuclei-templates.js"));
        assert!(at("nuclei-templates.js") < at("nuclei.js"));
```

Run: `cargo test -p effractor-server shell`
Expected: PASS.

- [ ] **Step 8: Amend the spec**

In `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md`:

§5.3: strike Prometheus, QNAP QTS and RabbitMQ from the table, replace "Fifty-two." with:

```markdown
Forty-nine. Prometheus, QNAP QTS and RabbitMQ were struck with the plan
(2026-09-28): the collection knows them by their title alone, and no second
trace shows without a login.
```

§9: in the table of modules, replace the row of `nuclei-command.js` with these three:

```markdown
| `nuclei.js` | hands `effractor-` records on; adds the two recipes before nuclei's; the rest as today | the above |
| `nmap-products.js` (pure) | one comparison of products for every scanner (§7.3) | nothing |
| `nmap-connect.js` (pure) | plans and applies the connections (§6) | `nuclei-templates.js`, `nmap-products.js` |
```

and replace the paragraph that starts "`command` is given the templates' text" with:

```markdown
The templates' text is written by `nuclei-templates.js` from its table
(amended with the plan, 2026-09-28); the files in `assets/nuclei/` are that
text, held equal by a test and served for reading. The page fetches nothing
to write the command.
```

- [ ] **Step 9: Commit**

```bash
npm test && cargo test -p effractor-server
git add assets/js/nuclei-templates.js assets/nuclei scripts/dev/nuclei-templates-write.js scripts/nuclei-templates.test.js crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs docs/superpowers/specs/2026-09-28-nuclei-templates-design.md
git commit -m "effractor's nuclei templates, written from one table of what they answer"
```

### Task 5: The targets from the drawing, and the command

**Files:**
- Modify: `assets/js/nuclei-templates.js` (add `targets`, `command`, `USUAL_PORTS`, `GROUPS`, `ADJUST`)
- Modify: `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` §3, §3.1
- Test: `scripts/nuclei-templates.test.js`, `scripts/shell-commands.test.js`, `scripts/nuclei-command.test.js`

**Interfaces:**
- Consumes: `T.TEMPLATES`, `T.text` (Task 4); `Ad.bytes`, `Ad.covers` (`nmap-address.js`); `C.target`, `C.BLOCKS`, `C.DEFAULTS` (`nuclei-command.js`); `A.isName` (Task 2).
- Produces:
  - `T.USUAL_PORTS: number[]` — 32 ports, ascending.
  - `T.GROUPS: ["identify", "connect"]`; `T.ADJUST: ["speed", "patience", "errors", "addresses"]` — the blocks of `nuclei-command.js` that apply.
  - `T.targets(doc, range, groups): {hosts: string[], ports: number[], extra: string[], names: string[], drawn: number, services: number, said: string, notes: string[], resolves: boolean} | {problem: string}` — `hosts` as a target has them (`10.0.1.5`, `[fd00::5]`, `app.lab`); `extra` are `host:port` of drawn ports that are no usual ones; `names` only with `connect`; `services` counts the services drawn on the covered hosts.
  - `T.command(groups, adjust, range, doc): {text: string, shown: string, said: string, note?: string, warning?: string} | {problem: string}` — `text` is what is copied and run; `shown` is the same with each template's text left out (`echo '… 584 lines …' > …`), for the page to show.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/nuclei-templates.test.js`:

```js
const E = require('../assets/js/architecture-edit.js');

function drawing() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'LAN', addresses: ['10.0.1.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.1.2'] },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.1.40', 'fd00::40'], names: ['grafana.corp.example', 'metrics.corp.example'] },
    six: { kind: 'host', label: 'six', addresses: ['fd00::5'] },
    wiki: { kind: 'host', label: 'wiki.lab' },
    far: { kind: 'host', label: 'Far', addresses: ['10.9.9.9'], names: ['far.corp.example'] },
    alt: { kind: 'service', label: 'alt' },
    https: { kind: 'service', label: 'https' },
  };
  d.associations = {
    a1: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
    a2: { kind: 'hosts', from: 'web', to: 'alt', privilege: 'unknown' },
    a3: { kind: 'hosts', from: 'web', to: 'https', privilege: 'unknown' },
  };
  d.flows = {
    f1: { label: 'alt on Web 1', source: 'nuclei', target: 'alt', route: [], protocol: 'tcp/8444' },
    f2: { label: 'https on Web 1', source: 'nuclei', target: 'https', route: [], protocol: 'tcp/443' },
    f3: { label: 'again', source: 'nuclei', target: 'alt', route: [], protocol: 'tcp/8444' },
    f4: { label: 'dns', source: 'nuclei', target: 'alt', route: [], protocol: 'udp/53' },
  };
  return d;
}

test('spec §3.2: thirty-two usual ports', () => {
  assert.equal(T.USUAL_PORTS.length, 32);
  assert.deepEqual(T.USUAL_PORTS, T.USUAL_PORTS.slice().sort((a, b) => a - b));
  assert.deepEqual(T.USUAL_PORTS.filter((p, i) => T.USUAL_PORTS.indexOf(p) !== i), []);
  for (const p of [21, 22, 25, 80, 443, 465, 993, 3306, 8006, 8443, 10443]) assert.ok(T.USUAL_PORTS.includes(p), String(p));
});

test('spec §3.1: the drawn hosts the range covers, their drawn ports, and what was typed by hand', () => {
  const t = T.targets(drawing(), '10.0.1.0/24 fd00::/64 wiki.lab 10.0.1.77', ['identify', 'connect']);
  assert.deepEqual(t.hosts, ['10.0.1.2', '10.0.1.40', '[fd00::5]', 'wiki.lab', '10.0.1.77']);
  assert.deepEqual(t.extra, ['10.0.1.40:8444'], 'a drawn port once, a usual one not again, UDP never');
  assert.deepEqual(t.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.equal(t.drawn, 4);
  assert.equal(t.said, '4 drawn hosts, 32 usual ports and 1 drawn one, 2 names.');
  assert.equal(t.resolves, true);
  assert.deepEqual(t.notes, []);
  // Without connect no name is asked.
  const i = T.targets(drawing(), '10.0.1.0/24', ['identify']);
  assert.deepEqual([i.hosts, i.names, i.resolves, i.said], [['10.0.1.2', '10.0.1.40'], [], false, '2 drawn hosts, 32 usual ports and 1 drawn one.']);
  // A URL names its host; a name a drawn host keeps names that host, by
  // the name, since it was the name that was typed.
  const far = T.targets(drawing(), 'https://far.corp.example:8443/x', ['identify']);
  assert.deepEqual([far.hosts, far.drawn, far.resolves], [['far.corp.example'], 1, true]);
});

test('spec §3.1: a range with nothing drawn in it is asked itself, up to 1,024 addresses', () => {
  const t = T.targets(E.empty(), '10.0.1.0/30 10.0.2.8/31', ['identify']);
  assert.deepEqual(t.hosts, ['10.0.1.1', '10.0.1.2', '10.0.2.8', '10.0.2.9']);
  assert.equal(t.said, '4 hosts, 32 usual ports.');
  assert.deepEqual(t.notes, ['Nothing is drawn in 10.0.1.0/30, 10.0.2.8/31 yet. nmap finds hosts faster.']);
  assert.equal(T.targets(E.empty(), '10.0.0.0/22', ['identify']).hosts.length, 1022);
  assert.equal(T.targets(E.empty(), '10.0.0.0/21', ['identify']).problem, 'Give a smaller range, or draw the hosts first with nmap.');
  assert.equal(T.targets(E.empty(), '10.0.0.0/23 10.0.4.0/23', ['identify']).hosts.length, 1020);
  assert.equal(T.targets(E.empty(), '10.0.0.0/22 10.0.4.0/29', ['identify']).problem, 'Give a smaller range, or draw the hosts first with nmap.');
  assert.match(T.targets(E.empty(), 'fd00::/64', ['identify']).problem, /^Nothing is drawn in fd00::\/64 yet; give its hosts/);
  assert.match(T.targets(E.empty(), '', ['identify']).problem, /^Give what to scan/);
  // A drawn host outside the range is left out, and a range that holds one drawn host is not expanded.
  assert.deepEqual(T.targets(drawing(), '10.9.9.0/24', ['identify']).hosts, ['10.9.9.9']);
});

test('what a shell reads as its own is refused in the range', () => {
  for (const bad of ['10.0.1.5; id', '$(id)', '`id`', "10.0.1.5'", '10.0.1.5"', '-oN', '10.0.1.0/24 | x', 'a\\b', 'a b>c']) {
    assert.match(T.targets(drawing(), bad, ['identify']).problem || '', /^The range may hold only/, bad);
    assert.match(T.command(['identify'], {}, bad, drawing()).problem || '', /^The range may hold only/, bad);
  }
});

test('spec §3: one paste writes the templates and the targets, then runs nuclei', () => {
  const c = T.command(['identify'], {}, '10.0.1.0/24', drawing());
  const parts = c.text.split('; ');
  assert.equal(parts[0], 'mkdir -p effractor-templates');
  for (const [i, id] of ['effractor-banner', 'effractor-web', 'effractor-certificate'].entries()) {
    assert.equal(parts[i + 1], "echo '" + T.text(id).replace(/\n$/, '') + "' > effractor-templates/" + id + '.yaml');
  }
  // The awk program holds a `;` of its own: split on the shell's, between the quotes' ends.
  const rest = c.text.slice(c.text.indexOf("; awk 'BEGIN") + 2);
  assert.equal(rest, 'awk \'BEGIN { n = split("10.0.1.2 10.0.1.40", h, " "); m = split("' + T.USUAL_PORTS.join(' ') + '", p, " "); for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) print h[i] ":" p[j]; print "10.0.1.40:8444" }\' > targets.txt; '
    + 'nuclei -t effractor-templates/effractor-banner.yaml,effractor-templates/effractor-web.yaml,effractor-templates/effractor-certificate.yaml -list targets.txt -exclude-type dns -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check');
  assert.equal(c.said, '2 drawn hosts, 32 usual ports and 1 drawn one.');
  assert.equal(c.note, undefined);
  assert.equal(c.warning, undefined);
});

test('names and connect: this machine\'s resolvers, and the names asked in a run of their own', () => {
  const c = T.command(['identify', 'connect'], { speed: 'gentle', patience: 'slow', errors: 'never', addresses: 'both', severity: 'high', oast: 'own', browser: 'on' }, '10.0.1.0/24 wiki.lab', drawing());
  const tail = c.text.slice(c.text.indexOf("' > targets.txt; ") + 17);
  const more = ' -ip-version 4,6 -rate-limit 20 -concurrency 5 -timeout 20 -retries 2 -no-mhe -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check';
  assert.equal(tail, "awk '/^nameserver/ {print $2}' /etc/resolv.conf > resolvers.txt; "
    + 'nuclei -t effractor-templates/effractor-banner.yaml,effractor-templates/effractor-web.yaml,effractor-templates/effractor-certificate.yaml,effractor-templates/effractor-login.yaml -list targets.txt -resolvers resolvers.txt' + more + '; '
    + "echo 'grafana.corp.example\nmetrics.corp.example' > names.txt; "
    + 'nuclei -t effractor-templates/effractor-points-to.yaml -list names.txt -resolvers resolvers.txt' + more);
  assert.match(c.text, /> effractor-templates\/effractor-points-to\.yaml; awk/);
  assert.equal(c.note, 'Names are asked of this machine\'s resolvers; nuclei\'s own are public ones.');
  // Connect alone, no name kept: the login template, nothing asked of a resolver.
  const d = drawing();
  delete d.entities.web.names;
  const l = T.command(['connect'], {}, '10.0.1.0/24', d);
  assert.match(l.text, /nuclei -t effractor-templates\/effractor-login\.yaml -list targets\.txt -exclude-type dns /);
  assert.doesNotMatch(l.text, /resolvers|names\.txt|points-to/);
  assert.equal(T.command([], {}, '10.0.1.0/24', drawing()).problem, 'Choose what nuclei should look for.');
  assert.equal(T.command(['nope'], {}, '10.0.1.0/24', drawing()).problem, 'Choose what nuclei should look for.');
  assert.match(T.command(['identify'], { speed: 'fast' }, '10.0.1.0/24', drawing()).warning, /^Fast can overload/);
});

test('review focus 4: hundreds of drawn hosts are one line of targets', () => {
  const d = drawing();
  for (let i = 0; i < 600; i++) d.entities['h' + i] = { kind: 'host', label: 'h' + i, addresses: ['10.1.' + Math.floor(i / 250) + '.' + (i % 250 + 1)] };
  const c = T.command(['identify'], {}, '10.1.0.0/16', d);
  assert.equal(c.said, '600 drawn hosts, 32 usual ports.');
  assert.equal(c.text.split('\n').filter(l => /^awk /.test(l) || /; awk /.test(l)).length, 1);
  assert.ok(c.text.length < 30000, String(c.text.length));
});

test('what is shown is the command without the templates\' text; what is copied is whole', () => {
  const c = T.command(['identify', 'connect'], {}, '10.0.1.0/24', drawing());
  assert.ok(c.shown.length < 1600, String(c.shown.length));
  assert.equal(c.shown.split('\n').length, 2, 'the names are two lines');
  assert.match(c.shown, /^mkdir -p effractor-templates; echo '… \d+ lines …' > effractor-templates\/effractor-banner\.yaml; /);
  assert.equal(c.shown.replace(/echo '… \d+ lines …' > effractor-templates\/[a-z-]+\.yaml; /g, ''), c.text.replace(/echo 'id: effractor-[^']*' > effractor-templates\/[a-z-]+\.yaml; /g, ''));
});

test('spec §10: How it connects on a drawing without services says what to run first', () => {
  const d = drawing();
  d.associations = { a1: d.associations.a1 };
  d.flows = {};
  assert.equal(T.command(['connect'], {}, '10.0.1.0/24', d).problem, 'Nothing drawn to ask yet; run What is there first.');
  assert.ok(T.command(['identify', 'connect'], {}, '10.0.1.0/24', d).text, 'with What is there it is asked at once');
  assert.ok(T.command(['connect'], {}, '10.0.1.0/24', drawing()).text);
  // Hosts typed by hand on an empty drawing are asked: nothing is drawn to wait for.
  assert.ok(T.command(['connect'], {}, '10.0.1.5', E.empty()).text);
});
```

Add to `scripts/nuclei-command.test.js` (it holds that nothing offered asks a third party; use its own list of refused flags if it names one, else this):

```js
test('effractor\'s own templates: nothing asks a third party or hides a scan', () => {
  const T = require('../assets/js/nuclei-templates.js');
  const E = require('../assets/js/architecture-edit.js');
  const d = E.empty();
  d.entities = { h: { kind: 'host', label: 'app.lab', addresses: ['10.0.1.5'], names: ['app.corp.example'] }, s: { kind: 'service', label: 'https' } };
  d.associations = { a: { kind: 'hosts', from: 'h', to: 's', privilege: 'unknown' } };
  for (const groups of [['identify'], ['connect'], ['identify', 'connect']]) {
    for (const range of ['10.0.1.0/24', 'app.lab', '10.0.1.5 app.lab']) {
      const c = T.command(groups, {}, range, d);
      const runs = c.text.split('; ').filter(p => /^nuclei /.test(p));
      assert.ok(runs.length >= 1);
      for (const run of runs) {
        assert.match(run, / -no-interactsh /);
        assert.match(run, / -disable-update-check$/);
        assert.match(run, / -resolvers resolvers\.txt | -exclude-type dns /);
        assert.doesNotMatch(run, / -(preflight-portscan|interactsh-server|cloud-upload|dashboard|uncover|ai|proxy|source-ip|interface|tls-impersonate|update|update-templates|templates-url|target) /);
        assert.doesNotMatch(run, /https?:\/\//);
      }
    }
  }
});
```

Add to `scripts/shell-commands.test.js`:

```js
const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');

// effractor's own templates (nuclei templates spec §3): the command writes
// files, so it is run with the real mkdir, echo and awk and a stand-in for
// nuclei, and what every shell wrote is compared byte for byte.
function ours() {
  const d = E.empty();
  d.entities = {
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.1.40'], names: ['grafana.corp.example', 'metrics.corp.example'] },
    six: { kind: 'host', label: 'six', addresses: ['fd00::5'] },
    wiki: { kind: 'host', label: 'wiki.lab' },
    alt: { kind: 'service', label: 'alt' },
    web2: { kind: 'service', label: 'https' },
    nu: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
  };
  d.associations = { a: { kind: 'hosts', from: 'web', to: 'alt', privilege: 'unknown' }, b: { kind: 'hosts', from: 'wiki', to: 'web2', privilege: 'unknown' } };
  d.flows = { f: { label: 'alt on Web 1', source: 'nu', target: 'alt', route: [], protocol: 'tcp/8444' } };
  return [
    T.command(['identify'], {}, '10.0.1.0/24', d),
    T.command(['identify', 'connect'], { speed: 'gentle' }, '10.0.1.0/24 fd00::/64 wiki.lab', d),
    T.command(['connect'], {}, 'https://wiki.lab:8443/a?b=1', d),
  ].map(c => c.text);
}

test('effractor\'s templates: only what is quoted holds a shell\'s own signs', () => {
  for (const c of ours()) {
    const bare = c.replace(/'[^']*'/g, '');
    assert.doesNotMatch(bare, /[\\"`$&|<(){}\[\]*?~#!^]/, bare);
    assert.doesNotMatch(c, /\\/);
    assert.equal(c.split("'").length % 2, 1, 'quotes close');
    // Every `>` writes one of the command's own files.
    for (const m of bare.match(/> [^\s;]+/g)) assert.match(m, /^> (effractor-templates\/effractor-[a-z-]+\.yaml|targets\.txt|names\.txt|resolvers\.txt)$/);
  }
});

test('effractor\'s templates: fish, bash and sh write the same files and run nuclei the same way', { skip: SHELLS.length < 2 ? 'fewer than two of sh, bash, fish installed' : false }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effractor-own-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'nuclei'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done >> nuclei.args\nprintf \'%s\\n\' --- >> nuclei.args\n', { mode: 0o755 });
    const env = Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, HOME: dir });
    ours().forEach((c, i) => {
      const wrote = {};
      for (const shell of SHELLS) {
        const cwd = path.join(dir, shell + '-' + i);
        fs.mkdirSync(cwd);
        const r = spawnSync(shell, shell === 'fish' ? ['--no-config', '-c', c] : ['-c', c], { cwd, env, encoding: 'utf8' });
        assert.equal(r.status, 0, shell + ': ' + r.stderr);
        assert.equal(r.stderr, '', shell);
        const files = {};
        for (const name of fs.readdirSync(cwd)) if (name !== 'effractor-templates' && name !== 'resolvers.txt') files[name] = fs.readFileSync(path.join(cwd, name), 'utf8');
        for (const name of fs.readdirSync(path.join(cwd, 'effractor-templates'))) {
          files[name] = fs.readFileSync(path.join(cwd, 'effractor-templates', name), 'utf8');
          assert.equal(files[name], fs.readFileSync(path.join('assets/nuclei', name), 'utf8'), shell + ' wrote ' + name);
        }
        wrote[shell] = files;
      }
      for (const shell of SHELLS) assert.deepEqual(wrote[shell], wrote[SHELLS[0]], shell);
      const first = wrote[SHELLS[0]];
      if (i === 1) {
        const lines = first['targets.txt'].trim().split('\n');
        assert.equal(lines.length, 3 * T.USUAL_PORTS.length + 1);
        assert.deepEqual([lines[0], lines[T.USUAL_PORTS.length], lines[2 * T.USUAL_PORTS.length], lines[lines.length - 1]], ['10.0.1.40:21', '[fd00::5]:21', 'wiki.lab:21', '10.0.1.40:8444']);
        assert.equal(first['names.txt'], 'grafana.corp.example\nmetrics.corp.example\n');
        assert.equal(first['nuclei.args'].split('---\n').filter(Boolean).length, 2, 'two runs');
      }
      assert.match(first['nuclei.args'], /^-t\neffractor-templates\//);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nuclei-templates.test.js scripts/nuclei-command.test.js scripts/shell-commands.test.js`
Expected: FAIL with `T.targets is not a function`, `T.command is not a function`, `T.USUAL_PORTS` undefined.

- [ ] **Step 3: Write targets and command**

In `assets/js/nuclei-templates.js`, after `var node = …;` add:

```js
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var C = node ? require("./nuclei-command.js") : window.effractorNucleiCommand;
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
```

and before `var api`:

```js
  // ---- what they are pointed at (spec §3.1, §3.2) ----

  // Ports where one of the templates can get an answer.
  var USUAL = {
    speaks: [21, 22, 25, 110, 143, 587, 2222, 3306],
    mail: [465, 993, 995],
    web: [80, 443, 3000, 4443, 5000, 5601, 7001, 8000, 8006, 8008, 8080, 8081, 8088, 8443, 8888, 9000, 9090, 9200, 9443, 10000, 10443],
  };
  var USUAL_PORTS = USUAL.speaks.concat(USUAL.mail, USUAL.web).sort(function (a, b) { return a - b; });
  // The addresses of a range nobody has drawn, at most.
  var MOST = 1024;
  var GROUPS = ["identify", "connect"];
  // The blocks of nuclei's Adjust that apply to these templates.
  var ADJUST = ["addresses", "speed", "patience", "errors"];
  // As nuclei-command.js: nothing a shell reads as its own.
  var RANGE_CHARS = /^[0-9A-Za-z.:\/\-_~%?=&@\[\]+]+$/;

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  // An address as a target has it: an IPv6 one between brackets.
  function written(address) {
    return address.indexOf(":") >= 0 ? "[" + address + "]" : address;
  }
  // The addresses of an IPv4 range, without its network and broadcast
  // address where it has them; null for any other word.
  function expand(cidr) {
    var m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
    var b = m ? Ad.bytes(m[1]) : null, bits = m ? Number(m[2]) : 0;
    if (!b || b.length !== 4 || bits > 32) return null;
    var size = Math.pow(2, 32 - bits), edges = bits < 31 ? 1 : 0;
    if (size - 2 * edges > MOST) return { tooMany: true };
    var base = b[0] * 16777216 + b[1] * 65536 + b[2] * 256 + b[3];
    base -= base % size;
    var out = [];
    for (var i = edges; i < size - edges; i++) {
      var n = base + i;
      out.push([Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join("."));
    }
    return { list: out };
  }
  function count(k, one) {
    return k + " " + one + (k === 1 ? "" : "s");
  }

  function targets(doc, range, groups) {
    var words = String(range == null ? "" : range).trim().split(/[\s,]+/).filter(Boolean);
    if (!words.length) return { problem: "Give what to scan, such as 10.0.1.0/24." };
    if (!words.every(function (w) { return RANGE_CHARS.test(w) && w[0] !== "-"; })) {
      return { problem: "The range may hold only addresses, names, CIDR and URLs, such as 10.0.1.0/24 or https://app.lab:8443." };
    }
    var nets = [], singles = [], named = [];
    words.forEach(function (w) {
      var cidr = /^([^\/]+)\/\d{1,3}$/.exec(w);
      if (cidr && Ad.bytes(cidr[1])) return nets.push(w);
      var host = C.target(w).host;
      if (host && Ad.bytes(host)) singles.push(host);
      else if (host) named.push(host.toLowerCase());
    });
    var cover = nets.concat(singles).join(" ");
    var hosts = [], extra = [], names = [], drawn = 0, services = 0;
    var hostOf = Object.create(null);
    links(doc, "hosts").forEach(function (a) {
      if (doc.entities[a.to] && doc.entities[a.to].kind === "service") hostOf[a.to] = a.from;
    });
    Object.keys(doc.entities || {}).forEach(function (id) {
      var e = doc.entities[id];
      if (e.kind !== "host") return;
      var address = cover ? (e.addresses || []).filter(function (a) { return Ad.covers(cover, a); })[0] : null;
      var own = [String(e.label).trim().toLowerCase()].concat(e.names || []).filter(A.isName);
      var called = own.filter(function (n) { return named.indexOf(n) >= 0; })[0];
      if (!address && !called) return;
      var at = address ? written(address) : called;
      if (hosts.indexOf(at) >= 0) return;
      hosts.push(at);
      drawn++;
      Object.keys(hostOf).forEach(function (s) { if (hostOf[s] === id) services++; });
      Object.keys(doc.flows || {}).forEach(function (k) {
        var f = doc.flows[k], m = /^tcp\/(\d{1,5})$/.exec(f.protocol || "");
        if (!m || hostOf[f.target] !== id) return;
        var port = Number(m[1]);
        if (port < 1 || port > 65535 || USUAL_PORTS.indexOf(port) >= 0 || extra.indexOf(at + ":" + port) >= 0) return;
        extra.push(at + ":" + port);
      });
      (e.names || []).forEach(function (n) { if (A.isName(n) && names.indexOf(n) < 0) names.push(n); });
    });
    // What was typed by hand and is not drawn is asked too.
    singles.forEach(function (a) { if (hosts.indexOf(written(a)) < 0) hosts.push(written(a)); });
    named.forEach(function (n) { if (hosts.indexOf(n) < 0) hosts.push(n); });
    var notes = [];
    if (!drawn && nets.length) {
      for (var i = 0; i < nets.length; i++) {
        var x = expand(nets[i]);
        if (!x) return { problem: "Nothing is drawn in " + nets[i] + " yet; give its hosts, or draw them first with nmap." };
        if (x.tooMany || hosts.length + x.list.length > MOST) return { problem: "Give a smaller range, or draw the hosts first with nmap." };
        x.list.forEach(function (a) { if (hosts.indexOf(a) < 0) hosts.push(a); });
      }
      notes.push("Nothing is drawn in " + nets.join(", ") + " yet. nmap finds hosts faster.");
    }
    if (!hosts.length) return { problem: "Nothing is drawn in " + words.join(", ") + " yet; give its hosts, or draw them first with nmap." };
    var connect = (groups || []).indexOf("connect") >= 0;
    if (!connect) names = [];
    var said = (drawn ? count(drawn, "drawn host") : count(hosts.length, "host")) + ", " + USUAL_PORTS.length + " usual ports"
      + (extra.length ? " and " + count(extra.length, "drawn one") : "") + (names.length ? ", " + count(names.length, "name") : "") + ".";
    return { hosts: hosts, ports: USUAL_PORTS.slice(), extra: extra, names: names, drawn: drawn, services: services, said: said, notes: notes, resolves: hosts.some(A.isName) };
  }

  // ---- the command (spec §3) ----

  var DIR = "effractor-templates";
  // nuclei asks public resolvers unless given a list: this machine's own.
  var RESOLVERS = "awk '/^nameserver/ {print $2}' /etc/resolv.conf > resolvers.txt";
  var ALWAYS = "-jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check";

  function adjusted(adjust) {
    var args = [], warnings = [];
    C.BLOCKS.forEach(function (b) {
      if (ADJUST.indexOf(b.id) < 0) return;
      var id = adjust && has(adjust, b.id) ? adjust[b.id] : C.DEFAULTS[b.id];
      var x = b.choices.filter(function (c) { return c.id === id; })[0] || b.choices[0];
      if (x.args) args.push(x.args);
      if (x.warning) warnings.push(x.warning);
    });
    return { args: args, warnings: warnings };
  }

  // Writes the ticked groups' templates and the targets, then runs nuclei:
  // once against the ports, and once for the names, which are asked of a
  // resolver and of nothing else. Returns {text, shown, said, note?,
  // warning?} or {problem}.
  function command(groups, adjust, range, doc) {
    var chosen = GROUPS.filter(function (g) { return (groups || []).indexOf(g) >= 0; });
    if (!chosen.length) return { problem: "Choose what nuclei should look for." };
    var t = targets(doc, range, chosen);
    if (t.problem) return { problem: t.problem };
    // Logins are asked of what is drawn: without a service there is nothing to ask.
    if (chosen.length === 1 && chosen[0] === "connect" && t.drawn && !t.services) return { problem: "Nothing drawn to ask yet; run What is there first." };
    var files = TEMPLATES.filter(function (x) { return chosen.indexOf(x.group) >= 0; });
    var ports = files.filter(function (x) { return x.protocol !== "dns"; });
    var dns = t.names.length ? files.filter(function (x) { return x.protocol === "dns"; }) : [];
    function paths(list) {
      return list.map(function (x) { return DIR + "/" + x.id + ".yaml"; }).join(",");
    }
    // `short`: the same with each template's text left out, to be shown.
    var parts = ["mkdir -p " + DIR], short = ["mkdir -p " + DIR];
    ports.concat(dns).forEach(function (x) {
      var body = text(x.id).replace(/\n$/, "");
      parts.push("echo '" + body + "' > " + DIR + "/" + x.id + ".yaml");
      short.push("echo '… " + body.split("\n").length + " lines …' > " + DIR + "/" + x.id + ".yaml");
    });
    function both(part) {
      parts.push(part);
      short.push(part);
    }
    var prints = t.extra.map(function (x) { return '; print "' + x + '"'; }).join("");
    both("awk 'BEGIN { n = split(\"" + t.hosts.join(" ") + "\", h, \" \"); m = split(\"" + t.ports.join(" ") + "\", p, \" \"); for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) print h[i] \":\" p[j]" + prints + " }' > targets.txt");
    if (t.resolves || dns.length) both(RESOLVERS);
    var a = adjusted(adjust);
    var more = (a.args.length ? " " + a.args.join(" ") : "") + " " + ALWAYS;
    both("nuclei -t " + paths(ports) + " -list targets.txt " + (t.resolves ? "-resolvers resolvers.txt" : "-exclude-type dns") + more);
    if (dns.length) {
      both("echo '" + t.names.join("\n") + "' > names.txt");
      both("nuclei -t " + paths(dns) + " -list names.txt -resolvers resolvers.txt" + more);
    }
    var out = { text: parts.join("; "), shown: short.join("; "), said: t.said };
    var notes = t.notes.slice();
    if (t.resolves || dns.length) notes.push("Names are asked of this machine's resolvers; nuclei's own are public ones.");
    if (notes.length) out.note = notes.join(" ");
    if (a.warnings.length) out.warning = a.warnings.join(" ");
    return out;
  }
```

and add `USUAL_PORTS: USUAL_PORTS, GROUPS: GROUPS, ADJUST: ADJUST, targets: targets, command: command` to `api`.

`connect` alone with a range of addresses and names kept: the port run carries the login template, the second run the names. A host text never holds a quote, a backslash or a space: an address is one by `Ad.bytes`, a name by `A.isName`, what was typed by `RANGE_CHARS`.

- [ ] **Step 4: Run the tests**

Run: `node --test scripts/nuclei-templates.test.js scripts/nuclei-command.test.js scripts/shell-commands.test.js`
Expected: PASS. If the order of `-ip-version`, `-rate-limit`, `-timeout`, `-no-mhe` in the second command test differs, it follows the order of `C.BLOCKS`; write the test's `more` in that order.

- [ ] **Step 5: Amend the spec**

In `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md` §3, replace the example command and the paragraph under it with:

````markdown
```
mkdir -p effractor-templates; echo 'id: effractor-banner
info:
  …' > effractor-templates/effractor-banner.yaml; echo '…' > effractor-templates/effractor-web.yaml; echo '…' > effractor-templates/effractor-certificate.yaml; awk 'BEGIN { n = split("10.0.1.5 10.0.1.40", h, " "); m = split("21 22 25 80 …", p, " "); for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) print h[i] ":" p[j]; print "10.0.1.40:8444" }' > targets.txt; nuclei -t effractor-templates/effractor-banner.yaml,… -list targets.txt -exclude-type dns -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check
```

Only the ticked groups' templates are written, and `-t` names each written
file, never the directory. The targets are written by `awk`, which crosses
the hosts with the ports (amended with the plan, 2026-09-28: one line where
`echo` would carry one per host and port). The names *How it connects* asks
are written to `names.txt` and asked in a second run of nuclei, with the DNS
template alone: a name is asked of a resolver and of nothing else, so a name
that points outside is never sent a request. `;` and `>` are the only shell
syntax, as the fish rule has it (`docs/HANDOFF.md`).
````

In §3.1 add after the list of targets:

```markdown
An address, a name or a URL typed into the range is asked whether it is
drawn or not: it was named by hand.
```

- [ ] **Step 6: Commit**

```bash
npm test
git add assets/js/nuclei-templates.js scripts/nuclei-templates.test.js scripts/nuclei-command.test.js scripts/shell-commands.test.js docs/superpowers/specs/2026-09-28-nuclei-templates-design.md
git commit -m "The command of effractor's templates takes its targets from the drawing"
```

### Task 6: The lab, and part 2 lands

**Files:**
- Create: `scripts/dev/nuclei-lab.py`
- Create: `scripts/fixtures/nuclei/lab.json`
- Test: `scripts/nuclei-templates.test.js`

**Interfaces:**
- Consumes: `T.ANSWERS`, `T.pattern` (Task 4); `assets/nuclei/*.yaml`.
- Produces:
  - `scripts/fixtures/nuclei/lab.json`: `{"hosts": [{"address", "name"?, "ports": [{"port", "tls"?: {"names": [...]}, "banner"?: string, "server"?: string, "headers"?: {name: value}, "pages"?: {path: {"status"?: number, "location"?: string, "headers"?: {…}, "body"?: string}}}]}], "names": {name: {"alias"?: string, "address"?: string}}}` — the lab: what every throwaway server says, under the address and port the fixture will name.
  - `scripts/dev/nuclei-lab.py serve` — starts every server on 127.0.0.1 and prints the local port of each lab port.
  - `scripts/dev/nuclei-lab.py record identify|connect` — starts them, runs nuclei 3.11.0 with the templates of that group against them, rewrites what it wrote to the lab's addresses, names and ports, and writes `scripts/fixtures/nuclei/<group>.jsonl`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/nuclei-templates.test.js`:

```js
const LAB = JSON.parse(fs.readFileSync('scripts/fixtures/nuclei/lab.json', 'utf8'));

// Every answer has a place in the lab where its own pattern finds it: what
// the fixtures hold is then what nuclei found there (spec §2.1 rule 6).
test('the lab answers every question of the table', () => {
  const ports = LAB.hosts.flatMap(h => h.ports.map(p => Object.assign({ host: h.address }, p)));
  const head = (p, page) => Object.entries(Object.assign({}, p.server ? { Server: p.server } : {}, p.headers || {}, page.headers || {}, page.location ? { Location: page.location } : {})).map(([k, v]) => k + ': ' + v).join('\r\n');
  const found = a => {
    if (a.is === 'names') return ports.some(p => p.tls && p.tls.names.length);
    if (a.is === 'server') return ports.some(p => p.server);
    if (a.is === 'address') return Object.values(LAB.names).some(n => n.address);
    if (a.is === 'alias') return Object.values(LAB.names).some(n => n.alias);
    const res = T.pattern(a);
    if (!a.paths) return ports.some(p => p.banner && res.some(r => r.test(p.banner)));
    return ports.some(p => a.paths.some(path => {
      // The root page is followed where it sends on, on the same host.
      let page = (p.pages || {})[path], hops = 0;
      while (path === '/' && page && page.location && /^\//.test(page.location) && hops++ < 3) {
        if (a.part === 'header' && res.some(r => r.test(head(p, page)))) return true;
        page = p.pages[page.location];
      }
      if (!page) return false;
      return res.some(r => r.test(a.part === 'header' ? head(p, page) : page.body || ''));
    }));
  };
  assert.deepEqual(T.ANSWERS.filter(a => !found(a)).map(a => a.name), []);
  // Each application is alone on its port: a page that two applications claim proves neither.
  for (const p of ports.filter(p => p.pages)) {
    const apps = T.ANSWERS.filter(a => a.is === 'application' && a.paths.some(path => {
      const page = p.pages[path];
      return page && T.pattern(a).some(r => r.test(a.part === 'header' ? head(p, page) : page.body || ''));
    })).map(a => a.name);
    assert.ok(apps.length <= 1, p.host + ':' + p.port + ' answers as ' + apps.join(' and '));
  }
  for (const h of LAB.hosts) assert.match(h.address, /^10\.0\.2\.\d+$|^fd00:2::[0-9a-f]+$/, 'the lab is 10.0.2.0/24 and fd00:2::/64');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test scripts/nuclei-templates.test.js`
Expected: FAIL: `ENOENT … scripts/fixtures/nuclei/lab.json`.

- [ ] **Step 3: Write the lab**

Create `scripts/fixtures/nuclei/lab.json`. The rule for every entry: **one application per port, the page written by hand from the trace in the table, never copied from a vendor's page**; a page holds the trace, a version where the table has a version answer, and as little else as a page needs. Begin with these, which carry everything that is not an application and one application of each kind (behind a server, behind a server that names no version, on an embedded server, answering by itself, without a `Server` header), and go on in the same shape for each `app(…)` of the table until the test of step 1 passes:

```json
{
  "hosts": [
    {
      "address": "10.0.2.5",
      "name": "srv-01.corp.example",
      "ports": [
        {
          "port": 22,
          "banner": "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n"
        },
        {
          "port": 2222,
          "banner": "SSH-2.0-dropbear_2022.83\r\n"
        },
        {
          "port": 21,
          "banner": "220 (vsFTPd 3.0.5)\r\n"
        },
        {
          "port": 25,
          "banner": "220 srv-01.corp.example ESMTP Postfix\r\n"
        },
        {
          "port": 143,
          "banner": "* OK [CAPABILITY IMAP4rev1 STARTTLS] Dovecot ready.\r\n"
        },
        {
          "port": 3306,
          "banner": "Y\u0000\u0000\u0000\n5.5.5-10.11.6-MariaDB-0+deb12u1\u0000\u0011\u0000\u0000\u0000abcdefgh\u0000mysql_native_password\u0000"
        }
      ]
    },
    {
      "address": "10.0.2.6",
      "ports": [
        {
          "port": 21,
          "banner": "220 ProFTPD 1.3.8 Server (Debian) [10.0.2.6]\r\n"
        },
        {
          "port": 25,
          "banner": "220 mail.corp.example ESMTP Exim 4.96 Mon, 28 Sep 2026 10:00:00 +0000\r\n"
        },
        {
          "port": 110,
          "banner": "+OK Cyrus POP3 v3.8.1 server ready\r\n"
        },
        {
          "port": 143,
          "banner": "* OK [CAPABILITY IMAP4rev1] Courier-IMAP ready.\r\n"
        },
        {
          "port": 587,
          "banner": "220 mx.corp.example Microsoft ESMTP MAIL Service ready at Mon, 28 Sep 2026 10:00:00 +0000\r\n"
        },
        {
          "port": 2222,
          "banner": "220---------- Welcome to Pure-FTPd [privsep] [TLS] ----------\r\n"
        },
        {
          "port": 3306,
          "banner": "J\u0000\u0000\u0000\n8.0.36\u0000\u0011\u0000\u0000\u0000abcdefgh\u0000caching_sha2_password\u0000"
        },
        {
          "port": 465,
          "banner": "220 relay.corp.example ESMTP Sendmail 8.17.1/8.17.1; Mon, 28 Sep 2026 10:00:00 GMT\r\n"
        }
      ]
    },
    {
      "address": "10.0.2.11",
      "name": "grafana.corp.example",
      "ports": [
        {
          "port": 443,
          "tls": {
            "names": [
              "grafana.corp.example",
              "metrics.corp.example",
              "*.corp.example"
            ]
          },
          "server": "nginx/1.24.0",
          "pages": {
            "/": {
              "status": 302,
              "location": "/login"
            },
            "/login": {
              "body": "<!doctype html><html><head><title>Grafana</title></head><body><script>window.grafanaBootData = {\"settings\":{\"buildInfo\":{\"version\":\"10.2.3\"}}};</script><form><input name=\"user\"><input type=\"password\" name=\"password\"></form></body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.12",
      "name": "wiki.corp.example",
      "ports": [
        {
          "port": 443,
          "tls": {
            "names": [
              "wiki.corp.example"
            ]
          },
          "server": "Apache/2.4.57 (Debian)",
          "pages": {
            "/": {
              "status": 302,
              "location": "https://sso.corp.example/realms/corp/protocol/openid-connect/auth?client_id=wiki&response_type=code"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.13",
      "ports": [
        {
          "port": 8006,
          "tls": {
            "names": [
              "pve1.corp.example"
            ]
          },
          "pages": {
            "/": {
              "body": "<!doctype html><html><head><title>pve1 - Proxmox Virtual Environment</title><script src=\"/pve2/js/pvemanagerlib.js?ver=8.1.4\"></script></head><body><script>Proxmox = { UserName: null, CSRFPreventionToken: null }; /* PVEAuthCookie */</script><form><input type=\"password\"></form></body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.50",
      "name": "proxy.corp.example",
      "ports": [
        {
          "port": 443,
          "tls": {
            "names": [
              "proxy.corp.example"
            ]
          },
          "server": "nginx/1.24.0",
          "pages": {
            "/": {
              "body": "<html><head><title>Welcome</title></head><body>ok</body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.60",
      "ports": [
        {
          "port": 8080,
          "server": "lighttpd/1.4.69",
          "pages": {
            "/": {
              "body": "<html><head><title>Sign in</title></head><body><form><input name=u><input type=password name=p></form></body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.61",
      "ports": [
        {
          "port": 443,
          "tls": {
            "names": [
              "portal.corp.example"
            ]
          },
          "server": "Microsoft-IIS/10.0",
          "pages": {
            "/": {
              "body": "<html><head><title>Portal</title></head><body><a href=\"https://login.microsoftonline.com/0000/oauth2/v2.0/authorize?client_id=portal\">Sign in</a></body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.62",
      "ports": [
        {
          "port": 8000,
          "pages": {
            "/": {
              "body": "<html><head><title>Printer status</title></head><body>ok</body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.14",
      "ports": [
        {
          "port": 443,
          "tls": {
            "names": [
              "fw.corp.example"
            ]
          },
          "server": "nginx",
          "pages": {
            "/": {
              "body": "<html><head><title>pfSense - Login</title></head><body><form><input name=\"usernamefld\"><input type=\"password\" name=\"passwordfld\"></form><p>pfSense is developed and maintained by Netgate.</p></body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.15",
      "ports": [
        {
          "port": 8080,
          "server": "Jetty(10.0.18)",
          "headers": {
            "X-Jenkins": "2.440.1"
          },
          "pages": {
            "/": {
              "status": 302,
              "location": "/login"
            },
            "/login": {
              "body": "<html><head><title>Sign in [Jenkins]</title></head><body><form><input name=j_username><input type=password name=j_password></form></body></html>"
            }
          }
        }
      ]
    },
    {
      "address": "10.0.2.16",
      "ports": [
        {
          "port": 10000,
          "tls": {
            "names": [
              "10.0.2.16"
            ]
          },
          "server": "MiniServ/2.105",
          "pages": {
            "/": {
              "body": "<html><head><title>Login to Webmin</title></head><body><form class=session_login><input type=password name=pass></form></body></html>"
            }
          }
        }
      ]
    }
  ],
  "names": {
    "grafana.corp.example": {
      "alias": "proxy.corp.example",
      "address": "10.0.2.50"
    },
    "metrics.corp.example": {
      "address": "10.0.2.11"
    },
    "wiki.corp.example": {
      "address": "10.0.2.99"
    },
    "pve1.corp.example": {
      "alias": "pve1.cdn.example.net",
      "address": "203.0.113.7"
    }
  }
}
```

These hosts are the ones the tests of parts 3 and 4 speak of by their address; keep them as they are. Every further application of the table takes a host of its own from `10.0.2.100` upward, in the table's order; every `sso(…)` of the table that has none yet (`sso-entra`, `sso-adfs`, `sso-okta`, `sso-google`, `sso-saml`, `sso-oidc`, and the `-link` forms of Keycloak, AD FS, Okta and Google) a host of its own from `10.0.2.70` upward, each with a root page that redirects or links to the sign-on and nothing else.

- [ ] **Step 4: Write the lab's servers and its recorder**

Create `scripts/dev/nuclei-lab.py`:

```python
#!/usr/bin/env python3
"""The lab effractor's nuclei templates are recorded against (nuclei templates
spec §11): throwaway servers on 127.0.0.1 that say what
scripts/fixtures/nuclei/lab.json holds, and a recorder that runs nuclei
against them and rewrites what it wrote to the lab's addresses.

  nuclei-lab.py serve               start the servers, print the ports, wait
  nuclei-lab.py record identify     write scripts/fixtures/nuclei/identify.jsonl
  nuclei-lab.py record connect      write scripts/fixtures/nuclei/connect.jsonl

Nothing is asked but 127.0.0.1: nuclei runs with -no-interactsh,
-disable-update-check and the lab's own resolver.
"""
import http.server, json, os, re, socket, ssl, struct, subprocess, sys, tempfile, threading, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIXTURES = os.path.join(ROOT, "scripts", "fixtures", "nuclei")
LAB = json.load(open(os.path.join(FIXTURES, "lab.json"), encoding="utf-8"))
GROUPS = {
    "identify": ["effractor-banner", "effractor-web", "effractor-certificate"],
    "connect": ["effractor-login", "effractor-points-to"],
}
FIRST, RESOLVER = 19000, 15353
DAY = "2026-09-28T10:00:%02d.000000000+02:00"


def certificate(directory, index, names):
    """A self-signed certificate bearing the names, made with openssl."""
    key, cert = (os.path.join(directory, "%d.%s" % (index, e)) for e in ("key", "pem"))
    alt = ",".join("DNS:" + n for n in names)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
                    "-days", "2", "-subj", "/CN=" + names[0], "-addext", "subjectAltName=" + alt],
                   check=True, capture_output=True)
    return cert, key


def banner(sock, text):
    """Says its text to whoever connects, as a service that speaks first."""
    def serve():
        while True:
            c, _ = sock.accept()
            try:
                c.sendall(text.encode("latin-1"))
                time.sleep(0.3)
            except OSError:
                pass
            finally:
                c.close()
    threading.Thread(target=serve, daemon=True).start()


def web(port):
    """A request handler that answers with the port's pages and nothing else."""
    class Pages(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def version_string(self):
            return port.get("server", "")

        def do_GET(self):
            page = port.get("pages", {}).get(self.path)
            body = (page or {}).get("body", "" if page else "not here").encode("utf-8")
            self.send_response_only((page or {}).get("status", 200) if page else 404)
            if port.get("server"):
                self.send_header("Server", port["server"])
            headers = dict(port.get("headers", {}), **(page or {}).get("headers", {}))
            if page and page.get("location"):
                headers["Location"] = page["location"]
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Pages


def resolver():
    """Answers A questions for the lab's names, with their alias first."""
    def name(n):
        return b"".join(bytes([len(p)]) + p.encode() for p in n.split(".")) + b"\0"
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", RESOLVER))

    def serve():
        while True:
            q, a = s.recvfrom(512)
            i, labels = 12, []
            while q[i]:
                labels.append(q[i + 1:i + 1 + q[i]].decode())
                i += q[i] + 1
            known = LAB["names"].get(".".join(labels).lower())
            answer, n, owner = b"", 0, b"\xc0\x0c"
            if known and known.get("alias"):
                t = name(known["alias"])
                answer += owner + struct.pack(">HHIH", 5, 1, 60, len(t)) + t
                owner, n = name(known["alias"]), n + 1
            if known and known.get("address"):
                answer += owner + struct.pack(">HHIH", 1, 1, 60, 4) + bytes(int(x) for x in known["address"].split("."))
                n += 1
            s.sendto(q[:2] + struct.pack(">HHHHH", 0x8180 | (0 if n else 3), 1, n, 0, 0) + q[12:i + 5] + answer, a)
    threading.Thread(target=serve, daemon=True).start()


def serve(directory):
    """Starts every server; returns {local port: (lab address, lab port, lab name)}."""
    local, at = {}, FIRST
    for host in LAB["hosts"]:
        for port in host["ports"]:
            local[at] = (host["address"], port["port"], host.get("name"))
            if "banner" in port:
                s = socket.socket()
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", at))
                s.listen(16)
                banner(s, port["banner"])
            else:
                server = http.server.ThreadingHTTPServer(("127.0.0.1", at), web(port))
                if "tls" in port:
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(*certificate(directory, at, port["tls"]["names"]))
                    server.socket = context.wrap_socket(server.socket, server_side=True)
                threading.Thread(target=server.serve_forever, daemon=True).start()
            at += 1
    resolver()
    return local


def rewrite(record, local, second):
    """The record as the lab would have been: its address, its port, its day."""
    text = json.dumps(record)
    for at, (address, port, _) in local.items():
        shown = "[%s]" % address if ":" in address else address
        text = text.replace("127.0.0.1:%d" % at, "%s:%d" % (shown, port))
    out = json.loads(text)
    m = re.search(r"(\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\]):(\d+)", str(out.get("matched-at", "")) + " " + str(out.get("host", "")))
    if out.get("type") == "dns":
        out.pop("ip", None)
    elif m:
        out["ip"] = m.group(1).strip("[]")
        out["host"] = m.group(1)
        out["port"] = m.group(2)
        # A default port is left out of a URL, as nuclei leaves it out.
        for key in ("url", "matched-at"):
            if isinstance(out.get(key), str):
                out[key] = re.sub(r"^(https)://([^/]+):443(/|$)", r"\1://\2\3", re.sub(r"^(http)://([^/]+):80(/|$)", r"\1://\2\3", out[key]))
    out["timestamp"] = DAY % (second % 60)
    out.pop("curl-command", None)
    if "template-path" in out:
        out["template-path"] = "/home/user/effractor-templates/" + os.path.basename(out["template-path"])
    return out


def record(group):
    with tempfile.TemporaryDirectory() as directory:
        local = serve(directory)
        time.sleep(1)
        targets, names, resolvers = (os.path.join(directory, n) for n in ("targets.txt", "names.txt", "resolvers.txt"))
        open(targets, "w").write("".join("127.0.0.1:%d\n" % at for at in local))
        open(names, "w").write("".join(n + "\n" for n in LAB["names"]))
        open(resolvers, "w").write("127.0.0.1:%d\n" % RESOLVER)
        always = ["-jsonl", "-silent", "-omit-raw", "-omit-template", "-no-interactsh", "-disable-update-check"]
        runs = []
        ports = [t for t in GROUPS[group] if t != "effractor-points-to"]
        if ports:
            runs.append(["-t", ",".join(os.path.join(ROOT, "assets", "nuclei", t + ".yaml") for t in ports), "-list", targets, "-exclude-type", "dns"])
        if "effractor-points-to" in GROUPS[group]:
            runs.append(["-t", os.path.join(ROOT, "assets", "nuclei", "effractor-points-to.yaml"), "-list", names, "-resolvers", resolvers])
        lines = []
        for run in runs:
            out = subprocess.run(["nuclei"] + run + always, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=900)
            lines += [json.loads(l) for l in out.stdout.splitlines() if l.startswith("{")]
        # In an order that does not depend on which answer came first.
        lines.sort(key=lambda r: (r.get("template-id", ""), r.get("matched-at", ""), r.get("extractor-name", "")))
        written = [rewrite(r, local, i) for i, r in enumerate(lines)]
        path = os.path.join(FIXTURES, group + ".jsonl")
        open(path, "w", encoding="utf-8").write("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in written))
        version = subprocess.run(["nuclei", "-version"], capture_output=True, text=True).stderr
        print("wrote %d records to %s (%s)" % (len(written), path, (re.search(r"v[0-9.]+", version) or [""])[0]))


if __name__ == "__main__":
    if sys.argv[1:] == ["serve"]:
        with tempfile.TemporaryDirectory() as directory:
            for at, (address, port, _) in serve(directory).items():
                print("127.0.0.1:%d is %s:%d" % (at, address, port))
            threading.Event().wait()
    elif len(sys.argv) == 3 and sys.argv[1] == "record" and sys.argv[2] in GROUPS:
        record(sys.argv[2])
    else:
        sys.exit(__doc__)
```

- [ ] **Step 5: Run the test, then the lab**

Run: `node --test scripts/nuclei-templates.test.js`
Expected: PASS (every answer has its place in the lab; no port answers as two applications).

Run: `python3 scripts/dev/nuclei-lab.py record identify && python3 scripts/dev/nuclei-lab.py record connect`
Expected: `wrote N records to …/identify.jsonl (v3.11.0)` and the same for `connect.jsonl`.

Then check that nuclei found every answer, which is what proves the templates (CI has no nuclei):

```bash
node -e '
const T = require("./assets/js/nuclei-templates.js"), fs = require("fs");
const seen = new Set(["identify", "connect"].flatMap(g => fs.readFileSync("scripts/fixtures/nuclei/" + g + ".jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l)["extractor-name"])));
const missing = T.ANSWERS.map(a => a.name).filter(n => !seen.has(n));
console.log(missing.length ? "nuclei did not find: " + missing.join(", ") : "nuclei found every answer");
process.exit(missing.length ? 1 : 0);'
```

Expected: `nuclei found every answer`. For each one missing: the lab's page matches the pattern as JavaScript reads it (step 1 passed) and not as nuclei does. Read nuclei's view with `python3 scripts/dev/nuclei-lab.py serve` in one terminal and `nuclei -t assets/nuclei/effractor-web.yaml -target 127.0.0.1:<port> -debug-resp -no-interactsh -disable-update-check < /dev/null` in another; correct the pattern in the table (not the lab, unless the lab's page was wrong), write the files again (`node scripts/dev/nuclei-templates-write.js`), record again.

The two `.jsonl` files are committed in parts 3 and 4, with the tests that read them. Keep them uncommitted in the working tree for now, or record them again then.

- [ ] **Step 6: Hold the check in a test**

The check of step 5 becomes a test once the fixtures are committed (Tasks 9 and 12 add it). Nothing to do here.

- [ ] **Step 7: Commit and land part 2**

```bash
npm test && cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && node scripts/check-roadmap.js
git add scripts/dev/nuclei-lab.py scripts/fixtures/nuclei/lab.json scripts/nuclei-templates.test.js
git commit -m "A lab of throwaway servers that answers every question of the templates"
scripts/dev/ship.sh "effractor's nuclei templates and their command" "$SCRATCH/pr-templates.md" "$SCRATCH/commit-templates.txt"
```

Nothing of this part is seen in the page; it lands when CI is green. The PR body says so, and says that the dialog follows in part 5.

---

# Part 3 — what is there (branch `nuclei-identify`)

Nothing of this part shows in the page yet: no page offers the templates before part 5, and a result of theirs pasted by hand is read and drawn with every new row ticked.

### Task 7: The answers are read

**Files:**
- Modify: `assets/js/nuclei-templates.js` (add `read`)
- Modify: `assets/js/nuclei.js` (`read`, `notes`)
- Create: `scripts/fixtures/nuclei/identify.jsonl` (recorded, Task 6)
- Test: `scripts/nuclei-identify.test.js` (new)

**Interfaces:**
- Consumes: `T.answer`, `T.ANSWERS`, `T.VERSION` (Task 4); `C.target` (`nuclei-command.js`); `R.cleanName`, `R.portName` (`nmap-read.js`); `A.isName` (Task 2).
- Produces:
  - `T.read(records): {facts: Fact[], unknown: number, refused: number}`. A `Fact` has `at: {address: string | null, name: string | null, port: number | null}` and `kind`, one of: `product` (`name`, `product`, `version`, `unless`), `server` (`word`, `product`, `version`), `application` (`id`, `product`, `manages`, `signs`, `server`), `version` (`of`, `version`), `names` (`names: string[]`), `login`, `sso` (`product: string | null`, `host`), `points` (`name`, and `address` or `alias`), `said` (`what`, `text`).
  - On the scan `Nu.read(text).scan`: `answers`, `unknown`, `refused` (numbers); `results` and `informational` count nuclei's own records only; `points: [{name, address: string | null, alias: string | null}]`.
  - On a scanned port: `service: {name, product, version}` as nmap fills it; `application: {id, label, product, version}` where a server stands in front of one; `manages: boolean`, `signs: boolean` where an application was recognised; `login: {password: boolean, sso: {product, host} | null}`.
  - On a scanned host: `names: [{name, from: "certificate", port}]`; `said: string[]`.
  - A paste of names' answers alone is a result (`hosts: []`, `points` filled), not the problem `no-host`.

- [ ] **Step 1: Record the fixture**

Run: `python3 scripts/dev/nuclei-lab.py record identify`
Expected: `wrote N records to …/scripts/fixtures/nuclei/identify.jsonl (v3.11.0)`, N above 150.

- [ ] **Step 2: Write the failing tests**

Create `scripts/nuclei-identify.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const Nu = require('../assets/js/nuclei.js');
const S = require('../assets/js/scanners.js');
const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');

// What is there (nuclei templates spec §4, §5, §7): the answers of
// effractor's own templates read into products, applications and names.
// identify.jsonl is what nuclei 3.11.0 wrote against the lab of
// scripts/dev/nuclei-lab.py, rewritten to the lab's addresses.
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const text = () => fs.readFileSync('scripts/fixtures/nuclei/identify.jsonl', 'utf8');
const lines = () => text().trim().split('\n').map(l => JSON.parse(l));
const written = list => list.map(r => JSON.stringify(r)).join('\n') + '\n';
const result = () => Nu.read(text()).scan;
const host = (scan, address) => scan.hosts.find(h => h.addresses.includes(address));
const port = (scan, address, number) => host(scan, address).ports.find(p => p.port === number);
const STAMP = () => S.stampFor('nuclei', result(), '10.0.2.0/24', '2026-09-28');

test('the fixture holds every answer of the identify templates', () => {
  const seen = new Set(lines().map(r => r['extractor-name']));
  const asked = T.ANSWERS.filter(a => T.TEMPLATES.find(t => t.id === a.template).group === 'identify').map(a => a.name);
  assert.deepEqual(asked.filter(n => !seen.has(n)), [], 'record again: python3 scripts/dev/nuclei-lab.py record identify');
  for (const r of lines()) assert.match(r['template-id'], /^effractor-(banner|web|certificate)$/);
});

test('a banner names the product and its version, spelled as nmap spells it', () => {
  const scan = result();
  assert.equal(scan.tool, 'nuclei');
  assert.deepEqual([scan.results, scan.informational, scan.answers, scan.unknown, scan.refused], [0, 0, lines().length, 0, 0]);
  assert.deepEqual(host(scan, '10.0.2.5').ports.map(p => [p.port, p.service.name, p.service.product, p.service.version]), [
    [21, 'ftp', 'vsftpd', '3.0.5'],
    [22, 'ssh', 'OpenSSH', '9.6p1'],
    [25, 'smtp', 'Postfix smtpd', null],
    [143, 'imap', 'Dovecot', null],
    [2222, null, 'Dropbear sshd', '2022.83'],
    [3306, 'mysql', 'MariaDB', '10.11.6'],
  ]);
  assert.deepEqual(port(scan, '10.0.2.6', 3306).service, { name: 'mysql', product: 'MySQL', version: '8.0.36' }, 'MariaDB answers MySQL\'s pattern too; MySQL alone is MySQL');
  assert.ok(scan.hosts.every(h => h.ports.every(p => p.findings.length === 0 && p.state === 'open')));
});

test('a web port: the server on the port, the application a piece of its own', () => {
  const scan = result();
  const grafana = port(scan, '10.0.2.11', 443);
  assert.deepEqual(grafana.service, { name: 'https', product: 'nginx', version: '1.24.0' });
  assert.deepEqual(grafana.application, { id: 'grafana', label: 'Grafana', product: 'Grafana', version: '10.2.3' }, 'the version of the application that was recognised, not of one whose pattern fits too');
  // A server that names no version, and a management page behind it.
  const fw = port(scan, '10.0.2.14', 443);
  assert.deepEqual([fw.service.product, fw.service.version, fw.application.product, fw.manages], ['nginx', null, 'pfSense', true]);
  // An embedded server is a server like any other.
  const jenkins = port(scan, '10.0.2.15', 8080);
  assert.deepEqual([jenkins.service.product, jenkins.service.version, jenkins.application.product, jenkins.application.version], ['Jetty', '10.0.18', 'Jenkins', '2.440.1']);
  // The application answers by itself: one piece.
  const webmin = port(scan, '10.0.2.16', 10000);
  assert.deepEqual([webmin.service, webmin.application, webmin.manages], [{ name: null, product: 'Webmin', version: '2.105' }, undefined, true]);
  const pve = port(scan, '10.0.2.13', 8006);
  assert.deepEqual([pve.service.product, pve.service.version, pve.application], ['Proxmox VE', '8.1.4', undefined], 'no Server header');
  // No application: the server; its name as nmap has it.
  assert.deepEqual(port(scan, '10.0.2.12', 443).service, { name: 'https', product: 'Apache httpd', version: '2.4.57' });
  assert.deepEqual(port(scan, '10.0.2.61', 443).service.product, 'Microsoft IIS httpd');
  // Nothing named: the port is open, and what it said is said.
  assert.equal(port(scan, '10.0.2.62', 8000).service, null);
  assert.deepEqual(Nu.notes(scan), ['10.0.2.62 · title on tcp/8000: Printer status.']);
});

test('the names a certificate bears, with the port they were seen on', () => {
  const scan = result();
  assert.deepEqual(host(scan, '10.0.2.11').names, [
    { name: 'grafana.corp.example', from: 'certificate', port: 443 },
    { name: 'metrics.corp.example', from: 'certificate', port: 443 },
    { name: '*.corp.example', from: 'certificate', port: 443 },
  ]);
  const p = N.plan(E.empty(), null, scan, '10.0.2.0/24', {});
  const row = p.hosts.find(h => h.addresses.includes('10.0.2.11'));
  assert.deepEqual([row.label, row.names, row.saidNames], ['grafana.corp.example', ['grafana.corp.example', 'metrics.corp.example'], ['*.corp.example']]);
  const bare = p.hosts.find(h => h.addresses.includes('10.0.2.16'));
  assert.deepEqual([bare.label, bare.names, bare.saidNames], ['10.0.2.16', [], ['10.0.2.16']], 'an address is no name');
});

test('review focus 1: a paste of nuclei\'s own results and effractor\'s reads both', () => {
  const own = fs.readFileSync('scripts/fixtures/nuclei/lab.jsonl', 'utf8');
  const scan = Nu.read(own + text()).scan;
  assert.deepEqual([scan.results, scan.informational, scan.answers], [12, 6, lines().length]);
  assert.ok(host(scan, '10.0.1.40').ports.find(p => p.port === 3000).findings.length === 3);
  assert.equal(port(scan, '10.0.2.5', 22).service.product, 'OpenSSH');
  assert.equal(Nu.notes(scan)[0], '6 of 12 results are informational: they say a port is open, not what is wrong.');
});

test('review focus 2: an answer this version does not know is counted, and draws nothing', () => {
  const [first] = lines();
  const newer = Object.assign({}, first, { 'extractor-name': 'from-a-newer-template', 'extracted-results': ['x'] });
  const other = Object.assign({}, first, { 'template-id': 'effractor-of-tomorrow', 'extractor-name': 'openssh' });
  const stolen = Object.assign({}, first, { 'template-id': 'effractor-web', 'extractor-name': 'openssh' });
  const scan = Nu.read(written([first, newer, other, stolen, Object.assign({}, first, { 'extractor-name': 7 }), Object.assign({}, first, { 'extractor-name': '__proto__' })])).scan;
  assert.equal(scan.unknown, 5);
  assert.equal(scan.hosts.length, 1);
  assert.match(Nu.notes(scan).join(' '), /5 answers this version does not know; not drawn\./);
  // Only unknown answers: no host, said as any result without one.
  assert.equal(Nu.read(written([newer])).problem.code, 'no-host');
});

test('review focus 3: hostile values are cleaned, cut, or refused by their shape', () => {
  const find = name => lines().find(r => r['extractor-name'] === name);
  const bad = (name, values, more) => Object.assign({}, find(name), { 'extracted-results': values }, more || {});
  const scan = Nu.read(written([
    bad('openssh', ['9.6p1; rm -rf /']),
    bad('openssh', ['<img src=x onerror=alert(1)>']),
    bad('openssh', [{ not: 'text' }, 7, null]),
    bad('openssh', 'not a list'),
    bad('jenkins-version', ['2.440.1\u0000\u0007']),
    bad('jenkins', ['X-Jenkins:']),
    bad('server', ['<script>alert(1)</script>/1.0'], { 'matched-at': 'http://10.0.2.15:8080/' }),
    bad('names', ['a'.repeat(5000) + '.example', 'ok.corp.example', '\u0000', '<b>x</b>', '10.0.2.11']),
    bad('title', ['t'.repeat(5000)], { 'matched-at': 'http://10.0.2.62:8000/' }),
  ])).scan;
  assert.equal(scan.refused, 5, 'four versions that are none, and a server whose name is markup');
  assert.equal(host(scan, '10.0.2.5'), undefined, 'an answer without its shape names nothing and opens no port');
  const j = port(scan, '10.0.2.15', 8080);
  assert.deepEqual([j.service.product, j.service.version], ['Jenkins', '2.440.1'], 'a server\'s name begins with a letter and holds no markup');
  const p = N.plan(E.empty(), null, scan, '', {});
  const named = p.hosts.find(h => h.addresses.includes('10.0.2.11'));
  assert.deepEqual(named.names, ['ok.corp.example']);
  assert.ok(named.saidNames.every(n => n.length <= 120 && !/[\u0000-\u001f]/.test(n)));
  for (const n of Nu.notes(scan)) assert.ok(n.length < 200 && !/[\u0000-\u001f]/.test(n), n);
});
```

The addresses are the lab's of Task 6: `10.0.2.5` and `10.0.2.6` speak first; `10.0.2.11` is Grafana behind nginx, `10.0.2.12` the wiki that sends its logins to Keycloak, `10.0.2.13` Proxmox VE, `10.0.2.14` pfSense behind nginx, `10.0.2.15` Jenkins on Jetty, `10.0.2.16` Webmin, `10.0.2.61` IIS, `10.0.2.62` the port that only has a title.

- [ ] **Step 3: Run them to see them fail**

Run: `node --test scripts/nuclei-identify.test.js`
Expected: FAIL; the first of them with `Cannot read properties of null (reading 'product')` or the like: nuclei's reader names no product yet.

- [ ] **Step 4: Read the records as facts**

In `assets/js/nuclei-templates.js`, before `var api`, add:

```js
  // ---- reading their answers (spec §4) ----

  // What is said of a value at most.
  var MOST_TEXT = 120;
  var SHAPE = new RegExp("^" + VERSION.slice(1, -1) + "$");
  var SCHEME_PORTS = { http: 80, https: 443 };
  // The servers' names as nmap spells them; any other is drawn as written.
  var SERVERS = {
    apache: "Apache httpd", nginx: "nginx", "microsoft-iis": "Microsoft IIS httpd", lighttpd: "lighttpd", openresty: "OpenResty",
    caddy: "Caddy httpd", jetty: "Jetty", "apache-coyote": "Apache Tomcat/Coyote JSP engine", gunicorn: "gunicorn", "microsoft-httpapi": "Microsoft HTTPAPI httpd",
  };
  var DECODE = {
    // Roundcube's 10611 is 1.6.11.
    rcversion: function (t) {
      var n = /^[0-9]{5,6}$/.test(t) ? Number(t) : 0;
      return n ? [Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100].join(".") : null;
    },
  };

  // A value as text: no control characters, cut; null where nothing is left.
  function clean(x) {
    var t = typeof x === "string" ? R.cleanName(x) : null;
    return t ? t.slice(0, MOST_TEXT) : null;
  }
  function shaped(x) {
    var t = clean(x);
    return t && SHAPE.test(t) ? t : null;
  }
  function portOf(x) {
    var n = typeof x === "number" ? x : /^\d{1,5}$/.test(String(x == null ? "" : x).trim()) ? Number(x) : 0;
    return n > 0 && n < 65536 && n === Math.floor(n) ? n : null;
  }
  // Where an answer was found. The port is the one in `matched-at`: for a
  // port a template names itself, nuclei's `port` says 80 (spec §12).
  function where(r) {
    var at = C.target(r["matched-at"]), host = C.target(r.host), url = C.target(r.url);
    var said = host.host || at.host || url.host;
    var ip = typeof r.ip === "string" ? r.ip.trim() : "";
    var name = said && !Ad.bytes(said) ? (clean(said) || "").toLowerCase() : "";
    return {
      address: Ad.bytes(ip) ? ip : said && Ad.bytes(said) ? said : null,
      name: name || null,
      port: r.type === "dns" ? null : at.port || (has(SCHEME_PORTS, String(at.scheme)) ? SCHEME_PORTS[at.scheme] : null) || host.port || url.port || portOf(r.port),
    };
  }
  // "nginx/1.24.0", "Apache/2.4.57 (Debian)", "Jetty(10.0.18)", "nginx".
  function server(text) {
    var m = /^([A-Za-z][A-Za-z0-9_.+-]*)(?:[\/(]v?([0-9][0-9A-Za-z._-]*))?/.exec(text);
    if (!m) return null;
    var word = m[1].toLowerCase();
    return { kind: "server", word: word, product: has(SERVERS, word) ? SERVERS[word] : m[1], version: m[2] || null };
  }
  // What one answer says, or null where its value has not the shape.
  function fact(a, values, at) {
    var first = values[0] || null;
    if (a.is === "product") {
      var v = a.gives === "version" ? shaped(first) : null;
      return a.gives === "version" && !v ? null : { kind: "product", name: a.name, product: a.product, version: v, unless: a.unless || null };
    }
    if (a.is === "server") return first ? server(first) : null;
    if (a.is === "application") return { kind: "application", id: a.name, product: a.product, manages: !!a.manages, signs: !!a.signs, server: a.server || null };
    if (a.is === "version") {
      var read = a.decode ? DECODE[a.decode](first || "") : shaped(first);
      return read ? { kind: "version", of: a.of, version: read } : null;
    }
    if (a.is === "names") return values.length ? { kind: "names", names: values } : null;
    if (a.is === "login") return { kind: "login" };
    if (a.is === "sso") {
      var to = (C.target(first || "").host || "").toLowerCase();
      return A.isName(to) ? { kind: "sso", product: a.kind, host: to } : null;
    }
    if (a.is === "address") return at.name && first && Ad.bytes(first) ? { kind: "points", name: at.name, address: first } : null;
    if (a.is === "alias") {
      var alias = (first || "").toLowerCase().replace(/\.$/, "");
      return at.name && A.isName(alias) ? { kind: "points", name: at.name, alias: alias } : null;
    }
    return first ? { kind: "said", what: a.name, text: first } : null;
  }

  // The records of effractor's templates as facts, each with where it was
  // found ({address, name, port}) and its day. An extractor this table does
  // not hold is counted, a value without its shape is counted; neither is
  // drawn. Returns {facts, unknown, refused}.
  function read(records) {
    var out = { facts: [], unknown: 0, refused: 0 };
    (records || []).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var a = answer(r["extractor-name"]);
      if (!a || a.template !== r["template-id"]) return out.unknown++;
      var values = (Array.isArray(r["extracted-results"]) ? r["extracted-results"] : []).map(clean).filter(Boolean);
      var at = where(r);
      var f = fact(a, values, at);
      if (!f) return out.refused++;
      f.at = at;
      out.facts.push(f);
    });
    return out;
  }
```

In `assets/js/nuclei-templates.js`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** The reader's helpers. Find:

```js
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
```

Write in its place:

```js
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
```

**2.** Exported. Find:

```js
targets: targets, command: command };
```

Write in its place:

```js
targets: targets, command: command, read: read };
```

- [ ] **Step 5: Fold the facts into the scan**

In `assets/js/nuclei.js`, 9 edits, in this order. Each *find* stands in the file exactly once.

**1.** Effractor's templates. Find:

```js
  var C = node ? require("./nuclei-command.js") : window.effractorNucleiCommand;
```

Write in its place:

```js
  var C = node ? require("./nuclei-command.js") : window.effractorNucleiCommand;
  var T = node ? require("./nuclei-templates.js") : window.effractorNucleiTemplates;
```

**2.** A host keeps what was only said. Find:

```js
scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [] };
      hosts.push(h);
```

Write in its place:

```js
scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [], said: [] };
      hosts.push(h);
```

**3.** Effractor's records are set apart; the day is every record's. Find:

```js
    // Where each result was found, and what it says.
    var info = 0, first = null;
    var read = got.list.map(function (r) {
```

Write in its place:

```js
    // effractor's own templates (nuclei templates spec §4): their answers
    // are facts about a port, a host or a name, not findings.
    var ours = got.list.filter(function (r) { return /^effractor-/.test(word(r["template-id"])); });
    var answers = T.read(ours);
    var points = [];

    // Where each result was found, and what it says.
    var info = 0, first = null;
    got.list.forEach(function (r) {
      var day = /^\d{4}-\d{2}-\d{2}/.exec(word(r.timestamp));
      if (day && (!first || day[0] < first)) first = day[0];
    });
    var read = got.list.filter(function (r) { return ours.indexOf(r) < 0; }).map(function (r) {
```

**4.** The day is read above. Find:

```js
      var day = /^\d{4}-\d{2}-\d{2}/.exec(word(r.timestamp));
      if (day && (!first || day[0] < first)) first = day[0];
      var finding = null;
```

Write in its place:

```js
      var finding = null;
```

**5.** Every fact with a port is placed as a result is. Find:

```js
      };
    });
    // A host is one with an open port or a finding.
```

Write in its place:

```js
      };
    });
    answers.facts.forEach(function (f) {
      if (f.kind === "points") points.push(f);
      else if (f.at.port) read.push({ address: f.at.address, name: f.at.name, port: f.at.port, finding: null, fact: f });
    });
    // A host is one with an open port or a finding.
```

**6.** A port gathers its facts. Find:

```js
      var list = x.port ? port(h, x.port).findings : h.findings;
      if (x.finding
```

Write in its place:

```js
      var list = x.port ? port(h, x.port).findings : h.findings;
      if (x.fact) {
        var p = port(h, x.port);
        (p.facts = p.facts || []).push(x.fact);
      }
      if (x.finding
```

**7.** What the facts of a port come to; names that point are a result without a host. Find:

```js
    if (!hosts.length) return problem("no-host");
    hosts.forEach(function (h) {
      h.ports.sort(function (a, b) { return a.port - b.port; });
    });
```

Write in its place:

```js
    // What the facts of one port come to (spec §5.2, §5.4): the server is
    // the service on the port; the application a piece of its own, unless
    // it answers by itself.
    function settle(h, p) {
      var facts = p.facts;
      delete p.facts;
      var of = function (kind) { return facts.filter(function (f) { return f.kind === kind; }); };
      var products = of("product").filter(function (f) {
        return !(f.unless && facts.some(function (o) { return o.kind === "product" && o.name === f.unless; }));
      });
      var server = of("server")[0] || null, app = of("application")[0] || null;
      var version = app ? of("version").filter(function (f) { return f.of === app.id; })[0] : null;
      var named = p.service ? p.service.name : null;
      function service(x, v) {
        p.service = { name: named, product: x, version: v || null };
      }
      if (app && server && server.word !== app.server) {
        service(server.product, server.version);
        p.application = { id: app.id, label: app.product, product: app.product, version: version ? version.version : null };
      } else if (app) service(app.product, version ? version.version : null);
      else if (server) service(server.product, server.version);
      else if (products.length) service(products[0].product, products[0].version);
      if (app) {
        p.manages = app.manages;
        p.signs = app.signs;
      }
      var sso = of("sso")[0] || null;
      if (sso || of("login").length) p.login = { password: of("login").length > 0, sso: sso ? { product: sso.product, host: sso.host } : null };
      of("names").forEach(function (f) {
        f.names.forEach(function (n) {
          if (!h.names.some(function (x) { return x.name.toLowerCase() === n.toLowerCase(); })) h.names.push({ name: n, from: "certificate", port: p.port });
        });
      });
      // What a port said is said where it named nothing.
      if (!p.service || !p.service.product) {
        of("said").forEach(function (f) {
          var text = f.what + " on " + p.protocol + "/" + p.port + ": " + f.text;
          if (h.said.indexOf(text) < 0) h.said.push(text);
        });
      }
    }
    if (!hosts.length && !points.length) return problem("no-host");
    hosts.forEach(function (h) {
      h.ports.sort(function (a, b) { return a.port - b.port; });
      h.ports.forEach(function (p) { if (p.facts) settle(h, p); });
    });
    // What each name points to, once (spec §6.4).
    var pointed = [];
    points.forEach(function (f) {
      var x = pointed.filter(function (y) { return y.name === f.name; })[0];
      if (!x) pointed.push(x = { name: f.name, address: null, alias: null });
      if (f.address) x.address = x.address || f.address;
      if (f.alias) x.alias = x.alias || f.alias;
    });
```

**8.** The scan says how many of each it read. Find:

```js
      results: got.list.length,
      informational: info,
```

Write in its place:

```js
      results: got.list.length - ours.length,
      informational: info,
      answers: ours.length,
      unknown: answers.unknown,
      refused: answers.refused,
      points: pointed,
```

**9.** What was read past, and what was only said. Find:

```js
    var n = scan.informational || 0;
    if (!n) return [];
    return [n + " of " + scan.results + (scan.results === 1 ? " result is" : " results are") + " informational: they say a port is open, not what is wrong."];
```

Write in its place:

```js
    var n = scan.informational || 0, out = [];
    if (n) out.push(n + " of " + scan.results + (scan.results === 1 ? " result is" : " results are") + " informational: they say a port is open, not what is wrong.");
    // Nuclei templates spec §4: what was read past, and what was only said.
    if (scan.unknown) out.push(scan.unknown + (scan.unknown === 1 ? " answer" : " answers") + " this version does not know; not drawn.");
    if (scan.refused) out.push(scan.refused + (scan.refused === 1 ? " answer has" : " answers have") + " not the shape of what was asked; not drawn.");
    (scan.hosts || []).forEach(function (h) {
      (h.said || []).forEach(function (s) { out.push((h.addresses[0] || h.hostname) + " · " + s + "."); });
    });
    return out;
```

- [ ] **Step 6: Run the tests**

Run: `node --test scripts/nuclei-identify.test.js scripts/nuclei.test.js`
Expected: PASS; nuclei's own tests did not change.

- [ ] **Step 7: Commit**

```bash
npm test
git add assets/js/nuclei-templates.js assets/js/nuclei.js scripts/nuclei-identify.test.js scripts/fixtures/nuclei/identify.jsonl
git commit -m "The answers of effractor's templates are read: products, applications, names"
```

### Task 8: One comparison of products for every scanner

**Files:**
- Create: `assets/js/nmap-products.js`
- Modify: `assets/js/nmap-plan.js`, `assets/js/nmap-changes.js`
- Modify: `crates/effractor-server/templates/shell.html`, `crates/effractor-server/src/shell.rs`
- Test: `scripts/nmap-products.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces (`window.effractorNmapProducts`):
  - `P.parts(label): {name: string, version: string | null}` — lower case; the version is the first word after the first that begins with a digit (or `v` and a digit).
  - `P.key(label): string` — the name, a space and the version where there is one.
  - `P.same(a, b): boolean`; `P.unidentified(label): boolean`; `P.lacks(drawn, found): boolean` — `drawn` is unnamed, or has `found`'s name and no version.
  - In `nmap-plan.js`'s `apply`: `productFor(label, existing): string` — the id of the product of that name and version: `existing`, one made by this import, one drawn, else a new one.

- [ ] **Step 1: Write the failing test**

Create `scripts/nmap-products.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/js/nmap-products.js');

// One comparison of products for every scanner (nuclei templates spec §7.3).
test('a product is its name and the first word of its version, whatever their case', () => {
  assert.deepEqual(P.parts('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5'), { name: 'openssh', version: '9.6p1' });
  assert.deepEqual(P.parts('  Apache   httpd 2.4.57 ((Debian)) '), { name: 'apache httpd', version: '2.4.57' });
  assert.deepEqual(P.parts('Microsoft IIS httpd 10.0'), { name: 'microsoft iis httpd', version: '10.0' });
  assert.deepEqual(P.parts('nginx'), { name: 'nginx', version: null });
  assert.deepEqual(P.parts('Dovecot imapd'), { name: 'dovecot imapd', version: null });
  assert.deepEqual(P.parts('Gitea v1.21.4'), { name: 'gitea', version: '1.21.4' });
  assert.deepEqual(P.parts('3Com switch'), { name: '3com switch', version: null }, 'a first word is a name, whatever it begins with');
  assert.deepEqual(P.parts('unidentified ssh on 10.0.1.7'), { name: 'unidentified ssh on 10.0.1.7', version: null }, 'what nobody named has no version');
  assert.deepEqual(P.parts(null), { name: '', version: null });
  assert.equal(P.key('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5'), 'openssh 9.6p1');
  assert.equal(P.key('nginx'), 'nginx');
});

test('the same product, and one that says more of another', () => {
  assert.equal(P.same('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5', 'openssh 9.6p1'), true);
  assert.equal(P.same('OpenSSH 9.6p1', 'OpenSSH 9.7p1'), false);
  assert.equal(P.same('nginx', 'nginx 1.24.0'), false);
  assert.equal(P.same('unidentified ssh on Server', 'unidentified ssh on Server'), true);
  assert.equal(P.same('unidentified ssh on A', 'unidentified ssh on B'), false);
  assert.equal(P.lacks('unidentified ftp on Server', 'vsftpd 3.0.5'), true);
  assert.equal(P.lacks('unidentified ftp on Server', 'unidentified ftp on Server'), false);
  assert.equal(P.lacks('nginx', 'nginx 1.24.0'), true, 'the name, and no version');
  assert.equal(P.lacks('nginx', 'Apache httpd 2.4.57'), false);
  assert.equal(P.lacks('nginx 1.24.0', 'nginx 1.25.3'), false, 'another version is a difference, not a lack');
  assert.equal(P.lacks('nginx', 'nginx'), false);
  assert.equal(P.unidentified('Unidentified ssh on Server'), true);
  assert.equal(P.unidentified('OpenSSH'), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test scripts/nmap-products.test.js`
Expected: FAIL with `Cannot find module '../assets/js/nmap-products.js'`.

- [ ] **Step 3: Write the module**

Create `assets/js/nmap-products.js`:

```js
// One comparison of products for every scanner (nuclei templates spec §7.3):
// by name and by the first word of the version, whatever their case, so
// nmap's "OpenSSH 9.6p1 Ubuntu 3ubuntu13.5" and a banner's "OpenSSH 9.6p1"
// are one product. Pure.
(function () {
  var node = typeof module !== "undefined";

  // A product nobody has named: "unidentified ssh on Server".
  function unidentified(label) {
    return /^unidentified /i.test(String(label == null ? "" : label).trim());
  }
  // "OpenSSH 9.6p1 Ubuntu 3ubuntu13.5" → {name: "openssh", version: "9.6p1"};
  // the version is the first word that begins with a digit and is not the
  // first word ("3Com switch" has none).
  function parts(label) {
    var text = String(label == null ? "" : label).trim().replace(/\s+/g, " ");
    if (unidentified(text)) return { name: text.toLowerCase(), version: null };
    var words = text.split(" ");
    for (var i = 1; i < words.length; i++) {
      if (/^v?[0-9]/i.test(words[i])) return { name: words.slice(0, i).join(" ").toLowerCase(), version: words[i].toLowerCase().replace(/^v/, "") };
    }
    return { name: text.toLowerCase(), version: null };
  }
  function key(label) {
    var p = parts(label);
    return p.name + (p.version ? " " + p.version : "");
  }
  function same(a, b) {
    return key(a) === key(b);
  }
  // Whether `drawn` is the product `found` says more of: nobody named it,
  // or it has the name and no version.
  function lacks(drawn, found) {
    if (unidentified(drawn)) return !unidentified(found);
    var d = parts(drawn), f = parts(found);
    return d.name === f.name && !d.version && !!f.version;
  }

  var api = { unidentified: unidentified, parts: parts, key: key, same: same, lacks: lacks };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapProducts = api;
})();
```

- [ ] **Step 4: Compare by it**

In `assets/js/nmap-plan.js`, 6 edits, in this order. Each *find* stands in the file exactly once.

**1.** The comparison. Find:

```js
  var Ch = node ? require("./nmap-changes.js") : window.effractorNmapChanges;
```

Write in its place:

```js
  var Ch = node ? require("./nmap-changes.js") : window.effractorNmapChanges;
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
```

**2.** Drawn products by name and version. Find:

```js
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) {
      var k = String(doc.entities[p].label).toLowerCase();
      products[k] = products[k] || p;
    });
```

Write in its place:

```js
    // And by name and version, whatever follows them (nuclei templates
    // spec §7.3).
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) {
      var k = P.key(doc.entities[p].label);
      products[k] = products[k] || p;
    });
```

**3.** A scanned product is a drawn one by the same comparison. Find:

```js
    if (product.identified && products[product.label.toLowerCase()]) product.existing = products[product.label.toLowerCase()];
```

Write in its place:

```js
    if (product.identified && products[P.key(product.label)]) product.existing = products[P.key(product.label)];
```

**4.** Two new services of one product count it once. Find:

```js
          if (!r.product.existing && !(r.product.identified && newProducts[r.product.label])) {
            newProducts[r.product.label] = true;
            s.products++;
          }
```

Write in its place:

```js
          var k = r.product.identified ? P.key(r.product.label) : r.product.label;
          if (!r.product.existing && !(r.product.identified && newProducts[k])) {
            newProducts[k] = true;
            s.products++;
          }
```

**5.** A product by its name and version, drawn or made by this import. Find:

```js
    var flows = [], marks = [], hostOf = {};
```

Write in its place:

```js
    var flows = [], marks = [], hostOf = {};
    // A product by its name and version, drawn or made by this import.
    function productFor(label, existing) {
      var id = existing || madeProducts[P.key(label)] || ids(next, "product").filter(function (x) { return P.key(next.entities[x].label) === P.key(label); })[0];
      if (!id) id = madeProducts[P.key(label)] = step(A.addEntity(next, "product", label, specOf("product"))).entity;
      return id;
    }
```

**6.** A new service takes it. Find:

```js
          var product = r.product.existing || madeProducts[r.product.label];
          if (!product) {
            product = step(A.addEntity(next, "product", r.product.label, specOf("product"))).entity;
            if (r.product.identified) madeProducts[r.product.label] = product;
          }
          link("instance-of", service, product);
```

Write in its place:

```js
          var product = r.product.identified ? productFor(r.product.label, r.product.existing) : step(A.addEntity(next, "product", r.product.label, specOf("product"))).entity;
          link("instance-of", service, product);
```

In `assets/js/nmap-changes.js`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** The comparison. Find:

```js
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
```

Write in its place:

```js
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
```

**2.** Nmap offers no other version of what is the same product. Find:

```js
if (!of || !doc.entities[of.to] || doc.entities[of.to].label === r.product.label) return;
```

Write in its place:

```js
if (!of || !doc.entities[of.to] || P.same(doc.entities[of.to].label, r.product.label)) return;
```

In `crates/effractor-server/templates/shell.html`, 1 edit, in this order. Each *find* stands in the file exactly once.

**1.** Loaded before what compares by it. Find:

```html
<script src="{{ asset_prefix }}assets/js/nmap-changes.js" defer></script>
```

Write in its place:

```html
<script src="{{ asset_prefix }}assets/js/nmap-products.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nmap-changes.js" defer></script>
```

In `crates/effractor-server/src/shell.rs`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** Its order. Find:

```rust
            "nmap-route.js",
            "nmap-changes.js",
```

Write in its place:

```rust
            "nmap-route.js",
            "nmap-products.js",
            "nmap-changes.js",
```

**2.** Before what compares by it. Find:

```rust
        // The scanners beside nmap read through nmap's reader (roadmap
```

Write in its place:

```rust
        assert!(at("nmap-products.js") < at("nmap-changes.js"));
        assert!(at("nmap-products.js") < at("nmap-plan.js"));
        // The scanners beside nmap read through nmap's reader (roadmap
```

- [ ] **Step 5: Run everything; no pinned document moves**

Run: `npm test && cargo test -p effractor-server shell && git status --short scripts/fixtures`
Expected: PASS, and no fixture changed: in every fixture two products of one name and version were one product already. If a pinned document moved, read the difference: two services whose products differ only after the version's first word now share one product; that is what spec §7.3 asks for, so regenerate it (`NMAP_FIXTURE=write npm test`) and say so in the commit.

- [ ] **Step 6: Commit**

```bash
git add assets/js/nmap-products.js assets/js/nmap-plan.js assets/js/nmap-changes.js scripts/nmap-products.test.js crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs
git commit -m "Products are compared by name and version, whoever named them"
```

### Task 9: Products, applications and names are drawn, and part 3 lands

**Files:**
- Modify: `assets/js/nmap-plan.js` (`portRow`, `defaults`, `summary`, `said`, `apply`)
- Modify: `crates/effractor-format/tests/json.rs`, `scripts/check-nmap-wasm.js:26`
- Create: `scripts/fixtures/nuclei/imported-identify.doc.json` (written by the test)
- Test: `scripts/nuclei-identify.test.js`

**Interfaces:**
- Consumes: the scan of Task 7; `P` and `productFor` (Task 8); `h.names` (Task 3).
- Produces, on each port row `r` of `N.plan(…).hosts[].ports`, for a scan of `tool: "nuclei"` (`null` for every other):
  - `r.identifies: {product: id, from: label, to: label, existing: id | null} | null` — the drawn product lacked what nuclei says;
  - `r.differs: string | null` — `drawn: … · nuclei: …`;
  - `r.application: {label, product: {label, existing: id | null}, known: serviceId | null, differs: string | null} | null`.
  - `ticks.identifies[r.key]`, `ticks.applications[r.key]`: `true` at first where there is something to tick.
  - `summary(…).told: number` — products named.
  - An application is drawn as a service labelled by its name, hosted at `privilege: "unknown"`, an instance of its product, reached by a flow from the port's service with `protocol: "http"` and the label `<application> behind <port's label> on <host>`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/nuclei-identify.test.js`, the `require` with the others at the top:

```js
const P = require('../assets/js/nmap-products.js');

// The lab as nmap drew it before: a server with ssh under nmap's own label,
// an ftp nobody named, a mail service named otherwise, and a web host whose
// server has a name and no version.
function drawn() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.2.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.2.2'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
    srv: { kind: 'host', label: 'Server', addresses: ['10.0.2.5'] },
    sshd: { kind: 'service', label: 'ssh' },
    ftpd: { kind: 'service', label: 'ftp' },
    smtpd: { kind: 'service', label: 'smtp' },
    openssh: { kind: 'product', label: 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5' },
    noftp: { kind: 'product', label: 'unidentified ftp on Server' },
    exim: { kind: 'product', label: 'Exim smtpd 4.96' },
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.2.11'] },
    https: { kind: 'service', label: 'https' },
    nginx: { kind: 'product', label: 'nginx' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a2: { kind: 'attached', from: 'srv', to: 'lan' },
    a3: { kind: 'attached', from: 'web', to: 'lan' },
    a4: { kind: 'hosts', from: 'box', to: 'nmap', privilege: 'user' },
    a5: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
    a6: { kind: 'hosts', from: 'srv', to: 'sshd', privilege: 'unknown' },
    a7: { kind: 'hosts', from: 'srv', to: 'ftpd', privilege: 'unknown' },
    a8: { kind: 'hosts', from: 'srv', to: 'smtpd', privilege: 'unknown' },
    a9: { kind: 'hosts', from: 'web', to: 'https', privilege: 'unknown' },
    b1: { kind: 'instance-of', from: 'sshd', to: 'openssh' },
    b2: { kind: 'instance-of', from: 'ftpd', to: 'noftp' },
    b3: { kind: 'instance-of', from: 'smtpd', to: 'exim' },
    b4: { kind: 'instance-of', from: 'https', to: 'nginx' },
  };
  d.flows = {
    f1: { label: 'ssh on Server', source: 'nmap', target: 'sshd', route: ['lan'], protocol: 'tcp/22' },
    f2: { label: 'ftp on Server', source: 'nmap', target: 'ftpd', route: ['lan'], protocol: 'tcp/21' },
    f3: { label: 'smtp on Server', source: 'nmap', target: 'smtpd', route: ['lan'], protocol: 'tcp/25' },
    f4: { label: 'https on Web 1', source: 'nmap', target: 'https', route: ['lan'], protocol: 'tcp/443' },
  };
  return d;
}
// Only the two drawn hosts of the result, to keep what is asserted small.
const few = () => {
  const scan = result();
  scan.hosts = scan.hosts.filter(h => ['10.0.2.5', '10.0.2.11'].includes(h.addresses[0]));
  return scan;
};
const row = (p, address, proto) => p.hosts.find(h => h.addresses.includes(address)).ports.find(r => r.proto === proto);

test('spec §7: a product is named once; what is drawn is left, what differs is said', () => {
  const d = drawn();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const ssh = row(p, '10.0.2.5', 'tcp/22');
  assert.deepEqual([ssh.known, ssh.addsFlow, ssh.identifies, ssh.differs], ['sshd', false, null, null], 'nmap\'s longer label is the same product; nmap beside it already reaches it');
  assert.deepEqual(row(p, '10.0.2.5', 'tcp/21').identifies, { product: 'noftp', from: 'unidentified ftp on Server', to: 'vsftpd 3.0.5', existing: null });
  const smtp = row(p, '10.0.2.5', 'tcp/25');
  assert.deepEqual([smtp.identifies, smtp.differs], [null, 'drawn: Exim smtpd 4.96 · nuclei: Postfix smtpd']);
  const web = row(p, '10.0.2.11', 'tcp/443');
  assert.deepEqual(web.identifies, { product: 'nginx', from: 'nginx', to: 'nginx 1.24.0', existing: null }, 'a name without a version takes the version');
  assert.deepEqual(web.application, { label: 'Grafana', product: { label: 'Grafana 10.2.3', existing: null }, known: null, differs: null });
  const t = N.defaults(p);
  assert.deepEqual([t.identifies, t.applications], [{ 'h0/tcp/21': true, 'h1/tcp/443': true }, { 'h1/tcp/443': true }]);
  const s = N.summary(d, p, t, { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.services, s.products, s.flows, s.told, s.named], [0, 4, 4, 4, 2, 1]);
  assert.equal(N.said(s), 'Adds 4 services, 4 products, 4 flows, names for 1 drawn host, names 2 products.');
});

test('spec §5.4: the server passes on to the application, both on the host', () => {
  const d = drawn();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP()).doc;
  const id = name => Object.keys(out.entities).find(k => out.entities[k].label === name);
  const link = (kind, from) => Object.values(out.associations).filter(a => a.kind === kind && a.from === from).map(a => a.to);
  // The unnamed product took the name and kept its id; so did the one without a version.
  assert.equal(out.entities.noftp.label, 'vsftpd 3.0.5');
  assert.equal(out.entities.nginx.label, 'nginx 1.24.0');
  assert.equal(out.entities.exim.label, 'Exim smtpd 4.96', 'what differs is not changed');
  assert.equal(out.entities.openssh.label, 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5');
  assert.deepEqual(link('instance-of', 'sshd'), ['openssh']);
  const grafana = id('Grafana');
  assert.equal(out.entities[grafana].kind, 'service');
  assert.deepEqual(link('hosts', 'web').sort(), ['https', grafana].sort());
  assert.deepEqual(Object.values(out.associations).find(a => a.kind === 'hosts' && a.to === grafana).privilege, 'unknown');
  assert.deepEqual(link('instance-of', grafana), [id('Grafana 10.2.3')]);
  const pass = Object.values(out.flows).find(f => f.target === grafana);
  assert.deepEqual([pass.label, pass.source, pass.route, pass.protocol], ['Grafana behind https on Web 1', 'https', ['lan'], 'http']);
  assert.deepEqual(out.entities.web.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.equal(Object.values(out.flows).filter(f => f.protocol === 'tcp/443').length, 1, 'the port stays the server\'s');

  // Review focus 5: again, nothing new.
  const again = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  const s = N.summary(out, again, N.defaults(again), null);
  assert.deepEqual([s.hosts, s.services, s.products, s.flows, s.told, s.named], [0, 0, 0, 0, 0, 0]);
  assert.equal(N.apply(out, again, N.defaults(again), specOf, STAMP()), null);
  const web = row(again, '10.0.2.11', 'tcp/443');
  assert.deepEqual([web.identifies, web.differs, web.application.known, web.application.differs], [null, null, grafana, null]);

  // An application drawn in another version is said, not changed.
  out.entities[id('Grafana 10.2.3')].label = 'Grafana 9.5.1';
  const other = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  assert.equal(row(other, '10.0.2.11', 'tcp/443').application.differs, 'drawn: Grafana 9.5.1 · nuclei: Grafana 10.2.3');
});

test('unticked, nothing is named and no application drawn; a product others use is not renamed', () => {
  const d = drawn();
  d.entities.ftp2 = { kind: 'service', label: 'ftp 2' };
  d.associations.c1 = { kind: 'hosts', from: 'web', to: 'ftp2', privilege: 'unknown' };
  d.associations.c2 = { kind: 'instance-of', from: 'ftp2', to: 'noftp' };
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const t = N.defaults(p);
  t.identifies['h1/tcp/443'] = false;
  t.applications['h1/tcp/443'] = false;
  const out = N.apply(d, p, t, specOf, STAMP()).doc;
  assert.equal(out.entities.nginx.label, 'nginx');
  assert.equal(Object.values(out.entities).some(e => e.label === 'Grafana'), false);
  // Shared by another service: a product of its own is made, the shared one stays.
  assert.equal(out.entities.noftp.label, 'unidentified ftp on Server');
  const to = Object.values(out.associations).find(a => a.kind === 'instance-of' && a.from === 'ftpd').to;
  assert.equal(out.entities[to].label, 'vsftpd 3.0.5');
  assert.equal(Object.values(out.associations).find(a => a.kind === 'instance-of' && a.from === 'ftp2').to, 'noftp');
});

// What a drawing holds, whatever the ids and the labels' tails: hosts by
// address, their ports, each port's product, applications, names.
function shape(doc) {
  const e = doc.entities, out = [];
  const links = kind => Object.values(doc.associations).filter(a => a.kind === kind);
  const product = s => (links('instance-of').find(a => a.from === s) || {}).to;
  for (const id of Object.keys(e).filter(k => e[k].kind === 'host')) {
    const at = (e[id].addresses || []).join(',') || e[id].label;
    out.push(at + ' names ' + (e[id].names || []).slice().sort().join(','));
    for (const a of links('hosts').filter(a => a.from === id && e[a.to].kind === 'service')) {
      const flows = Object.values(doc.flows).filter(f => f.target === a.to);
      const ports = [...new Set(flows.map(f => f.protocol))].sort().join(',');
      const from = [...new Set(flows.map(f => e[f.source].kind === 'service' ? 'service ' + e[f.source].label : e[f.source].kind))].sort().join(',');
      out.push(at + ' ' + ports + ' ' + P.key(e[product(a.to)].label) + ' from ' + from);
    }
  }
  return out.sort();
}
// nmap's view of the same two hosts.
function nmapped() {
  const blank = (addresses, names, ports) => ({ addresses, hostname: names[0] || null, names: names.map(n => ({ name: n, from: 'DNS' })), identities: [], os: null, device: [], self: false, scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [], ports: ports.map(([port, name, product, version]) => ({ protocol: 'tcp', port, state: 'open', reason: 'syn-ack', service: { name, product, version }, scripts: [], findings: [] })) });
  return { tool: 'nmap', args: 'nmap -sV 10.0.2.0/24', date: '2026-09-27', silentUdp: 0, probed: {}, types: [], sharedMacs: 0, hosts: [
    blank(['10.0.2.5'], [], [[21, 'ftp', 'vsftpd', '3.0.5'], [22, 'ssh', 'OpenSSH', '9.6p1 Ubuntu 3ubuntu13.5'], [3306, 'mysql', 'MariaDB', '10.11.6']]),
    blank(['10.0.2.11'], ['grafana.corp.example'], [[443, 'https', 'nginx', '1.24.0']]),
  ] };
}
function start() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.2.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.2.2'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a4: { kind: 'hosts', from: 'box', to: 'nmap', privilege: 'user' },
    a5: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
  };
  return d;
}
const add = (doc, app, scan) => {
  const p = N.plan(doc, app, scan, '10.0.2.0/24', {});
  const edit = N.apply(doc, p, N.defaults(p), specOf, app === 'nmap' ? { date: '2026-09-28', recipes: ['services'], range: '10.0.2.0/24' } : STAMP());
  return edit ? edit.doc : doc;
};

test('spec §7.1: nmap then nuclei draws what nuclei then nmap draws, and a second import adds nothing', () => {
  const first = add(add(start(), 'nmap', nmapped()), 'nuclei', few());
  const second = add(add(start(), 'nuclei', few()), 'nmap', nmapped());
  assert.deepEqual(shape(first), shape(second));
  assert.deepEqual(shape(first), [
    '10.0.2.11 http grafana 10.2.3 from service https',
    '10.0.2.11 names grafana.corp.example,metrics.corp.example',
    '10.0.2.11 tcp/443 nginx 1.24.0 from application',
    '10.0.2.2 names ',
    '10.0.2.5 names ',
    '10.0.2.5 tcp/143 dovecot from application',
    '10.0.2.5 tcp/21 vsftpd 3.0.5 from application',
    '10.0.2.5 tcp/22 openssh 9.6p1 from application',
    '10.0.2.5 tcp/2222 dropbear sshd 2022.83 from application',
    '10.0.2.5 tcp/25 postfix smtpd from application',
    '10.0.2.5 tcp/3306 mariadb 10.11.6 from application',
  ]);
  const label = doc => Object.values(doc.entities).find(e => e.kind === 'product' && /^OpenSSH/.test(e.label)).label;
  assert.deepEqual([label(first), label(second)], ['OpenSSH 9.6p1 Ubuntu 3ubuntu13.5', 'OpenSSH 9.6p1'], 'a product keeps the label of whoever named it first');
  for (const doc of [first, second]) {
    assert.equal(Object.values(doc.entities).filter(e => e.kind === 'product').length, 8);
    assert.deepEqual(shape(add(add(doc, 'nmap', nmapped()), 'nuclei', few())), shape(doc));
    const q = N.plan(doc, 'nmap', nmapped(), '10.0.2.0/24', {});
    assert.deepEqual(q.changes.list.filter(c => c.kind === 'version'), [], 'nmap offers no other version of what is the same product');
  }
});

test('the imported document is the one the Rust and wasm checks validate', () => {
  const d = drawn();
  const scan = result();
  const p = N.plan(d, 'nuclei', scan, '10.0.2.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP()).doc;
  const file = 'scripts/fixtures/nuclei/imported-identify.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nuclei-identify.test.js`
Expected: the six new tests FAIL (`identifies` is undefined; no application is drawn).

- [ ] **Step 3: Plan and apply the rows**

In `assets/js/nmap-plan.js`, 13 edits, in this order. Each *find* stands in the file exactly once.

**1.** A row says what nuclei's templates told of its port. Find:

```js
        var row = portRow(seen, r.key, label, p, products);
```

Write in its place:

```js
        var row = portRow(seen, r.key, label, p, products);
        told(doc, scan, target, row, p, products);
```

**2.** What they told. Find:

```js
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow };
  }
```

Write in its place:

```js
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow, identifies: null, differs: null, application: null };
  }

  // The service a flow from `service` reaches on the same host: the
  // application it passes on to (nuclei templates spec §5.4).
  function passesTo(doc, host, service) {
    var found = null;
    Object.keys(doc.flows || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (!found && f.source === service && doc.entities[f.target] && doc.entities[f.target].kind === "service" && hostingOf(doc, f.target) === host) found = f.target;
    });
    return found;
  }
  // What nuclei's own templates say of a port beyond its being open
  // (spec §5, §7): the product a drawn service lacks, a product that
  // differs, and the application behind the server.
  function told(doc, scan, target, row, p, products) {
    if (scan.tool !== "nuclei") return;
    var drawn = row.known ? productOfService(doc, row.known) : null;
    if (drawn && row.product.identified) {
      var was = doc.entities[drawn].label;
      if (P.lacks(was, row.product.label)) row.identifies = { product: drawn, from: was, to: row.product.label, existing: row.product.existing };
      else if (!P.same(was, row.product.label)) row.differs = "drawn: " + was + " · nuclei: " + row.product.label;
    }
    if (!p.application) return;
    var label = p.application.product + (p.application.version ? " " + p.application.version : "");
    var app = { label: p.application.label, product: { label: label, existing: products[P.key(label)] || null }, known: row.known ? passesTo(doc, target, row.known) : null, differs: null };
    var has = app.known ? productOfService(doc, app.known) : null;
    if (has && !P.same(doc.entities[has].label, label) && !P.lacks(doc.entities[has].label, label)) app.differs = "drawn: " + doc.entities[has].label + " · nuclei: " + label;
    row.application = app;
  }
```

**3.** Tick groups for them. Find:

```js
identities: {}, names: {}, moves: {},
```

Write in its place:

```js
identities: {}, names: {}, identifies: {}, applications: {}, moves: {},
```

**4.** Ticked at first: a name for what had none, a piece that was found. Find:

```js
      h.ports.forEach(function (r) {
        if (!r.known || r.addsFlow) t.ports[r.key] = true;
```

Write in its place:

```js
      h.ports.forEach(function (r) {
        if (r.identifies) t.identifies[r.key] = true;
        if (r.application && !r.application.known) t.applications[r.key] = true;
        if (!r.known || r.addsFlow) t.ports[r.key] = true;
```

**5.** Whether a row's product is named and its application drawn. Find:

```js
  function markKey(r, f) {
```

Write in its place:

```js
  // Whether a row's product is named, and its application drawn: a known
  // port's as ticked, a new port's with the port.
  function telling(r, ticks) {
    var there = !!r.known || !!ticks.ports[r.key];
    return {
      identifies: !!r.identifies && !!(ticks.identifies && ticks.identifies[r.key]),
      application: !!r.application && !r.application.known && there && !!(ticks.applications && ticks.applications[r.key]),
    };
  }
  function markKey(r, f) {
```

**6.** Counted. Find:

```js
identified: 0, named: 0, moved: 0,
```

Write in its place:

```js
identified: 0, named: 0, told: 0, moved: 0,
```

**7.** Counted per port. Find:

```js
      h.ports.forEach(function (r) {
        marking(r, ticks).forEach(function (f) { marked[markKey(r, f)] = true; });
        if (!ticks.ports[r.key]) return;
```

Write in its place:

```js
      h.ports.forEach(function (r) {
        marking(r, ticks).forEach(function (f) { marked[markKey(r, f)] = true; });
        var tells = telling(r, ticks);
        if (tells.identifies) s.told++;
        if (tells.application) {
          s.services++;
          s.flows++;
          rel += 2; // hosts, instance-of
          if (!r.application.product.existing && !newProducts[P.key(r.application.product.label)]) {
            newProducts[P.key(r.application.product.label)] = true;
            s.products++;
          }
        }
        if (!ticks.ports[r.key]) return;
```

**8.** Said. Find:

```js
    if (s.unpatched) more.push("marks " + n(s.unpatched, "product") + " unpatched");
```

Write in its place:

```js
    if (s.told) more.push("names " + n(s.told, "product"));
    if (s.unpatched) more.push("marks " + n(s.unpatched, "product") + " unpatched");
```

**9.** An import that only names a product is an edit. Find:

```js
!s.identified && !s.named && !s.moved
```

Write in its place:

```js
!s.identified && !s.named && !s.told && !s.moved
```

**10.** The applications to draw. Find:

```js
    var flows = [], marks = [], hostOf = {};
    // A product by
```

Write in its place:

```js
    var flows = [], marks = [], hostOf = {}, passes = [];
    // A product by
```

**11.** A drawn service takes the product it lacked. Find:

```js
        // A known port with nothing to add is unticked, and its product still
        // takes the finding.
        if (!ticks.ports[r.key]) {
```

Write in its place:

```js
        var tells = telling(r, ticks);
        // The product a drawn service lacked: one that is drawn is used,
        // else the unnamed one takes the name (nuclei templates spec §7.3).
        if (tells.identifies && next.entities[r.known] && next.entities[r.identifies.product]) {
          var to = r.identifies.existing || madeProducts[P.key(r.identifies.to)];
          var others = links(next, "instance-of").filter(function (a) { return a.to === r.identifies.product && a.from !== r.known; }).length;
          if (!to && !others) {
            step(A.renameEntity(next, r.identifies.product, r.identifies.to));
            madeProducts[P.key(r.identifies.to)] = r.identifies.product;
          } else {
            to = productFor(r.identifies.to, to);
            Object.keys(next.associations).forEach(function (k) {
              var a = next.associations[k];
              if (a.kind === "instance-of" && a.from === r.known) a.to = to;
            });
            if (!others) env.soft(L.remove(next, "entities", r.identifies.product));
          }
        }
        if (tells.application && r.known && next.entities[r.known]) passes.push({ row: r, host: host, label: h.label, server: r.known });
        // A known port with nothing to add is unticked, and its product still
        // takes the finding.
        if (!ticks.ports[r.key]) {
```

**12.** A new service with an application behind it. Find:

```js
          link("instance-of", service, product);
        }
```

Write in its place:

```js
          link("instance-of", service, product);
          if (tells.application) passes.push({ row: r, host: host, label: h.label, server: service });
        }
```

**13.** The application, and the flow the server passes on by. Find:

```js
    Ch.applyChangesAfter(p, ticks, env, way.routes, flowOf, ends);
```

Write in its place:

```js
    // The application behind a server (nuclei templates spec §5.4): a
    // service of its own on the same host, which the server passes on to
    // over the first network the host is on.
    passes.forEach(function (x) {
      var made = step(A.addEntity(next, "service", x.row.application.label, specOf("service"))).entity;
      link("hosts", x.host, made, { privilege: "unknown" });
      link("instance-of", made, productFor(x.row.application.product.label, x.row.application.product.existing));
      var on = attachedNetworks(next, x.host);
      step(L.putFlow(next, null, { label: x.row.application.label + " behind " + x.row.label + " on " + x.label, source: x.server, target: made, route: on.length ? [on[0]] : [], protocol: "http" }));
    });
    Ch.applyChangesAfter(p, ticks, env, way.routes, flowOf, ends);
```

- [ ] **Step 4: Write the pinned document and run the tests**

Run: `NMAP_FIXTURE=write node --test scripts/nuclei-identify.test.js && node --test scripts/nuclei-identify.test.js`
Expected: PASS. Read `scripts/fixtures/nuclei/imported-identify.doc.json` once: a host per lab address, no host twice, `Grafana` a service of its own with a flow of protocol `http` from `https`.

- [ ] **Step 5: Pin it in Rust and in wasm**

In `crates/effractor-format/tests/json.rs`, before `fn nmap_fixture_is_valid`:

```rust
/// What effractor's own nuclei templates add (nuclei templates spec §5):
/// products, the application behind a server, names on hosts.
#[test]
fn the_nuclei_identify_fixture_is_a_valid_architecture() {
    let text = fixture_is_valid("nuclei", "imported-identify.doc.json");
    assert!(text.contains("label: Grafana 10.2.3"), "{text}");
    assert!(
        text.contains("    names: [grafana.corp.example, metrics.corp.example]"),
        "{text}"
    );
    assert!(text.contains("protocol: http\n"), "{text}");
}
```

In `scripts/check-nmap-wasm.js`, add `'nuclei/imported-identify.doc.json'` to `others`, and `nuclei-templates` to the comment above it.

Run: `cargo test -p effractor-format --test json nuclei && scripts/build-wasm.sh && node scripts/check-nmap-wasm.js`
Expected: PASS.

- [ ] **Step 6: Commit and land part 3**

```bash
npm test && cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && node scripts/check-roadmap.js
git add assets/js/nmap-plan.js scripts/nuclei-identify.test.js scripts/fixtures/nuclei/imported-identify.doc.json crates/effractor-format/tests/json.rs scripts/check-nmap-wasm.js
git commit -m "What nuclei's templates find is drawn: products, the application behind a server, names"
scripts/dev/ship.sh "What is there: effractor's templates read into the drawing" "$SCRATCH/pr-identify.md" "$SCRATCH/commit-identify.txt"
```

The PR body says that no page offers the templates yet and that the preview's rows for them follow in part 5.

---

# Part 4 — how it connects (branch `nuclei-connect`)

### Task 10: Connections are planned and drawn

**Files:**
- Create: `assets/js/nmap-connect.js`
- Modify: `assets/js/nuclei-templates.js` (add `application`), `assets/js/nmap-plan.js`
- Modify: `crates/effractor-server/templates/shell.html`, `crates/effractor-server/src/shell.rs`
- Create: `scripts/fixtures/nuclei/connect.jsonl` (recorded, Task 6)
- Test: `scripts/nuclei-connect.test.js` (new)

**Interfaces:**
- Consumes: the scan of Task 7 (`login`, `manages`, `points`, names with their `port`); the rows of Task 9; `P` (Task 8); `Ad.isPrivate`, `Ad.inCidr`, `Ad.addressKey`.
- Produces:
  - `T.application(name): answer | null` — the application whose product has that name, in lower case.
  - `window.effractorNmapConnect`: `Cn.plan(doc, scan, hosts, scanOf, appHost): {list: Connection[], notes: string[]}`; `Cn.defaults(p): {[key]: boolean}`; `Cn.ticked(p, ticks): Connection[]`; `Cn.count(p, ticks): {entities, relationships, accounts, hosts, links}`; `Cn.apply(p, ticks, env)`.
  - A `Connection` is `{key, kind, line, what, ticked, can, why?}` and, by `kind`: `login` and `admin-login` (`host`, `port`, `on: "service" | "application"`, `account`), `sso` (the same and `existing: id | null`, `signon: {host, product, drawn: id | null}`), `administration` (`host`, `from: networkId | null`), `name` (`name`, `to: {row, id, label}`), `pass-on` (`name`, `from`, `to`, `proto`), `host` (`name`, `address`). Keys: `login:<port key>`, `sso:<port key>`, `admin-login:<port key>`, `administration:<host key>`, `name:<name>`, `pass-on:<name>><bearer>`, `host:<name>`.
  - `N.plan(…).connections`; `ticks.connections`; `summary(…).connected`. On each port row: `r.login`, `r.manages`.
  - `env` of `Cn.apply`: `{doc(), add(kind, label): id, link(kind, from, to, extra), flow(value), product(label): id, hostOf: {host key: id}, serviceOf: {port key: id}, appOf: {port key: id}}`.

- [ ] **Step 1: Record the fixture**

Run: `python3 scripts/dev/nuclei-lab.py record connect`
Expected: `wrote N records to …/scripts/fixtures/nuclei/connect.jsonl (v3.11.0)`.

- [ ] **Step 2: Write the failing tests**

Create `scripts/nuclei-connect.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const Nu = require('../assets/js/nuclei.js');
const S = require('../assets/js/scanners.js');
const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');

// How it connects (nuclei templates spec §6): logins, single sign-on,
// management pages and what a name points to. connect.jsonl is what nuclei
// 3.11.0 wrote against the lab of scripts/dev/nuclei-lab.py; it is read
// together with identify.jsonl, as one paste after both were run.
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const fixture = name => fs.readFileSync('scripts/fixtures/nuclei/' + name + '.jsonl', 'utf8');
const lines = () => fixture('connect').trim().split('\n').map(l => JSON.parse(l));
const result = () => Nu.read(fixture('identify') + fixture('connect')).scan;
const STAMP = () => S.stampFor('nuclei', result(), '10.0.2.0/24', '2026-09-28');
const LAB = ['10.0.2.11', '10.0.2.12', '10.0.2.13', '10.0.2.14', '10.0.2.15', '10.0.2.16', '10.0.2.50', '10.0.2.60', '10.0.2.61'];
// The hosts the tests speak of, in that order, whatever else the lab holds.
const few = () => {
  const scan = result();
  scan.hosts = LAB.map(a => scan.hosts.find(h => h.addresses[0] === a));
  return scan;
};
function start() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.2.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.2.2'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a2: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
    a3: { kind: 'hosts', from: 'box', to: 'nmap', privilege: 'user' },
  };
  return d;
}
const all = p => {
  const t = N.defaults(p);
  for (const c of p.connections.list) if (c.can) t.connections[c.key] = true;
  return t;
};
const drawn = (d, t) => {
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  return N.apply(d, p, t ? t(p) : all(p), specOf, STAMP()).doc;
};
const id = (doc, label, kind) => Object.keys(doc.entities).find(k => doc.entities[k].label === label && (!kind || doc.entities[k].kind === kind));
const links = (doc, kind) => Object.values(doc.associations).filter(a => a.kind === kind);
const hostOf = (doc, x) => links(doc, 'hosts').find(a => a.to === x).from;
const accepted = (doc, account) => links(doc, 'authorizes').filter(a => a.from === id(doc, account, 'account')).map(a => doc.entities[a.to].label + ' on ' + doc.entities[hostOf(doc, a.to)].label).sort();

test('the fixture holds every answer of the connect templates that the lab can give', () => {
  const seen = new Set(lines().map(r => r['extractor-name']));
  const asked = T.ANSWERS.filter(a => T.TEMPLATES.find(t => t.id === a.template).group === 'connect').map(a => a.name);
  assert.deepEqual(asked.filter(n => !seen.has(n)), [], 'record again: python3 scripts/dev/nuclei-lab.py record connect');
  for (const r of lines()) assert.match(r['template-id'], /^effractor-(login|points-to)$/);
});

test('what is read: a login, where logins are sent, what a name points to', () => {
  const scan = result();
  const at = (a, n) => scan.hosts.find(h => h.addresses[0] === a).ports.find(p => p.port === n);
  assert.deepEqual(at('10.0.2.11', 443).login, { password: true, sso: null });
  assert.deepEqual(at('10.0.2.12', 443).login, { password: false, sso: { product: 'Keycloak', host: 'sso.corp.example' } });
  assert.deepEqual(at('10.0.2.61', 443).login, { password: false, sso: { product: 'Microsoft Entra ID', host: 'login.microsoftonline.com' } }, 'a link on the page names it as a redirect does');
  assert.equal(at('10.0.2.50', 443).login, undefined);
  assert.deepEqual(scan.points.filter(x => /^(grafana|metrics|wiki|pve1)\./.test(x.name)), [
    { name: 'grafana.corp.example', address: '10.0.2.50', alias: 'proxy.corp.example' },
    { name: 'metrics.corp.example', address: '10.0.2.11', alias: null },
    { name: 'pve1.corp.example', address: '203.0.113.7', alias: 'pve1.cdn.example.net' },
    { name: 'wiki.corp.example', address: '10.0.2.99', alias: null },
  ]);
  // Answers about names alone are a result too: they draw no host.
  const names = Nu.read(written(lines().filter(r => r.type === 'dns'))).scan;
  assert.deepEqual([names.hosts.length, names.points.length > 0], [0, true]);
});
const written = list => list.map(r => JSON.stringify(r)).join('\n') + '\n';

test('spec §6: every connection is offered unticked, but a name on the host it points to', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  assert.deepEqual(p.connections.list.map(c => [c.key, c.ticked, c.can, c.line, c.what]), [
    ['login:h0/tcp/443', false, true, 'Grafana on grafana.corp.example has a login', 'draws “Grafana accounts”, which it accepts'],
    ['sso:h1/tcp/443', false, true, 'https on wiki.corp.example sends its logins to Keycloak at sso.corp.example', 'draws “Keycloak accounts at sso.corp.example” and the host sso.corp.example'],
    ['administration:h2', false, true, 'Proxmox VE on pve1.corp.example is a management page', '“pve1.corp.example” is administered from “Lab network”'],
    ['admin-login:h2/tcp/8006', false, true, 'Proxmox VE on pve1.corp.example has a login', 'draws “Proxmox VE accounts”, admin on “pve1.corp.example”'],
    ['administration:h3', false, true, 'pfSense on fw.corp.example is a management page', '“fw.corp.example” is administered from “Lab network”'],
    ['admin-login:h3/tcp/443', false, true, 'pfSense on fw.corp.example has a login', 'draws “pfSense accounts”, admin on “fw.corp.example”'],
    ['login:h4/tcp/8080', false, true, 'Jenkins on 10.0.2.15 has a login', 'draws “Jenkins accounts”, which it accepts'],
    ['administration:h5', false, true, 'Webmin on 10.0.2.16 is a management page', '“10.0.2.16” is administered from “Lab network”'],
    ['admin-login:h5/tcp/10000', false, true, 'Webmin on 10.0.2.16 has a login', 'draws “Webmin accounts”, admin on “10.0.2.16”'],
    ['login:h7/tcp/8080', false, true, 'http-proxy on 10.0.2.60 has a login', 'draws “accounts of http-proxy on 10.0.2.60”, which it accepts'],
    ['sso:h8/tcp/443', false, true, 'https on portal.corp.example sends its logins to Microsoft Entra ID at login.microsoftonline.com', 'draws “Microsoft Entra ID accounts at login.microsoftonline.com” and the host login.microsoftonline.com'],
    ['name:grafana.corp.example', true, true, 'grafana.corp.example points to “proxy.corp.example” (10.0.2.50)', 'keeps the name on it'],
    ['pass-on:grafana.corp.example>h0', false, true, '“proxy.corp.example” stands in front of “grafana.corp.example” for grafana.corp.example?', 'draws the flow from it to grafana.corp.example on tcp/443'],
    ['host:wiki.corp.example', false, true, 'wiki.corp.example points to 10.0.2.99, which is not drawn', 'draws the host'],
  ]);
  assert.deepEqual(p.connections.notes, ['pve1.corp.example points outside, to pve1.cdn.example.net.']);
  const t = N.defaults(p);
  assert.deepEqual(Object.keys(t.connections).filter(k => t.connections[k]), ['name:grafana.corp.example']);
  // As offered: no account, no administration, no flow between hosts; the name is kept.
  const out = N.apply(d, p, t, specOf, STAMP()).doc;
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'account').length, 0);
  assert.equal(links(out, 'administration').length + links(out, 'authorizes').length + links(out, 'grants').length, 0);
  assert.deepEqual(out.entities[id(out, 'proxy.corp.example')].names, ['proxy.corp.example', 'grafana.corp.example']);
  assert.match(N.said(N.summary(d, p, t, null)), /, draws 1 connection\.$/);
});

test('spec §6.1: a login is a stand-in account the service accepts', () => {
  const out = drawn(start());
  assert.deepEqual(accepted(out, 'Grafana accounts'), ['Grafana on grafana.corp.example'], 'the application logs in, not the server in front of it');
  assert.deepEqual(accepted(out, 'Jenkins accounts'), ['Jenkins on 10.0.2.15']);
  assert.deepEqual(accepted(out, 'accounts of http-proxy on 10.0.2.60'), ['http-proxy on 10.0.2.60']);
  const account = out.entities[id(out, 'Grafana accounts')];
  assert.equal(account.kind, 'account');
  assert.equal(links(out, 'authenticates').length, 0, 'no credential: who logs in is the author\'s to say');
  assert.equal(links(out, 'grants').filter(a => a.from === id(out, 'Grafana accounts')).length, 0);
});

test('spec §6.2: one account per sign-on, accepted by it and by all who send their logins there; its host drawn', () => {
  const out = drawn(start());
  assert.deepEqual(accepted(out, 'Keycloak accounts at sso.corp.example'), ['https on sso.corp.example', 'https on wiki.corp.example']);
  const sso = out.entities[id(out, 'sso.corp.example', 'host')];
  assert.deepEqual([sso.addresses, sso.names], [undefined, ['sso.corp.example']], 'by its name, without an address: nothing was asked of it');
  const service = links(out, 'hosts').find(a => a.from === id(out, 'sso.corp.example', 'host')).to;
  assert.equal(out.entities[links(out, 'instance-of').find(a => a.from === service).to].label, 'Keycloak');
  assert.deepEqual(accepted(out, 'Microsoft Entra ID accounts at login.microsoftonline.com'), ['https on login.microsoftonline.com', 'https on portal.corp.example'], 'a sign-on outside is drawn the same way');
  assert.equal(id(out, 'accounts of https on wiki.corp.example'), undefined, 'no login of its own where the page holds no password field');

  // A second service of the same sign-on joins the account that is there.
  const scan = few();
  const wiki = scan.hosts.find(h => h.addresses[0] === '10.0.2.12');
  const other = JSON.parse(JSON.stringify(wiki));
  other.addresses = ['10.0.2.77'];
  other.names = [];
  scan.hosts = [other];
  scan.points = [];
  const p = N.plan(out, 'nuclei', scan, '10.0.2.0/24', {});
  assert.deepEqual(p.connections.list.map(c => [c.key, c.what]), [['sso:h0/tcp/443', 'joins “Keycloak accounts at sso.corp.example”']]);
  const more = N.apply(out, p, all(p), specOf, STAMP()).doc;
  assert.deepEqual(accepted(more, 'Keycloak accounts at sso.corp.example'), ['https on 10.0.2.77', 'https on sso.corp.example', 'https on wiki.corp.example']);
  assert.equal(Object.values(more.entities).filter(e => e.label === 'sso.corp.example').length, 1);
  assert.equal(Object.values(more.entities).filter(e => e.label === 'Keycloak accounts at sso.corp.example').length, 1);
});

test('spec §6.3: a management page is administered from the scanner\'s network; its login has admin rights there', () => {
  const out = drawn(start());
  const pve = id(out, 'pve1.corp.example', 'host');
  assert.deepEqual(links(out, 'administration').map(a => [a.from, out.entities[a.to].label]), [['lan', 'pve1.corp.example'], ['lan', 'fw.corp.example'], ['lan', '10.0.2.16']]);
  assert.deepEqual(links(out, 'grants').filter(a => a.from === id(out, 'Proxmox VE accounts')).map(a => [a.to, a.privilege]), [[pve, 'admin']]);
  assert.deepEqual(accepted(out, 'pfSense accounts'), ['pfSense on fw.corp.example']);
  assert.equal(id(out, 'Proxmox VE accounts on pve1.corp.example'), undefined);
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'account' && /Proxmox/.test(e.label)).length, 1, 'it replaces the plain login of that service');

  // On a host that runs a router, the router is what is administered.
  const d = start();
  d.entities.fw = { kind: 'host', label: 'Firewall box', addresses: ['10.0.2.14'] };
  d.entities.rt = { kind: 'router', label: 'Firewall box router' };
  d.associations.r1 = { kind: 'hosts', from: 'fw', to: 'rt', privilege: 'admin' };
  d.associations.r2 = { kind: 'attached', from: 'fw', to: 'lan' };
  d.associations.r3 = { kind: 'attached', from: 'rt', to: 'lan' };
  const routed = drawn(d);
  assert.ok(links(routed, 'administration').some(a => a.from === 'lan' && a.to === 'rt'));
  assert.deepEqual(links(routed, 'grants').filter(a => a.from === id(routed, 'pfSense accounts')).map(a => [a.to, a.privilege]), [['rt', 'admin']]);

  // nuclei on no host: said, and not to be ticked.
  const nowhere = start();
  delete nowhere.associations.a2;
  const p = N.plan(nowhere, 'nuclei', few(), '10.0.2.0/24', {});
  const row = p.connections.list.find(c => c.key === 'administration:h2');
  assert.deepEqual([row.can, row.why], [false, 'Put nuclei on a host to say where from']);
  const t = all(p);
  t.connections[row.key] = true;
  assert.equal(links(N.apply(nowhere, p, t, specOf, STAMP()).doc, 'administration').length, 0);
});

test('spec §6.4: a name is kept on the host it points to; who stands in front is offered; outside is only said', () => {
  const out = drawn(start());
  const proxy = id(out, 'proxy.corp.example', 'host'), web = id(out, 'grafana.corp.example', 'host');
  assert.deepEqual(out.entities[proxy].names, ['proxy.corp.example', 'grafana.corp.example']);
  assert.deepEqual(out.entities[web].names, ['grafana.corp.example', 'metrics.corp.example'], 'the bearer keeps it too');
  const pass = Object.values(out.flows).find(f => f.protocol === 'tcp/443' && out.entities[f.source].kind === 'service');
  assert.deepEqual([hostOf(out, pass.source), hostOf(out, pass.target), pass.route, pass.label], [proxy, web, ['lan'], 'https on grafana.corp.example behind proxy.corp.example']);
  const fresh = out.entities[id(out, '10.0.2.99', 'host')];
  assert.deepEqual([fresh.addresses, fresh.names], [['10.0.2.99'], ['wiki.corp.example']]);
  assert.equal(Object.values(out.entities).some(e => (e.addresses || []).includes('203.0.113.7') || /cdn\.example\.net/.test(e.label)), false, 'what is outside is never drawn');
});

test('review focus 5: again, nothing is offered and nothing drawn twice', () => {
  const out = drawn(start());
  const again = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  assert.deepEqual(again.connections.list, []);
  assert.deepEqual(again.connections.notes, ['pve1.corp.example points outside, to pve1.cdn.example.net.']);
  assert.equal(N.apply(out, again, all(again), specOf, STAMP()), null);
  // A service that already accepts an account of the author's is offered no login.
  const d = start();
  const first = drawn(d, p => N.defaults(p));
  const grafana = id(first, 'Grafana', 'service');
  first.entities.alice = { kind: 'account', label: 'Alice' };
  first.associations.z1 = { kind: 'authorizes', from: 'alice', to: grafana };
  const p = N.plan(first, 'nuclei', few(), '10.0.2.0/24', {});
  assert.equal(p.connections.list.some(c => c.key === 'login:h0/tcp/443'), false);
});

test('a connection whose port is left out is left out; another scanner\'s result offers none', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const t = all(p);
  N.tickHost(p.hosts[0], t, false);
  const out = N.apply(d, p, t, specOf, STAMP()).doc;
  assert.equal(id(out, 'Grafana accounts'), undefined);
  assert.equal(id(out, 'grafana.corp.example', 'host'), undefined);
  const scan = few();
  scan.tool = 'nmap';
  assert.deepEqual(N.plan(d, 'nuclei', scan, '10.0.2.0/24', {}).connections, { list: [], notes: [] });
});

test('the imported document is the one the Rust and wasm checks validate', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', result(), '10.0.2.0/24', {});
  const out = N.apply(d, p, all(p), specOf, STAMP()).doc;
  const file = 'scripts/fixtures/nuclei/imported-connect.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test scripts/nuclei-connect.test.js`
Expected: FAIL: `p.connections` is undefined.

- [ ] **Step 4: Write the module**

Create `assets/js/nmap-connect.js`:

```js
// How what is drawn connects (nuclei templates spec §6): logins, single
// sign-on, management pages and what a name points to, planned against
// the document as rows to tick and applied with the import. Every row is
// unticked at first but a name kept on the host it points to, which was
// seen. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
  var T = node ? require("./nuclei-templates.js") : window.effractorNucleiTemplates;
  var has = R.has;

  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  function linked(doc, kind, from, to) {
    return links(doc, kind).some(function (a) { return a.from === from && a.to === to; });
  }
  function labelOf(doc, id) {
    return doc.entities[id] ? doc.entities[id].label : id;
  }
  function productOf(doc, service) {
    var a = links(doc, "instance-of").filter(function (x) { return x.from === service; })[0];
    return a && doc.entities[a.to] ? a.to : null;
  }
  // The router a host runs, which is what is administered then.
  function routerOn(doc, host) {
    var a = links(doc, "hosts").filter(function (x) { return x.from === host && doc.entities[x.to] && doc.entities[x.to].kind === "router"; })[0];
    return a ? a.to : null;
  }
  function attached(doc, machine) {
    return links(doc, "attached").filter(function (a) { return a.from === machine; }).map(function (a) { return a.to; });
  }
  // The service a flow reaches on a host at a port, as the plan knows it.
  function serviceAt(doc, host, proto) {
    var hosted = Object.create(null), found = null;
    links(doc, "hosts").forEach(function (a) {
      if (a.from === host && doc.entities[a.to] && doc.entities[a.to].kind === "service") hosted[a.to] = true;
    });
    Object.keys(doc.flows || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (!found && f.protocol === proto && hosted[f.target] === true) found = f.target;
    });
    return found;
  }
  function accountNamed(doc, label) {
    var want = label.toLowerCase();
    return Object.keys(doc.entities || {}).filter(function (id) {
      return doc.entities[id].kind === "account" && String(doc.entities[id].label).toLowerCase() === want;
    })[0] || null;
  }
  // The drawn host a name is: by its label, or by a name it keeps.
  function hostNamed(doc, name) {
    var found = Object.keys(doc.entities || {}).filter(function (id) {
      var e = doc.entities[id];
      return e.kind === "host" && (String(e.label).trim().toLowerCase() === name || (e.names || []).indexOf(name) >= 0);
    });
    return found.length === 1 ? found[0] : null;
  }
  // Whether a product is a management page (spec §6.3), by its name.
  function manages(label) {
    var a = label == null ? null : T.application(P.parts(label).name);
    return !!a && !!a.manages;
  }

  // `hosts`: the plan's host rows; `scanOf`: each row's scanned host;
  // `appHost`: the host the scanner runs on. Returns {list, notes}; every
  // item {key, kind, line, what, ticked, can, why?, …}.
  function plan(doc, scan, hosts, scanOf, appHost) {
    var out = { list: [], notes: [] };
    if (scan.tool !== "nuclei") return out;
    function item(x) {
      if (!out.list.some(function (o) { return o.key === x.key; })) out.list.push(Object.assign({ ticked: false, can: true }, x));
    }
    var nets = appHost ? attached(doc, appHost) : [];
    var byAddress = Object.create(null);
    Object.keys(doc.entities || {}).forEach(function (id) {
      if (doc.entities[id].kind !== "host") return;
      (doc.entities[id].addresses || []).forEach(function (a) { byAddress[Ad.addressKey(a)] = byAddress[Ad.addressKey(a)] || id; });
    });

    hosts.forEach(function (h) {
      var target = h.known || h.merged;
      var administered = false;
      h.ports.forEach(function (r) {
        // What logs in is the application where there is one.
        var on = r.application ? "application" : "service";
        var service = on === "application" ? r.application.known : r.known;
        var product = on === "application" ? r.application.product.label : r.product.identified ? r.product.label : null;
        var drawn = service ? productOf(doc, service) : null;
        // What logs in, by its name: the application, else the port.
        var known = on === "application" ? r.application.label : product ? (T.application(P.parts(product).name) || {}).product || null : null;
        if (!known && drawn) known = (T.application(P.parts(doc.entities[drawn].label).name) || {}).product || null;
        var named = known || r.label;
        var accounts = known ? known + " accounts" : "accounts of " + r.label + " on " + h.label;
        var accepted = service ? links(doc, "authorizes").filter(function (a) { return a.to === service; }).length > 0 : false;
        var page = r.manages || manages(product) || (drawn ? manages(doc.entities[drawn].label) : false);
        var where = { host: h.key, port: r.key, on: on };

        if (page) {
          if (!administered) {
            administered = true;
            var machine = target ? routerOn(doc, target) || target : null;
            var from = nets.filter(function (n) {
              return (doc.entities[n].addresses || []).some(function (c) { return h.addresses.some(function (a) { return Ad.inCidr(a, c); }); });
            })[0] || nets[0] || null;
            if (!(machine && from && linked(doc, "administration", from, machine))) {
              item({ key: "administration:" + h.key, kind: "administration", host: h.key, from: from, can: !!from, why: from ? null : appHost ? "Attach “" + labelOf(doc, appHost) + "” to a network to say where from" : "Put nuclei on a host to say where from", line: named + " on " + h.label + " is a management page", what: from ? "“" + h.label + "” is administered from “" + labelOf(doc, from) + "”" : "administered from the scanner's network" });
            }
          }
          if (!accepted && r.login) item(Object.assign({ key: "admin-login:" + r.key, kind: "admin-login", account: accounts, line: named + " on " + h.label + " has a login", what: "draws “" + accounts + "”, admin on “" + h.label + "”" }, where));
          return;
        }
        if (!r.login) return;
        if (r.login.sso) {
          var sso = r.login.sso;
          var label = (sso.product || "Sign-on") + " accounts at " + sso.host;
          var account = accountNamed(doc, label);
          if (!(account && service && linked(doc, "authorizes", account, service))) {
            var there = hostNamed(doc, sso.host);
            item(Object.assign({ key: "sso:" + r.key, kind: "sso", account: label, existing: account, signon: { host: sso.host, product: sso.product, drawn: there }, line: named + " on " + h.label + " sends its logins to " + (sso.product ? sso.product + " at " : "") + sso.host, what: (account ? "joins “" : "draws “") + label + "”" + (there || account ? "" : " and the host " + sso.host) }, where));
          }
          if (!r.login.password) return;
        }
        if (!accepted) item(Object.assign({ key: "login:" + r.key, kind: "login", account: accounts, line: named + " on " + h.label + " has a login", what: "draws “" + accounts + "”, which it accepts" }, where));
      });
    });

    // ---- what a name points to (spec §6.4) ----
    var inside = Object.keys(doc.entities || {}).filter(function (id) { return doc.entities[id].kind === "network"; });
    function ours(address) {
      return Ad.isPrivate(address) || inside.some(function (n) {
        return (doc.entities[n].addresses || []).some(function (c) { return Ad.inCidr(address, c); });
      });
    }
    (scan.points || []).forEach(function (x) {
      if (!x.address) return out.notes.push(x.name + " points " + (x.alias ? "to " + x.alias + ", which has no address here." : "nowhere."));
      // Who bears it: a row of this result, or a drawn host that keeps it.
      var bearers = [];
      hosts.forEach(function (h) {
        var keeps = h.names.indexOf(x.name) >= 0 || ((h.known || h.merged) && (doc.entities[h.known || h.merged].names || []).indexOf(x.name) >= 0);
        if (keeps) bearers.push({ row: h.key, id: h.known || h.merged || null, label: h.label, port: (scanOf[h.key].names.filter(function (n) { return String(n.name).toLowerCase() === x.name && n.port; })[0] || {}).port || null });
      });
      Object.keys(doc.entities || {}).forEach(function (id) {
        var e = doc.entities[id];
        if (e.kind === "host" && (e.names || []).indexOf(x.name) >= 0 && !bearers.some(function (b) { return b.id === id; })) bearers.push({ row: null, id: id, label: e.label, port: null });
      });
      var row = hosts.filter(function (h) { return h.addresses.some(function (a) { return Ad.addressKey(a) === Ad.addressKey(x.address); }); })[0] || null;
      var id = row ? row.known || row.merged || null : byAddress[Ad.addressKey(x.address)] || null;
      var to = row || id ? { row: row ? row.key : null, id: id, label: row ? row.label : labelOf(doc, id) } : null;
      if (to && bearers.some(function (b) { return (b.id && b.id === to.id) || (b.row && b.row === to.row); })) return;
      if (!to) {
        if (!ours(x.address)) return out.notes.push(x.name + " points outside, to " + (x.alias || x.address) + ".");
        return item({ key: "host:" + x.name, kind: "host", name: x.name, address: x.address, line: x.name + " points to " + x.address + ", which is not drawn", what: "draws the host" });
      }
      var kept = to.id ? (doc.entities[to.id].names || []).indexOf(x.name) >= 0 : false;
      if (!kept) item({ key: "name:" + x.name, kind: "name", ticked: true, name: x.name, to: to, line: x.name + " points to “" + to.label + "” (" + x.address + ")", what: "keeps the name on it" });
      bearers.forEach(function (b) {
        var port = b.port || (b.id && serviceAt(doc, b.id, "tcp/443") ? 443 : null);
        if (!port) return;
        var proto = "tcp/" + port;
        var front = to.id ? serviceAt(doc, to.id, proto) : null, behind = b.id ? serviceAt(doc, b.id, proto) : null;
        var drawn = front && behind && Object.keys(doc.flows || {}).some(function (k) { return doc.flows[k].source === front && doc.flows[k].target === behind; });
        if (drawn) return;
        item({ key: "pass-on:" + x.name + ">" + (b.id || b.row), kind: "pass-on", name: x.name, from: to, to: b, proto: proto, line: "“" + to.label + "” stands in front of “" + b.label + "” for " + x.name + "?", what: "draws the flow from it to " + b.label + " on " + proto });
      });
    });
    return out;
  }

  function defaults(p) {
    var t = {};
    ((p && p.list) || []).forEach(function (c) { t[c.key] = c.ticked && c.can; });
    return t;
  }
  function ticked(p, ticks) {
    return ((p && p.list) || []).filter(function (c) { return c.can && ticks && ticks[c.key] === true; });
  }
  // What the ticked rows add at most: {entities, relationships, accounts,
  // hosts, links}.
  function count(p, ticks) {
    var s = { entities: 0, relationships: 0, accounts: 0, hosts: 0, links: 0 };
    ticked(p, ticks).forEach(function (c) {
      if (c.kind === "login" || c.kind === "admin-login") {
        s.accounts++;
        s.entities++;
        s.relationships += c.kind === "login" ? 1 : 2;
      } else if (c.kind === "sso") {
        if (!c.existing) {
          s.accounts++;
          s.entities++;
        }
        s.relationships += 2;
        if (!c.signon.drawn && !c.existing) {
          s.hosts++;
          s.entities += 3; // host, service, product
          s.relationships += 2;
        }
      } else if (c.kind === "administration") {
        s.links++;
        s.relationships++;
      } else if (c.kind === "pass-on") {
        s.links++;
        s.entities += 2; // at most: a service in front, its product
        s.relationships += 3;
      } else if (c.kind === "host") {
        s.hosts++;
        s.entities++;
      } else if (c.kind === "name") s.links++;
    });
    return s;
  }

  // `env`: {doc(), add(kind, label), link(kind, from, to, extra), flow(value),
  // product(label), hostOf: {row key: host id}, serviceOf: {port key:
  // service id}, appOf: {port key: application's service id}}. A row whose
  // host or port this import did not draw is left out.
  function apply(p, ticks, env) {
    function service(c) {
      return (c.on === "application" ? env.appOf[c.port] : env.serviceOf[c.port]) || null;
    }
    function account(label, existing) {
      var id = existing && env.doc().entities[existing] ? existing : accountNamed(env.doc(), label);
      return id || env.add("account", label);
    }
    function accept(id, by) {
      if (!linked(env.doc(), "authorizes", id, by)) env.link("authorizes", id, by);
    }
    function where(x) {
      return x.id && env.doc().entities[x.id] ? x.id : x.row ? env.hostOf[x.row] || null : null;
    }
    // A service on a host at a port, drawn without a name where there is none.
    function serviceOn(host, proto) {
      var found = serviceAt(env.doc(), host, proto);
      if (found) return found;
      var number = Number(proto.split("/")[1]);
      var label = R.portName("tcp", number) || proto;
      var made = env.add("service", label);
      env.link("hosts", host, made, { privilege: "unknown" });
      env.link("instance-of", made, env.add("product", "unidentified " + label + " on " + labelOf(env.doc(), host)));
      return made;
    }
    ticked(p, ticks).forEach(function (c) {
      var doc = env.doc();
      if (c.kind === "login" || c.kind === "admin-login") {
        var s = service(c), host = env.hostOf[c.host];
        if (!s || !host) return;
        var a = account(c.account, null);
        accept(a, s);
        var machine = routerOn(env.doc(), host) || host;
        if (c.kind === "admin-login" && !linked(env.doc(), "grants", a, machine)) env.link("grants", a, machine, { privilege: "admin" });
      } else if (c.kind === "sso") {
        var sent = service(c);
        if (!sent) return;
        var had = c.existing || accountNamed(doc, c.account);
        var id = account(c.account, c.existing);
        accept(id, sent);
        if (had) return;
        // The sign-on itself: its host by name, its service, its product.
        var at = hostNamed(env.doc(), c.signon.host);
        if (!at) {
          at = env.add("host", c.signon.host);
          env.doc().entities[at].names = [c.signon.host];
        }
        var on = serviceAt(env.doc(), at, "tcp/443") || links(env.doc(), "hosts").filter(function (x) {
          return x.from === at && env.doc().entities[x.to].kind === "service" && c.signon.product && productOf(env.doc(), x.to) && P.parts(env.doc().entities[productOf(env.doc(), x.to)].label).name === c.signon.product.toLowerCase();
        }).map(function (x) { return x.to; })[0];
        if (!on) {
          on = env.add("service", "https");
          env.link("hosts", at, on, { privilege: "unknown" });
          env.link("instance-of", on, c.signon.product ? env.product(c.signon.product) : env.add("product", "unidentified https on " + c.signon.host));
        }
        accept(id, on);
      } else if (c.kind === "administration") {
        var managed = env.hostOf[c.host];
        if (!managed || !c.from || !env.doc().entities[c.from]) return;
        var m = routerOn(env.doc(), managed) || managed;
        if (!linked(env.doc(), "administration", c.from, m)) env.link("administration", c.from, m);
      } else if (c.kind === "name") {
        var keeper = where(c.to);
        if (!keeper) return;
        var e = env.doc().entities[keeper];
        if ((e.names || []).indexOf(c.name) < 0) e.names = (e.names || []).concat([c.name]);
      } else if (c.kind === "host") {
        // Labelled by its address: the name may be another host's label.
        var made = env.add("host", c.address);
        env.doc().entities[made].addresses = [c.address];
        env.doc().entities[made].names = [c.name];
      } else if (c.kind === "pass-on") {
        var front = where(c.from), behind = where(c.to);
        var target = behind ? serviceAt(env.doc(), behind, c.proto) : null;
        if (!front || !target) return;
        var source = serviceOn(front, c.proto);
        var shared = attached(env.doc(), front).filter(function (n) { return attached(env.doc(), behind).indexOf(n) >= 0; });
        env.flow({ label: labelOf(env.doc(), target) + " on " + labelOf(env.doc(), behind) + " behind " + labelOf(env.doc(), front), source: source, target: target, route: shared.length ? [shared[0]] : [], protocol: c.proto });
      }
    });
  }

  var api = { plan: plan, defaults: defaults, ticked: ticked, count: count, apply: apply };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapConnect = api;
})();
```

- [ ] **Step 5: Plan and apply them with the import**

In `assets/js/nuclei-templates.js`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** The application a product is. Find:

```js
  function template(id) {
```

Write in its place:

```js
  // The application of a product's name ("grafana", "proxmox ve"), or null.
  function application(name) {
    var want = String(name == null ? "" : name).trim().toLowerCase();
    return ANSWERS.filter(function (a) { return a.is === "application" && a.product.toLowerCase() === want; })[0] || null;
  }
  function template(id) {
```

**2.** Exported. Find:

```js
answer: answer, text: text,
```

Write in its place:

```js
answer: answer, application: application, text: text,
```

In `assets/js/nmap-plan.js`, 14 edits, in this order. Each *find* stands in the file exactly once.

**1.** The connections. Find:

```js
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
```

Write in its place:

```js
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
  var Cn = node ? require("./nmap-connect.js") : window.effractorNmapConnect;
```

**2.** A row carries its login and whether it manages. Find:

```js
    if (scan.tool !== "nuclei") return;
    var drawn = row.known
```

Write in its place:

```js
    row.login = null;
    row.manages = false;
    if (scan.tool !== "nuclei") return;
    var drawn = row.known
```

**3.** From what nuclei read of the port. Find:

```js
    if (!p.application) return;
    var label = p.application.product
```

Write in its place:

```js
    row.login = p.login || null;
    row.manages = !!p.manages;
    if (!p.application) return;
    var label = p.application.product
```

**4.** Planned with the rest. Find:

```js
      changes: Ch.changes(doc, appId, scan, planned, scanOf, way, appHost),
```

Write in its place:

```js
      changes: Ch.changes(doc, appId, scan, planned, scanOf, way, appHost),
      // How it connects (nuclei templates spec §6).
      connections: Cn.plan(doc, scan, planned, scanOf, appHost),
```

**5.** Their ticks. Find:

```js
    t.changes = {};
```

Write in its place:

```js
    t.connections = Cn.defaults(p.connections);
    t.changes = {};
```

**6.** Counted. Find:

```js
changes: Ch.changesTicked(p, ticks) };
```

Write in its place:

```js
changes: Ch.changesTicked(p, ticks), connected: Cn.count(p.connections, ticks.connections) };
```

**7.** Counted against the limits. Find:

```js
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.routers + s.firewalls + s.services + s.products;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel;
```

Write in its place:

```js
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.routers + s.firewalls + s.services + s.products + s.connected.entities;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel + s.connected.relationships;
```

**8.** Said. Find:

```js
    if (s.changes) more.push("makes " + n(s.changes, "change"));
```

Write in its place:

```js
    if (s.changes) more.push("makes " + n(s.changes, "change"));
    var c = s.connected;
    if (c && c.accounts + c.hosts + c.links) more.push("draws " + [[c.accounts, "account"], [c.hosts, "host"], [c.links, "connection"]].filter(function (x) { return x[0]; }).map(function (x) { return n(x[0], x[1]); }).join(", "));
```

**9.** An import that only connects is an edit. Find:

```js
!s.identified && !s.named && !s.told && !s.moved
```

Write in its place:

```js
!s.identified && !s.named && !s.told && !(s.connected.accounts + s.connected.hosts + s.connected.links) && !s.moved
```

**10.** Which service each port row is, and which its application. Find:

```js
    var flows = [], marks = [], hostOf = {}, passes = [];
```

Write in its place:

```js
    var flows = [], marks = [], hostOf = {}, passes = [], serviceOf = {}, appOf = {};
```

**11.** Known ones. Find:

```js
        var tells = telling(r, ticks);
        // The product a drawn service lacked
```

Write in its place:

```js
        var tells = telling(r, ticks);
        if (r.known && next.entities[r.known]) serviceOf[r.key] = r.known;
        if (r.application && r.application.known && next.entities[r.application.known]) appOf[r.key] = r.application.known;
        // The product a drawn service lacked
```

**12.** New ones. Find:

```js
          if (tells.application) passes.push({ row: r, host: host, label: h.label, server: service });
        }
```

Write in its place:

```js
          if (tells.application) passes.push({ row: r, host: host, label: h.label, server: service });
          serviceOf[r.key] = service;
        }
```

**13.** Applications drawn now. Find:

```js
    passes.forEach(function (x) {
      var made = step(
```

Write in its place:

```js
    passes.forEach(function (x) {
      var made = appOf[x.row.key] = step(
```

**14.** Applied after everything they hang on is drawn. Find:

```js
    Ch.applyChangesAfter(p, ticks, env, way.routes, flowOf, ends);
```

Write in its place:

```js
    Cn.apply(p.connections, ticks.connections, {
      doc: function () { return next; },
      add: env.add,
      link: link,
      flow: function (value) { step(L.putFlow(next, null, value)); },
      product: function (label) { return productFor(label, null); },
      hostOf: hostOf,
      serviceOf: serviceOf,
      appOf: appOf,
    });
    Ch.applyChangesAfter(p, ticks, env, way.routes, flowOf, ends);
```

In `crates/effractor-server/templates/shell.html`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** The plan needs the connections, which need the table of answers. Find:

```html
<script src="{{ asset_prefix }}assets/js/nmap-plan.js" defer></script>
```

Write in its place:

```html
<script src="{{ asset_prefix }}assets/js/nuclei-command.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nuclei-templates.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nmap-connect.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nmap-plan.js" defer></script>
```

**2.** Loaded above now. Find:

```html
<script src="{{ asset_prefix }}assets/js/greenbone.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nuclei-command.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nuclei-templates.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nuclei.js" defer></script>
```

Write in its place:

```html
<script src="{{ asset_prefix }}assets/js/greenbone.js" defer></script>
<script src="{{ asset_prefix }}assets/js/nuclei.js" defer></script>
```

In `crates/effractor-server/src/shell.rs`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** Its order. Find:

```rust
            "nmap-changes.js",
            "nmap-plan.js",
```

Write in its place:

```rust
            "nmap-changes.js",
            "nuclei-command.js",
            "nuclei-templates.js",
            "nmap-connect.js",
            "nmap-plan.js",
```

**2.** The connections between the table and the plan. Find:

```rust
        assert!(at("nuclei-templates.js") < at("nuclei.js"));
```

Write in its place:

```rust
        assert!(at("nuclei-templates.js") < at("nuclei.js"));
        assert!(at("nuclei-templates.js") < at("nmap-connect.js"));
        assert!(at("nmap-connect.js") < at("nmap-plan.js"));
```

- [ ] **Step 6: Write the pinned document and run the tests**

Run: `NMAP_FIXTURE=write node --test scripts/nuclei-connect.test.js && npm test && cargo test -p effractor-server shell`
Expected: PASS. No other pinned document moves: another scanner's result offers no connection.

- [ ] **Step 7: Commit**

```bash
git add assets/js/nmap-connect.js assets/js/nuclei-templates.js assets/js/nmap-plan.js scripts/nuclei-connect.test.js scripts/fixtures/nuclei/connect.jsonl scripts/fixtures/nuclei/imported-connect.doc.json crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs
git commit -m "How it connects: logins, sign-ons, management pages and where names point, offered and drawn"
```

### Task 11: The connected document is pinned, and part 4 lands

**Files:**
- Modify: `crates/effractor-format/tests/json.rs`, `scripts/check-nmap-wasm.js:26`
- Test: `scripts/nuclei-templates.test.js`

**Interfaces:**
- Consumes: `scripts/fixtures/nuclei/identify.jsonl`, `connect.jsonl`, `imported-connect.doc.json`.
- Produces: nothing new.

- [ ] **Step 1: Hold that nuclei found every answer**

Add to `scripts/nuclei-templates.test.js`:

```js
// CI has no nuclei: that nuclei accepts the templates and finds with them
// what the table says is proved by the fixtures, which nuclei wrote.
test('spec §2.1: every named extractor has a record in the fixtures, and nuclei\'s version is said', () => {
  const records = ['identify', 'connect'].flatMap(g => fs.readFileSync('scripts/fixtures/nuclei/' + g + '.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l)));
  const seen = new Set(records.map(r => r['extractor-name']));
  assert.deepEqual(T.ANSWERS.map(a => a.name).filter(n => !seen.has(n)), []);
  for (const r of records) {
    assert.equal(T.answer(r['extractor-name']).template, r['template-id']);
    assert.doesNotMatch(JSON.stringify(r), /127\.0\.0\.1|\/home\/(?!user\/)/, 'the lab\'s addresses, no machine\'s own');
  }
  assert.match(fs.readFileSync('docs/HANDOFF.md', 'utf8'), /nuclei 3\.11\.0/);
});
```

- [ ] **Step 2: Run it**

Run: `node --test scripts/nuclei-templates.test.js`
Expected: PASS.

- [ ] **Step 3: Pin the document in Rust and in wasm**

In `crates/effractor-format/tests/json.rs`, after `the_nuclei_identify_fixture_is_a_valid_architecture`:

```rust
/// And how it connects (spec §6): accounts, administration, flows between
/// hosts.
#[test]
fn the_nuclei_connect_fixture_is_a_valid_architecture() {
    let text = fixture_is_valid("nuclei", "imported-connect.doc.json");
    assert!(
        text.contains("label: Keycloak accounts at sso.corp.example"),
        "{text}"
    );
    assert!(text.contains("kind: administration"), "{text}");
    assert!(text.contains("kind: authorizes"), "{text}");
}
```

`fixture_is_valid` asks every pinned document for `tool: nmap`; the test's drawing has an nmap beside nuclei for that.

In `scripts/check-nmap-wasm.js`, add `'nuclei/imported-connect.doc.json'` to `others`.

Run: `cargo test -p effractor-format --test json nuclei && scripts/build-wasm.sh && node scripts/check-nmap-wasm.js`
Expected: PASS.

- [ ] **Step 4: Commit and land part 4**

```bash
npm test && cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && node scripts/check-roadmap.js
git add scripts/nuclei-templates.test.js crates/effractor-format/tests/json.rs scripts/check-nmap-wasm.js
git commit -m "The connected document is pinned by Node, Rust and wasm"
scripts/dev/ship.sh "How it connects: accounts, administration and what names point to" "$SCRATCH/pr-connect.md" "$SCRATCH/commit-connect.txt"
```

---

# Part 5 — the dialog (branch `nuclei-dialog`)

Everything in this part is seen. Nothing of it lands before the owner has looked at it in a preview and said so.

### Task 12: The two recipes, their command, and Adjust

**Files:**
- Modify: `assets/js/nuclei.js` (`RECIPES`, `combine`, `command`, `offered`)
- Modify: `assets/js/nmap-ui.js` (`asked`, `recipes`, `blocks`, `showCommand`, `copies`)
- Modify: `crates/effractor-server/templates/shell.html`, `crates/effractor-server/src/shell.rs`, `assets/css/60-architecture.css`
- Modify: `scripts/nuclei-command.test.js:19`
- Test: `scripts/nuclei-templates.test.js`

**Interfaces:**
- Consumes: `T.command`, `T.ADJUST` (Task 5); `C.RECIPES`, `C.BLOCKS`, `C.DEFAULTS`, `C.combine`, `C.command`.
- Produces on `window.effractorNuclei` (what the dialog's `library()` reads as `L.of`):
  - `Nu.RECIPES` — two recipes `{id: "identify" | "connect", ours: true, name, finds, time, tags: []}`, then nuclei's own, unchanged.
  - `Nu.combine(recipeIds, adjust)` — effractor's go together and with nothing of nuclei's (`{problem}`); their `choices` hold what was asked only for the blocks of `T.ADJUST`.
  - `Nu.command(recipeIds, adjust, range, extra)` — `extra.doc` is the drawing; for effractor's recipes the answer of `T.command` (`text`, `shown`, `said`).
  - `Nu.offered(recipeIds): string[]` — the ids of the blocks Adjust shows.
  - In the page: `#nmap-asks` (what the command asks), `#nmap-whole` (Show all · Show less).

- [ ] **Step 1: Write the failing tests**

Add to `scripts/nuclei-templates.test.js`:

```js
// ---- the dialog's view of them (nuclei templates spec §10) ----
const Nu = require('../assets/js/nuclei.js');
const Own = require('../assets/js/nuclei-command.js');

test('spec §10: two recipes of effractor\'s own before nuclei\'s, apart from them', () => {
  assert.deepEqual(Nu.RECIPES.slice(0, 2).map(r => [r.id, r.ours, r.name, r.time]), [['identify', true, 'What is there', 'seconds per host'], ['connect', true, 'How it connects', 'seconds per host']]);
  assert.deepEqual(Nu.RECIPES.slice(2), Own.RECIPES);
  assert.deepEqual(Own.RECIPES.filter(r => r.ours), [], 'nuclei\'s own library is as it was');
  for (const r of Nu.RECIPES.slice(0, 2)) assert.ok(r.finds.length < 100 && !r.alone && !r.warning);
  // The two go together, and with nothing of nuclei's.
  assert.deepEqual(Nu.combine(['identify', 'connect'], {}).recipes.map(r => r.id), ['identify', 'connect']);
  assert.equal(Nu.combine(['identify', 'cves'], {}).problem, 'effractor\'s templates and nuclei\'s checks are run one after the other; untick one of the two.');
  assert.equal(Nu.command(['connect', 'all'], {}, '10.0.1.0/24', { doc: drawing() }).problem, Nu.combine(['identify', 'cves'], {}).problem);
  assert.deepEqual(Nu.combine(['cves'], {}), Own.combine(['cves'], {}));
  assert.deepEqual(Nu.command(['cves'], { speed: 'gentle' }, '10.0.1.0/24', { doc: drawing() }), Own.command(['cves'], { speed: 'gentle' }, '10.0.1.0/24', {}));
});

test('spec §10: Adjust offers what applies, and nothing else reaches the command', () => {
  assert.deepEqual(Nu.offered(['identify']), ['addresses', 'speed', 'patience', 'errors']);
  assert.deepEqual(Nu.offered(['cves']), Own.BLOCKS.map(b => b.id));
  const c = Nu.combine(['identify'], { speed: 'gentle', severity: 'high', browser: 'on', oast: 'own', code: 'on', nope: 'x' });
  assert.equal(c.choices.speed, 'gentle');
  for (const b of Own.BLOCKS) if (!T.ADJUST.includes(b.id)) assert.equal(c.choices[b.id], Own.DEFAULTS[b.id], b.id);
  const text = Nu.command(['identify'], { speed: 'gentle', severity: 'high', browser: 'on', code: 'on' }, '10.0.1.0/24', { doc: drawing() }).text;
  assert.match(text, / -rate-limit 20 -concurrency 5 /);
  assert.doesNotMatch(text, /-severity|-headless|-code|-interactsh-server/);
  assert.deepEqual(Nu.command(['identify'], {}, '10.0.1.0/24', { doc: drawing() }), T.command(['identify'], {}, '10.0.1.0/24', drawing()));
});
```

In `scripts/nuclei-command.test.js`, 1 edit, in this order. Each *find* stands in the file exactly once.

**1.** Nuclei.js has nuclei's recipes after effractor's two. Find:

```js
  assert.equal(Nu.RECIPES, C.RECIPES, 'nuclei.js has every name of the commands');
```

Write in its place:

```js
  assert.deepEqual(Nu.RECIPES.filter(r => !r.ours), C.RECIPES, 'nuclei.js has every name of the commands, after effractor\'s two');
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/nuclei-templates.test.js scripts/nuclei-command.test.js`
Expected: the two new tests FAIL (`Nu.offered is not a function`; `Nu.RECIPES` begins with nuclei's own).

- [ ] **Step 3: The recipes and their command**

In `assets/js/nuclei.js`, 1 edit, in this order. Each *find* stands in the file exactly once.

**1.** Effractor's templates as two recipes before nuclei's. Find:

```js
  var api = {};
  Object.keys(C).forEach(function (k) { api[k] = C[k]; });
```

Write in its place:

```js
  // ---- effractor's templates beside nuclei's checks (spec §10) ----

  var OURS = [
    { id: "identify", ours: true, name: "What is there", finds: "What answers on each port, which web application, which names a certificate bears.", time: "seconds per host", tags: [] },
    { id: "connect", ours: true, name: "How it connects", finds: "Logins, single sign-on, management pages, where names point.", time: "seconds per host", tags: [] },
  ];
  var APART = "effractor's templates and nuclei's checks are run one after the other; untick one of the two.";
  function own(ids) {
    return (ids || []).filter(function (id) { return OURS.some(function (r) { return r.id === id; }); });
  }
  // The blocks of Adjust that are offered with what is ticked.
  function offered(recipeIds) {
    return own(recipeIds).length ? T.ADJUST.slice() : C.BLOCKS.map(function (b) { return b.id; });
  }
  function combine(recipeIds, adjust) {
    var ours = own(recipeIds);
    if (!ours.length) return C.combine(recipeIds, adjust);
    if (ours.length < (recipeIds || []).length) return { problem: APART };
    var ch = {};
    C.BLOCKS.forEach(function (b) {
      var asked = adjust && R.has(adjust, b.id) ? adjust[b.id] : null;
      ch[b.id] = T.ADJUST.indexOf(b.id) >= 0 && b.choices.some(function (c) { return c.id === asked; }) ? asked : C.DEFAULTS[b.id];
    });
    return { choices: ch, recipes: OURS.filter(function (r) { return ours.indexOf(r.id) >= 0; }), notes: [] };
  }
  // `extra.doc`: the drawing, which effractor's templates take their
  // targets from.
  function command(recipeIds, adjust, range, extra) {
    var ours = own(recipeIds);
    if (!ours.length) return C.command(recipeIds, adjust, range, extra);
    var c = combine(recipeIds, adjust);
    if (c.problem) return { problem: c.problem };
    return T.command(ours, c.choices, range, (extra || {}).doc || { entities: {} });
  }

  var api = {};
  Object.keys(C).forEach(function (k) { api[k] = C[k]; });
  api.RECIPES = OURS.concat(C.RECIPES);
  api.combine = combine;
  api.command = command;
  api.offered = offered;
```

Run: `node --test scripts/nuclei-templates.test.js scripts/nuclei-command.test.js scripts/nuclei.test.js scripts/shell-commands.test.js`
Expected: PASS.

- [ ] **Step 4: The dialog**

In `assets/js/nmap-ui.js`, 8 edits, in this order. Each *find* stands in the file exactly once.

**1.** What is there is ticked at first. Find:

```js
nuclei: { recipes: ["exploited"], adjust: {}, extra: {} } };
```

Write in its place:

```js
nuclei: { recipes: ["identify"], adjust: {}, extra: {} } };
```

**2.** Two groups, each under its heading. Find:

```js
    box.textContent = "";
    L.of.RECIPES.forEach(function (r) {
      var label = el("label", null, "nmap-recipe");
```

Write in its place:

```js
    box.textContent = "";
    function ours(id) {
      return L.of.RECIPES.some(function (o) { return o.id === id && !!o.ours; });
    }
    // Nuclei templates spec §10: effractor's templates set apart from
    // nuclei's checks, each group under its own quiet heading.
    var headed = {};
    function heading(key, text, hint) {
      if (headed[key]) return;
      headed[key] = true;
      var h = el("div", null, "nmap-recipes-head");
      h.appendChild(el("span", text, "label"));
      h.appendChild(el("span", hint, "hint"));
      box.appendChild(h);
    }
    var mixed = L.of.RECIPES.some(function (r) { return r.ours; });
    L.of.RECIPES.forEach(function (r) {
      if (mixed && r.ours) heading("ours", "effractor's templates", "asked of what is drawn · run them first");
      if (mixed && !r.ours) heading("theirs", "nuclei's checks", "findings · a run of their own");
      var label = el("label", null, "nmap-recipe");
```

**3.** The two groups untick each other. Find:

```js
        if (tick.checked) {
          L.asked.recipes = r.alone ? [r.id] : others.filter(function (id) {
```

Write in its place:

```js
        if (tick.checked) {
          // effractor's templates and nuclei's checks untick each other:
          // they are run one after the other.
          var kin = others.filter(function (id) { return ours(id) === !!r.ours; });
          L.asked.recipes = r.alone ? [r.id] : kin.filter(function (id) {
```

**4.** Adjust shows what applies. Find:

```js
      if (b.only && L.asked.recipes.indexOf(b.only) < 0) return;
```

Write in its place:

```js
      if (b.only && L.asked.recipes.indexOf(b.only) < 0) return;
      if (L.of.offered && L.of.offered(L.asked.recipes).indexOf(b.id) < 0) return;
```

**5.** What every tool's command starts from. Find:

```js
  function showCommand() {
    if (at.tool === "masscan") {
```

Write in its place:

```js
  function showCommand() {
    // What Copy copies where it is not what is shown.
    at.command = null;
    $("nmap-asks").textContent = "";
    $("nmap-whole").hidden = true;
    $("nmap-command").classList.remove("is-short", "is-whole");
    if (at.tool === "masscan") {
```

**6.** Shown without the templates' text, copied whole, and saying what it asks. Find:

```js
      var n = Nu.command(asked.nuclei.recipes, asked.nuclei.adjust, $("nmap-range").value, asked.nuclei.extra);
      $("nmap-command").textContent = n.text || "";
```

Write in its place:

```js
      var n = Nu.command(asked.nuclei.recipes, asked.nuclei.adjust, $("nmap-range").value, Object.assign({}, asked.nuclei.extra, { doc: doc() }));
      // effractor's templates (spec §10): the command is shown without the
      // templates' text, copied whole, and says what it asks.
      var whole = !!n.shown && !!at.whole;
      at.command = n.text || null;
      $("nmap-command").textContent = (n.shown && !whole ? n.shown : n.text) || "";
      $("nmap-command").classList.toggle("is-short", !!n.shown && !whole);
      $("nmap-command").classList.toggle("is-whole", whole);
      $("nmap-whole").hidden = !n.shown;
      $("nmap-whole").textContent = whole ? "Show less" : "Show all";
      $("nmap-asks").textContent = n.said || "";
```

**7.** Copy copies the whole command. Find:

```js
        navigator.clipboard.writeText($(code).textContent).then(function () {
```

Write in its place:

```js
        navigator.clipboard.writeText(code === "nmap-command" && at.command ? at.command : $(code).textContent).then(function () {
```

**8.** Show all, Show less. Find:

```js
  copies("nmap-copy-second", "nmap-second");
```

Write in its place:

```js
  copies("nmap-copy-second", "nmap-second");
  $("nmap-whole").addEventListener("click", function () {
    at.whole = !at.whole;
    showCommand();
  });
```

In `crates/effractor-server/templates/shell.html`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** What the command asks, and Show all. Find:

```html
      <div class="nmap-command"><code id="nmap-command"></code><span class="nmap-tag is-root" id="nmap-root" hidden>root</span><button class="btn btn-ghost btn-small" id="nmap-copy" type="button">Copy</button></div>
```

Write in its place:

```html
      <p class="hint" id="nmap-asks"></p>
      <div class="nmap-command"><code id="nmap-command"></code><span class="nmap-tag is-root" id="nmap-root" hidden>root</span><button class="btn btn-ghost btn-small" id="nmap-whole" type="button" hidden>Show all</button><button class="btn btn-ghost btn-small" id="nmap-copy" type="button">Copy</button></div>
```

**2.** Whose templates must be installed. Find:

```html
      <p class="hint">nuclei checks what it is pointed at; nmap before it finds the hosts and ports. Its templates must be installed.</p>
```

Write in its place:

```html
      <p class="hint">effractor's templates come with the command; nuclei's own must be installed. nmap before them finds the hosts and ports.</p>
```

In `crates/effractor-server/src/shell.rs`, 1 edit, in this order. Each *find* stands in the file exactly once.

**1.** The dialog's new parts are there. Find:

```rust
        assert!(html.contains("id=\"nmap-step-nuclei\""));
```

Write in its place:

```rust
        assert!(html.contains("id=\"nmap-step-nuclei\""));
        assert!(html.contains("id=\"nmap-asks\"") && html.contains("id=\"nmap-whole\""));
```

In `assets/css/60-architecture.css`, 2 edits, in this order. Each *find* stands in the file exactly once.

**1.** The headings of the two groups. Find:

```css
.nmap-recipe .hint { grid-column: 2 / -1; }
```

Write in its place:

```css
.nmap-recipe .hint { grid-column: 2 / -1; }
/* effractor's templates apart from nuclei's checks (nuclei templates spec §10). */
.nmap-recipes-head { grid-column: 1 / -1; display: flex; gap: 8px; align-items: baseline; margin-top: 4px; }
.nmap-recipes-head:first-child { margin-top: 0; }
```

**2.** A command shown short is copied, not selected; shown whole it scrolls. Find:

```css
.nmap-command code:empty::after { content: "—"; color: var(--color-fg-muted); }
```

Write in its place:

```css
.nmap-command code:empty::after { content: "—"; color: var(--color-fg-muted); }
/* Shown without the templates' text: copied whole, not by selecting. */
.nmap-command code.is-short { user-select: none; }
.nmap-command code.is-whole { max-height: 14em; overflow: auto; white-space: pre-wrap; }
```

Run: `node --check assets/js/nmap-ui.js && npm test && cargo test -p effractor-server shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/js/nuclei.js assets/js/nmap-ui.js crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs assets/css/60-architecture.css scripts/nuclei-templates.test.js scripts/nuclei-command.test.js
git commit -m "The nuclei dialog offers effractor's templates: what is there, how it connects"
```

### Task 13: The preview says what they found

**Files:**
- Modify: `assets/js/nmap-ui.js` (`preview`, `findings`, new `connections`, `hangs`)

**Interfaces:**
- Consumes: `r.identifies`, `r.differs`, `r.application` (Task 9); `at.plan.connections`, `at.ticks.connections` (Task 10).
- Produces: under a port, ticked rows *names its product …* and *passes on to … · adds it as a service of its own*, and plain lines for what differs; a section *Connections* after the hosts; the connections' notes among the preview's notes.

- [ ] **Step 1: The rows under a port, and the section**

In `assets/js/nmap-ui.js`, 5 edits, in this order. Each *find* stands in the file exactly once.

**1.** What hangs on a new port is offered with it. Find:

```js
            return preview();
          }
          count();
```

Write in its place:

```js
            return preview();
          }
          // What hangs on the port is offered with it (nuclei templates spec §5.4, §6).
          if (!r.known && (r.application || hangs(r.key))) return preview();
          count();
```

**2.** Under a port: the product it lacked, the application behind it, what differs. Find:

```js
    var present = at.ticks.hosts[h.key] && (r.known || at.ticks.ports[r.key]);
    r.findings.forEach(function (f) {
```

Write in its place:

```js
    var present = at.ticks.hosts[h.key] && (r.known || at.ticks.ports[r.key]);
    // Nuclei templates spec §5, §7: the product it lacked, the application
    // behind it, and what differs from the drawing, which is only said.
    function told(group, text, can) {
      var row = check(!!at.ticks[group][r.key], text, function (on) {
        at.ticks[group][r.key] = on;
        count();
      });
      row.querySelector("input").disabled = !can;
      var item = el("li");
      item.appendChild(row);
      list.appendChild(item);
    }
    if (r.identifies) told("identifies", "names its product " + r.identifies.to + (/^unidentified /.test(r.identifies.from) ? "" : " · drawn without a version"), !!at.ticks.hosts[h.key]);
    if (r.differs) list.appendChild(plain(r.differs + " · not changed"));
    if (r.application && !r.application.known) told("applications", "passes on to " + r.application.product.label + " · adds it as a service of its own", !!present);
    if (r.application && r.application.known) list.appendChild(plain("passes on to " + doc().entities[r.application.known].label + " · known"));
    if (r.application && r.application.differs) list.appendChild(plain(r.application.differs + " · not changed"));
    r.findings.forEach(function (f) {
```

**3.** The section, after the hosts it speaks of. Find:

```js
    var notes = [];
    if (at.plan.hosts.some(
```

Write in its place:

```js
    connections(rows);
    var notes = [];
    if (at.plan.hosts.some(
```

**4.** What is only said of names. Find:

```js
    at.plan.changes.notes.forEach(function (n) { notes.push(n); });
```

Write in its place:

```js
    at.plan.changes.notes.forEach(function (n) { notes.push(n); });
    at.plan.connections.notes.forEach(function (n) { notes.push(n); });
```

**5.** The Connections section. Find:

```js
  // Spec §4.3, §4.4: the routers the traces went by that are not scanned
  // hosts themselves, and the networks between hops.
```

Write in its place:

```js
  // Whether a connection hangs on the port: its row is offered with it.
  function hangs(portKey) {
    return at.plan.connections.list.some(function (c) { return c.port === portKey; });
  }
  // Nuclei templates spec §6: how what is drawn connects, in plain words,
  // each with what ticking it draws; unticked at first but a name kept on
  // the host it points to.
  function connections(rows) {
    var cn = at.plan.connections;
    if (!cn.list.length) return;
    var there = {};
    at.plan.hosts.forEach(function (h) {
      h.ports.forEach(function (r) { there[r.key] = !!at.ticks.hosts[h.key] && (!!r.known || !!at.ticks.ports[r.key]); });
    });
    var li = el("li", null, "nmap-host nmap-changes");
    li.appendChild(el("span", "Connections", "label"));
    var list = el("ul", null, "nmap-ports");
    cn.list.forEach(function (c) {
      var row = check(!!at.ticks.connections[c.key], c.line, function (on) {
        at.ticks.connections[c.key] = on;
        count();
      }, { what: c.can ? c.what : c.why });
      // Left out with the host or port it hangs on.
      var hung = (!c.host || !!at.ticks.hosts[c.host]) && (!c.port || there[c.port]);
      row.querySelector("input").disabled = !c.can || !hung;
      var item = el("li");
      item.appendChild(row);
      list.appendChild(item);
    });
    li.appendChild(list);
    rows.appendChild(li);
  }
  // Spec §4.3, §4.4: the routers the traces went by that are not scanned
  // hosts themselves, and the networks between hops.
```

- [ ] **Step 2: Check what can be checked without a browser**

Run: `node --check assets/js/nmap-ui.js && npm test`
Expected: PASS. There is no headless-browser harness, by decision: what the page looks like is looked at (Task 14).

- [ ] **Step 3: Commit**

```bash
git add assets/js/nmap-ui.js
git commit -m "The preview says what effractor's templates found, and offers the connections"
```

### Task 14: The owner looks, the documents are brought up to date, part 5 lands

**Files:**
- Modify: `docs/HANDOFF.md` (a new first section), `ROADMAP.md`
- Delete: `docs/superpowers/specs/2026-09-28-nuclei-templates-design.md`, `docs/superpowers/plans/2026-09-28-nuclei-templates.md`

- [ ] **Step 1: Build and start a preview**

```bash
scripts/build-wasm.sh && cargo build -p effractor-server
target/debug/effractor --bind 127.0.0.1:8081 --accounts "$SCRATCH/preview.db" --data "$SCRATCH/preview-data" --public-url http://localhost:8081
```

Start the lab beside it, so there is something to scan without leaving the machine: `python3 scripts/dev/nuclei-lab.py serve` prints which port on 127.0.0.1 is which lab address.

- [ ] **Step 2: Tell the owner what to look at, in plain words**

> On http://localhost:8081, add nuclei to a host (Add › Application › Scanners › nuclei).
> 1. **Step 1 of the dialog** has two groups now. On top, under *effractor's templates*: *What is there* (ticked) and *How it connects*. Below, under *nuclei's checks*, everything that was there before. Ticking something in one group unticks the other group.
> 2. ***Adjust*** shows four settings while one of ours is ticked, all of them otherwise.
> 3. **Step 2**: above the command a line says what it asks (*12 drawn hosts, 32 usual ports and 5 drawn ones.*). The command is shown short, each template as `echo '… 584 lines …'`; *Show all* shows it whole; *Copy* always copies it whole. The whole command is about 17,000 characters: please paste it into your fish once and say whether that is acceptable.
> 4. With a range that holds nothing drawn, a line says so and that nmap finds hosts faster. *How it connects* alone on a drawing without services says *Nothing drawn to ask yet; run What is there first.*
> 5. **The preview**, after pasting a result: under a port, *names its product vsftpd 3.0.5* and *passes on to Grafana 10.2.3 · adds it as a service of its own* (both ticked); *drawn: … · nuclei: … · not changed* where they differ. Under a host, *keeps the names …*.
> 6. At the end of the preview, **Connections**: logins, sign-ons, management pages, unticked; a name kept on the host it points to, ticked.
> 7. **On the canvas** after adding: server and application in the host's cluster, the application reached from the server; accounts where you ticked them.

Wait for the owner's word on each. Change what they ask, show again. What they decide differently from the spec is written into the hand-off of step 3 with its date.

- [ ] **Step 3: The hand-off**

In `docs/HANDOFF.md`, as the first section after the introduction, write `## Continuation — nuclei templates of effractor's own (2026-09-28)`: that the spec and this plan are deleted with this landing and how to read them from history (`git log --diff-filter=D --format=%h -1 -- docs/superpowers/specs/2026-09-28-nuclei-templates-design.md`, then `git show <that>^:<path>`), that code comments cite them as "nuclei templates spec §…"; one bullet each for: the table and the five templates written from it (`nuclei-templates.js`, `assets/nuclei/`, the rules of §2.1, 49 applications and the three that were struck); the command (targets from the drawing by `awk`, two runs where names are asked, shown short and copied whole); reading (`T.read`, the fold in `nuclei.js`, what is said and what is refused); products (`nmap-products.js`: one comparison for every scanner, a product keeps the label of whoever named it first); applications (two services, the flow of protocol `http`); names on hosts (every scanner's); connections (`nmap-connect.js`, each kind, what is ticked at first); the lab and the fixtures (`scripts/dev/nuclei-lab.py`, **recorded with nuclei 3.11.0**, CI has none); what was probed (spec §12); the owner's decisions with their dates, as in the spec's §1 and as changed in the looks; what the owner looked at and what landed unseen; what is open (a real result of the owner's network; the list of applications).

- [ ] **Step 4: The roadmap, the spec and the plan**

```bash
python3 scripts/dev/roadmap-done.py nuclei-templates
git rm docs/superpowers/specs/2026-09-28-nuclei-templates-design.md docs/superpowers/plans/2026-09-28-nuclei-templates.md
node scripts/check-roadmap.js
```

In `ROADMAP.md`, in `scan-workflow`, the sentence in brackets about `nuclei-templates` becomes: `(effractor's own nuclei templates do so already)`.

- [ ] **Step 5: Land**

```bash
npm test && cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
git add docs/HANDOFF.md ROADMAP.md
git commit -m "nuclei templates: the hand-off; the item, its design and its plan are done"
scripts/dev/ship.sh "The nuclei dialog offers effractor's own templates" "$SCRATCH/pr-dialog.md" "$SCRATCH/commit-dialog.txt"
```

Expected: CI green for that commit, master fast-forwarded, the release run green.
