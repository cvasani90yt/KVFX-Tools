# ADR-0004 — Address After Effects objects by id, never by index or name

**Status:** Accepted · Phase 1

## Context
Layer indices shift on reorder, duplication and deletion. Names are not unique
and are user-editable. A plan built from one snapshot may execute against a
changed project.

## Decision
`Layer.id` and `Project.layerByID()` (AE 22.0, `F9`) are the only identity used
across the bridge. Items use `Item.id`. Every host operation re-resolves its
targets by id at execution time.

## Consequences
* Minimum supported host is AE 22.0 for id-addressed operations.
* An operation whose target no longer exists **aborts the plan** with a clear
  error rather than guessing. Fail-closed.
* Plans are safely serialisable, storable and replayable (macros, presets).
