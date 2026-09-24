// What each kind of component looks like: a line drawing on a 24-unit grid,
// after the conventions network diagrams share — Cisco's cloud, router,
// firewall and server; a window, a gear, a box, a badge, a key, a person and a
// cylinder for the rest — and the family whose colour its plate wears. Pure
// data and one builder.
(function () {
  var ICONS = {
    // A cloud: a network, its details abstracted away.
    network: [["path", { d: "M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18z" }]],
    // A puck with traffic crossing it both ways.
    router: [
      ["circle", { cx: 12, cy: 12, r: 9 }],
      ["path", { d: "M7 10h9.5M14 7.5l2.5 2.5-2.5 2.5M17 14H7.5M10 11.5 7.5 14l2.5 2.5" }],
    ],
    // A brick wall.
    firewall: [
      ["rect", { x: 3, y: 5, width: 18, height: 14, rx: 1 }],
      ["path", { d: "M3 9.67h18M3 14.33h18M9 5v4.67M15 5v4.67M6 9.67v4.66M12 9.67v4.66M18 9.67v4.66M9 14.33V19M15 14.33V19" }],
    ],
    // A server tower: drive bays and a power light.
    host: [
      ["rect", { x: 6.5, y: 3, width: 11, height: 18, rx: 1.5 }],
      ["path", { d: "M9 7h6M9 10h6" }],
      ["circle", { cx: 12, cy: 16.5, r: 1 }],
    ],
    // A program's window: a title bar over its content.
    application: [
      ["rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
      ["path", { d: "M3 9h18M6 7h.01M8.5 7h.01M7 13h6M7 15.5h9" }],
    ],
    // A gear: something that runs and answers.
    service: [
      ["circle", { cx: 12, cy: 12, r: 6.5 }],
      ["circle", { cx: 12, cy: 12, r: 2.5 }],
      ["path", { d: "M18.5 12H21M16.6 16.6l1.76 1.76M12 18.5V21M7.4 16.6l-1.76 1.76M5.5 12H3M7.4 7.4 5.64 5.64M12 5.5V3M16.6 7.4l1.76-1.76" }],
    ],
    // A box: a packaged software version.
    product: [["path", { d: "M12 3 20 7.5v9L12 21l-8-4.5v-9z" }], ["path", { d: "M4 7.5 12 12l8-4.5M12 12v9" }]],
    // An ID badge: an identity, not a human.
    account: [
      ["rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
      ["circle", { cx: 9, cy: 11, r: 2 }],
      ["path", { d: "M6 16.5a3 3 0 0 1 6 0M14.5 10h4M14.5 13.5h4" }],
    ],
    // A person.
    person: [
      ["circle", { cx: 12, cy: 8, r: 4 }],
      ["path", { d: "M4.5 20.5a7.5 7.5 0 0 1 15 0" }],
    ],
    // A key.
    credential: [
      ["circle", { cx: 7.5, cy: 15.5, r: 4 }],
      ["path", { d: "M10.4 12.6 20 3M16 7l3 3M13.5 9.5l2 2" }],
    ],
    // A cylinder: stored records.
    data: [
      ["path", { d: "M5 6c0-1.66 3.13-3 7-3s7 1.34 7 3-3.13 3-7 3-7-1.34-7-3z" }],
      ["path", { d: "M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" }],
      ["path", { d: "M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" }],
    ],
  };
  var FAMILY = {
    network: "network", router: "network", firewall: "network",
    host: "compute", application: "compute", service: "compute", product: "compute",
    account: "identity", credential: "identity", person: "identity",
    data: "data",
  };
  var DOT = [["circle", { cx: 12, cy: 12, r: 3 }]];

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  // [[tag, attributes]] for `kind`; a kind this file does not know is a dot.
  function parts(kind) {
    return has(ICONS, kind) ? ICONS[kind] : DOT;
  }

  function family(kind) {
    return has(FAMILY, kind) ? FAMILY[kind] : null;
  }

  // A standalone <svg> of `size` px, for a menu or the legend: lines only,
  // in the colour of the text around it.
  function svg(doc, kind, size) {
    var NS = "http://www.w3.org/2000/svg";
    var out = doc.createElementNS(NS, "svg");
    out.setAttribute("viewBox", "0 0 24 24");
    out.setAttribute("width", size);
    out.setAttribute("height", size);
    out.setAttribute("aria-hidden", "true");
    out.setAttribute("class", "kind-icon family-" + (family(kind) || "none"));
    parts(kind).forEach(function (part) {
      var e = doc.createElementNS(NS, part[0]);
      Object.keys(part[1]).forEach(function (k) {
        e.setAttribute(k, part[1][k]);
      });
      out.appendChild(e);
    });
    return out;
  }

  var api = { parts: parts, family: family, svg: svg };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureIcons = api;
})();
