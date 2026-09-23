# Building KVFX Tools

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22 LTS (see `.nvmrc`) | Build toolchain |
| npm | 10+ | Workspaces |
| After Effects | 22.0+ (developed against 26.x) | Only needed to *run* the panel |

Nothing else. There is no native toolchain requirement — the optional AEGP C++
helper is deferred (ADR-0001) and no part of the product depends on it.

## Commands

```bash
npm install          # once
npm run verify       # typecheck + lint + test + build + guards
```

| Command | What it does |
|---|---|
| `npm run build` | Builds every package and assembles the loadable extension |
| `npm run dev` | Full build, then watches and re-assembles on change |
| `npm run dev:link` | Links the staged extension into the CEP extensions folder |
| `npm run test` | Unit tests — no After Effects required |
| `npm run typecheck` | `tsc --build` across the workspace |
| `npm run lint` | ESLint, type-aware on product sources |
| `npm run guard` | Artefact guards (below) |
| `npm run clean` | Removes build output only |

## The build pipeline

```
packages/core     tsc ──────────────────────────────▶ dist/            (ES2021)
packages/bridge   tsc ──────────────────────────────▶ dist/            (ES2021)
packages/host     tsc (ES5) ──▶ rollup (IIFE) ──────▶ kvfx-host.jsx    (ES3-safe)
packages/ui       tsc + vite (target chrome99) ─────▶ dist/            (ES2021)
                                                           │
                          scripts/assemble-extension.mjs ──┘
                                                           ▼
                            build/extension/com.kvfx.tools/
                              CSXS/manifest.xml
                              index.html + assets/
                              host/kvfx-host.jsx
                              .debug            (development builds only)
```

### Why the host is built in two steps

esbuild — which Vite uses — **cannot** downlevel to ES5; it errors on `const`,
destructuring and `for…of`. ExtendScript is ES3 (F10), so the host bundle is
compiled by `tsc` (which can target ES5) and only then concatenated by rollup,
whose IIFE output adds no runtime glue of its own. We verified this rather than
assuming it: rollup's output for this input is plain `var`/`function` code.

## Guards

These check the *finished artefacts*, because the failure modes they cover are
invisible to the compiler — everything they catch is valid JavaScript or CSS
that simply does not work inside After Effects.

| Guard | Catches |
|---|---|
| `guard:es3` | ES6 syntax or ES5 library calls in the host bundle. One arrow function makes the whole bundle fail to parse, taking the panel down with no usable error. |
| `guard:css` | CSS newer than Chromium 99 — `:has()`, container queries, `color-mix()`, `oklch()`, `subgrid`, cascade layers. These work in the browser a designer previews in and silently do nothing in the panel. |
| `guard:boundaries` | Imports that violate the dependency direction. `core` importing a platform API would end the "testable without After Effects" property. |
| `guard:paths` | Absolute path literals outside `scripts/paths.mjs`. |

## Known limitations of the current toolchain

**`target: ES5` is deprecated in TypeScript 6 and scheduled for removal in
TypeScript 7.** The host package sets `"ignoreDeprecations": "6.0"` to silence
the error today. When TypeScript drops ES5, the host pipeline needs a
replacement downleveller (Babel with a custom target, or SWC). The ES3 guard
will catch the regression the day it happens rather than shipping it. This is
tracked as a Phase 2 debt item.

**TypeScript is pinned to 6.x, not 7.x.** `typescript-eslint` supports
`>=4.8.4 <6.1.0`, and TypeScript 7's native port is not covered yet. Type-aware
linting is worth more to this codebase than compiler speed; revisit when
`typescript-eslint` ships TS 7 support.

**Linux builds and tests, but cannot run the panel.** After Effects does not run
on Linux, so `npm run dev:link` exits with a clear message there. CI still runs
the full build and test suite on Linux because both are host-independent by
design.
