# KVFX Tools — Local Development

**Status: working.** `npm install && npm run verify` runs the whole pipeline.
Build mechanics live in [`BUILD.md`](BUILD.md); installing the panel into
After Effects is [`INSTALL.md`](INSTALL.md). This document covers how to work in
the codebase.

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| After Effects 26.x | Windows 10/11 or macOS 13+ |
| Node.js 22 LTS | For the build toolchain |
| Git | — |
| Adobe ZXP signing certificate | Packaging only (Phase 14); not needed for local dev |

## 2. How a CEP extension is loaded locally

CEP will not load an unsigned extension unless the host is put into debug mode
once per machine, per CSXS version.

**macOS**
```
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

**Windows** — add a string value `PlayerDebugMode` = `1` under
`HKEY_CURRENT_USER\Software\Adobe\CSXS.12`.

Then the built extension is made visible to After Effects by placing it in (or
symlinking it into) the per-user CEP extensions folder:

```
Windows   %APPDATA%\Adobe\CEP\extensions\com.kvfx.tools\
macOS     ~/Library/Application Support/Adobe/CEP/extensions/com.kvfx.tools/
```

`npm run dev:link` will create that link so the panel reloads from the dev build
output without reinstalling. The panel then appears under
**Window → Extensions → KVFX Tools**.

A `.debug` file in the extension bundle enables remote debugging; the panel's
Chromium dev tools are opened from a browser at the port it declares. This is how
the UI is debugged — ExtendScript itself has no comparable debugger, which is a
large part of why so little logic lives there (ADR-0006).

## 3. Commands

See [`BUILD.md`](BUILD.md) for the full table. The short version:

```bash
npm run verify    # typecheck + lint + test + build + guards — run before pushing
npm run test      # unit tests, no After Effects required
npm run dev       # watch build, re-assembles the extension on change
npm run dev:link  # link the build into After Effects (Windows/macOS)
```

## 4. Testing strategy

Three tiers, in the order they run:

**Tier 1 — pure unit tests, no host.** This is the bulk of the suite, and it is
possible only because `packages/core` has no dependency on After Effects,
Chromium, Node or the filesystem. Covers: keyframe timing algebra, easing curve
maths and AE-ease conversion, deep-duplicate naming resolution, collision
handling, selection predicates (`canExecute`), parenting transform maths, preset
serialisation and schema migration, colour conversion and harmony generation,
fuzzy search ranking, command registry integrity, project-scan rule evaluation.

Command tests assert on the **emitted `OperationPlan`** — the command's output is
data, so no After Effects instance is needed to prove it does the right thing.

**Tier 2 — mock After Effects.** `packages/host/tests/mock-ae.ts` models the AE
surface the runtime touches and records undo-group activity, driving the same
operation table the real host runs. This catches ordering, id-resolution and
undo-grouping bugs without launching AE — including the one that matters most,
that a thrown operation still closes its undo group. Its fidelity is bounded and
known: it proves our logic, not Adobe's behaviour.

**Tier 3 — real After Effects, fixture projects.** *(Phase 13.)* A small set of `.aep` fixtures
(empty, typical 200-layer, pathological 5 000-layer, deep nesting, missing
footage, broken expressions) driven through the real bridge. This tier validates
what the mock cannot: actual AE semantics and the performance budgets. It runs on
both platforms before every release, and is the only tier that can catch an AE
behaviour change.

**Undo verification** is a first-class test category: every mutating command is
asserted to produce exactly one undo step and to restore the prior state exactly.

## 5. Repository layout

See [`docs/FOLDER-STRUCTURE.md`](docs/FOLDER-STRUCTURE.md).

## 6. Conventions

* TypeScript `strict` plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`; no implicit `any`, no `as any` without a comment.
* `packages/core` must not import from `ui`, `host`, `bridge` or `sidecar`. A
  dependency-boundary lint rule enforces this.
* The host bundle compiles to ES5 and must stay ES3-compatible;
  `npm run guard:es3` checks the built artefact, not the source.
* No magic numbers — AE ranges (ease influence bounds, frame maths) live in named
  constants in `core/src/types`.
* Every mutating operation names its undo group; the wrapper asserts one exists.
* Every user-facing string goes through the message catalogue; raw exception text
  is never rendered.
* `@kvfx/host` imports nothing at runtime. Values it must share with the other
  packages (protocol version, error codes) are duplicated there deliberately and
  pinned by `packages/host/tests/contract.test.ts`.
