# Sample trees

Twelve realistic, fictional models and one date-night bonus. Download a YAML
file and use **Open** (`Ctrl+O`) in Effractor, then **Solve** (`Ctrl+Enter`).
The files are bundled with the server and static edition under
`assets/examples/`; for example, a local server serves the first at
`http://127.0.0.1:8080/assets/examples/01-cold-room-fault.yaml`.

| File | Profile | Detail | What to explore |
| --- | --- | --- | --- |
| [01 · Cold room](01-cold-room-fault.yaml) | Fault | Introductory | OR/AND gates, fixed probabilities, one asset, an enabled control |
| [02 · Water booster](02-water-booster-fault.yaml) | Fault | Small | Redundant pumps, shared feeder, hourly failure rates, common-cause SPOF |
| [03 · Data-center cooling](03-data-center-cooling-fault.yaml) | Fault | Medium | Two-of-three failure vote, shared flood event, partial and full asset loss |
| [04 · Rail crossing](04-rail-crossing-fault.yaml) | Fault | Medium | Per-demand probabilities, backup power, undeveloped events |
| [05 · Satellite downlink](05-satellite-downlink-fault.yaml) | Fault | Detailed | Redundant subsystems, two-of-four vote, nonconstant failure-time distributions |
| [06 · Food production](06-food-production-fault.yaml) | Fault | Detailed | Defect/barrier combinations, repeated events, multiple consequence levels |
| [07 · Online shop](07-online-shop-attack.yaml) | Attack | Introductory | Alternative access routes, attacker cost/detection, control toggles |
| [08 · Museum theft](08-museum-theft-attack.yaml) | Attack | Medium | Physical security, a shared exit barrier, cost/time/detection trade-offs |
| [09 · Payroll fraud](09-payroll-fraud-attack.yaml) | Attack | Medium | Two-of-three approval quorum and an alternative payment route |
| [10 · Research data](10-research-data-attack.yaml) | Attack | Detailed | Shared identity gate, shared export barrier, diverse TTC distributions, Pareto front |
| [11 · Software supply chain](11-software-supply-chain-attack.yaml) | Attack | Detailed | Shared publishing authority, Zero precondition, Infinity route-blocking control |
| [12 · Wind farm](12-wind-farm-attack.yaml) | Attack | Detailed, incomplete | An intentionally unknown likelihood, qualitative analysis, shared router SPOF |
| [13 · Grumpy girlfriend](13-grumpy-girlfriend-fault.yaml) | Fault | Bonus | Date-night mishaps, a repeated booking event, a voting gate, zero-cost mitigations |

## Reading the assumptions

All numbers are invented teaching inputs, not measured rates, threat
intelligence, safety evidence or recommended valuations. Each top-node
description defines the scenario. Replace the assumptions before using a model
for a real decision. Node and control descriptions travel with the YAML when
opened and saved.

- `p` is a static probability for the stated mission or demand. It is a
  Bernoulli event at time zero, so its CDF is flat; changing the horizon does
  not rescale it. `rate` is a time-to-first-failure rate per `time_unit`, with
  no repair. `ttc` supplies a time distribution in that same unit.
- Every leaf clock starts at zero. OR takes the earliest completion, AND the
  latest, and a vote the kth completion. Attack-tree AND gates do not add
  sequential action times. Backup-system examples do not model dormant spares,
  switching delays or repairable-system availability.
- Distinct leaves are assumed independent. Reusing a node ID represents one
  shared event or prerequisite; copying it into separate leaves would change
  the result. Common causes are modeled explicitly where shown.
- Attacker costs are EUR per completed leaf, counted once for shared leaves.
  Detection probabilities describe a separate attacker objective; detection
  does not itself stop a route. Defender control costs are allocated to the
  model's horizon or demand. Enabled controls define the starting scenario.
- Asset C/I/A losses cover separate stated consequences. If several occurring
  nodes affect the same asset and dimension, only the largest fraction counts.
  Loss can occur on a lower branch, even without the top event. The model counts
  at most one loss per asset/dimension per horizon, not recurring incidents.
- Controls replace leaf TTCs. Compare their individual marginal benefits in
  the Controls panel; benefits are not additive. `Infinity` in example 11
  represents removal of one legacy path, not perfect security for the system.
  Free controls in example 13 have no meaningful benefit-per-cost ratio.
- Example 12 intentionally omits the vendor gateway's TTC. It should open with
  an unknown-likelihood marker and still offer cut sets and single points of
  failure. Quantitative results need an assessed likelihood for that leaf.

For a first walkthrough, solve 01 or 07, inspect the cut sets, then toggle a
disabled control and compare the results. Use 03 for voting and loss fractions,
10 for the attacker Pareto view, and enable **Remove the legacy direct-upload
path** in 11 to block that route. All files use
fixed seeds and 10,000 samples; sampling intervals describe simulation error,
not confidence in the invented assumptions.
