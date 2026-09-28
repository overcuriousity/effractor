# nuclei templates of effractor's own

Date: 2026-09-28 · Status: approved by the owner, 2026-09-28.

Builds on the nuclei import (`docs/HANDOFF.md`, "Continuation — nuclei beside
nmap") and on the plan every scanner reads into (`nmap-plan.js`). Roadmap item
`nuclei-templates`.

## 1. Purpose and boundary

effractor draws network diagrams and attack vectors; it is no vulnerability
manager. nuclei's strength is its templates, so effractor ships its own: each
asks what the drawing needs and answers in fields the reader knows. Two
groups:

1. **What is there** (*identify*, §5): what answers on a port, which web
   server and web application, which names a certificate bears. Drawn as
   products, services and names.
2. **How it connects** (*connect*, §6): logins, single sign-on, management
   pages, what a name points to. Drawn as accounts, administration and flows.

Owner decisions, 2026-09-28, in the order given:

- **Templates before `scan-workflow`.** This item no longer needs it; the one
  piece it needed, targets taken from the drawing, is built here (§3).
- **Also new ports.** Targets are the drawn hosts; a service that answers on
  a port not drawn yet is drawn.
- A web port's server and application are drawn as **two pieces**; the
  overlap between scanners is to be handled elegantly (§7), and **clustering**
  is what keeps the canvas quiet.
- The overlap rules of §7, as written there.
- **The command writes the templates**; nothing is downloaded or fetched.
  It is fish-compatible, or a shell would have to be enforced: it runs
  unchanged in fish, bash and sh (§2.1, §12), so none is enforced.
- About **fifty web applications**, curated, including those common in
  corporate networks (§5.3).
- Names are **kept on the host** (§8).
- *Connect* stays **in this item**.
- A login is drawn as a stand-in account, **offered, not ticked** (§6.1).
- Single sign-on: **one shared account and the sign-on's host** (§6.2).
- A management page: administration from the scanner's network and an
  account with admin rights, **both unticked** (§6.3).
- A name that points elsewhere: **the name on the host it points to, the
  pass-on offered** unticked (§6.4).

Kept as they are: no third party is ever asked; nothing offered hides a scan;
adults are offered dangerous options with a warning, not filtered (none of
these templates is dangerous, §2.1); files written before keep opening; no
format version changes.

Not in this item: SSH host keys and SSH login methods (nuclei refuses
unsigned scripted templates; they stay nmap's); the page saying what to run
next from what the drawing lacks (`scan-workflow`); findings of any severity
(these templates rate everything `info`).

## 2. The templates

Five files in `assets/nuclei/`, served by the page like every asset and
included in the static export:

| File | Protocol | Asks | Group |
|---|---|---|---|
| `effractor-banner.yaml` | tcp | what a service says when spoken to | identify |
| `effractor-web.yaml` | http | the web server and the application | identify |
| `effractor-certificate.yaml` | ssl | the names a certificate bears | identify |
| `effractor-login.yaml` | http | a login, and where logins are sent | connect |
| `effractor-points-to.yaml` | dns | the address or alias of a name | connect |

Every answer is a **named extractor**; nuclei writes one record per named
extractor that found something, with `extractor-name` and
`extracted-results`. The name says what the value is (`openssh`, `server`,
`grafana`, `names`, `sso-keycloak`, `address`), the reader knows each (§4).

### 2.1 Rules every template keeps

`scripts/nuclei-templates.test.js` holds each:

1. **No backslash, no single quote**, and no character outside printable
   ASCII and the line feed. The command carries the text between single
   quotes (§3), where fish reads a backslash and sh does not. Patterns are
   written with classes: `[0-9]`, `[.]`, `[[:space:]]`. Bytes to send are
   written as hex (`type: hex`).
2. `id` starts with `effractor-`; `severity: info`; `author: effractor`.
3. Protocols `tcp`, `http`, `ssl`, `dns` only. Never `javascript`, `code`,
   `headless`, `file`, `workflow`.
4. **They only read.** HTTP requests are `GET` without a body; the banner
   template sends one line feed; the certificate template makes a handshake;
   the DNS template asks for `A`. No form is submitted, no password tried,
   no payload sent, nothing out-of-band (`interactsh`) named.
5. Every extractor is named, and every name is in the reader's table
   (`nuclei-templates.js`, §9) and the other way round.
6. Every named extractor has a record in the fixtures (§11).

### 2.2 Where the traces come from

The traces by which applications are known are taken from the
nuclei-templates collection installed beside nuclei (MIT licence,
ProjectDiscovery), read from disk, never fetched. Each is rewritten to the
rules above and reduced to what needs no login. `assets/nuclei/README.md`
names the source and its licence.

## 3. The command

One paste writes the templates and the targets, then runs nuclei:

```
mkdir -p effractor-templates; echo 'id: effractor-banner
info:
  …' > effractor-templates/effractor-banner.yaml; echo '…' > effractor-templates/effractor-web.yaml; echo '…' > effractor-templates/effractor-certificate.yaml; awk 'BEGIN { n = split("10.0.1.5 10.0.1.40", h, " "); m = split("21 22 25 80 …", p, " "); for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) print h[i] ":" p[j]; print "10.0.1.40:8444" }' > targets.txt; nuclei -t effractor-templates/effractor-banner.yaml,… -list targets.txt -exclude-type dns -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check
```

Only the ticked groups' templates are written, and `-t` names each written
file, never the directory. The targets are written by `awk`, which crosses
the hosts with the ports (amended with the plan, 2026-09-28: one line where
`echo` would carry one per host and port). The names *How it connects* asks
are written to `names.txt` and asked in a second run of nuclei, with the DNS
template alone: a name is asked of a resolver and of nothing else, so a name
that points outside is never sent a request. `;` and `>` are the only shell
syntax, as the fish rule has it (`docs/HANDOFF.md`).

**Flags.** Always `-jsonl -silent -omit-template -no-interactsh
-disable-update-check`; `-omit-raw` always (these templates need no
evidence). With names among the targets, or *How it connects* ticked, this
machine's resolvers are written first and named (`-resolvers resolvers.txt`),
exactly as the import does today; otherwise `-exclude-type dns`. Never
`-preflight-portscan`: with it nuclei 3.11.0 drops the web answers (§12).

### 3.1 Targets from the drawing

The range field stays and is prefilled as today. The targets are:

- every **drawn host the range covers**, by its address (a host without an
  address by its label, when the label is a name), as `address:port` for
  - every port drawn on it, and
  - every **usual port** (§3.2);
- for *How it connects*, every name kept on those hosts (§8), bare, for the
  DNS template.

An address, a name or a URL typed into the range is asked whether it is
drawn or not: it was named by hand.

IPv6 addresses are written `[fd00::5]:443`. A drawn host the range does not
cover is left out. Where the range covers **nothing drawn**, the range itself
is expanded to addresses (at most a /22, 1,024 addresses; wider is refused
with *Give a smaller range, or draw the hosts first with nmap*), each with
the usual ports, and a line says *Nothing is drawn in 10.0.1.0/24 yet. nmap
finds hosts faster.* An empty range is refused as today.

The command says above itself what it asks: *12 drawn hosts, 32 usual ports
and 5 drawn ones.*

### 3.2 Usual ports

Ports where one of the templates can get an answer; one list in
`nuclei-templates.js`:

- speaking first or to a line feed: 21, 22, 25, 110, 143, 587, 2222, 3306
- certificates on mail: 465, 993, 995
- web: 80, 443, 3000, 4443, 5000, 5601, 7001, 8000, 8006, 8008, 8080, 8081,
  8088, 8443, 8888, 9000, 9090, 9200, 9443, 10000, 10443

Every template is run against every target; a port that speaks another
protocol gives no record. Closed ports do not make nuclei give up on a host
(§12).

## 4. Reading

`nuclei.js` hands every record whose `template-id` starts with `effractor-`
to `nuclei-templates.js`; every other record is read as today. One paste may
hold both.

- **Host and port** are taken from `matched-at`, then `host`; never from
  `port` first: for a web port nuclei's `port` may say 80 while `matched-at`
  names the real one (§12). A DNS record has no port and no address; it is
  about its name.
- **Values** are `extracted-results`, each cleaned as the import cleans names
  today (`cleanName`), cut at 120 characters, and refused where the table
  gives a shape and the value does not have it (a version is
  `[0-9][0-9A-Za-z._-]*`, a name is a DNS name, an address is an address).
  What is pasted is data: a record cannot name an extractor the table does
  not hold, and nothing of it reaches the drawing unread.
- **Unknown extractor names** of an `effractor-` template are counted and
  said (*3 answers this version does not know*); a newer template pasted
  into an older page draws nothing wrong.

The scan every scanner's plan reads gains, per port:
`service.product`/`version` (as nmap fills them), `application` (`{product,
version, manages}`), `login` (`{sso: null | {kind, host}}`); per host:
`names` (as today), `points` (`[{name, address | alias}]`); and `said`
(`[{port, text}]`) for what is only said.

## 5. What is there

### 5.1 What answers on a port

`effractor-banner` names the product and its version where the banner holds
them:

| Extractor | Product | From |
|---|---|---|
| `openssh` | OpenSSH | `SSH-2.0-OpenSSH_9.6p1 …` |
| `dropbear` | Dropbear sshd | `SSH-2.0-dropbear_2022.83` |
| `vsftpd`, `proftpd`, `pure-ftpd` | vsftpd, ProFTPD, Pure-FTPd | the FTP greeting |
| `postfix`, `exim`, `sendmail`, `exchange-smtp` | Postfix smtpd, Exim smtpd, Sendmail, Microsoft Exchange smtpd | the SMTP greeting |
| `dovecot`, `courier`, `cyrus` | Dovecot, Courier, Cyrus | the POP3 or IMAP greeting |
| `mysql`, `mariadb` | MySQL, MariaDB | the handshake's version text |
| `banner` | none | the first line, said in the preview, never drawn |

Product names are spelled as nmap spells them, so both name one product.

### 5.2 The web server

`effractor-web` reads the `Server` header (`server`). Its first
`name/version` is the product; a table spells the name as nmap does (`Apache`
→ `Apache httpd`, `Microsoft-IIS` → `Microsoft IIS httpd`, `nginx` → `nginx`).
A header that names no version gives the product without one. A name the
table does not hold is drawn as written. No header: the port's product stays
unidentified, as the import leaves it today.

### 5.3 The web application

The root page is asked, redirects on the same host followed (at most three),
and at most sixteen further paths where an application tells its version
without a login (`/api/health`, `/status.php`, `/rest/api/2/serverInfo` …).
Every path is asked of every web port.

The list, for the owner to strike and add (M: a management page, §6.3; S: a
sign-on, §6.2):

| Group | Applications |
|---|---|
| Monitoring and data | Grafana, Kibana, Elasticsearch, Zabbix, PRTG, Splunk |
| Development | GitLab, Gitea, Jenkins, SonarQube, Nexus Repository, Harbor |
| Collaboration and mail | Confluence, Jira, Bitbucket, Nextcloud, WordPress, Roundcube, Zimbra, Outlook on the web (Exchange), SharePoint |
| Identity | Keycloak (S), AD FS (S) |
| Remote access and edge | Citrix Gateway, Palo Alto GlobalProtect, Ivanti Connect Secure, Cisco Secure Firewall (ASA), Apache Guacamole, FortiGate (M), F5 BIG-IP (M), SonicWall (M) |
| Machines and their management | VMware vCenter (M), VMware ESXi (M), Proxmox VE (M), HPE iLO (M), Dell iDRAC (M), Synology DSM (M), pfSense (M), OPNsense (M), FRITZ!Box (M), MikroTik RouterOS (M), Webmin (M), Portainer (M) |
| Middleware and stores | Apache Tomcat, Oracle WebLogic, SAP NetWeaver, phpMyAdmin, HashiCorp Vault, Veeam Backup |

Forty-nine. Prometheus, QNAP QTS and RabbitMQ were struck with the plan
(2026-09-28): the collection knows them by their title alone, and no second
trace shows without a login.

An application is named only by a trace of its own (a header, a
path that answers in its shape, a marker in the page), never by the title
alone. The title (`title`) is said in the preview and never drawn.

### 5.4 How server and application are drawn

- The **server** is the service on the port, the one nmap draws: hosted by
  the host, reached by a flow from nuclei's application with the port as
  protocol (`tcp/443`), an instance of the server's product.
- The **application** is a service of its own, labelled by its name
  (`Grafana`), hosted by the same host at `privilege: unknown`, an instance
  of its own product (`Grafana 10.2.3`). The server **passes on** to it: a
  flow from the server to the application with protocol `http`, routed over
  the first network the host is attached to (none: the flow is unfinished,
  which blocks nothing). `http` names no port, so the port stays the
  server's.
- **No separate server** (the answer has no `Server` header, as Grafana's
  has none): one service on the port, an instance of the application's
  product. A header that names an embedded server (Jenkins' `Jetty`) is a
  server like any other, and two pieces are drawn.
- The **application of a port**, on a later import, is the service on the
  same host that a flow from the port's service reaches; it is recognised by
  that, not by its label.
- Both join the host's cluster, open, as the import gathers today
  (`clusters.gather`).

### 5.5 Names

`effractor-certificate` gives the subject's name and every alternative name.
Each is kept on the host (§8). A wildcard (`*.corp.example`) and a name that
is no DNS name are only said. A host labelled by its address is offered its
first name as label, ticked, as nmap's import offers it.

## 6. How it connects

Every row of this section is **unticked** unless said otherwise; the preview
lists them under *Connections*, each with what it would draw in plain words.

### 6.1 Logins

`effractor-login` asks the root page (same-host redirects followed) and
names a login (`login`) where the page holds a password field. It submits
nothing.

Ticked, a login draws a **stand-in account** named after what it logs into
(`Grafana accounts`; on a port without a known application, `accounts of
https on web1`) that the service authorises. It has no credential; the attack
graph shows the login as a path with an unknown input until the author says
who logs in and with what. A service that already authorises any account is
offered nothing.

### 6.2 Single sign-on

Where a redirect leaves the host, or the login page links to a sign-on, the
address it names is extracted:

| Extractor | Known by |
|---|---|
| `sso-keycloak` | `/realms/…/protocol/openid-connect` or `/protocol/saml` |
| `sso-adfs` | `/adfs/ls`, `/adfs/oauth2` |
| `sso-entra` | `login.microsoftonline.com` |
| `sso-okta` | a host under `okta.com` |
| `sso-google` | `accounts.google.com` |
| `sso-saml`, `sso-oidc` | `SAMLRequest=`; `response_type=` with `client_id=`, on another host |

Ticked, the row draws:

- **one account per sign-on**, named after it (`Keycloak accounts at
  sso.corp.example`), which the sign-on's service authorises and which every
  service that sends its logins there authorises too. A second service of
  the same sign-on joins the account that is there.
- **the sign-on's host**, where it is not drawn: a host labelled by the name
  (matched against drawn hosts by name and kept names first), without an
  address, with one service (`https`, product by the kind: `Keycloak`,
  `AD FS`, `Microsoft Entra ID`, `Okta`, `Google sign-in`; `sso-saml` and
  `sso-oidc` leave it unidentified). An outside sign-on is drawn the same
  way; nothing is asked of it.

A service with a sign-on is offered no login of its own (§6.1) unless the
page holds a password field as well.

### 6.3 Management pages

An application marked M in §5.3, found in this result or drawn as the
product of the port's service or application, is a management page. Two
rows, both unticked:

- **Administered from the scanner's network**: an `administration` from the
  network nuclei's host is attached to (several: the one whose range holds
  the target, else the first) to the machine; on a host that runs a router,
  the router. nuclei on no host: the row says *Put nuclei on a host to say
  where from* and cannot be ticked.
- **Its login**: a stand-in account (`pfSense accounts`) the service
  authorises, with a grant of `admin` on that machine. It replaces the row
  of §6.1 for that service.

### 6.4 What a name points to

`effractor-points-to` asks this machine's resolvers for each kept name
(`address`, `alias`).

- The name points to **the host that keeps it**: nothing to draw.
- It points to **another drawn host**: the name is kept on that host too
  (ticked: it was seen). That this host passes on to the one bearing the
  certificate is offered unticked: a flow from its service on the port the
  certificate was seen on (drawn if needed, product unidentified) to the
  bearer's, protocol and route as any flow between two hosts.
- It points to **an address nobody has drawn**: a new host with that address
  and the name, unticked.
- It points **outside** (an alias or address outside private space and
  outside every drawn network): said (*grafana.corp.example points outside,
  to d111.cloudfront.net*), never drawn.
- It points **nowhere**: said.

## 7. Overlap

1. **The order does not matter.** nmap then nuclei, or nuclei then nmap,
   draw the same hosts, services, products, names and links, and a second
   import of either adds nothing. One thing may differ: a product keeps the
   label of whoever named it first (`OpenSSH 9.6p1` or nmap's `OpenSSH 9.6p1
   Ubuntu 3ubuntu13.5`). A test imports the fixtures in both orders and
   compares the documents with product labels reduced as in rule 3.
2. **A port is drawn once.** Hosts are matched as today. A port already
   drawn is that service; a port not drawn yet is a row of the preview,
   ticked.
3. **A product is named once.** Products are compared by name and by the
   first word of the version, whatever their case. This is the plan's
   comparison, for every scanner: nmap no longer offers `OpenSSH 9.6p1
   Ubuntu 3ubuntu13.5` as another version of a drawn `OpenSSH 9.6p1`. An
   unidentified product takes the name; a product known without a version
   takes the version. An identified one is left as it is.
4. **Disagreement is said, not drawn.** Where the drawn product and nuclei's
   differ in name or version, the row says *drawn: nginx 1.24.0 · nuclei:
   Apache httpd 2.4.57* and nothing changes.
5. **Two pieces per web port** as in §5.4.
6. **Clusters** hold what was brought in, per host.

## 8. The file: names on a host

A host may carry `names`, a list beside `addresses`, in place, without a
version change:

```yaml
web1:
  kind: host
  label: web1
  addresses: [10.0.1.40]
  names: [grafana.corp.example, metrics.corp.example]
```

Each is a DNS name in lower case, at most 253 characters, no wildcard, once
per host; two hosts may bear the same name. Refused off hosts and in another
shape. Generation and results never read them. The wasm module must be
rebuilt for a page to read the key.

Every scanner's names are kept there, not nuclei's alone (nmap's and
Greenbone's host names beyond the label), and imports match a scanned host's
names against labels **and** kept names. The pinned documents of the other
scanners' fixtures gain the key where their scans name hosts.

The inspector has a field *Names* under *Addresses*, edited the same way
(names separated by commas; amended with the plan, 2026-09-28). The agent's
tools reach the same edit (`scripts/assistant-tools.test.js`).

## 9. Modules

| Module | Does | Depends on |
|---|---|---|
| `assets/nuclei/*.yaml` | the templates | nothing |
| `nuclei-templates.js` (pure) | the reader's table (extractor → what it is, product name, shape, M, S), usual ports, `targets(doc, app, range)`, `command(groups, adjust, range, texts)`, `read(records)` | `nmap-address.js`, `nuclei-command.js` |
| `nuclei.js` | hands `effractor-` records on; adds the two recipes before nuclei's; the rest as today | the above |
| `nmap-products.js` (pure) | one comparison of products for every scanner (§7.3) | nothing |
| `nmap-connect.js` (pure) | plans and applies the connections (§6) | `nuclei-templates.js`, `nmap-products.js` |
| `nmap-plan.js` | rows and apply for applications, names, connections; the product comparison of §7.3 | `clusters.js`, the edit functions |
| `nmap-ui.js` | fetches the templates' text when the dialog opens; the tiles; the *Connections* section | |

The templates' text is written by `nuclei-templates.js` from its table
(amended with the plan, 2026-09-28); the files in `assets/nuclei/` are that
text, held equal by a test and served for reading. The page fetches nothing
to write the command.

## 10. The dialog

Step 1 of nuclei's dialog shows, above nuclei's recipes and set apart by a
quiet heading (*effractor's templates* · *nuclei's checks*):

- **What is there** — *What answers on each port, which web application,
  which names a certificate bears.* · seconds per host
- **How it connects** — *Logins, single sign-on, management pages, where
  names point.* · seconds per host

*What is there* is ticked at first, in place of *Exploited in the wild*. The
two go together; ticking one of nuclei's recipes unticks them and the other
way round, with the line that says why. *Adjust* then shows only Speed,
Patience, Giving up and Addresses of a name.

*How it connects* on a drawing without services says *Nothing drawn to ask
yet; run* What is there *first* and gives no command.

The preview gains two things: product and application on a port's row
(*nginx 1.24.0 · passes on to Grafana 10.2.3*), and the *Connections*
section (§6). What is only said is listed under the result's notes, as
today.

Every part of the dialog is shown to the owner in a preview before it
lands.

## 11. Fixtures and checks

- `scripts/dev/nuclei-lab.py` starts throwaway servers on 127.0.0.1 only:
  one page per application in its shape (hand-written from the trace, never
  a copy of a vendor's page), banners, a certificate with names, logins and
  redirects to sign-ons, and a resolver. It is kept so the fixtures can be
  recorded again.
- `scripts/fixtures/nuclei/identify.jsonl`, `connect.jsonl`: what nuclei
  3.11.0 wrote against them, addresses, names, ports, times and the home
  directory rewritten as `lab.jsonl` was.
- `imported-identify.doc.json`, `imported-connect.doc.json`: pinned by Node,
  `tests/json.rs` and `check-nmap-wasm.js`, like the others.
- `scripts/nuclei-templates.test.js`: the rules of §2.1; every extractor
  read; the table and the templates agree; targets from a drawing; the
  refusals; both import orders (§7.1); a second import adds nothing.
- `scripts/shell-commands.test.js`: the command in fish, bash and sh, and
  the files each wrote compared byte for byte with `assets/nuclei/`.
- `scripts/nuclei-command.test.js`: nothing offered asks a third party or
  hides a scan, the new commands included.
- CI has no nuclei; that nuclei accepts the templates is proved when the
  fixtures are recorded, and the fixtures name nuclei's version.

## 12. Probed with nuclei 3.11.0

All on 127.0.0.1 against throwaway servers, 2026-09-28:

- Unsigned `tcp`, `http`, `ssl` and `dns` templates run as they are; one
  record per named extractor.
- One file holding three protocols validates, but per target only one
  protocol answers: the templates are separate files.
- A command of `echo '…' > file` parts writes byte-identical files in fish,
  bash and sh.
- A target given as `host:port` is asked by all templates on that port,
  whatever ports a template lists.
- For a port the template names in a path, the record's `port` says 80 and
  `matched-at` the real one.
- 45 closed ports before three open ones: every open one answered, 7.5
  seconds.
- `-preflight-portscan` dropped every web and certificate answer.
- With `-resolvers` naming one resolver, the DNS template asked that one
  only; the answer's text holds `IN A` and `IN CNAME` lines.

## 13. Delivery

One roadmap item, five branches in this order, each a PR of its own; the
last deletes the item:

1. **`names`** on hosts: core, format, validator, wasm, the inspector's row,
   the agent's tool, the other scanners' names.
2. **Templates and command**: the five files, `nuclei-templates.js`
   (table, ports, targets, command), the shell and rule tests, the lab
   script.
3. **What is there**: reading, the plan's rows, the product comparison,
   fixtures.
4. **How it connects**: reading, the *Connections* rows, fixtures.
5. **The dialog**: tiles, *Adjust*, the preview's additions; looked at by
   the owner.

Roadmap, with this document's commit: `nuclei-templates` needs nothing;
`scan-workflow` says that nuclei's own templates already take their targets
from the drawing.
