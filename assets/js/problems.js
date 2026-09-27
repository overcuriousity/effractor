// What the validator says, as the page says it: components and flows by the
// labels on the canvas, what to do next where that can be worked out, and
// whether it stops the attack graph. Errors and `incomplete` parts do; an
// `unfinished` flow does not — its connection is unknown until its route is
// drawn. Where each one is set is attack-view.js's `sourceTarget`. Pure:
// node tests it.
(function () {
  var L = typeof module !== "undefined" ? require("./architecture-links.js") : window.effractorArchitectureLinks;

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function blocks(d) {
    return d.severity === "error" || d.code === "incomplete";
  }

  function label(doc, id) {
    if (has(doc.entities, id)) return doc.entities[id].label || id;
    if (has(doc.flows, id)) return doc.flows[id].label || id;
    return null;
  }

  // `"web"` → `“Web shop”`, for every quoted id that is a component or a flow.
  function named(doc, message) {
    return String(message).replace(/"([a-z0-9][a-z0-9-]*)"/g, function (all, id) {
      var name = label(doc, id);
      return name === null ? all : "“" + name + "”";
    });
  }

  // The validator's message in the form's words: Time and Reason, not the
  // file's ttc and note; the file's clause after the colon left to the
  // tooltip. What is not known here keeps its words, without backticks.
  var PLAIN = [
    [/^`(\w+)` needs a `ttc`$/, "$1 needs a time"],
    [/^`calibrated` needs a nonempty `note`.*$/, "calibrated needs a reason"],
    [/^an unknown parameter has no `ttc`.*$/, "Unknown keeps no time"],
    [/ is an instance of no product yet:.*$/, " has no product yet"],
    [/ has no `permits` association for this flow.*$/, " neither allows nor blocks this flow"],
    [/ (yet|in plaintext): (no `|`).*$/, " $1"],
  ];
  function plain(message) {
    var text = String(message);
    for (var i = 0; i < PLAIN.length; i++) {
      if (PLAIN[i][0].test(text)) return text.replace(PLAIN[i][0], PLAIN[i][1]);
    }
    return text.replace(/`/g, "");
  }

  function list(words) {
    return words.length < 2 ? words.join("") : words.slice(0, -1).join(", ") + " or " + words[words.length - 1];
  }

  // What is missing, by the kind of the component it is missing from.
  var MISSING = { application: "Tab adds its host · L links one", service: "Tab adds its host · L links one", firewall: "Tab on a router adds one · L links a router" };

  // What would put a problem right, in a few words; null when there is
  // nothing to add to what the message says.
  function hint(doc, d) {
    if (d.code === "incomplete") {
      if (d.path === "attacker.target") return "choose a component";
      if (d.path === "attacker.footholds") return "choose a component";
      var e = /^entities\.([a-z0-9][a-z0-9-]*)$/.exec(d.path || "");
      if (!e || !has(doc.entities, e[1])) return null;
      // A service owes a host and a product; the message says which.
      if (/instance of no product/.test(d.message || "")) return "Tab adds its product · L links one";
      return MISSING[doc.entities[e[1]].kind] || null;
    }
    var m = /^flows\.([a-z0-9][a-z0-9-]*)\.route(?:\[(\d+)\])?$/.exec(d.path || "");
    if (!m || d.code !== "unfinished" || !has(doc.flows, m[1])) return null;
    var flow = doc.flows[m[1]];
    var route = flow.route || [];
    var at = m[2] === undefined ? null : Number(m[2]);
    // A router on the route whose firewall has no permission for the flow.
    if (at !== null && at % 2 === 1 && route[at]) return "allow or block it in this flow";
    var near = L.nearHops(doc, flow).slice(0, 3).map(function (id) {
      return label(doc, id);
    });
    return near.length ? "next: " + list(near) : L.emptyHop(doc, flow);
  }

  // Blocking problems first, each once, in plain words.
  function items(doc, diagnostics) {
    var seen = Object.create(null);
    var out = [];
    (diagnostics || []).forEach(function (d) {
      var key = d.path + "\u0000" + d.message;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ text: named(doc, plain(d.message)), raw: d.message, hint: hint(doc, d), blocks: blocks(d), path: d.path });
    });
    return out.filter(function (i) { return i.blocks; }).concat(out.filter(function (i) { return !i.blocks; }));
  }

  // Why there is no attack graph, in one line; null when nothing stops it.
  function headline(diagnostics) {
    var n = (diagnostics || []).filter(blocks).length;
    if (!n) return null;
    return "no attack graph · " + n + (n === 1 ? " thing" : " things") + " to finish";
  }

  // What blocks, by the component it is set on: {id: [message]}, for the
  // canvas and the outline to mark before anyone asks for the graph.
  function perComponent(diagnostics) {
    var out = Object.create(null);
    (diagnostics || []).forEach(function (d) {
      var m = blocks(d) && /^entities\.([a-z0-9][a-z0-9-]*)(?:[.[]|$)/.exec(d.path || "");
      if (!m) return;
      (out[m[1]] = out[m[1]] || []).push(d.message);
    });
    return out;
  }

  // Which diagnostic says why the format refused a text: its first error;
  // a note that happened to come first is not the reason.
  function refusal(diagnostics) {
    var all = diagnostics || [];
    for (var i = 0; i < all.length; i++) if (all[i].severity === "error") return all[i];
    return all[0] || null;
  }

  var api = { blocks: blocks, refusal: refusal, perComponent: perComponent, plain: plain, named: named, hint: hint, items: items, headline: headline };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorProblems = api;
})();
