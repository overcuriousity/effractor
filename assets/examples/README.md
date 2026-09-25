# Sample models

Twelve fictional models across three profiles, in rising order of complexity:
three fault trees, three attack trees and six architectures. Download a YAML
file and use **Open** (`Ctrl+O`) in Effractor; it is solved as it opens. The
files ship with both the server and the static edition under `assets/examples/`;
a local server serves the first at
`http://127.0.0.1:8080/assets/examples/01-edge-node-fault.yaml`.

All numbers are invented teaching inputs, not measured rates, threat
intelligence or calibrated valuations. Every scenario is fictional. Each
top-node or component description defines the setting; replace the assumptions
before using a model for a real decision.

## Fault trees

| File | Detail | What to explore |
| --- | --- | --- |
| [01 · Metro edge node](01-edge-node-fault.yaml) | Introductory | OR/AND gates, a single-fibre single point of failure, a rate-and-a-demand `AND`, two candidate mitigations ranked by benefit per euro |
| [02 · Card switch](02-payment-switch-fault.yaml) | Medium | A two-of-three HSM vote, a shared kernel image and a shared carrier ring as common causes, an already-enabled control |
| [03 · GPU compute hall](03-gpu-hall-fault.yaml) | Detailed | A shared heat wave across cooling and grid branches, a two-of-four CDU vote, generator common-cause fuel, integrity vs availability losses, an undeveloped ransomware event that the attack trees develop |

## Attack trees

| File | Detail | What to explore |
| --- | --- | --- |
| [04 · Courier payouts](04-courier-payout-attack.yaml) | Introductory | Two alternative routes, attacker cost and detection, a single point of failure, control toggles |
| [05 · Implant telemetry](05-implant-telemetry-attack.yaml) | Medium | A shared clinician identity and shared export barrier, a two-of-three vendor-access vote, a diverse Pareto front of cheap-noisy and expensive-quiet routes |
| [06 · Game build leak](06-game-build-leak-attack.yaml) | Detailed | Four routes, a two-of-three artifact-store vote, an `Immediate` prerequisite, `Never` used to retire one legacy path, several shared identity and approval events |

## Architectures

Examples 07–12 are architectures: components and how they are linked, from which
the bundled `core-components` library generates the attack steps. The app opens
and edits them, generates the attack graph, simulates its routes in the browser,
and compares each file's scenarios against the baseline. Component values are
marked `illustrative`; `unknown` marks a value nobody has assessed yet.

| File | Detail | What to explore |
| --- | --- | --- |
| [07 · Night-market ramen bar](07-ramen-bar-architecture.yaml) | Introductory | The smallest architecture: a guest-Wi-Fi customer reaches an unpatched till over a router with guest isolation off. Either turning on isolation or updating the till closes the route |
| [08 · Dental practice](08-dental-practice-architecture.yaml) | Medium | Two alternative routes to one password — phishing the receptionist, or a mail attachment that reads the saved credential — converging on one portal login. Defending either route alone barely helps; multi-factor login on the shared step is what moves the number |
| [09 · Building automation](09-building-automation-architecture.yaml) | Detailed | An out-of-band **administration** channel that a data-flow firewall rule does not govern. Denying the supervisory flow or patching the controller leaves the management route; only protecting the operations password closes it, and the exploit-over-flow route then still needs closing too |
| [10 · Cloud analytics platform](10-cloud-analytics-architecture.yaml) | Detailed | A workload identity (`runs-as`), a role it assumes (`assumes`), a second authentication factor and a session grant. Two entry routes — a service exploit and a phished analyst — converge on a reader role; patching, training and MFA each leave a route, and only all three together drive the number down |
| [11 · DevOps assistant](11-devops-assistant-architecture.yaml) | Detailed | An autonomous agent that **reads** a runbook wiki: poisoning the corpus (control the wiki, change the pages) reaches the agent, prompt-injection takes it over, and its sandboxed identity reads the secrets. Patching the wiki closes the poisoning at its source; guarding the agent slows but does not stop it |
| [12 · Exchange KYC vault](12-exchange-kyc-vault-architecture.yaml) | Detailed, incomplete | An **unknown** exploit time on the internet-facing API leaves the target with no number until it is assessed or the vendor patch closes that route. A second route through an internal workstation to the encrypted-at-rest database then shows why encryption at rest alone is nearly worthless while the key is extractable, and only sealing it in the HSM closes the route |

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
management lesson, 11 for content-driven agent compromise, and 12 for what an
unknown value does to the result. All files use fixed seeds and 10,000 samples;
sampling intervals describe simulation error, not confidence in the invented
assumptions.
