# Course walkthrough

Use the [reference fault tree](reference-fault-tree.yaml), the
[office attack tree](office-attack-tree.yaml) and the three architecture files
of the [SSH exercise](#ssh-server-behind-a-router) as downloadable YAML files.
They are documentation fixtures, not bundled into the app or loaded on startup.
Open a file from the model-name menu or with Ctrl+O.

## Reference fault tree

The web server is unavailable if access or function is lost. The server-outage
leaf appears under both branches but is one event, sampled once. All rates use
hours; the horizon is 8,760 hours. The top event carries availability loss and
the redundant-power control changes the hardware failure rate.

1. Build the outline with Tab (child), Enter (sibling), F2 (rename), and G
   (gate). Use L to link the existing server-outage leaf under the other branch.
   P opens properties; Esc returns to the canvas. Enter or Space opens More when focused. The `?` button lists keys.
2. Fill in the leaf probabilities/rates from the file. Calculate (Ctrl+Enter;
   the page also recalculates after each change). Compare exact and
   sampled P(top), inspect minimal cut sets, and select a cut-set row.
3. Open the Time tab. Compare the solid exact curve with the dashed sampled curve and
   pointwise confidence band. Hover, use Left/Right on the focused plot, or open
   Table for the values.
4. Open Loss. Read the percentiles and exceedance table. The model represents
   at most one occurrence per horizon; it does not estimate recurring annual
   event frequency.
5. Toggle the redundant-power control. Compare its risk delta and rank. Undo
   restores the prior model state and recalculates; a sampled run that took
   more than two seconds is repeated only on Calculate.

## Office attack tree

The top event can follow account takeover or physical access. Account takeover
requires phishing and MFA bypass; physical access is a 2-of-3 vote gate. Leaves
have attacker cost, detection probability and TTC. The file includes losses
for confidentiality and integrity plus a control scenario.

1. Build the gates with the keyboard, then enter the file's leaf attributes.
   A shared event can be added with L without duplicating its random variable.
2. Calculate and open Pareto. The cheapest path is pinned. Sort by cost, time,
   detection or success. Mean time shows the model unit and assumes all steps succeed;
   an infinite expected time is shown as ∞.
3. Switch the scatter axes. Diamonds mark the front and dots the dominated
   paths; nonfinite points are excluded only from axes that cannot plot them.
   Select a point or row to highlight its graph path. Select a graph leaf to
   mark its matching rows and points.
4. Toggle the control and compare the new risk and path results.

## SSH server behind a router

An architecture, not a tree: you draw what is there, and the attack graph is
built from it. The exercise follows the lecture's sections 5.3–5.5.

| File | What it is |
|---|---|
| [lecture-architecture.yaml](lecture-architecture.yaml) | The exercise. Defences that stop an attacker outright. |
| [lecture-partial-defenses.yaml](lecture-partial-defenses.yaml) | The same, with defences that slow an attacker down instead. |
| [lecture-unknown.yaml](lecture-unknown.yaml) | The same, with the time to find an exploit left unknown. |

The three differ in nothing else: same components, same seed (42), same
10,000 samples, days as the time unit, a horizon of 100 days.

### What is drawn

Three networks: Client, Server and Administration. A router joins the client
and the server network and has a firewall. The workstation is in the client
network and runs an SSH client as a user. The server is in the server network
and runs the SSH server (OpenSSH) as admin. One flow, SSH over tcp/22, goes
from the client through the router to the server, and the firewall permits it.

The workstation keeps two keys. The server account's key is readable by a
user; it logs in to the SSH server, and that account has admin control of the
server. The router administrator's key is readable by an admin only; that
account has admin control of the router, which is managed from the
Administration network. Nothing is attached to the Administration network.

The attacker starts with admin control of the workstation. The target is
admin control of the server.

### Build it from empty

1. Choose the Architecture mode (3) and *New* in the menu under the
   document's name. **A** adds a component; add the three networks, the
   router, its firewall, the two hosts, the SSH client (an application), the
   SSH server (a service), OpenSSH (a product), the two accounts and the two
   keys (credentials).
2. Link them with **L**, or add a component already linked to the selected
   one with **Tab**. The table below lists every relationship. Add the flow
   from the SSH client to the SSH server and select it: in its form, lead
   its route over the client network, the router and the server network, and
   set the firewall's entry to *Allowed*.
3. Drag *Foothold* onto the workstation and *Target* onto the server, both
   with admin control.
4. Open *Attack graph* (G). Two ways lead to the target: finding and using an
   exploit for the SSH server, and extracting the server account's key and
   logging in. Select a step to see the rule that made it and where in the
   drawing its time is set.
5. Set the switches to *Off*: *Patched* on OpenSSH, *Protected* on both
   keys, *Multi-factor login* on both accounts. A new component has its
   switch at *Unknown*, and the target has no number while one that matters
   is. Fill in the times from the table further down, each with Confidence
   *Illustrative* and its note as Reason. Or open the file, which has all of
   it. Calculate, and read the Time tab.
6. In Compare, **+** adds a scenario; name it, and set what it changes with
   *Set a defence or a permission*. Make four: *Patched* on for OpenSSH;
   *Protected* on for the server account's key; both; and the firewall's
   permission for the SSH flow denied. The file has them as *Patch the SSH
   server*, *Protect the stored key*, *Patch and protect* and *Deny SSH at
   the router*. Choose one and read which paths it blocks and which remain;
   *nothing · baseline only* shows the baseline alone again. Undo takes back
   an edit to a scenario, not the choice of one.
7. Set the Confidence of the time to find an exploit to *Unknown*: the
   target has no number until it is set again, and the path is still drawn.

| Select | In the Link menu | Choose |
|---|---|---|
| Workstation, then Router | connected to | Client network |
| Server, then Router | connected to | Server network |
| Workstation | runs here as user | SSH client |
| Server | runs here as admin | SSH server |
| SSH server | is a version of | OpenSSH |
| Router | its firewall | Firewall |
| Administration network | managed from here | Router |
| Workstation | kept here, user-readable | Server account key |
| Workstation | kept here, admin-only | Router administrator key |
| Server account key | unlocks | Server account |
| Router administrator key | unlocks | Router administrator |
| Server account | accepts this account | SSH server |
| Server account | grants it admin | Server |
| Router administrator | grants it admin | Router |

Selected from the other end, the menu words the same relationship from
there: *runs this as user* on the SSH client, then the workstation. What the
firewall permits is not a link: it is set in the flow's form.

### The times, and what each one sets

Every time is an **exercise assumption**, marked *illustrative* in the file,
with its note. None is measured, none is calibrated to the lecture, and the
component library installs none of them. `Exponential(mean 10)` is a waiting
time that averages 10 days; `Never` is a step that cannot be taken.

| On | Time | Exercise | Partial defences | The step it times |
|---|---|---|---|---|
| SSH flow | Connect | `Exponential(mean 0.5)` | the same | Connect along the flow |
| OpenSSH | Find an exploit | `Exponential(mean 10)` | the same | Find an exploit |
| OpenSSH | Find an exploit (patched) | `Never` | `Exponential(mean 100)` | Find an exploit, while *Patched* is on |
| SSH server | Use the exploit | `Exponential(mean 2)` | the same | Use the exploit |
| SSH server | Log in | `Exponential(mean 1)` | the same | Log in to a service |
| Both keys | Extract | `Exponential(mean 5)` | the same | Extract a credential |
| Both keys | Extract (protected) | `Never` | `Exponential(mean 50)` | Extract a credential, while *Protected* is on |
| Router administrator | Admin login | `Exponential(mean 1)` | the same | Admin login from a network |

Using the exploit includes getting past whatever detection the server has;
that is not modelled as a step of its own. Times left *unknown* in the files
cost no number. Escaping to a host, taking software over through content and
the server account's admin login belong to steps this drawing does not have.
Getting past multi-factor login is a step on the login path, and is not
needed: multi-factor login is off, so a key alone logs in.

### What to read from it

With seed 42 and 10,000 samples, the share of attackers who have admin
control of the server by that day:

| File | Scenario | 12.5 d | 25 d | 50 d | 100 d |
|---|---|---|---|---|---|
| `lecture-architecture.yaml` | `baseline` | 0.9633 | 0.999 | 1 | 1 |
| `lecture-architecture.yaml` | `patch` | 0.904 | 0.9918 | 1 | 1 |
| `lecture-architecture.yaml` | `protect` | 0.625 | 0.8927 | 0.992 | 0.9998 |
| `lecture-architecture.yaml` | `both` | 0 | 0 | 0 | 0 |
| `lecture-partial-defenses.yaml` | `baseline` | 0.9633 | 0.999 | 1 | 1 |
| `lecture-partial-defenses.yaml` | `patch` | 0.9119 | 0.9932 | 1 | 1 |
| `lecture-partial-defenses.yaml` | `protect` | 0.707 | 0.9338 | 0.9965 | 1 |
| `lecture-partial-defenses.yaml` | `both` | 0.2907 | 0.5147 | 0.7711 | 0.9512 |

`deny` is 0 throughout in both files. These are what this release computes
from these inputs, held by a test; they are not the lecture's numbers.

- **One defence alone changes little by day 100.** Patching leaves the login
  path, protecting the key leaves the exploit. The curve moves, its end
  hardly: read the Time tab, not only the number at the horizon.
- **A perfect defence and a partial one.** `Never` closes a path, and with
  both defences on nothing is left. Perfect blocking is an assumption of the
  exercise, not a property of patching. The partial file says the same
  defences make a step ten times slower: every path stays open, and 95 of 100
  attackers are through by day 100.
- **Full foothold, user software.** The attacker holds the workstation as
  admin, which includes what a user can do, so both keys can be extracted and
  the SSH client is theirs. The SSH client still runs as a user: controlling
  it alone would give user control of the workstation and never admin. The
  SSH server runs as admin, so controlling it is admin control of the server.
- **The Administration network is isolated.** The attacker can extract the
  router administrator's key, and it is of no use: logging in to the router's
  management needs access to the network that manages it, and nothing leads
  there. That is why denying SSH at the router closes both paths. Put a
  second foothold on the Administration network and the denial no longer
  holds: a router's admin lets the flow through.
- **Nothing is allowed by being near.** Being in a network permits no
  connection. Only a drawn flow connects, and only where every firewall on
  its route allows it.
- **Unknown is not zero and not never.** In the unknown file the target has
  no number, the missing input is named, and the path is drawn. With *Patch
  the SSH server* chosen there is a number again: the unknown time is on a
  path the patch closes. An unknown on a path that is blocked costs nothing.
- **The curve and its band.** The curve is the share of all sampled
  attackers who reached the target by each day, those who never do included;
  it is not rescaled to the ones who succeed. The band is the sampling
  uncertainty of that share at each day, at 95%: it says how far 10,000
  samples may be off, not how good the inputs are. A difference in Compare
  is measured on the same draws for both sides.

### What it does not say

No vulnerability database stands behind *Find an exploit*: the time is what
its author writes. The library is small on purpose: a host or an application
has no product of its own, so the lecture's operating systems (Windows 7,
Ubuntu Linux) and *putty* are not drawn and have no exploit route; a host has
no defence switch; retries, account lockout, detection and response are
outside it. The numbers are not expected
to match the lecture's screenshots, whose rules and inputs are not published
with them. Existing securiCAD or MAL models are not read.

The [acceptance record](../LECTURE-ACCEPTANCE.md) says what was checked, on
which release.

## Timing

The top-bar Horizon button edits the analysis window in the document's time
unit. A horizon edit is undoable; results for the old window stay, faded,
until they are recalculated for the new one, which happens by itself.

The TTC picker explains its presets and retains custom expressions:

| Preset | Written | Meaning |
|---|---|---|
| Easy | `Exponential(mean 1)` | Exponential waiting time, mean 1 model time unit |
| Hard | `Exponential(mean 10)` | Exponential waiting time, mean 10 units |
| Very hard | `Exponential(mean 100)` | Exponential waiting time, mean 100 units |
| Easy · 50% chance | `50%` | 50% immediate success; otherwise never |
| Hard · 50% chance | `50% * Exponential(mean 10)` | 50% eventual success; mean 10 units if successful |
| Very hard · 50% chance | `50% * Exponential(mean 100)` | 50% eventual success; mean 100 units if successful |
| Never | `Never` | Never occurs; blocks a step |
| Immediate | `Immediate` | Immediate occurrence |

“Certain” means eventual success, not success within every finite horizon.
Control effects replace a leaf's TTC while the control is enabled; the same
preset meanings apply there.

## Sharing and installation

Share creates an encrypted immutable snapshot. Open the link in another browser
profile, edit the resulting local copy, and reload to verify it persists. In the
originating profile, My shares → Delete offers an eight-second Undo window.
After deletion, reopening the link reports that it is unavailable.

Links use the address at which the app was opened. A localhost link only works
on that machine; external recipients need a reachable HTTPS instance.

Use the [README installer](../../README.md#install) on a fresh Linux machine.
Run the installed binary, open its localhost URL, and repeat the walkthrough
against that release. The [acceptance record](../V1-ACCEPTANCE.md) distinguishes
the completed browser walkthrough, installation scope and measured results.
