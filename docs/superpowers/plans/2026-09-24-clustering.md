# Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse architecture components into clusters that are kept in
the file, drawn as one node, opened and closed in place, and ignored by
generation and results.

**Architecture:** A `clusters` map joins the architecture document (Rust
core model, reader, canonical writer, validator); nothing in generation reads
it. In the page, a pure `clusters.js` makes every cluster edit and the
geometry (ring sectors, rectangle hits, in-place positions);
`architecture-view.describe` folds closed clusters into one node each, with
merged lines and permissions; `graph.blocks` lays out open clusters as
blocks; `positions.place` draws open clusters' outlines. Multi-selection
(`state.picked`) lives in `app.js` and the renderer; all cluster actions
are in a new DOM file `cluster-ui.js`.

**Tech Stack:** Rust 2024 (`effractor-core`, `effractor-format`,
`effractor-solver` tests), vanilla JS (IIFE modules, `node --test`), SVG.

**Spec:** `docs/superpowers/specs/2026-09-24-clustering-design.md` (read it
first; section numbers below are its).

## Global Constraints

- Unknown YAML keys are errors, except `x-`; no version bump (the file changes in place).
- `core`/`format` do no I/O; no panics on user input; nothing recurses on user-sized input.
- No frozen fingerprint or snapshot moves (`tests/snapshots/*`, `mc_fingerprint.in`, `dist_fingerprints.in`).
- Vanilla CSS + JS, no bundler, no third-party origins; pure logic under `node --test`, the page checked by the owner's eye (no headless browser).
- Maps keyed by id are prototype-less (`Object.create(null)`) or read with an own-key check.
- UI copy is a few words; no confirm dialogs (destructive edits are undoable and say so via `app.say`); every refusal says why.
- Stage files by name, never `git add -A`; commits are signed (`commit.gpgsign` is on).
- Architecture ids have at least one non-digit (JS reorders integer-like keys).

## Review Focus

1. **Renaming a component's id** (inspector id field) must rename it inside its cluster's `members`, or the file stops validating — test in Task 2 (`renameId`).
2. **Deleting the last-but-one member** (Del, delete of a flow's end, removeAll) must dissolve the cluster in the same edit, not leave a one-member cluster the validator refuses — tests in Task 2.
3. **A pin picked up from a closed cluster** belongs to its member, not to `cluster/<id>`; dropping any pin on a cluster asks which member — Task 6 step on `attacker-pins.js`.
4. **A selected member of a closed cluster** (outline list, ↑↓ walk, a problem link) must light the cluster node and never try to reveal a node that is not drawn — Task 4 (`shown()` in `app.js`).
5. **A document with `clusters` in an old shared link / an x- key inside a cluster** must read and write back unchanged — Task 1 round-trip test carries an `x-note`.

---

### Task 1: Clusters in the file (Rust)

**Files:**
- Modify: `crates/effractor-core/src/id.rs` (new id type), `crates/effractor-core/src/lib.rs` (export)
- Modify: `crates/effractor-core/src/architecture.rs` (`Cluster`, `Architecture::clusters`)
- Modify: `crates/effractor-core/src/architecture_validate.rs` (`clusters()`)
- Modify: `crates/effractor-format/src/architecture_read.rs` (key, `cluster()`, `ONLY_KEYS`)
- Modify: `crates/effractor-format/src/architecture_write.rs` (block after `flows`)
- Test: `crates/effractor-format/tests/architecture.rs`
- Create: `crates/effractor-solver/tests/graph_clusters.rs`
- Modify: `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` §4 (one paragraph naming `clusters`)

**Interfaces:**
- Produces: `effractor_core::ClusterId`; `effractor_core::architecture::Cluster { label: Option<String>, members: Vec<EntityId>, closed: bool }`; `Architecture.clusters: IndexMap<ClusterId, Cluster>`. JSON image: `doc.clusters = {id: {label?, members: [..], closed: bool}}`, absent when empty.

- [ ] **Step 1: Write the failing format tests**

Append to `crates/effractor-format/tests/architecture.rs`:

```rust
fn clustered(image: &mut serde_json::Value) {
    image["clusters"] = serde_json::json!({
        "client-box": {
            "label": "Client box",
            "members": ["workstation", "ssh-client"],
            "closed": true,
            "x-note": "kept"
        },
        "servers": {"members": ["server", "sshd"], "closed": false}
    });
}

#[test]
fn clusters_are_written_after_flows_and_read_back() {
    let mut image = image(LECTURE);
    clustered(&mut image);
    let text = from_document(&image).unwrap();
    assert!(
        text.contains(
            "\nclusters:\n  client-box:\n    label: Client box\n    members: [workstation, ssh-client]\n    closed: true\n    x-note: kept\n  servers:\n    members: [server, sshd]\n    closed: false\n\nattacker:\n"
        ),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    let back = self::image(&text);
    assert_eq!(back["clusters"], image["clusters"]);
    let Document::Architecture(a) = load_document(&text).unwrap() else {
        panic!("an architecture")
    };
    assert_eq!(a.clusters.len(), 2);
    assert_eq!(
        effractor_format::save_document(&Document::Architecture(a)),
        text
    );
    // Absent is absent: a file without clusters does not change.
    assert_eq!(canonicalize(LECTURE).unwrap(), LECTURE);
    assert!(self::image(LECTURE).get("clusters").is_none());
}

#[test]
fn clusters_are_refused_where_they_do_not_hold() {
    let cases: [(serde_json::Value, &str, &str); 6] = [
        (
            serde_json::json!({"c": {"members": ["workstation", "nowhere"], "closed": true}}),
            "unknown-reference",
            "clusters.c.members[1]",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation"], "closed": true}}),
            "cardinality",
            "clusters.c.members",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation", "workstation"], "closed": true}}),
            "cardinality",
            "clusters.c.members[1]",
        ),
        (
            serde_json::json!({
                "c": {"members": ["workstation", "server"], "closed": true},
                "d": {"members": ["sshd", "server"], "closed": true}
            }),
            "cardinality",
            "clusters.d.members[1]",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation", "server"]}}),
            "missing-key",
            "clusters.c.closed",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation", "server"], "closed": "yes"}}),
            "wrong-type",
            "clusters.c.closed",
        ),
    ];
    for (clusters, code, path) in cases {
        let mut image = image(LECTURE);
        image["clusters"] = clusters;
        let errors = errors_of(&image);
        assert!(has(&errors, code, path), "{code} at {path}: {errors:?}");
    }
    // An unknown key in a cluster is an error like anywhere else.
    let mut image = image(LECTURE);
    image["clusters"] = serde_json::json!({"c": {"members": ["workstation", "server"], "closed": true, "open": false}});
    assert!(has(&errors_of(&image), "unknown-key", "clusters.c.open"));
}
```

Before running, check the missing-key path: `Cx::required` reports `f.path(key)`, so `clusters.c.closed` is right; check the unknown-key code string with `grep -n '"unknown-key"' crates/effractor-core/src/diagnostic.rs` and adjust the literal if it differs.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p effractor-format --test architecture clusters`
Expected: FAIL — `clusters` is an unknown key.

- [ ] **Step 3: The model**

In `crates/effractor-core/src/id.rs`, after `architecture_id_type!(ScenarioId);`:

```rust
architecture_id_type!(ClusterId);
```

Export it in `crates/effractor-core/src/lib.rs` in the `pub use id::{…}` list (alphabetical: `ArchitectureIdError, AssetId, AssociationId, ClusterId, …`).

In `crates/effractor-core/src/architecture.rs`: import `ClusterId` in the `use crate::{…}` line; add the field after `flows` and in `new()`:

```rust
    pub flows: IndexMap<FlowId, Flow>,
    /// Components shown as one node (clustering spec §2). A way of looking:
    /// nothing generated reads it.
    pub clusters: IndexMap<ClusterId, Cluster>,
```

```rust
            flows: IndexMap::new(),
            clusters: IndexMap::new(),
```

and, next to `Flow`:

```rust
/// Components drawn as one node, open or closed. Each entity is in at most
/// one cluster; a cluster has two members or more.
#[derive(Debug, Clone, PartialEq)]
pub struct Cluster {
    pub label: Option<String>,
    pub members: Vec<EntityId>,
    pub closed: bool,
}
```

- [ ] **Step 4: The reader**

In `crates/effractor-format/src/architecture_read.rs`: import `Cluster` from `effractor_core::architecture`; add `"clusters"` after `"flows"` in `document()`'s allowed keys and in `ONLY_KEYS` (its length becomes 7); read and set it:

```rust
    let clusters = cx.id_map(f.get("clusters"), "clusters", cluster);
```

```rust
    m.flows = flows?;
    m.clusters = clusters?;
```

and the item reader, after `fn flow`:

```rust
fn cluster(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Cluster> {
    let f = cx.fields(&entry.value, path, entry.key_pos, &["label", "members", "closed"])?;
    let label = cx.optional_string(&f, "label");
    let members = cx.required(&f, "members").and_then(|e| {
        let path = f.path("members");
        let items = cx.list(&e.value, &path)?;
        let ids: Vec<_> = items
            .iter()
            .enumerate()
            .map(|(i, item)| cx.id_value(item, &format!("{path}[{i}]")))
            .collect();
        ids.into_iter().collect::<Option<Vec<_>>>()
    });
    let closed = cx
        .required(&f, "closed")
        .and_then(|e| cx.boolean(&e.value, &f.path("closed")));
    Some(Cluster {
        label: label?,
        members: members?,
        closed: closed?,
    })
}
```

(`optional_string` returns `Option<Option<String>>` as it does for a flow's `protocol`; check its signature and match it.)

- [ ] **Step 5: The writer**

In `crates/effractor-format/src/architecture_write.rs`, right after the flows loop and before `w.out.push('\n'); w.open(0, "attacker");`:

```rust
    // Left out when empty: a file without clusters does not change.
    if !m.clusters.is_empty() {
        w.out.push('\n');
        w.open(0, "clusters");
    }
    for (id, cluster) in &m.clusters {
        let path = format!("clusters.{id}");
        w.open(2, id.as_str());
        if let Some(label) = &cluster.label {
            w.line(4, "label", &string(label, Context::Block));
        }
        let members = ids(&cluster.members);
        let inline = format!("[{}]", members.join(", "));
        if "    members: ".len() + inline.len() <= WIDTH {
            w.line(4, "members", &inline);
        } else {
            w.open(4, "members");
            for id in members {
                let _ = writeln!(w.out, "      - {id}");
            }
        }
        w.line(4, "closed", word(&BOOLS, &cluster.closed));
        w.extension_lines(4, &path);
    }
```

- [ ] **Step 6: The validator**

In `crates/effractor-core/src/architecture_validate.rs`, call `cx.clusters();` after `cx.flows();` and add:

```rust
    /// Every member an entity, in one cluster only, two or more a cluster.
    fn clusters(&mut self) {
        let m = self.m;
        let mut owner: HashMap<&EntityId, &ClusterId> = HashMap::new();
        for (id, cluster) in &m.clusters {
            let at = format!("clusters.{id}");
            if cluster.members.len() < 2 {
                self.error(
                    Code::Cardinality,
                    format!("{at}.members"),
                    "a cluster needs two members or more",
                );
            }
            for (i, member) in cluster.members.iter().enumerate() {
                let path = format!("{at}.members[{i}]");
                if self.entity(member, &path).is_none() {
                    continue;
                }
                if let Some(first) = owner.insert(member, id) {
                    let message = if first == id {
                        format!("\"{member}\" is listed twice")
                    } else {
                        format!("\"{member}\" is already in cluster \"{first}\"")
                    };
                    self.error(Code::Cardinality, path, message);
                }
            }
        }
    }
```

Import `ClusterId` and `std::collections::HashMap` if the file does not already (`grep -n "^use" crates/effractor-core/src/architecture_validate.rs`).

- [ ] **Step 7: Run the format tests**

Run: `cargo test -p effractor-format --test architecture`
Expected: PASS (all, the two new ones included). If the version-1 test (`version_one_trees_migrate…`) needs it, add a line asserting `clusters: {}` in a v1 tree is a `Version` error at `clusters`.

- [ ] **Step 8: Write the invariance test**

Create `crates/effractor-solver/tests/graph_clusters.rs`:

```rust
//! A cluster is a way of looking (clustering spec §1): the same model with
//! every component clustered generates the same graph and the same results.

use effractor_components::{generate, graph_image, resolve};
use effractor_core::Document;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

/// The lecture with two clusters, one closed and one open.
fn clustered() -> String {
    LECTURE.replacen(
        "\nattacker:\n",
        "\nclusters:\n  client-box:\n    members: [workstation, ssh-client]\n    closed: true\n  servers:\n    label: Servers\n    members: [server, sshd]\n    closed: false\n\nattacker:\n",
        1,
    )
}

fn solved(model: &Architecture, scenario: Option<&str>) -> serde_json::Value {
    let graph = generate(model).unwrap();
    let scenario = scenario.map(|s| s.parse().unwrap());
    let config = GraphConfig {
        samples: 2048,
        ..GraphConfig::from_model(model)
    };
    let r = GraphSolve::begin(model, &graph, scenario.as_ref(), &config)
        .unwrap()
        .finish();
    serde_json::to_value(r).unwrap()
}

#[test]
fn clustering_changes_neither_the_graph_nor_the_results() {
    let text = clustered();
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let plain = architecture(LECTURE);
    let folded = architecture(&text);
    assert_eq!(folded.clusters.len(), 2);

    let (a, b) = (generate(&plain).unwrap(), generate(&folded).unwrap());
    let (ra, rb) = (resolve(&plain, &a, None).unwrap(), resolve(&folded, &b, None).unwrap());
    assert_eq!(graph_image(&a, &ra), graph_image(&b, &rb));
    for scenario in [None, Some("patch"), Some("deny")] {
        assert_eq!(solved(&plain, scenario), solved(&folded, scenario), "{scenario:?}");
    }
}
```

Check `resolve`'s signature first (`grep -n "pub fn resolve" crates/effractor-components/src/*.rs`) and call it as `graph_determinism.rs` does; check the lecture's `\nattacker:\n` occurs once and that `patch`/`deny` are its scenario ids (`grep -n "^  [a-z]*:$" docs/course/lecture-architecture.yaml | tail`).

- [ ] **Step 9: Run it and the whole workspace**

Run: `cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, and `git status` shows no snapshot file changed.

- [ ] **Step 10: Amend the lecture design and commit**

In `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` §4, after the paragraph on `addresses`/`tool`, add: "`clusters` (clustering design §2): an optional top-level map of groups of entities, each `{label?, members, closed}`, for drawing only; generation ignores it."

```bash
git add crates/effractor-core/src/id.rs crates/effractor-core/src/lib.rs crates/effractor-core/src/architecture.rs crates/effractor-core/src/architecture_validate.rs crates/effractor-format/src/architecture_read.rs crates/effractor-format/src/architecture_write.rs crates/effractor-format/tests/architecture.rs crates/effractor-solver/tests/graph_clusters.rs docs/superpowers/specs/2026-09-21-lecture-workflow-design.md
git commit -m "Keep clusters in the architecture file"
```

---

### Task 2: Cluster edits (pure JS)

**Files:**
- Create: `assets/js/clusters.js`
- Modify: `assets/js/architecture-links.js` (`remove` returns `links`, forgets members; `renameId` renames members; new `removeAll`)
- Modify: `assets/js/profiles.js` (`MAPS.cluster`)
- Modify: `crates/effractor-server/templates/shell.html` (load `clusters.js` before `architecture-links.js`), `crates/effractor-server/src/shell.rs` (order assertion)
- Test: `scripts/clusters.test.js`, `scripts/architecture-links.test.js`, `scripts/profiles.test.js`

**Interfaces:**
- Consumes: the JSON image of Task 1.
- Produces (`window.effractorClusters`, `require("./clusters.js")`):
  - `SPECIFIC: string[]` — kinds, most specific first.
  - `clusterOf(doc, entity) → cid | null`; `label(doc, cid) → string`; `lead(doc, members) → kind`; `entitiesOf(doc, qualifiedIds) → entityIds` (`cluster/c` expands to its members).
  - `together(doc) → [{id, label, members}]` — the automatic groups not yet clustered.
  - Edits, each `{doc, select, notice?}` or `null`; `select: undefined` means "keep the selection" (the caller fills it in): `make(doc, members, label?)`, `build(doc)`, `toggleAll(doc)`, `takeOut(doc, cid, entity)`, `moveTo(doc, entity, cid)`, `dissolve(doc, cid)`, `rename(doc, cid, label)`, `setClosed(doc, cid, closed)`.
  - In-place helpers on a *copy*: `forget(next, goneEntities)`, `rekey(next, old, id)`.
  - `L.remove(...)` result gains `links: number`; `L.removeAll(doc, entityIds) → {doc, select: null, notice} | null`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/clusters.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/clusters.js');
const L = require('../assets/js/architecture-links.js');
const LECTURE = require('./fixtures/architecture.doc.json');
const IMPORTED = require('./fixtures/nmap/imported.doc.json');
const ROUTERS = require('./fixtures/nmap/imported-router.doc.json');

const copy = (d) => JSON.parse(JSON.stringify(d));

test('what runs together: a host, its software and the products only it uses', () => {
  assert.deepEqual(C.together(IMPORTED), [
    { id: 'admin-box', label: IMPORTED.entities['admin-box'].label, members: ['admin-box', 'nmap'] },
    { id: 'srv', label: IMPORTED.entities.srv.label, members: ['srv', 'sshd', 'tcp-8443', 'domain', 'unidentified-tcp-8443-on-server', 'dnsmasq-2-90'] },
    { id: 'printer', label: IMPORTED.entities.printer.label, members: ['printer', 'ssh'] },
  ], 'openssh runs on two hosts and stays alone');
});

test('a box with a router brings the router and its firewall', () => {
  const groups = C.together(ROUTERS);
  const box = groups.find((g) => g.id === 'opnsense-lab');
  assert.deepEqual(box.members, ['opnsense-lab', 'opnsense-lab-router', 'opnsense-lab-firewall', 'https', 'lighttpd']);
  assert.equal(C.lead(ROUTERS, box.members), 'router', 'the more specific icon wins');
  assert.equal(C.lead(ROUTERS, ['altiera', 'nmap']), 'host');
});

test('an nmap import collapses by host in one press', () => {
  const edit = C.toggleAll(IMPORTED);
  assert.equal(Object.keys(edit.doc.clusters).length, 3);
  assert.ok(Object.values(edit.doc.clusters).every((c) => c.closed === true));
  assert.equal(edit.select, undefined, 'the selection stays');
  assert.match(edit.notice, /3 clusters/);
  // Pressed again: all open; again: all closed. Nothing is ever removed.
  const open = C.toggleAll(edit.doc);
  assert.ok(Object.values(open.doc.clusters).every((c) => c.closed === false));
  const closed = C.toggleAll(open.doc);
  assert.ok(Object.values(closed.doc.clusters).every((c) => c.closed === true));
  assert.equal(Object.keys(closed.doc.clusters).length, 3);
  assert.equal(C.toggleAll(LECTURE_WITHOUT_HOSTING()), null, 'nothing runs together');
});

function LECTURE_WITHOUT_HOSTING() {
  const d = copy(LECTURE);
  for (const [k, a] of Object.entries(d.associations)) if (a.kind === 'hosts' || a.kind === 'filters') delete d.associations[k];
  return d;
}

test('a hand-made cluster takes its members from wherever they were', () => {
  let doc = C.make(IMPORTED, ['srv', 'sshd', 'srv', 'nowhere']).doc;
  const [cid] = Object.keys(doc.clusters);
  assert.deepEqual(doc.clusters[cid], { label: IMPORTED.entities.srv.label + ' +1', members: ['srv', 'sshd'], closed: true });
  assert.equal(C.make(IMPORTED, ['srv']), null, 'two or more');
  // Taking both members of it into another dissolves it.
  const next = C.make(doc, ['srv', 'sshd', 'printer'], 'Rack');
  assert.equal(next.select, 'cluster/rack');
  assert.deepEqual(Object.keys(next.doc.clusters), ['rack']);
  assert.equal(C.clusterOf(next.doc, 'printer'), 'rack');
});

test('taking out, moving over, dissolving, renaming, opening', () => {
  let doc = C.build(IMPORTED).doc;
  assert.equal(C.label(doc, 'srv'), IMPORTED.entities.srv.label);
  let edit = C.takeOut(doc, 'srv', 'domain');
  assert.equal(edit.select, 'entity/domain');
  assert.equal(edit.doc.clusters.srv.members.includes('domain'), false);
  // Two left would still be a cluster; one left dissolves it.
  edit = C.takeOut(doc, 'printer', 'ssh');
  assert.equal('printer' in edit.doc.clusters, false);
  assert.match(edit.notice, /dissolved/);
  edit = C.moveTo(doc, 'ssh', 'srv');
  assert.equal(C.clusterOf(edit.doc, 'ssh'), 'srv');
  assert.equal('printer' in edit.doc.clusters, false, 'left with one: dissolved');
  assert.equal(C.moveTo(doc, 'sshd', 'srv'), null, 'already there');
  assert.equal(C.rename(doc, 'srv', '  Server rack ').doc.clusters.srv.label, 'Server rack');
  assert.equal('label' in C.rename(doc, 'srv', '').doc.clusters.srv, false, 'empty: the first member names it');
  assert.equal(C.setClosed(doc, 'srv', false).doc.clusters.srv.closed, false);
  assert.equal(C.setClosed(doc, 'srv', true), null, 'already closed');
  const gone = C.dissolve(doc, 'srv');
  assert.equal('srv' in gone.doc.clusters, false);
  assert.deepEqual(Object.keys(gone.doc.entities), Object.keys(doc.entities), 'members stay');
  assert.equal('clusters' in C.dissolve(C.dissolve(C.dissolve(doc, 'srv').doc, 'printer').doc, 'admin-box').doc, false, 'no empty map left');
});

test('a cluster qualified id expands to its members', () => {
  const doc = C.build(IMPORTED).doc;
  assert.deepEqual(C.entitiesOf(doc, ['cluster/printer', 'entity/nmap', 'entity/printer']), ['printer', 'ssh', 'nmap']);
});

test('labels of hand-made clusters without one', () => {
  const doc = copy(IMPORTED);
  doc.clusters = { c: { members: ['srv', 'sshd', 'domain'], closed: true } };
  assert.equal(C.label(doc, 'c'), IMPORTED.entities.srv.label + ' +2');
});
```

Append to `scripts/architecture-links.test.js`:

```js
const C = require('../assets/js/clusters.js');

test('deleting members keeps clusters valid', () => {
  let doc = C.build(require('./fixtures/nmap/imported.doc.json')).doc;
  let edit = L.remove(doc, 'entities', 'ssh');
  assert.equal('printer' in edit.doc.clusters, false, 'one member left: dissolved');
  assert.equal(typeof edit.links, 'number');
  edit = L.remove(doc, 'entities', 'domain');
  assert.equal(edit.doc.clusters.srv.members.includes('domain'), false);
  const all = L.removeAll(doc, ['srv', 'sshd', 'printer']);
  assert.match(all.notice, /^deleted 3 components and \d+ links · Ctrl\+Z undoes$/);
  assert.equal(all.select, null);
  assert.equal(L.removeAll(doc, ['nowhere']), null);
  assert.equal(L.removeAll(doc, ['srv']).notice, L.remove(doc, 'entities', 'srv').notice, 'one: said as one');
});

test('renaming an id renames it in its cluster', () => {
  const doc = C.build(require('./fixtures/nmap/imported.doc.json')).doc;
  const edit = L.renameId(doc, 'entities', 'sshd', 'openssh-server');
  assert.ok(edit.doc.clusters.srv.members.includes('openssh-server'));
  assert.equal(edit.doc.clusters.srv.members.includes('sshd'), false);
});
```

Append to `scripts/profiles.test.js`:

```js
test('a cluster is a selection of its own', () => {
  const doc = { profile: 'architecture', entities: {}, clusters: { rack: { members: [], closed: true } } };
  assert.equal(P.selectionExists(doc, 'cluster/rack', null), true);
  assert.equal(P.selectionExists(doc, 'cluster/other', null), false);
  assert.equal(P.selectionExists({ profile: 'architecture', entities: {} }, 'cluster/rack', null), false);
});
```

(Use the file's existing `require` name for profiles; check its first lines.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/clusters.test.js scripts/architecture-links.test.js scripts/profiles.test.js`
Expected: FAIL — `Cannot find module '../assets/js/clusters.js'`.

- [ ] **Step 3: Write `assets/js/clusters.js` (edits part)**

```js
// Clusters (clustering spec): components drawn as one node, kept in the file
// as groups, open or closed. A way of looking — nothing generated reads them.
// Every edit is a pure function from a document to a new one, the contract of
// architecture-edit.js: {doc, select, notice?} or null. `select: undefined`
// keeps the selection. Geometry for drawing them is at the end. Pure.
(function () {
  var slug = (typeof module !== "undefined" ? require("./edit.js") : window.effractorEdit).slug;
  // Which kind's icon a cluster shows: the most specific among its members.
  var SPECIFIC = ["router", "firewall", "host", "service", "application", "product", "network", "account", "credential", "person", "data"];
  var SOFTWARE = { application: true, service: true };

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }
  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }
  function nameOf(doc, id) {
    var e = has(doc.entities, id) ? doc.entities[id] : null;
    return e && e.label != null ? String(e.label) : id;
  }
  function ids(doc) {
    return Object.keys(doc.clusters || {});
  }

  function clusterOf(doc, entity) {
    var all = ids(doc);
    for (var i = 0; i < all.length; i++) if ((doc.clusters[all[i]].members || []).indexOf(entity) >= 0) return all[i];
    return null;
  }

  function label(doc, cid) {
    var c = doc.clusters[cid];
    if (c.label) return String(c.label);
    var members = c.members || [];
    return members.length ? nameOf(doc, members[0]) + (members.length > 1 ? " +" + (members.length - 1) : "") : cid;
  }

  function lead(doc, members) {
    var best = null;
    members.forEach(function (m) {
      var kind = has(doc.entities, m) ? doc.entities[m].kind : null;
      if (kind && (best === null || SPECIFIC.indexOf(kind) < SPECIFIC.indexOf(best))) best = kind;
    });
    return best;
  }

  // `cluster/c` stands for its members; `entity/x` for itself; once each.
  function entitiesOf(doc, qualified) {
    var out = [];
    function add(id) {
      if (has(doc.entities, id) && out.indexOf(id) < 0) out.push(id);
    }
    qualified.forEach(function (q) {
      if (q.indexOf("cluster/") === 0 && has(doc.clusters, q.slice(8))) (doc.clusters[q.slice(8)].members || []).forEach(add);
      else if (q.indexOf("entity/") === 0) add(q.slice(7));
    });
    return out;
  }

  // An id for a new cluster from `base`, never only digits, not taken.
  function freeId(doc, base) {
    var id0 = slug(base) || "cluster";
    if (/^[0-9]+$/.test(id0)) id0 = "cluster-" + id0;
    var id = id0;
    for (var n = 2; has(doc.clusters, id); n++) id = id0 + "-" + n;
    return id;
  }

  function tidy(next) {
    if (next.clusters && !Object.keys(next.clusters).length) delete next.clusters;
  }

  // On a copy: the entities in `gone` ({id: true}) leave their clusters; a
  // cluster left with fewer than two is dissolved. Returns the dissolved labels.
  function forget(next, gone) {
    var dissolved = [];
    ids(next).forEach(function (cid) {
      var c = next.clusters[cid];
      var kept = (c.members || []).filter(function (m) {
        return !has(gone, m);
      });
      if (kept.length === (c.members || []).length) return;
      if (kept.length < 2) {
        dissolved.push(label(next, cid));
        delete next.clusters[cid];
      } else c.members = kept;
    });
    tidy(next);
    return dissolved;
  }

  // On a copy: entity `old` is now called `id`.
  function rekey(next, old, id) {
    ids(next).forEach(function (cid) {
      next.clusters[cid].members = next.clusters[cid].members.map(function (m) {
        return m === old ? id : m;
      });
    });
  }

  function make(doc, members, name) {
    var list = [];
    members.forEach(function (m) {
      if (has(doc.entities, m) && list.indexOf(m) < 0) list.push(m);
    });
    if (list.length < 2) return null;
    var next = clone(doc);
    var gone = Object.create(null);
    list.forEach(function (m) {
      gone[m] = true;
    });
    forget(next, gone);
    next.clusters = next.clusters || {};
    var text = String(name == null ? "" : name).trim();
    var id = freeId(next, text || list[0]);
    next.clusters[id] = { label: text || nameOf(doc, list[0]) + " +" + (list.length - 1), members: list, closed: true };
    return { doc: next, select: "cluster/" + id, notice: "clustered " + list.length + " components · Ctrl+Z undoes" };
  }

  // The automatic groups (spec §5.1), for components not in a cluster yet.
  function together(doc) {
    var ents = doc.entities || {};
    var order = Object.keys(ents);
    var taken = Object.create(null);
    ids(doc).forEach(function (cid) {
      (doc.clusters[cid].members || []).forEach(function (m) {
        taken[m] = true;
      });
    });
    var hostOf = Object.create(null), runs = Object.create(null), boxOf = Object.create(null);
    var routersOn = Object.create(null), firewallsOf = Object.create(null), users = Object.create(null);
    function push(map, k, v) {
      (map[k] = map[k] || []).push(v);
    }
    Object.keys(doc.associations || {}).forEach(function (k) {
      var a = doc.associations[k];
      if (!has(ents, a.from) || !has(ents, a.to)) return;
      var from = ents[a.from].kind, to = ents[a.to].kind;
      if (a.kind === "hosts" && from === "host" && SOFTWARE[to] && !has(hostOf, a.to)) {
        hostOf[a.to] = a.from;
        push(runs, a.from, a.to);
      }
      if (a.kind === "hosts" && from === "host" && to === "router" && !has(boxOf, a.to)) {
        boxOf[a.to] = a.from;
        push(routersOn, a.from, a.to);
      }
      if (a.kind === "filters" && from === "router" && to === "firewall") push(firewallsOf, a.from, a.to);
      if (a.kind === "instance-of") push(users, a.to, a.from);
    });
    function byOrder(list) {
      return (list || []).slice().sort(function (a, b) {
        return order.indexOf(a) - order.indexOf(b);
      });
    }
    // A product goes with a host when everything using it runs there.
    var productsOf = Object.create(null);
    order.forEach(function (p) {
      var u = users[p];
      if (!u || !has(hostOf, u[0])) return;
      var host = hostOf[u[0]];
      if (u.every(function (x) { return hostOf[x] === host; })) push(productsOf, host, p);
    });
    var out = [];
    var used = Object.create(null);
    order.forEach(function (id) {
      var kind = ents[id].kind;
      var members;
      if (kind === "host") {
        members = [id];
        byOrder(routersOn[id]).forEach(function (r) {
          members.push(r);
          byOrder(firewallsOf[r]).forEach(function (f) {
            members.push(f);
          });
        });
        members = members.concat(byOrder(runs[id]), productsOf[id] || []);
      } else if (kind === "router" && !has(boxOf, id)) {
        members = [id].concat(byOrder(firewallsOf[id]));
      } else return;
      if (taken[id]) return;
      members = members.filter(function (m, i) {
        return !taken[m] && !used[m] && members.indexOf(m) === i;
      });
      if (members.length < 2) return;
      members.forEach(function (m) {
        used[m] = true;
      });
      out.push({ id: id, label: nameOf(doc, id), members: members });
    });
    return out;
  }

  function build(doc) {
    var groups = together(doc);
    if (!groups.length) return null;
    var next = clone(doc);
    next.clusters = next.clusters || {};
    groups.forEach(function (g) {
      next.clusters[freeId(next, g.id)] = { label: g.label, members: g.members, closed: true };
    });
    return { doc: next, select: undefined, notice: "clustered " + groups.length + (groups.length === 1 ? " group" : " groups") + " · Ctrl+Z undoes" };
  }

  // The rail's one button (spec §5.2): make, else open all, else close all.
  function toggleAll(doc) {
    var all = ids(doc);
    if (!all.length) {
      var made = build(doc);
      if (made) made.notice = made.notice.replace(/groups?/, function (w) { return w === "group" ? "cluster" : "clusters"; });
      return made;
    }
    var anyClosed = all.some(function (cid) {
      return doc.clusters[cid].closed === true;
    });
    var next = clone(doc);
    all.forEach(function (cid) {
      next.clusters[cid].closed = !anyClosed;
    });
    return { doc: next, select: undefined, notice: (anyClosed ? "opened " : "closed ") + all.length + (all.length === 1 ? " cluster" : " clusters") };
  }

  function takeOut(doc, cid, entity) {
    if (!has(doc.clusters, cid) || doc.clusters[cid].members.indexOf(entity) < 0) return null;
    var next = clone(doc);
    var gone = Object.create(null);
    gone[entity] = true;
    var name = label(doc, cid);
    var dissolved = forget(next, gone);
    return { doc: next, select: "entity/" + entity, notice: dissolved.length ? "dissolved “" + name + "” · Ctrl+Z undoes" : "took “" + nameOf(doc, entity) + "” out of “" + name + "”" };
  }

  function moveTo(doc, entity, cid) {
    if (!has(doc.clusters, cid) || !has(doc.entities, entity) || doc.clusters[cid].members.indexOf(entity) >= 0) return null;
    var next = clone(doc);
    var gone = Object.create(null);
    gone[entity] = true;
    forget(next, gone);
    next.clusters = next.clusters || {};
    if (!has(next.clusters, cid)) return null; // cannot happen: cid kept its members
    next.clusters[cid].members.push(entity);
    return { doc: next, select: "cluster/" + cid, notice: "moved “" + nameOf(doc, entity) + "” into “" + label(doc, cid) + "”" };
  }

  function dissolve(doc, cid) {
    if (!has(doc.clusters, cid)) return null;
    var next = clone(doc);
    delete next.clusters[cid];
    tidy(next);
    return { doc: next, select: null, notice: "dissolved “" + label(doc, cid) + "” · Ctrl+Z undoes" };
  }

  function rename(doc, cid, text) {
    if (!has(doc.clusters, cid)) return null;
    var name = String(text == null ? "" : text).trim();
    if ((doc.clusters[cid].label || "") === name) return null;
    var next = clone(doc);
    if (name) next.clusters[cid].label = name;
    else delete next.clusters[cid].label;
    return { doc: next, select: "cluster/" + cid };
  }

  function setClosed(doc, cid, closed) {
    if (!has(doc.clusters, cid) || doc.clusters[cid].closed === !!closed) return null;
    var next = clone(doc);
    next.clusters[cid].closed = !!closed;
    return { doc: next, select: "cluster/" + cid };
  }

  var api = {
    SPECIFIC: SPECIFIC,
    clusterOf: clusterOf,
    label: label,
    lead: lead,
    entitiesOf: entitiesOf,
    together: together,
    forget: forget,
    rekey: rekey,
    make: make,
    build: build,
    toggleAll: toggleAll,
    takeOut: takeOut,
    moveTo: moveTo,
    dissolve: dissolve,
    rename: rename,
    setClosed: setClosed,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorClusters = api;
})();
```

Note: in `make`, the new cluster's label names the first member ("srv +1"); the id comes from the given name or the first member id. The test expects `select: 'cluster/rack'` for the name "Rack" — `slug("Rack")` gives `rack`.

- [ ] **Step 4: Wire deletion and renaming**

In `assets/js/architecture-links.js`:

- At the top, beside the other requires: `var C = typeof module !== "undefined" ? require("./clusters.js") : window.effractorClusters;`
- In `remove`, after the scenarios filter and before the notice: 
  ```js
      var dissolved = C.forget(next, gone.entities);
  ```
  and return `links` (the count before the `if (collection !== "entities") links--;` adjustment is what the notice uses — return the same number the notice says):
  ```js
      return { doc: next, select: null, notice: notice + " · Ctrl+Z undoes", links: links };
  ```
  (`dissolved` needs no word of its own: the cluster disappears with the component. Leave the variable out if unused — `C.forget(next, gone.entities);` alone.)
- In `renameId`, inside `if (collection === "entities") {…}`: `C.rekey(next, old, id);`
- New, after `remove`:
  ```js
    // Several components in one edit (spec §3): each with what named it.
    function removeAll(doc, entityIds) {
      var next = doc, n = 0, links = 0, single = null;
      entityIds.forEach(function (id) {
        if (!has(next.entities, id)) return;
        var r = remove(next, "entities", id);
        next = r.doc;
        n++;
        links += r.links;
        single = r;
      });
      if (!n) return null;
      if (n === 1) return single;
      var notice = "deleted " + n + " components" + (links ? " and " + links + (links === 1 ? " link" : " links") : "");
      return { doc: next, select: null, notice: notice + " · Ctrl+Z undoes" };
    }
  ```
  and add `removeAll: removeAll` to `api`.

In `assets/js/profiles.js`: `var MAPS = { entity: "entities", flow: "flows", association: "associations", cluster: "clusters" };`

In `crates/effractor-server/templates/shell.html`, before the `architecture-links.js` script tag:
```html
<script src="{{ asset_prefix }}assets/js/clusters.js" defer></script>
```
In `crates/effractor-server/src/shell.rs`'s order test, add `assert!(at("clusters.js") < at("architecture-links.js"));`. If Pages builds from a list of assets (`grep -rn "architecture-links.js" scripts .github`), add `clusters.js` there too.

- [ ] **Step 5: Run the tests**

Run: `node --test scripts/clusters.test.js scripts/architecture-links.test.js scripts/profiles.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add assets/js/clusters.js assets/js/architecture-links.js assets/js/profiles.js crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs scripts/clusters.test.js scripts/architecture-links.test.js scripts/profiles.test.js
git commit -m "Make, open and take apart clusters"
```

---

### Task 3: What a cluster looks like (pure JS)

**Files:**
- Modify: `assets/js/clusters.js` (geometry: `segments`, `arc`, `within`, `closeAt`, `reopen`)
- Modify: `assets/js/architecture-view.js` (`describe` folds clusters; pins carry `entity`)
- Modify: `assets/js/graph.js` (`blocks` for open clusters; `fromStress` passes `groups`)
- Modify: `assets/js/positions.js` (`attach` to a node, `outline`, `place` outlines)
- Test: `scripts/clusters.test.js`, `scripts/architecture-view.test.js`, `scripts/graph.test.js`, `scripts/positions.test.js`

**Interfaces:**
- Consumes: Task 2's `C.label`, `C.lead`.
- Produces:
  - `describe(doc, word)` now also returns `hidden: {entityId: "cluster/<cid>"}` (members of closed clusters), `bundles: {drawnEdgeId: [qualified member ids]}` (for every merged line and merged permission), `groups: [{id: "cluster/<cid>", label, members: ["entity/…"]}]` (open clusters).
  - A closed cluster's node: `{id: "cluster/<cid>", symbol: "component", component: <lead kind>, label, lines, unknown, pins, rings, cluster: {count, states: [("vulnerable"|"unknown"|null) per member]}, …}`.
  - Merged line ids: `links/<from>><to>` and `flows/<from>><to>` (`from`/`to` drawn ids); merged permissions `permits/<firewall>><node>`; a permission may carry `node` (a drawn node id) instead of `flow`, and a `label`.
  - Every pin has `entity` (the member it belongs to).
  - `C.segments(states) → [{state, from, to} | {state, full: true}]` (radians, clockwise from the top); `C.arc(cx, cy, r, from, to) → "M…A…"`; `C.within(nodes, rect) → ids`; `C.closeAt(boxes) → {x, y}|null`; `C.reopen(at, members, stored) → {id: {x, y}}`.
  - `positions.outline(at, group) → {id, label, members, x, y, width, height}|null`; `place(...)` returns `outlines`; `positions.attach` accepts a permit with `node`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/clusters.test.js`:

```js
test('ring sectors: one per member up to twelve, else one per state', () => {
  const four = C.segments(['vulnerable', null, 'unknown', null]);
  assert.equal(four.length, 4);
  assert.deepEqual(four.map((s) => s.state), ['vulnerable', null, 'unknown', null]);
  assert.ok(four[0].from > -Math.PI / 2 && four[0].to < 0, 'first sector clockwise from the top, with a gap');
  assert.ok(four.every((s) => s.to > s.from));
  const many = C.segments(Array.from({ length: 20 }, (_, i) => (i < 5 ? 'vulnerable' : null)));
  assert.deepEqual(many.map((s) => s.state), ['vulnerable', null]);
  const share = (s) => (s.to - s.from);
  assert.ok(Math.abs(share(many[0]) / (share(many[0]) + share(many[1])) - 0.25) < 0.02, 'sized by count');
  assert.deepEqual(C.segments(Array(20).fill(null)), [{ state: null, full: true }]);
  assert.match(C.arc(0, 0, 10, -Math.PI / 2, 0), /^M0 -10A10 10 0 0 1 10 0$/);
});

test('a rectangle picks what its centre is inside of', () => {
  const nodes = [
    { id: 'entity/a', x: 0, y: 0, width: 148, height: 84, hub: { x: 74, y: 24, r: 28 } },
    { id: 'entity/b', x: 300, y: 0, width: 148, height: 84, hub: { x: 74, y: 24, r: 28 } },
  ];
  assert.deepEqual(C.within(nodes, { x0: 200, y0: 100, x1: -10, y1: -10 }), ['entity/a']);
  assert.deepEqual(C.within(nodes, { x0: -10, y0: -10, x1: 500, y1: 60 }), ['entity/a', 'entity/b']);
});

test('closing and opening in place', () => {
  assert.deepEqual(C.closeAt([{ x: 0, y: 0 }, { x: 100, y: 50 }]), { x: 50, y: 25 });
  assert.equal(C.closeAt([]), null);
  // Opened where the cluster now stands: members keep their spacing.
  const moved = C.reopen({ x: 1000, y: 500 }, ['a', 'b', 'c'], { a: { x: 0, y: 0 }, b: { x: 100, y: 50 } });
  assert.deepEqual(moved, { a: { x: 950, y: 475 }, b: { x: 1050, y: 525 } });
  assert.deepEqual(C.reopen({ x: 0, y: 0 }, ['a'], {}), {});
});
```

Append to `scripts/architecture-view.test.js` (check its fixture `require` names first; the nmap fixture is used here):

```js
const C = require('../assets/js/clusters.js');
const IMPORTED = require('./fixtures/nmap/imported.doc.json');

test('a closed cluster is one node; its lines go to it, merged, and inner ones hide', () => {
  const doc = C.build(IMPORTED).doc;
  const d = V.describe(doc);
  const ids = d.nodes.map((n) => n.id);
  assert.ok(ids.includes('cluster/srv'));
  assert.equal(ids.includes('entity/sshd'), false);
  assert.equal(d.hidden.sshd, 'cluster/srv');
  const srv = d.nodes.find((n) => n.id === 'cluster/srv');
  assert.equal(srv.component, 'host');
  assert.equal(srv.cluster.count, 6);
  assert.equal(srv.unknown, doc.clusters.srv.members.reduce((s, m) => s + V.describe(IMPORTED).nodes.find((n) => n.id === 'entity/' + m).unknown, 0));
  // No line inside one closed cluster; every line's ends are drawn nodes.
  for (const e of d.edges) {
    assert.notEqual(e.from, e.to);
    assert.ok(ids.includes(e.from) && ids.includes(e.to), e.id);
  }
  // Two lines between the same drawn ends, same direction: one, counted.
  const merged = d.edges.filter((e) => /^(links|flows)\//.test(e.id));
  for (const m of merged) {
    assert.match(m.label, /^\d+ (links|flows)$/);
    assert.equal(d.bundles[m.id].length, Number(m.label.split(' ')[0]));
  }
  // openssh is used on srv and printer: it stays, and its lines end at both clusters.
  assert.ok(ids.includes('entity/openssh'));
});

test('an open cluster draws its members and an outline', () => {
  const doc = C.build(IMPORTED).doc;
  doc.clusters.srv.closed = false;
  const d = V.describe(doc);
  assert.ok(d.nodes.some((n) => n.id === 'entity/sshd'));
  assert.deepEqual(d.groups, [{ id: 'cluster/srv', label: C.label(doc, 'srv'), members: doc.clusters.srv.members.map((m) => 'entity/' + m) }]);
  assert.equal(d.hidden.sshd, undefined);
});

test('ring sectors carry each member state; pins keep their member', () => {
  const doc = C.build(IMPORTED).doc;
  doc.entities['dnsmasq-2-90'].defenses = { patched: false };
  doc.attacker = { footholds: [{ entity: 'sshd', state: 'admin' }] };
  const srv = V.describe(doc).nodes.find((n) => n.id === 'cluster/srv');
  const at = (m) => srv.cluster.states[doc.clusters.srv.members.indexOf(m)];
  assert.equal(at('dnsmasq-2-90'), 'vulnerable');
  assert.equal(at('domain'), 'vulnerable', 'the software running it');
  assert.equal(at('srv'), 'vulnerable', 'and the host');
  assert.ok(srv.rings.some((r) => r.state === 'vulnerable'));
  assert.deepEqual(srv.pins.map((p) => [p.entity, p.role]), [['sshd', 'foothold']]);
});
```

And permissions, with the lecture fixture (router `bridge`, firewall `filter`; one flow `ssh` from `ssh-client` to `sshd` — check ids with `node -e "console.log(require('./scripts/fixtures/architecture.doc.json').flows)"` and adjust):

```js
test('permissions start at the firewall’s cluster and end at a cluster holding the flow', () => {
  const doc = JSON.parse(JSON.stringify(require('./fixtures/architecture.doc.json')));
  doc.clusters = {
    edge: { members: ['bridge', 'filter'], closed: true },
    servers: { members: ['server', 'sshd'], closed: true },
  };
  const d = V.describe(doc);
  assert.ok(d.permits.length > 0);
  for (const p of d.permits) {
    assert.equal(p.firewall, 'cluster/edge');
    assert.equal(p.node, 'cluster/servers', 'the flow’s target is inside');
  }
  // Firewall and the whole flow in one cluster: nothing to draw.
  doc.clusters = { all: { members: ['bridge', 'filter', 'ssh-client', 'sshd', 'workstation', 'server'], closed: true } };
  assert.deepEqual(V.describe(doc).permits, []);
});
```

Append to `scripts/graph.test.js`:

```js
test('an open cluster is laid out as a block, its first member on top', () => {
  const G = require('../assets/js/graph.js');
  const node = (id, component) => ({ id: 'entity/' + id, component, symbol: 'component', lines: [id] });
  const graph = {
    nodes: [node('box', 'host'), node('r', 'router'), node('a', 'service'), node('p', 'product'), node('x', 'host')],
    edges: [
      { id: 'h1', from: 'entity/box', to: 'entity/r', kind: 'hosts' },
      { id: 'h2', from: 'entity/box', to: 'entity/a', kind: 'hosts' },
      { id: 'i1', from: 'entity/a', to: 'entity/p', kind: 'instance-of' },
    ],
    groups: [{ id: 'cluster/c', label: 'c', members: ['entity/box', 'entity/r', 'entity/a', 'entity/p'] }],
  };
  const b = G.blocks(graph);
  assert.deepEqual(Object.keys(b.blocks), ['entity/box']);
  const block = b.blocks['entity/box'];
  assert.deepEqual(block.members, ['entity/box', 'entity/r', 'entity/a', 'entity/p']);
  assert.equal(block.at['entity/box'].y, 0);
  assert.equal(block.at['entity/r'].y, block.at['entity/a'].y, 'router in the software row');
  assert.equal(block.at['entity/p'].x, block.at['entity/a'].x, 'product under its user');
  assert.ok(block.at['entity/p'].y > block.at['entity/a'].y);
  assert.equal(b.of['entity/x'], undefined);
});
```

Append to `scripts/positions.test.js`:

```js
test('an open cluster’s outline wraps its members; a permission may end on a node', () => {
  const at = {
    'entity/a': { id: 'entity/a', x: 0, y: 0, width: 148, height: 84 },
    'entity/b': { id: 'entity/b', x: 200, y: 100, width: 148, height: 84 },
    'cluster/k': { id: 'cluster/k', x: 600, y: 0, width: 148, height: 84, hub: { x: 74, y: 24, r: 28 } },
  };
  const o = Pos.outline(at, { id: 'cluster/c', label: 'C', members: ['entity/a', 'entity/b', 'entity/gone'] });
  assert.deepEqual([o.x, o.y, o.width, o.height], [-10, -10, 368, 204]);
  assert.equal(Pos.outline(at, { id: 'cluster/d', label: 'D', members: ['entity/gone'] }), null);
  const line = Pos.attach(at, null, { id: 'permits/x', firewall: 'entity/a', node: 'cluster/k', allowed: null, label: '2 permissions' });
  assert.equal(line.label, '2 permissions');
  assert.equal(line.node, 'cluster/k');
  assert.ok(line.end.x < 600 + 74, 'ends on the ring');
});
```

(Use the file's own name for the positions module; check the first lines.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/clusters.test.js scripts/architecture-view.test.js scripts/graph.test.js scripts/positions.test.js`
Expected: FAIL (`C.segments is not a function`, `d.hidden` undefined, …).

- [ ] **Step 3: Geometry in `clusters.js`**

Before `var api`, add and export `segments, arc, within, closeAt, reopen`:

```js
  // ---- geometry ----

  var GAP = 0.14; // radians between two sectors
  var ONE_EACH = 12; // above this many members, one arc per state
  var STATES = ["vulnerable", "unknown", null];

  // A closed cluster's ring (spec §4.1), clockwise from the top.
  function segments(states) {
    var n = states.length;
    if (!n) return [];
    var parts;
    if (n <= ONE_EACH) {
      parts = states.map(function (s) {
        return { state: s, share: 1 };
      });
    } else {
      parts = STATES.map(function (s) {
        return { state: s, share: states.filter(function (x) { return x === s; }).length };
      }).filter(function (p) {
        return p.share > 0;
      });
      if (parts.length === 1) return [{ state: parts[0].state, full: true }];
    }
    var total = parts.reduce(function (s, p) { return s + p.share; }, 0);
    var at = -Math.PI / 2;
    return parts.map(function (p) {
      var sweep = (2 * Math.PI * p.share) / total;
      var out = { state: p.state, from: at + GAP / 2, to: at + sweep - GAP / 2 };
      at += sweep;
      return out;
    });
  }

  function round(v) {
    return Math.round(v * 100) / 100 || 0;
  }
  function arc(cx, cy, r, from, to) {
    var x0 = round(cx + r * Math.cos(from)), y0 = round(cy + r * Math.sin(from));
    var x1 = round(cx + r * Math.cos(to)), y1 = round(cy + r * Math.sin(to));
    return "M" + x0 + " " + y0 + "A" + r + " " + r + " 0 " + (to - from > Math.PI ? 1 : 0) + " 1 " + x1 + " " + y1;
  }

  // The drawn nodes whose centre (their plate's, where they have one) lies
  // in the rectangle, in any corner order.
  function within(nodes, rect) {
    var x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
    var y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
    return nodes.filter(function (n) {
      var cx = n.hub ? n.x + n.hub.x : n.x + n.width / 2;
      var cy = n.hub ? n.y + n.hub.y : n.y + n.height / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    }).map(function (n) {
      return n.id;
    });
  }

  // Where a closing cluster stands: amid its members (all one size, so
  // their corners average to it).
  function closeAt(boxes) {
    if (!boxes.length) return null;
    var x = 0, y = 0;
    boxes.forEach(function (b) {
      x += b.x;
      y += b.y;
    });
    return { x: Math.round(x / boxes.length), y: Math.round(y / boxes.length) };
  }

  // Members opened round where the cluster now stands (`at`), keeping the
  // spacing they had: their stored positions, shifted. Members never placed
  // are the layout's to place.
  function reopen(at, members, stored) {
    var known = members.filter(function (m) {
      return has(stored, m);
    });
    var centre = closeAt(known.map(function (m) { return stored[m]; }));
    var out = {};
    if (!centre) return out;
    known.forEach(function (m) {
      out[m] = { x: stored[m].x + at.x - centre.x, y: stored[m].y + at.y - centre.y };
    });
    return out;
  }
```

- [ ] **Step 4: Fold clusters in `architecture-view.describe`**

In `assets/js/architecture-view.js`:

- Require clusters beside graph: `var C = typeof module !== "undefined" ? require("./clusters.js") : window.effractorClusters;`
- In `pins()`, give every pin its entity: `(out[entity] = out[entity] || []).push({ role: role, state: state, entity: entity, word: word ? word(state) : state });`
- At the end of `describe`, replace `return { profile: "architecture", nodes: nodes, edges: edges, permits: permits };` with `return fold(doc, { profile: "architecture", nodes: nodes, edges: edges, permits: permits });` and add:

```js
  // Closed clusters as one node each (clustering spec §4): their members'
  // lines drawn to them, merged per pair of drawn ends, inner ones hidden;
  // open ones listed for their outlines. `hidden` says where a member is drawn,
  // `bundles` what each merged line or permission holds.
  function fold(doc, d) {
    var hidden = Object.create(null), groups = [], closed = [];
    Object.keys(doc.clusters || {}).forEach(function (cid) {
      var members = (doc.clusters[cid].members || []).filter(function (m) {
        return has(doc.entities, m);
      });
      if (members.length < 2) return; // the validator says so; drawn as components meanwhile
      if (doc.clusters[cid].closed === true) {
        members.forEach(function (m) {
          hidden[m] = "cluster/" + cid;
        });
        closed.push({ cid: cid, members: members });
      } else groups.push({ id: "cluster/" + cid, label: C.label(doc, cid), members: members.map(function (m) { return "entity/" + m; }) });
    });
    var byId = Object.create(null);
    d.nodes.forEach(function (n) {
      byId[n.id] = n;
    });
    function drawn(id) {
      var q = id.indexOf("entity/") === 0 ? id.slice(7) : null;
      return q && hidden[q] ? hidden[q] : id;
    }
    var nodes = d.nodes.filter(function (n) {
      return !hidden[n.id.slice(7)];
    });
    closed.forEach(function (c) {
      nodes.push(clusterNode(doc, c.cid, c.members.map(function (m) { return byId["entity/" + m]; })));
    });

    var bundles = Object.create(null), edges = [], merged = Object.create(null), lineOf = Object.create(null);
    d.edges.forEach(function (e) {
      var from = drawn(e.from), to = drawn(e.to);
      if (from === to) return;
      if (from === e.from && to === e.to) {
        lineOf[e.id] = e.id;
        return edges.push(e);
      }
      var key = (e.kind === "flow" ? "flows/" : "links/") + from + ">" + to;
      lineOf[e.id] = key;
      if (!merged[key]) {
        merged[key] = { at: edges.length, members: [] };
        edges.push(null);
      }
      merged[key].members.push(Object.assign({}, e, { from: from, to: to }));
    });
    Object.keys(merged).forEach(function (key) {
      var m = merged[key].members;
      if (m.length === 1) {
        lineOf[m[0].id] = m[0].id;
        edges[merged[key].at] = m[0];
        return;
      }
      var flows = key.indexOf("flows/") === 0;
      bundles[key] = m.map(function (e) { return e.id; });
      edges[merged[key].at] = {
        id: key,
        from: m[0].from,
        to: m[0].to,
        kind: flows ? "flow" : "bundle",
        label: m.length + (flows ? " flows" : " links"),
        title: m.map(function (e) { return e.label; }).join("\n"),
      };
    });

    var permits = [], toNode = Object.create(null);
    d.permits.forEach(function (p) {
      var f = doc.flows[p.flow.slice(5)];
      var firewall = drawn(p.firewall);
      var s = drawn("entity/" + f.source), t = drawn("entity/" + f.target);
      var node = t.indexOf("cluster/") === 0 ? t : s.indexOf("cluster/") === 0 ? s : null;
      if (!node) {
        var line = lineOf[p.flow];
        if (line) permits.push(Object.assign({}, p, { firewall: firewall, flow: line }));
        return;
      }
      if (node === firewall) return;
      var key = "permits/" + firewall + ">" + node;
      if (!toNode[key]) {
        toNode[key] = { id: p.id, firewall: firewall, node: node, allowed: p.allowed, members: [] };
        permits.push(toNode[key]);
      }
      var m = toNode[key];
      m.members.push(p.id);
      if (m.allowed !== p.allowed) m.allowed = null;
    });
    permits.forEach(function (p) {
      if (!p.members) return;
      if (p.members.length > 1) {
        p.id = "permits/" + p.firewall + ">" + p.node;
        p.label = p.members.length + " permissions";
        bundles[p.id] = p.members;
      }
      delete p.members;
    });
    return { profile: d.profile, nodes: nodes, edges: edges, permits: permits, hidden: hidden, bundles: bundles, groups: groups };
  }

  function clusterNode(doc, cid, members) {
    var label = C.label(doc, cid);
    var states = members.map(function (m) {
      return m.rings.length ? "vulnerable" : m.unknown > 0 ? "unknown" : null;
    });
    var unknown = members.reduce(function (s, m) { return s + m.unknown; }, 0);
    var why = members.filter(function (m) { return m.rings.length; }).map(function (m) {
      return m.rings.map(function (r) { return r.why; }).join("\n");
    });
    var rings = why.length ? [{ state: "vulnerable", why: why.join("\n") }] : [];
    var open = states.filter(function (s) { return s === "unknown"; }).length;
    if (open) rings.push({ state: "unknown", why: open + (open === 1 ? " member" : " members") + " with unknown inputs" });
    return {
      id: "cluster/" + cid,
      label: label,
      lines: graph.wrap(label + " · " + members.length, 22, 2),
      symbol: "component",
      component: C.lead(doc, members.map(function (m) { return m.id.slice(7); })),
      inscription: null,
      attributes: null,
      unknown: unknown,
      badge: null,
      pins: members.reduce(function (all, m) { return all.concat(m.pins); }, []),
      rings: rings,
      cluster: { count: members.length, states: states },
      parents: 0,
      unquantified: unknown > 0,
      top: false,
      unreachable: false,
    };
  }
```

Also make `route()` (a flow's hops) unaffected — it returns entity ids; the app maps them (Task 4).

- [ ] **Step 5: Blocks for open clusters in `graph.js`**

Refactor `blocks(graph)` so the arrangement of one block is a function, used for host blocks as today and for each of `graph.groups`:

```js
  // One block: `top` centred on top, `row` in rows of BLOCK.columns under
  // it, each `under[id]` in a column under its user.
  function arrange(top, row, under) {
    var cell = SIZE.width + BLOCK.gap, step = SIZE.component + BLOCK.gap;
    var columns = Math.max(1, Math.min(BLOCK.columns, row.length));
    var width = Math.max(SIZE.width, columns * cell - BLOCK.gap);
    var at = dict(), members = [top], y = row.length ? step : 0;
    at[top] = { x: (width - SIZE.width) / 2, y: 0 };
    for (var start = 0; start < row.length; start += BLOCK.columns) {
      var tier = row.slice(start, start + BLOCK.columns), deepest = 0;
      tier.forEach(function (id, i) {
        at[id] = { x: i * cell, y: y };
        members.push(id);
        (under[id] || []).forEach(function (product, k) {
          at[product] = { x: i * cell, y: y + (k + 1) * step };
          members.push(product);
        });
        deepest = Math.max(deepest, (under[id] || []).length);
      });
      y += (deepest + 1) * step;
    }
    return { members: members, at: at, width: width, height: row.length ? y - BLOCK.gap : SIZE.component };
  }
```

In `blocks(graph)`:
- Before the host loop, compute `taken` = every member of `graph.groups` (open clusters), and skip, in the `hosts`/`instance-of` scan, any edge whose `from` or `to` is taken (so host blocks never hold a clustered component).
- Replace the host loop's body with `var block = arrange(host, software, under); block.members.forEach(function (m) { out.of[m] = host; }); out.blocks[host] = block;`.
- After it, for each group in `graph.groups || []` (members that are drawn nodes only; skip groups with fewer than two):
  ```js
      var inside = dict();
      members.forEach(function (m) { inside[m] = true; });
      var top = members[0];
      // A product under its first user when every user is in the group.
      var groupUsers = dict();
      graph.edges.forEach(function (e) {
        if (e.kind === "instance-of" && inside[e.from] && inside[e.to]) (groupUsers[e.to] = groupUsers[e.to] || []).push(e.from);
      });
      var allUsersIn = function (p) {
        return graph.edges.every(function (e) { return e.kind !== "instance-of" || e.to !== p || inside[e.from]; });
      };
      var under2 = dict(), placed = dict();
      members.forEach(function (p) {
        var users = groupUsers[p];
        if (!users || p === top || !allUsersIn(p)) return;
        var first = members.filter(function (m) { return users.indexOf(m) >= 0 && m !== top; })[0];
        if (!first) return;
        (under2[first] = under2[first] || []).push(p);
        placed[p] = true;
      });
      var row = members.filter(function (m) { return m !== top && !placed[m]; });
      var block = arrange(top, row, under2);
      block.members.forEach(function (m) { out.of[m] = top; });
      out.blocks[top] = block;
  ```
- `toStress` and `fromStress` already treat `out.blocks[id]` as one child; nothing else changes there, except `fromStress` returns `groups: (graph.groups || []).slice()` beside `permits`.
- Check how `assets/js/layout.js` hands the described graph to `toStress`/`fromStress` (it may copy it for a worker): `groups` must reach both, or open clusters are laid out as loose components and `place` draws no outline.

Run `node --test scripts/graph.test.js` — the existing grouped-layout tests must still pass unchanged (the refactor keeps host blocks' numbers).

- [ ] **Step 6: Outlines and node permissions in `positions.js`**

```js
  var PAD = 10; // px round an open cluster's members

  // An open cluster's outline round its members as they now stand, or null
  // when none of them is drawn.
  function outline(at, group) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    group.members.forEach(function (id) {
      var n = at[id];
      if (!n) return;
      any = true;
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    if (!any) return null;
    return { id: group.id, label: group.label, members: group.members, x: x0 - PAD, y: y0 - PAD, width: x1 - x0 + 2 * PAD, height: y1 - y0 + 2 * PAD };
  }
```

In `attach(nodes, flow, permit)`, first:

```js
    if (permit.node) {
      var to = at[permit.node];
      if (!fw || !to) return null;
      var s = border(fw, center(to)), e = border(to, center(fw));
      return { id: permit.id, firewall: permit.firewall, flow: null, node: permit.node, allowed: permit.allowed, label: permit.label || WORD[permit.allowed], start: s, end: e, mid: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } };
    }
```

(move the `var at = …; var fw = …;` lines above it) and for a flow permission use `label: permit.label || WORD[permit.allowed]`.

In `place`: compute `var outlines = (laid.groups || []).map(function (g) { return outline(at, g); }).filter(Boolean);`, include each outline in the `x0/y0/x1/y1` bounds (an outline is wider than its members), and return `outlines: outlines`. Export `outline`.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS (new and existing).

- [ ] **Step 8: Commit**

```bash
git add assets/js/clusters.js assets/js/architecture-view.js assets/js/graph.js assets/js/positions.js scripts/clusters.test.js scripts/architecture-view.test.js scripts/graph.test.js scripts/positions.test.js
git commit -m "Describe clusters: one node, merged lines, outlines"
```

---

### Task 4: Draw clusters (renderer and app) — owner looks

**Files:**
- Modify: `assets/js/renderer-svg.js` (cluster node: stack plate, sectors; outlines layer; node permissions in `moveBy`; bundle ids; `select` payload gains `x`, `y`, `ctrl`)
- Modify: `assets/js/app.js` (`state.hidden`, `state.bundles`, `shown()`, `labelOf` for a cluster; bundle clicks left to cluster-ui)
- Modify: `assets/css/60-architecture.css`
- Modify: `crates/effractor-server/templates/shell.html` only if the renderer needs `clusters.js` earlier (it loads before `renderer-svg.js`? — `clusters.js` requires `edit.js`, which loads after the renderer; the renderer calls `C.segments`/`C.arc` only at draw time, so it may read `window.effractorClusters` lazily; do that).
- Test: `scripts/renderer.test.js` (only if it has a fake DOM that draws components; add a cluster node case there if so)

**Interfaces:**
- Consumes: Task 3's described shape and `C.segments`, `C.arc`, `positions.outline`.
- Produces: `app.shown(id) → drawn id`; `state.hidden`, `state.bundles`; renderer `select` events `{id, parent, edge?, x, y, ctrl}`.

- [ ] **Step 1: Renderer — the cluster node**

In `drawComponent(g, n)`, before the halo:

```js
      // A cluster: a second plate peeks out behind, so it reads as a stack.
      if (n.cluster) el("circle", { cx: cx + 6, cy: r - 6, r: r }, ["plate", "plate-behind"], g);
```

Replace the rings loop with:

```js
      var ringR = r + geometry.halo + geometry.ring;
      if (n.cluster) {
        // A sector per member (or per state, when many): how many are what.
        var C = window.effractorClusters;
        C.segments(n.cluster.states).forEach(function (s) {
          var cls = ["ring", "sector", "sector-" + (s.state || "none")];
          if (s.full) el("circle", { cx: cx, cy: r, r: ringR }, cls, g);
          else el("path", { d: C.arc(cx, r, ringR, s.from, s.to) }, cls, g);
        });
      } else {
        (n.rings || []).forEach(function (ring) {
          el("circle", { cx: cx, cy: r, r: ringR }, ["ring", "ring-" + ring.state], g);
        });
      }
```

The pin group gets its member: `{ "data-pin-role": p.role, "data-pin-state": p.state, "data-pin-entity": p.entity || "" }`. In `drawNode`, the component tooltip for a cluster: `n.cluster ? n.label + " — " + n.cluster.count + " components" : n.label + " — " + n.component`, then the unknown and ring lines as today. Add class `is-cluster` when `n.cluster`.

In `graph.js` `fromStress`, a cluster node with any sector state is ringed: `hub: n && ((n.rings && n.rings.length) || (n.cluster && n.cluster.states.some(Boolean))) ? ringed : hub`.

- [ ] **Step 2: Renderer — outlines and node permissions**

In `mount`, add a layer before the edges: `groupLayer = el("g", {}, ["groups"], viewport);` (declare `var groupLayer = null;`). In `render`, `groupLayer.replaceChildren();` and, in the free branch:

```js
        drawn.outlines = [];
        (layout.outlines || []).forEach(function (o) {
          // Selected by its edge or its name, never by its inside: a press
          // within it is on the members or pans.
          var g = el("g", { "data-id": o.id }, ["node", "cluster-outline"], groupLayer);
          var box = el("rect", { x: o.x, y: o.y, width: o.width, height: o.height, rx: 16 }, ["outline"], g);
          var name = el("text", { x: o.x + 12, y: o.y - 6 }, ["outline-label"], g);
          name.textContent = o.label;
          el("title", {}, [], g).textContent = o.label + " — open cluster";
          drawn.outlines.push({ group: o, box: box, name: name });
          drawn.nodes[o.id] = g;
        });
```

(`drawn` gets `outlines: []` in its initial object.) In `moveBy`, after the attachments, redraw outlines holding `id`:

```js
      (drawn.outlines || []).forEach(function (d) {
        if (d.group.members.indexOf(id) < 0) return;
        var o = routes.outline(free.at, d.group);
        if (!o) return;
        d.box.setAttribute("x", o.x);
        d.box.setAttribute("y", o.y);
        d.box.setAttribute("width", o.width);
        d.box.setAttribute("height", o.height);
        d.name.setAttribute("x", o.x + 12);
        d.name.setAttribute("y", o.y - 6);
      });
```

and make the attachment redraw condition include node permissions: `if (a.permit.firewall !== id && a.permit.node !== id && !(flow && (flow.from === id || flow.to === id))) return;` with `routes.attach(free.at, flow ? flow.now : null, a.permit)` (it handles `node`). In `drawAttachment`, `"data-to": a.node || a.flow`.

`drawn.nodes[o.id]` makes highlights (selection) reach the outline; `free.at` has no entry for it, so it never moves (the press-drag on it pans nothing and moves nothing; a click selects it).

- [ ] **Step 3: Renderer — the select payload**

In `pointerup`, the click emit becomes:

```js
        if (!g.moved) return emit("select", g.edge ? { id: g.edge.to, parent: g.edge.from, edge: g.edge.id, x: e.clientX, y: e.clientY, ctrl: !!(e.ctrlKey || e.metaKey) } : { id: g.id, parent: undefined, x: e.clientX, y: e.clientY, ctrl: !!(e.ctrlKey || e.metaKey) });
```

- [ ] **Step 4: CSS**

In `assets/css/60-architecture.css`, beside `.ring-vulnerable`:

```css
/* A cluster: a plate behind its plate, and its ring in sectors, one per
   member (clustering spec §4.1). */
.node-component .plate-behind { opacity: 0.55; }
.node-component .sector { stroke-linecap: butt; }
.node-component .sector-vulnerable { stroke: var(--color-danger); }
.node-component .sector-unknown { stroke: var(--color-warning); }
.node-component .sector-none { stroke: var(--color-border); }
.edge[data-id^="flows/"] { stroke-dasharray: 5 3; }
.cluster-outline .outline { fill: none; stroke: var(--color-border); stroke-width: 1.5; pointer-events: stroke; }
.cluster-outline .outline-label { font-size: 11px; fill: var(--color-text-muted); pointer-events: all; }
.cluster-outline.hl-selected .outline { stroke: var(--color-accent); stroke-width: 2; }
```

Check the token names exist (`grep -n "\-\-color-border\|--color-text-muted\|--color-accent" assets/css/00-tokens.css`) and use what the file uses for quiet lines and muted text. Add a *cluster* entry to the bottom-bar legend beside *vulnerable* only if the legend lists ring states (`grep -n "ring-sample" -r assets crates/effractor-server/templates`), with an amber sample for *unknown inputs*.

- [ ] **Step 5: App — where a member is drawn**

In `assets/js/app.js`:

- `state` gains `hidden: null, bundles: null`.
- In `draw()`, after `described = … describe(state.doc, stateWord)`: `state.hidden = described.hidden || null; state.bundles = described.bundles || null;` (for trees and the attack view set both to `null`).
- ```js
  // Where `id` is drawn: a member of a closed cluster is drawn as the cluster.
  function shown(id) {
    var q = P.qualified(id);
    return q && q.kind === "entity" && state.hidden && Object.prototype.hasOwnProperty.call(state.hidden, q.id) ? state.hidden[q.id] : id;
  }
  ```
  Use it in `select()`: `renderer.highlight(state.selected ? [shown(state.selected)] : [], "selected")`, the route highlight `…route(state.doc, flow).map(shown)`, and both `renderer.reveal(shown(state.selected), …)` calls in the architecture view. Export `window.effractor.shown = shown;`.
- In the renderer `select` handler, first line: `if (e.edge && /^(links|flows|permits)\//.test(e.edge)) return; // cluster-ui.js opens what the line holds`.
- In `labelOf`, for an architecture: `if (q && q.kind === "cluster" && state.doc.clusters && Object.prototype.hasOwnProperty.call(state.doc.clusters, q.id)) return window.effractorClusters.label(state.doc, q.id);`

- [ ] **Step 6: Checks**

Run: `npm test && node --check assets/js/renderer-svg.js assets/js/app.js && git diff assets/js | grep '^-' | grep -v '^---'`
Expected: tests PASS; read every deleted line in the diff and make sure each was meant to go.

- [ ] **Step 7: Commit and the owner's look**

```bash
git add assets/js/renderer-svg.js assets/js/app.js assets/js/graph.js assets/css/60-architecture.css
git commit -m "Draw clusters: a stacked node with ring sectors, open outlines"
```

Start the preview on 8081 (`ss -ltnp | grep 8081` first; `cargo run -p effractor-server -- --bind 127.0.0.1:8081`). Give the owner a clustered example to paste into the source view — the imported-router fixture with `clusters:` written by hand (produce it with `node -e` from `C.build(require('./scripts/fixtures/nmap/imported-router.doc.json'))` and the wasm serializer, or write the YAML block by hand). Ask them to look at: closed clusters (router icon on the opnsense box, stack plate, sectors), counted lines, dotted permissions to a cluster, an open cluster's outline, selecting a member from the outline list lights its cluster. **Wait for their word before Task 5.**

---

### Task 5: Select several — owner looks

**Files:**
- Modify: `assets/js/renderer-svg.js` (group drag, Shift + drag rectangle, `pick` event, `pointAt`)
- Modify: `assets/js/app.js` (`state.picked`, `pick`, ctrl-click, Esc, inspector visibility, `positionsOf`, `putPositions`)
- Modify: `assets/js/architecture-ui.js` (Del on several / a cluster; inspector and context hooks; `KEYS`)
- Create: `assets/js/cluster-ui.js` (the "n components" inspector section; grows in Task 6)
- Modify: `crates/effractor-server/templates/shell.html` (load `cluster-ui.js` after `architecture-links-ui.js`, before `attacker-pins.js`), `crates/effractor-server/src/shell.rs` (order)
- Modify: `assets/css/60-architecture.css` (marquee)

**Interfaces:**
- Consumes: `C.within`, `C.entitiesOf`, `L.removeAll`, `app.shown`.
- Produces: `app.state.picked: string[]` (qualified `entity/…` or `cluster/…`; one entry when one thing is selected); `app.pick(ids, add)`; `app.positionsOf(ids) → {id: {x, y}}`; `app.putPositions(map)`; renderer events `pick {ids, add}`, `move` per moved node; `renderer.pointAt(clientX, clientY) → {x, y}` in drawing coordinates; `U.sections.picked(form)`; `U.contextHooks: [fn(e) → handled]`; `U.backgroundItems: [fn() → items]`.

- [ ] **Step 1: Renderer — rectangle, group drag, `pointAt`**

- `EVENTS` gains `"pick"`; declare `var marquee = null;`.
- ```js
    // Client coordinates → drawing coordinates.
    function pointAt(cx, cy) {
      var box = svg.getBoundingClientRect();
      return { x: (cx - box.left - view.x) / view.k, y: (cy - box.top - view.y) / view.k };
    }
  ```
  and return it from the renderer.
- `pointerdown`: after building `gesture`,
  ```js
        // Shift + drag on empty canvas: a selection rectangle (a free layout only).
        if (free && e.shiftKey && !gesture.id && !gesture.edge) gesture.rect = pointAt(e.clientX, e.clientY);
        // A selected component among several carries the others along.
        var lit = highlights.selected || {};
        if (free && gesture.id && lit[gesture.id] && Object.keys(lit).length > 1) {
          gesture.group = Object.keys(lit).filter(function (id) { return free.at[id]; });
        }
  ```
- `pointermove`: after the capture lines, before the free-move branch:
  ```js
        if (gesture.rect) {
          var p = pointAt(e.clientX, e.clientY), r = gesture.rect;
          if (!marquee) marquee = el("rect", {}, ["marquee"], viewport);
          marquee.setAttribute("x", Math.min(r.x, p.x));
          marquee.setAttribute("y", Math.min(r.y, p.y));
          marquee.setAttribute("width", Math.abs(p.x - r.x));
          marquee.setAttribute("height", Math.abs(p.y - r.y));
          gesture.to = p;
          return;
        }
  ```
  Keep `svg.classList.add(…)` from adding `is-panning` for a rectangle (`gesture.rect ? "is-picking" : …`). In the free-move branch: `(gesture.group || [gesture.id]).forEach(function (id) { moveBy(id, dx / view.k, dy / view.k); });`.
- `pointerup`: first, for a rectangle:
  ```js
        if (g.rect) {
          if (marquee) marquee.remove();
          marquee = null;
          svg.classList.remove("is-picking");
          if (!g.moved) return emit("select", { id: null, parent: undefined, x: e.clientX, y: e.clientY, ctrl: false });
          svg.releasePointerCapture(e.pointerId);
          var nodes = Object.keys(free.at).map(function (id) { return free.at[id]; });
          return emit("pick", { ids: window.effractorClusters.within(nodes, { x0: g.rect.x, y0: g.rect.y, x1: g.to.x, y1: g.to.y }), add: !!(e.ctrlKey || e.metaKey) });
        }
  ```
  and the free move end: `(g.group || [g.id]).forEach(function (id) { var p = free.at[id]; if (p) emit("move", { id: id, x: p.x, y: p.y }); });`.
- `pointercancel`: remove the marquee too.
- CSS: `.marquee { fill: var(--color-accent-dim, rgba(0,0,0,0.04)); stroke: var(--color-accent); stroke-dasharray: 4 3; pointer-events: none; }` (use existing tokens).

- [ ] **Step 2: App — the picked set**

In `assets/js/app.js`:

- `state.picked = []`.
- `select(id, parent, keepPicked)`: after `state.selected = …`, `if (!keepPicked) state.picked = state.selected ? [state.selected] : [];`; the selected highlight becomes `renderer.highlight(state.picked.map(shown), "selected")`; the inspector: `$("inspector").hidden = !state.selected && state.picked.length < 2;`.
- ```js
  // Several at once (clustering spec §3), in the architecture view only:
  // `ids` qualified; `add` keeps what was picked.
  function pick(ids, add) {
    if (!P.isArchitecture(state.doc) || attackShown()) return;
    var next = add ? state.picked.slice() : [];
    ids.forEach(function (id) {
      if ((id.indexOf("entity/") === 0 || id.indexOf("cluster/") === 0) && P.selectionExists(state.doc, id, null) && next.indexOf(id) < 0) next.push(id);
    });
    setPicked(next);
  }
  function togglePick(id) {
    var next = state.picked.slice();
    var at = next.indexOf(id);
    if (at >= 0) next.splice(at, 1);
    else if (P.selectionExists(state.doc, id, null)) next.push(id);
    setPicked(next);
  }
  function setPicked(list) {
    state.picked = list;
    select(list.length === 1 ? list[0] : null, undefined, true);
  }
  ```
- Renderer `select` handler: after the bundle guard, `if (e.ctrl && e.id && P.isArchitecture(state.doc) && !attackShown() && /^(entity|cluster)\//.test(e.id)) return togglePick(e.id);`
- `renderer.on("pick", function (e) { pick(e.ids, e.add); });`
- `renderer.on("move", …)` already stores every moved id.
- Esc: in the document keydown, the `Escape` branch becomes `closeFileMenu(); if (P.isArchitecture(state.doc) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.closest(".menu") && !document.querySelector("dialog[open]") && (state.selected || state.picked.length)) select(null);`
- Positions for Task 6:
  ```js
  // Where drawn nodes stand now: dragged positions over the last layout.
  function positionsOf(ids) {
    var stored = P.isArchitecture(state.doc) ? positions.load(state.doc.name) : {};
    var out = {};
    var laid = state.placed ? state.placed.nodes : [];
    ids.forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(stored, id)) return (out[id] = stored[id]);
      var n = laid.filter(function (x) { return x.id === id; })[0];
      if (n) out[id] = { x: n.x, y: n.y };
    });
    return out;
  }
  function putPositions(map) {
    Object.keys(map).forEach(function (id) {
      positions.move(state.doc.name, id, map[id].x, map[id].y);
    });
  }
  ```
  In `paint()`, keep what was placed: `state.placed = window.effractorPositions.place(…); return renderer.render(state.placed, {});`.
- Export `pick`, `positionsOf`, `putPositions`, and `positions` load: `window.effractor.storedPositions = function () { return positions.load(state.doc.name); };`.

- [ ] **Step 3: architecture-ui — Del, inspector and context hooks, keys**

In `assets/js/architecture-ui.js`:

- `remove()`:
  ```js
  function remove() {
    var picked = app.state.picked || [];
    var q = selection();
    if (picked.length > 1 || (q && q.kind === "cluster")) {
      var members = window.effractorClusters.entitiesOf(doc(), picked.length > 1 ? picked : [app.state.selected]);
      return apply(function () {
        return L.removeAll(doc(), members);
      }, null, true);
    }
    if (!q || !COLLECTION[q.kind]) return;
    apply(function () {
      return L.remove(doc(), COLLECTION[q.kind], q.id);
    }, null, true);
  }
  ```
- Key handler: `if ((key === "Delete" || key === "Backspace") && (selection() || (app.state.picked || []).length > 1))`.
- Rail: `rail.deleteNode.disabled = !selection() && (app.state.picked || []).length < 2;` and its title for several: `"Delete " + app.state.picked.length + " (Del)"`.
- `renderProperties()`, first thing after `form.replaceChildren();`:
  ```js
    if ((app.state.picked || []).length > 1 && sections.picked) {
      form.hidden = false;
      sections.picked(form);
      return;
    }
  ```
  (`q.kind === "cluster"` already reaches `sections[q.kind]` once Task 6 fills `sections.cluster`.)
- Context: `var contextHooks = [];` and at the top of the `context` handler (after the attack/arch guard): `for (var i = 0; i < contextHooks.length; i++) if (contextHooks[i](e)) return;`.
- `backgroundMenu`: `var items = [ …today's three… ]; backgroundItems.forEach(function (more) { items = items.concat(more()); }); app.showMenu(items, x, y);` with `var backgroundItems = [];`.
- `KEYS` gains `["Ctrl-click", "Add to the selection, or take out"]`, `["Shift + drag", "Select in a rectangle"]`, `["Del", "Delete, with its links"]` stays (it now covers several).
- Export `contextHooks: contextHooks, backgroundItems: backgroundItems` in `window.effractorArchitectureUi`.

- [ ] **Step 4: `cluster-ui.js` — the "n components" section**

```js
// Clusters and several selected components (clustering spec §3, §5): the
// inspector's sections, the rail's cluster button, keys and menus. The
// edits are clusters.js's; this is the DOM.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var C = window.effractorClusters;
  var P = window.effractorProfiles;
  var icons = window.effractorArchitectureIcons;

  function doc() {
    return app.state.doc;
  }
  function $(id) {
    return document.getElementById(id);
  }

  // A row per component: its icon and name; a click selects it.
  function row(list, id, extra) {
    var e = doc().entities[id];
    var item = document.createElement("li");
    var sample = icons.svg(document, e.kind, 18);
    sample.setAttribute("class", sample.getAttribute("class") + " is-plate");
    item.appendChild(sample);
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = e.label;
    item.appendChild(name);
    item.title = e.label + " · " + e.kind;
    item.addEventListener("click", function (ev) {
      if (ev.target.closest("button")) return;
      app.select("entity/" + id);
    });
    if (extra) extra(item);
    list.appendChild(item);
    return item;
  }

  U.sections.picked = function (form) {
    var members = C.entitiesOf(doc(), app.state.picked);
    $("inspector-name").textContent = members.length + " components";
    var list = document.createElement("ul");
    list.className = "cluster-members";
    members.forEach(function (id) {
      row(list, id);
    });
    form.appendChild(list);
  };

  window.effractorClusterUi = { row: row };
})();
```

CSS: `.cluster-members { list-style: none; margin: 0; padding: 0; } .cluster-members li { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; } .cluster-members .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`.

- [ ] **Step 5: Checks**

Run: `npm test && node --check assets/js/*.js && git diff assets/js | grep '^-' | grep -v '^---'`
Expected: PASS; every deleted line meant.

- [ ] **Step 6: Commit and the owner's look**

```bash
git add assets/js/renderer-svg.js assets/js/app.js assets/js/architecture-ui.js assets/js/cluster-ui.js assets/css/60-architecture.css crates/effractor-server/templates/shell.html crates/effractor-server/src/shell.rs
git commit -m "Select several components: ctrl-click, rectangle, drag and delete together"
```

Restart the preview (shell.html changed). Ask the owner to try: Ctrl-click three components; Shift + drag a rectangle (and Shift + Ctrl to add); drag one of the selected (all move); Del (one notice, one Ctrl+Z); Esc; a plain drag on empty canvas still pans. **Wait for their word before Task 6.**

---

### Task 6: Cluster actions — owner looks

**Files:**
- Modify: `assets/js/cluster-ui.js` (rail K, keys C/K, menus, cluster inspector, bundle menu, drag a member out, in-place positions)
- Modify: `assets/js/attacker-pins.js` (pins on and onto clusters)
- Modify: `crates/effractor-server/templates/shell.html` (rail button)
- Modify: `assets/css/60-architecture.css` (member ghost)

**Interfaces:**
- Consumes: everything above; `U.apply`, `U.field`, `U.input`, `U.menuItems`, `U.contextHooks`, `U.backgroundItems`, `U.keyList`, `app.positionsOf`, `app.putPositions`, `app.storedPositions`, `app.renderer.pointAt`, `app.state.bundles`.
- Produces: the finished feature.

- [ ] **Step 1: The rail button**

In `shell.html`, after the `linkComponent` button:

```html
    <button class="tool architecture-only" type="button" data-action="clusterAll" title="Cluster · uncluster all (K)" aria-label="Cluster or uncluster all"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5a2 2 0 012-2h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2zM6 6.5h.01M10 6.5h.01M8 9.5h.01"/></svg></button>
```

(Draw the three dots as small circles if `h.01` does not show with the rail's stroke style — check how other rail icons draw a dot.)

- [ ] **Step 2: Edits with positions kept in place**

In `cluster-ui.js`:

```js
  var SIZE = window.effractorGraph.SIZE;

  // Before an edit lands: a cluster closing stands amid its members, a
  // cluster opening puts them round where it stands (spec §4.3).
  function inPlace(before, after) {
    var was = before.clusters || {}, now = after.clusters || {};
    Object.keys(now).forEach(function (cid) {
      var c = now[cid];
      var old = Object.prototype.hasOwnProperty.call(was, cid) ? was[cid] : null;
      var q = function (m) { return "entity/" + m; };
      if (c.closed && (!old || !old.closed)) {
        var at = app.positionsOf(c.members.map(q));
        var boxes = Object.keys(at).map(function (k) { return at[k]; });
        app.putPositions(at); // the members keep their places for opening
        var centre = C.closeAt(boxes);
        if (centre) {
          var put = {};
          put["cluster/" + cid] = centre;
          app.putPositions(put);
        }
      } else if (!c.closed && old && old.closed) {
        var here = app.positionsOf(["cluster/" + cid])["cluster/" + cid];
        if (!here) return;
        var stored = app.storedPositions();
        var mine = {};
        c.members.forEach(function (m) {
          if (Object.prototype.hasOwnProperty.call(stored, "entity/" + m)) mine[m] = stored["entity/" + m];
        });
        var moved = C.reopen(here, c.members, mine);
        var put2 = {};
        Object.keys(moved).forEach(function (m) { put2["entity/" + m] = moved[m]; });
        app.putPositions(put2);
      }
    });
  }

  // Every cluster edit: `select: undefined` keeps what is selected.
  function act(build) {
    return U.apply(function () {
      var edit = build();
      if (!edit) return null;
      if (edit.select === undefined) edit.select = app.state.selected;
      inPlace(doc(), edit.doc);
      return edit;
    }, null, true);
  }

  function toggleAll() {
    if (!C.toggleAll(doc())) return app.say("nothing runs together here · select two or more and press C");
    act(function () { return C.toggleAll(doc()); });
  }
  function buildMissing() {
    if (!C.build(doc())) return app.say("nothing more runs together");
    act(function () { return C.build(doc()); });
  }
  function clusterPicked() {
    var members = C.entitiesOf(doc(), app.state.picked || []);
    if (members.length < 2) return app.say("select two or more to cluster · Ctrl-click or Shift + drag");
    act(function () { return C.make(doc(), members); });
  }
  function selectedCluster() {
    var q = P.qualified(app.state.selected);
    return q && q.kind === "cluster" && doc().clusters && Object.prototype.hasOwnProperty.call(doc().clusters, q.id) ? q.id : null;
  }
  function openClose(cid) {
    act(function () { return C.setClosed(doc(), cid, !doc().clusters[cid].closed); });
  }
```

- [ ] **Step 3: Keys and the rail**

```js
  document.querySelector('[data-action="clusterAll"]').addEventListener("click", function () {
    if (P.isArchitecture(doc())) toggleAll();
  });

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || !P.isArchitecture(doc()) || app.state.mode === "attack" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || e.target.closest(".menu") || document.querySelector("dialog[open]")) return;
    var key = e.key.toLowerCase();
    if (key === "k") {
      e.preventDefault();
      return toggleAll();
    }
    if (key === "c") {
      e.preventDefault();
      var cid = selectedCluster();
      return cid ? openClose(cid) : clusterPicked();
    }
  });
  U.keyList.push(["C", "Cluster the selected; open or close a cluster"], ["K", "Cluster · uncluster all"]);
```

(`app.state.mode === "attack"` — use the same check architecture-ui uses for the attack view.)

- [ ] **Step 4: Menus**

```js
  // A component's menu: cluster what is selected, or take it out of its own.
  U.menuItems.push(function (id) {
    var items = [];
    var picked = app.state.picked || [];
    if (picked.length > 1) items.push(["Cluster " + C.entitiesOf(doc(), picked).length + " components", "C", clusterPicked]);
    var cid = C.clusterOf(doc(), id);
    if (cid) {
      var name = C.label(doc(), cid);
      items.push(["Take out of “" + name + "”", "", function () { act(function () { return C.takeOut(doc(), cid, id); }); }]);
      if (!doc().clusters[cid].closed) items.push(["Close “" + name + "”", "", function () { openClose(cid); }]);
    }
    return items;
  });

  function clusterMenu(cid, x, y) {
    app.select("cluster/" + cid);
    var c = doc().clusters[cid];
    var name = C.label(doc(), cid);
    app.showMenu([
      [c.closed ? "Open" : "Close", "C", function () { openClose(cid); }],
      ["Rename", "F2", function () { var f = $("prop-cluster-label"); if (f) { f.focus(); f.select(); } }],
      ["Take out", "", { items: function () {
        return c.members.filter(function (m) { return doc().entities[m]; }).map(function (m) {
          return [doc().entities[m].label, "", function () { act(function () { return C.takeOut(doc(), cid, m); }); }];
        });
      } }],
      ["Dissolve", "", function () { act(function () { return C.dissolve(doc(), cid); }); }],
      ["Show in source", "", function () { app.showSourcePath("clusters." + cid); }],
      ["Delete “" + name + "” and " + c.members.length + " components", "Del", function () {
        U.apply(function () { return window.effractorArchitectureLinks.removeAll(doc(), c.members.slice()); }, null, true);
      }],
    ], x, y);
  }

  function pickedMenu(x, y) {
    var n = C.entitiesOf(doc(), app.state.picked).length;
    app.showMenu([
      ["Cluster " + n + " components", "C", clusterPicked],
      ["Delete " + n + " components", "Del", function () {
        var members = C.entitiesOf(doc(), app.state.picked);
        U.apply(function () { return window.effractorArchitectureLinks.removeAll(doc(), members); }, null, true);
      }],
    ], x, y);
  }

  U.contextHooks.push(function (e) {
    var q = P.qualified(e.id);
    if (e.edge) return false;
    if (q && q.kind === "cluster") {
      clusterMenu(q.id, e.x, e.y);
      return true;
    }
    var picked = app.state.picked || [];
    if (picked.length > 1 && picked.indexOf(e.id) >= 0) {
      pickedMenu(e.x, e.y);
      return true;
    }
    return false;
  });

  U.backgroundItems.push(function () {
    return [["Cluster · uncluster all", "K", toggleAll], ["Cluster what runs together", "", buildMissing]];
  });

  // A merged line: which of its lines.
  app.renderer.on("select", function (e) {
    if (!e.edge || !/^(links|flows|permits)\//.test(e.edge) || !app.state.bundles) return;
    var held = app.state.bundles[e.edge] || [];
    app.showMenu(held.map(function (id) {
      return [app.labelOf(id), "", function () { app.select(id); }];
    }), e.x, e.y);
  });
```

- [ ] **Step 5: The cluster inspector, with members to drag out**

```js
  U.sections.cluster = function (form, cid) {
    var c = doc().clusters[cid];
    var label = U.field(form, "prop-cluster-label", "Label", U.input("text", c.label || ""));
    label.placeholder = C.label(doc(), cid);
    label.addEventListener("change", function () {
      act(function () { return C.rename(doc(), cid, label.value); });
    });
    label.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== "Escape") return;
      ev.preventDefault();
      if (ev.key === "Escape") label.value = c.label || "";
      label.blur();
    });
    var shown = U.field(form, "prop-cluster-closed", "Shown", window.effractorMenu.dropdown([["closed", "closed"], ["open", "open"]], c.closed ? "closed" : "open"));
    shown.addEventListener("change", function () {
      act(function () { return C.setClosed(doc(), cid, shown.value === "closed"); });
    });
    var list = document.createElement("ul");
    list.className = "cluster-members";
    c.members.filter(function (m) { return doc().entities[m]; }).forEach(function (m) {
      row(list, m, function (item) {
        var out = document.createElement("button");
        out.type = "button";
        out.className = "btn-icon";
        out.textContent = "×";
        out.title = "Take out";
        out.addEventListener("click", function () {
          act(function () { return C.takeOut(doc(), cid, m); });
        });
        item.appendChild(out);
        item.addEventListener("pointerdown", function (ev) {
          if (ev.button === 0 && !ev.target.closest("button")) startDrag(cid, m, ev);
        });
      });
    });
    form.appendChild(list);
  };
```

Check `window.effractorMenu.dropdown`'s option format against `SWITCH` in architecture-ui.js and match it.

The drag (after attacker-pins.js's gesture):

```js
  var DRAG_PX = 4;
  var drag = null; // {cid, member, x, y, moved, ghost, over}

  function clusterAt(x, y) {
    var hit = document.elementFromPoint(x, y);
    var node = hit && hit.closest ? hit.closest("#canvas .node") : null;
    var q = node ? P.qualified(node.getAttribute("data-id")) : null;
    return q && q.kind === "cluster" ? q.id : null;
  }
  function overCanvas(x, y) {
    var hit = document.elementFromPoint(x, y);
    return !!(hit && hit.closest && hit.closest("#canvas") && !hit.closest("#inspector"));
  }
  function startDrag(cid, member, ev) {
    drag = { cid: cid, member: member, x: ev.clientX, y: ev.clientY, moved: false, ghost: null, over: null };
  }
  function endDrag() {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    app.renderer.highlight([], "pin-drop");
    document.body.classList.remove("is-pinning");
    drag = null;
  }
  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "member-ghost";
      drag.ghost.textContent = doc().entities[drag.member].label;
      document.body.appendChild(drag.ghost);
      document.body.classList.add("is-pinning");
    }
    drag.ghost.style.setProperty("--pin-x", e.clientX + "px");
    drag.ghost.style.setProperty("--pin-y", e.clientY + "px");
    var over = clusterAt(e.clientX, e.clientY);
    if (over !== drag.over) {
      drag.over = over;
      app.renderer.highlight(over && over !== drag.cid ? ["cluster/" + over] : [], "pin-drop");
    }
  });
  document.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var d = drag;
    endDrag();
    if (!d.moved) return; // a click: the row's own click selects it
    var into = clusterAt(e.clientX, e.clientY);
    if (into && into !== d.cid) return act(function () { return C.moveTo(doc(), d.member, into); });
    if (!overCanvas(e.clientX, e.clientY)) return;
    var p = app.renderer.pointAt(e.clientX, e.clientY);
    var put = {};
    put["entity/" + d.member] = { x: Math.round(p.x - SIZE.width / 2), y: Math.round(p.y - SIZE.plate / 2) };
    app.putPositions(put);
    act(function () { return C.takeOut(doc(), d.cid, d.member); });
  });
  document.addEventListener("pointercancel", endDrag);
  document.addEventListener("keydown", function (e) {
    if (drag && e.key === "Escape") {
      e.stopPropagation();
      endDrag();
    }
  }, true);
```

CSS: `.member-ghost` as `.pin-ghost` is styled (`grep -n "pin-ghost" assets/css/*.css`), using the same `--pin-x/--pin-y` placement, with neutral colours.

- [ ] **Step 6: Pins and clusters (`attacker-pins.js`)**

- Picking up: `from = { entity: pin.getAttribute("data-pin-entity") || q.id, state: pin.getAttribute("data-pin-state") };`.
- `entityAt` becomes `targetAt(x, y) → {entity} | {cluster} | null` (a `cluster/…` node gives `{cluster: id}`); `hover` lights `"cluster/" + id` for a cluster.
- On a drop onto a cluster (spec §4.1):
  ```js
  function dropOnCluster(role, cid, from, x, y) {
    var c = doc().clusters[cid];
    U.loadCatalog().then(function (catalog) {
      var items = c.members.filter(function (m) { return doc().entities[m]; }).map(function (m) {
        var e = doc().entities[m];
        var spec = (catalog.entities || []).filter(function (s) { return s.kind === e.kind; })[0];
        var states = spec ? spec.states : [];
        if (!states.length) return null;
        if (states.length === 1) return [e.label, "", function () { place(role, m, states[0], from); }];
        return [e.label, "", states.map(function (s) {
          return [window.effractorWords.state(catalog, s), "", function () { place(role, m, s, from); }];
        })];
      }).filter(Boolean);
      if (!items.length) return app.say("no member of “" + window.effractorClusters.label(doc(), cid) + "” takes a pin");
      app.showMenu([[role + " on …", "", null]].concat(items), x, y);
    }, function () {
      app.say("the component library could not be read");
    });
  }
  ```
  (a nested list as the third item makes a submenu — the menu's `[label, key, items]` form; check `menu.js`/`app.showMenu` for the exact shape.)

- [ ] **Step 7: Checks**

Run: `npm test && node --check assets/js/*.js && git diff assets/js | grep '^-' | grep -v '^---'`
Expected: PASS; every deleted line meant.

- [ ] **Step 8: Commit and the owner's look**

```bash
git add assets/js/cluster-ui.js assets/js/attacker-pins.js assets/css/60-architecture.css crates/effractor-server/templates/shell.html
git commit -m "Cluster from the rail, keys and menus; drag members out"
```

Restart the preview. The owner's list:
1. Import the router fixture's scan (or paste the doc) and press K: everything collapses by host; K again opens all, again closes all.
2. Shift + drag round three components, C: one cluster; its inspector lists them; × takes one out; drag a member out onto the canvas: it stands there with its lines; drag one onto another cluster: it moves in.
3. Right-click a cluster: Open/Close, Rename, Take out ›, Dissolve, Delete.
4. Drag a foothold onto a closed cluster: the member menu, states as a submenu.
5. Click a counted line: the menu of its lines.
6. The attack graph and the results are the same with everything clustered (compare the headline before and after K).
**Wait for their word.**

---

### Task 7: Land it

**Files:**
- Modify: `ROADMAP.md` (delete `clustering` with `scripts/dev/roadmap-done.py clustering`; the Canvas section goes if empty)
- Modify: `docs/HANDOFF.md` (a "Continuation — clustering (2026-09-24)" section at the top: the file field, `clusters.js`, `cluster-ui.js`, `state.picked`, `app.shown`, owner decisions from the looks, deferred minors)

- [ ] **Step 1: Full checks**

Run each separately, unpiped:
`scripts/build-wasm.sh`, `npm test`, `cargo test --workspace`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `node scripts/check-roadmap.js`, `node scripts/check-graph-agreement.js` (if it is part of the local checks).
Expected: all PASS.

- [ ] **Step 2: A fresh review**

Dispatch a fresh reviewer (superpowers:requesting-code-review) on the branch against `master`; fix what it finds, with tests where it is logic.

- [ ] **Step 3: Ship on the owner's word**

`scripts/dev/ship.sh` (or by hand: commit, push the branch, open the PR, `scripts/dev/wait-ci.sh ci.yml <sha>` unpiped, then on the owner's "merge": `git fetch && git branch -f master origin/master` is blocked here, so `git checkout master && git merge --ff-only <branch>` after checking `git log master -1` equals `origin/master`, push, `wait-ci.sh release.yml <sha>`).
