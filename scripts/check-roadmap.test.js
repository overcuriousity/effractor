// Run: node --test "scripts/*.test.js"
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const { check } = require("./check-roadmap.js");

const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures/roadmap", n), "utf8");

test("accepts a valid DAG", () => assert.deepStrictEqual(check(fixture("good.md")), []));
test("rejects a cycle and names it", () => {
  const errs = check(fixture("cyclic.md"));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /cycle: a -> c -> b -> a/);
});
test("rejects a dangling needs", () => assert.match(check(fixture("dangling.md"))[0], /b: needs unknown item "ghost"/));
test("rejects duplicate ids", () => assert.match(check(fixture("duplicate.md"))[0], /duplicate id "a"/));
test("rejects cost outside 1-5", () => assert.match(check(fixture("badcost.md"))[0], /a: cost must be 1-5/));
test("rejects an item without a needs line", () => assert.match(check(fixture("nometa.md"))[0], /a: missing "needs: … cost: N benefit: N" line/));
test("the real roadmap is valid", () =>
  assert.deepStrictEqual(check(fs.readFileSync(path.join(__dirname, "../ROADMAP.md"), "utf8")), []));
