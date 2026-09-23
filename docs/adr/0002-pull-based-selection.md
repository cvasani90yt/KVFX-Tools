# ADR-0002 — Selection is pull-based; commands re-read at execution time

**Status:** Accepted · Phase 1

## Context
After Effects emits no selection-change or document events, and is absent from
CEP's standard-event table entirely (`F4`). Adobe's stated reason is performance,
and Adobe explicitly does not recommend the common 200 ms polling workaround,
which can hang or crash AE on large projects.

## Decision
The panel never assumes it knows the current selection.

1. Every command re-reads the selection as the first step of its plan, inside its
   own undo group. That read is authoritative.
2. The panel refreshes its *display* on focus and on explicit user action.
3. An optional heartbeat (default **off**) fetches only a cheap fingerprint,
   suspends when hidden, backs off when unchanged, and disables itself above a
   project-size threshold (`SPIKE-04`).
4. Full project scans are explicit, cached, timestamped and user-refreshable.

## Consequences
* The displayed selection can briefly lag reality. This is acceptable; acting on
  a stale selection is not.
* Eliminates the "panel was stale, modified the wrong layer" bug class entirely.
* Idle CPU is effectively zero.

## Rejected
* **Continuous polling** — documented to destabilise AE on large projects.
* **Trusting a cached selection at execution time** — silently destructive.
