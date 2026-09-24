# effractor — clustering

Date: 2026-09-24 · Status: design approved by the owner in conversation,
2026-09-24 (sections 1–3); written spec awaiting review

Roadmap item `clustering`. Amends [the lecture workflow design](2026-09-21-lecture-workflow-design.md)
§4 (one optional top-level field) and the architecture editor's selection,
rail, keys and context menus. Everything not named here stays as written
there.

## 1. Purpose and principles

An nmap import of a small network already draws dozens of components; a host
with its software and products is one machine to the reader. After
Chainalysis Reactor, the author marks components and collapses them into one
node, and opens it again in place.

* **A way of looking, not a change to the model.** Generation, the solver,
  results and every generated id ignore clusters. Clustering the whole
  architecture leaves the attack graph and results bit-identical (tested).
* **In the file.** Clusters, and whether each is closed, are part of the
  document (owner: an appliance is the author's statement), so a saved file
  and a shared link look the same. Positions stay this browser's, as today.
* **Every change is one edit.** Making, taking out, opening, closing,
  renaming, dissolving and deleting are ordinary document edits, each one
  Ctrl+Z.
* **Architecture view only.** Trees have no clusters; the attack graph view
  does not draw them.

## 2. The file

One optional top-level field, in place, no version change. Files and shared
links without it open unchanged.

```yaml
clusters:
  web01:
    label: web01
    members: [web01, nginx, nginx-1-24]
    closed: true
```

* `clusters` is a map by id, like `entities` and `flows`; ids follow the same
  rules. The canonical writer puts it after `flows` and leaves it out when
  empty.
* `label` is optional; without it the page shows the first member's label
  and "+n". The page writes one when it makes a cluster (§5.1).
* `members` lists entity ids, in the author's order. The first is not
  special in the file.
* `shown` (optional, owner 2026-09-25): members of a closed cluster drawn
  beside its stack, inside its outline (§5.3); left out when empty.
* `closed` is `true` or `false`, always written.
* Unknown keys are errors, except `x-`.

The validator's errors, each at its path:

* a member that is not an entity (`unknown-reference`);
* an entity in two clusters, or twice in one;
* a `shown` entry that is not a member, or is listed twice;
* a cluster with fewer than two members;
* `closed` missing or not a boolean.

Deleting a component takes it out of its cluster and dissolves a cluster left
with fewer than two members, as part of the reference-safe `remove` in
`architecture-links.js`.

Generation reads no field of `clusters`. The Rust core model, reader,
canonical writer and JSON image (`document`/`from_document`) carry it like
every other field.

## 3. Selecting

In the architecture view:

* **Click** selects one component, as today.
* **Ctrl-click** (⌘ on a Mac) adds a component to the selection or takes it
  out.
* **Shift + drag** on empty canvas draws a rectangle; on release every
  component whose plate lies inside is selected, and for a closed cluster its
  members. **Shift + Ctrl + drag** adds to the selection. A plain drag on
  empty canvas still pans.
* A click on empty canvas, or Esc, clears the selection.

The app keeps the inspector's subject in `state.selected` as today and the
multi-selection in `state.picked` (entity ids; one entry when a single
component is selected). Every picked component carries the selection
highlight. With two or more picked the inspector says "n components" and
lists them, each selecting itself on click.

With several picked:

* **Del** deletes them all and their links in one edit; the notice says
  *Deleted 4 components and 7 links* (undoable, no confirm dialog).
* **Dragging** any picked component moves all of them together; each
  position is stored as a dragged one.

## 4. Drawing

### 4.1 A closed cluster

One node, `cluster/<id>`:

* **Icon.** The most specific kind among its members, in this order:
  router, firewall, host, service, application, product, network, account,
  credential, person, data. A box that runs a router shows the router. A
  second plate peeks out behind it, so it reads as a stack.
* **Name.** Its label under the plate, and the member count (`web01 · 5`).
* **Rings as sectors.** The ring is split into one segment per member, in
  member order, with small gaps; each segment has that member's state:
  *vulnerable* red (`--color-danger`), *has unknown inputs* amber, none
  faint. A member with both is red. Above 12 members the ring becomes one
  arc per state, sized by how many members have it. The tooltip lists each
  vulnerable member's reasons, as a single component's does.
* **Unknowns.** The members' unknown counts, summed, as a component's count.
* **Pins.** The members' foothold and target pins; each still belongs to
  its member (picked up, it moves that member's pin). A pin dropped on a
  closed cluster (owner, 2026-09-24) opens a menu at the drop, *foothold
  on …* and the members that take one, each with its states as a submenu
  where it has several; a cluster none of whose members takes a pin says
  so.
* **Position.** Where it was last put in this browser (kept under
  `cluster/<id>` with the positions), else the centre of its members.

### 4.2 Lines

* A line with one end in a closed cluster is drawn to the cluster.
* A line with both ends in the same closed cluster is hidden.
* Lines between the same two drawn ends merge into one, counted (*3 links*,
  *2 flows*): links and flows merge separately, so flows stay dashed. A
  single line keeps its own label. A counted line's tooltip lists what it
  holds; a click on it opens a menu of them, and choosing one selects it.
* **Firewall permissions** (the dotted lines). A permission is drawn from
  its firewall, or from the closed cluster holding it. It ends at a closed
  cluster that holds an end of its flow (the target's cluster when both ends
  are in different closed clusters), else on the flow's line as today.
  Permissions from one drawn firewall to one cluster merge into one dotted
  line with a count. A permission whose firewall and flow are all inside one
  closed cluster is hidden.

### 4.3 An open cluster

Its members are drawn as usual, inside a quiet rounded outline with the
label on a tab at its top left. A click on the outline or the tab selects
the cluster and lights all its members, which then move together; dragging
the outline moves them all (owner, 2026-09-25).

**In place.** Opening puts the members round where the cluster stands,
keeping their offsets from their centre; closing puts the cluster at the
members' centre. Both write the moved positions to this browser's store.

**Animated** (owner, 2026-09-24): closing, members glide into the cluster
and fade; opening, they glide out from it to their places; a node whose
place changes otherwise (arranging, a re-layout) glides there too, about a
quarter second. Nothing moves for a browser that asks for reduced motion.

**Arrange automatically.** A closed cluster is one node for the stress
layout. An open cluster (or a closed one with members beside it) is laid out
as a block, with room round it for its outline and above it for its name
(owner, 2026-09-25: arranging respects opened clusters): a host's cluster in the
existing host-block arrangement (`graph.blocks`: host on top, software in
rows of five, products under their user; a router or firewall of the box in
the software row), any other in rows of five in member order.

## 5. Actions

### 5.1 What runs together

`together(doc)` gives the automatic groups:

* **A box:** a host, the software it `hosts`, the products only that
  software is an `instance-of` (as `graph.blocks`), a router it `hosts` and
  the firewall that router `filters`.
* **A router without a box:** the router and its firewall.

A component already in a cluster stays where it is and is left out; a group
of fewer than two is not made. Each group's id and label come from its host
or router (id made unique against existing clusters).

### 5.2 Where the actions are

* **Rail:** one icon, **K** (owner, 2026-09-25, after the first look):
  with nothing selected, *cluster · uncluster all* — with no clusters it
  makes what runs together, closed; else, if any is closed, it opens all;
  else it closes all, never removing one. With one selected, a cluster or a
  member of one, it opens or closes that cluster, which stays (a component
  in none: it says so). With several selected, clusters among them, it merges them into one
  cluster. Its tooltip says which.
* **C:** with two or more picked, cluster them (label: the first's, "+n");
  a member of another cluster moves over, dissolving one left with fewer
  than two. With a cluster selected, open or close it.
* **Component menu** (one or several picked): *Cluster 4 components* (C),
  *Delete 4 components* (Del); for a member, *Take out of "web01"*.
* **Cluster menu** (the closed node, or an open one's outline): *Open* /
  *Close* (C), *Rename* (F2), *Take out ›* its members, *Dissolve* (keeps
  the members), *Delete "web01" and 4 components* (Del).
* **Background menu:** *Cluster · uncluster all* (K), *Cluster what runs
  together* (makes the missing automatic groups, closed, even where
  hand-made ones exist).
* **The `?` list** gains C, K, Ctrl-click and Shift + drag.

Every refusal says why (`app.say`): *Select two or more to cluster*,
*Nothing runs together here*.

### 5.3 The inspector

A selected cluster shows its label (editable), open/closed, and its members,
each with its icon, selecting itself on click, its component menu on a
right-click (the inspector stays until an action needs the component), and
a × that takes it out.
Selecting a member of a closed cluster opens that member's form and lights
the cluster node; the cluster stays closed, so looking never edits the file.

**Dragging a member out** (owner, 2026-09-24; amended 2026-09-25): a
member's row can be picked up and dropped on the canvas, as a pin is from
its tray. Dropped on the canvas, it stays a member: a closed cluster draws
it beside its stack (`shown`), one outline round both, the stack's count
the rest; it stands where it was dropped (stored in this browser); its lines
are drawn to it again, those to members still stacked end at the stack.
The last stacked member dragged out opens the cluster. Dropped (from the
row, or dragged on the canvas) back onto its cluster, it goes back into the
stack; a component of another cluster or of none dropped onto a cluster
moves in. Opening or closing puts everyone together again. The ×, *Take
out* and *Dissolve* remove membership. Esc during the drag cancels it.
A right-click anywhere inside a cluster's outline, not on a component, is
the cluster's menu; *Dissolve* follows *Open*/*Close* in it.

**Dragging one onto another merges them** (owner, 2026-09-25). While a single
component or cluster is dragged on the canvas, what it is over lights up as
the target and draws it a little towards itself (12 % of the way, at most
12 px). Let go there: a component joins a cluster (or the cluster of an
open member) it is dropped on; a cluster dropped on a cluster gives it its
members, the target keeping its name; a cluster takes in a component it is
dropped on; two loose components become a closed cluster named after the
target. Already together, it only moved.

## 6. Units and tests

* **Rust (`effractor-core`, `effractor-format`).** `Architecture::clusters`;
  read, canonical write, round trip and JSON image of a clustered fixture;
  each validator error; a file without `clusters` unchanged.
* **Rust (`effractor-components`/`-solver`).** The lecture fixture and a
  clustered copy of it generate identical graphs and solve to identical
  results; no fingerprint moves.
* **`clusters.js` (pure, `node --test`).** `together` (the nmap fixture
  `imported.doc.json` collapses by host in one press of K); the edits
  (`cluster`, `takeOut`, `dissolve`, `rename`, `setClosed`, `toggleAll`, and
  `remove` of a member); the drawn image of a cluster: icon precedence, ring
  sectors, summed unknowns, pins, merged and hidden lines with counts, the
  permission rules; the rectangle hit test; group drag offsets and
  open/close in place; `moveTo` (a member dropped on another cluster).
* **The page** is checked by eye in a preview on 8081.

## 7. Not in this item

Nested clusters; clusters in the attack graph view; a component in two
clusters; drawing an open cluster's outline as anything but a rounded box;
more ring states than *vulnerable* and *has unknown inputs*.
