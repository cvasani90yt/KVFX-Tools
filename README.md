# KVFX Tools

A workflow accelerator for Adobe After Effects — an operating layer for motion
designers, built around one principle:

> Anything a motion designer does repeatedly should be reachable within one or
> two clicks, or a keystroke.

Keyboard-first. Minimal, dense, fast UI. Non-destructive. Undo-safe.

---

## What it does

A dense, dark panel with amber accents, built around tool tabs:

| | |
|---|---|
| **Always visible** | Active comp and selection, a RAM meter with purge, a 3×3 anchor-point grid, one-click Null / Adjustment / Solid (with colour swatch) / Text / Shape / Camera, and an align-and-distribute bar. |
| **Tools** | Precompose each, split at playhead, deep-duplicate precomps, trim to work area, parent to new null, sequence layers, fill, gradient lock, switches, stacking order, and a live transform inspector. |
| **Ease** | A draggable bezier curve editor with live preview, presets and saved curves that writes real After Effects easing to selected keyframes — and reads it back. Interpolation, reverse keys, elastic, bounce, wiggle and loops. |
| **Text** | Styled text, ten animation presets with a live preview, an exploder (letters, words or lines), and project-wide font replacement. |
| **FX** | One-click effects and an effects manager to switch off or remove what is on the selection. |
| **Generate** | Number counter, 3D carousel, 3D extrude — each a rig you adjust afterwards with ordinary sliders. |
| **Labels** | Sixteen label colours and select-same-label. |
| **Library** | Your own folders of footage, `.aep` templates and `.ffx` presets, one click into the comp. |
| **Media** | Paste or drop images and clips straight into the comp. |

Every command is also in the search palette (`Ctrl/⌘+Space` while the panel has
focus), and every one is **a single undo step**. Destructive or irreversible
actions ask first. Full reference, including each feature's limits and what was
deliberately left out: [`docs/FEATURES.md`](docs/FEATURES.md).

The panel was rebuilt around this layout in
[ADR-0008](docs/adr/0008-tools-panel-rebuild.md). Scope was reduced earlier by
[ADR-0007](docs/adr/0007-scope-reduction.md): no AI, captions, media download,
licence activation or auto-update, and no second process. The product is a CEP
panel, an ExtendScript host bundle, and JSON files on disk. It opens no sockets.

```bash
npm install && npm run verify   # typecheck + lint + 550+ tests + build + guards
npm run preview -- --all        # render every tab to build/preview/*.png, no After Effects needed
```

| Document | What it is |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | **What every control does, its limits, and what is not included** |
| [`docs/research/PLATFORM-FINDINGS.md`](docs/research/PLATFORM-FINDINGS.md) | Verified Adobe platform constraints, with sources, plus open spikes |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Architecture of record |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases, MVP scope, deferred features, risk register |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/FOLDER-STRUCTURE.md`](docs/FOLDER-STRUCTURE.md) | Repository layout and dependency rules |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Working in the codebase |
| [`BUILD.md`](BUILD.md) | Build pipeline, guards, toolchain limitations |
| [`TESTING.md`](TESTING.md) | **Install and try it — no build tools needed** |
| [`INSTALL.md`](INSTALL.md) | Installing a development build from source |
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
