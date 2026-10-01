# securiCAD Extract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lecture extract's sections 5.3–5.5 rebuild in the page figure by figure — an access-control object, IDS/IPS, products on hosts and applications, the host defences and attack steps of its figures, a foothold on an account, containment — while every existing file generates the same graph and numbers.

**Architecture:** Additive extension of `core-components` version 1 along the pattern of `cbbeff0` (person and data): a kind, link, state, slot or switch is declared once in `effractor-core::architecture` and answered from there by the validator, the reader/writer, the catalog and the generator; the page reads the catalog for words. New slots on existing kinds are *optional* (absent = not drawn), which is what leaves existing files unchanged. Containment is a cluster with a `head`; generation never reads it.

**Tech Stack:** Rust 1.95 edition 2024 (indexmap, serde_json, libm; no new dependency), wasm-bindgen module in `assets/wasm`, vanilla JS tested with `node --test`, ELK vendored.

**Spec:** [2026-09-30-securicad-extract-design.md](../specs/2026-09-30-securicad-extract-design.md), approved by the owner 2026-09-30.

## Global Constraints

- "`core-components`, version stays 1: the change is additive."
- "**Nothing generated changes for an existing file** — the lecture fixture's numbers and every frozen fingerprint stay where a file draws none of the new things."
- "Every slot this spec adds to a kind that already exists … is marked `optional: true` in the catalog: absent means the step is not drawn; unknown means drawn and withheld." Slots on new kinds are required.
- "A grant straight to a machine stays valid and means the same."
- "Nothing by being near: a host with no reachable service is not reachable."
- Unknown YAML keys are errors except `x-`; no panics on user input; no recursion on document-sized input; `libm` only; ChaCha8 convention untouched (no solver change in this plan).
- Plain words on the page come from the catalog (`word`, `name`, `title`, `meaning`), never ids; no native select/datalist; no vendor names in product copy (the extract's product names live in fixtures only).
- Every branch: `scripts/build-wasm.sh`, `npm test`, `cargo test --workspace`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `node scripts/check-roadmap.js`, solver tests under wasmtime, `node scripts/check-graph-agreement.js`; `node scripts/graph-fixtures.js --write` when the catalog or the lecture fixture changes (Rust tests pin `scripts/fixtures/catalog.json` and `lecture-doc.json`).
- Rules recorded as this repository lands work: one branch per plan branch, test-first, a fresh review, the owner's look on a preview (port 8081/8082), exact-SHA CI, fast-forward, release. `CONTRIBUTING.md`.

## Review Focus

Five things the spec implies that no task's tests would exercise by accident; each has its pinning test in the task named:

1. A file with `grants` to an access control **and** the same account granted straight to the machine: one grant, not two edges with two origins (Task A3, test `a_grant_through_access_control_and_on_the_machine_is_one_grant`).
2. A product shared by a service and its host (Ubuntu Linux runs sshd on the same host): `exploit-ready` is one fact, the host's and the service's deploy steps both read it, and the host's step is absent until `deploy-exploit` is given (Task B4, `a_product_shared_by_host_and_service_is_found_once`).
3. An IDS on a router that is *not* on the flow's route must not guard that flow (Task C2, `a_sensor_off_the_route_guards_nothing`).
4. Anti-malware *unknown* on a host with no product and no service: no step, no unknown withheld (the optional/unknown rule only applies where a step exists) (Task C3, `an_unknown_switch_with_nothing_to_guard_costs_nothing`).
5. A foothold on an account whose `mfa` is on and that has no second-factor credential: the account is held but never authenticated; the target rests on nothing unknown (Task D5, `a_held_account_behind_mfa_without_a_second_factor_stays_out`).

---

## File map

| Area | File | Responsibility |
|---|---|---|
| Core | `crates/effractor-core/src/architecture.rs` | `EntityKind`, `State`, `Slot`, `Defense`, `Defenses`, `Relation`, `RelationKind`, `Flow`: the vocabulary and what each kind may carry |
| Core | `crates/effractor-core/src/architecture_validate.rs` | Endpoint kinds, one-per rules, foothold/target states, flow fields |
| Format | `crates/effractor-format/src/architecture_read.rs`, `architecture_write.rs` | Word tables (`KINDS`, `RELATIONS`, `STATES`, `SLOTS`, `DEFENSES`, `EXTRAS`), reading/writing new fields |
| Catalog | `crates/effractor-components/src/catalog.rs` | `RULES`, kind/relation/slot/defense words, `optional` |
| Generator | `crates/effractor-components/src/generate.rs` | One method per rule family; `Builder` indexes |
| Page | `assets/js/architecture-icons.js`, `architecture-links.js`, `architecture-edit.js`, `architecture-view.js`, `architecture-ui.js`, `architecture-links-ui.js`, `attacker-pins.js`, `clusters.js`, `cluster-ui.js`, `vocabulary.js` | Icons and families; link words and choices; adding; shown slots/switches; forms; pins; clusters with a head |
| Fixtures | `scripts/fixtures/catalog.json`, `scripts/fixtures/graph/*.json`, `scripts/fixtures/architecture.doc.json`, `docs/course/*.yaml`, `crates/effractor-components/tests/fixtures/` | Pinned to the real module; the old lecture fixture frozen |

Pinned catalog: after any catalog change run `scripts/build-wasm.sh && node scripts/graph-fixtures.js --write` and commit `scripts/fixtures/` with the Rust change, else `cargo test` fails on the pinned JSON.

---

# Branch A — `access-control` (spec §3.1, §6)

### Task A1: The kind and its link in core and format

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs` (`EntityKind`, `RelationKind`, `Relation`)
- Modify: `crates/effractor-core/src/architecture_validate.rs`
- Modify: `crates/effractor-format/src/architecture_read.rs`, `architecture_write.rs`
- Test: `crates/effractor-core/tests/architecture.rs`, `crates/effractor-format/tests/architecture.rs`

**Interfaces:**
- Produces: `EntityKind::AccessControl` (`"access-control"`, no states, no slots, no defense); `RelationKind::ControlsAccess` (`"controls-access"`, from `Host | Router`, to `AccessControl`); `Relation::ControlsAccess { from, to }`; `RelationKind::Grants.to_kinds()` = `[Host, Router, AccessControl]`.
- Validator: one `controls-access` per machine and per access control (code `Code::Duplicate`, as `filters`); a `grants` to an access control that no machine controls is `Code::Incomplete` ("nothing controls access through it yet").

- [ ] **Step 1: Failing core tests**

```rust
// crates/effractor-core/tests/architecture.rs
#[test]
fn an_access_control_is_a_kind_with_nothing_of_its_own() {
    use effractor_core::architecture::{EntityKind, RelationKind};
    assert_eq!(EntityKind::AccessControl.as_str(), "access-control");
    assert!(EntityKind::AccessControl.states().is_empty());
    assert!(EntityKind::AccessControl.slots().is_empty());
    assert_eq!(EntityKind::AccessControl.defenses(), &[]);
    assert_eq!(RelationKind::ControlsAccess.from_kinds(), &[EntityKind::Host, EntityKind::Router]);
    assert_eq!(RelationKind::ControlsAccess.to_kinds(), &[EntityKind::AccessControl]);
    assert!(RelationKind::Grants.to_kinds().contains(&EntityKind::AccessControl));
}
```

(`defenses()` replaces `defense()` in Task B1; until then assert `defense().is_none()`.)

```rust
// crates/effractor-format/tests/architecture.rs
const WITH_ACCESS_CONTROL: &str = r#"
effractor: 2
profile: architecture
name: ac
time_unit: d
horizon: 10
library: {id: core-components, version: 1}
entities:
  r: {kind: router, label: R}
  ac: {kind: access-control, label: R login}
  a: {kind: account, label: Root}
associations:
  r-ac: {kind: controls-access, from: r, to: ac}
  root: {kind: grants, from: a, to: ac, privilege: admin}
flows: {}
attacker:
  footholds: [{entity: r, state: admin}]
  target: {entity: r, state: admin}
"#;

#[test]
fn an_access_control_round_trips() {
    let doc = load_ok(WITH_ACCESS_CONTROL);
    let text = effractor_format::write_document(&doc);
    assert!(text.contains("kind: access-control"));
    assert!(text.contains("kind: controls-access"));
    assert_eq!(load_ok(&text), doc);
}

#[test]
fn a_second_access_control_on_one_machine_is_refused() {
    let text = WITH_ACCESS_CONTROL.replace(
        "  r-ac: {kind: controls-access, from: r, to: ac}\n",
        "  r-ac: {kind: controls-access, from: r, to: ac}\n  ac2: {kind: access-control, label: Two}\n  r-ac2: {kind: controls-access, from: r, to: ac2}\n",
    ).replace("  a: {kind: account, label: Root}\n", "  a: {kind: account, label: Root}\n");
    let d = load_err(&text);
    assert!(d.iter().any(|d| d.path == "associations.r-ac2" && d.message.contains("already")), "{d:?}");
}

#[test]
fn a_grant_to_an_uncontrolled_access_control_is_incomplete() {
    let text = WITH_ACCESS_CONTROL.replace("  r-ac: {kind: controls-access, from: r, to: ac}\n", "");
    let d = diagnostics(&text);
    assert!(d.iter().any(|d| d.path == "associations.root" && d.code == "incomplete"), "{d:?}");
}
```

Use the file's existing helpers (`load_ok`, `load_err`, `diagnostics`); if a name differs, use that file's.

- [ ] **Step 2: Run** `cargo test -p effractor-core --test architecture an_access_control && cargo test -p effractor-format --test architecture access_control` — Expected: compile errors, `AccessControl` and `ControlsAccess` unknown.

- [ ] **Step 3: Implement.** In `architecture.rs`: add `AccessControl` to `EntityKind` and `ALL` (12), `as_str` → `"access-control"`, `states()` → `&[]`, `slots()` → `&[]`, `defense()` → `None`; add `ControlsAccess` to `RelationKind` and `ALL` (20), `as_str` → `"controls-access"`, `from_kinds` → `&[K::Host, K::Router]`, `to_kinds` → `&[K::AccessControl]`, fields none; `Grants` `to_kinds` → `&[K::Host, K::Router, K::AccessControl]`; add `Relation::ControlsAccess { from: EntityId, to: EntityId }` and its arms in `kind()`, `from()`, `to()`. In `architecture_validate.rs`: index `controls-access` by `from` and by `to`, error `Code::Duplicate` on the second of either ("{from} already controls access through {first}" / "{to} is already controlled by {first}"); for `Grants { to }` whose kind is `AccessControl`, if no `controls-access` names it, `self.incomplete(at, "nothing controls access through \"{to}\" yet: link a host or router to it")`. In the format: `KINDS` gains `("access-control", EntityKind::AccessControl)`, `RELATIONS` gains `("controls-access", RelationKind::ControlsAccess)`, the reader's match gains `RelationKind::ControlsAccess => Relation::ControlsAccess { from, to }`; the writer needs nothing (no fields).

- [ ] **Step 4: Run** the tests of step 2 — Expected: PASS. Run `cargo test -p effractor-core -p effractor-format` — Expected: all pass (existing fixtures unchanged).

- [ ] **Step 5: Commit** `git add crates/effractor-core crates/effractor-format` — "An access control: where accounts log in to a machine, in the file".

### Task A2: The catalog knows it

**Files:**
- Modify: `crates/effractor-components/src/catalog.rs`
- Test: `crates/effractor-components/tests/catalog.rs`
- Regenerate: `scripts/fixtures/catalog.json`

**Interfaces:**
- Produces: catalog entity `access-control` (family identity on the page: `architecture-icons.js` FAMILY, Task A5), `meaning` "Where accounts log in to a machine: its user database, its login."; association `controls-access` description "The access control of one machine; accounts are granted on it. One per machine."; `grants` description extended: "… `to` is the machine, or its access control, which means the same."

- [ ] **Step 1: Failing test**

```rust
// crates/effractor-components/tests/catalog.rs
#[test]
fn the_catalog_describes_access_control() {
    let c = effractor_components::catalog::catalog();
    let e = c.entities.iter().find(|e| e.kind == "access-control").expect("kind");
    assert_eq!(e.meaning, "Where accounts log in to a machine: its user database, its login.");
    assert!(e.states.is_empty() && e.parameters.is_empty() && e.defenses.is_empty());
    let a = c.associations.iter().find(|a| a.kind == "controls-access").expect("assoc");
    assert_eq!(a.from, ["host", "router"]);
    assert_eq!(a.to, ["access-control"]);
}
```

- [ ] **Step 2: Run** `cargo test -p effractor-components --test catalog describes_access_control` — Expected: FAIL, no such kind.
- [ ] **Step 3: Implement** `kind_description`, `kind_meaning`, `relation_description` arms; the entity list is derived from `EntityKind::ALL`, so the kind appears once the arms exist (the `match` is exhaustive — the compiler names every arm to add).
- [ ] **Step 4: Run** step 2 — PASS. Then `scripts/build-wasm.sh && node scripts/graph-fixtures.js --write && cargo test -p effractor-components` — Expected: all pass with the regenerated `scripts/fixtures/catalog.json`.
- [ ] **Step 5: Commit** — "The catalog says what an access control is".

### Task A3: A grant through an access control is a grant on its machine

**Files:**
- Modify: `crates/effractor-components/src/generate.rs` (`Builder::new` indexes `grant`, `grants_on`; `logins`, `administration`)
- Test: `crates/effractor-components/tests/generation.rs`, `tests/provenance.rs`

**Interfaces:**
- Consumes: `Relation::ControlsAccess`, `Relation::Grants { to: access-control }`.
- Produces: `Builder.machine_of_access: HashMap<&EntityId, (&EntityId, &AssociationId)>` (access control → machine, controls-access association). `grant` and `grants_on` are keyed by the **machine** whether the grant names it or its access control; the entry's association list carries both ids when it went through an access control. No new rule id; `session-grant` and `administration-login` origins list the `controls-access` association too.

- [ ] **Step 1: Failing tests**

```rust
// crates/effractor-components/tests/generation.rs
fn lecture_with_access_control() -> Architecture {
    // The lecture's router grant routed through an access control.
    let text = LECTURE
        .replace("associations:\n", "associations:\n  bridge-ac:\n    kind: controls-access\n    from: bridge\n    to: bridge-login\n")
        .replace("  router-grant:\n    kind: grants\n    from: admin-account\n    to: bridge\n", "  router-grant:\n    kind: grants\n    from: admin-account\n    to: bridge-login\n")
        .replace("entities:\n", "entities:\n  bridge-login:\n    kind: access-control\n    label: Router login\n");
    architecture(&text)
}

#[test]
fn a_grant_through_an_access_control_generates_the_same_graph() {
    let direct = generate(&architecture(LECTURE)).unwrap();
    let through = generate(&lecture_with_access_control()).unwrap();
    let ids = |g: &GeneratedGraph| g.graph.nodes.iter().map(|n| (n.id.clone(), n.inputs.clone())).collect::<Vec<_>>();
    assert_eq!(ids(&direct), ids(&through));
}

#[test]
fn a_grant_through_access_control_and_on_the_machine_is_one_grant() {
    let mut m = lecture_with_access_control();
    // The same account granted admin straight on the router too.
    let dup = "router-grant-direct".parse().unwrap();
    m.associations.insert(dup, Association { relation: Relation::Grants { from: "admin-account".parse().unwrap(), to: "bridge".parse().unwrap(), privilege: Privilege::Admin }, extensions: Default::default() });
    let g = generate(&m).unwrap();
    let admin = g.graph.nodes.iter().find(|n| n.id == "state/router/bridge/admin").unwrap();
    let from_login = admin.inputs.iter().filter(|i| i.starts_with("action/administration-login/")).count();
    assert_eq!(from_login, 1, "one administration login, not one per grant");
}
```

```rust
// crates/effractor-components/tests/provenance.rs
#[test]
fn a_login_through_an_access_control_names_both_links() {
    let g = generate(&lecture_with_access_control()).unwrap(); // share the helper via a `mod common` or duplicate it here
    let step = g.graph.nodes.iter().find(|n| n.id == "action/administration-login/admin-net/admin-account/bridge").unwrap();
    let o = step.origins.iter().find(|o| o.rule == "administration-login").unwrap();
    assert!(o.associations.iter().any(|a| a == "router-grant"));
    assert!(o.associations.iter().any(|a| a == "bridge-ac"));
}
```

- [ ] **Step 2: Run** `cargo test -p effractor-components access_control` — Expected: FAIL (first: generation refuses or differs; second: two logins or a panic on an unknown grant target).
- [ ] **Step 3: Implement.** In `Builder::new`: first pass collects `machine_of_access` from `Relation::ControlsAccess`; when indexing `Relation::Grants { from, to, privilege }`, resolve `to` → machine: `let (machine, via) = match self.machine_of_access.get(to) { Some((m, ca)) => (*m, Some(*ca)), None => (to, None) };` then `grant.entry((from, machine)).or_insert((privilege, aid, via))` (first wins in document order; extend the tuple with `via: Option<&AssociationId>`) and `grants_on[machine].push(...)` only if `(from, machine)` was not already present. In `logins` and `administration`, when building the origin, `associations` gets `via` appended when `Some`.
- [ ] **Step 4: Run** step 2 — PASS; `cargo test -p effractor-components -p effractor-solver` — all pass, every frozen fingerprint unchanged (a moved fingerprint here means the direct-grant path changed: fix the index, never the fingerprint).
- [ ] **Step 5: Commit** — "A grant through an access control is a grant on its machine".

### Task A4: Reference-safe removal and link choices on the page

**Files:**
- Modify: `assets/js/architecture-links.js` (`WORDS`, `linkChoices`, `remove`), `assets/js/architecture-edit.js` (adding a host or router offers *with an access control*)
- Test: `scripts/architecture-links.test.js`, `scripts/architecture-edit.test.js`

**Interfaces:**
- Consumes: `scripts/fixtures/catalog.json` (regenerated in A2: `controls-access` with from/to).
- Produces: `WORDS["controls-access"] = { out: "its access control", in: "controls access to" }`; `linkChoices(doc, catalog, accountId)` offers `grants` to an access control when the machine has one and hides the machine then (one entry, the extract's shape); `remove(doc, accessControlId)` removes its `controls-access` and every `grants` to it; `addLinked(doc, catalog, machineId, "access-control")` creates the kind and the `controls-access` link in one edit.

- [ ] **Step 1: Failing tests**

```js
// scripts/architecture-links.test.js
test('an account links to the machine's access control, not both', () => {
  const doc = fixture(); // the lecture doc fixture
  const withAc = L.addLinked(doc, catalog, 'bridge', 'access-control');
  const choices = L.linkChoices(withAc.doc, catalog, 'admin-account').filter(c => c.kind === 'grants');
  const out = choices.find(c => c.direction === 'out').candidates;
  assert.ok(out.includes(withAc.entity), 'the access control is offered');
  assert.ok(!out.includes('bridge'), 'the machine behind it is not offered twice');
  assert.ok(out.includes('server'), 'a machine without one is still offered');
});

test('removing an access control takes its link and its grants along', () => {
  const doc = fixture();
  const a = L.addLinked(doc, catalog, 'bridge', 'access-control');
  const g = L.putAssociation(a.doc, catalog, { kind: 'grants', from: 'admin-account', to: a.entity, privilege: 'admin' });
  const r = L.remove(g.doc, a.entity);
  assert.equal(Object.values(r.doc.associations).filter(x => x.to === a.entity).length, 0);
  assert.ok(!r.doc.entities[a.entity]);
});

test('the words for an access control read from either side', () => {
  assert.equal(L.phrase('controls-access', 'out'), 'its access control');
  assert.equal(L.phrase('controls-access', 'in'), 'controls access to');
});
```

- [ ] **Step 2: Run** `node --test scripts/architecture-links.test.js` — Expected: 3 FAIL.
- [ ] **Step 3: Implement** in `architecture-links.js`: `WORDS["controls-access"]`; in `linkChoices`, for `spec.kind === "grants"` with direction `out`, filter candidates: drop a machine that has a `controls-access` whose `to` exists (`accessControlOf(doc, machine)`); `remove` already takes associations from/to a deleted entity — assert it covers `controls-access` and `grants` (it walks all associations by from/to, so likely already green: if the second test passes before the code, note it in the ledger and keep it as the regression). `addLinked` gets the `controls-access` case (kind `access-control` from a host/router).
- [ ] **Step 4: Run** step 2 — PASS; `npm test` — all pass.
- [ ] **Step 5: Commit** — "The Link menu offers a machine's access control in place of the machine".

### Task A5: Icon, family, add menu, pin refusal

**Files:**
- Modify: `assets/js/architecture-icons.js` (icon: a badge with a keyhole; FAMILY identity), `assets/js/attacker-pins.js` (a kind with no states takes no pin), `assets/js/vocabulary.js` (nothing: words come from the catalog)
- Test: `scripts/architecture-icons.test.js`, `scripts/attacker-pins.test.js` (create if absent, following `scripts/architecture-edit.test.js`'s harness)

- [ ] **Step 1: Failing tests**

```js
// scripts/architecture-icons.test.js
test('every catalog kind has an icon and a family', () => {
  for (const e of catalog.entities) {
    assert.ok(I.icon(e.kind), e.kind + ' icon');
    assert.ok(I.family(e.kind), e.kind + ' family');
  }
});
test('an access control is identity, like an account', () => {
  assert.equal(I.family('access-control'), I.family('account'));
});
```

```js
// scripts/attacker-pins.test.js
test('a kind with no states takes no pin', () => {
  const doc = withAccessControl();
  assert.equal(P.placePin(doc, catalog, 'foothold', 'bridge-login'), null);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (no icon; `placePin` throws or returns an edit).
- [ ] **Step 3: Implement**: `ICONS["access-control"]` = a rounded rect with a keyhole (`["rect",{x:4,y:5,width:16,height:14,rx:2}], ["circle",{cx:12,cy:11,r:1.8}], ["path",{d:"M12 12.5V16"}]`); `FAMILY["access-control"] = "identity"`; `placePin` returns `null` when `spec.states.length === 0` (the existing branch that reads `spec.states`).
- [ ] **Step 4: Run** — PASS; `npm test` — all pass.
- [ ] **Step 5: Commit** — "An access control has an icon, a family and no pin".

### Task A6: Containment — a cluster with a head

**Files:**
- Modify: `assets/js/clusters.js` (`make(doc, members, name, head)`, `head(doc, clusterId)`, `adopt(doc, machineId, memberId)`), `assets/js/cluster-ui.js` (drop onto a host/router; closed drawing shows the head's icon and name; *Inside* section in the head's inspector), `crates/effractor-format/src/architecture_read.rs` + `architecture_write.rs` + `crates/effractor-core/src/architecture.rs` (`Cluster.head: Option<EntityId>`, must be a member), `crates/effractor-core/src/architecture_validate.rs`
- Test: `scripts/clusters.test.js`, `crates/effractor-format/tests/architecture.rs`

**Interfaces:**
- Produces: file `clusters.<id>.head: <entity>` (optional); JS `C.adopt(doc, head, member) → {doc, select}`: creates a cluster `{members:[head, member], head, name: <head's label>, open: true}` or adds `member` to the cluster headed by `head`; `C.headOf(doc, clusterId) → entity id | null`; `C.release(doc, member)` removes it from its headed cluster (deletes the cluster when only the head is left).

- [ ] **Step 1: Failing tests**

```rust
// crates/effractor-format/tests/architecture.rs
#[test]
fn a_cluster_head_round_trips_and_must_be_a_member() {
    let text = LECTURE.replace("analysis:\n", "clusters:\n  router-box:\n    name: Router\n    members: [bridge, filter]\n    head: bridge\nanalysis:\n");
    let doc = load_ok(&text);
    assert!(effractor_format::write_document(&doc).contains("    head: bridge\n"));
    let bad = text.replace("head: bridge", "head: server");
    let d = load_err(&bad);
    assert!(d.iter().any(|d| d.path == "clusters.router-box.head" && d.message.contains("member")), "{d:?}");
}
```

(Adjust the `clusters:` shape to what `clusters.js` writes today — read one from `scripts/clusters.test.js` first.)

```js
// scripts/clusters.test.js
test('dropping a component onto a router puts both in a cluster headed by the router', () => {
  const doc = lecture();
  const r = C.adopt(doc, 'bridge', 'filter');
  const cluster = Object.values(r.doc.clusters)[0];
  assert.deepEqual(cluster.members.sort(), ['bridge', 'filter']);
  assert.equal(cluster.head, 'bridge');
  const r2 = C.adopt(r.doc, 'bridge', 'admin-account');
  assert.equal(Object.keys(r2.doc.clusters).length, 1);
  assert.deepEqual(Object.values(r2.doc.clusters)[0].members.sort(), ['admin-account', 'bridge', 'filter']);
});
test('releasing the last member dissolves the headed cluster', () => {
  const r = C.adopt(lecture(), 'bridge', 'filter');
  const out = C.release(r.doc, 'filter');
  assert.equal(Object.keys(out.doc.clusters).length, 0);
});
test('a headed cluster shows its head, closed', () => {
  const r = C.adopt(lecture(), 'bridge', 'filter');
  const id = Object.keys(r.doc.clusters)[0];
  assert.equal(C.headOf(r.doc, id), 'bridge');
  assert.equal(C.closedLabel(r.doc, id), 'Router · 1 inside');
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** core `Cluster { head: Option<EntityId> }`, validator "head must be a member", reader/writer key `head`; JS `adopt`, `release`, `headOf`, `closedLabel` in `clusters.js`; `cluster-ui.js`: on drag end over a host/router that is not the dragged one, call `adopt` (the existing drag code in `positions.js`/`cluster-ui.js` knows the drop target; find `onDrop`/`dragEnd`); closed drawing uses the head's icon (`architecture-icons`) and `closedLabel`; the head's inspector gets an *Inside* list with a *Take out* action per member (`release`).
- [ ] **Step 4: Run** `npm test`, `cargo test --workspace` — PASS. Owner looks: the extract's Fig. 5.20 gesture.
- [ ] **Step 5: Commit** — "Elements inside a machine: a cluster with a head".

### Task A7: Branch A checks, review, look, landing

- [ ] Run every required check (Global Constraints). Run `scripts/graph-fixtures.js --write`; commit regenerated fixtures if any changed (only `catalog.json` should).
- [ ] Fresh review of the branch (Review Focus 1 pinned in A3).
- [ ] Preview for the owner with a five-line walkthrough: add a router, Tab → *with an access control*; account → *grants it admin* → the access control; drop the firewall and the access control onto the router; open the cluster; generate — the graph is the same as with a direct grant.
- [ ] PR, exact-SHA CI, fast-forward, release. Update `docs/HANDOFF.md` with a continuation section.

---

# Branch B — `host-products` (spec §3.3, §4 ASLR/DEP, §5.1 optional slots)

### Task B1: Many switches per kind

Today `EntityKind::defense() -> Option<Defense>` and the page shows one (`shownDefense`). Hosts get six switches in this spec, so the kind answers a list.

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs` (`defenses(self) -> &'static [Defense]`, keep `defense()` as `defenses().first().copied()` until every caller moved, then delete it), `crates/effractor-core/src/architecture_validate.rs` (a switch not in the kind's list is `Code::MisplacedKey`), `crates/effractor-components/src/catalog.rs` (`Entity.defenses: Vec<DefenseWord>` replaces `defense: Option<…>`), `assets/js/architecture-view.js` (`shownDefenses(doc, id) -> [names]`), `assets/js/architecture-ui.js` (one dropdown row per switch), `assets/js/architecture-edit.js` (a new component gets every switch at `unknown`), `assets/js/comparison-ui.js` (the *Set a defence* picker lists every switch of a kind)
- Test: `crates/effractor-core/tests/architecture.rs`, `crates/effractor-components/tests/catalog.rs`, `scripts/architecture-view.test.js`, `scripts/architecture-edit.test.js`, `scripts/comparison.test.js`

**Interfaces:**
- Produces: `EntityKind::defenses(self) -> &'static [Defense]`; catalog JSON `entities[].defenses: [id, …]` (was `defense: id | null`); JS `V.shownDefenses(doc, id) → string[]` (was `shownDefense`).

- [ ] **Step 1: Failing tests** — core: `assert_eq!(EntityKind::Product.defenses(), &[Defense::Patched]); assert_eq!(EntityKind::Host.defenses(), &[]);` catalog: `assert_eq!(product.defenses, ["patched"])`; JS: `assert.deepEqual(V.shownDefenses(doc, 'openssh'), ['patched'])`, and `A.addEntity(doc, catalog, 'product').doc.entities[id].defenses` equals `{patched: 'unknown'}` (unchanged behaviour through the new shape).
- [ ] **Step 2: Run** — FAIL (no `defenses`).
- [ ] **Step 3: Implement** the rename in every caller the compiler and `grep -n "shownDefense\|\.defense\b" assets/js scripts` find; the page's inspector loops over `shownDefenses`, each row labelled with the catalog's `word`.
- [ ] **Step 4: Run** `cargo test --workspace`, `npm test`, `node scripts/graph-fixtures.js --write` (catalog.json shape changes) — PASS.
- [ ] **Step 5: Commit** — "A kind may have several switches".

### Task B2: Optional slots

Optional is a property of a slot **on a kind**: `deploy-exploit` is required on
a service (as today) and optional on a host or an application (Task B3).

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs` (`Slot::optional(self, kind: EntityKind) -> bool`, `false` for every existing slot and kind), `crates/effractor-components/src/catalog.rs` (`parameters[].optional_on: [kind, …]` in the JSON, empty for every existing slot), `crates/effractor-components/src/generate.rs` (`Builder::has_slot(&self, entity: &EntityId, slot: Slot) -> bool` = `!slot.optional(self.kind(entity)) || self.m.entities[entity].parameters.contains_key(&slot)`), `assets/js/architecture-edit.js` (adding a component writes only the slots not optional on its kind), `assets/js/architecture-view.js` (`slotRows(doc, catalog, id)`: an absent optional slot is a row `{slot, absent: true, note: "not drawn until a time is given"}`), `assets/js/architecture-ui.js` (draws that row; filling it writes the parameter)
- Test: `crates/effractor-core/tests/architecture.rs`, `crates/effractor-components/tests/catalog.rs`, `scripts/architecture-edit.test.js`, `scripts/architecture-view.test.js`

**Interfaces:**
- Produces: `Slot::optional(self, kind: EntityKind) -> bool`; catalog `parameters[].optional_on: string[]`; `Builder::has_slot(&self, entity, slot) -> bool`; JS `V.slotRows(doc, catalog, id) → [{slot, absent?, note?}]`. No slot is optional in this task; B3 makes the first one. The JS is tested against a catalog altered in the test, the Rust helper through B3's tests.

- [ ] **Step 1: Failing tests**

```rust
// crates/effractor-core/tests/architecture.rs
#[test]
fn no_existing_slot_is_optional() {
    use effractor_core::architecture::{EntityKind, Slot};
    for kind in EntityKind::ALL {
        for slot in kind.slots() {
            assert!(!slot.optional(kind), "{} on {}", slot.as_str(), kind.as_str());
        }
    }
}
```

```rust
// crates/effractor-components/tests/catalog.rs
#[test]
fn every_parameter_says_where_it_is_optional() {
    let json = serde_json::to_value(effractor_components::catalog::catalog()).unwrap();
    for p in json["parameters"].as_array().unwrap() {
        assert_eq!(p["optional_on"], serde_json::json!([]), "{}", p["slot"]);
    }
}
```

```js
// scripts/architecture-edit.test.js
test('a new component leaves out the slots optional on its kind', () => {
  const altered = { ...catalog, parameters: catalog.parameters.map(p => p.slot === 'escape' ? { ...p, optional_on: ['host'] } : p) };
  const r = A.addEntity(emptyDoc(), altered, 'host');
  assert.ok(!('escape' in (r.doc.entities[r.entity].parameters || {})));
  const router = A.addEntity(emptyDoc(), altered, 'router');
  assert.ok('escape' in router.doc.entities[router.entity].parameters, 'still required on a router');
});
```

```js
// scripts/architecture-view.test.js
test('an absent optional slot is a row that says it is not drawn', () => {
  const altered = { ...catalog, parameters: catalog.parameters.map(p => p.slot === 'escape' ? { ...p, optional_on: ['host'] } : p) };
  const doc = hostWithoutEscape();
  assert.deepEqual(V.slotRows(doc, altered, 'server').find(r => r.slot === 'escape'), { slot: 'escape', absent: true, note: 'not drawn until a time is given' });
});
```

(Use the files' existing helpers for an empty document and the lecture document; `hostWithoutEscape` is the lecture doc with `server.parameters.escape` deleted.)

- [ ] **Step 2: Run** `cargo test -p effractor-core -p effractor-components optional && node --test scripts/architecture-edit.test.js scripts/architecture-view.test.js` — Expected: compile error (`optional` not defined), JS FAIL (`optional_on` ignored, `slotRows` undefined).
- [ ] **Step 3: Implement** as in Files; the catalog serializes `optional_on` from `EntityKind::ALL.filter(|k| slot.optional(*k))`.
- [ ] **Step 4: Run** step 2 — PASS; `scripts/build-wasm.sh && node scripts/graph-fixtures.js --write`; `cargo test --workspace && npm test` — PASS.
- [ ] **Step 5: Commit** — "A slot may be optional on a kind: absent is not drawn".

### Task B3: `instance-of` from a host or an application; reachability facts

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs` (`InstanceOf.from_kinds` → `[Service, Host, Application]`; `Slot::DeployExploit` allowed on Host and Application, optional there; new slots `DeployExploitAslr`, `DeployExploitDep` on Host and Service, optional), `architecture_validate.rs` (one product per instance already; nothing else), format tables (`SLOTS` + 2), catalog (slot words: "Use the exploit (ASLR)" / "Use the exploit (DEP)", descriptions; rules `host-reachable`, `application-reachable`, `host-deploy-exploit`, `application-deploy-exploit`; `product-reachable` prerequisites text), `generate.rs`
- Test: `crates/effractor-components/tests/generation.rs`, `tests/provenance.rs`, `crates/effractor-format/tests/architecture.rs`

**Interfaces:**
- Produces: facts `state/host/<id>/reachable`, `state/application/<id>/reachable`; actions `action/host-deploy-exploit/<host>`, `action/application-deploy-exploit/<app>`; rules ids as named; `Builder.product_of` keyed by any instance (host, application, service); `Builder.services_on: HashMap<&EntityId, Vec<&EntityId>>` (host → its services, via `host_of`).

- [ ] **Step 1: Failing tests**

```rust
// generation.rs
fn lecture_with_os() -> Architecture {
    let text = LECTURE
        .replace("entities:\n", "entities:\n  ubuntu:\n    kind: product\n    label: Ubuntu Linux\n    parameters:\n      find-exploit: {status: illustrative, ttc: \"Exponential(mean 20)\", note: exercise}\n      find-exploit-patched: {status: illustrative, ttc: \"Never\", note: exercise}\n    defenses: {patched: false}\n")
        .replace("associations:\n", "associations:\n  server-os:\n    kind: instance-of\n    from: server\n    to: ubuntu\n");
    architecture(&text)
}

#[test]
fn a_host_is_reachable_through_a_service_it_runs_and_not_by_being_near() {
    let g = generate(&lecture_with_os()).unwrap();
    let reach = node(&g, "state/host/server/reachable");
    assert_eq!(reach.inputs, ["state/service/sshd/reachable"]);
    assert!(g.graph.nodes.iter().all(|n| n.id != "state/host/workstation/reachable" || n.inputs.is_empty()), "no service runs on the workstation");
}

#[test]
fn an_os_exploit_is_absent_until_the_host_says_how_long_using_it_takes() {
    let g = generate(&lecture_with_os()).unwrap();
    assert!(node_opt(&g, "action/host-deploy-exploit/server").is_none(), "deploy-exploit is optional on a host");
    assert!(node_opt(&g, "action/product-find-exploit/ubuntu").is_some(), "the product's step is drawn: the product is reachable");
    let mut m = lecture_with_os();
    m.entities.get_mut(&"server".parse().unwrap()).unwrap().parameters.insert(Slot::DeployExploit, Parameter { status: Evidence::Unknown, ..Default::default() });
    let g = generate(&m).unwrap();
    let deploy = node(&g, "action/host-deploy-exploit/server");
    assert!(deploy.inputs.contains(&"state/product/ubuntu/exploit-ready".to_owned()));
    assert!(deploy.inputs.contains(&"state/host/server/reachable".to_owned()));
    assert_eq!(node(&g, "state/host/server/admin").inputs.iter().filter(|i| i.as_str() == "action/host-deploy-exploit/server").count(), 1);
}

#[test]
fn a_product_shared_by_host_and_service_is_found_once() {
    let mut m = lecture_with_os();
    // sshd is an instance of ubuntu too (a distribution package)
    let a = m.associations.get_mut(&"sshd-instance".parse().unwrap()).unwrap();
    a.relation = Relation::InstanceOf { from: "sshd".parse().unwrap(), to: "ubuntu".parse().unwrap() };
    m.entities.get_mut(&"server".parse().unwrap()).unwrap().parameters.insert(Slot::DeployExploit, Parameter::default());
    let g = generate(&m).unwrap();
    assert_eq!(g.graph.nodes.iter().filter(|n| n.id.starts_with("action/product-find-exploit/ubuntu")).count(), 1);
    assert!(node(&g, "action/service-deploy-exploit/sshd").inputs.contains(&"state/product/ubuntu/exploit-ready".to_owned()));
    assert!(node(&g, "action/host-deploy-exploit/server").inputs.contains(&"state/product/ubuntu/exploit-ready".to_owned()));
}

#[test]
fn the_lecture_fixture_generates_exactly_as_before() {
    let g = generate(&architecture(LECTURE)).unwrap();
    let frozen: serde_json::Value = serde_json::from_str(include_str!("../../../scripts/fixtures/graph/lecture-graph.json")).unwrap();
    assert_eq!(serde_json::to_value(&g.graph).unwrap(), frozen["graph"]);
}
```

(`node`, `node_opt` helpers: find by id in `g.graph.nodes`; add to the file if absent. The last test freezes the old fixture's graph as spec §8 demands — it must pass **before** this task's code changes and keep passing after; it belongs to the first commit of the task.)

- [ ] **Step 2: Run** `cargo test -p effractor-components --test generation` — Expected: the frozen test PASSES already (commit it: "The lecture's graph is frozen against this library's growth"), the other three FAIL (validator refuses `instance-of` from a host).
- [ ] **Step 3: Implement.** Core: `InstanceOf` from kinds; `Slot::DeployExploit` in `Host`'s and `Application`'s `slots()`; `Slot::optional` true for `DeployExploit` on host/application (`Slot::DeployExploit.optional(Host)` and `.optional(Application)` return true; `.optional(Service)` stays false — B2's `optional(self, kind)`). Generator: in `Builder::new` index `product_of` for any `InstanceOf.from`; `services_on[host]` from `host_of`; new method `reachability()` called after `flows()`: for each host with services, fact `host.reachable` with an edge from each service's `reachable` (rule `host-reachable`, origin lists the `hosts` associations); for each application, `application.reachable` ← its `contacted` fact if it is a reader and each of its own flows' `connected` (rule `application-reachable`); `products()` extends `product-reachable` to host/application instances; new `host_exploits()`: for each host with a product and `self.has_slot(host, Slot::DeployExploit)`, action `host-deploy-exploit` with inputs `[product.exploit-ready, host.reachable]` → `host.admin`, `Binding::Parameter { owner: host, base: DeployExploit, replacement: None }` (ASLR/DEP replacement comes in B4); likewise `application-deploy-exploit` → `application.control`. Catalog: the four rules with prerequisites/outputs as the spec §3.3 words them.
- [ ] **Step 4: Run** — PASS; `cargo test --workspace` — every fingerprint unchanged; regenerate `catalog.json`.
- [ ] **Step 5: Commit** — "An operating system is a product: a host or an application is an instance of one".

### Task B4: ASLR and DEP replace the time of using an exploit

**Files:**
- Modify: `architecture.rs` (`Defense::Aslr`, `Defense::Dep`; `Defenses.aslr`, `.dep`; `Host.defenses()` = `[Aslr, Dep]` for now), format `DEFENSES` + 2, catalog words ("ASLR" / "DEP", descriptions "Address-space randomization: `deploy-exploit-aslr` stands in for `deploy-exploit` on the host and its services." / "Data-execution prevention: `deploy-exploit-dep` stands in; with ASLR also on, ASLR's time is read."), `generate.rs` (`replacement` on `host-deploy-exploit` and `service-deploy-exploit`: the host's switch, ASLR first)
- Test: `generation.rs`, `provenance.rs`, `crates/effractor-solver/tests/graph_solve.rs` (a scenario switching ASLR on changes the curve)

**Interfaces:**
- Consumes: `Binding::Parameter.replacement: Option<(Defense, Slot)>` — one replacement per step, so the generator picks ASLR when the host's `aslr` is not Off, else DEP when `dep` is not Off: `fn deploy_replacement(&self, host) -> Option<(Defense, Slot)>`; the owner of the replacement switch is the **host** while the slot owner may be the **service** — `Binding::Parameter` gains `switch_owner: Option<EntityId>` (None = the slot owner), and `resolve.rs` reads the switch from it.

- [ ] **Step 1: Failing tests** — `a_service_on_an_aslr_host_reads_the_aslr_replacement`: with `server.defenses.aslr: true` and `sshd.parameters.deploy-exploit-aslr` given, the binding of `action/service-deploy-exploit/sshd` is `Parameter { owner: sshd, base: DeployExploit, replacement: Some((Aslr, DeployExploitAslr)), switch_owner: Some(server) }`; `aslr_wins_over_dep_when_both_are_on`; solver: `with_scenario(LECTURE_OS, "aslr")` moves the CDF and `delta.ci.lo > 0` with a slower ASLR time.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as above; `resolve.rs` `switch(model, overlay, switch_owner.unwrap_or(owner), defense)`.
- [ ] **Step 4: Run** `cargo test --workspace` and wasmtime — PASS, fingerprints unchanged (no existing file has `aslr`).
- [ ] **Step 5: Commit** — "ASLR and DEP: the time of using an exploit on that host is replaced".

### Task B5: Page — products on hosts and applications, switch rows, optional rows

**Files:**
- Modify: `assets/js/architecture-links.js` (`instance-of` choices from host/application: WORDS already has `is a version of`), `assets/js/architecture-view.js` (`shownSlots` shows optional absent rows; the *vulnerable* ring reads a host's product too), `assets/js/architecture-ui.js` (switch rows in Fig. 5.37's order for a host: ASLR, Anti-malware, DEP, Hardened, Host firewall, Static ARP tables — those that exist so far), `assets/js/nmap-products.js` if it maps an OS guess to a product (check: an OS guess on a host could now become an `instance-of`; **out of scope here**, note it in the handoff)
- Test: `scripts/architecture-links.test.js`, `scripts/architecture-view.test.js`

- [ ] **Step 1: Failing tests** — `linkChoices(doc, catalog, 'server')` has `instance-of` out with product candidates; `ringsIn(doc)` marks a host whose product is unpatched *vulnerable*; `slotRows` for a host lists `deploy-exploit` absent with the note.
- [ ] **Step 2–5**: RED → implement → `npm test` → commit "The page draws an operating system on a host".

### Task B6: Branch B checks, review, look, landing

- [ ] Required checks; regenerate fixtures; fresh review (Review Focus 2 pinned in B3); owner's look: put Ubuntu Linux on the server and Windows 7 on the workstation as in Fig. 5.28/5.35, give the server *Use the exploit*, generate, see the OS route; switch ASLR on in Compare.
- [ ] PR, CI, fast-forward, release, handoff.

---

# Branch C — `sensors` (spec §3.2, §4 Anti-malware)

### Task C1: Kinds `ids`, `ips`; link `watches`; switch `enabled`; slot `bypass`

**Files:** core (`EntityKind::Ids`, `Ips` — family network; states none; slot `Bypass` required; defense `Enabled`), validator (`watches` from Host|Router to Ids|Ips, any number), format tables, catalog (meanings "Watches traffic and reports what it recognizes." / "… and stops what it recognizes."; slot name "Get past it"; switch word "Enabled"; relation `watches` "A sensor on this machine's traffic: on a router, the flows through it; on a host, its own."), icons (an eye for IDS, an eye with a bar for IPS), links WORDS `watches: { out: "watched by", in: "watches" }`.
- Tests as in A1/A2/A5: round trip, catalog description, icon + family, pin refusal.
- Commit — "IDS and IPS: sensors a router or a host watches with".

### Task C2: Getting past a sensor on the route or on the host

**Files:** `generate.rs` (`Builder.sensors_on: HashMap<&EntityId, Vec<(&EntityId, &AssociationId)>>` machine → sensors; method `sensors()` after `flows()`: for each enabled-or-unknown sensor, fact `state/<kind>/<id>/bypassed` and action `action/sensor-bypass/<id>` bound `Parameter { owner: sensor, base: Bypass }` with a `Policy`-like gate: **the step exists only while `enabled` is On or Unknown** — implement as the action's prerequisite fact `state/<kind>/<id>/armed` produced by `Binding::Policy { entity: sensor, defense: Enabled }` inverted? `Policy` is "zero while off, never while on"; a sensor needs "the bypass is required while on". Do it as: the deploy step's input is an ANY fact `state/<kind>/<id>/passed` with two producers: the bypass action, and an input node `input/sensor-off/<id>` bound `Binding::Policy { entity, defense: Enabled }` (zero while Off → passed for free; never while On → the bypass is the only way; Unknown → unknown). This reuses the existing binding exactly; no solver change.) Then for each `service-deploy-exploit` whose flow's route crosses a router with sensors, or whose host has sensors, add each sensor's `passed` fact to its inputs; likewise `host-deploy-exploit` for the host's own sensors.
- Tests: `an_ids_on_the_route_must_be_got_past_before_the_exploit_is_used` (inputs of `action/service-deploy-exploit/sshd` include `state/ids/<id>/passed`; `passed` is ANY of the bypass action and the off-input); `a_sensor_off_the_route_guards_nothing` (IDS on a router not in `flows.ssh.route`: no edge); `a_disabled_sensor_costs_nothing` (solver: `enabled: false` → same numbers as no sensor, via `graph_solve.rs`); `an_unknown_sensor_withholds_the_number`; provenance names the `watches` association and the route's router.
- Commit — "An exploit over a watched flow gets past the sensor first".

### Task C3: Anti-malware on a host

**Files:** core (`Defense::AntiMalware`, `Slot::BypassAntimalware` optional on Host), format, catalog ("Anti-malware"; slot "Get past the anti-malware"; rule `antimalware-bypass`), `generate.rs` (same ANY-fact shape as C2: `state/host/<id>/malware-cleared` ← `action/antimalware-bypass/<host>` | `input/antimalware-off/<host>` (Policy); consumed by the host's `host-deploy-exploit` and by `service-deploy-exploit` of every service it runs — **only when `self.has_slot(host, Slot::BypassAntimalware)` or the switch is not Off**; with the switch On and the slot absent the step is unknown-withheld with the slot path named, since the author turned it on without saying how long).
- Tests: `anti_malware_on_the_server_guards_sshd_and_the_os`; `an_unknown_switch_with_nothing_to_guard_costs_nothing` (Review Focus 4: a host with no product and no service, `anti-malware: unknown` → no node, baseline available); `antimalware_on_without_a_time_withholds_and_names_the_slot`.
- Commit — "Anti-malware on a host: got past before an exploit is used there".

### Task C4: Page and landing

- Icons/families/words (C1 covers the pure parts); inspector rows; the owner's look: Fig. 5.18's IDS/IPS on the router, the server's anti-malware, the route in the attack graph shows *Get past the IDS*.
- Required checks, review (Review Focus 3, 4), PR, CI, release, handoff.

---

# Branch D — `host-steps` (spec §5.1–5.4, §4 Hardened / Host firewall / Static ARP tables)

### Task D1: Escalate privilege, Hardened

- Core: `Slot::Escalate`, `Slot::EscalateHardened` optional on Host; `Defense::Hardened` on Host. Catalog: rule `escalate` (*Escalate privilege*, `host.user` → `host.admin`, slot `escalate`, replaced by `(Hardened, EscalateHardened)`), words. Generator: `escalations()` for each host with `has_slot(escalate)`: action `action/escalate/<host>` inputs `[host.user]` → `host.admin`.
- Tests: `escalation_is_absent_until_a_host_says_how_long_it_takes`; `escalation_is_drawn_and_hardened_replaces_its_time`; `a_user_foothold_reaches_admin_only_through_escalation` (with the slot: `host.admin` has the escalate input; without: it does not — the frozen lecture test still passes).
- Commit — "Escalate privilege: user to admin on a host, hardened or not".

### Optional states (applies to D2, D3, D5)

Spec §5.2–5.4 add states to kinds that already exist (`physical` and `usb`
on a host, `unavailable` on a host and a service, `held` on an account).
`Builder::states()` draws a fact for every state a kind declares, so a
plain addition to `EntityKind::states()` would add nodes to every existing
graph. As with optional slots: `State::optional(self, kind) -> bool`
(true exactly for those four pairs), the validator accepts them where the
spec says (footholds: `physical`, `usb`, `held`; targets: `unavailable`),
and the generator draws an optional state's fact only when a foothold or
the target names it, or when the step that produces it is drawn (its
optional slot given). Catalog: `entities[].optional_states`. Interfaces:
`State::optional`, `Builder::draws_state(entity, state) -> bool`.

### Task D2: Physical and USB access (spec §5.2)

**Files:** core (`State::Physical`, `State::Usb` on Host, optional;
`Slot::Physical`, `Slot::Usb` optional on Host), validator (both are
foothold states only: a target naming them is `Code::UnknownState` with
"an attacker input, not a goal"), format `STATES`/`SLOTS` follow from
`as_str`, catalog (state words *at the machine* / *can plug into it*,
slot names *Physical access* / *USB access*, rules `physical-access`,
`usb-access`), `generate.rs` (`host_access()` after `admin_implies_user()`).

**Interfaces:** facts `state/host/<h>/physical`, `state/host/<h>/usb`;
actions `action/physical-access/<h>` (`[host.physical]` → `host.admin`,
`Binding::Parameter { owner: h, base: Physical }`), `action/usb-access/<h>`
(`[host.usb]` → `host.user`). Drawn only with the slot given; the fact is
drawn with the step or with a foothold naming it.

- [ ] **Step 1: Failing tests** (`provenance.rs`):
  `physical_access_is_drawn_only_once_a_host_says_how_long_it_takes_fig_5_33`
  (no slot: no node; slot unknown: the step reads `state/host/server/physical`
  and its time is withheld naming the slot);
  `a_usb_foothold_reaches_user_through_its_step` (foothold `{server, usb}`
  plus slot: `state/host/server/user` has `action/usb-access/server`);
  `nothing_but_a_foothold_puts_the_attacker_at_the_machine` (the
  `physical` fact has no producer but the foothold input); core:
  `physical_and_usb_are_optional_foothold_states_of_a_host`; format:
  round trip of a foothold `{entity: server, state: physical}` and the
  target refusal.
- [ ] **Step 2: Run** — Expected: compile errors, then FAIL.
- [ ] **Step 3: Implement** as in Files and *Optional states*.
- [ ] **Step 4: Run** `cargo test --workspace` — PASS; the lecture snapshot
  and every graph fixture unchanged; regenerate `catalog.json`.
- [ ] **Step 5: Commit** — "Physical and USB access: attacker inputs at the machine".

### Task D3: Denial of service (spec §5.3, first item)

**Files:** core (`State::Unavailable` on Host and Service, optional, a
target only; `Slot::Deny` optional on Host and Service), validator (a
foothold naming `unavailable` is refused), catalog (state word *out of
service*, rule `deny-service`, slot name *Deny service*), `generate.rs`
(`denials()` after `guards()`: for each host or service with `deny`
given, `action/deny-service/<id>` with input its `reachable` — a host's
from `host_reachable()` — → `state/<kind>/<id>/unavailable`).

- [ ] **Step 1: Failing tests:** `denial_of_service_is_a_target_only_fig_5_34`
  (the target `{sshd, unavailable}` validates, a foothold does not);
  `denial_is_drawn_once_deny_is_given_and_rests_on_reach` (inputs
  `[state/service/sshd/reachable]`; the host's from `host.reachable`);
  `a_host_that_runs_nothing_cannot_be_denied` (slot given, no service:
  no step, and the target is unreachable, not unknown).
- [ ] **Steps 2–5:** RED → implement → `cargo test --workspace` (frozen
  images unchanged) → commit "Denial of service: a target on a host or a
  service".

### Task D4: Static ARP tables and ARP cache poisoning (spec §5.3, §4)

**Files:** core (`Defense::StaticArp` optional on Host, word *Static ARP
tables*; `Slot::Poison` optional on Network; `Flow.encrypted: bool`
(default false, written only when true) and `Flow.carries: Vec<EntityId>`
(credentials; written only when non-empty)), validator (`carries` names
credentials; unknown flow keys stay errors), format (read/write the two
flow fields), catalog (rules `arp-poison`, `flow-intercept`,
`intercepted-credential`; slot *Poison the ARP cache*), `generate.rs`
(`interception()` after `flows()`).

**Interfaces:** `state/network/<n>/poisoned` ← `action/arp-poison/<n>`
(`[network.access]`, slot `poison` on the network); per flow that carries
something, is not encrypted, and whose route has a network with `poison`
given: `state/flow/<f>/exposed` = ANY of `input/static-arp-off/<host>` for
the source's and the target's host (`Binding::Policy { host, StaticArp }`,
absent = off) — so both ends must have static ARP on to close it, and a
scenario can switch it; `action/flow-intercept/<f>` (Logical, `[poisoned
of each such network (one ANY fact state/flow/<f>/overheard), exposed]`) →
`state/flow/<f>/intercepted`; `intercepted` → `credential.possessed` for
each carried credential that authenticates an account the target service
authorizes (rule `intercepted-credential`). Nothing carried, encrypted, or
no poisonable network on the route: nothing drawn.

- [ ] **Step 1: Failing tests:** `arp_poisoning_takes_a_carried_credential_off_a_plain_flow`;
  `an_encrypted_flow_gives_nothing_away` (the extract's SSH flow);
  `static_arp_on_both_ends_closes_interception_and_on_one_does_not`
  (resolve the two policy inputs: both On → the exposed fact is never);
  `a_flow_that_carries_nothing_is_not_intercepted`; format round trip of
  `encrypted: true` and `carries: [server-key]`, and `carries` naming an
  account refused.
- [ ] **Steps 2–5:** RED → implement → `cargo test --workspace` →
  regenerate fixtures → commit "ARP cache poisoning: what a plain flow
  carries, unless both ends keep static tables".

### Task D5: A foothold on an account (spec §5.4)

**Files:** core (`State::Held` on Account, optional, foothold only),
validator, catalog (state word *held*, rule `account-held`), `generate.rs`
(`account-held`: `state/account/<a>/held` → `state/account/<a>/material`,
drawn only for a foothold naming it).

- [ ] **Step 1: Failing tests:** `a_held_account_logs_in_like_its_credential_fig_5_33`
  (foothold `{server-account, held}`: the service login is possible without
  the key); Review Focus 5 `a_held_account_behind_mfa_without_a_second_factor_stays_out`
  (mfa on, no second factor: material yes, authenticated never, the
  target's number rests on nothing unknown); `held_is_not_a_target`.
- [ ] **Steps 2–5:** RED → implement → test → commit "A foothold on an
  account: the attacker holds what logs it in".

### Task D6: Host firewall (spec §4)

**Files:** core (`Defense::HostFirewall` optional on Host, word *Host
firewall*; `RelationKind::Permits.from_kinds` → `[Firewall, Host]`),
validator (a host's `permits` names a flow whose target runs on that host;
a flow into a service on a host whose `host-firewall` is said On or Unknown
in the file and that has no permission from it is `unfinished` with path
`flows.<f>.route`, as for a router's firewall), catalog (`permits`
description; rule `host-firewall-off`), `generate.rs` (`flows()`: for the
target's host when its host firewall is said in the file or by a
scenario, or a permits from it exists: prerequisite
`state/host-permission/<host>/<flow>` = ANY of the permission input (if
any) and `input/host-firewall-off/<host>` (`Policy { host, HostFirewall }`),
read last on the route).

- [ ] **Step 1: Failing tests:** `a_host_firewall_lets_a_flow_in_only_with_its_permission`;
  `a_host_firewall_said_on_without_a_permission_leaves_the_flow_unfinished`;
  `a_host_firewall_off_changes_no_number` (resolve: the off input is zero);
  format round trip of a `permits` from a host.
- [ ] **Steps 2–5:** RED → implement → `cargo test --workspace` → commit
  "A host firewall: a flow into the host needs its permission too".

### Task D7: Page, checks, review, landing

- Pins: the pin's state choice offers a host's `physical` and `usb` and an
  account's `held` (from the catalog's states, optional ones included), the
  target choice `unavailable` (`attacker-pins.js`, tests in
  `scripts/attacker-pins.test.js` or the existing pin tests).
- Rows: *Hardened*, *Host firewall*, *Static ARP tables* in Fig. 5.37's
  order, each shown only where it can change something (as ASLR/DEP and
  anti-malware: `architecture-view.js defenseRows/optionalNote`,
  `comparison.js switches`); absent optional slots say *not drawn until a
  time is given* where their step could be drawn.
- Flow form: *Encrypted* (Unknown is not offered: a boolean field) and
  *Carries* (credentials, the hierarchical menu, no native select).
- The assistant's tool enums held to the catalog (existing test).
- Required checks; fresh review; land (CONTRIBUTING.md).

---

# Branch E — `extract-fixture` (spec §8)

### Task E1: Freeze the old lecture file

**Files:** copy `docs/course/lecture-architecture.yaml` to
`crates/effractor-components/tests/fixtures/architectures/lecture-before-extract.yaml`
unchanged; every Rust test and script that reads the course file **as a
library test** (generation.rs, provenance.rs, graph_solve.rs,
graph_determinism.rs — whose snapshot `tests/snapshots/lecture-graph.json`
it freezes —, graph_support.rs, graph_clusters.rs, wasm `api.rs`,
`generate.rs`'s own test, format `json.rs`) reads the frozen copy;
`course_files.rs`, `scripts/graph-fixtures.js`, `check-graph-agreement.js`,
the performance scripts and the JS tests that load the course file keep
reading the course file.

- [ ] **Step 1:** copy, repoint, run `cargo test --workspace` and the
  wasip1 run — Expected: PASS with nothing changed (the copy is
  byte-identical, so the snapshot holds).
- [ ] **Step 2: Commit** — "The lecture before the extract is a frozen fixture".

### Task E2: The course file as the extract draws it

**Files:** `docs/course/lecture-architecture.yaml`.

Rebuild, keeping every id, flow and scenario the course text uses:
access controls on the router (`bridge-login`, the administrator granted
admin on it) and the server (`server-login`, the server account granted on
it); Ubuntu Linux (`ubuntu`) as the server's product, Windows 7
(`windows-7`) the workstation's, putty (`putty`) the SSH client's; an IDS
(`server-ids`, enabled, `bypass` illustrative) and anti-malware on the
server (`bypass-antimalware` illustrative); the SSH flow `encrypted: true`.
Times are illustrative exercise assumptions with notes; the server's and
the client's own `deploy-exploit` are left out (absent = not drawn) unless
the extract's story uses them — it uses the exploit against the server's
software, the IDS and anti-malware got past, patching, root on the router
through its access control. Scenarios `patch`, `protect`, `both`, `deny`
stay; `sshd`'s deploy note no longer says the bypass is folded in.

- [ ] **Step 1: Failing test** (`course_files.rs`):
  `the_course_file_draws_the_extract` — the generated graph has
  `action/service-deploy-exploit/sshd` reading the IDS's and the
  anti-malware's `passed`/`malware-cleared`, `state/router/bridge/admin`
  from an administration login through `bridge-login`, the products'
  find-exploit steps, and no interception of the encrypted SSH flow.
- [ ] **Step 2:** rebuild the file; run — PASS; `node scripts/graph-fixtures.js --write`
  (lecture-doc and graph fixtures move: intended) and
  `node scripts/check-graph-agreement.js` — same.
- [ ] **Step 3: Commit** — "The course file draws what the extract draws".

### Task E3: The course text's numbers from the solver

**Files:** `docs/course/README.md` (the table of what to expect, and any
sentence the rebuilt file makes untrue), `crates/effractor-solver/tests/course_files.rs`.

- [ ] **Step 1:** run `the_course_text_quotes_what_the_solver_says` —
  Expected: FAIL (the numbers moved).
- [ ] **Step 2:** rewrite the table from the solver's output (a scratch run
  of the same solve the test does); the test holds it.
- [ ] **Step 3: Commit** — "The course text quotes the rebuilt exercise".

### Task E4: The unknown and partial-defences files follow

**Files:** `docs/course/lecture-unknown.yaml`,
`docs/course/lecture-partial-defenses.yaml`, `course_files.rs` (their
`rewritten` expectations follow the rebuilt file's texts).

- [ ] **Steps:** regenerate both from the rebuilt file by the same
  rewrites the tests state; run `course_files.rs` — PASS; commit "The
  unknown and partial-defences files follow the rebuilt exercise".

### Task E5: Checks, review, landing, records

- Required checks, `graph-fixtures.js --write`, agreement; fresh review;
  land.
- `docs/HANDOFF.md`: delivered state, rulings, deferred minors.
  `docs/LECTURE-ACCEPTANCE.md`: a section on this milestone with the
  owner's walk along the extract (5.3–5.5, figure by figure) marked
  outstanding. `ROADMAP.md`: `securicad-extract` reduced to that one walk;
  spec and plan stay until it is done.
