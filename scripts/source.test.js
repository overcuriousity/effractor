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
