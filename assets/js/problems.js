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

  function list(words) {
    return words.length < 2 ? words.join("") : words.slice(0, -1).join(", ") + " or " + words[words.length - 1];
  }

  // What is missing, by the kind of the component it is missing from.
  var MISSING = { application: "Tab adds its host", service: "Tab adds its host", firewall: "Tab on a router adds one" };

  // What would put a problem right, in a few words; null when there is
  // nothing to add to what the message says.
  function hint(doc, d) {
    if (d.code === "incomplete") {
      if (d.path === "attacker.target") return "select a component · Target";
      if (d.path === "attacker.footholds") return "select a component · Foothold";
      var e = /^entities\.([a-z0-9][a-z0-9-]*)$/.exec(d.path || "");
      return e && has(doc.entities, e[1]) ? MISSING[doc.entities[e[1]].kind] || null : null;
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
      out.push({ text: named(doc, d.message), hint: hint(doc, d), blocks: blocks(d), path: d.path });
    });
    return out.filter(function (i) { return i.blocks; }).concat(out.filter(function (i) { return !i.blocks; }));
  }

  // Why there is no attack graph, in one line; null when nothing stops it.
  function headline(diagnostics) {
    var n = (diagnostics || []).filter(blocks).length;
    if (!n) return null;
    return "no attack graph · " + n + (n === 1 ? " thing" : " things") + " to finish";
  }

  var api = { blocks: blocks, named: named, hint: hint, items: items, headline: headline };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorProblems = api;
})();
