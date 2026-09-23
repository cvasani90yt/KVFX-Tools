# KVFX Tools — Development Roadmap

Scope discipline is the point of this document. The specification describes a
very large product; building it in the order it was written would produce a wide,
shallow, unstable tool. This roadmap builds a narrow, deep, trustworthy spine
first, then widens.

**Rule applied throughout:** a feature ships when it is correct, undoable and
fast, or it does not ship. A button that half-works costs more trust than a
missing feature.

---

## MVP — v0.1 "Spine + Daily Drivers"

The MVP is **not** a feature sampler. It is the complete architectural spine plus
the smallest set of commands that a working motion designer would genuinely use
every day. If the spine is right, everything afterwards is additive.

### Spine (all of it, no shortcuts)

* `core` command registry, command/operation types, metadata, `canExecute`
* Fuzzy search + ranking + index, with its fixture-based test corpus
* Bridge: versioned protocol, budgets, structured errors, host transport
* Host: operation table, AE DOM adapters, id-based resolution, undo wrapper
* Selection snapshot (pull-based, focus refresh, optional off-by-default heartbeat)
* Settings + storage with `schemaVersion` and a working migration path
* Friendly error surface + diagnostic bundle + local rotating logs
* Panel shell, theme tokens (Chromium 99 baseline), command palette
* Build, package (`.zxp`), and local dev-install pipeline
* Test harness: pure unit tests for `core`, mock-AE tests for `host` ops

### Commands (~45, chosen for daily frequency, not for the demo)

| Group | Included |
|---|---|
| Align | left / centre / right / top / middle / bottom, distribute H+V, align to comp, align to key layer |
| Anchor | 9-point grid + custom, without moving the layer |
| Layer | duplicate, rename, batch rename, move up/down/top/bottom, solo, lock, shy, guide, adjustment, null, split at playhead, pre-compose |
| Parenting | parent to layer, parent to new null, unparent, all with preserve-transforms |
| Keyframes | offset, shift, reverse, sequence, stretch, scale timing, align first, align last, delete |
| Easing | apply preset curves (smooth / snappy / sharp / cinematic / UI), ease in, ease out, ease both |
| Palette | recents, favourites, history, user-assignable shortcuts |

### Explicitly NOT in the MVP

AI, captions, reference board, media download, licensing enforcement, update
installer, presets browser, asset browser, colour module, FX manager, rigs, 3D,
camera, shape generator, project analyser, graph curve editor.

### MVP done means

Ten consecutive real project days by a working motion designer with no AE hang,
no corrupted undo stack, no lost work, and measurable time saved.

---

## Phases

Phases 1–4 build the spine. Phases 5–10 widen it. Phases 11+ add the modules that
carry the most risk, deliberately last.

| Phase | Deliverable | Gate to pass before moving on |
|---|---|---|
| **1** ✅ | Research + architecture | Findings verified, constraints written down, spikes identified |
| **2** ✅ | Project skeleton: workspace, toolchain, TS config, build, CEP manifest, dev install, CI, guards, test harness | Build, tests and guards green; panel assembles and reports its After Effects connection |
| **3** ◀ | Core command engine: registry, plans, bridge, host op table, undo wrapper, selection snapshot, errors, logging | One real command executes end to end, undoes cleanly, and is fully unit-tested |
| **4** | UI: panel shell, theme, command palette, search, recents/favourites, settings | Palette meets the < 16 ms keystroke budget on a 3 000-entry index |
| **5** | Layer tools (align, anchor, layer ops, parenting) | All commands undo as one step; mock-AE tests green |
| **6** | Keyframe engine (timing algebra, sequencing, spatial distribution) | Interpolation and expressions preserved; property-based tests green |
| **7** | Graph / easing engine (curve editor, curve library, import/export) | Round-trip AE ↔ KVFX curve fidelity proven; unrepresentable curves reported |
| **8** | Text, colour and FX systems (incl. FX manager + Performance Mode) | Restore path proven safe against concurrent user edits |
| **9** | Preset + asset systems (KVFX JSON presets, `.ffx`, thumbnails, index, tags) | Preset format versioned + migration tested; editable after application |
| **10** | Reference board, shape generator, comp templates, project analyser | Analyser never mutates anything without confirmation |
| **11** | AI + caption modules (sidecar, providers, keychain, Whisper) | AE stays responsive throughout; no destructive action without confirmation |
| **12** | Licensing + update system | Offline grace works; nothing installs silently |
| **13** | Testing hardening: large-project fixtures, cross-platform matrix, soak tests | Budgets in ARCHITECTURE §13 enforced in CI |
| **14** | Packaging: signed `.zxp`, notarised sidecar, installers for both platforms | Clean install/uninstall on both platforms, no leftovers outside app-data |
| **15** | Distribution: docs, onboarding, release channel, support + diagnostics loop | — |

Rigs, 3D, camera and shake presets attach to phases 8–10 as their dependencies
(expression generation, preset format) land. They are deliberately not given their
own early phase: they are the features most likely to generate expression debt if
built before the expression templating and removal story is solid.

---

## Phase 2 features (after the MVP is stable in real use)

Graph/curve editor · KVFX preset format + browser · asset browser + index ·
text module (font audit, replacement, splitting, reveal presets, dynamic text) ·
colour module (picker, palettes, harmony, project-wide replacement) · FX manager
+ heavy-FX detection + Performance Mode · deep duplicate · proximity rig ·
expression library · shape generator · comp templates + guides · camera and 3D
rigs · shake presets · project analyser · workspace presets · project notes and
tasks.

---

## Do NOT attempt until the core is stable

Each of these is genuinely valuable and each will destabilise the product if it
arrives before the spine is proven. They are listed with the specific reason.

| Deferred | Why it waits |
|---|---|
| **AI module** | Needs the sidecar, secure credential storage, provider abstraction and a confirmation model for anything it suggests. Generating expressions is easy; generating *correct, removable* expressions against a stable expression API is not. |
| **Whisper captions** | Model downloads, GPU/CPU variance, multi-gigabyte assets, long-running jobs, cancellation and progress. Needs a proven sidecar lifecycle first. |
| **Media-from-URL downloader** | Legal surface plus network, disk and codec handling. Only after the media pipeline and temp-file policy are proven by the clipboard path. |
| **Reference board** | An infinite canvas with video playback inside a Chromium 99 panel is a serious performance project by itself. |
| **Native AEGP C++ helper** | Two toolchains, per-version SDK churn, a much harder crash surface, and its main promised benefit (assignable shortcuts) is unconfirmed (`SPIKE-02`). |
| **Licensing enforcement** | Needs a server, a key-management story and a support process. The *interfaces* exist from phase 3; enforcement lands at phase 12 so it is never the reason an early build blocks a user. |
| **Update installer** | Silent-update bugs damage trust permanently. Ships only with signature verification and explicit user consent. |
| **Third-party command API** | Freezing a public API before the internal one has settled guarantees either breakage or permanent technical debt. Post-1.0. |
| **Workspace presets** | Adobe's API coverage for AE workspace state is limited; needs a spike to establish what is actually persistable before promising it. |

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| CEP deprecation lands sooner than signalled | High | All CEP access behind one adapter; watch the AE UXP matrix every release |
| A command hangs After Effects on a large project | High | Per-request wall-clock budgets with hard abort; large-project fixtures in CI |
| Undo stack corruption | High | Single undo group per intent, opened and closed in one host call, `try/finally` |
| Deep-duplicate expression rewriting is imperfect | Medium | Rewrite what is statically analysable, **report** the rest; never silently wrong |
| Chromium 99 CSS baseline breaks the UI | Medium | Build targets Chrome 99; CI lint blocks newer CSS features |
| Selection polling degrades AE | Medium | Off by default, fingerprint-only, backoff, size threshold from `SPIKE-04` |
| Sidecar native-module ABI churn | Medium | Sidecar is a separate process on its own runtime, never a CEP native module |
| AE 27 breaks scripting APIs | Medium | Version gate per command; all DOM access behind adapters |
