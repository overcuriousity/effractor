# Course walkthrough

Use the [reference fault tree](reference-fault-tree.yaml) and the
[office attack tree](office-attack-tree.yaml) as downloadable YAML files.
They are documentation fixtures, not bundled into the app or loaded on startup.
Open a file from the model-name menu or with Ctrl+O.

## Reference fault tree

The web server is unavailable if access or function is lost. The server-outage
leaf appears under both branches but is one event, sampled once. All rates use
hours; the horizon is 8,760 hours. The top event carries availability loss and
the redundant-power control changes the hardware failure rate.

1. Build the outline with Tab (child), Enter (sibling), F2 (rename), and G
   (gate). Use L to link the existing server-outage leaf under the other branch.
   P opens properties; Esc returns to the canvas. Enter or Space opens More when focused. The `?` button lists keys.
2. Fill in the leaf probabilities/rates from the file. Calculate (Ctrl+Enter;
   the page also recalculates after each change). Compare exact and
   sampled P(top), inspect minimal cut sets, and select a cut-set row.
3. Open the Time tab. Compare the solid exact curve with the dashed sampled curve and
   pointwise confidence band. Hover, use Left/Right on the focused plot, or open
   Table for the values.
4. Open Loss. Read the percentiles and exceedance table. The model represents
   at most one occurrence per horizon; it does not estimate recurring annual
   event frequency.
5. Toggle the redundant-power control. Compare its risk delta and rank. Undo
   restores the prior model state and recalculates; a sampled run that took
   more than two seconds is repeated only on Calculate.

## Office attack tree

The top event can follow account takeover or physical access. Account takeover
requires phishing and MFA bypass; physical access is a 2-of-3 vote gate. Leaves
have attacker cost, detection probability and TTC. The file includes losses
for confidentiality and integrity plus a control scenario.

1. Build the gates with the keyboard, then enter the file's leaf attributes.
   A shared event can be added with L without duplicating its random variable.
2. Calculate and open Pareto. The cheapest path is pinned. Sort by cost, time,
   detection or success. Mean time shows the model unit and assumes all steps succeed;
   an infinite expected time is shown as ∞.
3. Switch the scatter axes. Diamonds mark the front and dots the dominated
   paths; nonfinite points are excluded only from axes that cannot plot them.
   Select a point or row to highlight its graph path. Select a graph leaf to
   mark its matching rows and points.
4. Toggle the control and compare the new risk and path results.

## Timing

The top-bar Horizon button edits the analysis window in the document's time
unit. A horizon edit is undoable; results for the old window stay, faded,
until they are recalculated for the new one, which happens by itself.

The TTC picker explains its presets and retains custom expressions:

| Preset | Written | Meaning |
|---|---|---|
| Easy | `Exponential(mean 1)` | Exponential waiting time, mean 1 model time unit |
| Hard | `Exponential(mean 10)` | Exponential waiting time, mean 10 units |
| Very hard | `Exponential(mean 100)` | Exponential waiting time, mean 100 units |
| Easy · 50% chance | `50%` | 50% immediate success; otherwise never |
| Hard · 50% chance | `50% * Exponential(mean 10)` | 50% eventual success; mean 10 units if successful |
| Very hard · 50% chance | `50% * Exponential(mean 100)` | 50% eventual success; mean 100 units if successful |
| Never | `Never` | Never occurs; blocks a step |
| Immediate | `Immediate` | Immediate occurrence |

“Certain” means eventual success, not success within every finite horizon.
Control effects replace a leaf's TTC while the control is enabled; the same
preset meanings apply there.

## Sharing and installation

Share creates an encrypted immutable snapshot. Open the link in another browser
profile, edit the resulting local copy, and reload to verify it persists. In the
originating profile, My shares → Delete offers an eight-second Undo window.
After deletion, reopening the link reports that it is unavailable.

Links use the address at which the app was opened. A localhost link only works
on that machine; external recipients need a reachable HTTPS instance.

Use the [README installer](../../README.md#install) on a fresh Linux machine.
Run the installed binary, open its localhost URL, and repeat the walkthrough
against that release. The [acceptance record](../V1-ACCEPTANCE.md) distinguishes
the completed browser walkthrough, installation scope and measured results.
