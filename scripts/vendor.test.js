const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FILES, run, stale } = require("./vendor.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "effractor-vendor-"));

test("copies every pinned file and then reports nothing stale", () => {
  const dest = tmp();
  run(dest);
  for (const f of FILES) assert.ok(fs.statSync(path.join(dest, f.to)).size > 0, f.to);
  assert.deepStrictEqual(stale(dest), []);
});
test("reports a modified file as stale", () => {
  const dest = tmp();
  run(dest);
  fs.appendFileSync(path.join(dest, FILES[0].to), "x");
  assert.deepStrictEqual(stale(dest), [FILES[0].to]);
});
test("reports a missing file as stale", () => {
  assert.equal(stale(tmp()).length, FILES.length);
});
test("the committed assets are current", () =>
  assert.deepStrictEqual(stale(path.join(__dirname, "../assets/vendor")), []));
