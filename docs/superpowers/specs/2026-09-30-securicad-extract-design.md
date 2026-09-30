# effractor — what the lecture extract draws that the library lacks

Date: 2026-09-30 · Status: approved by the owner, 2026-09-30 (written spec
reviewed the same day).

## 1. Purpose and boundary

On 2026-09-30 the owner walked the lecture extract (`extract.pdf`, printed
pp. 112–134, sections 5.3–5.5; outside the repository) against the page and
could not rebuild section 5.3.3 as the extract draws it. The comparison,
figure by figure, is in `docs/LECTURE-ACCEPTANCE.md`. The owner's ruling:
close that gap — **what the extract shows**, not securiCAD Community
Edition's whole object model, which waits for `mal-securicad-compatibility`
with a real language file in hand.

Done when the owner rebuilds sections 5.3–5.5 in the browser, in the extract's
order and shape, and the generated attack graph has the steps the extract's
story uses: an exploit found and used against the server's software, the IDS
and the anti-malware got past, patching as a defence, root on the router
through its access control.

Kept: the small transparent library (`core-components`, version stays 1: the
change is additive), local-first wasm, native/wasm agreement, no third
parties, unknown keys as errors, no panics on user input, and **nothing
generated changes for an existing file** — the lecture fixture's numbers and
every frozen fingerprint stay where a file draws none of the new things.

Out: views of one model (the extract renames a tab, 5.27); web applications,
datastores, physical zones, keystores, scanners and the rest of securiCAD's
vocabulary the extract never touches; a drawn attacker node (the foothold pin
already says where the attacker starts; owner, 2026-09-30).

## 2. What the extract shows and what each thing becomes

| Extract | Figure | Becomes |
|---|---|---|
| AccessControl on a router or host; accounts with root / user on it | 5.18, 5.19, 5.21, 5.23 | kind `access-control` (§3.1) |
| IDS, IPS on a router; IDS and anti-malware to get past on the server | 5.18, 5.36 text | kinds `ids`, `ips` (§3.2); host switch *Anti-malware* (§4) |
| SoftwareProduct on a host or client: Windows 7, Ubuntu Linux, RHEL 7.2, putty | 5.28, 5.35 | `instance-of` from host and application (§3.3) |
| Host defences ASLR, AntiMalware, DEP, Hardened, HostFirewall, Patched, StaticARPTables | 5.37 | host switches (§4); *Patched* stays on the product |
| Host attack steps ARPCachePoisoning, BypassAntiMalware, BypassIDS, Compromise, DenialOfService, DeployExploit, FindExploit, PhysicalAccess, PrivilegeEscalation, USBAccess, UserAccess | 5.33, 5.34 | rules and foothold states (§5) |
| The attacker holds an entry to a component | 5.33, 5.35 | the pin, plus a foothold on an account (§5.4) |
| Elements hidden inside a component, an "Extra" tab | 5.20, 5.21 | containment through clusters (§6) |
| Non-root client execution, dataflow with a route, the firewall's permission, TTC curve, most probable path, a Defenses tab | 5.25, 5.31, 5.32, 5.34, 5.36, 5.37 | already there |

## 3. Objects and links

Vocabulary in the file as today: `entities.<id>.kind`, `associations.<id>`
with `kind`, `from`, `to` and fields, `flows.<id>`. Plain words on the page
come from the catalog (`word`, `name`, `title`, `meaning`), never ids.

### 3.1 Access control

- Kind `access-control`. Family *identity*. Meaning: "Where accounts log in
  to a machine: its user database, its login." No states, no parameters, no
  switch of its own.
- Association `controls-access`: `host | router → access-control`, one per
  machine, one machine per access control (as `filters` is one per router).
- Association `grants` gains `to: access-control` beside `host | router`,
  with the same `privilege` field. A grant to an access control is a grant
  on the machine it controls access to. **A grant straight to a machine stays
  valid and means the same**: existing files open unchanged and generate the
  same graph. The Link menu on an account offers the access control when the
  machine has one, else the machine.
- Generation: `session-grant` and `administration-login` read a grant
  through an access control as a grant on its machine; the provenance names
  both associations. No new rule, no new state; the access control appears
  in the graph only as the origin of those steps.
- Page: adding a host or a router offers *with an access control* (Tab / the
  linked add), since the extract's hosts "come with" one; an existing file
  is not changed. The pin cannot be dropped on it.

### 3.2 IDS and IPS

- Kinds `ids` and `ips`. Family *network*. Meanings: "Watches traffic and
  reports what it recognizes" / "Watches traffic and stops what it
  recognizes." Switch `enabled` (Unknown / On / Off; a new one starts
  Unknown like every switch). Parameter slot `bypass` — *Get past it* — the
  time to evade what it recognizes; the note says how (fragmentation,
  encoding, a novel exploit).
- Association `watches`: `router | host → ids | ips`, any number.
- Generation: for a flow whose route crosses a router with an enabled IDS or
  IPS, or that ends at a service on a host with one, `service-deploy-exploit`
  over that flow gains a prerequisite fact `<sensor>.bypassed`, produced by
  rule `sensor-bypass` (*Get past the IDS* / *Get past the IPS*, `bypass`
  slot, one per sensor). An IDS and an IPS differ only in the word and the
  author's time; the extract draws no other difference and the library
  invents none. With `enabled` off, the sensor produces nothing and the step
  is not generated; with `enabled` unknown, the fact is unknown (the usual
  unknown handling). A sensor on a host also guards the host's own
  `host-deploy-exploit` (§3.3).
- No sensor, no step: existing files generate as before.

### 3.3 Products on hosts and applications

- `instance-of` gains `from: host | application` beside `service`. One
  product per instance, as today.
- New host states: none. New facts: `host.reachable`, `application.reachable`
  (internal facts, like `service.reachable`; not foothold states).
- Rules:
  - `host-reachable` (*A connection reaches the host*): any service the host
    runs is `reachable` → `host.reachable`. Logical. Nothing by being near:
    a host with no reachable service is not reachable.
  - `application-reachable` (*The application is in reach*):
    `application.contacted` (content in front of it) or the application's own
    flow `connected` → `application.reachable`. Logical.
  - `product-reachable` gains: `host.reachable` or `application.reachable`
    for any instance of the product, as `service.reachable` today.
  - `host-deploy-exploit` (*Use the exploit against the host*):
    `product.exploit-ready` and `host.reachable`, and the host's sensors and
    anti-malware got past (§3.2, §4) → `host.admin`. Slot `deploy-exploit`
    on the host (new parameter, the same word as the service's).
  - `application-deploy-exploit` (*Use the exploit against the application*):
    `product.exploit-ready` and `application.reachable` → `application.control`.
    Slot `deploy-exploit` on the application.
- `find-exploit` / `find-exploit-patched` stay on the product, so *Patched*
  on Ubuntu Linux patches every host that runs it, as in the extract.

## 4. Host defences (5.37)

Switches on a host, each Unknown / On / Off, each named as the extract names
it; only *Patched* is not here because it lives on the product.

| Switch | Word | Effect |
|---|---|---|
| `anti-malware` | Anti-malware | On: `host-deploy-exploit`, and `service-deploy-exploit` for services the host runs, need `host.malware-cleared`, produced by rule `antimalware-bypass` (*Get past the anti-malware*), slot `bypass-antimalware` on the host. |
| `hardened` | Hardened | Replaces the time of *Escalate privilege* (§5.1): slot `escalate-hardened`. |
| `host-firewall` | Host firewall | On: a flow into a service the host runs needs a permission from the host as it needs one from a router's firewall: `permits` gains `from: host`, and `flow-connect`'s route reads the host's permission last. A flow with no permission from an enabled host firewall is `unfinished` (route incomplete, as for a firewall with no permission), not denied — the same rule as today's firewalls. |
| `aslr` | ASLR | Replaces the time of *Use the exploit against the host* and against its services: slots `deploy-exploit-aslr` on host and service. |
| `dep` | DEP | The same, slot `deploy-exploit-dep`. With both on, the ASLR replacement is read (one replacement per step; the note on either says so). |
| `static-arp` | Static ARP tables | On: ARP cache poisoning (§5.3) does not reach this host's flows. |

Replacement slots follow `patched`'s pattern exactly: `replaced_by {defense,
slot}` on the rule, the replacement parameter on the same owner, illustrative
notes in fixtures only. The library installs no times.

## 5. Host attack steps (5.33, 5.34)

| Extract | Here |
|---|---|
| UserAccess | foothold `host.user` (exists) |
| Compromise | foothold `host.admin` (exists) |
| FindExploit, DeployExploit | §3.3 |
| BypassIDS | §3.2 |
| BypassAntiMalware | §4 |
| PrivilegeEscalation | §5.1 |
| PhysicalAccess, USBAccess | §5.2 |
| DenialOfService | §5.3 |
| ARPCachePoisoning | §5.3 |

### 5.1 Escalate privilege

Rule `escalate` (*Escalate privilege*): `host.user` → `host.admin`, slot
`escalate` on the host, replaced by `escalate-hardened` while *Hardened* is
on.

**Optional slots.** Today a parameter the file does not name resolves to
*unknown* (`resolve.rs`), which withholds the number; that stays for every
slot that exists today. Every slot this spec adds to a kind that already
exists (`escalate`, `escalate-hardened`, `deploy-exploit` and its ASLR / DEP
replacements on host and application, `bypass-antimalware`, `physical`,
`usb`, `deny`, `poison`) is marked `optional: true` in the catalog: **absent
means the step is not drawn; unknown means drawn and withheld.** That is
what keeps existing files' graphs and numbers unchanged: a host in an old
file has no `escalate`, so no escalation route appears until the author adds
one. The editor does not write optional slots when it adds a component; the
inspector shows each as a row saying *not drawn until a time is given*, and
filling it writes it. Slots on the new kinds (`bypass` on a sensor) are
required as slots are today: a new sensor starts Unknown like every switch.

### 5.2 Physical and USB access

Foothold states on a host: `physical` (*The attacker is at the machine*) and
`usb` (*The attacker can plug into it*). Rules `physical-access`
(*Physical access*): `host.physical` → `host.admin`, slot `physical`;
`usb-access` (*USB access*): `host.usb` → `host.user`, slot `usb`. Both are
attacker inputs only: nothing produces them but a foothold.

### 5.3 Denial of service, ARP cache poisoning

- State `unavailable` on host and service (*Denial of service*), a target
  state only (nothing depends on it). Rule `deny-service`: `host.reachable`
  or `service.reachable` → `unavailable`, slot `deny`.
- Rule `arp-poison` (*ARP cache poisoning*): `network.access` →
  `network.poisoned`, slot `poison` on the network. For a flow whose route
  passes that network, `flow.intercepted` unless the flow says
  `encrypted: true` (new optional flow field, default false — the extract's
  SSH flow gets `encrypted: true` in the fixture) or both ends' hosts have
  *Static ARP tables* on. An intercepted flow gives `credential.possessed`
  for every credential that authenticates an account the flow's target
  service authorizes and that is `carried` by the flow (new optional field
  `carries: [<credential>]` on a flow; absent means nothing to take). Shallow
  on purpose: it is in the extract's list, not its story.

### 5.4 A foothold on an account

State `held` on an account (*The attacker holds this account*: what logs it
in). A foothold only; it produces `account.material`, then the existing rules
run (`mfa-policy` / `mfa-second-factor` still apply, so an account with
multi-factor login on still needs the second factor). The pin can be dropped
on an account.

## 6. Containment (5.20, 5.21)

Dragging a component onto a host or a router and releasing it puts both in a
cluster headed by the machine (an existing cluster headed by it grows). A
headed cluster draws, closed, as the machine's icon and name with the member
count; open, as today. The inspector of the head lists its members under
*Inside*, the extract's "Extra" tab. Clusters are a way of looking; the file
records them as it records clusters today plus a `head`; generation reads
nothing. Dragging a member out of the open cluster removes it.

## 7. Page

- Add menus and the rail's + offer the new kinds under their families; the
  `?` legend gets their meanings. Icons in `architecture-icons.js`.
- Link menu words (`architecture-links.js` WORDS): `controls-access`
  *its access control* / *controls access to*; `watches` *watched by* /
  *watches*; `grants` to an access control reads as it does to a machine.
- The switch list on a host grows by six rows in the order of 5.37; the
  parameter rows say *not drawn until a time is given* while absent.
- The pin accepts an account (*held*) and a host's *physical* / *usb* through
  its state choice; the target accepts *unavailable*.
- The flow form gains *Encrypted* and *Carries*.
- Every generated step's inspector names its rule and source as today.

## 8. Fixtures, tests, acceptance

- `docs/course/lecture-architecture.yaml` is rebuilt as the extract draws it:
  access controls on router and server, the router's account on its access
  control, the server's IDS and anti-malware with illustrative times, Ubuntu
  Linux on the server, Windows 7 on the workstation, putty as the client's
  product, the SSH flow `encrypted: true`. Its `patch` / `protect` / `both` /
  `deny` scenarios stay; the course text's table of numbers is rewritten from
  the solver (the test holds it). The unknown and partial files follow.
  **The old fixture stays as a test fixture under
  `crates/effractor-components/tests/fixtures/`** so that "an existing file
  generates the same graph" is a frozen test, not a claim.
- Rust: catalog and validation tests per kind, link and switch; generation
  and provenance tests per rule, each with the extract's figure in its name;
  the absent-vs-unknown rule; a grant through an access control equals a
  grant on the machine (same graph ids, same numbers); frozen fingerprints
  untouched; wasip1 under wasmtime; agreement cases for the rebuilt fixture.
- JS: links, edit, icons, pins, clusters with a head, the flow form fields.
- Owner: rebuilds 5.3–5.5 figure by figure on a preview, each part on its
  own branch and look; the acceptance record gets that walk.

## 9. Delivery

One roadmap item `securicad-extract` replacing `host-products`, decomposed
into branches in this order, each landed and looked at before the next:

1. `access-control` — §3.1, §6 (containment, since 5.20 hides the access
   control and firewall inside the router).
2. `host-products` — §3.3 and the ASLR / DEP switches of §4.
3. `sensors` — §3.2 and *Anti-malware* of §4.
4. `host-steps` — §5.1–5.4, *Hardened*, *Host firewall*, *Static ARP tables*.
5. `extract-fixture` — §8's rebuilt course files and text, the acceptance
   walk, the roadmap item removed.

Each branch: test-first, the required checks, a fresh review, the owner's
look on a preview, exact-SHA CI, fast-forward, release. Optional slots
(§5.1) land with branch 2, the first branch that adds a slot to an existing
kind.
