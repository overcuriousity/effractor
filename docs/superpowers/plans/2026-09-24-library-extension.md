# Library extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `core-components@1` in place with virtualisation, shared
product vulnerabilities, cloud identity (MFA, workload identity, role
assumption), operators (people and AI agents) and data, each generated,
solved, inspectable and editable in the browser.

**Architecture:** Every addition flows through the same five layers, in this
order: the closed vocabulary in `effractor-core` (`architecture.rs`), its
validation (`architecture_validate.rs`), the YAML reader and canonical writer
in `effractor-format`, the rule catalog and generator in
`effractor-components`, and the browser's pure modules (`architecture-*.js`)
plus their DOM wrappers. The generated graph keeps its shape under every
switch value; new defences are either a replacement slot (`Binding::Parameter`
with a replacement) or a policy input (`Binding::Policy`). Logical AND joins
are `All` nodes with `Binding::Logical`.

**Tech Stack:** Rust 2024 (core/format/components/solver/wasm), vanilla JS
(`node --test`), YAML via the format crate's own tree reader.

**Spec:** `docs/superpowers/specs/2026-09-24-library-extension-design.md`,
amending `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` §4–6, §9.

## Global Constraints

- Rust edition 2024; `core`/`mal`/`format`/`solver`/`components` have no I/O and compile to `wasm32-unknown-unknown`.
- No panics on user input; unknown YAML keys are errors (except `x-`).
- The library stays `core-components@1`; no version bump, no migration (owner, 2026-09-23).
- A defense switch never changes the generated graph's structure: same node ids, same inputs, for every switch value.
- No invented numbers: every new slot is `unknown` until authored; no library TTC default.
- Missing structure is `incomplete`, never a permissive default.
- Generated ids are `state/<kind>/<entity>/<state>`, `action/<rule>/<ids…>`, `input/<what>/<ids…>`, built from entity/flow ids, never association ids.
- The page shows no library id: every kind, state, slot, switch and rule has its word in the catalog.
- vanilla CSS + JS, no bundler; no third-party origins.
- Checks per task: `npm test`, `cargo test --workspace`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `node scripts/check-roadmap.js`; `scripts/build-wasm.sh` first; `node scripts/check-graph-agreement.js` when a generated graph changed.
- How work lands: one feature branch per task, PR, CI green on that exact commit, owner looks at the UI in the 8081 preview, signed fast-forward of master (the owner runs the push). Do not drive the owner's browser.

## Review Focus

1. **A switch changes structure.** Toggling `mfa`, `encrypted`, `trained`, `guarded`, `patched` must give the identical node list and inputs. Pinned by `switches_never_change_the_graph` (Task 3, extended in Tasks 4–5).
2. **Cycles among the new logical facts** (`assumes` A→B→A, an agent whose flow reaches the service holding the data it reads, nested hosting) must generate finitely and solve without a foothold as "nothing reaches". Pinned by `role_cycles_are_finite` (Task 3) and the hosting-cycle validation test (Task 1).
3. **Deleting a component that the new associations name** (a product with instances, a person who knows a credential, data an agent reads) must take those associations along in one undo step, as today. Pinned in `architecture-links.test.js` (Tasks 2, 4, 5).
4. **Half-built new structure** (a service without a product, an agent without a host, a holding without `decrypts`) must say what is missing and block Build, not generate a permissive graph. Pinned by the `incomplete` tests (Tasks 2, 4, 5).
5. **Saving and reopening** every new field (`factor: second`, `shell: true`, `decrypts`, `mode`, new slots, new switches) must read back identically, with canonical key order. Pinned by round-trip tests (each task) and the example's canonical check (Task 5).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `crates/effractor-core/src/architecture.rs` | Kinds, states, slots, defences, relations, fields | 1–5 |
| `crates/effractor-core/src/architecture_validate.rs` | Errors and `incomplete` | 1–5 |
| `crates/effractor-core/tests/architecture.rs` | Validation tests for the vocabulary | 1–5 |
| `crates/effractor-format/src/architecture_read.rs` | Word tables, association fields | 1–5 |
| `crates/effractor-format/src/architecture_write.rs` | Canonical output of new fields | 3–5 |
| `crates/effractor-format/tests/architecture.rs` | Round trips, read errors | 1–5 |
| `crates/effractor-components/src/catalog.rs` | Rules, words, meanings | 1–5 |
| `crates/effractor-components/src/generate.rs` | Rule instantiation | 1–5 |
| `crates/effractor-components/src/graph.rs` | `Binding::Policy` | 3 |
| `crates/effractor-components/src/resolve.rs`, `export.rs` | Resolving and exporting policies | 3 |
| `crates/effractor-solver/src/graph_results.rs` | Assumption list knows policies | 3 |
| `crates/effractor-components/tests/generation.rs` | Per-rule generation tests | 1–5 |
| `crates/effractor-components/tests/provenance.rs` | Policy resolution, switches never change the graph | 3–4 |
| `assets/js/architecture-edit.js` | Kind list, Add groups | 1–5 |
| `assets/js/architecture-links.js` | Relation list, fields, words | 1–5 |
| `assets/js/architecture-links-ui.js` | Association inspector fields, flow ends | 3–5 |
| `assets/js/architecture-view.js` | `shownSlots` | 1 |
| `assets/js/architecture-ui.js` | Grouped Add menu, shown slots | 1–2 |
| `assets/js/architecture-icons.js` | Icons, families | 2, 4, 5 |
| `assets/js/vocabulary.js`, `assets/js/attack-ui.js` | Defence switch words, `defense` status word | 3 |
| `assets/css/00-tokens.css`, `60-architecture.css`, `scripts/check-contrast.js`, `crates/effractor-server/templates/shell.html` | Data family colour | 5 |
| `docs/course/lecture-architecture.yaml`, `assets/examples/14–16`, format/component fixtures | Canonical rewrites | 1–3 |
| `assets/examples/17-cloud-support-agent-architecture.yaml`, `assets/examples/README.md`, `docs/course/README.md` | The example | 5 |
| `crates/effractor-solver/tests/graph_examples.rs` | Example test | 5 |

Fixture regeneration, whenever canonical text or generated graphs change:

```bash
scripts/build-wasm.sh
node scripts/graph-fixtures.js --write
UPDATE_SNAPSHOTS=1 cargo test -p effractor-solver --test graph_determinism
git diff --stat scripts/fixtures crates/effractor-solver/tests/snapshots   # read it: only the expected ids/values moved
```

Canonical text of a fixture file is rewritten with the format crate's
canonicalizer:

```bash
cargo run -q -p effractor-format --example canonicalize -- <file>   # created in Task 1, Step 1
```

A rule list the generator test tolerates as not yet used by any example
(emptied in Task 5): `NOT_YET_IN_AN_EXAMPLE` in
`crates/effractor-components/tests/generation.rs`.

---

### Task 1: Virtualisation — hosts on hosts, escapes

Branch: `feature/virtualisation`.

**Files:**
- Create: `crates/effractor-format/examples/canonicalize.rs`
- Modify: `crates/effractor-core/src/architecture.rs`, `crates/effractor-core/src/architecture_validate.rs`
- Modify: `crates/effractor-format/src/architecture_read.rs`
- Modify: `crates/effractor-components/src/catalog.rs`, `crates/effractor-components/src/generate.rs`
- Modify: `assets/js/architecture-links.js`, `assets/js/architecture-view.js`, `assets/js/architecture-ui.js`
- Test: `crates/effractor-core/tests/architecture.rs`, `crates/effractor-components/tests/generation.rs`, `scripts/architecture-links.test.js`, `scripts/architecture-view.test.js`
- Fixtures: every architecture YAML (hosts and routers gain `escape`)

**Interfaces:**
- Produces: `Slot::Escape` (`"escape"`), owned by `EntityKind::Host` and `EntityKind::Router`; `RelationKind::Hosts.to_kinds()` includes `Host`; rules `hosted-host`, `guest-escape`, `router-escape`; ids `action/guest-escape/<guest>`, `action/router-escape/<router>`; JS `effractorArchitectureView.shownSlots(doc, id) -> string[]`.

- [ ] **Step 1: Add the canonicalize example**

```rust
// crates/effractor-format/examples/canonicalize.rs
//! Rewrites files in canonical form: `cargo run -p effractor-format --example canonicalize -- FILE…`.
fn main() {
    for path in std::env::args().skip(1) {
        let text = std::fs::read_to_string(&path).expect("readable");
        match effractor_format::canonicalize(&text) {
            Ok(out) => std::fs::write(&path, out).expect("writable"),
            Err(d) => panic!("{path}: {d:?}"),
        }
    }
}
```

Run: `cargo run -q -p effractor-format --example canonicalize -- docs/course/lecture-architecture.yaml && git diff --exit-code docs/course`
Expected: no diff (the file is canonical today).

- [ ] **Step 2: Write the failing validation tests**

Append to `crates/effractor-core/tests/architecture.rs` (reuse its existing helpers for building a model; if it has none, add these):

```rust
fn vm_model() -> Architecture {
    let mut m = Architecture::new("VMs");
    for (id, kind) in [("hv", EntityKind::Host), ("vm", EntityKind::Host), ("ct", EntityKind::Host)] {
        m.entities.insert(id.parse().unwrap(), Entity::new(kind, id));
    }
    let hosts = |from: &str, to: &str| Association {
        relation: Relation::Hosts { from: from.parse().unwrap(), to: to.parse().unwrap(), privilege: Privilege::User },
        description: None,
    };
    m.associations.insert("hv-vm".parse().unwrap(), hosts("hv", "vm"));
    m.associations.insert("vm-ct".parse().unwrap(), hosts("vm", "ct"));
    m
}

#[test]
fn a_host_may_run_on_a_host_and_nest() {
    let d = validate_architecture(&vm_model());
    assert!(d.iter().all(|d| d.code != Code::AssociationType && d.code != Code::Cycle), "{d:?}");
}

#[test]
fn every_host_and_router_carries_an_escape_slot() {
    assert_eq!(EntityKind::Host.slots(), &[Slot::Escape]);
    assert_eq!(EntityKind::Router.slots(), &[Slot::Escape]);
}

#[test]
fn a_hosting_cycle_is_an_error() {
    let mut m = vm_model();
    m.associations.insert(
        "ct-hv".parse().unwrap(),
        Association {
            relation: Relation::Hosts { from: "ct".parse().unwrap(), to: "hv".parse().unwrap(), privilege: Privilege::User },
            description: None,
        },
    );
    let cycles: Vec<_> = validate_architecture(&m).into_iter().filter(|d| d.code == Code::Cycle).collect();
    assert_eq!(cycles.len(), 1, "{cycles:?}");
    assert!(cycles[0].message.contains("hv") && cycles[0].message.contains("ct"));
}

#[test]
fn a_router_cannot_host_a_host() {
    let mut m = vm_model();
    m.entities.insert("r".parse().unwrap(), Entity::new(EntityKind::Router, "R"));
    m.associations.insert(
        "r-vm2".parse().unwrap(),
        Association {
            relation: Relation::Hosts { from: "r".parse().unwrap(), to: "hv".parse().unwrap(), privilege: Privilege::Admin },
            description: None,
        },
    );
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::AssociationType && d.path == "associations.r-vm2.from"), "{d:?}");
}
```

- [ ] **Step 3: Run to see them fail**

Run: `cargo test -p effractor-core --test architecture`
Expected: compile error, `Slot::Escape` does not exist.

- [ ] **Step 4: Implement the vocabulary**

In `architecture.rs`:
- `Slot`: add `Escape` after `AdminLogin`; `ALL: [Slot; 9]` with `Self::Escape`; `as_str` → `"escape"`.
- `EntityKind::slots`: `Self::Host | Self::Router => &[Slot::Escape],`.
- `RelationKind::to_kinds` `Hosts` arm: `&[K::Application, K::Service, K::Router, K::Host]`, comment `// A router or a guest host runs on a host too: an appliance's box, a VM, a container.`
- The module doc's counts ("eight entity kinds, nine association kinds, five states") are updated as the tasks change them.

In `architecture_validate.rs`, `associations()`:
- Beside the existing router-on-router arm add:

```rust
(Relation::Hosts { .. }, Some(from), Some(EntityKind::Host)) if from != EntityKind::Host => {
    self.error(
        Code::AssociationType,
        format!("{at}.from"),
        "a host runs on a host, not on a router",
    )
}
```
- Rename the cardinality message to `"an executable, router or guest host has one host"`.
- Call `self.hosting_cycles();` at the end of `associations()` and add:

```rust
/// Guest hosts follow their host upwards; returning to the start is a cycle,
/// reported once, at the association that closes it from its first member.
fn hosting_cycles(&mut self) {
    let m = self.m;
    let mut up: HashMap<&EntityId, (&EntityId, &AssociationId)> = HashMap::new();
    for (id, a) in &m.associations {
        if let Relation::Hosts { from, to, .. } = &a.relation
            && self.kind_of(to) == Some(EntityKind::Host)
        {
            up.entry(to).or_insert((from, id));
        }
    }
    let mut guests: Vec<&EntityId> = up.keys().copied().collect();
    guests.sort();
    let mut reported: HashSet<&EntityId> = HashSet::new();
    for start in guests {
        if reported.contains(start) {
            continue;
        }
        let mut chain = vec![start];
        let mut at = start;
        while let Some(&(host, _)) = up.get(at) {
            if host == start {
                let names: Vec<&str> = chain.iter().map(|e| e.as_str()).collect();
                let association = up[start].1;
                self.error(
                    Code::Cycle,
                    format!("associations.{association}"),
                    format!("hosting runs in a circle: {} → {start}", names.join(" → ")),
                );
                reported.extend(chain.iter().copied());
                break;
            }
            if chain.contains(&host) {
                break;
            }
            chain.push(host);
            at = host;
        }
    }
}
```

- [ ] **Step 5: Run the core tests**

Run: `cargo test -p effractor-core`
Expected: PASS.

- [ ] **Step 6: Reader table**

`architecture_read.rs`: `SLOTS: [(&str, Slot); 9]`, add `("escape", Slot::Escape)`.

Run: `cargo build --workspace` and fix every non-exhaustive match the compiler names (`catalog.rs` `slot_name`, `slot_description`). Words:
- `slot_name(Slot::Escape)` → `"Escape to the host"`
- `slot_description(Slot::Escape)` → `("host or router", "Time to break out of a virtual machine, container or appliance to the host it runs on, once in admin control of it.")`

- [ ] **Step 7: Write the failing generation tests**

Append to `crates/effractor-components/tests/generation.rs` (uses its `lecture`, `add`, `relate`, `node`, `inputs` helpers):

```rust
#[test]
fn a_hypervisor_controls_its_guests_and_a_guest_escapes_by_a_timed_step() {
    let mut m = lecture();
    add(&mut m, "hv", EntityKind::Host);
    relate(&mut m, "hv-server", Relation::Hosts { from: id("hv"), to: id("server"), privilege: Privilege::User });
    let g = generate(&m).unwrap();
    // Host control at the guest's privilege is guest admin, logically.
    assert!(inputs(&g, "state/host/server/admin").contains(&"state/host/hv/user".to_owned()));
    // Back out: guest admin, then the escape, then the host at that privilege.
    assert_eq!(inputs(&g, "action/guest-escape/server"), vec!["state/host/server/admin"]);
    assert!(inputs(&g, "state/host/hv/user").contains(&"action/guest-escape/server".to_owned()));
    assert!(matches!(
        node(&g, "action/guest-escape/server").duration,
        Binding::Parameter { base: Slot::Escape, replacement: None, .. }
    ));
}

#[test]
fn a_router_on_a_host_escapes_to_it_by_a_timed_step() {
    let mut m = lecture();
    add(&mut m, "box", EntityKind::Host);
    relate(&mut m, "box-bridge", Relation::Hosts { from: id("box"), to: id("bridge"), privilege: Privilege::Admin });
    let g = generate(&m).unwrap();
    assert!(inputs(&g, "state/router/bridge/admin").contains(&"state/host/box/admin".to_owned()));
    assert_eq!(inputs(&g, "action/router-escape/bridge"), vec!["state/router/bridge/admin"]);
    assert!(inputs(&g, "state/host/box/admin").contains(&"action/router-escape/bridge".to_owned()));
}

#[test]
fn an_unhosted_host_has_no_escape_step() {
    let g = generate(&lecture()).unwrap();
    assert!(g.nodes.iter().all(|n| !n.id.contains("escape")));
}
```

Add `Slot` to the file's `use effractor_core::architecture::{…}`. Replace the existing test `a_router_on_a_host_is_controlled_from_it_and_not_the_reverse` by the router-escape test above: its "not the reverse" assertion is superseded (spec §2.1). Add at the top of the file:

```rust
/// Rules no shipped example uses yet; emptied when the cloud example lands.
const NOT_YET_IN_AN_EXAMPLE: &[&str] = &["hosted-host", "guest-escape", "router-escape"];
```

and in `every_rule_is_used_by_the_lecture_and_names_what_it_bound` skip rule ids in `NOT_YET_IN_AN_EXAMPLE`. If the branch-office example (14) hosts its router on a host, `router-escape` is used there already; remove it from the list if the test says so.

- [ ] **Step 8: Run to see them fail**

Run: `cargo test -p effractor-components --test generation`
Expected: FAIL: no `action/guest-escape/server`, and `origin("hosted-host")` panics with "every generated rule is in the catalog" once referenced.

- [ ] **Step 9: Rules in the catalog**

`catalog.rs`: `RULES: [Rule; 19]`. Change `hosted-router`'s second assumption to `"Leaving the router for its host is its own timed step, the router's escape."` Insert after `hosted-router`:

```rust
Rule {
    id: "hosted-host",
    title: "Controlling the host controls its guests",
    version: 1,
    bindings: &["hosts"],
    prerequisites: "the hosting host at the guest's declared privilege (admin also satisfies user)",
    output: "guest host.admin",
    duration: D::Logical,
    scope: "one per hosts association naming a host",
    assumptions: &[
        "Whoever controls a hypervisor or container host at the privilege a guest runs with controls the guest.",
    ],
},
Rule {
    id: "guest-escape",
    title: "Escape to the host",
    version: 1,
    bindings: &["hosts"],
    prerequisites: "guest host.admin",
    output: "the hosting host at the guest's declared privilege",
    duration: D::Slot { slot: Slot::Escape, replaced_by: None },
    scope: "one per guest host",
    assumptions: &[
        "Breaking out of a virtual machine or container is one timed step; hardening it is an edit of that time.",
    ],
},
Rule {
    id: "router-escape",
    title: "Escape from the router to its host",
    version: 1,
    bindings: &["hosts"],
    prerequisites: "router.admin, for a router that runs on a host",
    output: "the hosting host at the router's declared privilege",
    duration: D::Slot { slot: Slot::Escape, replaced_by: None },
    scope: "one per hosted router",
    assumptions: &["Leaving a router VM or appliance for its host is one timed step."],
},
```

Also update `relation_description(Hosts)` to `"The machine an executable, a router or a guest host runs on, at \`privilege: user | admin\`. Each has one host; a router or a guest runs only on a host."` and `kind_meaning(Host)` to `"A machine: a workstation, a server, a virtual machine or a container. It may run on another host."`.

- [ ] **Step 10: Generate**

`generate.rs` `hosting()`: replace the router branch with a match on the hosted kind:

```rust
match self.kind(to) {
    // A router on a host: the box controls it; leaving it is an escape.
    EntityKind::Router => {
        let admin = self.state_id(to, State::Admin.as_str());
        self.produce(&machine, &admin, bound("hosted-router"));
        self.escape("router-escape", to, from, *privilege, aid);
    }
    // A guest on its host: the same, as the guest's admin.
    EntityKind::Host => {
        let admin = self.state_id(to, State::Admin.as_str());
        self.produce(&machine, &admin, bound("hosted-host"));
        self.escape("guest-escape", to, from, *privilege, aid);
    }
    _ => {
        let control = self.state_id(to, State::Control.as_str());
        self.produce(&machine, &control, bound("host-execution"));
        self.produce(&control, &machine, bound("execution-privilege"));
    }
}
```

and add to `impl Builder`:

```rust
/// Out of a guest or a hosted router to its host, as the host's privilege.
fn escape(&mut self, rule: &str, guest: &'a EntityId, host: &'a EntityId, privilege: Privilege, hosts: &'a AssociationId) {
    let owner = Owner::Entity(guest.clone());
    let o = Origin {
        entities: vec![guest.clone(), host.clone()],
        associations: vec![hosts.clone()],
        paths: vec![owner.slot_path(Slot::Escape)],
        ..origin(rule)
    };
    let admin = self.state_id(guest, State::Admin.as_str());
    let machine = self.machine_id(host, privilege);
    self.action(
        format!("action/{rule}/{guest}"),
        format!("Escape · {} to {}", self.label(guest), self.label(host)),
        Binding::Parameter { owner, base: Slot::Escape, replacement: None },
        &[admin],
        &machine,
        o,
    );
}
```

(`hosting()` iterates `for (aid, a) in &self.m.associations`; bind `aid` there.)

- [ ] **Step 11: Run the component tests**

Run: `cargo test -p effractor-components`
Expected: the new tests PASS. `the_lecture_fixture_is_canonical_and_complete` FAILS: canonical text now writes `escape` on hosts and the router.

- [ ] **Step 12: Rewrite fixtures canonically**

```bash
cargo run -q -p effractor-format --example canonicalize -- \
  docs/course/lecture-architecture.yaml \
  assets/examples/14-branch-office-architecture.yaml \
  assets/examples/15-web-shop-architecture.yaml \
  assets/examples/16-clinic-records-architecture.yaml \
  assets/templates/new-architecture.yaml \
  crates/effractor-format/tests/fixtures/canonical/lecture-architecture.yaml \
  crates/effractor-format/tests/fixtures/canonical/empty-architecture.yaml \
  crates/effractor-components/tests/fixtures/lecture-unknown.yaml
git diff --stat
```

Expected: only `parameters: escape: status: unknown` blocks added under hosts and routers. The `migrations/v2/` sources are flow-style inputs, not canonical: leave them; if a migration test compares against a canonical fixture, the fixture above now carries the slots. Run `grep -rn "kind: host\|kind: router" scripts/*.test.js scripts/fixtures` and update any inline canonical text the JS tests compare against.

- [ ] **Step 13: Show `escape` only where it applies (JS)**

Failing test in `scripts/architecture-view.test.js`:

```js
test('an escape is shown only on a hosted host or router', () => {
  const doc = {
    entities: {
      hv: { kind: 'host', label: 'HV', parameters: { escape: { status: 'unknown' } } },
      vm: { kind: 'host', label: 'VM', parameters: { escape: { status: 'unknown' } } },
    },
    associations: { 'hv-vm': { kind: 'hosts', from: 'hv', to: 'vm', privilege: 'user' } },
  };
  assert.deepEqual(V.shownSlots(doc, 'hv'), []);
  assert.deepEqual(V.shownSlots(doc, 'vm'), ['escape']);
  const nodes = V.build(doc).nodes;   // use the module's existing entry point name
  assert.equal(nodes.find((n) => n.id === 'entity/hv').unknown, 0);
  assert.equal(nodes.find((n) => n.id === 'entity/vm').unknown, 1);
});
```

Implement in `architecture-view.js`:

```js
  // The slots worth showing: an escape only where there is a host to escape to.
  function shownSlots(doc, id) {
    var e = doc.entities[id];
    var hosted = Object.keys(doc.associations || {}).some(function (k) {
      var a = doc.associations[k];
      return a.kind === "hosts" && a.to === id;
    });
    return Object.keys((e && e.parameters) || {}).filter(function (slot) {
      return slot !== "escape" || hosted;
    });
  }
```

`unknowns(entity)` becomes `unknowns(doc, id)` counting over `shownSlots(doc, id)`; export `shownSlots` in `api`. In `architecture-ui.js`, `parameters(form, owner, e)` and `firstParameter()` take their slot list from `window.effractorArchitectureView.shownSlots(doc(), id)` when the owner is an entity (flows keep `Object.keys(e.parameters)`); the context menu's "Edit parameters" item (line ~221) is offered only when that list is non-empty.

- [ ] **Step 14: Links: a host may host a host (JS)**

Failing test in `scripts/architecture-links.test.js`:

```js
test('a host can be linked to run on a host, a router cannot host one', () => {
  const doc = { entities: { a: { kind: 'host', label: 'A' }, b: { kind: 'host', label: 'B' }, r: { kind: 'router', label: 'R' } }, associations: {}, flows: {} };
  const choices = L.linkChoices(doc, catalog, 'b');   // `catalog`: the test file's catalog fixture
  const runsOn = choices.find((c) => c.kind === 'hosts' && c.direction === 'in');
  assert.deepEqual(runsOn.candidates, ['a']);
  assert.deepEqual(L.privileges(doc, 'hosts', 'a', 'b'), ['user', 'admin']);
});
```

Implement: `endsAllowed(relation, fromKind, toKind)` returns false also for `relation === "hosts" && toKind === "host" && fromKind !== "host"`. If the JS tests read the catalog from a fixture file (`scripts/fixtures/…catalog…json`), regenerate it with `node scripts/graph-fixtures.js --write` after `scripts/build-wasm.sh`.

- [ ] **Step 15: Full checks, fixtures, commit**

```bash
scripts/build-wasm.sh && node scripts/graph-fixtures.js --write
UPDATE_SNAPSHOTS=1 cargo test -p effractor-solver --test graph_determinism
cargo test --workspace && npm test && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && node scripts/check-graph-agreement.js && node scripts/check-roadmap.js
git add -A && git commit -S -m "Run hosts on hosts and escape from guests and routers"
```

Expected: all pass; the lecture snapshot's graph is unchanged (no guest in it) apart from the document text.

- [ ] **Step 16: Owner look (8081 preview)**

Start the preview on 8081 from this branch; ask the owner to: add two hosts, link one to run on the other, see "Escape to the host" appear only on the guest, Build, and find "Escape · …" in the attack graph. Wait for the owner's word before the PR merges.

---

### Task 2: Products — one discovery per software version

Branch: `feature/products`.

**Files:**
- Modify: `crates/effractor-core/src/architecture.rs`, `architecture_validate.rs`
- Modify: `crates/effractor-format/src/architecture_read.rs`
- Modify: `crates/effractor-components/src/catalog.rs`, `generate.rs`
- Modify: `assets/js/architecture-edit.js`, `architecture-links.js`, `architecture-icons.js`, `architecture-ui.js`
- Test: core, format, generation tests; `scripts/architecture-edit.test.js`, `architecture-links.test.js`, `architecture-icons.test.js`
- Fixtures: lecture (course and format), examples 14–16, `lecture-unknown.yaml`, `migrations/v2` sources if they contain a service; JS fixtures; solver snapshot; `scripts/check-graph-agreement.js` and `scripts/graph-fixtures.js` replacements that name `sshd`'s patching

**Interfaces:**
- Consumes: Task 1's `Slot::Escape` (unchanged).
- Produces: `EntityKind::Product` (`"product"`, no declared states, slots `[FindExploit, FindExploitPatched]`, defence `Patched`); `EntityKind::Service` slots `[DeployExploit, Login]`, no defence; `RelationKind::InstanceOf` (`"instance-of"`, service → product); facts `state/product/<p>/reachable`, `state/product/<p>/exploit-ready`; `action/product-find-exploit/<p>`; `action/service-deploy-exploit/<s>` with inputs `[state/product/<p>/exploit-ready, state/service/<s>/reachable]`. JS `effractorArchitectureEdit.GROUPS`.

- [ ] **Step 1: Failing validation tests** (`crates/effractor-core/tests/architecture.rs`)

```rust
#[test]
fn a_service_without_a_product_is_incomplete_and_two_are_an_error() {
    let mut m = Architecture::new("P");
    m.entities.insert("s".parse().unwrap(), Entity::new(EntityKind::Service, "S"));
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::Incomplete && d.path == "entities.s" && d.message.contains("product")), "{d:?}");
    for p in ["p1", "p2"] {
        m.entities.insert(p.parse().unwrap(), Entity::new(EntityKind::Product, p));
        m.associations.insert(format!("s-{p}").parse().unwrap(), Association {
            relation: Relation::InstanceOf { from: "s".parse().unwrap(), to: p.parse().unwrap() },
            description: None,
        });
    }
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::Cardinality && d.path == "associations.s-p2"), "{d:?}");
}

#[test]
fn patching_belongs_to_the_product() {
    assert_eq!(EntityKind::Product.defense(), Some(Defense::Patched));
    assert_eq!(EntityKind::Service.defense(), None);
    assert_eq!(EntityKind::Product.slots(), &[Slot::FindExploit, Slot::FindExploitPatched]);
    assert_eq!(EntityKind::Service.slots(), &[Slot::DeployExploit, Slot::Login]);
}
```

Run: `cargo test -p effractor-core --test architecture` → compile error.

- [ ] **Step 2: Vocabulary**

`architecture.rs`:
- `EntityKind::Product` after `Service`; `ALL: [EntityKind; 9]`; `as_str` `"product"`; `states` → `&[]` (with `Firewall | Account | Product`); `slots` → Service `[DeployExploit, Login]`, Product `[FindExploit, FindExploitPatched]`; `defense` → `Product => Some(Defense::Patched)`, Service none.
- `Defenses::patched` doc: `/// A product: \`find-exploit-patched\` stands in for \`find-exploit\`.`
- `Relation::InstanceOf { from: EntityId, to: EntityId }` with doc `/// service → product: which software version it runs; exactly one.`; `RelationKind::InstanceOf` (`"instance-of"`), `ALL: [RelationKind; 10]`, `from_kinds` `[Service]`, `to_kinds` `[Product]`; add the arms to `kind()`, `from()`, `to_entity()`.

`architecture_validate.rs` `associations()`: count `instance-of` per service like `hosts_of` (`("a service is an instance of one product", instances_of, "instance-of")`), and in the "what is missing" loop:

```rust
EntityKind::Service if !instances.contains(id) => self.incomplete(
    at,
    format!("\"{id}\" is an instance of no product yet: no `instance-of` association names the software it runs"),
),
```

Note the existing arm `k if k.is_executable() && !hosted.contains(id)` comes first; a service missing both reports the host first. That is fine: both show once the host is added.

- [ ] **Step 3: Reader tables; run core and format**

`architecture_read.rs`: `KINDS: [_; 9]` add `("product", EntityKind::Product)`; `RELATIONS: [_; 10]` add `("instance-of", RelationKind::InstanceOf)`; the `match kind` in `association()` gets `RelationKind::InstanceOf => Relation::InstanceOf { from, to },`.

Add a round-trip test to `crates/effractor-format/tests/architecture.rs` modelled on its existing round-trip tests, with a product `openssh` (`find-exploit` illustrative `Exponential(mean 10)`, `defenses: {patched: false}`) and `sshd-openssh: {kind: instance-of, from: sshd, to: openssh}`; assert `canonicalize(text) == text`.

Run: `cargo test -p effractor-core -p effractor-format`
Expected: PASS except canonical-fixture tests that still have `find-exploit` on a service (MisplacedKey). Those are fixed in Step 7.

- [ ] **Step 4: Failing generation tests**

```rust
#[test]
fn two_instances_share_one_discovery_and_deploy_separately() {
    let mut m = lecture();
    add(&mut m, "sshd2", EntityKind::Service);
    relate(&mut m, "sshd2-hosting", Relation::Hosts { from: id("server"), to: id("sshd2"), privilege: Privilege::User });
    relate(&mut m, "sshd2-openssh", Relation::InstanceOf { from: id("sshd2"), to: id("openssh") });
    let g = generate(&m).unwrap();
    let mut reach = inputs(&g, "state/product/openssh/reachable");
    reach.sort();
    assert_eq!(reach, vec!["state/service/sshd/reachable", "state/service/sshd2/reachable"]);
    assert_eq!(inputs(&g, "action/product-find-exploit/openssh"), vec!["state/product/openssh/reachable"]);
    assert_eq!(
        inputs(&g, "action/service-deploy-exploit/sshd2"),
        vec!["state/product/openssh/exploit-ready", "state/service/sshd2/reachable"]
    );
    assert!(g.nodes.iter().all(|n| n.id != "action/service-find-exploit/sshd"));
    assert!(matches!(
        node(&g, "action/product-find-exploit/openssh").duration,
        Binding::Parameter { base: Slot::FindExploit, replacement: Some((Defense::Patched, Slot::FindExploitPatched)), .. }
    ));
}
```

(`openssh` is the lecture's product after Step 7; `sshd2` unreachable is fine, the ids are what is tested.) Update `every_lecture_step_has_exactly_its_prerequisites`' expected table in the same way: `action/service-find-exploit/sshd` and `state/service/sshd/exploit-ready` disappear; `state/product/openssh/reachable` ← `[state/service/sshd/reachable]`, `action/product-find-exploit/openssh` ← `[state/product/openssh/reachable]`, `state/product/openssh/exploit-ready` ← `[action/product-find-exploit/openssh]`, `action/service-deploy-exploit/sshd` ← `[state/product/openssh/exploit-ready, state/service/sshd/reachable]`. Rename `extraction_is_per_store_and_discovery_per_service` to `…_per_product` and change its assertion accordingly.

- [ ] **Step 5: Catalog and generator**

`catalog.rs` (`RULES: [Rule; 20]`): replace `service-find-exploit` by two rules, and change `service-deploy-exploit`'s prerequisites:

```rust
Rule {
    id: "product-reachable",
    title: "An instance is reachable",
    version: 1,
    bindings: &["instance-of"],
    prerequisites: "service.reachable, for any instance of the product",
    output: "product.reachable",
    duration: D::Logical,
    scope: "one per instance-of association",
    assumptions: &["Any one reachable instance is enough to study the software version."],
},
Rule {
    id: "product-find-exploit",
    title: "Find an exploit",
    version: 1,
    bindings: &["product"],
    prerequisites: "product.reachable",
    output: "product.exploit-ready",
    duration: D::Slot { slot: Slot::FindExploit, replaced_by: Some((Defense::Patched, Slot::FindExploitPatched)) },
    scope: "one per product",
    assumptions: &[
        "Patching selects the authored replacement distribution; it does not by itself eliminate every exploit.",
        "An exploit found through one instance works on every instance of the same version; a partly patched fleet is two products.",
    ],
},
```

`service-deploy-exploit`: `prerequisites: "product.exploit-ready and the service's own reachable"`. `slot_description`: `FindExploit`/`FindExploitPatched` owner `"product"`, texts `"Time to find a usable exploit for a software version, once an instance is reachable."` / `"The same, once the product is patched; selected by \`defenses.patched\`."`. `kind_description(Product)` = `"One software version, e.g. OpenSSH 9.6. Its services share one exploit discovery; patching is set here."`; `kind_meaning(Product)` = `"A software version. Every service that is an instance of it shares its vulnerabilities."`; `relation_description(InstanceOf)` = `"The software version a service runs: exactly one product."`. Also fix `kind_meaning(Service)` to drop nothing (unchanged).

`generate.rs`:
- `states()`: Service keeps only `reachable`; add `EntityKind::Product` with `reachable` / `exploit-ready` (words `"reachable"`, `"exploit ready"`).
- Build an index `product_of: HashMap<&EntityId, (&EntityId, &AssociationId)>` in `Builder::new` from `Relation::InstanceOf`.
- Replace `services()` with:

```rust
fn products(&mut self) {
    for (pid, entity) in &self.m.entities {
        if entity.kind != EntityKind::Product {
            continue;
        }
        let owner = Owner::Entity(pid.clone());
        let o = Origin {
            entities: vec![pid.clone()],
            paths: vec![
                owner.slot_path(Slot::FindExploit),
                owner.slot_path(Slot::FindExploitPatched),
                format!("entities.{pid}.defenses.patched"),
            ],
            ..origin("product-find-exploit")
        };
        let reachable = self.state_id(pid, "reachable");
        let ready = self.state_id(pid, "exploit-ready");
        self.action(
            format!("action/product-find-exploit/{pid}"),
            format!("Find an exploit · {}", entity.label),
            Binding::Parameter { owner, base: Slot::FindExploit, replacement: Some((Defense::Patched, Slot::FindExploitPatched)) },
            &[reachable],
            &ready,
            o,
        );
    }
}

fn services(&mut self) {
    for (sid, entity) in &self.m.entities {
        if entity.kind != EntityKind::Service {
            continue;
        }
        let (pid, instance) = self.product_of[sid];
        let reachable = self.state_id(sid, "reachable");
        let r = Origin {
            entities: vec![sid.clone(), pid.clone()],
            associations: vec![instance.clone()],
            ..origin("product-reachable")
        };
        self.produce(&reachable, &self.state_id(pid, "reachable"), r);
        let owner = Owner::Entity(sid.clone());
        let deploy = Origin {
            entities: vec![sid.clone(), pid.clone()],
            associations: vec![instance.clone()],
            paths: vec![owner.slot_path(Slot::DeployExploit)],
            ..origin("service-deploy-exploit")
        };
        let ready = self.state_id(pid, "exploit-ready");
        let control = self.state_id(sid, State::Control.as_str());
        self.action(
            format!("action/service-deploy-exploit/{sid}"),
            format!("Use the exploit · {}", entity.label),
            Binding::Parameter { owner, base: Slot::DeployExploit, replacement: None },
            &[ready, reachable],
            &control,
            deploy,
        );
    }
}
```

(`self.state_id(pid, "reachable")` borrowed while `self.produce` needs `&mut self`: bind it to a local first.) Call `b.products();` before `b.services();` in `generate_within`. `product_of[sid]` cannot panic: generation refuses an `incomplete` model.

Run: `cargo test -p effractor-components` → new tests PASS; fixture tests FAIL until Step 7.

- [ ] **Step 6: Scenario changes follow the switch**

Scenarios that set `{entity: <service>, defense: patched}` now fail validation (`UnknownState`: a service has no defence). No code change: Step 7 moves them to the product.

- [ ] **Step 7: Move every file's service discovery to a product**

For each of `docs/course/lecture-architecture.yaml`, `crates/effractor-format/tests/fixtures/canonical/lecture-architecture.yaml`, `crates/effractor-components/tests/fixtures/lecture-unknown.yaml`, `assets/examples/14-…`, `15-…`, `16-…`, and any `migrations/v2` source with a service:
1. For each service `X`, add a product entity right after it, id `<X>-software` unless the file suggests a better name (lecture: `openssh`, label `OpenSSH`), whose `parameters` are the service's `find-exploit` and `find-exploit-patched` blocks moved verbatim, and whose `defenses` is the service's `defenses` line moved verbatim.
2. Remove those two slots and `defenses` from the service.
3. Add `X-instance: {kind: instance-of, from: X, to: <product>}` after the service's `hosts` association.
4. In `scenarios`, rewrite `{entity: X, defense: patched, …}` to `{entity: <product>, defense: patched, …}`.
5. Canonicalize with the example from Task 1.

Then update the strings JS fixtures replace: `scripts/graph-fixtures.js` and `scripts/check-graph-agreement.js` search for text in the lecture; if any names `sshd`'s `find-exploit-patched`, point it at `openssh`. Update `graph_examples.rs`: `entities.db.parameters.find-exploit` → the product id chosen for `db` in example 15; `entities.records.parameters.find-exploit` → the product id for `records` in example 16. Update `assets/examples/README.md` wording if it says "patch the service".

Run: `cargo test --workspace`
Expected: PASS after `UPDATE_SNAPSHOTS=1 cargo test -p effractor-solver --test graph_determinism`. Read the snapshot diff: node ids `service-find-exploit` → `product-find-exploit`, `sshd/exploit-ready` → `openssh/exploit-ready`, and probabilities that move only through the changed node order (same model, same distributions).

- [ ] **Step 8: Grouped Add menu, product kind (JS)**

Failing tests:

```js
// scripts/architecture-edit.test.js
test('the kinds are grouped by family for the Add menu', () => {
  assert.deepEqual(E.GROUPS.map((g) => g[0]), ['Network', 'Compute', 'Identity']);
  assert.deepEqual(E.GROUPS.flatMap((g) => g[1]), E.KINDS);
  assert.ok(E.GROUPS[1][1].includes('product'));
});
// scripts/architecture-icons.test.js: extend the family assertion
assert.equal(I.family('product'), 'compute');
// scripts/architecture-links.test.js
test('deleting a product takes its instance-of links along', () => {
  const doc = { entities: { s: { kind: 'service', label: 'S' }, p: { kind: 'product', label: 'P' } },
    associations: { 's-p': { kind: 'instance-of', from: 's', to: 'p' } }, flows: {} };
  const out = L.remove(doc, 'entity/p');   // the module's existing delete entry point
  assert.deepEqual(out.doc.associations, {});
});
```

Implement:
- `architecture-edit.js`: `KINDS` adds `"product"` after `"service"`; add

```js
  // The Add menu's groups: the families the canvas colours.
  var GROUPS = [
    ["Network", ["network", "router", "firewall"]],
    ["Compute", ["host", "application", "service", "product"]],
    ["Identity", ["account", "credential"]],
  ];
```
  and export `GROUPS`.
- `architecture-links.js`: `KINDS` adds `"instance-of"`; `ENTITY_KINDS` adds `"product"` after `"service"`; `WORDS["instance-of"] = { out: "is a version of", in: "runs this version" }`.
- `architecture-icons.js`: `product` icon (a box: `[["path", { d: "M12 3 20 7.5v9L12 21l-8-4.5v-9z" }], ["path", { d: "M4 7.5 12 12l8-4.5M12 12v9" }]]`), `FAMILY.product = "compute"`.
- `architecture-ui.js`: `pickKind` and `backgroundMenu`'s `add` become submenus built from `A.GROUPS`:

```js
  function kindMenu() {
    return A.GROUPS.map(function (g) {
      return [g[0], "", g[1].map(function (kind) {
        return [word(kind), "", function () { create(kind); }, { icon: icon(kind), title: W.meaning(catalog, kind) }];
      })];
    });
  }
```
  `pickKind` shows `kindMenu()`; `backgroundMenu` uses `["Add", "A", kindMenu()]`. The legend (`legend()`) keeps the flat `A.KINDS` list.

Run: `npm test` → PASS.

- [ ] **Step 9: Checks, commit, owner look**

Run the full check list (Task 1, Step 15), with `git commit -S -m "Share exploit discovery across the instances of a product"`. Owner look: open the lecture course file, see OpenSSH as its own component linked to the SSH server, Patch scenario on it, Add menu grouped. Wait for the owner's word.

---

### Task 3: Identity — MFA, workload identity, role assumption

Branch: `feature/identity`.

**Files:**
- Modify: core `architecture.rs`, `architecture_validate.rs`; format `architecture_read.rs`, `architecture_write.rs`
- Modify: components `graph.rs`, `resolve.rs`, `export.rs`, `catalog.rs`, `generate.rs`; solver `graph_results.rs`
- Modify: `assets/js/architecture-links.js`, `architecture-links-ui.js`, `vocabulary.js`, `attack-ui.js` (status word only if it hard-codes `policy`)
- Test: core, format, generation, `scripts/architecture-links.test.js`, `scripts/vocabulary.test.js`
- Fixtures: every account gains `mfa-bypass` and `defenses: {mfa: …}`; lecture accounts get `defenses: {mfa: false}` so its numbers stay; JS fixtures, solver snapshot

**Interfaces:**
- Produces: `Slot::MfaBypass` (`"mfa-bypass"`; Account slots `[AdminLogin, MfaBypass]`); `Defense::Mfa` (`"mfa"`, on Account); `Factor { First, Second }` (`"first"|"second"`); `Relation::Authenticates { from, to, factor }`; `Relation::RunsAs { from, to, privilege }` (`"runs-as"`, from host/application/service, to account); `Relation::Assumes { from, to }` (`"assumes"`, account → account); `Binding::Policy { entity: EntityId, defense: Defense }` = zero when the switch is off, never when on, unknown when unknown; facts `state/account/<a>/{material,mfa-satisfied,authenticated}`; `input/policy/<a>/mfa`; `action/mfa-bypass/<a>`; `action/account-authenticated/<a>` (All, Logical). `service-login`/`administration-login` require `authenticated`. JS: `L.fieldsOf(kind, fromKind, toKind) -> {name, values}[]` and `L.variants(doc, kind, from, to) -> object[]`.

- [ ] **Step 1: Failing core tests**

```rust
#[test]
fn accounts_carry_mfa_and_its_bypass() {
    assert_eq!(EntityKind::Account.defense(), Some(Defense::Mfa));
    assert_eq!(EntityKind::Account.slots(), &[Slot::AdminLogin, Slot::MfaBypass]);
}

#[test]
fn an_account_cannot_assume_itself_and_software_runs_as_user() {
    let mut m = Architecture::new("I");
    m.entities.insert("a".parse().unwrap(), Entity::new(EntityKind::Account, "A"));
    m.entities.insert("app".parse().unwrap(), Entity::new(EntityKind::Application, "App"));
    m.associations.insert("self".parse().unwrap(), Association {
        relation: Relation::Assumes { from: "a".parse().unwrap(), to: "a".parse().unwrap() }, description: None });
    m.associations.insert("run".parse().unwrap(), Association {
        relation: Relation::RunsAs { from: "app".parse().unwrap(), to: "a".parse().unwrap(), privilege: Privilege::Admin }, description: None });
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::AssociationType && d.path == "associations.self.to"), "{d:?}");
    assert!(d.iter().any(|d| d.code == Code::AssociationType && d.path == "associations.run.privilege"), "{d:?}");
}
```

Run: `cargo test -p effractor-core --test architecture` → compile error.

- [ ] **Step 2: Vocabulary**

`architecture.rs`:
- `Slot::MfaBypass` (`"mfa-bypass"`), `ALL: [Slot; 10]`; `EntityKind::Account.slots()` → `&[Slot::AdminLogin, Slot::MfaBypass]`.
- `Defense::Mfa` (`"mfa"`), `ALL: [Defense; 3]`; `Defenses.mfa: Option<Switch>` with `get`/`set` arms; `EntityKind::Account.defense()` → `Some(Defense::Mfa)`.
- New:

```rust
/// How a credential proves an account: alone, or as the second factor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub enum Factor {
    #[default]
    First,
    Second,
}

impl Factor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::First => "first",
            Self::Second => "second",
        }
    }
}
```
- `Relation::Authenticates { from, to, factor: Factor }`; `Relation::RunsAs { from, to, privilege: Privilege }` (`/// host/software → account: the workload's own identity; a host at this privilege, software as user.`); `Relation::Assumes { from, to }` (`/// account → account: the first may become the second.`).
- `RelationKind::{RunsAs, Assumes}` (`"runs-as"`, `"assumes"`), `ALL: [_; 12]`; `from_kinds`: RunsAs `[Host, Application, Service]` (agent joins in Task 4), Assumes `[Account]`; `to_kinds`: both `[Account]`; `has_privilege` includes `RunsAs`; `kind()`, `from()`, `to_entity()`, `privilege()` arms.

`architecture_validate.rs` `associations()` match: add

```rust
(Relation::Assumes { from, to }, _, _) if from == to => self.error(
    Code::AssociationType,
    format!("{at}.to"),
    "an account does not assume itself",
),
(Relation::RunsAs { privilege: Privilege::Admin, .. }, Some(k), _) if k != EntityKind::Host => self.error(
    Code::AssociationType,
    format!("{at}.privilege"),
    "software uses its identity as `user`; only a host names `admin`",
),
```

Run: `cargo test -p effractor-core` → PASS.

- [ ] **Step 3: Reader and writer: more than one field per association**

Replace the single-`extra` logic in `association()` with a field list per kind, kept in core so the reader and the catalog (Step 6) give one answer. In `architecture.rs`, `impl RelationKind`:

```rust
/// The fields beside kind/from/to/description this kind of association has.
pub fn fields(self) -> &'static [&'static str] {
    match self {
        Self::Permits => &["allowed"],
        Self::Authenticates => &["factor"],
        k if k.has_privilege() => &["privilege"],
        _ => &[],
    }
}
```

and in `architecture_read.rs`:

```rust
pub const FACTORS: [(&str, Factor); 2] = [("first", Factor::First), ("second", Factor::Second)];
```

The `fields(...)` whitelist becomes `["kind", "from", "to", "description", "privilege", "allowed", "factor"]` (Tasks 4–5 add `shell`, `decrypts`, `mode`); the misplaced-key loop iterates that whole list of extras and reports each present key not in `kind.fields()`. `factor` is optional:

```rust
let factor = match f.get("factor") {
    Some(e) if kind == RelationKind::Authenticates => cx.word(&e.value, &f.path("factor"), &FACTORS),
    _ => Some(Factor::First),
};
```
and `RelationKind::Authenticates => Relation::Authenticates { from, to, factor: factor? }`, `RunsAs => Relation::RunsAs { from, to, privilege: privilege? }`, `Assumes => Relation::Assumes { from, to }`. Tables: `RELATIONS: [_; 12]`, `SLOTS: [_; 10]` with `("mfa-bypass", Slot::MfaBypass)`, `DEFENSES: [_; 3]` with `("mfa", Defense::Mfa)`.

`architecture_write.rs`: after the privilege line,

```rust
if let Relation::Authenticates { factor: Factor::Second, .. } = r {
    w.line(4, "factor", word(&FACTORS, &Factor::Second));
}
```

Format test (`crates/effractor-format/tests/architecture.rs`): an architecture with `factor: second` on one `authenticates`, none on another, `runs-as` from a host with `privilege: user`, and `assumes`; assert canonical round trip, and that `factor: first` written explicitly canonicalizes to the line being omitted. A second test: `factor: third` is a `WrongType`/word error at `associations.<id>.factor`; `factor` on a `grants` is `MisplacedKey`.

Run: `cargo test -p effractor-format` → PASS (fixture canonical tests fail until Step 8).

- [ ] **Step 4: `Binding::Policy`**

`graph.rs`:

```rust
    /// Zero while the owner's defence is off, never while it is on: a
    /// defence that removes a way rather than slowing one.
    Policy { entity: EntityId, defense: Defense },
```

`GeneratedNode.duration`'s doc becomes: `/// Read only as the kind allows: an Any is always \`Logical\`, an All a \`Parameter\` or — for a join that takes no time — \`Logical\`, an Input a foothold, a permission or a policy.` The `Input` variant's doc becomes `/// Completes at zero or never: a declared foothold, a firewall rule or a defence switch.`

`resolve.rs`: the switch lookup the `Parameter` arm does inline moves into a helper both arms use:

```rust
/// A defence switch's value under the scenario, and the path that set it.
fn switch(model: &Architecture, overlay: &Overlay, entity: &EntityId, defense: Defense) -> Setting {
    match overlay.defenses.get(&(entity, defense)) {
        Some((v, p)) => (*v, p.clone()),
        None => (
            model
                .entities
                .get(entity)
                .and_then(|e| e.defenses.get(defense))
                .unwrap_or(Switch::Unknown),
            format!("entities.{entity}.defenses.{}", defense.as_str()),
        ),
    }
}
```

The `Parameter` arm's `(Owner::Entity(eid), Some((defense, replaced)))` branch becomes `let (value, path) = switch(model, &overlay, eid, *defense);`. The new arm, after `Permission`:

```rust
Binding::Policy { entity, defense } => {
    let (value, path) = switch(model, &overlay, entity, *defense);
    // Off: the way is open at once. On: it is closed.
    let ttc = match value {
        Switch::Off => ResolvedTtc::Known(Distribution::Zero),
        Switch::On => ResolvedTtc::Known(Distribution::Infinity),
        Switch::Unknown => ResolvedTtc::Unknown(vec![path.clone()]),
    };
    (ttc, Vec::new(), vec![path])
}
```

The module doc's second sentence becomes "only which slot, switch, permission or policy value each node reads."

`export.rs` `timing()`: doc — `status` is `logical`, `foothold`, `policy` (a firewall rule), `defense` (a switch that opens or closes a way), `unknown` or the evidence; `expression` is TTC text, `allowed`/`denied` for a firewall rule, `off`/`on` for a defence switch. Arm after the `Permission` arm:

```rust
(Binding::Policy { .. }, ResolvedTtc::Known(d)) => {
    let on = matches!(d, effractor_core::Distribution::Infinity);
    ("defense", Some(if on { "on" } else { "off" }.to_owned()), None)
}
```

`crates/effractor-solver/src/graph_results.rs` `assumptions()`: add beside the `Permission` arm

```rust
(Binding::Policy { .. }, ResolvedTtc::Known(d)) => (
    "defense",
    Some(if matches!(d, Distribution::Infinity) { "on" } else { "off" }.to_owned()),
),
```

and extend the unknown arm to `Binding::Permission(_) | Binding::Policy { .. } | Binding::Parameter { .. }`. `Assumption.status`'s doc: "The parameter's evidence, `policy`, `defense`, or `unknown`."; `expression`'s: "Canonical TTC text, `allowed`/`denied` for a firewall rule, `off`/`on` for a defence switch, `None` if unknown."

Run: `cargo build --workspace`
Expected: compiles (nothing generates a `Policy` yet). The solver's support analysis needs no change: an input resolved to `Zero` is `Own::Zero`, to `Infinity` `Own::Never`, whatever its binding.

- [ ] **Step 5: Failing generation and resolution tests**

Append to `crates/effractor-components/tests/generation.rs` (add `Defense`, `Factor`, `Slot`, `Switch` to its `effractor_core::architecture` import):

```rust
#[test]
fn a_login_needs_the_account_authenticated_and_mfa_joins_material() {
    let g = generate(&lecture()).unwrap();
    assert_eq!(
        inputs(&g, "action/service-login/server-account/sshd"),
        vec!["state/account/server-account/authenticated", "state/service/sshd/reachable"]
    );
    assert_eq!(
        inputs(&g, "action/account-authenticated/server-account"),
        vec!["state/account/server-account/material", "state/account/server-account/mfa-satisfied"]
    );
    assert_eq!(node(&g, "action/account-authenticated/server-account").duration, Binding::Logical);
    let mut mfa = inputs(&g, "state/account/server-account/mfa-satisfied");
    mfa.sort();
    assert_eq!(mfa, vec!["action/mfa-bypass/server-account", "input/policy/server-account/mfa"]);
    assert_eq!(
        node(&g, "input/policy/server-account/mfa").duration,
        Binding::Policy { entity: id("server-account"), defense: Defense::Mfa }
    );
    assert_eq!(inputs(&g, "action/mfa-bypass/server-account"), vec!["state/account/server-account/material"]);
    assert!(matches!(
        node(&g, "action/mfa-bypass/server-account").duration,
        Binding::Parameter { base: Slot::MfaBypass, replacement: None, .. }
    ));
}

#[test]
fn a_second_factor_satisfies_mfa_and_gives_no_material() {
    let mut m = lecture();
    add(&mut m, "seed", EntityKind::Credential);
    relate(&mut m, "seed-auth", Relation::Authenticates { from: id("seed"), to: id("server-account"), factor: Factor::Second });
    let g = generate(&m).unwrap();
    assert!(inputs(&g, "state/account/server-account/mfa-satisfied").contains(&"state/credential/seed/possessed".to_owned()));
    assert!(!inputs(&g, "state/account/server-account/material").contains(&"state/credential/seed/possessed".to_owned()));
}

#[test]
fn a_workload_uses_its_identity_and_roles_chain_finitely() {
    let mut m = lecture();
    add(&mut m, "role-a", EntityKind::Account);
    add(&mut m, "role-b", EntityKind::Account);
    relate(&mut m, "sshd-runs-as", Relation::RunsAs { from: id("sshd"), to: id("role-a"), privilege: Privilege::User });
    relate(&mut m, "server-runs-as", Relation::RunsAs { from: id("server"), to: id("role-b"), privilege: Privilege::Admin });
    relate(&mut m, "a-to-b", Relation::Assumes { from: id("role-a"), to: id("role-b") });
    relate(&mut m, "b-to-a", Relation::Assumes { from: id("role-b"), to: id("role-a") });
    let g = generate(&m).unwrap();
    let a = inputs(&g, "state/account/role-a/authenticated");
    assert!(a.contains(&"state/service/sshd/control".to_owned()), "{a:?}");
    assert!(a.contains(&"state/account/role-b/authenticated".to_owned()), "{a:?}");
    let b = inputs(&g, "state/account/role-b/authenticated");
    assert!(b.contains(&"state/host/server/admin".to_owned()), "{b:?}");
    assert!(b.contains(&"state/account/role-a/authenticated".to_owned()), "{b:?}");
}

#[test]
fn role_cycles_are_finite() {
    let mut m = lecture();
    add(&mut m, "role-a", EntityKind::Account);
    add(&mut m, "role-b", EntityKind::Account);
    relate(&mut m, "a-to-b", Relation::Assumes { from: id("role-a"), to: id("role-b") });
    relate(&mut m, "b-to-a", Relation::Assumes { from: id("role-b"), to: id("role-a") });
    let reached = possible(&generate(&m).unwrap());
    // A→B→A with nothing seeding it is not a derivation.
    assert!(!reached.contains("state/account/role-a/authenticated"));
    assert!(!reached.contains("state/account/role-b/authenticated"));
}
```

Update `every_lecture_step_has_exactly_its_prerequisites`' expected table: for each of `server-account` and `admin-account` (`<a>`), add `state/account/<a>/mfa-satisfied` ← `[action/mfa-bypass/<a>, input/policy/<a>/mfa]`, `state/account/<a>/authenticated` ← `[action/account-authenticated/<a>]`, `action/account-authenticated/<a>` ← `[state/account/<a>/material, state/account/<a>/mfa-satisfied]`, `action/mfa-bypass/<a>` ← `[state/account/<a>/material]`, `input/policy/<a>/mfa` ← `[]`; change `action/service-login/server-account/sshd` to `[state/account/server-account/authenticated, state/service/sshd/reachable]` and `action/administration-login/admin-net/admin-account/bridge` to `[state/account/admin-account/authenticated, state/network/admin-net/access]`.

Append to `crates/effractor-components/tests/provenance.rs` (add `Defense`, `Scenario` to its `effractor_core::architecture` import and `Distribution`, `EntityId` to its `effractor_core` import where missing):

```rust
#[test]
fn mfa_resolves_as_a_policy_on_its_switch() {
    let mut m = architecture(LECTURE);
    m.scenarios.insert(
        id("mfa"),
        Scenario {
            label: "MFA".into(),
            changes: vec![Change::EntityDefense { entity: id("server-account"), defense: Defense::Mfa, value: Switch::On }],
        },
    );
    let g = generate(&m).unwrap();
    let i = index(&g, "input/policy/server-account/mfa");
    let base = resolve(&m, &g, None).unwrap();
    assert_eq!(base.ttc[i], ResolvedTtc::Known(Distribution::Zero));
    assert_eq!(base.paths[i], ["entities.server-account.defenses.mfa"]);
    let on = resolve(&m, &g, Some(&id("mfa"))).unwrap();
    assert_eq!(on.ttc[i], ResolvedTtc::Known(Distribution::Infinity));
    assert_eq!(on.paths[i], ["scenarios.mfa.changes[0]"]);
    m.entities[&id::<EntityId>("server-account")].defenses.mfa = Some(Switch::Unknown);
    let unknown = resolve(&m, &g, None).unwrap();
    assert_eq!(unknown.ttc[i], ResolvedTtc::Unknown(vec!["entities.server-account.defenses.mfa".into()]));
}

#[test]
fn switches_never_change_the_graph() {
    let model = architecture(LECTURE);
    let baseline = shape(&generate(&model).unwrap());
    for value in [Switch::On, Switch::Off, Switch::Unknown] {
        let mut m = model.clone();
        for e in m.entities.values_mut() {
            if let Some(defense) = e.kind.defense() {
                e.defenses.set(defense, Some(value));
            }
        }
        assert_eq!(shape(&generate(&m).unwrap()), baseline, "{value:?}");
    }
}
```

`switches_never_change_the_graph` sets every switch any kind has, so Tasks 4 and 5 extend it by adding kinds, not code; Task 5 also runs it on the cloud example.

Run: `cargo test -p effractor-components`
Expected: FAIL — no `action/account-authenticated/…`, no `input/policy/…`.

- [ ] **Step 6: Rules in the catalog**

`catalog.rs` (`RULES: [Rule; 26]`). Change `account-material`: `prerequisites: "credential.possessed, for a credential that authenticates the account as its first factor"`, assumptions `&["Any one first-factor credential gives the material; a second factor alone gives none.", "Material alone grants no access."]`. Change `service-login`'s prerequisites to `"service.reachable and account.authenticated, for an account the service authorizes"` and `administration-login`'s to `"access to the administering network and account.authenticated, for an account granted on the managed machine"`. Insert after `account-material`:

```rust
Rule {
    id: "mfa-policy",
    title: "Multi-factor login is off",
    version: 1,
    bindings: &["account"],
    prerequisites: "the account's `mfa` switch is off",
    output: "account.mfa-satisfied",
    duration: D::Logical,
    scope: "one per account",
    assumptions: &["An unknown switch is an unknown branch, not a guess either way."],
},
Rule {
    id: "mfa-second-factor",
    title: "A second factor is held",
    version: 1,
    bindings: &["authenticates"],
    prerequisites: "credential.possessed, for a credential that authenticates the account with `factor: second`",
    output: "account.mfa-satisfied",
    duration: D::Logical,
    scope: "one per second-factor authenticates association",
    assumptions: &["A hardware key, an authenticator seed or a stolen session cookie in the attacker's hands is the second factor."],
},
Rule {
    id: "mfa-bypass",
    title: "Get past multi-factor login",
    version: 1,
    bindings: &["account"],
    prerequisites: "account.material",
    output: "account.mfa-satisfied",
    duration: D::Slot { slot: Slot::MfaBypass, replaced_by: None },
    scope: "one per account",
    assumptions: &["Push fatigue, adversary-in-the-middle proxies and SIM swaps are one timed step; the note says which the value stands for."],
},
Rule {
    id: "account-authenticated",
    title: "The account can log in",
    version: 1,
    bindings: &["account"],
    prerequisites: "account.material and account.mfa-satisfied",
    output: "account.authenticated",
    duration: D::Logical,
    scope: "one per account",
    assumptions: &["With multi-factor login off, a first factor alone authenticates."],
},
Rule {
    id: "workload-identity",
    title: "Running code uses its identity",
    version: 1,
    bindings: &["runs-as"],
    prerequisites: "the workload under control, or its host at the declared privilege",
    output: "account.authenticated",
    duration: D::Logical,
    scope: "one per runs-as association",
    assumptions: &[
        "Whoever runs code in the workload can obtain its identity's token; metadata-endpoint hardening stops remote request forgery, not code execution, so it is not a switch here.",
        "The token is still used through an ordinary login to a service that authorizes the account.",
    ],
},
Rule {
    id: "assume-role",
    title: "Become another role",
    version: 1,
    bindings: &["assumes"],
    prerequisites: "the first account authenticated",
    output: "the second account authenticated",
    duration: D::Logical,
    scope: "one per assumes association",
    assumptions: &["Trust-policy conditions (external id, required MFA, source address) are not modelled."],
},
```

Words: `slot_name(Slot::MfaBypass)` → `"Get past multi-factor login"`; `slot_description(Slot::MfaBypass)` → `("account", "Time to get past the second factor once a first factor is held: push fatigue, a proxy, a SIM swap — the note says which.")`. `kind_description(Account)` → `"An identity with explicit authentication and grants; no implicit global privileges. Multi-factor login is its switch."`. `relation_description`: `Authenticates` → `"A credential that proves an account: as its first factor (any one suffices) or, with \`factor: second\`, as the second."`; `RunsAs` → `"The identity a workload runs as: a host at \`privilege: user | admin\`, software as \`user\`. Code in it can use the identity without credentials."`; `Assumes` → `"An account that may become another, e.g. a role it can assume."`.

A new catalog list, `defenses`, gives every switch its word, so the page never shows `mfa`:

```rust
/// A defence switch as the page names it, and what turning it on means.
fn defense_word(defense: Defense) -> (&'static str, &'static str) {
    match defense {
        Defense::Patched => ("Patched", "The vendor fix is applied: `find-exploit-patched` stands in for `find-exploit`."),
        Defense::Protected => ("Protected", "Where the credential is kept is hardened: `extract-protected` stands in for `extract`."),
        Defense::Mfa => ("Multi-factor login", "The account needs a second factor: a first factor alone no longer logs in."),
    }
}
```

In `catalog()`: `let defenses: Vec<Value> = Defense::ALL.iter().map(|&d| { let (word, description) = defense_word(d); json!({"id": d.as_str(), "word": word, "description": description}) }).collect();` and `"defenses": defenses` in the returned object (doc comment lists it). The association entries' single `"field"` becomes `"fields": kind.fields()` (the list from Step 3). Tasks 4–5 add to `defense_word`.

- [ ] **Step 7: Generate**

`generate.rs`:
- Import `Factor`.
- `states()`, the `EntityKind::Account` arm, creates three facts:

```rust
EntityKind::Account => {
    for (state, word) in [
        ("material", "credential held"),
        ("mfa-satisfied", "second factor no obstacle"),
        ("authenticated", "can log in"),
    ] {
        let fid = self.state_id(id, state);
        self.fact(fid, format!("{} · {word}", entity.label));
    }
}
```

- `credentials()`, the `Authenticates` arm, by factor:

```rust
Relation::Authenticates { from, to, factor } => {
    let (rule, fact) = match factor {
        Factor::First => ("account-material", "material"),
        Factor::Second => ("mfa-second-factor", "mfa-satisfied"),
    };
    let o = Origin {
        entities: vec![from.clone(), to.clone()],
        associations: vec![aid.clone()],
        ..origin(rule)
    };
    let possessed = self.state_id(from, State::Possessed.as_str());
    let reached = self.state_id(to, fact);
    self.produce(&possessed, &reached, o);
}
```

- New `accounts()`, called right after `credentials()`:

```rust
/// Per account: the MFA switch as a policy, the bypass, and the join of
/// material and second factor into a login.
fn accounts(&mut self) {
    for (aid, entity) in &self.m.entities {
        if entity.kind != EntityKind::Account {
            continue;
        }
        let owner = Owner::Entity(aid.clone());
        let material = self.state_id(aid, "material");
        let satisfied = self.state_id(aid, "mfa-satisfied");
        let authenticated = self.state_id(aid, "authenticated");
        let switch = format!("entities.{aid}.defenses.mfa");

        let input = format!("input/policy/{aid}/mfa");
        let policy = Origin {
            entities: vec![aid.clone()],
            paths: vec![switch],
            ..origin("mfa-policy")
        };
        self.insert(
            input.clone(),
            format!("Multi-factor login off · {}", entity.label),
            DraftKind::Input(Binding::Policy { entity: aid.clone(), defense: Defense::Mfa }),
        );
        self.originate(&input, policy.clone());
        self.produce(&input, &satisfied, policy);

        let bypass = Origin {
            entities: vec![aid.clone()],
            paths: vec![owner.slot_path(Slot::MfaBypass)],
            ..origin("mfa-bypass")
        };
        self.action(
            format!("action/mfa-bypass/{aid}"),
            format!("Get past multi-factor login · {}", entity.label),
            Binding::Parameter { owner, base: Slot::MfaBypass, replacement: None },
            std::slice::from_ref(&material),
            &satisfied,
            bypass,
        );

        let join = Origin {
            entities: vec![aid.clone()],
            ..origin("account-authenticated")
        };
        self.action(
            format!("action/account-authenticated/{aid}"),
            format!("Log in as · {}", entity.label),
            Binding::Logical,
            &[material, satisfied],
            &authenticated,
            join,
        );
    }
}
```

- New `identities()`, called after `accounts()`:

```rust
/// Workloads authenticate as the accounts they run as; an account that may
/// become another is authenticated as it too. Cycles are ordinary facts.
fn identities(&mut self) {
    for (id, a) in &self.m.associations {
        match &a.relation {
            Relation::RunsAs { from, to, privilege } => {
                let workload = match self.kind(from) {
                    EntityKind::Host => self.machine_id(from, *privilege),
                    _ => self.state_id(from, State::Control.as_str()),
                };
                let o = Origin {
                    entities: vec![from.clone(), to.clone()],
                    associations: vec![id.clone()],
                    ..origin("workload-identity")
                };
                let authenticated = self.state_id(to, "authenticated");
                self.produce(&workload, &authenticated, o);
            }
            Relation::Assumes { from, to } => {
                let o = Origin {
                    entities: vec![from.clone(), to.clone()],
                    associations: vec![id.clone()],
                    ..origin("assume-role")
                };
                let source = self.state_id(from, "authenticated");
                let target = self.state_id(to, "authenticated");
                self.produce(&source, &target, o);
            }
            _ => {}
        }
    }
}
```

- `logins()`: `self.state_id(from, "material")` → `self.state_id(from, "authenticated")`. `administration()`: `self.state_id(account, "material")` → `self.state_id(account, "authenticated")`.
- `generate_within`: `b.credentials(); b.accounts(); b.identities(); b.logins(); …`.

Run: `cargo test -p effractor-components`
Expected: the Step 5 tests PASS; `the_lecture_fixture_is_canonical_and_complete` FAILS (accounts now carry `mfa-bypass` and `defenses`).

- [ ] **Step 8: Rewrite fixtures; keep the lecture's numbers**

Canonicalize every file listed in Task 1, Step 12. Canonical text now writes `mfa-bypass: {status: unknown}` under every account's `parameters` and `defenses: {mfa: unknown}`. An unknown switch makes every login an unknown branch, so in each of those files change every account's line to `defenses: {mfa: false}` — the value these files have always assumed — and add a `description` line to accounts that have none only if the file already describes its accounts. Canonicalize again; the result is the file.

```bash
grep -rn "mfa: unknown" docs/course assets crates/*/tests/fixtures   # expect no output
```

`lecture-unknown.yaml` is the fixture with intentional unknowns; its accounts also get `mfa: false`, so the list of missing paths its tests expect stays as it is.

Regenerate the fixtures (the block under "Fixture regeneration"). Read the diffs: new nodes `input/policy/*/mfa`, `action/mfa-bypass/*`, `action/account-authenticated/*`, `state/account/*/{mfa-satisfied,authenticated}`; login prerequisites renamed; `p_target` of every scenario unchanged within the snapshot's sampling noise, since a switch that is off opens the way at time zero and a zero-time fact is never expanded, so the unknown `mfa-bypass` slots stay out of every result.

Run: `cargo test --workspace`
Expected: PASS.

- [ ] **Step 9: Words on the page (JS)**

Failing tests:

```js
// scripts/vocabulary.test.js
test('a defence switch and its step status read as words', () => {
  assert.equal(W.defense(catalog, 'mfa'), 'Multi-factor login');
  assert.equal(W.defense(catalog, 'patched'), 'Patched');
  assert.equal(W.defense(null, 'mfa'), 'mfa');
  assert.equal(W.status('defense'), 'Defence switch');
});
```

Implement in `vocabulary.js`: `defense: function (catalog, id) { return pick(catalog, "defenses", "id", id, "word"); },` and `STATUS.defense = "Defence switch"` (in the literal). In `attack-ui.js:252`, `a.status === "policy" || a.status === "unknown"` becomes `a.status === "policy" || a.status === "defense" || a.status === "unknown"`. In `architecture-ui.js` (the entity inspector, ~line 602), the switch's label `word(defense)` becomes `W.defense(catalog, defense)`.

`scripts/fixtures/catalog.json` must carry `defenses`: `scripts/build-wasm.sh && node scripts/graph-fixtures.js --write`.

Run: `npm test` → PASS.

- [ ] **Step 10: Links with more than one field (JS)**

Failing tests in `scripts/architecture-links.test.js`:

```js
test('a link offers every combination of the fields its kind carries', () => {
  const doc = { entities: {
    k: { kind: 'credential', label: 'K' }, a: { kind: 'account', label: 'A' }, b: { kind: 'account', label: 'B' },
    h: { kind: 'host', label: 'H' }, app: { kind: 'application', label: 'App' },
  }, associations: {}, flows: {} };
  assert.deepEqual(L.fieldsOf('authenticates', 'credential', 'account'), [{ name: 'factor', values: ['first', 'second'] }]);
  assert.deepEqual(L.variants(doc, 'authenticates', 'k', 'a'), [{ factor: 'first' }, { factor: 'second' }]);
  assert.deepEqual(L.variants(doc, 'runs-as', 'h', 'a'), [{ privilege: 'user' }, { privilege: 'admin' }]);
  assert.deepEqual(L.variants(doc, 'runs-as', 'app', 'a'), [{ privilege: 'user' }]);
  assert.deepEqual(L.variants(doc, 'assumes', 'a', 'b'), [{}]);
  assert.equal(L.phrase('authenticates', 'out', null, { factor: 'second' }), 'unlocks, as second factor');
  assert.equal(L.phrase('assumes', 'out'), 'may become');
});

test('a second factor is written, a first factor is not', () => {
  const doc = { entities: { k: { kind: 'credential', label: 'K' }, a: { kind: 'account', label: 'A' } }, associations: {}, flows: {} };
  const second = L.putAssociation(doc, 'k-a', { kind: 'authenticates', from: 'k', to: 'a', factor: 'second' });
  assert.deepEqual(second.doc.associations['k-a'], { kind: 'authenticates', from: 'k', to: 'a', factor: 'second' });
  const first = L.putAssociation(doc, 'k-a', { kind: 'authenticates', from: 'k', to: 'a', factor: 'first' });
  assert.deepEqual(first.doc.associations['k-a'], { kind: 'authenticates', from: 'k', to: 'a' });
});

test('an account cannot be linked to become itself', () => {
  const doc = { entities: { a: { kind: 'account', label: 'A' } }, associations: {}, flows: {} };
  const become = L.linkChoices(doc, catalog, 'a').find((c) => c.kind === 'assumes' && c.direction === 'out');
  assert.deepEqual(become.candidates, []);
});
```

Implement in `architecture-links.js`:
- `KINDS` adds `"runs-as", "assumes"` after `"instance-of"`; `PRIVILEGED` adds `"runs-as"`; `privilegesOf`: `if (kind === "runs-as" && fromKind !== "host") return ["user"];` beside the `stores` line.
- Fields beside privilege, their order in the file, and their words:

```js
  // The fields a link carries beside kind/from/to, in the file's order.
  var FIELD_ORDER = ["privilege", "factor"];
  // What a field's value adds to a link's words; a missing entry adds nothing.
  var FIELD_WORDS = { factor: { second: "as second factor" } };

  // The fields a link of `kind` between these kinds carries, each with the
  // values it may take there.
  function fieldsOf(kind, fromKind, toKind) {
    var out = [];
    var p = privilegesOf(kind, fromKind, toKind);
    if (p) out.push({ name: "privilege", values: p });
    if (kind === "authenticates") out.push({ name: "factor", values: ["first", "second"] });
    return out;
  }

  // Every combination of those values: the ways the Link menu offers.
  function variants(doc, kind, from, to) {
    return fieldsOf(kind, kindOf(doc, from), kindOf(doc, to)).reduce(function (acc, f) {
      var out = [];
      acc.forEach(function (v) {
        f.values.forEach(function (value) {
          var next = Object.assign({}, v);
          next[f.name] = value;
          out.push(next);
        });
      });
      return out;
    }, [{}]);
  }

  function fieldWord(name, value) {
    return FIELD_WORDS[name] && FIELD_WORDS[name][String(value)] ? FIELD_WORDS[name][String(value)] : "";
  }
```

- `putAssociation`: after the privilege and allowed lines, `if (value.kind === "authenticates" && value.factor === "second") a.factor = "second";` (Tasks 4–5 add their fields here, in `FIELD_ORDER`). Its doc lists `factor?`.
- `phrase(relation, direction, privilege, fields)`: after computing the privilege words as today, append each `fieldWord(name, fields[name])` that is non-empty, joined with `", "`, for `name` in `FIELD_ORDER` other than `privilege`. `phrase` with three arguments behaves as today.
- `WORDS["runs-as"] = { out: "runs as", in: "runs as this" }`; `WORDS.assumes = { out: "may become", in: "may become this" }`.
- `linkChoices`: in the `out` candidate filter, `if (spec.kind === "assumes" && other === id) return false;` is already covered by `other === id`; nothing to add. The test pins it.
- Export `fieldsOf`, `variants`, `fieldWord`.

In `architecture-links-ui.js`:
- `linkItems`: replace the privilege loop by variants: collect `L.variants(doc(), choice.kind, fromTo[0], fromTo[1])` for each candidate, keyed by `JSON.stringify(variant)` in first-seen order; for each key, the fitting candidates are those whose own variant list contains that key; the item is `[L.phrase(choice.kind, choice.direction, v.privilege || null, v), "", …, { title: choice.kind + … }]`. `endItem`/`link` take the variant object instead of `privilege` and call `L.putAssociation(doc(), null, Object.assign({ kind: kind, from: from, to: to }, variant))`.
- `associationSection`: replace the privilege block with one dropdown per field:

```js
    L.fieldsOf(a.kind, kindOf(a.from), kindOf(a.to)).forEach(function (f) {
      var current = a[f.name] == null ? f.values[0] : String(a[f.name]);
      var options = f.values.concat(f.values.indexOf(current) < 0 ? [current] : []).map(function (v) {
        return [String(v), L.fieldWord(f.name, v) || String(v)];
      });
      var control = U.field(form, "prop-" + f.name, f.name.charAt(0).toUpperCase() + f.name.slice(1), M.dropdown(options, current));
      control.addEventListener("change", function () {
        var change = {};
        change[f.name] = control.value === "true" ? true : control.value === "false" ? false : control.value;
        U.apply(function () {
          return L.putAssociation(doc(), id, Object.assign({}, doc().associations[id], change));
        }, null, true);
      });
    });
```

- The link rows (`~223`, `~237`) pass the association as the fourth argument: `L.phrase(l.kind, l.direction, a.privilege, a)`.
- `architecture-ui.js:692`'s focus map gains `factor: "prop-factor"`.

Run: `npm test` → PASS.

- [ ] **Step 11: Checks, commit, owner look**

Run the full check list (Task 1, Step 15) with `git commit -S -m "Log in through multi-factor authentication, workload identity and role assumption"`. Owner look (8081): select the lecture's server account and see "Multi-factor login: false" with "Get past multi-factor login" among its parameters; switch it on and see Build's route go through the key's extraction and the bypass; link a credential to it as a second factor and see "unlocks, as second factor"; give the SSH server an identity with "runs as" and let one account "may become" another. Wait for the owner's word.

---

### Task 4: Operators — people and agents

> **Done, amended (2026-09-24).** Landed with people only (PR #80). The agent
> parts below (the `agent` kind, `shell`, `inject`, `agent-shell`, the
> `guarded` switch on agents) were built, reviewed by the owner and removed
> before merge: spec §10 replaces them with content-processing software.
> Kept: `person`, `knows`, `operates`, `delivers` (network → person),
> `phish`, `person-disclose`, `person-run`, `content-from-zone`,
> `content-from-service` (through applications a person operates), the
> `operators()` generator and the `bound()` helper. The text below is the
> record of what was planned, not a to-do.

Branch: `feature/operators`.

**Files:**
- Modify: core `architecture.rs`, `architecture_validate.rs`; format `architecture_read.rs`, `architecture_write.rs`
- Modify: components `catalog.rs`, `generate.rs`
- Modify: `assets/js/architecture-edit.js`, `architecture-links.js`, `architecture-links-ui.js`, `architecture-icons.js`
- Test: `crates/effractor-core/tests/architecture.rs`, `crates/effractor-format/tests/architecture.rs`, `crates/effractor-components/tests/generation.rs`, `crates/effractor-components/tests/provenance.rs`, `scripts/architecture-edit.test.js`, `architecture-links.test.js`, `architecture-icons.test.js`
- Fixtures: JS catalog fixture, solver snapshot (catalog text only; no existing file has a person or agent)

**Interfaces:**
- Consumes: Task 3's `Binding`, `RelationKind::fields()`, `L.fieldsOf`/`L.variants`/`L.fieldWord`/`FIELD_ORDER`, `defense_word`, `Relation::RunsAs`, `state/account/<a>/authenticated`.
- Produces: `EntityKind::Agent` (`"agent"`, after `Product`; states `[Contacted, Control]`, slots `[Inject, InjectGuarded]`, defence `Guarded`, `is_executable()`), `EntityKind::Person` (`"person"`, after `Credential`; states `[Contacted, Deceived]`, slots `[Phish, PhishTrained]`, defence `Trained`); `State::{Contacted, Deceived}` (`"contacted"`, `"deceived"`); `Slot::{Phish, PhishTrained, Inject, InjectGuarded}`; `Defense::{Trained, Guarded}`; `Relation::Hosts { from, to, privilege, shell: Option<bool> }`; `Relation::{Knows, Operates, Delivers} { from, to }` (`"knows"`: person → credential, `"operates"`: person → application, `"delivers"`: network → person | agent); `RunsAs` from kinds gain `Agent`; flow sources gain `Agent`. Ids: `action/phish/<p>`, `action/inject/<a>`, facts `state/person/<p>/{contacted,deceived}`, `state/agent/<a>/{contacted,control}`. JS: `GROUPS` Compute gains `agent`, Identity gains `person`.

- [ ] **Step 1: Failing core tests**

Append to `crates/effractor-core/tests/architecture.rs`:

```rust
#[test]
fn people_and_agents_carry_their_switches() {
    assert_eq!(EntityKind::Person.states(), &[State::Contacted, State::Deceived]);
    assert_eq!(EntityKind::Person.slots(), &[Slot::Phish, Slot::PhishTrained]);
    assert_eq!(EntityKind::Person.defense(), Some(Defense::Trained));
    assert_eq!(EntityKind::Agent.states(), &[State::Contacted, State::Control]);
    assert_eq!(EntityKind::Agent.slots(), &[Slot::Inject, Slot::InjectGuarded]);
    assert_eq!(EntityKind::Agent.defense(), Some(Defense::Guarded));
}

fn agent_model(shell: Option<bool>) -> Architecture {
    let mut m = Architecture::new("A");
    m.entities.insert("vm".parse().unwrap(), Entity::new(EntityKind::Host, "VM"));
    m.entities.insert("bot".parse().unwrap(), Entity::new(EntityKind::Agent, "Bot"));
    m.associations.insert("vm-bot".parse().unwrap(), Association {
        relation: Relation::Hosts { from: "vm".parse().unwrap(), to: "bot".parse().unwrap(), privilege: Privilege::User, shell },
        description: None,
    });
    m
}

#[test]
fn an_agent_needs_a_host_and_a_word_on_its_shell() {
    let mut m = agent_model(None);
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::Incomplete && d.path == "associations.vm-bot" && d.message.contains("shell")), "{d:?}");
    m.associations.clear();
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::Incomplete && d.path == "entities.bot"), "{d:?}");
    let d = validate_architecture(&agent_model(Some(true)));
    assert!(d.iter().all(|d| !d.path.starts_with("associations.vm-bot")), "{d:?}");
}

#[test]
fn only_an_agent_hosting_says_shell() {
    let mut m = agent_model(Some(false));
    m.entities.insert("app".parse().unwrap(), Entity::new(EntityKind::Application, "App"));
    m.associations.insert("vm-app".parse().unwrap(), Association {
        relation: Relation::Hosts { from: "vm".parse().unwrap(), to: "app".parse().unwrap(), privilege: Privilege::User, shell: Some(true) },
        description: None,
    });
    let d = validate_architecture(&m);
    assert!(d.iter().any(|d| d.code == Code::MisplacedKey && d.path == "associations.vm-app.shell"), "{d:?}");
}

#[test]
fn a_person_nothing_reaches_is_complete() {
    let mut m = Architecture::new("P");
    m.entities.insert("p".parse().unwrap(), Entity::new(EntityKind::Person, "P"));
    assert!(validate_architecture(&m).iter().all(|d| d.path != "entities.p"));
}
```

Existing tests that build `Relation::Hosts { … }` (here and in Task 1's `vm_model`, and in `crates/effractor-components/tests/generation.rs`) gain `shell: None`.

Run: `cargo test -p effractor-core --test architecture` → compile error.

- [ ] **Step 2: Vocabulary and validation**

`architecture.rs`:
- `EntityKind::Agent` after `Product`, `EntityKind::Person` after `Credential`; `ALL: [EntityKind; 11]`; `as_str` `"agent"`, `"person"`; `states`: `Agent => &[State::Contacted, State::Control]`, `Person => &[State::Contacted, State::Deceived]`; `slots`: `Agent => &[Slot::Inject, Slot::InjectGuarded]`, `Person => &[Slot::Phish, Slot::PhishTrained]`; `defense`: `Agent => Some(Defense::Guarded)`, `Person => Some(Defense::Trained)`; `is_executable` → `matches!(self, Self::Application | Self::Service | Self::Agent)` with doc `/// Runs on a host or router: needs exactly one \`hosts\`.`
- `State::Contacted` (`"contacted"`), `State::Deceived` (`"deceived"`), `ALL: [State; 7]`.
- `Slot::{Phish, PhishTrained, Inject, InjectGuarded}` (`"phish"`, `"phish-trained"`, `"inject"`, `"inject-guarded"`), `ALL: [Slot; 14]`.
- `Defense::{Trained, Guarded}` (`"trained"`, `"guarded"`), `ALL: [Defense; 5]`; `Defenses` gains `trained` and `guarded` fields with `get`/`set` arms, each documented (`/// A person: \`phish-trained\` stands in for \`phish\`.`, `/// An agent: \`inject-guarded\` stands in for \`inject\`.`).
- `Relation::Hosts` gains `shell: Option<bool>` (`/// For an agent only: whether its tools run commands on the host. None is unsaid.`).
- `Relation::{Knows, Operates, Delivers} { from: EntityId, to: EntityId }` (docs: `/// person → credential: what they could type into a fake login.`, `/// person → application: the software they use.`, `/// network → person | agent: content from anyone in the zone reaches this reader.`); `RelationKind::{Knows, Operates, Delivers}` (`"knows"`, `"operates"`, `"delivers"`), `ALL: [_; 15]`; `from_kinds`: `Knows | Operates => &[K::Person]`, `Delivers => &[K::Network]`, `RunsAs => &[K::Host, K::Application, K::Service, K::Agent]`; `to_kinds`: `Knows => &[K::Credential]`, `Operates => &[K::Application]`, `Delivers => &[K::Person, K::Agent]`, `Hosts => &[K::Application, K::Service, K::Router, K::Host, K::Agent]`; `kind()`, `from()`, `to_entity()` arms; `fields()`: `Self::Hosts => &["privilege", "shell"]` before the `has_privilege` arm.
- The module doc's counts.

`architecture_validate.rs`:
- `flows()`: the source kinds become `&[EntityKind::Application, EntityKind::Service, EntityKind::Agent]`.
- `associations()`, in the match on `(r, from, to)`:

```rust
(Relation::Hosts { shell: Some(_), .. }, _, Some(k)) if k != EntityKind::Agent => self.error(
    Code::MisplacedKey,
    format!("{at}.shell"),
    "`shell` says whether an agent's tools run commands; this runs no agent",
),
(Relation::Hosts { shell: None, to, .. }, _, Some(EntityKind::Agent)) => self.incomplete(
    at.clone(),
    format!("say whether \"{to}\"'s tools run commands on its host: `shell: true | false`"),
),
```

- The `RunsAs` software-as-user arm from Task 3 already covers an agent (`k != Host`).

Run: `cargo test -p effractor-core` → PASS.

- [ ] **Step 3: Reader, writer, round trip**

`architecture_read.rs`: `KINDS: [_; 11]` (`("agent", EntityKind::Agent)` after product, `("person", EntityKind::Person)` after credential); `RELATIONS: [_; 15]`; `STATES: [_; 7]` (`("contacted", …)`, `("deceived", …)`); `SLOTS: [_; 14]`; `DEFENSES: [_; 5]`; `pub const BOOLS: [(&str, bool); 2] = [("true", true), ("false", false)];`. The field whitelist adds `"shell"`. `shell` is optional:

```rust
let shell = match f.get("shell") {
    Some(e) if kind == RelationKind::Hosts => cx.word(&e.value, &f.path("shell"), &BOOLS).map(Some),
    _ => Some(None),
};
```

and `RelationKind::Hosts => Relation::Hosts { from, to, privilege: privilege?, shell: shell? }`; `Knows`, `Operates`, `Delivers` → `{ from, to }`.

`architecture_write.rs`, after the privilege line:

```rust
if let Relation::Hosts { shell: Some(shell), .. } = r {
    w.line(4, "shell", word(&BOOLS, shell));
}
```

Round-trip test in `crates/effractor-format/tests/architecture.rs`: an architecture with a host `vm`, an agent `bot` (`inject`, `inject-guarded` illustrative, `defenses: {guarded: false}`), `vm-bot: {kind: hosts, from: vm, to: bot, privilege: admin, shell: true}`, a network `internet`, a person `ada` (`defenses: {trained: false}`), an application `mail` on `vm`, a credential `pw`, and `knows`, `operates`, `delivers` (to both `ada` and `bot`); assert `canonicalize(text) == text` and that the loaded `vm-bot` has `shell: Some(true)`. A second test: `shell: maybe` is a word error at `associations.vm-bot.shell`; `shell` on an `attached` is `MisplacedKey`.

Run: `cargo test -p effractor-core -p effractor-format` → PASS.

- [ ] **Step 4: Failing generation tests**

Append to `crates/effractor-components/tests/generation.rs`:

```rust
/// The lecture with a phishable administrator who uses the SSH client and
/// knows the server key, and a support bot on the server that reads mail.
fn operators() -> Architecture {
    let mut m = lecture();
    add(&mut m, "internet", EntityKind::Network);
    add(&mut m, "ada", EntityKind::Person);
    add(&mut m, "bot", EntityKind::Agent);
    add(&mut m, "bot-role", EntityKind::Account);
    relate(&mut m, "mail-ada", Relation::Delivers { from: id("internet"), to: id("ada") });
    relate(&mut m, "mail-bot", Relation::Delivers { from: id("internet"), to: id("bot") });
    relate(&mut m, "ada-key", Relation::Knows { from: id("ada"), to: id("server-key") });
    relate(&mut m, "ada-client", Relation::Operates { from: id("ada"), to: id("ssh-client") });
    relate(&mut m, "server-bot", Relation::Hosts { from: id("server"), to: id("bot"), privilege: Privilege::User, shell: Some(true) });
    relate(&mut m, "bot-runs-as", Relation::RunsAs { from: id("bot"), to: id("bot-role"), privilege: Privilege::User });
    m
}

#[test]
fn content_reaches_readers_and_deceit_or_injection_follows_by_a_timed_step() {
    let g = generate(&operators()).unwrap();
    assert!(inputs(&g, "state/person/ada/contacted").contains(&"state/network/internet/access".to_owned()));
    assert_eq!(inputs(&g, "action/phish/ada"), vec!["state/person/ada/contacted"]);
    assert!(matches!(
        node(&g, "action/phish/ada").duration,
        Binding::Parameter { base: Slot::Phish, replacement: Some((Defense::Trained, Slot::PhishTrained)), .. }
    ));
    assert!(inputs(&g, "state/credential/server-key/possessed").contains(&"state/person/ada/deceived".to_owned()));
    assert!(inputs(&g, "state/application/ssh-client/control").contains(&"state/person/ada/deceived".to_owned()));
    assert_eq!(inputs(&g, "action/inject/bot"), vec!["state/agent/bot/contacted"]);
    assert!(matches!(
        node(&g, "action/inject/bot").duration,
        Binding::Parameter { base: Slot::Inject, replacement: Some((Defense::Guarded, Slot::InjectGuarded)), .. }
    ));
    assert!(inputs(&g, "state/account/bot-role/authenticated").contains(&"state/agent/bot/control".to_owned()));
}

#[test]
fn a_controlled_service_reaches_the_readers_whose_flows_target_it() {
    // The lecture's SSH client flows to sshd: whoever controls sshd reaches
    // the client's operator.
    let g = generate(&operators()).unwrap();
    let mut contacted = inputs(&g, "state/person/ada/contacted");
    contacted.sort();
    assert_eq!(contacted, vec!["state/network/internet/access", "state/service/sshd/control"]);
}

#[test]
fn an_agent_controls_its_host_only_with_a_shell() {
    let g = generate(&operators()).unwrap();
    assert!(inputs(&g, "state/agent/bot/control").contains(&"state/host/server/user".to_owned()));
    assert!(inputs(&g, "state/host/server/user").contains(&"state/agent/bot/control".to_owned()));
    let mut m = operators();
    relate(&mut m, "server-bot", Relation::Hosts { from: id("server"), to: id("bot"), privilege: Privilege::User, shell: Some(false) });
    let g = generate(&m).unwrap();
    assert!(!inputs(&g, "state/host/server/user").contains(&"state/agent/bot/control".to_owned()));
    assert!(inputs(&g, "state/agent/bot/control").contains(&"state/host/server/user".to_owned()));
}
```

(`relate` inserts by key, so re-relating `server-bot` replaces it.) Extend `NOT_YET_IN_AN_EXAMPLE` with `"content-from-zone", "content-from-service", "phish", "person-disclose", "person-run", "inject", "agent-shell"`.

`switches_never_change_the_graph` (Task 3) runs on the lecture, which has no person or agent. The `operators()` builder lives in `generation.rs`, so `crates/effractor-components/tests/provenance.rs` builds the same structure inline (import `Association` and `EntityId` if missing):

```rust
#[test]
fn operator_switches_never_change_the_graph() {
    let mut model = architecture(LECTURE);
    for (key, kind) in [("internet", EntityKind::Network), ("ada", EntityKind::Person), ("bot", EntityKind::Agent)] {
        model.entities.insert(id(key), Entity::new(kind, key));
    }
    for (key, relation) in [
        ("mail-ada", Relation::Delivers { from: id("internet"), to: id("ada") }),
        ("mail-bot", Relation::Delivers { from: id("internet"), to: id("bot") }),
        ("server-bot", Relation::Hosts { from: id("server"), to: id("bot"), privilege: Privilege::User, shell: Some(true) }),
    ] {
        model.associations.insert(id(key), Association { relation, description: None });
    }
    let baseline = shape(&generate(&model).unwrap());
    for value in [Switch::On, Switch::Off, Switch::Unknown] {
        let mut m = model.clone();
        for e in m.entities.values_mut() {
            if let Some(defense) = e.kind.defense() {
                e.defenses.set(defense, Some(value));
            }
        }
        assert_eq!(shape(&generate(&m).unwrap()), baseline, "{value:?}");
    }
}
```

Run: `cargo test -p effractor-components` → compile errors, then FAIL once `Relation::Hosts` has `shell` everywhere (the `hosting()` destructure uses `..`).

- [ ] **Step 5: Rules in the catalog**

`catalog.rs`, `RULES: [Rule; 33]`. Change `host-execution`'s scope to `"one per hosts association naming an executable or agent"` and `execution-privilege`'s to `"one per hosts association naming an application or service"`. Append, in this order, after `assume-role`:

```rust
Rule {
    id: "content-from-zone",
    title: "Content from a zone reaches a reader",
    version: 1,
    bindings: &["delivers"],
    prerequisites: "network.access",
    output: "person or agent .contacted",
    duration: D::Logical,
    scope: "one per delivers association",
    assumptions: &["Anyone who can send traffic in the zone can put content in front of the reader: mail from the internet, a public ticket queue."],
},
Rule {
    id: "content-from-service",
    title: "A controlled service reaches its readers",
    version: 1,
    bindings: &["flow"],
    prerequisites: "control of the service a reader's flow targets: an agent's own flows, a person's through the applications they operate",
    output: "person or agent .contacted",
    duration: D::Logical,
    scope: "one per flow from an agent, or per flow from an application a person operates",
    assumptions: &["Watering holes, poisoned retrieval stores and compromised tool servers are this rule."],
},
Rule {
    id: "phish",
    title: "Deceive a person",
    version: 1,
    bindings: &["person"],
    prerequisites: "person.contacted",
    output: "person.deceived",
    duration: D::Slot { slot: Slot::Phish, replaced_by: Some((Defense::Trained, Slot::PhishTrained)) },
    scope: "one per person",
    assumptions: &["Training selects the authored replacement distribution; it does not make a person undeceivable."],
},
Rule {
    id: "person-disclose",
    title: "A deceived person discloses what they know",
    version: 1,
    bindings: &["knows"],
    prerequisites: "person.deceived",
    output: "credential.possessed",
    duration: D::Logical,
    scope: "one per knows association",
    assumptions: &["What a person knows is what they could type into a convincing fake login."],
},
Rule {
    id: "person-run",
    title: "A deceived person runs what they are sent",
    version: 1,
    bindings: &["operates"],
    prerequisites: "person.deceived",
    output: "application.control",
    duration: D::Logical,
    scope: "one per operates association",
    assumptions: &["Which consequences of deceit exist — disclosure, running something — is the author's choice of associations."],
},
Rule {
    id: "inject",
    title: "Instruct an agent through its content",
    version: 1,
    bindings: &["agent"],
    prerequisites: "agent.contacted",
    output: "agent.control",
    duration: D::Slot { slot: Slot::Inject, replaced_by: Some((Defense::Guarded, Slot::InjectGuarded)) },
    scope: "one per agent",
    assumptions: &["Guardrails or human approval of tool calls select the authored replacement distribution, not a guarantee."],
},
Rule {
    id: "agent-shell",
    title: "An agent with a shell controls its machine",
    version: 1,
    bindings: &["hosts"],
    prerequisites: "agent.control, for an agent hosted with `shell: true`",
    output: "the hosting machine at the agent's declared privilege",
    duration: D::Logical,
    scope: "one per hosts association naming an agent with a shell",
    assumptions: &["Without a shell among its tools, controlling an agent does not control its machine; its flows and identity still do their part."],
},
```

Words:
- `kind_description`: `Agent` → `"Software that reads content and acts on its own with tools: a coding agent, a support bot. Hosted like an application; \`shell\` says whether its tools run commands."`; `Person` → `"A human user who reads content and can be deceived. \`knows\` and \`operates\` say what deceit gives away."`.
- `kind_meaning`: `Agent` → `"An AI agent or automation that reads content and acts with real permissions."`; `Person` → `"A person who reads mail or pages and can be deceived into acting."`.
- `relation_description`: `Hosts` → `"The machine an executable, agent, router or guest host runs on, at \`privilege: user | admin\`. Each has one host; a router or a guest runs only on a host. For an agent, \`shell: true | false\` says whether its tools run commands there."`; `Knows` → `"A credential a person could disclose when deceived."`; `Operates` → `"Software a person uses; deceived, they run what they are sent in it."`; `Delivers` → `"Content from anyone in this network reaches the person or agent: mail, a public queue."`; `RunsAs` adds agents in its sentence ("a host at …, software or an agent as `user`").
- `state_word`: `Contacted` → `"reached by content"`, `Deceived` → `"deceived"`; `state_description`: `"Content the attacker controls is in front of this reader."`, `"This person acts on what the attacker sent."`.
- `slot_name`: `Phish` → `"Deceive"`, `PhishTrained` → `"Deceive (trained)"`, `Inject` → `"Inject instructions"`, `InjectGuarded` → `"Inject instructions (guarded)"`; `slot_description`: `("person", "Time until the person acts on a lure once content reaches them.")`, `("person", "The same, once the person is trained; selected by \`defenses.trained\`.")`, `("agent", "Time to get an agent to follow instructions hidden in content it reads.")`, `("agent", "The same, with guardrails or human approval; selected by \`defenses.guarded\`.")`.
- `defense_word`: `Trained` → `("Trained", "The person is trained against deception: \`phish-trained\` stands in for \`phish\`.")`; `Guarded` → `("Guarded", "Guardrails or human approval of tool calls: \`inject-guarded\` stands in for \`inject\`.")`.

- [ ] **Step 6: Generate**

`generate.rs`:
- `Builder` gains an index `flows_from: HashMap<&'a EntityId, Vec<&'a FlowId>>` (flow source → flows, in document order), built in `new()` from `m.flows`.
- A provenance helper for the new code:

```rust
/// A rule's origin with what it bound.
fn bound(rule: &str, entities: &[&EntityId], associations: &[&AssociationId], flows: &[&FlowId]) -> Origin {
    Origin {
        entities: entities.iter().map(|&e| e.clone()).collect(),
        associations: associations.iter().map(|&a| a.clone()).collect(),
        flows: flows.iter().map(|&f| f.clone()).collect(),
        ..origin(rule)
    }
}
```

- `hosting()`: destructure `Relation::Hosts { from, to, privilege, shell }`; the match on the hosted kind gains, before `_`:

```rust
// An agent: controlled by its machine; the machine by it only through a shell.
// (`bound` here is `hosting()`'s own closure, as in the arms beside it.)
EntityKind::Agent => {
    let control = self.state_id(to, State::Control.as_str());
    self.produce(&machine, &control, bound("host-execution"));
    if *shell == Some(true) {
        self.produce(&control, &machine, bound("agent-shell"));
    }
}
```

- New `operators()`, called after `flows()` (the readers' facts exist from `states()`; a flow's target control does too):

```rust
/// Content reaches readers from zones and from controlled services; a
/// deceived person discloses and runs, an instructed agent is controlled.
fn operators(&mut self) {
    for (aid, a) in &self.m.associations {
        match &a.relation {
            Relation::Delivers { from, to } => {
                let access = self.state_id(from, State::Access.as_str());
                let contacted = self.state_id(to, State::Contacted.as_str());
                self.produce(&access, &contacted, bound("content-from-zone", &[from, to], &[aid], &[]));
            }
            Relation::Knows { from, to } => {
                let deceived = self.state_id(from, State::Deceived.as_str());
                let possessed = self.state_id(to, State::Possessed.as_str());
                self.produce(&deceived, &possessed, bound("person-disclose", &[from, to], &[aid], &[]));
            }
            Relation::Operates { from, to } => {
                let deceived = self.state_id(from, State::Deceived.as_str());
                let control = self.state_id(to, State::Control.as_str());
                self.produce(&deceived, &control, bound("person-run", &[from, to], &[aid], &[]));
                let contacted = self.state_id(from, State::Contacted.as_str());
                for fid in self.flows_from.get(to).cloned().unwrap_or_default() {
                    let target = &self.m.flows[fid].target;
                    let served = self.state_id(target, State::Control.as_str());
                    self.produce(&served, &contacted, bound("content-from-service", &[from, to, target], &[aid], &[fid]));
                }
            }
            _ => {}
        }
    }
    for (eid, entity) in &self.m.entities {
        let owner = Owner::Entity(eid.clone());
        let contacted = self.state_id(eid, State::Contacted.as_str());
        match entity.kind {
            EntityKind::Agent => {
                for fid in self.flows_from.get(eid).cloned().unwrap_or_default() {
                    let target = &self.m.flows[fid].target;
                    let served = self.state_id(target, State::Control.as_str());
                    self.produce(&served, &contacted, bound("content-from-service", &[eid, target], &[], &[fid]));
                }
                let o = Origin {
                    paths: vec![
                        owner.slot_path(Slot::Inject),
                        owner.slot_path(Slot::InjectGuarded),
                        format!("entities.{eid}.defenses.guarded"),
                    ],
                    ..bound("inject", &[eid], &[], &[])
                };
                let control = self.state_id(eid, State::Control.as_str());
                self.action(
                    format!("action/inject/{eid}"),
                    format!("Inject instructions · {}", entity.label),
                    Binding::Parameter { owner, base: Slot::Inject, replacement: Some((Defense::Guarded, Slot::InjectGuarded)) },
                    &[contacted],
                    &control,
                    o,
                );
            }
            EntityKind::Person => {
                let o = Origin {
                    paths: vec![
                        owner.slot_path(Slot::Phish),
                        owner.slot_path(Slot::PhishTrained),
                        format!("entities.{eid}.defenses.trained"),
                    ],
                    ..bound("phish", &[eid], &[], &[])
                };
                let deceived = self.state_id(eid, State::Deceived.as_str());
                self.action(
                    format!("action/phish/{eid}"),
                    format!("Deceive · {}", entity.label),
                    Binding::Parameter { owner, base: Slot::Phish, replacement: Some((Defense::Trained, Slot::PhishTrained)) },
                    &[contacted],
                    &deceived,
                    o,
                );
            }
            _ => {}
        }
    }
}
```

`generate_within`: `b.flows(); b.operators(); b.products(); b.services(); …`. `identities()` (Task 3) already takes an agent's `control` for `runs-as`, and `flows()` takes the source's `control`, which an agent has.

Run: `cargo test -p effractor-components` → PASS.

- [ ] **Step 7: Fixtures**

No shipped file has a person or agent, so canonical text does not change. The catalog grew:

```bash
scripts/build-wasm.sh && node scripts/graph-fixtures.js --write
UPDATE_SNAPSHOTS=1 cargo test -p effractor-solver --test graph_determinism
git diff --stat scripts/fixtures crates/effractor-solver/tests/snapshots
```

Expected: only `catalog.json` changes (and any snapshot that embeds the catalog); no graph moves.

- [ ] **Step 8: People and agents in the editor (JS)**

Failing tests:

```js
// scripts/architecture-edit.test.js — replace Task 2's group assertion
test('the kinds are grouped by family for the Add menu', () => {
  assert.deepEqual(E.GROUPS.map((g) => g[0]), ['Network', 'Compute', 'Identity']);
  assert.deepEqual(E.GROUPS.flatMap((g) => g[1]).sort(), E.KINDS.slice().sort());
  assert.ok(E.GROUPS[1][1].includes('agent'));
  assert.ok(E.GROUPS[2][1].includes('person'));
});
// scripts/architecture-icons.test.js — the family assertion becomes
assert.deepEqual(A.KINDS.map(I.family), ['network', 'network', 'network', 'compute', 'compute', 'compute', 'compute', 'compute', 'identity', 'identity', 'identity']);
test('a person is drawn as a person and an account as a badge', () => {
  assert.notDeepEqual(I.parts('person'), I.parts('account'));
  assert.ok(I.parts('account').some(([tag]) => tag === 'rect'));
});
// scripts/architecture-links.test.js
test('an agent hosting offers a shell, and an agent may send flows', () => {
  const doc = { entities: { vm: { kind: 'host', label: 'VM' }, bot: { kind: 'agent', label: 'Bot' }, api: { kind: 'service', label: 'API' } }, associations: {}, flows: {} };
  assert.deepEqual(L.variants(doc, 'hosts', 'vm', 'bot'), [
    { privilege: 'user', shell: false }, { privilege: 'user', shell: true },
    { privilege: 'admin', shell: false }, { privilege: 'admin', shell: true },
  ]);
  assert.equal(L.phrase('hosts', 'in', 'user', { privilege: 'user', shell: true }), 'runs this as user, with a shell');
  const put = L.putAssociation(doc, null, { kind: 'hosts', from: 'vm', to: 'bot', privilege: 'user', shell: true });
  assert.deepEqual(Object.keys(put.doc.associations[Object.keys(put.doc.associations)[0]]), ['kind', 'from', 'to', 'privilege', 'shell']);
  assert.ok(L.addChoices(doc, catalog, 'bot').some((c) => c.kind === 'service' && c.options.some((o) => o.relation === 'flow')));
});
test('deleting a person takes what they know and operate along', () => {
  const doc = { entities: { p: { kind: 'person', label: 'P' }, k: { kind: 'credential', label: 'K' }, n: { kind: 'network', label: 'N' } },
    associations: { 'p-k': { kind: 'knows', from: 'p', to: 'k' }, 'n-p': { kind: 'delivers', from: 'n', to: 'p' } }, flows: {} };
  assert.deepEqual(L.remove(doc, 'entities', 'p').doc.associations, {});
});
```

Implement:
- `architecture-edit.js`: `KINDS = ["network", "router", "firewall", "host", "application", "service", "product", "agent", "account", "credential", "person"]`; `GROUPS` Compute `["host", "application", "service", "product", "agent"]`, Identity `["account", "credential", "person"]`.
- `architecture-links.js`: `KINDS` adds `"knows", "operates", "delivers"`; `ENTITY_KINDS` matches the edit list; `FIELD_ORDER = ["privilege", "factor", "shell"]`; `FIELD_WORDS.shell = { true: "with a shell", false: "no shell" }`; `fieldsOf`: `if (kind === "hosts" && toKind === "agent") out.push({ name: "shell", values: [false, true] });`; `putAssociation`: `if (value.kind === "hosts" && typeof value.shell === "boolean") a.shell = value.shell;` after the factor line; `WORDS.knows = { out: "knows", in: "known by" }`, `WORDS.operates = { out: "uses", in: "used by" }`, `WORDS.delivers = { out: "reaches", in: "reached from" }`; `addChoices`: `if (kind === "application" || kind === "service" || kind === "agent") offer("service", "flow", "out");` and in the `kind === "service"` block also `offer("agent", "flow", "in");`.
- `architecture-links-ui.js`: the software test at line 30 becomes `["application", "service", "agent"].indexOf(kindOf(id)) >= 0`; the flow source picker (`~378`) `pick(["application", "service", "agent"], f.source)`.
- `architecture-icons.js`: the current `account` drawing moves to `person` (comment `// A person.`); `account` becomes an ID badge (`// An ID badge: an identity, not a human.`): `[["rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ["circle", { cx: 9, cy: 11, r: 2 }], ["path", { d: "M6 16.5a3 3 0 0 1 6 0M14.5 10h4M14.5 13.5h4" }]]`; `agent` (`// A robot's head: software that acts.`): `[["rect", { x: 5, y: 8, width: 14, height: 11, rx: 2 }], ["path", { d: "M12 4.5V8M9.5 13h.01M14.5 13h.01M9.5 16h5" }], ["circle", { cx: 12, cy: 4, r: 1 }]]`; `FAMILY.agent = "compute"`, `FAMILY.person = "identity"`. The header comment's list says "a person, a badge, a robot and a key for the rest".
- `architecture-ui.js:692`'s focus map gains `shell: "prop-shell"`.

Run: `npm test` → PASS.

- [ ] **Step 9: Checks, commit, owner look**

Run the full check list (Task 1, Step 15) with `git commit -S -m "Deceive people and instruct agents through what they read"`. Owner look (8081): Add → Identity → Person and Add → Compute → Agent; link the person "reached from" a network, "knows" a credential, "uses" an application; host the agent "with a shell" and give it "runs as"; see "Deceive" and "Inject instructions" in their parameters and the switches "Trained" and "Guarded"; Build and find "Deceive · …" and "Inject instructions · …" in the attack graph. Wait for the owner's word.

---

### Task 4b: Content-processing software (spec §10)

Branch: `feature/content-software`. Owner decision (2026-09-24): only software
that a `delivers` names (in Task 5 also a `reads`) processes content; nothing
else changes its graph.

**Files:**
- Modify: core `architecture.rs`, `architecture_validate.rs`; format `architecture_read.rs`, `architecture_write.rs`
- Modify: components `catalog.rs`, `generate.rs`
- Modify: `assets/js/architecture-links.js`, `architecture-links-ui.js`, `architecture-view.js`, `architecture-ui.js`
- Test: core, format, generation, provenance tests; `scripts/architecture-links.test.js`, `architecture-view.test.js`
- Fixtures: every shipped architecture gains `take-over`/`take-over-guarded` (unknown) and `guarded: unknown` on its software (canonicalize); JS catalog and architecture fixtures; no generated graph moves

**Interfaces:**
- Produces: `Slot::{TakeOver, TakeOverGuarded}` (`"take-over"`, `"take-over-guarded"`) on application and service; `Defense::Guarded` (`"guarded"`), the defence of application and service; `Relation::Hosts { from, to, privilege, contained: bool }` (written only when true; `true` on a hosted host or router is a `misplaced-key` error); `RelationKind::Delivers` to kinds `[Person, Application, Service]`. Generated, for software a `delivers` names: fact `state/<kind>/<s>/contacted` ("reached by content"), action `action/take-over/<s>` (slot `take-over`, replaced by `take-over-guarded` when `guarded`), `content-from-zone` into it, `content-from-service` from the target of each of its own flows. `contained: true` drops `execution-privilege` for that hosting.
- JS: `L.fieldsOf("hosts", _, application|service)` adds `{name: "contained", values: [false, true], setting: true}`; `variants` skips settings (the Link menu does not double); `putAssociation` writes `contained: true` only for software; the canvas says "hosts · user · contained". `V.readers(doc)`, `V.shownSlots` hides the take-over slots and `V.shownDefense(doc, id)` the switch on software no content reaches.

- [ ] **Step 1: Failing tests.** Core: slots/defence of software; `contained` on a guest host is an error; `delivers` to a service is valid. Format: `contained: true` and `delivers` to software round-trip; `contained: false` is dropped on save; `contained: maybe` is an error. Generation: a delivered service gets `contacted`, `take-over`, `content-from-zone`, `content-from-service` from its flow's target; an undelivered one gets none of them; `contained: true` removes the control → machine edge. Provenance: `guarded` never changes the graph.
- [ ] **Step 2: Core, format, catalog, generator** until those pass. Catalog: rule `take-over` ("Take over through content"), `content-from-zone`/`content-from-service` outputs "person or software .contacted", `execution-privilege` notes `contained`; slot names "Take over through content" / "… (guarded)"; switch word "Guarded".
- [ ] **Step 3: Fixtures.** Canonicalize `docs/course/lecture-architecture.yaml`, `assets/examples/14–16`, the format fixtures; `node scripts/graph-fixtures.js --write`; snapshots; read the diff: only slot/defence lines and the catalog move.
- [ ] **Step 4: JS** as in Interfaces, test-first.
- [ ] **Step 5: Checks, commit, owner look (8081):** link a network "reaches" a service; the service shows "Take over through content" and "Guarded"; a hosting link's form has *Contained*; Build and find "Take over through content · …".

### Task 5: Data — targets, holding, access, encryption; the cloud support agent example

> **Re-plan before executing (2026-09-24).** Written when agents were a kind.
> After Task 4b, replace every `EntityKind::Agent`, `agent` in `holds`/`reads`
> kinds, `shell`, `inject` and `guarded`-on-agent below with the §10 forms
> (a content-processing service; `reads: application | service → data`;
> `contained`; `take-over`), including example 17's `support-agent`, its
> `agent-hosting` (`shell: true` → `contained: false`) and the
> `guardrails` scenario, and drop `BOOLS` from Task 4's consumes list (Task 4
> no longer adds it; Task 5 adds it for `decrypts`).

Branch: `feature/data`.

**Files:**
- Modify: core `architecture.rs`, `architecture_validate.rs`; format `architecture_read.rs`, `architecture_write.rs`
- Modify: components `catalog.rs`, `generate.rs`
- Modify: `assets/js/architecture-edit.js`, `architecture-links.js`, `architecture-icons.js`, `architecture-ui.js`
- Modify: `assets/css/00-tokens.css`, `assets/css/60-architecture.css`, `scripts/check-contrast.js`, `crates/effractor-server/templates/shell.html`
- Create: `assets/examples/17-cloud-support-agent-architecture.yaml`
- Modify: `assets/examples/README.md`, `docs/course/README.md`
- Test: core, format, generation, provenance tests; `crates/effractor-solver/tests/graph_examples.rs`; `scripts/architecture-edit.test.js`, `architecture-links.test.js`, `architecture-icons.test.js`, `check-contrast.test.js` (if it lists families)
- Fixtures: JS catalog fixture; `scripts/check-graph-agreement.js` gains the new example if it lists examples by name

**Interfaces:**
- Consumes: Task 3's `Binding::Policy`, `defense_word`, `L.fieldsOf`/`variants`/`FIELD_ORDER`/`FIELD_WORDS`; Task 4's `State::Contacted`, `BOOLS`, `bound()`, `operators()`; Task 1's `NOT_YET_IN_AN_EXAMPLE`.
- Produces: `EntityKind::Data` (`"data"`, last; states `[Read, Modified]`, no slots, defence `Encrypted`); `State::{Read, Modified}` (`"read"`, `"modified"`); `Defense::Encrypted`; `Mode { Read, Write }` (`"read"|"write"`); `Relation::Holds { from, to, privilege, decrypts: Option<bool> }` (`"holds"`: host/application/service/agent → data), `Relation::Accesses { from, to, mode }` (`"accesses"`: account → data), `Relation::EncryptedWith { from, to }` (`"encrypted-with"`: data → credential), `Relation::Reads { from, to }` (`"reads"`: agent → data). Ids: fact `state/data/<d>/plaintext`, input `input/policy/<d>/encrypted`, joins `action/holder-read/<holder>/<d>` and `action/account-data/<account>/<service>/<d>` (All, Logical). JS family `"data"`, `GROUPS` fourth group `["Data", ["data"]]`.

- [ ] **Step 1: Failing core tests**

```rust
#[test]
fn data_is_a_target_with_an_encryption_switch() {
    assert_eq!(EntityKind::Data.states(), &[State::Read, State::Modified]);
    assert_eq!(EntityKind::Data.slots(), &[] as &[Slot]);
    assert_eq!(EntityKind::Data.defense(), Some(Defense::Encrypted));
}

fn bucket_model(decrypts: Option<bool>, privilege: Privilege) -> Architecture {
    let mut m = Architecture::new("D");
    m.entities.insert("h".parse().unwrap(), Entity::new(EntityKind::Host, "H"));
    m.entities.insert("app".parse().unwrap(), Entity::new(EntityKind::Application, "App"));
    m.entities.insert("d".parse().unwrap(), Entity::new(EntityKind::Data, "D"));
    m.associations.insert("h-app".parse().unwrap(), Association {
        relation: Relation::Hosts { from: "h".parse().unwrap(), to: "app".parse().unwrap(), privilege: Privilege::User, shell: None },
        description: None,
    });
    m.associations.insert("app-d".parse().unwrap(), Association {
        relation: Relation::Holds { from: "app".parse().unwrap(), to: "d".parse().unwrap(), privilege, decrypts },
        description: None,
    });
    m
}

#[test]
fn a_holding_must_say_whether_it_decrypts_and_software_holds_as_user() {
    let d = validate_architecture(&bucket_model(None, Privilege::User));
    assert!(d.iter().any(|d| d.code == Code::Incomplete && d.path == "associations.app-d" && d.message.contains("decrypts")), "{d:?}");
    let d = validate_architecture(&bucket_model(Some(true), Privilege::Admin));
    assert!(d.iter().any(|d| d.code == Code::AssociationType && d.path == "associations.app-d.privilege"), "{d:?}");
    let d = validate_architecture(&bucket_model(Some(false), Privilege::User));
    assert!(d.iter().all(|d| !d.path.starts_with("associations.app-d")), "{d:?}");
}

#[test]
fn data_nothing_holds_is_complete() {
    let mut m = Architecture::new("D");
    m.entities.insert("d".parse().unwrap(), Entity::new(EntityKind::Data, "D"));
    assert!(validate_architecture(&m).iter().all(|d| d.path != "entities.d"));
}
```

Run: `cargo test -p effractor-core --test architecture` → compile error.

- [ ] **Step 2: Vocabulary and validation**

`architecture.rs`:
- `EntityKind::Data` last; `ALL: [EntityKind; 12]`; `"data"`; `states` `&[State::Read, State::Modified]`; `slots` none; `defense` `Some(Defense::Encrypted)`.
- `State::{Read, Modified}` (`"read"`, `"modified"`), `ALL: [State; 9]`.
- `Defense::Encrypted` (`"encrypted"`), `ALL: [Defense; 6]`; `Defenses.encrypted` (`/// Data: encrypted at rest; reading it where it is not decrypted then needs the key.`).
- New:

```rust
/// What an account may do with data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Mode {
    Read,
    Write,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
        }
    }
}
```

- `Relation::Holds { from, to, privilege: Privilege, decrypts: Option<bool> }` (`/// host/software → data: where it lives; \`decrypts\` whether this holder sees plaintext. None is unsaid.`), `Relation::Accesses { from, to, mode: Mode }` (`/// account → data: what a session of the account may do with it.`), `Relation::EncryptedWith { from, to }` (`/// data → credential: the key.`), `Relation::Reads { from, to }` (`/// agent → data: content the agent reads, e.g. a retrieval corpus.`).
- `RelationKind::{Holds, Accesses, EncryptedWith, Reads}` (`"holds"`, `"accesses"`, `"encrypted-with"`, `"reads"`), `ALL: [_; 19]`; `from_kinds`: `Holds => &[K::Host, K::Application, K::Service, K::Agent]`, `Accesses => &[K::Account]`, `EncryptedWith => &[K::Data]`, `Reads => &[K::Agent]`; `to_kinds`: `Holds | Accesses | Reads => &[K::Data]`, `EncryptedWith => &[K::Credential]`; `has_privilege` includes `Holds`; `fields()`: `Self::Holds => &["privilege", "decrypts"]`, `Self::Accesses => &["mode"]`; the `kind()`, `from()`, `to_entity()`, `privilege()` arms.

`architecture_validate.rs` `associations()` match:

```rust
(Relation::Holds { privilege: Privilege::Admin, .. }, Some(k), _) if k != EntityKind::Host => self.error(
    Code::AssociationType,
    format!("{at}.privilege"),
    "software holds data as `user`; only a host holds it as `admin`",
),
(Relation::Holds { decrypts: None, from, to, .. }, _, _) => self.incomplete(
    at.clone(),
    format!("say whether \"{from}\" sees \"{to}\" in plaintext: `decrypts: true | false`"),
),
```

Run: `cargo test -p effractor-core` → PASS.

- [ ] **Step 3: Reader, writer, round trip**

`architecture_read.rs`: `KINDS: [_; 12]` with `("data", EntityKind::Data)`; `RELATIONS: [_; 19]`; `STATES: [_; 9]`; `DEFENSES: [_; 6]` with `("encrypted", Defense::Encrypted)`; `pub const MODES: [(&str, Mode); 2] = [("read", Mode::Read), ("write", Mode::Write)];`. The field whitelist adds `"decrypts", "mode"`. `decrypts` is optional (its absence is reported by the validator as `incomplete`); `mode` is required on `accesses`:

```rust
let decrypts = match f.get("decrypts") {
    Some(e) if kind == RelationKind::Holds => cx.word(&e.value, &f.path("decrypts"), &BOOLS).map(Some),
    _ => Some(None),
};
let mode = if kind == RelationKind::Accesses {
    cx.required(&f, "mode").and_then(|e| cx.word(&e.value, &f.path("mode"), &MODES))
} else {
    None
};
```

and the relation arms `Holds => Relation::Holds { from, to, privilege: privilege?, decrypts: decrypts? }`, `Accesses => Relation::Accesses { from, to, mode: mode? }`, `EncryptedWith`, `Reads` → `{ from, to }`.

`architecture_write.rs`, after the shell line:

```rust
match r {
    Relation::Holds { decrypts: Some(d), .. } => w.line(4, "decrypts", word(&BOOLS, d)),
    Relation::Accesses { mode, .. } => w.line(4, "mode", word(&MODES, mode)),
    _ => {}
}
```

Format tests: a round trip with data `bucket` (`defenses: {encrypted: false}`), a key credential, a service holding it with `decrypts: false`, an account `accesses` it with `mode: write`, `encrypted-with`, and an agent that `reads` it; assert canonical and that a `holds` without `decrypts` loads (and canonicalizes without the line). A second test: `mode: delete` is a word error at `associations.<id>.mode`; `accesses` without `mode` is `MissingKey`; `decrypts` on a `stores` is `MisplacedKey`.

Run: `cargo test -p effractor-core -p effractor-format` → PASS.

- [ ] **Step 4: Failing generation tests**

```rust
/// The lecture's SSH server holds a customer table; the server account may
/// read it through a login, the server's key encrypts it.
fn with_data(decrypts: bool) -> Architecture {
    let mut m = lecture();
    add(&mut m, "table", EntityKind::Data);
    relate(&mut m, "sshd-table", Relation::Holds { from: id("sshd"), to: id("table"), privilege: Privilege::User, decrypts: Some(decrypts) });
    relate(&mut m, "account-table", Relation::Accesses { from: id("server-account"), to: id("table"), mode: Mode::Write });
    relate(&mut m, "table-key", Relation::EncryptedWith { from: id("table"), to: id("server-key") });
    m
}

#[test]
fn a_decrypting_holder_reads_and_modifies_its_data() {
    let g = generate(&with_data(true)).unwrap();
    assert!(inputs(&g, "state/data/table/read").contains(&"state/service/sshd/control".to_owned()));
    assert!(inputs(&g, "state/data/table/modified").contains(&"state/service/sshd/control".to_owned()));
    assert!(inputs(&g, "state/data/table/read").contains(&"state/session/server-account/sshd".to_owned()));
    assert!(inputs(&g, "state/data/table/modified").contains(&"state/session/server-account/sshd".to_owned()));
}

#[test]
fn a_holder_that_does_not_decrypt_needs_plaintext_to_read() {
    let g = generate(&with_data(false)).unwrap();
    let mut read = inputs(&g, "state/data/table/read");
    read.sort();
    assert_eq!(read, vec!["action/account-data/server-account/sshd/table", "action/holder-read/sshd/table"]);
    assert_eq!(inputs(&g, "action/holder-read/sshd/table"), vec!["state/data/table/plaintext", "state/service/sshd/control"]);
    assert_eq!(node(&g, "action/holder-read/sshd/table").duration, Binding::Logical);
    assert_eq!(
        inputs(&g, "action/account-data/server-account/sshd/table"),
        vec!["state/data/table/plaintext", "state/session/server-account/sshd"]
    );
    // Encryption does not stop modification.
    assert!(inputs(&g, "state/data/table/modified").contains(&"state/service/sshd/control".to_owned()));
    let mut plain = inputs(&g, "state/data/table/plaintext");
    plain.sort();
    assert_eq!(plain, vec!["input/policy/table/encrypted", "state/credential/server-key/possessed"]);
    assert_eq!(
        node(&g, "input/policy/table/encrypted").duration,
        Binding::Policy { entity: id("table"), defense: Defense::Encrypted }
    );
}

#[test]
fn read_access_never_modifies() {
    let mut m = with_data(true);
    relate(&mut m, "account-table", Relation::Accesses { from: id("server-account"), to: id("table"), mode: Mode::Read });
    let g = generate(&m).unwrap();
    assert!(!inputs(&g, "state/data/table/modified").contains(&"state/session/server-account/sshd".to_owned()));
}

#[test]
fn poisoning_what_an_agent_reads_reaches_the_agent_and_cycles_stay_finite() {
    let mut m = with_data(true);
    add(&mut m, "bot", EntityKind::Agent);
    relate(&mut m, "server-bot", Relation::Hosts { from: id("server"), to: id("bot"), privilege: Privilege::User, shell: Some(false) });
    relate(&mut m, "bot-reads", Relation::Reads { from: id("bot"), to: id("table") });
    let g = generate(&m).unwrap();
    assert!(inputs(&g, "state/agent/bot/contacted").contains(&"state/data/table/modified".to_owned()));
    // Nothing seeds bot → table → bot when the attacker starts elsewhere.
    m.attacker.footholds.clear();
    m.attacker.footholds.push(effractor_core::architecture::StateRef {
        entity: id("admin-net"),
        state: effractor_core::architecture::State::Access,
    });
    let reached = possible(&generate(&m).unwrap());
    assert!(!reached.contains("state/agent/bot/control"));
}

#[test]
fn data_can_be_the_target() {
    let mut m = with_data(true);
    m.attacker.target = Some(effractor_core::architecture::StateRef {
        entity: id("table"),
        state: effractor_core::architecture::State::Read,
    });
    let g = generate(&m).unwrap();
    assert_eq!(g.nodes[g.target].id, "state/data/table/read");
}
```

Import `Mode` in the test file. Extend `NOT_YET_IN_AN_EXAMPLE` with `"holder-modify", "holder-read", "account-data", "data-policy", "data-key", "data-poisoning"` (it is emptied in Step 10).

Run: `cargo test -p effractor-components --test generation` → FAIL.

- [ ] **Step 5: Rules in the catalog**

`catalog.rs`, `RULES: [Rule; 39]`, appended after `agent-shell`:

```rust
Rule {
    id: "holder-modify",
    title: "Whoever controls a holder can change its data",
    version: 1,
    bindings: &["holds"],
    prerequisites: "the holder under control, or the holding host at the declared privilege",
    output: "data.modified",
    duration: D::Logical,
    scope: "one per holds association",
    assumptions: &["Ransomware and deletion count as modification; encryption at rest does not stop it."],
},
Rule {
    id: "holder-read",
    title: "Whoever controls a holder can read its data",
    version: 1,
    bindings: &["holds"],
    prerequisites: "the holder under control, or the holding host at the declared privilege; and data.plaintext where the holding says `decrypts: false`",
    output: "data.read",
    duration: D::Logical,
    scope: "one per holds association",
    assumptions: &["Encryption at rest does not stop software that serves the data; a holder that does not decrypt (a disk, client-side encryption) gives up ciphertext only."],
},
Rule {
    id: "account-data",
    title: "A logged-in account uses its access",
    version: 1,
    bindings: &["accesses", "authorizes", "holds"],
    prerequisites: "a session of the account on a service that holds the data; and data.plaintext where that holding says `decrypts: false`",
    output: "data.read; with `mode: write` also data.modified",
    duration: D::Logical,
    scope: "one per access, service and holding",
    assumptions: &["No data rule is timed: how long exfiltration takes is outside this library."],
},
Rule {
    id: "data-policy",
    title: "The data is not encrypted",
    version: 1,
    bindings: &["data"],
    prerequisites: "the data's `encrypted` switch is off",
    output: "data.plaintext",
    duration: D::Logical,
    scope: "one per data",
    assumptions: &["An unknown switch is an unknown branch, not a guess either way."],
},
Rule {
    id: "data-key",
    title: "The key decrypts the data",
    version: 1,
    bindings: &["encrypted-with"],
    prerequisites: "credential.possessed, for a key the data is encrypted with",
    output: "data.plaintext",
    duration: D::Logical,
    scope: "one per encrypted-with association",
    assumptions: &["Possession of the key still takes an extraction or a disclosure."],
},
Rule {
    id: "data-poisoning",
    title: "Poisoned content reaches the agent that reads it",
    version: 1,
    bindings: &["reads"],
    prerequisites: "data.modified",
    output: "agent.contacted",
    duration: D::Logical,
    scope: "one per reads association",
    assumptions: &["Poisoning what an agent reads leads through injection to its tools and identity."],
},
```

Words:
- `kind_description(Data)` → `"Information worth protecting: a database, a bucket, a vault, model weights, a training set. \`read\` is confidentiality, \`modified\` integrity; either can be the target."`; `kind_meaning(Data)` → `"Information an attacker wants to read or change."`.
- `relation_description`: `Holds` → `"Where data lives: a host at \`privilege: user | admin\`, software as \`user\`; \`decrypts: true | false\` says whether this holder sees plaintext."`; `Accesses` → `"What a session of the account may do with the data: \`mode: read | write\`."`; `EncryptedWith` → `"The key the data is encrypted with."`; `Reads` → `"Content an agent reads; changing it reaches the agent."`.
- `state_word`: `Read` → `"read"`, `Modified` → `"modified"`; `state_description`: `"The attacker has read this data."`, `"The attacker has changed, encrypted or deleted this data."`.
- `defense_word(Encrypted)` → `("Encrypted", "Encrypted at rest: a holder that does not decrypt gives up plaintext only with the key.")`.

- [ ] **Step 6: Generate**

`generate.rs`:
- `states()`: `EntityKind::Data => { let fid = self.state_id(id, "plaintext"); self.fact(fid, format!("{} · in plaintext", entity.label)); }`.
- `Builder` gains `holdings: HashMap<(&'a EntityId, &'a EntityId), (bool, &'a AssociationId)>` ((holder, data) → (decrypts, holds association)) and `authorized: HashMap<&'a EntityId, Vec<(&'a EntityId, &'a AssociationId)>>` (account → [(service, authorizes association)] in document order), both filled in `new()`. `decrypts` is `decrypts == Some(true)`: a model with `None` never reaches generation (it is `incomplete`).
- New `data()`, called after `administration()` (sessions exist once `logins()` ran):

```rust
/// Holders read and change their data, sessions use their access, keys and
/// the switch give plaintext, and changed content reaches its agents.
fn data(&mut self) {
    for (id, entity) in &self.m.entities {
        if entity.kind != EntityKind::Data {
            continue;
        }
        let input = format!("input/policy/{id}/encrypted");
        let o = Origin {
            paths: vec![format!("entities.{id}.defenses.encrypted")],
            ..bound("data-policy", &[id], &[], &[])
        };
        self.insert(
            input.clone(),
            format!("Not encrypted · {}", entity.label),
            DraftKind::Input(Binding::Policy { entity: id.clone(), defense: Defense::Encrypted }),
        );
        self.originate(&input, o.clone());
        let plaintext = self.state_id(id, "plaintext");
        self.produce(&input, &plaintext, o);
    }
    for (aid, a) in &self.m.associations {
        match &a.relation {
            Relation::Holds { from, to, privilege, .. } => {
                let holder = match self.kind(from) {
                    EntityKind::Host => self.machine_id(from, *privilege),
                    _ => self.state_id(from, State::Control.as_str()),
                };
                let modified = self.state_id(to, State::Modified.as_str());
                self.produce(&holder, &modified, bound("holder-modify", &[from, to], &[aid], &[]));
                let decrypts = self.holdings[&(from, to)].0;
                self.read(
                    format!("action/holder-read/{from}/{to}"),
                    format!("Read · {} · {}", self.label(to), self.label(from)),
                    &holder,
                    to,
                    decrypts,
                    bound("holder-read", &[from, to], &[aid], &[]),
                );
            }
            Relation::Accesses { from, to, mode } => {
                for (service, authorizes) in self.authorized.get(from).cloned().unwrap_or_default() {
                    let Some(&(decrypts, holds)) = self.holdings.get(&(service, to)) else {
                        continue;
                    };
                    let session = format!("state/session/{from}/{service}");
                    let o = bound("account-data", &[from, service, to], &[aid, authorizes, holds], &[]);
                    self.read(
                        format!("action/account-data/{from}/{service}/{to}"),
                        format!("Read · {} · as {}", self.label(to), self.label(from)),
                        &session,
                        to,
                        decrypts,
                        o.clone(),
                    );
                    if *mode == Mode::Write {
                        let modified = self.state_id(to, State::Modified.as_str());
                        self.produce(&session, &modified, o);
                    }
                }
            }
            Relation::EncryptedWith { from, to } => {
                let key = self.state_id(to, State::Possessed.as_str());
                let plaintext = self.state_id(from, "plaintext");
                self.produce(&key, &plaintext, bound("data-key", &[from, to], &[aid], &[]));
            }
            Relation::Reads { from, to } => {
                let modified = self.state_id(to, State::Modified.as_str());
                let contacted = self.state_id(from, State::Contacted.as_str());
                self.produce(&modified, &contacted, bound("data-poisoning", &[from, to], &[aid], &[]));
            }
            _ => {}
        }
    }
}

/// `data.read` from `source`: directly where the holder decrypts, else a
/// zero-time join with the data's plaintext.
fn read(&mut self, join: String, label: String, source: &str, data: &EntityId, decrypts: bool, o: Origin) {
    let read = self.state_id(data, State::Read.as_str());
    if decrypts {
        self.produce(source, &read, o);
        return;
    }
    let plaintext = self.state_id(data, "plaintext");
    self.action(join, label, Binding::Logical, &[source.to_owned(), plaintext], &read, o);
}
```

`generate_within`: `…; b.administration(); b.data();`. Import `Mode`.

Run: `cargo test -p effractor-components` → PASS. The data switch's structure test is `cloud_support_agent_switches_never_change_the_graph` (Step 9), on the example that has every switch.

- [ ] **Step 7: The data family and editor (JS, CSS)**

Failing tests:

```js
// scripts/architecture-edit.test.js
test('the kinds are grouped by family for the Add menu', () => {
  assert.deepEqual(E.GROUPS.map((g) => g[0]), ['Network', 'Compute', 'Identity', 'Data']);
  assert.deepEqual(E.GROUPS.flatMap((g) => g[1]).sort(), E.KINDS.slice().sort());
  assert.deepEqual(E.GROUPS[3][1], ['data']);
});
// scripts/architecture-icons.test.js — the family assertion becomes
assert.deepEqual(A.KINDS.map(I.family), ['network', 'network', 'network', 'compute', 'compute', 'compute', 'compute', 'compute', 'identity', 'identity', 'identity', 'data']);
// scripts/architecture-links.test.js
test('a holding offers privilege and decryption; access offers a mode', () => {
  const doc = { entities: { h: { kind: 'host', label: 'H' }, s: { kind: 'service', label: 'S' }, a: { kind: 'account', label: 'A' }, d: { kind: 'data', label: 'D' } }, associations: {}, flows: {} };
  assert.deepEqual(L.variants(doc, 'holds', 's', 'd'), [{ privilege: 'user', decrypts: true }, { privilege: 'user', decrypts: false }]);
  assert.equal(L.variants(doc, 'holds', 'h', 'd').length, 4);
  assert.deepEqual(L.variants(doc, 'accesses', 'a', 'd'), [{ mode: 'read' }, { mode: 'write' }]);
  assert.equal(L.phrase('holds', 'out', 'user', { privilege: 'user', decrypts: false }), 'holds, ciphertext only');
  assert.equal(L.phrase('accesses', 'out', null, { mode: 'write' }), 'may access, read and write');
  const put = L.putAssociation(doc, 's-d', { kind: 'holds', from: 's', to: 'd', privilege: 'user', decrypts: false });
  assert.deepEqual(put.doc.associations['s-d'], { kind: 'holds', from: 's', to: 'd', privilege: 'user', decrypts: false });
});
test('deleting data takes its holdings, access, key and readers along', () => {
  const doc = { entities: { s: { kind: 'service', label: 'S' }, d: { kind: 'data', label: 'D' }, k: { kind: 'credential', label: 'K' }, b: { kind: 'agent', label: 'B' } },
    associations: {
      's-d': { kind: 'holds', from: 's', to: 'd', privilege: 'user', decrypts: true },
      'd-k': { kind: 'encrypted-with', from: 'd', to: 'k' },
      'b-d': { kind: 'reads', from: 'b', to: 'd' },
    }, flows: {} };
  assert.deepEqual(L.remove(doc, 'entities', 'd').doc.associations, {});
});
```

Implement:
- `architecture-edit.js`: `KINDS` appends `"data"`; `GROUPS` appends `["Data", ["data"]]`.
- `architecture-links.js`: `KINDS` adds `"holds", "accesses", "encrypted-with", "reads"`; `PRIVILEGED` adds `"holds"`; `privilegesOf`: `if (kind === "holds" && fromKind !== "host") return ["user"];`; `ENTITY_KINDS` appends `"data"`; `FIELD_ORDER = ["privilege", "factor", "shell", "decrypts", "mode"]`; `FIELD_WORDS.decrypts = { true: "sees plaintext", false: "ciphertext only" }`, `FIELD_WORDS.mode = { read: "read only", write: "read and write" }`; `fieldsOf`: `if (kind === "holds") out.push({ name: "decrypts", values: [true, false] }); if (kind === "accesses") out.push({ name: "mode", values: ["read", "write"] });`; `putAssociation`: `if (value.kind === "holds" && typeof value.decrypts === "boolean") a.decrypts = value.decrypts; if (value.kind === "accesses") a.mode = value.mode;`; `WORDS.holds = { out: "holds", in: "held by" }`, `WORDS.accesses = { out: "may access", in: "accessible to" }`, `WORDS["encrypted-with"] = { out: "encrypted with", in: "encrypts" }`, `WORDS.reads = { out: "reads", in: "read by" }`.
- `architecture-icons.js`: `data` (`// A cylinder: stored records.`): `[["path", { d: "M5 6c0-1.66 3.13-3 7-3s7 1.34 7 3-3.13 3-7 3-7-1.34-7-3z" }], ["path", { d: "M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" }], ["path", { d: "M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" }]]`; `FAMILY.data = "data"`.
- `architecture-ui.js:692`'s focus map gains `decrypts: "prop-decrypts"`, `mode: "prop-mode"`.
- `assets/css/00-tokens.css`: `--viz-family-data: #7b4d8f;` after `--viz-family-identity` in the light block, `--viz-family-data: #8e5ea6;` in both dark blocks.
- `assets/css/60-architecture.css`: `.node-component.family-data .plate { fill: var(--viz-family-data); }`, `.kind-icon.is-plate.family-data { background: var(--viz-family-data); }`, `.swatch-data { background: var(--viz-family-data); border-color: transparent; }`, each beside its identity line.
- `scripts/check-contrast.js`: `const FAMILIES = ["network", "compute", "identity", "data"];`.
- `crates/effractor-server/templates/shell.html` legend (line ~188): append ` <span class="swatch swatch-data"></span>data` after the identity swatch.

Run: `npm test && node scripts/check-contrast.js`
Expected: PASS. If the contrast check fails for a data colour, darken that colour in steps of `#080808` until it passes, in the light and dark blocks separately.

- [ ] **Step 8: The cloud support agent example**

Create `assets/examples/17-cloud-support-agent-architecture.yaml`. Every slot the example's routes use carries an illustrative value with a note; slots its routes never use stay `unknown` (they are not in any result's support). Write it as below, then canonicalize it (Task 1's example) — the canonicalizer supplies the `unknown` slots and orders keys; read the diff it makes and keep only reorderings and added `status: unknown` blocks.

```yaml
effractor: 2
profile: architecture
name: Cloud support agent
time_unit: d
horizon: 100
library: {id: core-components, version: 1}

entities:
  internet:
    kind: network
    label: Internet
  office-net:
    kind: network
    label: Office network
  cloud-net:
    kind: network
    label: Cloud network
  edge:
    kind: router
    label: Cloud edge
  edge-filter:
    kind: firewall
    label: Edge firewall
  laptop:
    kind: host
    label: Administrator laptop
  browser:
    kind: application
    label: Browser
  storage-node:
    kind: host
    label: Storage platform
    description: Stands for the provider's storage platform
  storage-api:
    kind: service
    label: Storage API
    parameters:
      deploy-exploit:
        status: illustrative
        ttc: "Exponential(mean 2)"
        note: Exercise assumption
      login:
        status: illustrative
        ttc: "Exponential(mean 0.1)"
        note: "Exercise assumption: an API login with a valid token is quick"
  api-gateway:
    kind: product
    label: API gateway 2.4
    parameters:
      find-exploit:
        status: illustrative
        ttc: "Exponential(mean 30)"
        note: Exercise assumption
      find-exploit-patched:
        status: illustrative
        ttc: "Never"
        note: "Exercise assumption: the patched version has no exploit to find"
    defenses: {patched: false}
  hypervisor:
    kind: host
    label: Hypervisor
  support-vm:
    kind: host
    label: Support VM
    parameters:
      escape:
        status: illustrative
        ttc: "Exponential(mean 20)"
        note: Exercise assumption
  kms-node:
    kind: host
    label: Key service VM
    parameters:
      escape:
        status: illustrative
        ttc: "Exponential(mean 20)"
        note: Exercise assumption
  kms-api:
    kind: service
    label: Key service
    parameters:
      deploy-exploit:
        status: illustrative
        ttc: "Exponential(mean 2)"
        note: Exercise assumption
  support-agent:
    kind: agent
    label: Support agent
    parameters:
      inject:
        status: illustrative
        ttc: "Exponential(mean 3)"
        note: "Exercise assumption: instructions hidden in a ticket"
      inject-guarded:
        status: illustrative
        ttc: "Exponential(mean 60)"
        note: "Exercise assumption: guardrails slow injection, they do not stop it"
    defenses: {guarded: false}
  admin:
    kind: person
    label: Cloud administrator
    parameters:
      phish:
        status: illustrative
        ttc: "Exponential(mean 7)"
        note: Exercise assumption
      phish-trained:
        status: illustrative
        ttc: "Exponential(mean 40)"
        note: "Exercise assumption: training slows deception, it does not stop it"
    defenses: {trained: false}
  admin-account:
    kind: account
    label: Administrator
    parameters:
      mfa-bypass:
        status: illustrative
        ttc: "Exponential(mean 5)"
        note: "Exercise assumption: push fatigue"
    defenses: {mfa: false}
  agent-role:
    kind: account
    label: Support agent role
    description: A workload identity; it has no second factor
    defenses: {mfa: false}
  reader-role:
    kind: account
    label: Data reader role
    defenses: {mfa: false}
  admin-password:
    kind: credential
    label: Administrator password
    defenses: {protected: false}
  admin-seed:
    kind: credential
    label: Authenticator seed
    parameters:
      extract:
        status: illustrative
        ttc: "Exponential(mean 2)"
        note: Exercise assumption
      extract-protected:
        status: illustrative
        ttc: "Never"
        note: "Exercise assumption: a hardware-backed store gives nothing up"
    defenses: {protected: false}
  bucket-key:
    kind: credential
    label: Bucket key
    parameters:
      extract:
        status: illustrative
        ttc: "Exponential(mean 1)"
        note: Exercise assumption
      extract-protected:
        status: illustrative
        ttc: "Never"
        note: "Exercise assumption: a hardware-backed store gives nothing up"
    defenses: {protected: false}
  customer-bucket:
    kind: data
    label: Customer bucket
    defenses: {encrypted: false}
  help-articles:
    kind: data
    label: Help centre articles
    defenses: {encrypted: false}

associations:
  laptop-office:
    kind: attached
    from: laptop
    to: office-net
  edge-office:
    kind: attached
    from: edge
    to: office-net
  edge-cloud:
    kind: attached
    from: edge
    to: cloud-net
  storage-cloud:
    kind: attached
    from: storage-node
    to: cloud-net
  hypervisor-cloud:
    kind: attached
    from: hypervisor
    to: cloud-net
  support-vm-cloud:
    kind: attached
    from: support-vm
    to: cloud-net
  kms-cloud:
    kind: attached
    from: kms-node
    to: cloud-net
  edge-filters:
    kind: filters
    from: edge
    to: edge-filter
  browser-hosting:
    kind: hosts
    from: laptop
    to: browser
    privilege: user
  storage-hosting:
    kind: hosts
    from: storage-node
    to: storage-api
    privilege: admin
  support-vm-hosting:
    kind: hosts
    from: hypervisor
    to: support-vm
    privilege: user
  kms-node-hosting:
    kind: hosts
    from: hypervisor
    to: kms-node
    privilege: user
  kms-hosting:
    kind: hosts
    from: kms-node
    to: kms-api
    privilege: admin
  agent-hosting:
    kind: hosts
    from: support-vm
    to: support-agent
    privilege: admin
    shell: true
    description: The agent runs as root in its VM and can run commands
  storage-instance:
    kind: instance-of
    from: storage-api
    to: api-gateway
  kms-instance:
    kind: instance-of
    from: kms-api
    to: api-gateway
  tickets:
    kind: delivers
    from: internet
    to: support-agent
    description: The public ticket queue
  mail:
    kind: delivers
    from: internet
    to: admin
  admin-knows-password:
    kind: knows
    from: admin
    to: admin-password
  admin-uses-browser:
    kind: operates
    from: admin
    to: browser
  seed-store:
    kind: stores
    from: laptop
    to: admin-seed
    privilege: user
  key-store:
    kind: stores
    from: kms-node
    to: bucket-key
    privilege: admin
  password-auth:
    kind: authenticates
    from: admin-password
    to: admin-account
  seed-auth:
    kind: authenticates
    from: admin-seed
    to: admin-account
    factor: second
  admin-storage:
    kind: authorizes
    from: admin-account
    to: storage-api
  agent-role-storage:
    kind: authorizes
    from: agent-role
    to: storage-api
  reader-storage:
    kind: authorizes
    from: reader-role
    to: storage-api
  agent-runs-as:
    kind: runs-as
    from: support-agent
    to: agent-role
    privilege: user
  agent-becomes-reader:
    kind: assumes
    from: agent-role
    to: reader-role
  bucket-held:
    kind: holds
    from: storage-api
    to: customer-bucket
    privilege: user
    decrypts: false
    description: Client-side encryption when encrypted; storage sees ciphertext only
  articles-held:
    kind: holds
    from: storage-api
    to: help-articles
    privilege: user
    decrypts: true
  bucket-key-link:
    kind: encrypted-with
    from: customer-bucket
    to: bucket-key
  reader-bucket:
    kind: accesses
    from: reader-role
    to: customer-bucket
    mode: read
  admin-bucket:
    kind: accesses
    from: admin-account
    to: customer-bucket
    mode: write
  admin-articles:
    kind: accesses
    from: admin-account
    to: help-articles
    mode: write
  agent-reads-articles:
    kind: reads
    from: support-agent
    to: help-articles
  edge-permits-console:
    kind: permits
    from: edge-filter
    to: console
    allowed: true

flows:
  console:
    label: Browser to storage API
    source: browser
    target: storage-api
    route: [office-net, edge, cloud-net]
    protocol: tcp/443
    parameters:
      connect:
        status: illustrative
        ttc: "Exponential(mean 0.1)"
        note: Exercise assumption
  agent-storage:
    label: Agent to storage API
    source: support-agent
    target: storage-api
    route: [cloud-net]
    protocol: tcp/443
    parameters:
      connect:
        status: illustrative
        ttc: "Exponential(mean 0.1)"
        note: Exercise assumption

attacker:
  footholds:
    - {entity: internet, state: access}
  target: {entity: customer-bucket, state: read}

scenarios:
  guardrails:
    label: Guard the agent's tools
    changes:
      - {entity: support-agent, defense: guarded, value: true}
  mfa:
    label: Require a second factor
    changes:
      - {entity: admin-account, defense: mfa, value: true}
  training:
    label: Train the administrator
    changes:
      - {entity: admin, defense: trained, value: true}
  patch:
    label: Patch the API gateway
    changes:
      - {entity: api-gateway, defense: patched, value: true}
  encrypt:
    label: Encrypt the bucket client-side
    changes:
      - {entity: customer-bucket, defense: encrypted, value: true}

analysis:
  seed: 42
  samples: 10000
  confidence: 0.95
```

Run: `cargo run -q -p effractor-format --example canonicalize -- assets/examples/17-cloud-support-agent-architecture.yaml && cargo run -q -p effractor-format --example canonicalize -- assets/examples/17-cloud-support-agent-architecture.yaml && git diff --stat`
Expected: the second run changes nothing (canonical). The example test in Step 9 checks that it opens with no diagnostics at all.

The routes it holds, for reading the results: (1) a ticket injects the agent → its role → the reader role → a login to the storage API over the agent's flow → the bucket, in plaintext while unencrypted; (2) the agent's shell → the support VM → escape → the hypervisor → the key service VM → the bucket key (what is left under `encrypt`); (3) mail deceives the administrator → the password, and the browser → the laptop → the authenticator seed (what is left under `mfa`, besides the bypass) → the admin's login over the console flow; (4) an exploit of the API gateway found through either instance → the storage API; (5) the admin's write access to the help articles poisons what the agent reads.

- [ ] **Step 9: Example tests**

Append to `crates/effractor-solver/tests/graph_examples.rs`:

```rust
const CLOUD: &str = include_str!("../../../assets/examples/17-cloud-support-agent-architecture.yaml");

#[test]
fn cloud_support_agent_no_single_defence_closes_every_route() {
    let m = open(CLOUD);
    let base = p(&solve(&m, None)["baseline"]["outcome"]);
    assert!(base > 0.5, "{base}");
    for scenario in ["guardrails", "mfa", "training", "patch", "encrypt"] {
        let r = solve(&m, Some(scenario));
        let left = p(&r["scenario"]["outcome"]);
        // The same samples under a stronger defence never finish sooner.
        assert!(left <= base, "{scenario}: {left} > {base}");
        assert!(left > 0.0, "{scenario} closed every route");
    }
}

#[test]
fn cloud_support_agent_encryption_leaves_the_key_route() {
    let m = open(CLOUD);
    let r = solve(&m, Some("encrypt"));
    let route: Vec<&str> = r["scenario"]["witness"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap())
        .collect();
    assert!(route.contains(&"state/credential/bucket-key/possessed"), "{route:?}");
}

#[test]
fn cloud_support_agent_switches_never_change_the_graph() {
    let m = open(CLOUD);
    let base = generate(&m).unwrap();
    for scenario in ["guardrails", "mfa", "training", "patch", "encrypt"] {
        let mut s = m.clone();
        let sid: effractor_core::ScenarioId = scenario.parse().unwrap();
        for change in s.scenarios[&sid].changes.clone() {
            if let effractor_core::architecture::Change::EntityDefense { entity, defense, value } = change {
                s.entities[&entity].defenses.set(defense, Some(value));
            }
        }
        let g = generate(&s).unwrap();
        let ids = |g: &effractor_components::GeneratedGraph| g.nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&g), ids(&base), "{scenario}");
    }
}
```

Under `encrypt` every route to the bucket's plaintext needs the key (the storage holding says `decrypts: false`), so any witness names its possession. `left <= base` holds because baseline and scenario share their samples and a stronger defence only selects a slower slot; `web_shop_each_defence_leaves_the_other_route` relies on the same. Record the baseline and scenario numbers the test run shows (`-- --nocapture` with a `println!` while writing it) in the PR description.

Run: `cargo test -p effractor-solver --test graph_examples`
Expected: PASS.

- [ ] **Step 10: Every rule is used by a shipped file**

In `crates/effractor-components/tests/generation.rs`, delete `NOT_YET_IN_AN_EXAMPLE` and rewrite the first half of `every_rule_is_used_by_the_lecture_and_names_what_it_bound` (rename it `every_rule_is_used_by_a_shipped_file_and_names_what_it_bound`) so the used rules are the union over the lecture and every shipped architecture example:

```rust
const SHIPPED: [&str; 4] = [
    include_str!("../../../assets/examples/14-branch-office-architecture.yaml"),
    include_str!("../../../assets/examples/15-web-shop-architecture.yaml"),
    include_str!("../../../assets/examples/16-clinic-records-architecture.yaml"),
    include_str!("../../../assets/examples/17-cloud-support-agent-architecture.yaml"),
];

let mut used: BTreeSet<String> = BTreeSet::new();
for text in std::iter::once(LECTURE).chain(SHIPPED) {
    let m = architecture(text);
    // Example 16 is intentionally incomplete in its numbers, not its structure.
    let g = generate(&m).unwrap();
    used.extend(g.nodes.iter().flat_map(|n| n.origins.iter().map(|o| o.rule.clone())));
}
let all: BTreeSet<String> = RULES.iter().map(|r| r.id.to_owned()).collect();
assert_eq!(used, all);
```

The `hosted-router` exclusion goes too: example 14 runs its gateway on its appliance. The second half (the lecture's own provenance checks) stays on `generate(&lecture())`.

Run: `cargo test -p effractor-components --test generation`
Expected: PASS. A rule missing from the union means the example lacks a structure; add it to the example rather than exempting the rule.

- [ ] **Step 11: Documentation**

- `assets/examples/README.md`, after row 16: `| [17 · Cloud support agent](17-cloud-support-agent-architecture.yaml) | Architecture | Detailed | An AI agent reading a public queue, a phishable administrator with MFA, role assumption, a VM escape to a key, a shared product; no single defence closes every route |`.
- `docs/course/README.md`: where it lists the course material, add a line: `- [Cloud support agent](../../assets/examples/17-cloud-support-agent-architecture.yaml) — the lecture's ideas in a cloud estate: identities, people, agents and data as targets. Open it in the app from Examples.` If the README has no list of materials, add a short section `## Beyond the lecture` with that line.
- `ROADMAP.md`: delete the `### library-extension` item; `defense-comparison`'s `needs: library-extension` becomes `needs: —`; in the introduction, the sentence "`library-extension` was added by the owner on 2026-09-23 and comes before defense-comparison, so comparisons cover its defenses from the start." becomes "`library-extension`, added by the owner on 2026-09-23, is done, so comparisons cover its defenses from the start." `node scripts/check-roadmap.js` must pass.

- [ ] **Step 12: Checks, fixtures, commit, owner look**

```bash
scripts/build-wasm.sh && node scripts/graph-fixtures.js --write
UPDATE_SNAPSHOTS=1 cargo test -p effractor-solver --test graph_determinism
cargo test --workspace && npm test && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && node scripts/check-graph-agreement.js && node scripts/check-roadmap.js && node scripts/check-contrast.js
git add -A && git commit -S -m "Make data a target and ship the cloud support agent example"
```

If `scripts/check-graph-agreement.js` lists the files it compares by name, add example 17 to that list before running it: native and wasm must agree on it.

Owner look (8081): open Examples → Cloud support agent; see the four family colours (Data in its own); select the bucket and see "Encrypted: false", its holding "holds, ciphertext only" and the reader role "may access, read only"; Build; run each scenario and see none of them reach zero; find "Read · Customer bucket · as Data reader role" and "Escape · Support VM to Hypervisor" in the attack graph. Wait for the owner's word.

---

## Self-review

**Spec coverage.** §2.1 → Task 1; §2.2 → Task 2; §3.1–3.4 → Task 3 (account states, `mfa`, `mfa-bypass`, `factor`, `runs-as`, `assumes`, the logins' new prerequisite); §3.5 → Task 4 (person, agent, `delivers`, `knows`, `operates`, `shell`, all seven rules, flows from agents); §4 → Task 5 (data kind, `holds` with required `decrypts`, `accesses` with `mode`, `encrypted-with`, `reads`, all six rules, no timed data rule); §5 → the `defense()` arms of Tasks 2–5 with the existing scenario validation; §6 → catalog words in every task, `defenses` words (Task 3), grouped Add menu (Task 2, grown in 4–5), icons and the data family (Tasks 4–5), plain-language link words and field words (Tasks 2–5), inspector fields (Task 3, grown in 4–5); §7 → fixtures (Tasks 1–3), example 17 with its five scenarios and tests (Task 5), per-rule generation tests, switch principle (Tasks 3–5), cycles (Tasks 1, 3, 5), validation and `incomplete` (Tasks 1–5), native/wasm agreement (Task 5, Step 12); §8 → one branch per task; §9 → nothing built for it.

**Placeholders.** None: every step names its code or its exact text. One step says what to do if the environment disagrees with the plan (a data colour failing the contrast check); it names the check that decides.

**Type consistency.** `Relation::Hosts` carries `shell` from Task 4 on; Task 1's tests and generator are written before it and gain `shell: None` / `..` in Task 4, Step 1. `RelationKind::fields()` (Task 3) grows `shell` (4), `decrypts`, `mode` (5), matching the reader whitelist and the JS `FIELD_ORDER`. `Binding::Policy { entity, defense }` is used with `Defense::Mfa` (3) and `Defense::Encrypted` (5); its status is `defense` in `export.rs`, `graph_results.rs` and `vocabulary.js`. Input ids follow the spec: `input/policy/<entity>/<switch>`.
