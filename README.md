# KVFX Tools

A workflow accelerator for Adobe After Effects — an operating layer for motion
designers, built around one principle:

> Anything a motion designer does repeatedly should be reachable within one or
> two clicks, or a keystroke.

Keyboard-first. Minimal, dense, fast UI. Non-destructive. Undo-safe.

---

## Project status — Phase 2 of 15 complete

The architecture is settled and the project skeleton builds, tests and packages
end to end. What exists today is the spine, not the features: a working
panel → After Effects bridge with undo discipline, host-version gating, budget
enforcement and structured errors, plus the guards that keep the two hostile
runtime baselines honest. The command engine lands in Phase 3.

```bash
npm install && npm run verify   # typecheck + lint + 85 tests + build + guards
```

| Document | What it is |
|---|---|
| [`docs/research/PLATFORM-FINDINGS.md`](docs/research/PLATFORM-FINDINGS.md) | Verified Adobe platform constraints, with sources, plus open spikes |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Architecture of record |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases, MVP scope, deferred features, risk register |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/FOLDER-STRUCTURE.md`](docs/FOLDER-STRUCTURE.md) | Repository layout and dependency rules |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Working in the codebase |
| [`BUILD.md`](BUILD.md) | Build pipeline, guards, toolchain limitations |
| [`INSTALL.md`](INSTALL.md) | Installing the panel into After Effects |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Symptoms, causes, fixes |

## Stack, in one line each

* **UI** — CEP 12 extension (TypeScript). UXP panels do not exist for After
  Effects; this is not a preference, it is the only HTML panel option.
* **After Effects automation** — ExtendScript, treated as a device driver: small,
  versioned primitives, no business logic.
* **Heavy work** — a separate local process, so transcription, AI and indexing
  can never freeze After Effects.
* **Logic** — pure TypeScript with no host dependency, which is what makes the
  test strategy real rather than aspirational.

## Target

After Effects 26.x on Windows 10/11 and macOS 13+, designed to adapt to future
releases. All filesystem access is platform-safe; user data never lives in the
plugin install directory.

## Originality

KVFX Tools is an original product. It implements workflow concepts that are
common to the motion-design domain, but its code, architecture, naming, UI, icons
and implementation are its own. No source, assets, branding or implementation
details are taken from any other product.

## Licence

See [`LICENSE.md`](LICENSE.md). Commercial product; not open source.
