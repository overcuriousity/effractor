// Sharing with people (people-ui.js) over the least DOM it needs: what the
// page looks like is checked by eye, the order of answers here.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { element } = require("./fixtures/fake-dom.js");

function peopleDialog() {
  const nodes = new Map();
  const asked = [], timers = [];
  const make = (tag) => {
    const el = Object.assign(element(tag), { style: {}, dataset: {} });
    Object.defineProperty(el, "innerHTML", { get: () => "", set: () => { el.children = []; } });
    return el;
  };
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, make("div")); return nodes.get(id); },
    createElement: make,
    createTextNode: (text) => Object.assign(element("#text"), { textContent: text }),
  };
  const window = {
    effractorMenu: { dropdown: () => make("div") },
    effractorAccounts: { client: { request: (method, path) => new Promise((resolve) => asked.push({ method, path, resolve })) } },
  };
  vm.runInNewContext(readFileSync("assets/js/accounts/people-ui.js", "utf8"), {
    window, document,
    setTimeout: (f) => timers.push(f), clearTimeout() {},
  });
  const field = document.getElementById("share-people-name");
  const list = document.getElementById("share-people-suggest");
  return {
    asked, list,
    // A name typed, and the pause after it.
    type(text) {
      field.value = text;
      field.listeners.input.forEach((f) => f({}));
      timers.splice(0).forEach((f) => f());
    },
    shown: () => list.children.map((li) => li.children[0] ? li.children[0].textContent : li.textContent),
  };
}

const settle = () => new Promise(setImmediate);

test("a suggestion for an earlier spelling that answers late is not shown", async () => {
  const d = peopleDialog();
  d.type("a");
  d.type("al");
  d.asked[1].resolve({ ok: true, status: 200, data: [{ kind: "user", name: "alice" }] });
  await settle();
  assert.deepEqual(d.shown(), ["alice"]);
  d.asked[0].resolve({ ok: true, status: 200, data: [{ kind: "user", name: "anna" }, { kind: "user", name: "alice" }] });
  await settle();
  assert.deepEqual(d.shown(), ["alice"], "the list is still the one for what is typed");
});

test("a name cleared before its suggestions arrive shows none", async () => {
  const d = peopleDialog();
  d.type("al");
  d.type("");
  d.asked[0].resolve({ ok: true, status: 200, data: [{ kind: "user", name: "alice" }] });
  await settle();
  assert.equal(d.list.hidden, true);
  assert.deepEqual(d.shown(), []);
});
