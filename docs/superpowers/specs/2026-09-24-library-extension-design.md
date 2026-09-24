# effractor — component library extension

Date: 2026-09-24 · Status: design approved by the owner in conversation,
2026-09-23 (section 1) and 2026-09-24 (sections 2–3); written spec awaiting review

Amends [the lecture workflow design](2026-09-21-lecture-workflow-design.md)
§4 (vocabulary), §5 (parameters and defenses), §6 (generation) and §9 (defense
switches). Everything not named here stays as written there.

## 1. Purpose and principles

The lecture library describes a 2000s network: zones, a router, servers,
SSH, passwords. Today's attacks run through virtualised and cloud
infrastructure, through identities rather than hosts, through people and
through AI agents that read untrusted content and act with real permissions,
and they end at data. This extension adds exactly the structure those routes
need, oriented on securiCAD's coreLang and on how modern breaches actually
proceed, while keeping the library small and every rule explainable.

* **In place.** The library stays `core-components@1`; files change in place.
  There is nothing to migrate (owner, 2026-09-23).
* **Switches never change structure.** A defense switches a policy input or
  selects a replacement duration. The generated graph is the same for every
  switch value, so step ids pair across baseline and scenarios.
* **No invented numbers.** New timed rules get slots, `unknown` until authored.
* **Logical where the world is logical.** A step that takes no attacker effort
  once its prerequisites hold is logical and says so in its assumptions.
* **AI-accelerated attackers are not structure.** They change how long and how
  likely steps are, not which steps exist. That is a per-scenario override of
  durations (an attacker profile), recorded under `defense-comparison` in the
  roadmap, not a library rule.

## 2. Virtualisation and shared vulnerabilities

### 2.1 Hosts on hosts

`hosts` gains `host → host` (a VM or container on its hypervisor or node).
`privilege: user|admin` says what the guest runs as on the host: a VM's
hypervisor process or a rootless container is `user`, a privileged container
`admin`. A guest host has exactly one hosting host; nesting is allowed
(container in VM on hypervisor); a hosting cycle is an error.

* `hosted-host` (logical): the hosting host's `privilege` state → guest
  `admin`. Whoever controls the hypervisor controls its guests.
* `guest-escape` (timed): guest `admin` → the hosting host's `privilege`
  state. Slot `escape` on the guest host; one action per guest.
* A router on a host gets the same escape: `router-escape`, router `admin` →
  hosting host's `privilege` state, slot `escape` on the router. This replaces
  §6's "no reverse rule" for routers: leaving a VM or appliance for its host
  is now that timed step.

The `escape` slot exists on every host and router and is materialised by
canonical saves; it matters only where a hosting association exists. The
inspector shows it only on a hosted host or router.
No switch: hardening an escape is an edit of its duration.

### 2.2 Products

New kind `product`: one software version (for example "OpenSSH 9.6"). New
association `instance-of: service → product`; every service is an instance of
exactly one product, and a service without one is `incomplete`.

Discovery moves from the service to the product. The product carries
`find-exploit`, `find-exploit-patched` and `defenses.patched`; the service
keeps `deploy-exploit` and `login` and loses its `find-exploit*` slots and its
`patched` switch.

* `product-reachable` (logical): any instance's `reachable` → product
  `reachable`.
* `product-find-exploit` (timed, one per product): product `reachable` →
  product `exploit-ready`. Slot `find-exploit`, replaced by
  `find-exploit-patched` when `patched`.
* `service-deploy-exploit` now needs product `exploit-ready` **and** the
  service's own `reachable` — an exploit found through one instance is
  deployed separately on each instance the attacker can reach.

A partly patched fleet is two products. Products apply to services only;
client-side exploitation of applications stays outside this library (§4
reaches applications through their operators).

## 3. Identities, operators and multi-factor login

### 3.1 Account states

An account gets these facts:

| State | Meaning |
|---|---|
| `material` | The attacker holds a first factor (any authenticating credential not marked `second-factor`). Unchanged. |
| `mfa-satisfied` | The second factor is no obstacle. |
| `authenticated` | The attacker can log in as this account. |
| session per service | Unchanged, now requiring `authenticated`. |

`service-login` and `administration-login` require `authenticated` in place of
`material`. Everything else about them is unchanged.

### 3.2 Multi-factor login

Accounts gain the switch `defenses.mfa: true|false|unknown` and the slot
`mfa-bypass` (push fatigue, adversary-in-the-middle proxies, SIM swap — the
note says which). `authenticates` gains `factor: first|second`: how this
credential proves this account (a password is `first`; a hardware key, an
authenticator seed or a stolen session cookie `second`). Absent reads as
`first` and canonical saves omit it; only `factor: second` is written. It sits
on the association, not the credential, because one secret can be a first
factor for one account and a second for another. A second factor does not
produce `material`.

* `mfa-policy` (logical): input `input/policy/<account>/mfa`, satisfied when
  `mfa` is `false`, unsatisfied when `true`, an unknown branch when `unknown` →
  `mfa-satisfied`.
* `mfa-second-factor` (logical): possession of a credential that
  authenticates the account with `factor: second` → `mfa-satisfied`.
* `mfa-bypass` (timed, one per account): `material` → `mfa-satisfied`. Slot
  `mfa-bypass` on the account.
* `account-authenticated` (logical): `material` and `mfa-satisfied` →
  `authenticated`.

This replaces §4's "multi-factor authentication is outside this library".

### 3.3 Workload identity

New association `runs-as: host | application | service | agent → account`,
with a required `privilege: user|admin`: for a host, the privilege needed to
use the identity; software uses it as `user` (as `stores` does). A workload
may run as several accounts.

* `workload-identity` (logical): the source's control (`control`, or the host's
  `privilege` state) → account `authenticated`, without credentials or MFA.
  Assumption: whoever runs code in the workload can obtain its identity's
  token; metadata-endpoint hardening stops remote request forgery, not code
  execution, so it is not a switch here.

The token is still used through `service-login` against a reachable service
that authorizes the account (the cloud provider's API, a cluster's API
server).

### 3.4 Role assumption

New association `assumes: account → account` (from may become to); an
account assuming itself is an error.

* `assume-role` (logical): `authenticated` of the source → `authenticated` of
  the target. Chains and cycles are ordinary logical facts (§7 of the lecture
  design handles cycles). Assumption: trust-policy conditions (external id,
  required MFA, source address) are not modelled.

### 3.5 Operators: people and agents

> **Amended 2026-09-24 (§10).** People are built as written here. The `agent`
> kind, `shell`, `inject`, `agent-shell` and the `guarded` switch on agents
> are replaced by content-processing software (§10); where this section says
> "agent", read "software that processes content".

Two new kinds read content and act on it.

**`person`** — a human user. States `contacted`, `deceived`. Associations
`knows: person → credential` (what they could type into a fake login) and
`operates: person → application` (the mail client or browser they use).
Slots `phish`, `phish-trained`; switch `defenses.trained`.

**`agent`** — software that reads content and acts on its own: a coding agent,
a support bot, an automation with tool access. States `contacted`, `control`.
It is hosted like an application (`hosts: host | router → agent`, with
`privilege`) and additionally carries `shell: true|false` on that hosting
association: whether its tools include running commands. Its tool calls are
ordinary flows (flow `source` may be an agent). Slots `inject`,
`inject-guarded`; switch `defenses.guarded` (guardrails or human approval of
tool calls). `host-execution` gives the hosting host's control to the agent as
to any executable.

New associations `delivers: network → person | agent` (content from anyone in
that zone reaches this reader — email from `internet`, a public ticket queue)
and `reads: agent → data` (see §4.4).

* `content-from-zone` (logical): network `access` + `delivers` → reader
  `contacted`.
* `content-from-service` (logical): control of a service that a reader's flow
  targets → reader `contacted`. For an agent, its own flows; for a person, the
  flows of applications they operate. Watering holes, poisoned RAG stores and
  compromised MCP servers are this rule.
* `phish` (timed, one per person): `contacted` → `deceived`. Slot `phish`,
  replaced by `phish-trained` when `trained`.
* `person-disclose` (logical): `deceived` + `knows` → credential `possessed`.
* `person-run` (logical): `deceived` + `operates` → application `control`.
  Which of the two consequences exists is the author's choice of associations.
* `inject` (timed, one per agent): `contacted` → agent `control`. Slot
  `inject`, replaced by `inject-guarded` when `guarded`.
* An agent's `control` connects its flows (`flow-connect`) and authenticates
  its `runs-as` accounts (`workload-identity`).
* `agent-shell` (logical): agent `control` + hosting `shell: true` → hosting
  host's `privilege` state. Without `shell`, controlling an agent does not
  control its machine.

A reader nothing can reach is harmless; neither kind is `incomplete` without
associations, except an agent without a host.

## 4. Data as a target

### 4.1 The data kind

New kind `data`: information worth protecting — a customer database, a
bucket, a secrets vault, model weights, a training set, a RAG corpus. States
`read` (confidentiality), `modified` (integrity; ransomware and deletion
count here) and the generated `plaintext`. Either `read` or `modified` can be
the scenario's target.

### 4.2 Holding

New association `holds: host | application | service | agent → data`, with a
required `privilege: user|admin` (software holds as `user`, as `stores` does)
and `decrypts: true|false`
required always (does this holder see plaintext? a database service does, the
disk beneath it does not). A missing `decrypts` is `incomplete`, never a
permissive default.

* `holder-modify` (logical): holder control (the host's `privilege` state, or
  `control`) → data `modified`.
* `holder-read` (logical): holder control, plus `plaintext` when `decrypts:
  false` → data `read`.

### 4.3 Access through an account

New association `accesses: account → data` with `mode: read|write`.

* `account-data` (logical): a session of the account on a service that holds
  the data + `accesses` → data `read` (subject to `plaintext` as in §4.2 when
  that holding says `decrypts: false`); with `mode: write` also `modified`.

A bucket reached with a stolen role is `workload-identity` → session on the
storage API service → `accesses` → `bucket.read`.

### 4.4 Encryption and poisoning

Data gains the switch `defenses.encrypted` and the association
`encrypted-with: data → credential` (the key; possession still requires
extraction or disclosure).

* `data-policy` (logical): input `input/policy/<data>/encrypted`, satisfied
  when `encrypted` is `false` → `plaintext`.
* `data-key` (logical): possession of any `encrypted-with` credential →
  `plaintext`.

Assumptions shown with these rules: encryption at rest does not stop software
that serves the data, and it does not stop modification. Client-side
encryption is a service holding with `decrypts: false`.

* `data-poisoning` (logical, amended by §10): data `modified` + `reads: application | service → data` → reader
  `contacted`. Poisoning what an agent reads leads through `inject` to its
  tools and identity.

No data rule is timed; exfiltration time stays outside the library, as the
lecture leaves it out.

## 5. Defense switches (§9)

A scenario change may name: product `patched` (formerly service `patched`),
credential `protected`, person `trained`, agent `guarded`, account `mfa`,
data `encrypted`, or a permission's `allowed`. Changes to a kind without that
switch are errors, as today.

## 6. Catalog, vocabulary and page

* Every new kind, association, state, slot, switch and rule enters the catalog
  with its word, meaning, title and assumptions (`states[].word`,
  `entities[].meaning`, `rules[].title`, `parameters[].name`), so the page
  shows no library id.
* The Add menu is hierarchical, grouped by the families the canvas colours:
  Network (network, router, firewall), Compute (host, application, service,
  agent, product), Identity (account, credential, person), Data (data, a new
  fourth family colour). A person gets the person icon; an account becomes an
  ID badge.
* New associations are drawn with the existing link interaction and named in
  plain language ("runs as", "may become", "knows", "uses", "reaches",
  "reads", "holds", "may access", "encrypted with", "is an instance of").
* The inspector edits the new fields (`shell`, `decrypts`, `mode`,
  `second-factor`) and switches like the existing ones.

## 7. Fixtures and tests

* `docs/course/lecture-architecture.yaml` and the format crate's lecture
  fixture gain a product for `sshd`; the `patch` scenario names it. Their
  generated graphs change only by the product steps; the lecture results stay
  explainable by the same routes.
* A new shipped example (amended by §10: its support agent is a service that
  processes content), `assets/examples/17-cloud-support-agent-architecture.yaml`
  (listed in the examples README and the course README), exercises every
  addition in one plausible estate: a support agent that reads a public ticket
  queue (`delivers: internet`), runs as a role that may assume a data-reader
  role; a customer bucket encrypted with a key held by a key service; an
  administrator who can be phished, with MFA and a bypass; a VM with a guest
  escape; two instances of one product. Its scenarios: `guardrails`, `mfa`,
  `training`, `patch`, `encrypt`.
* Tests per rule: generation fixtures for each new rule, the switch
  principle (graph identical under every switch value), cycle handling in
  `assumes` and nested hosting, validation errors and `incomplete` cases, and
  native/wasm agreement on the new example.

## 8. Delivery

Five branch-sized parts, each generated, solved, inspectable and accepted by
the owner in the browser before the next:

1. **virtualisation** — §2.1.
2. **products** — §2.2 (touches the lecture fixtures).
3. **identity** — §3.1–3.4: account states, MFA, workload identity, role
   assumption.
4. **operators** — §3.5: person and phishing (done). Content-processing
   software, §10, is its own part before data.
5. **data** — §4, and the cloud support agent example.

## 9. Outside this extension

Client-side exploits of applications; availability as its own state;
exfiltration duration; retries and lockout; trust-policy conditions; a
cloud-provider kind (a managed service is a service on a host standing for
the platform); attacker profiles (roadmap, `defense-comparison`).

## 10. Amendment (2026-09-24): content-processing software replaces the agent

The owner reviewed the operators part and chose the general form: an AI agent
is one case of software that processes untrusted content with real
permissions, as are a CI runner building outside pull requests, a mail
gateway opening attachments, a document converter and a chatbot calling
tools. The application is used in production, not only for teaching, so the
vocabulary models the pattern once instead of one kind per case. There is no
`agent` kind.

* **Content reaches software.** `delivers: network → person | application |
  service`. For software, `contacted` is a generated fact (not a declared
  state), as `reachable` is for a service.
* **Take-over through content** (timed, one per software that content can
  reach): software `contacted` → software `control`. New slots
  `take-over` and `take-over-guarded` on application and service; new switch
  `defenses.guarded` on both (input validation, sandboxing, guardrails, human
  approval of actions — the note says which). For an AI agent this is prompt
  injection; for a parser it is a malicious file. It is a property of the
  deployment, so it sits on the software, not on its product.
* **Contained software.** `hosts` gains `contained: true | false` for any
  executable. `contained: true` removes `execution-privilege` for that
  hosting: controlling the software does not control its machine (a
  sandboxed browser, a locked-down container, an agent without a shell).
  Absent means `false`, today's behaviour, so no existing file changes;
  canonical saves write only `contained: true`.
* **What the software reads.** `reads: application | service → data` (§4.4)
  and `data-poisoning` reach the reading software's `contacted`.
* **Which software processes content (owner, 2026-09-24).** Only software
  that content is said to reach: one that some `delivers` names (and, with
  §4, some `reads` names). Only such software gets the generated `contacted`
  fact and the take-over step; everything else generates exactly as before,
  so existing models keep their graphs and numbers. The slots and the
  `guarded` switch are materialised on every application and service, as
  `escape` is on every host; the inspector shows them only where content
  reaches the software.
* **A controlled service feeding its clients.** `content-from-service` extends
  to that software: control of a service that one of its own flows targets →
  its `contacted` (a compromised tool server, a poisoned retrieval service, a
  watering hole for a client).
* **Identity and flows unchanged.** A content-processing service that
  `runs-as` an account and has flows is what the spec's "agent" was: its
  control connects its flows and authenticates its identity through the
  existing rules.
* **Words.** The catalog names the step "Take over through content", the
  switch "Guarded", the setting "contained". §9's "client-side exploits of
  applications" is no longer outside the library: this step is how they are
  modelled.
* **Example 17** keeps its story; its support agent is a service that runs as
  a role, is delivered the public ticket queue, reads the help articles, and
  is hosted `contained: false` on the support VM. Its `guardrails` scenario
  switches `guarded` on that service.

