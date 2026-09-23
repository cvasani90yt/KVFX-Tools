# KVFX Tools

A workflow accelerator for Adobe After Effects — an operating layer for motion
designers, built around one principle:

> Anything a motion designer does repeatedly should be reachable within one or
> two clicks, or a keystroke.

Keyboard-first. Minimal, dense, fast UI. Non-destructive. Undo-safe.

---

## Project status — Phase 4 of 15 complete

The palette works. Type to search thirteen layer commands by name, keyword or
acronym — `mtt` finds Move to Top, `eye` finds Toggle Visibility — navigate with
the arrow keys, run with Enter. Favourites, recents and usage ranking persist
between sessions. Every command runs as a single undo step.

`Mod+Space` focuses the search field **while the panel has keyboard focus**;
After Effects does not allow a global shortcut from a script or CEP panel
([ADR-0003](docs/adr/0003-command-palette-shortcut.md)).

Scope was reduced by [ADR-0007](docs/adr/0007-scope-reduction.md) — the AI,
caption, media-download, reference-board, native-helper, licensing-activation
and update-installer modules are cut, and the local sidecar went with them. The
product is three moving parts: a CEP panel, an ExtendScript host bundle, and
JSON files on disk. It opens no sockets and launches no second process.

```bash
npm install && npm run verify   # typecheck + lint + 250 tests + build + guards
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
* **Logic** — pure TypeScript with no host dependency, which is what makes the
  test strategy real rather than aspirational.
* **Storage** — versioned JSON files. No database, no second process, no sockets.
  See [ADR-0007](docs/adr/0007-scope-reduction.md) for what was cut and why.

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
