# nmap recipes, identity, routes and rescans

Date: 2026-09-27 · Status: design approved by the owner in conversation,
2026-09-27; written spec awaiting the owner's review.

Builds on the nmap import (spec deleted, read it from history — see
`docs/HANDOFF.md`; its last amendment is in `ec9dd1e`) and the nmap checks
(`docs/HANDOFF.md`, "Continuation — nmap checks"). One branch, one PR.

## 1. Purpose and boundary

The owner wants to use more of nmap than four levels and a Checks choice, and
uses effractor for blue teaming: a network is scanned on day 1 and again on
day 10, and the drawing should follow what changed. Four parts:

1. **Recipes** (§2): scans named by purpose, combinable into one command, with
   the building blocks behind them in an *Adjust* fold.
2. **Identity** (§3): a machine is recognised by its MAC first, then its SSH
   host key, then its address, then its name; the file keeps what identified it.
3. **Routes** (§4): traceroute hops become routers and the networks between
   them, up to the last private address.
4. **Changes** (§5): a rescan lists what differs from the drawing, each with
   an offered action, including a check of the drawing's firewall permissions.

Owner decisions, 2026-09-27, in the order given:

- MAC addresses are crucial to identify machines. **The MAC is the identity**:
  a scanned host whose MAC is on a drawn host is that host, at any address.
- **Recipes with the blocks behind them** (not levels, not blocks alone), and
  **several recipes combined into one command**.
- **Every traceroute hop becomes a router**, joined by networks without
  addresses; the route **stops at the last private address**.
- Identities in **one `identities` list** on a host; the preview **offers
  renaming** a host still labelled by its address.
- A **Changes since …** section with **unticked** actions.
- Reader hardening beyond what these scans bring — interrupted scans,
  grepable or normal output, file drops, very large scans — is **not wanted**
  now. The reader keeps refusing what it refuses today.
- A **firewall recipe** is included, on the terms of §2.3 and §5.3.
- The *missed* ring (§5.2) is approved.

Kept as they are: no third party is ever asked (`not external` on every script
selection; nothing here names a script that contacts one); adults are offered
dangerous options with a warning, not filtered; files with `tool: nmap` keep
opening unchanged. Options whose purpose is to avoid being noticed (decoys,
spoofed sources, fragmentation) are not offered: they add nothing to a map of
one's own network.

## 2. Recipes and blocks

`LEVELS` and `CHECKS` give way to **BLOCKS** and **RECIPES** in
`nmap-command.js` (§6).

### 2.1 Blocks

Each block is one choice; the *Adjust* fold (closed by default) shows all of
them with the values the ticked recipes set, and any can be changed.

| Block | Choices (arguments) | Root |
|---|---|---|
| Discovery | ping (none) · ARP on this LAN `-PR` · don't ping `-Pn` · names only `-sL` | ARP |
| Ports | none `-sn` · top 100 `--top-ports 100` · top 1000 (default) · every TCP `-p-` · a list `-p <list>` | — |
| TCP scan | connect `-sT` · SYN `-sS` | SYN |
| UDP | off · top 100 · top 1000 (`-sU`, UDP ports with `U:` in a combined `-p`) | yes |
| Depth | open ports only · versions `-sV` · versions + OS `-sV -O` | OS |
| Identity | off · on `--script ssh-hostkey,ssl-cert,nbstat,smb-os-discovery` | nbstat's UDP 137 |
| Route | off · on `--traceroute` | yes |
| Reasons | off · on `--reason` | — |
| Checks | none · safe · all (unchanged scripts and warning; not with Ports = none) | — |
| Pace | polite `-T2` · normal (none) · fast `-T4` | — |

A port list accepts numbers, ranges and `T:`/`U:` prefixes only. The range
field and its checks (§3.2 of the import spec: no word starting with `-`,
IPv4 and IPv6 apart, the /112 note, `-6`) are unchanged. `-oX -` stays last,
before the targets, as the reader's `targetsOf` expects.

Scripts from Identity and Checks go into one `--script` expression:
`(ssh-hostkey or ssl-cert or nbstat or smb-os-discovery) or (vuln and safe and
not external)`. Identity needs tcp/22, tcp/443, tcp/445 and udp/137: nmap's
top 100 TCP ports hold the three TCP ones and its top 100 UDP ports hold 137,
so Identity raises Ports to at least top 100 and UDP to at least top 100 (and
so needs root); with a port list, its ports are appended to the list instead
(nmap does not take `--top-ports` and `-p` together).

### 2.2 Recipes

Each recipe is a name, one plain line (what it finds · root or not · time for
a /24) and the block choices it sets.

| Recipe | Sets | Finds |
|---|---|---|
| Who is on this LAN | Discovery ARP, Ports none | hosts, MAC, vendor |
| Names only | Discovery names only | names from DNS; sends nothing to the targets |
| What runs there | Ports top 1000, Depth versions | ports, services, products (today's Standard; Deep and Complete are its *Adjust* settings) |
| Who it really is | Identity on | SSH keys, NetBIOS names, MAC across routers, certificate names |
| Map the route | Route on | routers and networks on the way |
| What a firewall passes | TCP SYN, Reasons on, Route on, Ports from the drawing (§2.3) | what gets through each firewall on the way |
| Check for known weaknesses | Checks safe, Depth versions | findings (today's Checks) |

**Combining.** Ticked recipes are merged block by block; the stronger choice
wins, in each block's order above (Ports: a list and top N merge into a list
holding both; any ports beat none). Root is needed if any choice needs it
(then `sudo`, as today). **Names only** sends no packets and does not combine:
ticking it unticks the others, and its line says why. Nothing ticked shows the
problem *Choose what the scan is for.*

The dialog remembers the ticked recipes and *Adjust* overrides for the session
only, as it remembers the level today. Nothing about a scan's choices is
stored in the document.

### 2.3 The firewall recipe's ports

Ports are taken **from the drawing**: every protocol/port of every flow whose
route crosses a router with a firewall and whose target host has an address
in the range — plus the top 100. When the drawing gives none, the top 1000.
An *Adjust* choice offers the **ACK scan** (`-sA`, root) as a second command
shown below the first: nmap runs one TCP scan type per run, so it is a second
paste, read like any other (its `unfiltered` / `filtered` states feed §5.3).

## 3. Identity

### 3.1 In the file

Hosts gain four optional fields, in place, no version change:

- `identities`: strings `type:value`, unique within a host, in the order
  found. Types now: `mac:` (lowercase, colon-separated) and `ssh-<keytype>:`
  (`ssh-ed25519:`, `ssh-rsa:`, `ecdsa-sha2-nistp256:` as nmap names the type,
  value nmap's fingerprint as written). A later type needs no format change.
- `vendor`: the vendor nmap names for the MAC.
- `seen`: `YYYY-MM-DD`, the start date of the last scan that saw the host.
- `missed`: `YYYY-MM-DD`, set by the *missed* action (§5.2), removed when a
  scan sees the host again.

Only on hosts (a router's box is a host). The validator refuses another kind
carrying them, an identity without `type:` and a value, a duplicate within one
host, and a date not in that form. It **allows** two hosts to share an
identity: cloned VMs and failover pairs share MACs, and such a file must open;
the preview flags it (§3.3). Generation and results never read these fields
(as with `clusters`). The wasm module must be rebuilt for a page to read them.

**Certificates are not an identity**: a wildcard or load-balanced certificate
is on many machines. A certificate's CN and SANs are names only (§3.4).

### 3.2 Reading

- `<address addrtype="mac" addr vendor>`: `mac:` and `vendor`. nmap writes a
  MAC only for hosts on its own segment, so every MAC it writes is kept.
- `ssh-hostkey`: one `ssh-<type>:` per key table (`type`, `fingerprint`).
- `nbstat`: the NetBIOS name and the MAC in its output; the all-zero MAC
  (Samba) is ignored.
- `smb-os-discovery`: NetBIOS computer name, FQDN, domain.
- `ssl-cert`: subject CN and DNS SANs.
- Every `<hostname>` (not only the first), with its `type` (`user`, `PTR`).
- These four scripts are identity scripts: they are read here and never shown
  as *not read* in the checks' lines.

### 3.3 Matching

For each scanned host, in order: **MAC → SSH key → address → name** (the name
rule of nmap's own host — `self`, `sameName` — now for every host, and only
for drawn hosts without addresses, as today).

- **Identity beats address.** A scanned host whose MAC is on drawn host A and
  whose address is on drawn host B is A. Its row says *“A” moved from 10.0.1.5
  to 10.0.1.9* and offers, ticked, to update A's addresses, and, unticked, to
  remove 10.0.1.9 from B.
- **Shared identity.** When the matched identity is on two drawn hosts, the
  row is not matched; it says *two drawn hosts share this MAC* and offers the
  existing *merge into…* choice.
- **New identities** of a matched host are added to it, ticked.
- An identity of a type the drawn host has with another value, at the same
  address, is a change (§5.1), not a match.

The fold of listings in the reader (`fold`) also joins listings that share a
MAC.

### 3.4 Names and renaming

A host's best name: the DNS name nmap reports (`user`, then `PTR`), then the
NetBIOS name, then the certificate CN or first SAN. A new host is labelled by
it, as by the hostname today. A **rename** is offered, ticked, only for a
drawn host whose label is one of its addresses: *rename “10.0.1.9” →
“fileserver” (NetBIOS)*. A label the author gave is never offered for
replacement.

### 3.5 Inspector

One *Identity* row on a host: the MAC with its vendor, the SSH key types,
*seen 2026-09-27*, and *missed since …* when set. Quiet: absent when there is
nothing.

## 4. Routes

### 4.1 Reading

Each host's `<trace>`: its hops in `ttl` order, each an address (and name) or
a gap (no address). Before fixtures are pinned, a real `--traceroute` XML is
checked for whether nmap writes every hop for every host; if it abbreviates
shared hops, the reader fills them from the host it names.

### 4.2 The private cut

A route is cut before its first hop outside private space: 10/8, 172.16/12,
192.168/16, 100.64/10, 169.254/16, fc00::/7, fe80::/10. The host's row says
*…then 7 hops on the internet*. A public target is still offered as today;
only its route is text.

### 4.3 Hops become routers

- One row per hop address, shared by every target behind it: *router at
  10.0.0.1, on the way to 14 hosts*, ticked.
- A hop already drawn — by identity or by address — is reused. A hop that is
  also a scanned host (hop 1 on the LAN) is that host's row, which takes the
  router role.
- New ones are drawn as the router role draws today: a host running a router,
  labelled with the hop's name, else its address.
- The last hop is the target itself and is not a router.

### 4.4 Networks between hops

Router *i* to router *i+1*:

1. A drawn network whose range holds hop *i+1*'s address is the link (the
   interface the probe entered by); router *i* is attached to it.
2. Else a network both are already attached to.
3. Else a new network without addresses: *between 10.0.0.1 and 172.16.0.1*;
   across a gap *between 10.0.0.1 and 172.16.4.1 (1 hop unseen)*. The same
   pair of hops makes one network, whichever targets lie behind it.

Hop 1 is attached to nmap's network (the network whose range holds it, else
the proposed one, by today's rule); the last router to the target's network.
A later scan fills an address-less link network through the existing *same
as “…”* choice.

### 4.5 Flow routes

The flows nmap adds take the whole way: `[nmap's network, r1, link, r2, …,
target network]` (a route alternates network and router). Without a trace,
as today: `[the shared network]` or none.

### 4.6 Layout

Routers and link networks are gathered as their own blocks by the import's
clustering; a drawing nobody arranged by hand is arranged outward from nmap's
network.

## 5. Changes since the last scan

### 5.1 Coverage

A scan speaks only for what it looked at:

- **Hosts:** the targets in nmap's `args` — addresses, CIDR, nmap's octet
  ranges (`10.0.1-5.1-254`); a name covers only the host it names. A drawn
  host is covered when one of its addresses is.
- **Ports:** the ports nmap lists per protocol in `<scaninfo services>`.
- **Date:** `<nmaprun start>` as `YYYY-MM-DD`. Several runs: the latest.

### 5.2 Lines and actions

A **Changes since …** section above the additions, grouped by host, each line
in plain words with an **unticked** action; unticked changes nothing. "Since"
names the covered hosts' latest `seen`, or is left out when none has one.

| Seen | Line | Action |
|---|---|---|
| a drawn service's port, covered, closed / filtered / not listed | *tcp/3306 on “db1” is closed now* | remove the service (the existing remove: its flows and their permissions go) |
| a drawn host, covered, not answering | *“db1” did not answer (seen 2026-09-17)* | mark as missed: `missed` = the scan date |
| a product version changed | *ssh on “db1”: OpenSSH 8.9 → 9.6* | point the service at the new product; the old one goes when nothing else is an instance of it and its author set nothing on it; this scan's findings go to the new one |
| same address, a different MAC or SSH key than the drawn host has of that type | ⚠ *10.0.1.5 answers with a different MAC than “db1” — reinstalled, new hardware, or another machine?* | *new host* (the address leaves “db1”) or *same host, update identity*; unticked, the scanned host is left out |
| the way to a host crosses a router not on its drawn flows' routes | *the way to “db1” now crosses 10.0.9.1* | add the router and link (§4) and re-route nmap's flows to it; old ones stay |

Every host the scan saw gets `seen` = the scan date and loses `missed`,
ticked. The apply stays one edit (Ctrl+Z undoes it all).

**Missed ring:** a host with `missed` is drawn with a grey dashed ring, *not
seen since 2026-09-27*, beside the vulnerable and exposed rings, with its
entry in the bottom bar's legend and a closed cluster's sectors.

### 5.3 Firewall permissions

From a scan with Reasons on and a trace. For each flow whose source is nmap's
host (or a host on nmap's network with no router between) and whose route
crosses a router with a firewall, the flow's port on its target, if covered:

| Drawing | Scan | Line | Action |
|---|---|---|---|
| allowed | filtered | *the firewall on “r1” blocks tcp/443 to “web”* | set the permission to denied |
| denied | open or closed | ⚠ *the firewall on “r1” lets tcp/3389 through to “db1”* | set it to allowed |
| no permission | — | *“r1”'s firewall has no permission for tcp/443 to “web”; the scan says it is let through / blocked* | give it one |
| — | open through a firewalled router, no flow drawn | *unplanned opening: tcp/8080 on “app” through “r1”* | add the flow (§4.5) with an allowed permission |
| — | filtered, no service on the host | *blocked here: tcp/445 on “db1”* | none: text only (roadmap, §7) |

Flows from other sources: *can't tell from here*, once per flow, only when
the firewall recipe ran. An ACK scan's `unfiltered` says no stateful filter
sits on the way for that port; `filtered` says one does. They are shown on
the same lines, not acted on alone.

A port filtered on nmap's own network (no router crossed) is the host's own
filtering: shown as *filtered by “db1” itself*, text only (roadmap, §7).

## 6. Code

| File | Holds |
|---|---|
| `assets/js/nmap-command.js` | BLOCKS, RECIPES, combining, the command(s), range and port-list checks, the firewall recipe's ports |
| `assets/js/nmap.js` | reading: parser, hosts, identities, names, trace, scaninfo, reasons, script findings |
| `assets/js/nmap-plan.js` | matching, rows, networks, renames, the apply |
| `assets/js/nmap-route.js` | hops, the private cut, routers, link networks, flow routes |
| `assets/js/nmap-changes.js` | coverage, the Changes lines and actions, firewall permissions |
| `assets/js/nmap-ui.js` | recipe ticks, the *Adjust* fold, the Changes section |

All pure except `nmap-ui.js`, in the existing node/window pattern.
`window.effractorNmap` keeps its present names (re-exported), so its callers
do not change. Rust: `effractor-core` host fields and validation,
`effractor-format` read/write and `tests/json.rs`. `architecture-view.js`:
the missed ring. The inspector's Identity row.

## 7. Roadmap

Added: **firewall-denies** — a firewall's denial toward a host or port with no
service, and filtering by a host itself; both change the model beyond nmap
(generation reads them). `scanner-readers` shrinks: nmap's reading and
planning are already apart after this.

## 8. Tests and landing

TDD in `scripts/nmap*.test.js`. Fixtures in nmap's exact shape, replaced by
the owner's real output where it differs:

- `lan-arp.xml` — MACs, vendors; an all-zero nbstat MAC
- `identity.xml` — ssh-hostkey, ssl-cert with SANs, nbstat, smb-os-discovery
- `route.xml` — three private hops, a gap, public hops after
- `firewall.xml` — reasons (no-response, admin-prohibited, reset); open,
  closed, filtered; an ACK scan
- `day1.xml`, `day10.xml` — a moved MAC, a closed port, a version change, a
  silent host, a changed SSH key, a changed route
- `imported-*.doc.json` for the new fields, pinned in Node, `tests/json.rs`
  and `check-nmap-wasm.js`

Every existing nmap fixture reads and plans exactly as before. Commits in
order: format → reader → commands → matching → routes → changes → UI; each
UI step shown to the owner in the preview before it lands. One PR, CI green
for its exact commit, fast-forwarded, signed.
