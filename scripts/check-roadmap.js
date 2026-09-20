#!/usr/bin/env node
// ROADMAP.md is a DAG of work items. This keeps it one: ids unique, every
// `needs` target present, cost/benefit in range, no cycles.
const fs = require("node:fs");

const ITEM = /^### (\S+) — .*$/;
const META = /^needs: (.*?)\s{2,}cost: (\d+)\s+benefit: (\d+)\s*$/;

function parse(text) {
  const items = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m) continue;
    const meta = META.exec(lines[i + 1] ?? "");
    items.push({
      id: m[1],
      meta: meta && {
        needs: meta[1].split(",").map((s) => s.trim()).filter((s) => s && s !== "—"),
        cost: Number(meta[2]),
        benefit: Number(meta[3]),
      },
    });
  }
  return items;
}

function findCycle(graph) {
  const state = new Map(); // 1 = on the stack, 2 = finished
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of graph.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

function check(text) {
  const errors = [];
  const graph = new Map();
  for (const { id, meta } of parse(text)) {
    if (graph.has(id)) errors.push(`duplicate id "${id}"`);
    if (!meta) {
      errors.push(`${id}: missing "needs: … cost: N benefit: N" line`);
      graph.set(id, []);
      continue;
    }
    for (const k of ["cost", "benefit"])
      if (meta[k] < 1 || meta[k] > 5) errors.push(`${id}: ${k} must be 1-5`);
    graph.set(id, meta.needs);
  }
  for (const [id, needs] of graph)
    for (const n of needs) if (!graph.has(n)) errors.push(`${id}: needs unknown item "${n}"`);
  if (errors.length === 0) {
    const cycle = findCycle(graph);
    if (cycle) errors.push(`cycle: ${cycle.join(" -> ")}`);
  }
  return errors;
}

module.exports = { check };

if (require.main === module) {
  const file = process.argv[2] ?? "ROADMAP.md";
  const errors = check(fs.readFileSync(file, "utf8"));
  for (const e of errors) console.error(`${file}: ${e}`);
  process.exit(errors.length ? 1 : 0);
}
