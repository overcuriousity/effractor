const { test } = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { element: base } = require("./fixtures/fake-dom.js");
const { rebuild, textField, keyElsewhere } = require("../assets/js/app.js");

// The tree editor over the least DOM it needs: fields that take focus, a
// caret, and are found by id. Not a browser — what it looks like is looked at.
function page() {
  const document = { activeElement: null, body: null };
  const roots = new Map();
  const within = (root, test, out = []) => {
    if (test(root)) out.push(root);
    root.children.forEach((c) => within(c, test, out));
    return out;
  };
  function element(tag) {
    const el = base(tag);
    el.tagName = String(tag).toUpperCase();
    el.focus = () => { document.activeElement = el; };
    el.dispatchEvent = (ev) => (el.listeners[ev.type] || []).slice().forEach((f) => f(ev));
    // Leaving a field: a browser's change only after typing, then blur.
    el.blur = () => { document.activeElement = null; el.dispatchEvent({ type: "blur" }); };
    el.select = () => {};
    el.setSelectionRange = (start, end) => { el.selectionStart = start; el.selectionEnd = end; };
    el.style = { setProperty() {} };
    el.showModal = () => {};
    el.close = () => {};
    el.contains = (x) => { for (let a = x; a; a = a.parent) if (a === el) return true; return false; };
    el.querySelector = () => null;
    el.querySelectorAll = (sel) => within(el, (e) => e !== el && sel.split(", ").includes(e.tag));
    return el;
  }
  document.getElementById = (id) => {
    for (const r of roots.values()) { const f = within(r, (e) => e.id === id)[0]; if (f) return f; }
    const e = element("div"); e.id = id; e.hidden = true; roots.set(id, e); return e;
  };
  document.createElement = element;
  document.createElementNS = (_, t) => element(t);
  document.querySelectorAll = () => [];
  document.querySelector = () => null;
  document.addEventListener = () => {};
  document.body = element("body");
  const listeners = [];
  const doc = { profile: "fault-tree", name: "x", horizon: 1, top: "top", nodes: { top: { label: "Top", gate: "or", children: ["a"] }, a: { label: "New event", leaf: "basic" } } };
  const app = {
    state: { doc, selected: "a", parent: "top", parentChosen: true },
    onChange: (f) => listeners.push(f), renderer: { on() {} }, select(id) { app.state.selected = id; }, say() {},
    canUndo: () => false, canRedo: () => false, solver: { sketch: () => new Promise(() => {}) }, applyEdit: async () => true,
    rebuild: (box, key, build) => rebuild(document, box, key, build), textField, keyElsewhere: (e) => keyElsewhere(document, e),
  };
  const window = {
    effractor: app, effractorEdit: require("../assets/js/edit.js"), effractorProfiles: require("../assets/js/profiles.js"),
    effractorMenu: { dropdown: (opts, v) => { const b = element("button"); b.value = v; return b; } },
    effractorGraph: { inscription: () => "≥1" }, effractorTtc: {}, innerWidth: 1000, innerHeight: 800,
  };
  vm.runInNewContext(readFileSync("assets/js/editor.js", "utf8"), { window, document, console, setTimeout, Event: function () {} });
  const notify = () => listeners.forEach((f) => f());
  notify(); // the form for the selected node
  return { app, document, notify, $: (id) => document.getElementById(id) };
}

test("a label being typed survives the page being drawn again (a solve arriving)", () => {
  const p = page();
  const label = p.$("prop-label");
  label.focus();
  label.value = "Phishing mail";
  label.setSelectionRange(8, 8);
  p.notify();
  const again = p.$("prop-label");
  assert.notEqual(again, label, "the form was built again");
  assert.equal(again.value, "Phishing mail");
  assert.equal(p.document.activeElement, again);
  assert.equal(again.selectionStart, 8);
  // Left without another key, it is committed all the same.
  const edits = [];
  p.app.applyEdit = async (edit) => (edits.push(edit), true);
  again.blur();
  assert.equal(edits.length, 1);
  assert.equal(edits[0].doc.nodes[edits[0].select].label, "Phishing mail");
});

test("what the document changed under a field wins over what was typed there, and another node's form starts clean", () => {
  const p = page();
  p.$("prop-label").focus();
  p.$("prop-label").value = "Phishing mail";
  p.app.state.doc = { ...p.app.state.doc, nodes: { ...p.app.state.doc.nodes, a: { label: "Renamed elsewhere", leaf: "basic" } } };
  p.notify();
  assert.equal(p.$("prop-label").value, "Renamed elsewhere");
  p.$("prop-label").value = "typed";
  p.app.state.doc = { ...p.app.state.doc, nodes: { ...p.app.state.doc.nodes, top: { label: "Renamed elsewhere", gate: "or", children: ["a"] } } };
  p.app.state.selected = "top";
  p.app.state.parent = null;
  p.notify();
  assert.equal(p.$("prop-label").value, "Renamed elsewhere", "the typing was about another node");
});

test("a checkbox or a button is not a field typed into: Ctrl+Z there is the document's", () => {
  const el = (tagName, type) => ({ tagName, type });
  assert.equal(textField(el("INPUT", "checkbox")), false);
  assert.equal(textField(el("INPUT", "radio")), false);
  assert.equal(textField(el("BUTTON")), false);
  assert.equal(textField(el("INPUT", "text")), true);
  assert.equal(textField(el("INPUT", "number")), true);
  assert.equal(textField(el("INPUT")), true);
  assert.equal(textField(el("TEXTAREA")), true);
  assert.equal(textField(null), false);
});

test("the tree's and the canvas's keys are not taken from a field, a link, a menu or an open dialog", () => {
  const target = (tagName, inside) => ({ tagName, closest: (sel) => (inside && sel.split(", ").includes(inside) ? {} : null) });
  const doc = (dialog) => ({ querySelector: (sel) => (sel === "dialog[open]" && dialog ? {} : null) });
  assert.equal(keyElsewhere(doc(false), { target: target("svg") }), false);
  assert.equal(keyElsewhere(doc(true), { target: target("svg") }), true, "a dialog open over the page");
  assert.equal(keyElsewhere(doc(false), { target: target("A") }), true);
  assert.equal(keyElsewhere(doc(false), { target: target("INPUT") }), true);
  assert.equal(keyElsewhere(doc(false), { target: target("BUTTON", ".menu") }), true);
});
