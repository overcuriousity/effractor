const { test } = require("node:test");
const assert = require("node:assert");
const { lineRange, problemText } = require("../assets/js/source.js");

test("a diagnostic's line is a range of the text, to select it in the textarea", () => {
  const text = "effractor: 1\nname: Two\n\ntop: x";
  assert.deepEqual(lineRange(text, 1), [0, 12]);
  assert.deepEqual(lineRange(text, 2), [13, 22]);
  assert.deepEqual(lineRange(text, 3), [23, 23], "an empty line");
  assert.deepEqual(lineRange(text, 4), [24, 30], "the last line has no line break");
  // Off the ends: the nearest line, never a throw.
  assert.deepEqual(lineRange(text, 0), [0, 12]);
  assert.deepEqual(lineRange(text, 99), [24, 30]);
  assert.deepEqual(lineRange("", 1), [0, 0]);
});

test("a problem is said with its place, when it has one", () => {
  assert.equal(problemText({ message: "unknown key", line: 7, col: 3, path: "nodes.a.lable" }), "7:3  unknown key");
  assert.equal(problemText({ message: "unknown key", line: 7, col: null, path: "" }), "7  unknown key");
  assert.equal(problemText({ message: "a cycle", line: null, path: "nodes.a" }), "nodes.a  a cycle");
  assert.equal(problemText({ message: "empty", line: null, path: "" }), "empty");
});

const { pathLine } = require("../assets/js/source.js");
const ARCH = [
  "effractor: 2",
  "profile: architecture",
  "entities:",
  "  web:",
  "    kind: service",
  "    label: Web",
  "    parameters:",
  "      login:",
  "        status: unknown",
  "    defenses: {patched: unknown}",
  "  \"db\":",
  "    kind: host",
  "attacker:",
  "  footholds: []",
].join("\n");

test("a document path finds its line in block YAML, or the nearest line that holds it", () => {
  assert.equal(pathLine(ARCH, "entities.web"), 4);
  assert.equal(pathLine(ARCH, "entities.web.parameters.login.status"), 9);
  assert.equal(pathLine(ARCH, "entities.web.defenses.patched"), 10, "inside a flow map: the map's line");
  assert.equal(pathLine(ARCH, "entities.db.kind"), 12, "quoted keys too");
  assert.equal(pathLine(ARCH, "attacker.footholds"), 14);
  assert.equal(pathLine(ARCH, "entities.nowhere.kind"), 3, "as deep as it goes");
  assert.equal(pathLine(ARCH, "kind"), null, "not a top-level key");
  assert.equal(pathLine(ARCH, ""), null);
});
