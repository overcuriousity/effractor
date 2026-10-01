// The least DOM the SVG renderer needs, for `node --test`: elements that
// remember their attributes, children, classes and listeners. Not a browser —
// what the page looks like is checked by eye.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element(tag) {
  const el = {
    tag,
    attrs: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    classList: {
      set: new Set(),
      add: (...c) => c.forEach((x) => el.classList.set.add(x)),
      remove: (...c) => c.forEach((x) => el.classList.set.delete(x)),
      contains: (c) => el.classList.set.has(c),
      toggle: (c, on) => (on ? el.classList.set.add(c) : el.classList.set.delete(c)),
    },
    setAttribute: (k, v) => (el.attrs[k] = String(v)),
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (!el.parent) return;
      el.parent.children = el.parent.children.filter((c) => c !== el);
      el.parent = null;
    },
    replaceChildren(...kids) {
      el.children = [];
      kids.forEach((k) => el.appendChild(k));
    },
    addEventListener: (type, f) => (el.listeners[type] = el.listeners[type] || []).push(f),
    // Dispatch with bubbling, which is how the renderer hears about nodes.
    dispatch(type, event) {
      const e = Object.assign({ type, target: el, preventDefault() {}, stopPropagation() {} }, event);
      for (let at = el; at; at = at.parent) (at.listeners[type] || []).forEach((f) => f(e));
      return e;
    },
    closest(selector) {
      const cls = selector.replace(/^\./, "");
      for (let at = el; at; at = at.parent) if (at.classList.contains(cls)) return at;
      return null;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  return el;
}

// A page script run as the page runs it: after dom.js, whose helpers it takes
// from `window`, in one context holding the sandbox's globals. `file` is
// under assets/js/.
function runPage(file, sandbox) {
  const context = vm.isContext(sandbox) ? sandbox : vm.createContext(sandbox);
  for (const f of ["dom.js", file]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../../assets/js", f), "utf8"), context);
  return context;
}

function all(root, test, out = []) {
  if (test(root)) out.push(root);
  root.children.forEach((c) => all(c, test, out));
  return out;
}

module.exports = {
  document: { createElementNS: (_ns, tag) => element(tag) },
  element,
  runPage,
  byClass: (root, cls) => all(root, (e) => e.classList.contains(cls)),
  text: (root) => all(root, (e) => e.tag === "text" || e.tag === "tspan").map((e) => e.textContent).filter(Boolean),
};
