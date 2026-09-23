# ADR-0006 — Commands produce serialisable operation plans

**Status:** Accepted · Phase 1

## Context
The naive design makes each command a function that calls into ExtendScript. That
produces many bridge round-trips per command, a large ES3 codebase that cannot be
meaningfully debugged or unit-tested, and per-author undo discipline.

## Decision
A command's `execute(ctx)` is a **pure function returning an `OperationPlan`** —
an ordered list of primitive operations plus one undo-group label. The bridge
sends the whole plan in one `evalScript` call. The host executes it inside a
single undo group with `try/finally`.

Commands that must read intermediate AE state declare `mode: "interactive"` and
receive a bounded, explicitly budgeted multi-step session. This is the reviewed
exception, not the norm.

## Consequences
* One bridge crossing and one undo group per user intent.
* Adding a command usually adds **zero** ExtendScript; the ES3 surface stops growing.
* Commands are unit-testable with no After Effects present — assert on the plan.
* Macros, user-defined chains and replayable presets come free, because a plan is
  data.
* Cost: interactive commands (deep duplicate, analysis) need a deliberate,
  reviewed design rather than an easy escape hatch.
