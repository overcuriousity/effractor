// The least DOM the SVG renderer needs, for `node --test`: elements that
// remember their attributes, children, classes and listeners. Not a browser —
// what the page looks like is checked by eye.
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

function all(root, test, out = []) {
  if (test(root)) out.push(root);
  root.children.forEach((c) => all(c, test, out));
  return out;
}

module.exports = {
  document: { createElementNS: (_ns, tag) => element(tag) },
  element,
  byClass: (root, cls) => all(root, (e) => e.classList.contains(cls)),
  text: (root) => all(root, (e) => e.tag === "text" || e.tag === "tspan").map((e) => e.textContent).filter(Boolean),
};
