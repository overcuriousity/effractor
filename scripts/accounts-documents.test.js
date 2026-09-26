const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../assets/js/accounts/documents.js");

const listing = {
  me: "alice",
  recent: [3],
  folders: [
    { id: 1, parent: null, name: "Plans", owner: "alice", role: "owner" },
    { id: 2, parent: 1, name: "archive", owner: "alice", role: "owner" },
    { id: 7, parent: 6, name: "Shared inside", owner: "bob", role: "editor" },
    { id: 6, parent: null, name: "Bob's team", owner: "bob", role: "editor" },
    { id: 9, parent: 8, name: "Carol's", owner: "carol", role: "viewer" },
  ],
  documents: [
    { id: 3, folder: 2, name: "web tier", profile: "architecture", owner: "alice", role: "owner" },
    { id: 4, folder: null, name: "Alpha", profile: "fault-tree", owner: "alice", role: "owner" },
    { id: 5, folder: 7, name: "DMZ", profile: "architecture", owner: "bob", role: "editor" },
    { id: 10, folder: 99, name: "Loose one", profile: "attack-tree", owner: "carol", role: "viewer" },
  ],
};

test("mine and shared-with-me are separate trees, shared grouped by owner", () => {
  const t = D.build(listing);
  assert.deepEqual(t.mine.folders.map((n) => n.folder.name), ["Plans"]);
  assert.deepEqual(t.mine.documents.map((d) => d.name), ["Alpha"]);
  assert.deepEqual(t.mine.folders[0].folders[0].documents.map((d) => d.id), [3]);
  assert.deepEqual(t.shared.map((s) => s.owner), ["bob", "carol"]);
  const bob = t.shared[0].nodes;
  assert.equal(bob.length, 1, "a shared folder's inside is under it, not beside it");
  assert.equal(bob[0].folder.name, "Bob's team");
  assert.equal(bob[0].folders[0].documents[0].name, "DMZ");
  const carol = t.shared[1].nodes;
  assert.deepEqual(carol.map((n) => (n.folder ? n.folder.name : n.documents[0].name)).sort(), ["Carol's", "Loose one"],
    "an item whose folder is not visible is a root");
  assert.deepEqual(t.recent.map((d) => d.id), [3]);
});

test("names sort as people read them", () => {
  const t = D.build({ me: "a", recent: [], folders: [], documents: [
    { id: 1, folder: null, name: "beta", owner: "a" }, { id: 2, folder: null, name: "Alpha", owner: "a" },
    { id: 3, folder: null, name: "gamma 10", owner: "a" }, { id: 4, folder: null, name: "gamma 9", owner: "a" }] });
  assert.deepEqual(t.mine.documents.map((d) => d.name), ["Alpha", "beta", "gamma 9", "gamma 10"]);
});

test("pruning keeps only folders on the way to a hit", () => {
  const t = D.build({ ...listing, documents: listing.documents.filter((d) => d.id === 3) });
  const pruned = D.prune(t.mine);
  assert.equal(pruned.folders.length, 1);
  assert.equal(pruned.folders[0].folders[0].documents[0].id, 3);
  const empty = D.prune(D.build({ me: "alice", recent: [], folders: listing.folders, documents: [] }).mine);
  assert.equal(empty.folders.length, 0);
});

test("reveal and path go from the root down", () => {
  assert.deepEqual(D.ancestors(listing, 3), [1, 2]);
  assert.deepEqual(D.pathOf(listing, 3), ["Plans", "archive"]);
  assert.deepEqual(D.pathOf(listing, 4), []);
  assert.deepEqual(D.ancestors(listing, 404), []);
});

test("what each role offers", () => {
  assert.deepEqual(D.offers("owner"), { open: true, rename: true, move: true, share: true, remove: true });
  assert.deepEqual(D.offers("editor"), { open: true, rename: false, move: false, share: false, remove: false });
  assert.deepEqual(D.offers("viewer"), D.offers("editor"));
});

test("a folder cannot be moved into itself or below itself", () => {
  const targets = D.moveTargets(listing, "folder", 1);
  assert.deepEqual(targets.map((t) => t.name), ["Top level"], "Plans's only other place is the top");
  const forDoc = D.moveTargets(listing, "document", 3);
  assert.deepEqual(forDoc.map((t) => t.name), ["Top level", "Plans"]);
  assert.deepEqual(forDoc[1].children.map((t) => t.name), ["archive"]);
});

test("while logged in, a document from the server or a new one starts a fresh history", () => {
  assert.equal(D.startsFresh("server", true), true);
  assert.equal(D.startsFresh("new", true), true);
  assert.equal(D.startsFresh("file", true), true);
  assert.equal(D.startsFresh("link", true), false);
  assert.equal(D.startsFresh("server", false), false);
});
