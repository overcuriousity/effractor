# effractor — nmap import

Date: 2026-09-24 · Status: design approved by the owner in conversation,
2026-09-24 (sections 1–3); written spec awaiting review

Amends [the lecture workflow design](2026-09-21-lecture-workflow-design.md)
§4 (vocabulary: two optional entity fields) and the architecture editor's Add
and context menus. Everything not named here stays as written there.

## 1. Purpose and principles

Drawing a real network by hand stops at a few hosts. The owner has shell access
on several machines; from each one nmap sees part of the network. The import
turns that into the model: place an nmap application on a host, run the
command the dialog shows there, paste the result, confirm a preview, and the
hosts, services, products and flows it saw are added. Repeating this from
other hosts builds the network as far as nmap can see it, and because each
flow starts at the nmap application that saw it, reachability from each
vantage point feeds the attack graph directly.

* **nmap sees the skeleton, not the identities.** Hosts, networks, services,
  products and reachability come from the scan. Accounts, credentials,
  permissions, firewalls and routers stay the author's; the import never
  guesses them.
* **Only ever add.** An import never changes or removes what the graph already
  holds, except filling an empty `addresses` on a host the author chose to
  merge with (§4.1). A service no longer seen stays until deleted by hand.
* **Assumptions are said.** What nmap cannot know and the model requires (the
  privilege a service runs at) is set pessimistically and marked as assumed.
* **Unknown stays unknown.** Every imported input is `unknown`; incomplete
  routes are `unfinished` and do not block the attack graph.
* **Local-first.** The scan runs on the owner's machines; the page reads the
  pasted text in the browser. Nothing is sent anywhere.

## 2. The file

Two optional fields, in place, no version change. Files and shared links
without them open unchanged.

### 2.1 `addresses`

On `host`: a list of IP addresses (IPv4 or IPv6). On `network`: a list of
CIDR ranges (`10.0.0.0/24`, `fd00::/64`). Any other kind carrying it, or a
value that does not parse, is an error at its path. The canonical writer
puts it after `description`, as a flow list; it is left out when empty. The
inspector shows it as one editable line, comma-separated. It is useful
without nmap: it is how the import recognises a host or network it has seen.

```yaml
  server:
    kind: host
    label: srv-01.lab
    addresses: [10.0.1.5]
```

### 2.2 `tool`

On `application` only, with the one value `nmap`. It marks the application
whose context menu offers *Paste nmap result…*. Any other kind or value is an
error at its path. It changes nothing in generation: an nmap application is
an application like any other, and taking over its host takes it over.

The scan text itself is not stored: it would bloat files and share links.
After an import the nmap application's description carries one line,
`Last nmap import: 2026-09-24, Standard scan of 10.0.1.0/24.`; the next import
replaces that line and keeps the rest of the description. The level and
targets are what nmap's own `args` say it ran; a command of the user's own
reads `scan of <targets>`, and no targets leaves out "of".

Real internal addresses end up in the file and in any link shared from it.
The dialog says so once, beside the range field.

## 3. The dialog

### 3.1 Getting there

* **Add → Application → nmap** (menu, `+`, context menu, Tab from a host)
  creates an application labelled `nmap` with `tool: nmap`; from a host it is
  hosted there at `user` by default. nmap runs as user or admin, and the
  author sets which on the hosts link like any other: `user` when it runs as
  a normal user (an attacker holding the host at either privilege can use its
  flows); `admin` when controlling it yields root, as a setuid nmap or a
  password-less `sudo nmap` does. The scan level never changes it: typing
  `sudo` for one Deep scan does not make the installed nmap a way to root.
  Plain *Application* stays as it is. A newly added nmap application opens the
  dialog.
* Right-click an nmap application → **Paste nmap result…**.
* The dialog is a `<dialog>` like Share and Help, titled `nmap on <host
  label>`, or `nmap (not on a host)`.

### 3.2 The command

**Scan level**, one choice, Standard preselected, each with one line saying
what it finds, whether it needs root and how long a /24 takes:

| Level | Command | Root | /24 | Finds |
|---|---|---|---|---|
| Discover | `nmap -sn -oX - <range>` | no | seconds | hosts |
| Standard | `nmap -sT -sV -oX - <range>` | no | minutes | + top 1000 TCP ports, services, products |
| Deep | `sudo nmap -sS -sU -sV -O --top-ports 1000 -oX - <range>` | yes | tens of minutes | + top 1000 UDP ports, OS guess |
| Complete | `sudo nmap -sS -sU -sV -O -p T:1-65535,U:1-1024 -oX - <range>` | yes | hours | + every TCP port, UDP 1–1024 |

**Range**: one text field, prefilled with the `addresses` of the networks the
nmap application's host is attached to (space-separated), else empty. The
command box is monospace, updates as the level or range changes, and has
**Copy**. `-oX -` writes XML to the terminal, so there is no file to fetch
from the remote host. A range with characters outside
`[0-9A-Za-z.:/,\- ]`, or a word starting with `-` (it would be an nmap
option), is refused with a note, so the copied command never carries shell
syntax or options.

nmap scans IPv6 only with `-6`, and then no IPv4: a range of IPv6 addresses
gets `-6` after `nmap`, a range mixing both is refused with a note (one scan
per kind), and an IPv6 prefix wider than /112 is noted as too wide to finish.
An empty range says what to give (amended after review, 2026-09-24).

If the nmap application is not on a host, the dialog says once: *nmap is
not on a host; the flows will have no route until you place it.*

### 3.3 The paste

A text area that also takes a dropped `.xml` file, and **Read**. When the
text does not read, the dialog keeps it and says why in one line:

* not XML: *This is not XML. The command writes XML with `-oX -`.*
* nmap's normal or grepable output: *This is nmap's normal output; run the
  command with `-oX -`.*
* XML but not nmap (`<nmaprun>` missing): *This is not an nmap result.*
* nmap reported an error (`<runstats><finished exit="error">`): *nmap stopped:
  <its errormsg>.*
* no host up: *No host answered. Check the range, or try from another host.*

* the text is cut off at either end (a partial copy, an interrupted run):
  *The result is cut off; copy the whole output, from `<?xml` to
  `</nmaprun>`.* Text before `<?xml` or `<nmaprun>` (a shell prompt, sudo's
  password line) is skipped.

Only `<host>` elements count; nmap also prints each address in a
`<hosthint>`, which is not a second host. A host nmap lists twice (the
range named it twice, as an address and a name) is one host with each port
once. A result without `-sV` (no service
names) is read; ports then get `tcp/…` labels and unidentified products.

### 3.4 The preview

Read replaces the paste with the preview; **Back** returns to the text.

* One row per host that is up, with a checkbox, its label and addresses,
  and a state: **known as "Server"**, or **new ▾**. The menu lists the hosts
  without `addresses`; choosing one merges the scanned host into it (§4.1). A drawn host one row has taken is not offered to the others.
* Under a host, one row per open port with a checkbox:
  `ssh · tcp/22 · OpenSSH 9.6p1`, marked *known* (adds nothing, not
  selectable) or saying what ticking adds (service, product, flow).
  Unticking a host unticks its ports.
* A network row when §4.2 proposes a new network.
* One line of notes, only when they apply: *Services are assumed to run as
  admin.* · *12 UDP ports gave no answer (open|filtered); not added.*
* Summary and actions: *Adds 4 hosts, 11 services, 6 products, 11 flows.*
  When the ticked rows would take the document past the library's limits
  (500 components; 2000 associations and flows), the summary says by how
  much and Add stays disabled until enough is unticked.
  **Add** · **Cancel**. Add is one edit: one undo removes the whole import.
  Afterwards the canvas selects the nmap application.

## 4. Mapping

`nmap.js` reads the XML into a scan, plans against the document and the
preview's choices, and applies the plan as one pure edit (the contract of
`architecture-edit.js`: document in, `{doc, select}` out; wasm validates on
serialisation). Ids come from labels as for any new component.

### 4.1 Hosts

A host with `<status state="up">` is **known** when one of its addresses
(`addrtype` ipv4 or ipv6; MAC ignored) is in an existing host's
`addresses`. Otherwise it is **new**: labelled with its first `<hostname>`,
else its address; `addresses` are its IP addresses. Deep and Complete add
nmap's best OS match to its description: `nmap OS guess: Linux 5.4 (96%).`

**Merge** (the *new ▾* choice): the scanned host becomes that existing host,
whose empty `addresses` are filled, and which is attached as §4.2 says; nothing
else on it changes. This is how a hand-drawn host, including the one nmap runs
on, is recognised from then on.

**nmap's own host** (owner, 2026-09-24): when the host nmap runs on has no
`addresses`, the preview preselects the merge into it for the scanned host
nmap marks as itself (`reason="localhost-response"`, root scans only) or,
failing that, the one whose first `<hostname>` is its label or starts with its
label and a dot (`altiera.fritz.box` for "altiera"). The row says *nmap runs
here?*; choosing *new* keeps it new. Without root nmap marks nothing, so the
name is the only sign.

### 4.2 Networks

Every scanned host, new, known or merged, is attached to every network whose
`addresses` contain one of its addresses and that it is not attached to yet:
an address in a network's range is an interface in it (owner, 2026-09-24).
When no network holds it and the dialog's range is one CIDR, the preview
proposes one new network, written from its own address (`192.168.2.138/24`
proposes `192.168.2.0/24`), and hosts in it are attached to it. Otherwise
they stay where they are. The summary counts these attachments. A flow's
route is the first network nmap's host and the target share after the
import; when nmap's host is left unticked, its flows have no route.

### 4.3 Services and products

Each port with `<state state="open">` is a candidate; `open|filtered`,
`filtered` and `closed` are not (UDP ones are counted for the note). On a
known or merged host the port is **known** when a service that host hosts is
already the target of a flow with the same protocol string; a known port adds
only a missing flow (§4.4). A service drawn without a flow is not recognised
and shows as new; the author unticks it.

A new service is labelled with nmap's `<service name>`, else `tcp/8443`. It
is hosted by its host at **admin**, the pessimistic assumption, with the
association's description *Privilege assumed by the nmap import.*

Every new service gets a product, linked `instance-of`: a service without
one is `incomplete`, which would block the attack graph. When
`<service product>` is present the product is labelled `product` plus
` version` when present (`OpenSSH 9.6p1`); an existing product with exactly
that label is reused, so one product switch covers every host running it.
When nmap names none, the product is `unidentified <service label> on <host
label>`, one per service and never reused: unknown software on two hosts is
not known to be the same software.

### 4.4 Flows

One per imported or known port that this nmap application has no flow to yet
with that protocol: source the nmap application, target the service,
`protocol: tcp/22` or `udp/53`, label `<service label> on <host label>`,
`connect` unknown. The route is `[network]` when the nmap application's host
and the target host share a network (the first such, in document order);
otherwise it is empty and the flow is `unfinished`, completed in the route
editor.

## 5. Units and tests

* `effractor-core`, `effractor-format`: `addresses` and `tool` — model,
  validation, reader, canonical writer; test-first, with round-trip fixtures
  and error paths. Existing fixtures and shared links unchanged.
* `assets/js/nmap.js` (pure, Node-tested): `command(level, range)`,
  `read(text) → scan | {problem}` with a small XML reader of its own (Node
  has no DOMParser; nmap's XML is regular), `plan(doc, appId, scan, range)`,
  `apply(doc, appId, plan, choices)`. Fixtures under
  `scripts/fixtures/nmap/` are real nmap output: each level, a UDP scan,
  normal output, an error run, no host up, a scan without `-sV`. Tests cover
  the commands and range refusal, reading states, services, products and OS
  guesses, and planning: matching by address, merge, CIDR attachment and the
  proposed network, product reuse, known ports and flows, routes. One test
  serialises an applied document through wasm.
* Everything read from a scan is untrusted text (a PTR name is whatever its
  DNS says): the dialog and canvas set it as text, never as markup.
* `assets/js/nmap-ui.js`: the dialog and preview; menu entries in
  `architecture-ui.js`; the inspector's `addresses` line. Checked by the
  owner's eye in a preview.

## 6. Not in this item

NSE scripts (vulnerability detection and the like) are the roadmap item
`nmap-scripts`. Routers from `--traceroute`, firewall rules from
filtered/closed differences, and inventory from commands run on a host
(`ss`, `ip`) are not planned.
