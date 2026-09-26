// The Documents tab's logic (accounts spec §9.2), pure: the server's flat
// listing becomes "my documents" and "shared with me" trees; search pruning;
// the way to a document; what a role offers; where something may move.
(function () {
  var collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }) : null;
  function byName(a, b) {
    var x = a.name || (a.folder && a.folder.name) || "", y = b.name || (b.folder && b.folder.name) || "";
    return collator ? collator.compare(x, y) : x < y ? -1 : x > y ? 1 : 0;
  }

  function build(listing) {
    var folders = listing.folders || [], docs = listing.documents || [];
    var nodes = Object.create(null);
    folders.forEach(function (f) { nodes[f.id] = { folder: f, folders: [], documents: [] }; });
    var mine = { folder: null, folders: [], documents: [] };
    var sharedRoots = Object.create(null); // owner -> root node

    function rootFor(owner) {
      if (owner === listing.me) return mine;
      return sharedRoots[owner] || (sharedRoots[owner] = { folder: null, folders: [], documents: [] });
    }
    folders.forEach(function (f) {
      var parent = f.parent != null && nodes[f.parent] && nodes[f.parent].folder.owner === f.owner ? nodes[f.parent] : rootFor(f.owner);
      parent.folders.push(nodes[f.id]);
    });
    docs.forEach(function (d) {
      var parent = d.folder != null && nodes[d.folder] ? nodes[d.folder] : rootFor(d.owner);
      parent.documents.push(d);
    });
    function sort(node) {
      node.folders.sort(byName);
      node.documents.sort(byName);
      node.folders.forEach(sort);
      return node;
    }
    sort(mine);
    var byId = Object.create(null);
    docs.forEach(function (d) { byId[d.id] = d; });
    return {
      recent: (listing.recent || []).map(function (id) { return byId[id]; }).filter(Boolean),
      mine: mine,
      shared: Object.keys(sharedRoots).sort().map(function (owner) {
        var root = sort(sharedRoots[owner]);
        return { owner: owner, nodes: root.folders.concat(root.documents.map(function (d) {
          return { folder: null, folders: [], documents: [d] };
        })) };
      }),
    };
  }

  function prune(node) {
    var folders = node.folders.map(prune).filter(function (n) {
      return n.documents.length || n.folders.length;
    });
    return { folder: node.folder, folders: folders, documents: node.documents };
  }

  function ancestors(listing, docId) {
    var doc = (listing.documents || []).filter(function (d) { return d.id === docId; })[0];
    if (!doc) return [];
    var byId = Object.create(null);
    (listing.folders || []).forEach(function (f) { byId[f.id] = f; });
    var out = [], at = doc.folder, guard = 0;
    while (at != null && byId[at] && guard++ < 64) {
      out.unshift(at);
      at = byId[at].parent;
    }
    return out;
  }

  function pathOf(listing, docId) {
    var byId = Object.create(null);
    (listing.folders || []).forEach(function (f) { byId[f.id] = f; });
    return ancestors(listing, docId).map(function (id) { return byId[id].name; });
  }

  // The name is content (the YAML's name:), so whoever may edit may rename
  // (owner, 2026-09-26); moving, sharing and deleting are the owner's.
  function offers(role) {
    var owner = role === "owner";
    return { open: true, rename: owner || role === "editor", move: owner, share: owner, remove: owner };
  }

  function moveTargets(listing, kind, id) {
    var own = (listing.folders || []).filter(function (f) { return f.owner === listing.me; });
    function children(parent) {
      return own.filter(function (f) {
        return (f.parent == null ? null : f.parent) === parent && !(kind === "folder" && f.id === id);
      }).sort(byName).map(function (f) {
        var kids = children(f.id);
        var t = { id: f.id, name: f.name };
        if (kids.length) t.children = kids;
        return t;
      });
    }
    return [{ id: null, name: "Top level" }].concat(children(null));
  }

  // A saved document's row, changed where it was saved (a new name, a new
  // version) without asking the server for the whole listing again.
  function patch(listing, id, fields) {
    if (!listing || !(listing.documents || []).some(function (d) { return d.id === id; })) return listing;
    var out = Object.assign({}, listing);
    out.documents = listing.documents.map(function (d) {
      return d.id === id ? Object.assign({}, d, fields) : d;
    });
    return out;
  }

  function startsFresh(origin, loggedIn) {
    return !!loggedIn && (origin === "server" || origin === "new" || origin === "file");
  }

  var api = { build: build, prune: prune, ancestors: ancestors, pathOf: pathOf, offers: offers,
    moveTargets: moveTargets, patch: patch, startsFresh: startsFresh };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") {
    window.effractorAccounts = window.effractorAccounts || {};
    window.effractorAccounts.documents = api;
  }
})();
