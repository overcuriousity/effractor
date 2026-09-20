const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/theme.js"), "utf8");

function boot(stored) {
  const store = new Map(stored ? [["effractor.theme", stored]] : []);
  const root = { dataset: {} };
  const window = {};
  vm.runInNewContext(source, {
    window,
    document: { documentElement: root },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  return { root, store, theme: window.effractorTheme };
}

test("first load is light, not the system preference", () => {
  const { root, theme } = boot();
  assert.equal(root.dataset.theme, "light");
  assert.equal(theme.get(), "light");
});
test("a stored choice is applied before paint", () => assert.equal(boot("dark").root.dataset.theme, "dark"));
test("system means no attribute, so the media query decides", () => {
  const { root, theme } = boot("system");
  assert.equal("theme" in root.dataset, false);
  assert.equal(theme.get(), "system");
});
test("cycle walks light -> dark -> system -> light and persists", () => {
  const { root, store, theme } = boot();
  assert.equal(theme.cycle(), "dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(theme.cycle(), "system");
  assert.equal("theme" in root.dataset, false);
  assert.equal(store.get("effractor.theme"), "system");
  assert.equal(theme.cycle(), "light");
});
test("a garbage stored value falls back to light", () => assert.equal(boot("neon").theme.get(), "light"));
test("storage that throws does not break the page", () => {
  const root = { dataset: {} };
  const window = {};
  const boom = () => { throw new Error("blocked"); };
  vm.runInNewContext(source, { window, document: { documentElement: root }, localStorage: { getItem: boom, setItem: boom } });
  assert.equal(root.dataset.theme, "light");
  assert.equal(window.effractorTheme.set("dark"), "dark");
});
