# Sample models

Thirteen fictional models across three profiles, in rising order of complexity:
three fault trees, three attack trees and seven architectures. The first twelve
are set in **Sodium City** — an invented coastal megacity of neon, maglev lines,
chrome clinics and arcology towers, where every corporation and product is made
up. The thirteenth is a realistic exercise for defenders, with no city in it. Download a YAML
file and use **Open** (`Ctrl+O`) in Effractor; it is solved as it opens. The
files ship with both the server and the static edition under `assets/examples/`;
a local server serves the first at
`http://127.0.0.1:8080/assets/examples/01-relay-mast-fault.yaml`.

All numbers are invented teaching inputs, not measured rates, threat
intelligence or calibrated valuations. Every scenario is fictional. Each
top-node or component description defines the setting; replace the assumptions
before using a model for a real decision.

## Fault trees

| File | Detail | What to explore |
| --- | --- | --- |
| [01 · Undercity relay mast](01-relay-mast-fault.yaml) | Introductory | OR/AND gates, a single-fibre single point of failure on a maglev pylon, a rate-and-a-demand `AND` (grid tap and salvaged UPS cells), two candidate mitigations ranked by benefit per euro |
| [02 · Kestrel Clearing cred switch](02-cred-switch-fault.yaml) | Medium | A two-of-three HSM vote, a shared kernel image and a shared harbour carrier ring as common causes, an already-enabled control |
| [03 · Arcology Nine AI core](03-ai-core-fault.yaml) | Detailed | A shared heat dome across cooling and grid branches, a two-of-four CDU vote, generator common-cause fuel, integrity vs availability losses, an undeveloped black-ICE worm on the facilities network that the attack trees develop |

## Attack trees

| File | Detail | What to explore |
| --- | --- | --- |
| [04 · Drone-courier payouts](04-drone-payout-attack.yaml) | Introductory | Two alternative routes to a runner's payouts — the runner's own login, or talking the fixer's dispatch desk round — attacker cost and detection, a single point of failure, control toggles |
| [05 · Cyberware telemetry](05-cyberware-telemetry-attack.yaml) | Medium | A shared street-surgeon identity and a shared data-loss ICE barrier, a two-of-three vote on Mirrorlake's remote-support route, a diverse Pareto front of cheap-noisy and expensive-quiet routes |
| [06 · Sim-stim build leak](06-simstim-leak-attack.yaml) | Detailed | Four routes to an unreleased sim-stim build, a two-of-three artifact-store vote, an `Immediate` prerequisite, `Never` used to retire a Docks partner's legacy share, several shared identity and approval events |

## Architectures

Examples 07–13 are architectures: components and how they are linked, from which
the bundled `core-components` library generates the attack steps. The app opens
and edits them, generates the attack graph, simulates its routes in the browser,
and compares each file's scenarios against the baseline. Component values are
marked `illustrative`; `unknown` marks a value nobody has assessed yet.

Each architecture also comes **clustered**: a host is folded together with the
software it runs and the products only it uses, a router with its firewall. A
closed cluster is drawn as one stacked node (press **K** on it, or use its menu,
to open it); an open one is an outline around its members; a member listed as
`shown` stays drawn beside its closed stack — a foothold or a target kept in
view. Clusters are a way of looking: they change neither the generated graph
nor any result.

| File | Detail | What to explore |
| --- | --- | --- |
| [07 · Undercity noodle stall](07-noodle-stall-architecture.yaml) | Introductory | The smallest architecture: a decker on the stall's guest Wi-Fi reaches an unpatched cred-till over a co-op router with guest isolation off. Turning on isolation closes the route; updating the till cuts it to about 7%. Two closed clusters, one without a label |
| [08 · Street surgeon's chrome clinic](08-chrome-clinic-architecture.yaml) | Medium | Two alternative routes to one password — phishing the receptionist, or a mail attachment that reads the saved credential — converging on one portal login. Defending either route alone barely helps; multi-factor login on the shared step is what moves the number. The closed cloud cluster keeps that portal `shown`; the front desk is an open cluster |
| [09 · Arcology Nine life support](09-arcology-life-support-architecture.yaml) | Detailed | An out-of-band **administration** channel that a data-flow firewall rule does not govern. Denying the supervisory flow or patching the controller leaves the management route; only protecting the operations password closes it, and the exploit-over-flow route then still needs closing too. The engineer's rig is a closed cluster with the foothold `shown` |
| [10 · Tessellate Data profile broker](10-data-broker-architecture.yaml) | Detailed | A workload identity (`runs-as`), a role it assumes (`assumes`), a second authentication factor (a key implant) and a session grant. A decker's exploit and a phished analyst converge on a reader role; patching, briefing and the implant factor each leave a route, and only all three together drive the number down. Five clusters tame the drawing; the data lake stays closed with the citizen profiles `shown` |
| [11 · Arcology Nine ops construct](11-ops-construct-architecture.yaml) | Detailed | An autonomous AI construct that **reads** a runbook wiki: poisoning the corpus (control the wiki, change the pages) reaches the construct, prompt-injection takes it over, and its sandboxed identity reads the tower's secrets. Patching the wiki closes the poisoning at its source; guarding the construct slows but does not stop it. The wiki, where it happens, is the one open cluster |
| [12 · Kestrel Clearing identity vault](12-identity-vault-architecture.yaml) | Detailed, incomplete | An **unknown** exploit time on the street-facing identity API leaves the target with no number until it is assessed or the vendor patch closes that route. A second route from an inside terminal to the encrypted-at-rest vault then shows why encryption at rest alone is nearly worthless while the key is extractable, and only sealing it in the HSM closes the route. The vault is an open cluster; the second foothold is `shown` beside its closed one |
| [13 · Treasury hot wallet on a workstation](13-hot-wallet-architecture.yaml) | Detailed, realistic | A defender's exercise on a small fund's treasury laptop. A hot wallet's keystore is stolen by an infostealer, delivered through a lure or through an exploited remote-support agent behind a forwarded port, and the recovery phrase is phished by a fake wallet-support page. Unprotected, the funds are gone within a month. A hardware wallet, a closed port or a patched agent each leave the phrase route, and two defences on the same route add nothing. Only 2-of-3 multisig changes the order of magnitude, and even all four together leave a blind-signing route |

## Reading the assumptions

Trees and architectures share these conventions.

- `p` is a static probability for the stated mission or demand; its CDF is
  flat, so changing the horizon does not rescale it. `rate` is a
  time-to-first-failure rate per `time_unit`, with no repair. `ttc` gives a time
  distribution in that unit; a leading `n% *` is a chance the event ever occurs.
- Every leaf clock starts at zero. OR takes the earliest completion, AND the
  latest, a vote the k-th. Attack-tree AND gates do not add sequential action
  times; an architecture's generated actions do accumulate along a route.
- Distinct leaves are independent. Reusing a node ID, or naming one component in
  several relationships, represents one shared event or prerequisite, sampled
  and (for attackers) costed once. Common causes are modelled explicitly.
- Attacker costs are EUR per completed leaf, counted once for shared leaves.
  Detection is a separate objective; it does not by itself stop a route.
  Defender control costs are allocated to the horizon or demand.
- Asset C/I/A losses cover separate stated consequences; only the largest
  fraction counts when several nodes hit one asset and dimension, at most one
  loss per asset and dimension per horizon.
- For architectures, a scenario flips a defence switch (patched, guarded,
  trained, protected, encrypted, multi-factor login) or a firewall permission
  and shows the change against the baseline. An `unknown` value is an unknown
  branch, not a guess either way: while one is on a live route, the target gets
  no number rather than a number that ignores it.

For a first walkthrough, open 01 or 07 and look at the cut sets or the generated
route, then toggle a control or run a scenario and compare. Use 03 for voting
and shared causes, 06 for the attacker Pareto view, 09 for the out-of-band
management lesson, 11 for content-driven agent compromise, 12 for what an
unknown value does to the result, and 13 to rank defences as a blue team. All
files use fixed seeds and 10,000 samples; sampling intervals describe
simulation error, not confidence in the invented assumptions.
