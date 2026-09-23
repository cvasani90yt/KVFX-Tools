# Changelog

All notable changes to KVFX Tools are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 1: research and architecture
- Verified Adobe platform findings with sources and open spikes
  (`docs/research/PLATFORM-FINDINGS.md`)
- Architecture of record (`ARCHITECTURE.md`)
- Development roadmap, MVP definition, deferred-feature list and risk register
  (`docs/ROADMAP.md`)
- Architecture decision records ADR-0001 … ADR-0006
- Project folder skeleton and dependency rules (`docs/FOLDER-STRUCTURE.md`)
- Planned local development and testing workflow (`DEVELOPMENT.md`)

### Added — Phase 2: project skeleton and toolchain
- npm workspace with four packages: `@kvfx/core` (pure logic), `@kvfx/bridge`
  (wire protocol), `@kvfx/host` (ExtendScript), `@kvfx/ui` (CEP panel)
- Wire protocol: versioned envelope, wall-clock budgets, structured errors, and
  an ExtendScript literal serialiser with escape-vector tests
- Host runtime: dispatcher that never throws, operation registry, host-version
  gating, undo-group wrapper with `finally`, ES3-safe JSON serialiser
- `kvfx.op.system.ping` — round-trip check and host identification
- CEP panel shell with a `__adobe_cep__` transport adapter, dark theme tokens
  authored to the Chromium 99 baseline, and a live connection report
- Build pipeline: `tsc`→`rollup` for the ES3-safe host bundle, Vite targeting
  `chrome99` for the panel, and extension assembly from a CEP 11+ manifest
- Four artefact guards: ES3 syntax/library, Chromium 99 CSS baseline, dependency
  boundaries, hard-coded paths
- Developer tooling: `dev`, `dev:link`, `clean`, `verify`; ESLint with type-aware
  rules; Vitest with 85 tests; CI across Linux, Windows and macOS
- `BUILD.md`, `INSTALL.md`, `TROUBLESHOOTING.md`

### Known limitations
- `target: ES5` is deprecated in TypeScript 6 and removed in TypeScript 7; the
  host build will need a replacement downleveller (BUILD.md)
- TypeScript pinned to 6.x until `typescript-eslint` supports 7.x
- The panel has not yet been loaded in After Effects from this environment; the
  bridge is proven by tests and by the artefact guards, not by a live host

### Added — Phase 3: core command engine
- Command model in `@kvfx/core`: id, name, description, category, keywords,
  icon, default shortcut, metadata, `canExecute()` and `plan()`
- Command registry with availability resolved against the live context;
  unavailable commands are returned with a reason rather than hidden
- `SelectionSnapshot` + `kvfx.op.selection.snapshot` — pull-based, read-only,
  opens no undo group
- Plan execution: a whole plan crosses the bridge once and runs inside one undo
  group, so one command is one entry in Edit ▸ Undo
- Host operations: `layer.setFlag` (with host-side toggle resolution),
  `layer.reorder`, `layer.create`
- 13 working layer commands: solo, shy, visibility, 3D, guide and adjustment
  toggles; lock selected and unlock all; move to top/bottom/up/down; create null
  and adjustment layer
- Panel now lists every command with its availability and executes it
- `hostError()` — anticipated failures keep their specific error code instead of
  collapsing into a generic host exception
- Mock After Effects now models the layer stack, so ordering and index
  renumbering are tested without the host

### Changed
- **Scope reduced (ADR-0007).** AI, captions, media download, reference board,
  native AEGP helper, licensing activation and the update installer are cut, and
  the local sidecar is cut with them. Storage is versioned JSON; the product
  opens no sockets and launches no second process. ADR-0005 is superseded.
- Operation and command id patterns now permit lowerCamelCase segments. A
  registry test caught that `kvfx.op.layer.setFlag` would have been rejected by
  the bridge's validator before it was ever sent.
- Locking is a one-way command paired with Unlock All Layers: After Effects
  deselects a layer when it is locked and will not let it be reselected, so a
  selection-based toggle could only ever lock.

### Notes
- 154 tests. Alignment and anchor-point commands are deliberately **not** in
  this phase: they need layer-bounds and transform maths (rotation, scale,
  parenting, 3D) that must be exactly right, and they get their own test suite
  in Phase 5 rather than an approximation here.
- The panel has still not been loaded in a real After Effects from this
  environment.

### Added — Phase 4: command palette
- Fuzzy matcher with tiered ranking: exact, prefix, word prefix, acronym,
  substring, then scattered subsequence. Tier gaps are wide enough that personal
  weighting can never cross them
- Palette ranking over name, keywords, category and description, weighted by
  favourites, frequency and recency
- Match highlighting — the palette shows *why* a result matched
- Search field with keyboard navigation: `Mod+Space` to focus, ↑↓ to move,
  ↵ to run, Esc to clear
- Portable `Mod` modifier — Command on macOS, Control elsewhere — parsed,
  matched and formatted per platform
- Favourites (per-row star), recents and usage counts, persisted
- Versioned settings at `%APPDATA%\KVFXTools` / `~/Library/Application Support/KVFXTools`
  via CEP's `cep.fs` bridge, so a save does not freeze After Effects
- Settings migration that validates each field independently, prunes references
  to commands that no longer exist, and refuses to overwrite a file written by a
  newer build

### Notes
- 250 tests. The palette bundle is 28 KB of JavaScript and 7 KB of CSS.
- `Mod+Space` only works while the KVFX panel has keyboard focus. After Effects
  does not let a script or CEP panel register a global shortcut (F6, ADR-0003);
  this is the documented limit, not an implementation gap.
- The palette is a search field above a list rather than a modal overlay: in a
  docked panel an overlay would hide the panel's own contents to show a list
  that *is* the panel's contents.
