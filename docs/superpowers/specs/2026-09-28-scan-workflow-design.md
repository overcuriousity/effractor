# Scanners that build on each other

Date: 2026-09-28 · Status: the design was approved by the owner in
conversation, 2026-09-28; this text awaits the owner's review.

Builds on the four imports (`docs/HANDOFF.md`: nmap import, nmap recipes,
masscan and Greenbone, nuclei, nuclei templates) and on the plan every
scanner reads into (`nmap-plan.js`). Roadmap item `scan-workflow`.

## 1. Purpose and boundary

effractor is at its core a successor to securiCAD: it draws network diagrams
and attack vectors. It is no vulnerability manager, and the scanners are a
way to get a drawing, not a product of their own. This item makes them work
as one quiet sequence:

1. **The bulb** in the canvas's corner names what to run next, from what the
   drawing lacks (§2).
2. **Every tool's targets come from the drawing** (§4).
3. **nmap's library grows**: more of nmap's options (§5), six more purposes
   (§6).

Owner decisions, 2026-09-28, in the order given:

- nmap grows by **purposes, options and targets from the drawing**; not by
  evasion or spoofing. *Nothing offered hides a scan* stands.
- The page says what to run next through **the bulb**, nowhere else.
- The bulb knows two kinds of gap: **hosts and ports**, and **how things
  connect**. It never suggests a search for known weaknesses: Greenbone,
  nuclei's checks and nmap's checks stay in the menus, work as today, and
  are not named by the bulb.
- Products and versions are **folded into the first scan**; a service
  without a version is not a step of its own.
- Targets: **the selection, then a targets row** with a nested menu (§4).
- New purposes: *Is it still so*, *Who announces itself*, *UDP services*,
  *Routers by SNMP*, *Management interfaces*, *VPN endpoints*. Not: Windows
  domain, open without a password, what is kept there. nmap draws no
  accounts and no data.
- From the border of the hiding rule: **FIN, NULL and Xmas scans** are
  offered. Not: the paranoid and sneaky pace, random host order.
- Gaps and targets are two pure modules, and **each host notes what it was
  asked** (§3); no stored workflow.
- **Do not overcomplicate it.** What was cut for that is in §10.

Kept as they are: no third party is ever asked; adults are offered dangerous
options with a warning, not filtered; every offered command runs unchanged in
fish, bash and sh; files written before keep opening; no format version
changes; nothing is drawn that the model does not use.

## 2. The bulb

One line, bottom right on the canvas, architecture view only, as today
(`#nmap-hint`). It names the first step of this list that applies:

| # | id | The drawing lacks | The bulb says | A click opens |
|---|---|---|---|---|
| 1 | `scanner` | any scanner | *Scan a network with nmap* | nmap, as today |
| 2 | `network` | a scan of a drawn network | *Office LAN not scanned · nmap* | nmap: *Who is on this LAN* (where the scanner is on that network) and *What runs there*; targets: the whole range |
| 2 | `network` | the same, the range wider than 1,024 addresses | *Office LAN not scanned · masscan* | masscan: common ports; targets: the whole range |
| 3 | `runs` | what runs on drawn hosts | *5 hosts not asked what runs there · nmap* | nmap: *What runs there*; targets: those hosts; Ports *as drawn* where every one of them has ports drawn |
| 4 | `way` | a way between two drawn networks | *No way drawn to Server LAN · nmap* | nmap: *Map the route*, *Routers by SNMP*, *Management interfaces*; targets: the drawn hosts on the far network |
| 5 | `connect` | how services connect | *8 hosts not asked how they connect · nuclei* | nuclei: *What is there* and *How it connects*; targets: those hosts |

With nothing lacking, the bulb is hidden.

### 2.1 What lacks

A gap is something the drawing lacks **and** no scan has asked (§3). All
rules read the drawing only.

- **`network`**: a network with `addresses`, to which no host with `seen`
  is attached. The width is counted from its addresses.
- **`runs`**: a host with an address and without `missed` that
  - has no service drawn and no `asked.ports`, or
  - has a service without a product and no `asked.products`.
- **`way`**: a network that has hosts, that no chain of drawn routers joins
  to a network the scanner's host is attached to, and on which some host has
  no `asked.route`. Not said while no scanner is on a host.
- **`connect`**: a host with at least one service and without
  `asked.connections` and without `missed`.

A drawing made before this item has no `asked` anywhere. Its hosts with
ports and products are no `runs` gap, since the rule asks the drawing first;
they are a `connect` gap until the templates have asked them, which is true:
nothing in a drawing says whether its connections were looked for.

### 2.2 How it behaves

- **Click**: opens the tool's dialog with the purposes ticked and the targets
  set (§4). A tool not drawn yet is added first, on the host another scanner
  runs on, else on the selected host, else on none, as today.
- **Right click**: the app's menu (`app.showMenu`) with the other steps that
  apply, each with its count and tool, then *Say nothing about this* and,
  where something is silenced, *Say it again*.
- **×** silences the step named, on this browser
  (`effractor.hint.silenced`, a list of step ids). The key written until
  now, `effractor.hint.nmap`, is read as `scanner` silenced. Storage that
  fails only means the bulb speaks again.
- It is answered anew on every change of the document, so after an import it
  names the next step by itself.
- The words are few: what lacks, how many, which tool. One network is named;
  several are counted (*3 networks not scanned · nmap*).

## 3. The file: what a host was asked

```yaml
entities:
  db1:
    kind: host
    addresses: [10.0.2.9]
    seen: 2026-09-28
    asked: { ports: 2026-09-28, products: 2026-09-28, route: 2026-09-28, connections: 2026-09-28 }
```

`asked` is a map on a host, beside `seen`, in place, no version change. Its
keys are `ports`, `products`, `route`, `connections`, each optional, each a
day (`YYYY-MM-DD`). Refused: off a host, another key, a value that is no
day. Generation and results never read it. The wasm module must be rebuilt
for a page to read the key.

Who writes what, on every host the scan covered, whether it found something
or not:

| Import | Writes | Covered means |
|---|---|---|
| nmap | `ports` where ports were scanned (not `-sn`, not `-sL`); `products` with `-sV`; `route` with `--traceroute` | listed in the result as up |
| masscan | `ports` | listed in the result |
| nuclei, effractor's templates | `products` for *What is there*, `connections` for *How it connects* | see below |
| Greenbone, nuclei's checks | nothing | |

**nuclei** writes a record only for what it found, and nothing about what it
asked. So the dialog's ticked templates and its targets stand in for it:
every drawn host the targets hold is noted, where the result holds at least
one answer of effractor's templates and the row below is ticked. A run in
which nothing answered has nothing to paste, so it notes nothing; the bulb
says its step again and is silenced by hand.

**In the preview** one ticked row says it, where `seen` is said: *Notes 8
hosts as asked how they connect.* Unticked (`ticks.asked`), nothing is
noted. A host the import leaves out is not noted.

The inspector shows nothing of `asked`; it is read in the source view. No
edit function sets it, so the agent has no tool for it.

## 4. Targets from the drawing

One row in the dialog's step 2, above the range field, for every tool:

```
2  Targets
   [ 3 hosts on Office LAN        ▾ ]
      Office LAN · 10.0.1.0/24      ›
        the whole range
        drawn hosts only (14)
        hosts without ports (3)   ✓
        not seen since 2026-09-20 (2)
      Server LAN · 10.0.2.0/24      ›
      the selection (0)
      typed by hand…
   [ 10.0.1.7 10.0.1.9 10.0.1.31          ]
```

- The menu is the app's own (`menu.js`), nested. It lists every drawn
  network that has addresses, in file order; a choice with nothing in it is
  greyed and says so (*nothing drawn there yet*).
- **The whole range** is written as the network's addresses
  (`10.0.1.0/24`); every other choice as the hosts' addresses, in file
  order, the first address of each host that the network's range holds.
- **Hosts without ports**: no service drawn. **Not seen since**: hosts with
  `missed`, and the day is the oldest of them.
- **The selection**: the hosts selected or picked on the canvas when the
  dialog opened; a selected network stands for its whole range, a cluster
  for the hosts in it.
- **At opening** the choice is: what the bulb set; else the selection, where
  it holds a host or a network; else the scanner's own network's whole
  range, as the range is prefilled today.
- **The range field stays**, shows the words the choice comes to, and can be
  edited; an edit turns the row to *typed by hand*. The rules of the range
  (what a word may be, IPv4 apart from IPv6) are each tool's own, unchanged.
- A host without an address is left out and counted (*2 hosts without an
  address left out*); nuclei takes such a host by its name, as today.

Per tool:

| Tool | What it is handed |
|---|---|
| nmap | the words, after `-oX -` as today |
| masscan | the words; addresses only, as today |
| nuclei | the words go where the range goes today; `T.targets` crosses them with the ports, unchanged |
| Greenbone | step 1 gains a line *Targets* with the words, separated by commas, and *Copy*: for the target's hosts field |

## 5. nmap's options

*Adjust* holds 20 blocks in four groups and opens one group at a time;
closed, a group says what is set in it, as *Adjust* does today. Choices new
with this item are bold. `root` marks what makes the command start with
`sudo` (probed, §9).

**Finding hosts**

| Block | Choices |
|---|---|
| Discovery | ping · ARP on this LAN (`-PR`, root) · **TCP to usual ports** (`-PS22,80,443,445 -PA80,443`) · **UDP** (`-PU53,161`, root) · **every ICMP kind** (`-PE -PP -PM`, root) · **every probe** (all of these, root) · don't ping (`-Pn`) · names only (`-sL`) |
| **Names** | as nmap does · never asked (`-n`) · for every address (`-R`) · by this machine's resolver (`--system-dns`) · by a resolver of yours (`--dns-servers`, typed) |
| **Leave out** | nothing · the scanner's own host (`--exclude` its addresses) · typed (`--exclude`) |
| **Interface** | nmap's choice · named (`-e`, typed) |

**Ports**

| Block | Choices |
|---|---|
| Ports | none · **20 most common** · 100 most common · 1000 most common · **as drawn** · a list · every TCP port |
| TCP scan | connect (`-sT`) · SYN (`-sS`, root) · **ACK** (`-sA`, root) · **window** (`-sW`, root) · **FIN** (`-sF`, root) · **NULL** (`-sN`, root) · **Xmas** (`-sX`, root) |
| UDP | off · **20 most common** · 100 most common · 1000 most common · **a list** (the `U:` ports of the typed list) |
| **Other protocols** | off · SCTP (`-sY`, root) · IP protocols (`-sO`, root) |

**Depth**

| Block | Choices |
|---|---|
| Depth | open ports only · products and versions · versions and OS guess |
| **Version effort** | nmap's · light (`--version-light`) · every probe (`--version-all`, hint: slow) |
| **OS guess** | nmap's · only where it can tell (`--osscan-limit`) · guess harder (`--osscan-guess`) |
| Identity, Route, Reasons, Checks | as today |

**Pace**

| Block | Choices |
|---|---|
| Pace | polite · normal · fast · **insane** (`-T5`, warning: *Misses ports on all but the fastest networks.*) |
| **Rate** | nmap's · at most *n* packets a second (`--max-rate`, typed) · at least *n* (`--min-rate`, typed, warning: *Can overload small routers and set off alarms.*) |
| **Retries** | nmap's · one (`--max-retries 1`) · none (`--max-retries 0`, warning: *Misses ports.*) |
| **Giving up on a host** | never · after 15 minutes (`--host-timeout 15m`) · after an hour (`--host-timeout 1h`) |
| **Wait between probes** | none · 1 second (`--scan-delay 1s`, hint: for devices that limit their answers) |

### 5.1 Rules

- **As drawn** is the ports drawn on the targets, as one list: nmap takes
  one list for all targets. With nothing drawn on them it is refused:
  *Nothing is drawn there yet; choose 1000 most common.*
- **Version effort** and **OS guess** add nothing unless Depth asks for
  versions, or for the OS guess.
- **One TCP scan per run**, as nmap has it. The firewall recipe's second
  command (the ACK scan) stays.
- **ACK, window, FIN, NULL, Xmas** never say a port is open. They are read
  as the ACK scan is read today, for the firewall check only: a port that
  answered with a reset got through the filter. No port is drawn from them.
  Each has the hint *says what a filter passes, not what is open*.
- **SCTP and IP protocols**: ports and protocols found this way are said in
  the preview and not drawn; a flow's protocol is `tcp/…` or `udp/…`.
- **Typed texts** go into the command, so each is held to its shape and
  refused otherwise: a resolver is one or more addresses; an interface is
  letters, digits, `_`, `.`, `-`; what is left out follows the range's
  rule; a rate is a whole number from 1 to 100,000. They are kept for the
  session, never in the file, as nuclei's are.
- The order of choices inside a block that recipes set stays weakest first;
  the combination of recipes does not change.

### 5.2 Still left out, whatever is asked

What falsifies the sender, disguises packets or uses a third machine:
decoys (`-D`), `-S`, `--spoof-mac`, `-f` and `--mtu`, `--data-length`,
`--source-port` and `-g`, `--badsum`, the idle scan (`-sI`), the FTP bounce
(`-b`), `--proxies`; and `-T0`, `-T1`, `--randomize-hosts` (owner,
2026-09-28). `scripts/nmap-command.test.js` holds the list against every
recipe under every choice of every block.

## 6. nmap's purposes

Six tiles beside the seven there are. Each draws only what the plan already
draws; two need a reader of their own.

| id | Tile | Finds | Sets | Draws |
|---|---|---|---|---|
| `still` | Is it still so | What changed on what is drawn. | Ports *as drawn*, products and versions; targets *drawn hosts only* | changes, *seen*, *not seen*: all there today |
| `announced` | Who announces itself | Hosts that answer a call to all, and the gateway. | the broadcast scripts, their finds scanned too (root) | hosts as ever; the gateway offered as a router (§6.1) |
| `udp` | UDP services | DNS, SNMP, time, VPN and other services on UDP. | UDP *20 most common*, products and versions (root) | services on UDP ports |
| `snmp` | Routers by SNMP | The networks a router is on, by its own word. | `udp/161`, `snmp-interfaces`, `snmp-sysdescr` (root) | the host's further addresses, the networks they are in, the role router offered (§6.2) |
| `managed` | Management interfaces | Where a machine is administered from the network. | a port list (§6.3), products and versions | services as ever; on a router, *managed from* the scanner's network, offered unticked |
| `vpn` | VPN endpoints | Where a network is entered from outside. | a port list (§6.3), `ike-version`, products and versions (root) | services as ever |

All combine with the others block by block, as recipes do today. None asks
a third party: every script named is outside nmap's `external` category
(checked in the installed scripts, §9).

### 6.1 Who announces itself

```
sudo nmap --script 'broadcast-dhcp-discover or broadcast-ping or broadcast-dns-service-discovery or broadcast-upnp-info' --script-args newtargets -oX - 10.0.1.0/24
```

With an IPv6 range the scripts are `targets-ipv6-multicast-echo`,
`targets-ipv6-multicast-slaac` and `targets-ipv6-multicast-mld`. With
`newtargets` nmap scans what the scripts found as it scans the range, so
those hosts arrive as ordinary hosts and need no reader.

One thing is read from the scripts themselves: the **router** the DHCP
answer names. The host with that address gets the role *router*
preselected in the preview, said as *DHCP: gateway*, by the role row there
is. Everything else the scripts say is not read and not shown.

### 6.2 Routers by SNMP

Asks `udp/161` with nmap's own community (`public`); no other is tried.
`snmp-interfaces` lists each interface with its address and netmask.

- Every such address is added to the host (`addresses`), as a merge adds
  them today.
- The host is attached to each network whose range holds one of them; a
  network not drawn is proposed from the address and the netmask, by the
  rule there is for a scanned host.
- With addresses in two or more networks the role *router* is preselected,
  said as *SNMP: 3 interfaces*.
- Loopback and link-local addresses, and interfaces that are down, are
  left out.

### 6.3 Port lists

| Purpose | Ports |
|---|---|
| Management interfaces | `T:22,23,80,443,3389,5900,5985,5986,8080,8443,U:161,U:623` |
| VPN endpoints | `T:443,1194,1723,U:500,1194,4500,51820` |

With a UDP port in its list the purpose needs root. A UDP port nmap calls
`open|filtered` is not drawn, as today; WireGuard answers no stranger, so
`udp/51820` is mostly said, seldom drawn.

### 6.4 The stamp

`recipesOf` reads the new purposes back from nmap's own arguments where
they tell: `broadcast-dhcp-discover` or `targets-ipv6-multicast-echo`
(`announced`), `snmp-interfaces` (`snmp`), `ike-version` (`vpn`). *Is it
still so*, *UDP services* and *Management interfaces* are port lists and
are not read back; the stamp names the rest.

## 7. Modules

| File | What it holds |
|---|---|
| `assets/js/scan-gaps.js` (new, pure) | `steps(doc, silenced)`: the steps that apply, in order, each `{id, tool, count, names, says, purposes, targets}` |
| `assets/js/scan-targets.js` (new, pure) | `choices(doc, appId, selection)`: the menu; `words(doc, choice)`: the words and what was left out; `asked(doc, words)`: the drawn hosts they hold |
| `assets/js/nmap-command.js` | the blocks, their groups, the purposes, the typed texts' shapes; `command` as today |
| `assets/js/nmap-devices.js` (new, pure) | the two readers: the DHCP answer's router, SNMP's interfaces |
| `assets/js/nmap-plan.js` | `asked` in ticks, summary and apply; the two readers' rows |
| `assets/js/nmap-ui.js` | the targets row, *Adjust* in groups, the bulb |
| `assets/js/masscan.js`, `nuclei.js`, `greenbone.js` | take the targets' words; write `asked` through the plan |
| `crates/effractor-core`, `effractor-format` | `asked` on a host: model, reader, writer, the refusals of §3 |

`nmap-ui.js` has 844 lines and gains the row and the bulb's menu; the bulb
moves into a file of its own (`scan-hint-ui.js`) with this item.

## 8. Fixtures and checks

- `scripts/scan-gaps.test.js`, `scripts/scan-targets.test.js`: each rule of
  §2.1 and §4 on small drawings, the old drawing without `asked` among
  them.
- `scripts/nmap-command.test.js`: every choice of every block gives the
  argument the tables of §5 name; the refusals of §5.1; the list of §5.2.
- `scripts/shell-commands.test.js`: every new purpose and every block's
  strongest choice, with typed texts, in fish, bash and sh.
- `scripts/fixtures/nmap/announced.xml`, `snmp.xml`: hand-written in nmap's
  shape from the scripts' own source, until a recorded one replaces them
  (§9); `imported-snmp.doc.json` pinned by Node, `tests/json.rs` and
  `check-nmap-wasm.js`, as the others are.
- Rust: `asked` read, written and refused, in `effractor-format`'s tests;
  a file without it reads as before.
- The assistant's tool test stays green: no edit function is added.
- What the page looks like is looked at by the owner, part by part (§11).

## 9. Probed

With the installed nmap 7.92 against 127.0.0.1, without root, 2026-09-28
(the port table in `nmap-command.js` is 7.95's; both are named in the
code):

- Run as they are: `-n`, `-R --dns-servers`, `--system-dns`, `--exclude`,
  `-e`, `--top-ports 20`, `--version-light`, `--version-all`, `-PS… -PA…`,
  `-T5`, `--max-retries`, `--host-timeout`, `--max-rate`, `--scan-delay`.
- Refused without root: `-PU`, `-sU`, `-sF`, `-sW`, `-sY`, `-sO`, `-O`.
  `-PE -PP -PM` runs without root but falls back to a TCP ping with a
  warning, so it is marked root.
- **`--open` leaves a host with nothing open out of the result.** Such a
  host could not be noted as asked; the block *Show* was cut for it (§10).
- All scripts of §6 exist and none is in `external`. `snmp-interfaces`,
  `snmp-sysdescr`, `broadcast-dhcp-discover`, `broadcast-ping`,
  `broadcast-dns-service-discovery`, `broadcast-upnp-info` and
  `ike-version` are `safe`; the three `targets-ipv6-multicast-*` are
  `discovery` and `broadcast` only.

Left for the plan, since they need root or a device: what
`broadcast-dhcp-discover` and `snmp-interfaces` write into the XML, and
that `newtargets` scans what was found. The owner runs those commands and
pastes the result; until then the fixtures follow the scripts' source.

## 10. Cut, to keep it small

| Cut | Why |
|---|---|
| The block *Show* (`--open`) | it hides hosts the import must note (§9) |
| The blocks *Kept*, *Progress*, *Hosts at once* | dropping a file works today; the others tune and find nothing |
| A reader for mDNS, UPnP and the other broadcast answers | nmap scans what they find; only the gateway is drawn |
| `snmp-netstat` | connections of the moment, not of the drawing |
| `asked` on a network | the rule of §2.1 is enough; a scanned network where nobody answered is silenced by hand |
| A stored workflow, a step counter, a list panel | the bulb reads the drawing |
| Guidance after an import | the bulb answers anew by itself |
| `asked` in the inspector | nothing to do with it there |

## 11. Delivery

Five parts, each a branch and a PR, in this order. Each part that changes
what the page shows is shown to the owner in a preview, in plain words,
before it lands.

| # | Branch | Holds | The owner looks at |
|---|---|---|---|
| 1 | `host-asked` | §3: the key, and every import writes it | the preview's row *Notes … as asked* |
| 2 | `scan-targets` | §4 | the targets row in each tool's dialog |
| 3 | `nmap-options` | §5 | *Adjust* in groups |
| 4 | `nmap-purposes` | §6 | the six tiles, the two rows in the preview |
| 5 | `scan-hint` | §2 | the bulb, its menu |

Part 5 deletes `scan-workflow` from the roadmap, and this spec and its plan
with it.
