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

Phase 3 lands the command engine.
