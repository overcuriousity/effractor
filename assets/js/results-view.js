// Results → what the panels and the canvas show. Pure: numbers in, text and
// class names out. The solver decides what is true; this decides how it reads.
(function () {
  // Fixed, so a colour means the same in every model and on both sides of a
  // diff (spec 7.3): <0.01 · <0.05 · <0.2 · <0.5 · ≥0.5.
  var THRESHOLDS = [0.01, 0.05, 0.2, 0.5];

  // Tooltips for the terms that need one.
  var HINTS = {
    "Fussell-Vesely": "Share of the root's probability through this leaf — what to fix first",
    Birnbaum: "Change in the root's probability per change in this leaf's probability — how critical its place is, however likely it is",
  };

  function bin(v) {
    if (typeof v !== "number" || v !== v) return null;
    var b = 1;
    THRESHOLDS.forEach(function (t) {
      if (v >= t) b += 1;
    });
    return b;
  }

  // How the page says its numbers, in one place. A probability keeps three
  // digits, trailing zeros too; a quantity (a time, an amount, a count) is
  // grouped in threes from 1000 and short below; money is the model's
  // currency in whole units. What is no number reads "—".
  function grouped(n) {
    return String(n).replace(/\B(?=(\d{3})+$)/g, " ");
  }

  function probability(p) {
    if (typeof p !== "number" || !isFinite(p)) return "—";
    if (p === 0) return "0";
    return Math.abs(p) < 1e-4 ? p.toExponential(2) : p.toPrecision(3);
  }

  function number(v) {
    if (typeof v !== "number" || v !== v) return "—";
    if (!isFinite(v)) return v > 0 ? "∞" : "−∞";
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a < 1e-4 || a >= 1e15) return v.toExponential(2);
    if (a >= 999.5) return grouped(Math.round(v));
    return String(Number(v.toPrecision(3)));
  }

  function money(value, currency) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: currency, maximumFractionDigits: 0 }).format(value);
    } catch (e) {
      var n = new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
      return currency ? n + " " + currency : n;
    }
  }

  // A count of cut sets as the solver writes it: a decimal string, since it
  // can pass what JSON numbers hold. The solver stops counting at the largest
  // count it can hold; past that there are more.
  var COUNT_MAX = "340282366920938463463374607431768211455";
  function count(cuts) {
    var t = String(cuts.total);
    if (cuts.saturated || t === COUNT_MAX) return "more than 3.4e38";
    return t.length > 15 ? Number(t).toExponential(2) : grouped(t);
  }

  function short(v) {
    if (v === 0) return "0";
    return v < 0.001 ? "<.001" : String(Number(v.toPrecision(2)));
  }

  // By leaf id, for the renderer: a class for the bin, the value printed in
  // the symbol, and a tag for a single point of failure — colour is never the
  // only channel.
  function leafStyles(results, measure) {
    var styles = Object.create(null);
    (results.leaves || []).forEach(function (leaf) {
      var b = bin(leaf[measure]);
      styles[leaf.id] = {
        classes: b ? ["imp-" + b] : [],
        // Two digits fit a symbol; the panel has the rest.
        value: b ? short(leaf[measure]) : null,
        tag: leaf.spof ? "SPOF" : null,
      };
    });
    return styles;
  }

  function rankCutSets(sets) {
    var known = function (s) {
      return typeof s.probability === "number";
    };
    return sets
      .slice()
      .sort(function (a, b) {
        if (known(a) !== known(b)) return known(a) ? -1 : 1;
        if (known(a) && a.probability !== b.probability) return b.probability - a.probability;
        if (a.leaves.length !== b.leaves.length) return a.leaves.length - b.leaves.length;
        return a.leaves.join("\u0000") < b.leaves.join("\u0000") ? -1 : 1;
      })
      .map(function (s, i) {
        return { rank: i + 1, leaves: s.leaves, probability: s.probability, text: probability(s.probability), spof: s.leaves.length === 1 };
      });
  }

  // What the solver could not say, or said only in part. Never silent.
  function reasons(results) {
    var out = [];
    var cuts = results.cut_sets || {};
    if (cuts.unavailable) out.push("Cut sets: " + cuts.unavailable.reason);
    else if (cuts.available && cuts.available.truncated) {
      out.push("Cut sets: " + cuts.available.truncated + " (" + count(cuts.available) + " in all)");
    }
    if (results.exact && results.exact.unavailable) out.push("Exact results: " + results.exact.unavailable.reason);
    else if (results.exact && results.exact.available && results.exact.available.fussell_vesely_unavailable) {
      out.push(results.exact.available.fussell_vesely_unavailable);
    }
    if (results.sampled && results.sampled.unavailable) out.push("Sampled results: " + results.sampled.unavailable.reason);
    else if (results.sampled && results.sampled.available && results.sampled.available.loss_unavailable) {
      out.push("Expected loss: " + results.sampled.available.loss_unavailable);
    }
    if (results.attacker && results.attacker.unavailable) out.push("Attacker: " + results.attacker.unavailable.reason);
    return out;
  }

  function find(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function nodeFacts(results, id) {
    if (!results) return [];
    var facts = [];
    var node = find(results.nodes, id);
    if (node) {
      facts.push(["P within horizon", probability(node.p_exact)]);
      facts.push(["sampled", probability(node.p_sampled)]);
    }
    var leaf = find(results.leaves, id);
    if (leaf) {
      facts.push(["Fussell-Vesely", probability(leaf.fussell_vesely)]);
      facts.push(["Birnbaum", probability(leaf.birnbaum)]);
      facts.push(["single point of failure", leaf.spof ? "yes" : "no"]);
    }
    return facts;
  }

  function rowsContaining(ranked, id) {
    var rows = [];
    ranked.forEach(function (s, i) {
      if (id !== null && s.leaves.indexOf(id) >= 0) rows.push(i);
    });
    return rows;
  }

  // The controls of the document, with what the last solve said each is worth.
  // Ranked ones first, best buy on top; then the enabled ones; without results,
  // the document's order. `close`: the interval of its value reaches another
  // ranked control's value — more samples would settle which is better.
  function controlRows(doc, results) {
    var controls = (doc && doc.controls) || {};
    var solved = (results && results.controls && results.controls.available) || null;
    var rows = Object.keys(controls).map(function (id, index) {
      var r = solved ? find(solved.controls, id) : null;
      return {
        id: id,
        label: controls[id].label || id,
        enabled: !!controls[id].enabled,
        cost: typeof controls[id].cost === "number" ? controls[id].cost : null,
        effects: (controls[id].effects || []).length,
        order: index,
        rank: r && r.rank != null ? r.rank : null,
        value: r ? r.value : null,
        ci: (r && r.value_ci) || null,
        perCost: r && r.value_per_cost != null ? r.value_per_cost : null,
        unavailable: (r && r.unavailable) || null,
        close: false,
      };
    });
    var ranked = rows.filter(function (row) { return row.rank !== null; });
    ranked.forEach(function (row) {
      row.close = !!row.ci && ranked.some(function (other) {
        return other !== row && other.value >= row.ci.lo && other.value <= row.ci.hi;
      });
    });
    return rows.sort(function (a, b) {
      if ((a.rank === null) !== (b.rank === null)) return a.rank === null ? 1 : -1;
      return a.rank !== null ? a.rank - b.rank : a.order - b.order;
    });
  }

  var api = { HINTS: HINTS, bin: bin, grouped: grouped, probability: probability, number: number, money: money, count: count, leafStyles: leafStyles, rankCutSets: rankCutSets, reasons: reasons, nodeFacts: nodeFacts, rowsContaining: rowsContaining, controlRows: controlRows };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorResults = api;
})();
