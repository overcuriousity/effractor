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
| `assets/js/architecture-edit.js` | Kind list, Add groups | 1–5 |
| `assets/js/architecture-links.js` | Relation list, fields, words | 1–5 |
| `assets/js/architecture-links-ui.js` | Association inspector fields, flow ends | 3–5 |
| `assets/js/architecture-view.js` | `shownSlots` | 1 |
| `assets/js/architecture-ui.js` | Grouped Add menu, shown slots | 1–2 |
| `assets/js/architecture-icons.js` | Icons, families | 2, 4, 5 |
| `assets/js/vocabulary.js` | `defense` status word | 3 |
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
- Produces: `Slot::MfaBypass` (`"mfa-bypass"`; Account slots `[AdminLogin, MfaBypass]`); `Defense::Mfa` (`"mfa"`, on Account); `Factor { First, Second }` (`"first"|"second"`); `Relation::Authenticates { from, to, factor }`; `Relation::RunsAs { from, to, privilege }` (`"runs-as"`, from host/application/service, to account); `Relation::Assumes { from, to }` (`"assumes"`, account → account); `Binding::Policy { entity: EntityId, defense: Defense }` = zero when the switch is off, never when on, unknown when unknown; facts `state/account/<a>/{material,mfa-satisfied,authenticated}`; `input/mfa/<a>`; `action/mfa-bypass/<a>`; `action/account-authenticated/<a>` (All, Logical). `service-login`/`administration-login` require `authenticated`. JS: `L.fieldsOf(kind, fromKind, toKind) -> {name, values}[]` and `L.variants(doc, kind, from, to) -> object[]`.

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

Replace the single-`extra` logic in `association()` with a field list per kind:

```rust
/// The fields beside kind/from/to/description a kind of association has.
fn extras(kind: RelationKind) -> &'static [&'static str] {
    match kind {
        RelationKind::Permits => &["allowed"],
        RelationKind::Authenticates => &["factor"],
        k if k.has_privilege() => &["privilege"],
        _ => &[],
    }
}
pub const FACTORS: [(&str, Factor); 2] = [("first", Factor::First), ("second", Factor::Second)];
```

The `fields(...)` whitelist becomes `["kind", "from", "to", "description", "privilege", "allowed", "factor"]` (Tasks 4–5 add `shell`, `decrypts`, `mode`); the misplaced-key loop iterates that whole list of extras and reports each present key not in `extras(kind)`. `factor` is optional:

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

Run: `cargo test -p effractor-format` → PASS (fixture canonical tests fail until Step 9).

- [ ] **Step 4: `Binding::Policy`**

`graph.rs`:

```rust
    /// Zero while the owner's defence is off, never while it is on: a
    /// defence that removes a way rather than slowing one.
    Policy { entity: EntityId, defense: Defense },
```

`resolve.rs`, arm be

---

> **Unfinished (2026-09-24).** Writing stopped here, partway through Task 3, Step 4. Still to write, from the spec: the rest of Task 3 (identity, §3.1–3.4), Task 4 (operators, §3.5) and Task 5 (data and the cloud support agent example, §4, §7). Follow the conventions of Tasks 1–2.
