// dom.js: the page's DOM helpers, written once, and loaded before every page
// script that takes them from `window.effractorDom`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { element, runPage } = require("./fixtures/fake-dom.js");

function page() {
  const made = [];
  const byId = { here: element("div") };
  const document = {
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => element(tag),
    createElementNS: (ns, tag) => (made.push(ns), element(tag)),
  };
  const window = {};
  runPage("dom.js", { window, document });
  return { dom: window.effractorDom, byId, made };
}

test("$ finds an element by its id, and nothing for an id not on the page", () => {
  const { dom, byId } = page();
  assert.equal(dom.$("here"), byId.here);
  assert.equal(dom.$("elsewhere"), null);
});

test("el sets text and class only when given; 0 is text, null is none", () => {
  const { dom } = page();
  const both = dom.el("p", "words", "hint");
  assert.equal(both.tag, "p");
  assert.equal(both.textContent, "words");
  assert.equal(both.className, "hint");
  const bare = dom.el("div");
  assert.equal(bare.textContent, "");
  assert.equal(bare.className, undefined);
  assert.equal(dom.el("td", 0).textContent, 0);
  assert.equal(dom.el("td", null, "num").textContent, "");
});

test("svg makes an SVG element with its attributes set as attributes, and text when given", () => {
  const { dom, made } = page();
  const line = dom.svg("line", { x1: 48, class: "chart-grid" });
  assert.deepEqual(line.attrs, { x1: "48", class: "chart-grid" });
  assert.equal(line.textContent, "");
  assert.equal(dom.svg("text", {}, "50%").textContent, "50%");
  assert.equal(dom.svg("g").tag, "g", "no attributes at all");
  assert.deepEqual([...new Set(made)], ["http://www.w3.org/2000/svg"]);
});

test("download hands a text over as a named file, clicked once, and frees it a second later", () => {
  const blobs = [], freed = [], timers = [];
  const body = element("body");
  const link = Object.assign(element("a"), { clicks: 0, click() { link.clicks++; assert.equal(link.parent, body, "on the page when clicked"); } });
  const document = { body, createElement: (tag) => (assert.equal(tag, "a"), link) };
  const URL = { createObjectURL: (blob) => (blobs.push(blob), "blob:1"), revokeObjectURL: (url) => freed.push(url) };
  const Blob = function (parts, options) { this.text = parts.join(""); this.type = options.type; };
  const window = {};
  runPage("dom.js", { window, document, URL, Blob, setTimeout: (f, ms) => timers.push([f, ms]) });
  window.effractorDom.download("model.yaml", "a: 1\n", "text/yaml");
  assert.deepEqual(blobs.map((b) => [b.text, b.type]), [["a: 1\n", "text/yaml"]]);
  assert.equal(link.href, "blob:1");
  assert.equal(link.download, "model.yaml");
  assert.equal(link.clicks, 1);
  assert.equal(link.parent, null, "and gone after");
  assert.deepEqual(freed, []);
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 1000);
  timers[0][0]();
  assert.deepEqual(freed, ["blob:1"]);
});

test("dom.js loads before every page script that uses it", () => {
  const dir = path.join(__dirname, "../assets/js");
  const shell = fs.readFileSync(path.join(__dirname, "../crates/effractor-server/templates/shell.html"), "utf8");
  const scripts = [...shell.matchAll(/assets\/js\/([\w/.-]+\.js)"/g)].map((m) => m[1]);
  const at = scripts.indexOf("dom.js");
  assert.ok(at >= 0, "dom.js is loaded");
  const users = scripts.filter((f) => f !== "dom.js" && fs.readFileSync(path.join(dir, f), "utf8").includes("effractorDom"));
  assert.ok(users.length > 10, users.join(" "));
  for (const f of users) assert.ok(scripts.indexOf(f) > at, f + " loads after dom.js");
});
