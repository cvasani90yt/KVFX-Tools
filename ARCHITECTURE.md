# KVFX Tools — Architecture

**Status:** Phase 1 (research + architecture). No implementation code exists yet.
**Target host:** Adobe After Effects 26.x, forward-designed for 27.x+.
**Platforms:** Windows 10/11 (x64, ARM64), macOS 13+ (Apple silicon + Intel).

Read [`docs/research/PLATFORM-FINDINGS.md`](docs/research/PLATFORM-FINDINGS.md)
first. Every constraint below traces back to a verified finding (`F1`–`F10`) or
an open spike (`SPIKE-nn`) in that document. Where After Effects cannot do
something, this document says so plainly and names the closest supported
alternative instead of pretending.

---

## 1. Technology stack

| Layer | Technology | Why |
|---|---|---|
| Panel UI | **CEP 12** extension, TypeScript, Vite, Preact | UXP panels do not exist for AE (`F1`); CEP is fully supported in AE 26 (`F2`) |
| AE automation | **ExtendScript (ES3)**, compiled bundle | the only in-process automation API for AE (`F10`) |
| Heavy/async work | **Out-of-process sidecar**, Node 22 single-file binary | avoids CEP's Node 17 / NW 0.62.1 native-module ABI trap (`F3`), keeps AE responsive |
| Deep host integration | **AEGP C++ plugin**, optional, deferred | menu commands + idle hooks; unproven for shortcuts (`F8`) |

### 1.1 CEP vs UXP vs native C++ vs ExtendScript

**UXP — not available.** After Effects exposes scripting-only UXP APIs and no
panel framework (`F1`). Premiere Pro went UXP-standard in 2026; After Effects did
not. Choosing UXP today means there is no window to render into. Excluded.

**CEP — chosen for the UI.** A CEP extension is a Chromium browser hosted by AE,
with a JavaScript bridge (`evalScript`) into ExtendScript and optional Node in
the same process. It gives us a real UI toolkit, real CSS, real dev tools, and
real npm tooling. Costs: the engine is pinned to **Chromium 99 / Node 17.7.1**
(`F3`), and CEP is on a long deprecation runway (`F2`). We accept both, and
contain the risk by keeping all CEP API usage inside one adapter
(`packages/ui/src/app/cep/`) so a future UXP port rewrites one module.

**ExtendScript — chosen for AE mutation, unavoidable.** Every layer, keyframe,
effect, expression and comp operation goes through it. It is ES3, single-threaded
on AE's main thread, and freezes the application while it runs (`F10`). We treat
it as a *device driver*, not as an application language: small, dumb, versioned
primitives with no business logic.

**Native C++ (AEGP) — deferred and optional.** An AEGP can add menu commands and
receive idle hooks. It cannot replace the UI, and whether its commands accept
user-assigned shortcuts is unconfirmed (`F8`, `SPIKE-02`). Shipping C++ means two
compilers, two signing stories, per-AE-version SDK churn and a much harder crash
surface. **The MVP ships with no native code.** The native helper is evaluated
only after the core is stable, behind a feature flag, and the product must remain
fully functional without it.

### 1.2 Consequences you should expect from this stack

* The panel is a 2022-era browser. No `:has()`, container queries, `color-mix()`,
  `oklch()`, CSS nesting or `subgrid` (`F3`). The design system is authored to
  that baseline and CI enforces it.
* While any ExtendScript call runs, After Effects is frozen. Responsiveness is an
  *architectural* property here, not a coding-style preference.
* We cannot know the user changed their selection until we ask (`F4`).

---

## 2. System overview

```
┌──────────────────────────────────────────────────────────────┐
│  packages/ui — CEP panel (Chromium 99)                       │
│  command palette · HUD · module views · settings             │
│  holds the command REGISTRY (metadata + composition)         │
└───────────┬──────────────────────────────┬───────────────────┘
            │ JSON-RPC over evalScript     │ JSON-RPC over localhost WS
            │ (packages/bridge/host)       │ (packages/bridge/sidecar)
┌───────────▼──────────────────┐  ┌────────▼──────────────────────────┐
│  packages/host — ExtendScript│  │  packages/sidecar — Node 22 binary │
│  versioned OPERATION table   │  │  AI · Whisper · media · index · DB │
│  AE DOM adapters · undo      │  │  secrets · updates · licensing      │
└───────────┬──────────────────┘  └────────┬──────────────────────────┘
            │                              │
┌───────────▼──────────────────┐  ┌────────▼──────────────────────────┐
│  After Effects 26.x          │  │  OS keychain · SQLite · filesystem │
└──────────────────────────────┘  └───────────────────────────────────┘

            packages/core — pure TypeScript, no AE, no DOM
   search · curves · timing algebra · naming · colour · presets ·
   expression templates · storage schema + migrations · diagnostics
            (this is where the testable logic lives)
```

The single most important structural decision: **`packages/core` knows nothing
about After Effects, Chromium, Node or the filesystem.** It is pure functions
over plain data. That is what makes "every feature independently testable"
achievable rather than aspirational — the keyframe timing algebra, the easing
maths, the deep-duplicate naming resolver, the fuzzy search ranker and the preset
serialiser are all unit-testable with no host at all.

### 2.1 Package responsibilities

| Package | Contains | Must not contain |
|---|---|---|
| `core` | command registry types, fuzzy search, curve maths, timing algebra, naming, colour maths, preset schema + migration, expression templates, diagnostics rules | any AE API, DOM, `fs`, CEP API |
| `host` | ExtendScript operation table, AE DOM adapters, undo wrapper, selection snapshot | business logic, string formatting for UI, anything async |
| `bridge` | wire protocol, request/response envelopes, versioning, timeouts, transport adapters | feature logic |
| `ui` | panel shell, palette, views, components, state, theme, CEP adapter | AE API calls not routed through `bridge`, algorithms that belong in `core` |
| `sidecar` | HTTP/WS server, AI providers, Whisper, media, SQLite index, keychain, updates | anything that must run synchronously with AE |
| `native` | AEGP C++ helper (deferred) | anything the product depends on |

---

## 3. The twelve layers, mapped

| # | Requested layer | Where it lives |
|---|---|---|
| 1 | UI | `packages/ui` |
| 2 | AE communication | `packages/bridge/src/host` + `packages/host/src/runtime` |
| 3 | Core command engine | `packages/core/src/commands` (registry) + `packages/host/src/ops` (primitives) |
| 4 | Animation/keyframe engine | `packages/core/src/keyframes`, `core/src/animation`, `host/src/ops/keyframe` |
| 5 | Preset engine | `packages/core/src/presets` + `sidecar/src/index` + `host/src/ops/preset` |
| 6 | Asset engine | `packages/sidecar/src/index` (search/thumbnails) + `host/src/ops/asset` |
| 7 | AI engine | `packages/sidecar/src/ai` (providers) + `core/src/expressions` (validation) |
| 8 | Local service | `packages/sidecar` |
| 9 | Persistence/database | `core/src/storage` (schema + migration) + `sidecar/src/db` (SQLite) |
| 10 | Performance/diagnostics | `core/src/diagnostics` + `host/src/ops/project` + `sidecar/src/log` |
| 11 | Licensing | `core/src/licensing` (token verification) + `sidecar/src/licensing` (network, storage) |
| 12 | Update system | `packages/sidecar/src/updates` |

---

## 4. Command architecture

### 4.1 Commands are metadata + a plan; operations are primitives

A **command** is what the user searches for and invokes. It lives in TypeScript,
in `core`, and carries exactly the shape requested:

```
id            kvfx.layer.anchor.center
name          Center Anchor Point
description   Move the anchor point to the geometric centre without moving the layer
category      LAYER
keywords      ["anchor", "pivot", "origin", "centre"]
shortcut      user-assignable, stored in settings
icon          token name resolved by the UI theme
metadata      { destructive: false, requiresSelection: "layer", minLayers: 1, aeMin: "22.0" }
undoGroup     "KVFX Tools — Center Anchor Point"
canExecute(ctx)  pure predicate over a SelectionSnapshot
execute(ctx)     returns an OperationPlan — it does not touch AE itself
```

An **operation** is a small, versioned primitive on the host side
(`kvfx.op.layer.setAnchor`, `kvfx.op.keyframe.setTemporalEase`, …). Operations do
one thing to the AE DOM and return a result. They contain no branching on user
intent.

`execute()` returns an **OperationPlan** — an ordered, serialisable list of
operations plus one undo-group label. The bridge ships the whole plan in a single
`evalScript` round-trip, and the host executes it inside one undo group.

Why this split, and not "a command is a function that calls AE":

* **Round-trips are the performance enemy.** One plan, one bridge crossing, one
  undo group — instead of a command chattily calling the host forty times while
  AE is frozen between each call.
* **The host bundle stays small and stable.** Adding a command usually adds zero
  ExtendScript. The ES3 code we have to debug without a real debugger stops
  growing.
* **Commands become trivially testable.** `execute()` is a pure function from a
  snapshot to a plan, so a test asserts on the plan — no After Effects required.
* **Undo safety is structural**, not per-author discipline (`§7`).
* **Macros and user-defined chains come free**, because a plan is data.

Commands that genuinely need to read intermediate AE state (deep duplicate, some
analysis) declare `mode: "interactive"` and get a bounded, explicitly budgeted
multi-step session instead. That is the exception and it is reviewed.

### 4.2 Registry

```
CommandRegistry
├── LayerCommands      ├── FXCommands        ├── AssetCommands
├── KeyframeCommands   ├── RigCommands       ├── ProjectCommands
├── TextCommands       ├── CameraCommands    └── AICommands
├── ColorCommands      ├── ThreeDCommands
```

Registration is static and declarative at build time — no dynamic scanning, no
side-effectful imports. The registry builds a **search index** once at startup
(see `§5`) and exposes `canExecute` filtering against the current snapshot.

Third-party/user extension of the registry is a post-1.0 concern and is
explicitly out of scope until the API is stable.

---

## 5. Command palette and search

Target: **first keystroke to filtered results under 16 ms** on a registry of a
few thousand entries (commands + presets + effects + comps + layers + fonts +
expressions + aliases).

* The index is built once and incrementally patched, never rebuilt per keystroke.
* Scoring is a deterministic fuzzy matcher in `core/src/search` — exact prefix >
  word-boundary acronym > contiguous substring > scattered subsequence, then
  weighted by recency, frequency and favourite status. It is pure and unit-tested
  against a fixture corpus so ranking cannot silently regress.
* Results render through a virtualised list; only visible rows exist in the DOM.
* **Project-derived entries (comps, layers, footage) are indexed from a cached
  project scan, never from a live query per keystroke** (`F4`, `§6`).
* Typing never touches the bridge. Searching is a local, synchronous operation.

---

## 6. Selection and project state — pull, never push

After Effects provides no selection or document events (`F4`), and AE is absent
from CEP's standard-event table entirely. Polling every 200 ms is a documented
way to hang or crash After Effects on large projects.

The model:

1. **Authoritative read at execution time.** Every command re-reads the selection
   as the first step of its plan, inside the same undo group. What the user sees
   in the panel is a hint; what the command acts on is what AE reports at the
   moment of execution. This eliminates the entire class of "the panel was stale
   and it modified the wrong layer" bugs.
2. **Refresh on panel focus and on explicit user action.** This is Adobe's own
   recommendation and it is the default.
3. **Optional lightweight heartbeat, default OFF.** When enabled, it fetches a
   *fingerprint* — active item id, selected-layer count, first/last selected ids,
   a project-change counter — never a full scan. It is suspended when the panel
   is hidden or AE is not frontmost, backs off exponentially when the fingerprint
   is unchanged, and is hard-disabled above a project-size threshold measured by
   `SPIKE-04`.
4. **Full project scans are explicit, cached and invalidated by fingerprint.**
   "Analyze Project", the FX manager and the asset index all read from a cached
   scan with a visible timestamp and a refresh control. Nothing rescans on a
   timer.

This is the difference between a panel that a working motion designer keeps open
all day and one they close because it makes After Effects stutter.

---

## 7. Undo, safety and destructive operations

* Exactly **one undo group per user intent**, opened and closed inside a single
  host invocation. Never held across an async boundary — an exception or a UI
  crash mid-group corrupts AE's undo stack.
* The host wrapper is `try / finally`: `endUndoGroup()` runs on every path.
* Operations are **fail-closed**. An operation that cannot resolve its target by
  id (`F9`) aborts the plan rather than guessing by index or name.
* `metadata.destructive: true` forces an explicit confirmation in the UI, naming
  exactly what will be affected and how many objects. No "are you sure?" without
  a count.
* **We never delete user assets automatically.** The project analyser produces a
  *review list*. Acting on it is a separate, confirmed, undoable step.
* **We never modify layers outside the declared scope of the command.** Restore
  paths (Performance Mode, `§9`) store precise per-object records and verify the
  object still matches before restoring; if a layer changed underneath, the
  restore reports it instead of overwriting the user's newer work.

---

## 8. Bridge protocol

A versioned JSON-RPC-shaped envelope, one schema shared by both transports.

```
Request   { v, id, kind: "plan" | "query" | "op", payload, budgetMs, undoGroup? }
Response  { v, id, ok, result?, error?: { code, message, detail, diagnosticId } }
```

* **Versioned.** `v` is checked on both sides; a host bundle older than the UI
  refuses the call with a clear upgrade error rather than misbehaving.
* **Budgeted.** Every request carries a wall-clock budget. The host checks it
  between operations and aborts cleanly (rolling back via the undo group) rather
  than freezing AE indefinitely.
* **Serialisation is explicit.** ExtendScript has no reliable `JSON`, so the host
  ships a minimal, audited serialiser and every value crossing the boundary is a
  plain JSON type. No functions, no AE objects, no cycles.
* **Errors are structured.** Raw ExtendScript exceptions never reach the user
  (`§11`); they are captured, assigned a diagnostic id, logged, and mapped to a
  friendly message.

The sidecar transport is a localhost WebSocket bound to `127.0.0.1` on an
ephemeral port, with a per-session token written to a user-only-readable file
that the panel reads. It rejects any request whose `Origin` is not our extension.
It is a local IPC channel, not a web server, and must never be reachable off-host.

---

## 9. Module notes where After Effects constrains the design

**Easing / graph editor.** We can read and write keyframe temporal ease
(`KeyframeEase`, speed + influence), interpolation types and spatial tangents
(`F9`). We **cannot** read or draw inside AE's own Graph Editor. KVFX renders its
own curve editor on a canvas and applies the result to AE values. Influence is
clamped to AE's accepted range, and a curve that cannot be represented exactly by
a single Bezier segment is reported rather than silently approximated.

**Presets.** Two kinds, deliberately: *native* presets materialised as `.ffx` and
applied via `Layer.applyPreset(File)`, and *KVFX* presets — our own JSON format
carrying keyframes, easing, expressions, timing, metadata and a thumbnail, which
we replay as an operation plan. The JSON format is the one that stays editable
after application, supports migration, and can be diffed. `.ffx` is for
interoperability with AE's own preset system.

**Deep duplicate.** Recursive independent hierarchy via `copyToComp` and
per-level comp duplication, with a collision-resistant naming resolver in `core`.
The genuinely hard part is **expressions that reference other compositions by
name** — `comp("PRECOMP A")` must be rewritten to the duplicated name. We rewrite
statically analysable literal references and **report every reference we could
not safely rewrite** (names built at runtime, indirection) in a post-run summary.
It will not be silently wrong. This is stated as a known limitation, not hidden.

**Performance Mode / heavy FX.** Records exact `(layerId, effectIndex,
matchName, enabledState)` tuples before disabling, verifies the tuple still
matches on restore, and skips + reports mismatches. Never blanket re-enables.

**Fonts.** `Project.usedFonts`, `Project.replaceFont()` (AE 24.5) and `app.fonts`
(AE 24.0) give us audit, global replacement and metadata natively (`F9`). Font
*preview rendering* in the panel uses the OS font stack in Chromium, which cannot
render a font AE has but the OS does not expose — that case is labelled, not faked.

**Clipboard → AE.** We do **not** poll the OS clipboard. The panel is Chromium,
so a `paste` event in the KVFX panel yields real image data; we write it to a
managed temp file and import it. This is the supported, permission-clean path and
it works identically on both platforms. Temp files live in a KVFX-owned cache
directory with a documented retention policy and are cleaned on a schedule and on
uninstall — never with a recursive delete of a path we did not create.

**Media from URL.** Optional module. Direct media URLs only. No DRM
circumvention, no authentication bypass, no access-restriction workarounds. The
downloader refuses anything that requires defeating a protection measure.

**Captions.** Whisper runs in the sidecar, off AE's thread, streaming progress to
the panel. Nothing about it touches AE until the user approves the result and we
build caption layers in one undoable plan.

**HUD.** `SPIKE-05` — AE's panel system governs window size and floating
behaviour; the compact HUD ships in whatever minimum useful form AE actually
permits, and the design will be finalised after the spike, not before.

---

## 10. Storage, configuration and secrets

Resolved once at startup, platform-appropriate, never inside the extension
install directory:

```
Windows   %APPDATA%\KVFXTools\
macOS     ~/Library/Application Support/KVFXTools/
          config/       presets/      expressions/   palettes/
          workspaces/   references/   logs/          cache/
```

* Every store carries a `schemaVersion`. Migrations are forward-only, tested, and
  run behind a one-time backup of the affected store.
* Large/searchable data (asset index, reference board, command history) lives in
  SQLite inside the sidecar. Small preferences live in JSON.
* **Secrets never touch config files.** API keys and license tokens go to the OS
  keychain (macOS Keychain, Windows Credential Manager) via the sidecar. No API
  key is ever hard-coded, logged, or sent anywhere except the provider the user
  configured.
* Per-project data (notes, tasks, deadline) is keyed by a KVFX project GUID.
  `SPIKE-03` decides whether that GUID can be stamped into `Project.xmpPacket`
  additively without clobbering other metadata; if not, we key by project path +
  content hash and accept the rename caveat rather than risk damaging user files.

---

## 11. Errors, logging and diagnostics

Users see: *"KVFX Tools couldn't complete this operation."* plus a one-line plain
description, a **Show details** disclosure, and **Copy diagnostic info**.

A diagnostic bundle contains KVFX version, AE version, OS + architecture, command
id, operation id, structured error, timestamp and a diagnostic id. It contains
**no project content by default** — no layer names, no file paths, no expression
text. An opt-in "include context" toggle adds a redacted summary, and the user
sees exactly what will be included before it is copied.

Logs are local, rotated by size and age, and never transmitted automatically.

---

## 12. Licensing and updates (architecture only; enforcement is late)

* Trial / personal / commercial tiers, activation + deactivation, machine list,
  offline grace period, version-compatibility window.
* **No licensing secret is ever embedded in the client.** The client holds an
  Ed25519 *public* key and verifies a server-signed, time-stamped, machine-bound
  lease. Validation of record is server-side.
* Offline grace is a signed lease with an expiry, not a local boolean.
* We are honest internally: client-side checks are a speed bump, not a guarantee.
  The design optimises for not punishing paying customers (offline work, machine
  moves, reinstalls) over trying to be uncrackable.
* Updates: check → show current version, latest version and release notes →
  user-initiated download → verified signature → user-initiated install.
  **Nothing installs silently, ever.**

---

## 13. Performance budgets (enforced, not aspirational)

| Path | Budget |
|---|---|
| Keystroke → filtered palette results | < 16 ms, no bridge call |
| Palette open → interactive | < 100 ms |
| Simple command (align, anchor, parent) end to end | < 120 ms |
| Any single host invocation (AE frozen) | < 250 ms soft, 1 s hard abort |
| Selection fingerprint fetch | < 20 ms, or the heartbeat disables itself |
| Panel idle CPU | ~0 %; no timers running when hidden |
| Full project scan (10 000 layers) | off the critical path, chunked, cancellable |

CI fails the build on regressions against fixture projects for the top ten
commands.

---

## 14. Forward compatibility

* AE version detection at startup; commands declare `metadata.aeMin` and are
  filtered out (not broken) on older hosts.
* All AE DOM access is funnelled through `host/src/ae/` adapters, so an API change
  in AE 27 is a localised fix.
* All CEP API access is funnelled through `ui/src/app/cep/`, so a future UXP port
  replaces one adapter plus the packaging pipeline rather than the product.
* The bridge protocol is versioned in both directions.
