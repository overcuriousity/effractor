# v1 acceptance record

Completed 2026-09-21 against release `v0.1.0+361b206` (Linux x86_64).
The owner explicitly requested an agent-run browser/headless-browser walkthrough
in place of the previously required owner walkthrough. The checks below used
isolated headless Chromium profiles, real keyboard/pointer events, and the
published release binary. Screenshots were also inspected by the agent.
No product code or bundled assets differ between that release and this PR.

## Release walkthrough

- Built the reference fault tree's nine nodes and the office attack tree's
  eight nodes through the structured editor with keyboard input: labels, ids,
  gates, 2-of-3 threshold, repeated-event link, leaf kinds, probabilities,
  rates, TTC expressions, attacker costs and detection. Asserted the resulting
  node structure and numerical attributes against the course fixtures; both
  trees solved locally. Initial selection used the outline. Property fields
  were focused directly by the browser driver and edited with keyboard events.
- Imported the complete course files for their asset, consequence, control and
  analysis settings, then solved each with 10,000 samples. Exact P(top) displays
  `0.0474` for the fault tree and `0.836` for the attack tree.
- Checked TTC and loss charts in light and dark themes: plotted paths,
  confidence band, keyboard inspection, pointer hover, tooltips and table
  equivalents. Inspected screenshots of the rendered views.
- Checked Pareto sorting with the cheapest path remaining pinned, changed
  scatter axes, inspected/selected points by keyboard, and verified path-to-graph
  and graph-selection-to-table highlighting in both themes.
- Changed horizon and TTC, solved and verified changed probabilities, then
  undid the edits. Undoing the horizon and solving restored the complete
  baseline results exactly; undoing TTC restored the original leaf attributes.
- Checked control rank `#1` and its risk delta, enabled it, and verified the
  updated results and the displayed cost of removing the enabled control.
- For each course file, shared from the UI, opened the link in a fresh browser
  profile, compared the decrypted model, edited its horizon, and reloaded to
  verify local persistence without changing the original. Deleted the share
  after its eight-second undo window. A third fresh profile displayed the
  deleted/expired notice; the share API returned 404.
- Neither successful walkthrough reported an uncaught browser page error.

## Installation and performance

- The README installer downloaded and SHA-256-verified the published release
  in a clean disposable Alpine 3.20 container with only curl/CA certificates
  added. The installed binary started and served the complete browser app;
  chart, edit, control and sharing checks above ran against that container.
  This checks a fresh Linux userspace, not a separate physical machine or VM.
  The same release also installed into an empty temporary host directory.
- Six reference-tree runs in the released Chromium app produced first exact
  results in **7.0–14.1 ms** and complete 10,000-sample results in
  **47.1–59.4 ms**. Timing begins at Solve and excludes initial page load. Exact timing measures
  worker-result arrival before rendering; total timing includes UI updates
  through the next animation frame.
  All runs meet the <100 ms exact / <1 s total budgets.
- The reproducible Node-hosted wasm check,
  `node scripts/check-performance.js`, also passed all six runs:
  exact **0.42–11.23 ms**, total **34.48–66.09 ms**. Node v22.22.3,
  Linux x86_64, AMD Ryzen AI 7 350.
- Complete results from the release's browser wasm and the native
  `effractor-wasm::api::Session` matched for both course files, including
  sampled results and control comparisons.

## Repository checks

`scripts/build-wasm.sh`, `npm test`, `cargo test --workspace`,
`cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, and
`node scripts/check-roadmap.js` passed. Exact-commit CI remains the merge gate.

The one-off Playwright drivers, screenshots, JSON results and timing records
are in `/tmp/effractor-pr47-acceptance/` on the acceptance host. Playwright was
installed there, not added as a project dependency or permanent test harness.
The course walkthrough and the Node budget check remain reproducible repo files.

## Non-blocking observation

Use **Space** to open the property panel's More disclosure with the keyboard.
Enter is intercepted by the editor's add-sibling shortcut. The walkthrough
completed using Space; Enter on a focused disclosure should be corrected in a
follow-up. At the default narrow results-panel width, wide tables scroll
horizontally; resize the panel to see more columns together.
