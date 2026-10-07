# ADR-0008 — Rebuild the panel around tool tabs, parameterised commands and composable host primitives

**Status:** Accepted · builds on ADR-0002, ADR-0004, ADR-0006, ADR-0007

## Context

The owner reviewed the Phase 5 panel — a command palette plus one spatial tab —
and asked for a panel in the style of the dense, tab-per-tool After Effects
panels motion designers already use: persistent create and anchor controls, an
icon tab per area of work, uppercase pill buttons, an align bar at the bottom,
and far more functionality behind them. The amber theme stays.

That raised four design questions the existing architecture did not answer.

1. **Controls carry values.** "Solid in this colour", "this easing curve",
   "count from 0 to 2,500" — a command was a pure function of the selection only.
2. **Features are multi-step.** A number counter is: create a text layer, add a
   slider, keyframe it, write an expression, rename. Writing each feature as its
   own ExtendScript operation would move its logic out of `core`, where it can
   be tested, into ES3 where it cannot.
3. **Bulk work is slow.** Exploding a title into 80 layers takes longer than the
   one-second ceiling every host call had.
4. **The UI must update in place.** A curve editor being dragged, or a text field
   being typed into, cannot survive the panel being rebuilt on every state change.

## Decision

**Parameterised commands.** `CommandContext` gains optional `params`. A control
passes its values; with none (palette, shortcut) a command falls back to
`defaultParams(ui)`, read from settings — so "Apply Ease" from the palette
applies the curve currently in the editor. Every parameter is validated and
clamped in `core`, because it arrives from a text field.

**Generic host primitives, composed by plans.** The host gains small,
general operations — create, duplicate, set attributes, set a property by path,
set an expression, add an effect with parameters, write keyframes, add a text
animator — and plans compose them. A step may `bind` what it created and later
steps refer to it as `{"$ref": name}` or `{"$ref": name, "at": i}`. An unknown
reference, or an element that was never made, fails the plan rather than acting
on nothing. Effect parameters are addressed by value type and position
(`{ valueType: "color", nth: 1 }`) because their match names are undocumented
and their display names are localised.

A handful of operations stay specific because their logic is inherently host-side
and loops over host state: easing selected keyframes, reversing keys, exploding
text, deep duplicate, the effects manager, fonts, import.

**Two budgets.** Queries and single operations keep the one-second ceiling.
A plan the user explicitly started may declare up to thirty seconds. After
Effects is frozen for the duration either way — its own equivalents freeze it
just as long — but only an explicit click can ask for the longer budget.

**Persistent views.** Each tab is built once and updates its own nodes in
place; the shell swaps which view is mounted. The palette became an overlay
with its own query state.

**A mock After Effects DOM, and end-to-end tests of every command.** Host
operations now run against a model of the scripting DOM (properties, keyframes
with eases, effects with parameter layouts, text animators, comps, projects,
fonts) built from the same `createEnvironment` the live host uses. On top of
that, one test runs every registered command: read a real snapshot, check
availability, probe, plan, and execute through the production dispatcher.

## Consequences

* Most of each feature — what to build, with which values, in which order — is
  ordinary TypeScript in `core`, under unit test. The ExtendScript side grew
  wider (more primitives) but not deeper.
* A plan that names the wrong argument or path now fails in CI, not in a user's
  project. The mock is not After Effects, so behaviour the mock cannot know is
  listed in `docs/FEATURES.md` for verification on a real host.
* Some features are judged infeasible or unsafe and are documented as such
  rather than approximated (saving single comps to `.aep`, saving `.ffx`,
  reading label-colour preferences). See `docs/FEATURES.md`.
* Purging memory now defaults to image caches; purging everything, which also
  clears After Effects' undo history, asks first.
