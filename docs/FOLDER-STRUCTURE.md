# KVFX Tools — Folder Structure

Adapted to the Adobe-supported stack (CEP 12 + ExtendScript + out-of-process
sidecar). The specification's suggested tree assumed a single-runtime project;
this layout maps the same modules onto the four runtimes we actually have, so
that each one can be built, linted and tested independently.

```
kvfx-tools/
├── ARCHITECTURE.md              Architecture of record
├── DEVELOPMENT.md               Local dev + testing (planned, Phase 2)
├── README.md  CHANGELOG.md  LICENSE.md
│
├── docs/
│   ├── ROADMAP.md               Phases, MVP, deferred features, risk register
│   ├── FOLDER-STRUCTURE.md      This file
│   ├── adr/                     Architecture decision records (0001…)
│   ├── api/                     Command · Preset · Plugin · AI · Storage · Events (Phase 3+)
│   └── research/                PLATFORM-FINDINGS.md — verified Adobe constraints
│
├── packages/
│   ├── core/                    PURE TypeScript. No AE, no DOM, no fs, no Node.
│   │   ├── src/
│   │   │   ├── commands/        Registry + command definitions (metadata + plan builders)
│   │   │   │   ├── layer/ keyframe/ text/ color/ fx/ rig/
│   │   │   │   └── camera/ threed/ asset/ project/ ai/
│   │   │   ├── search/          Fuzzy matcher, ranking, index
│   │   │   ├── animation/       Easing curves, Bezier ↔ AE ease conversion
│   │   │   ├── keyframes/       Timing algebra: offset, sequence, stretch, distribute
│   │   │   ├── presets/         KVFX preset schema, serialisation, migration
│   │   │   ├── color/           Colour space conversion, harmony generation
│   │   │   ├── naming/          Collision-resistant naming, batch-rename grammar
│   │   │   ├── expressions/     Expression templates, safe rewriting, tagging
│   │   │   ├── storage/         Schema versions + forward-only migrations
│   │   │   ├── diagnostics/     Project-scan rules and recommendations
│   │   │   ├── licensing/       Signed-lease verification (public key only)
│   │   │   ├── types/           Shared types + named constants (no magic numbers)
│   │   │   └── util/
│   │   └── tests/               Tier 1 — the bulk of the suite
│   │
│   ├── host/                    ExtendScript (ES3), compiled to one .jsx bundle
│   │   ├── src/
│   │   │   ├── ops/             Primitive operations, one AE mutation each
│   │   │   ├── ae/              AE DOM adapters, id resolution, selection snapshot, undo
│   │   │   └── runtime/         Dispatcher, JSON serialiser, error capture, ES3 shims
│   │   └── tests/               Tier 2 — mock-AE environment
│   │
│   ├── bridge/                  Typed IPC, shared by both transports
│   │   └── src/{protocol,host,sidecar}/
│   │
│   ├── ui/                      CEP panel (Chromium 99 baseline)
│   │   ├── src/{app,palette,hud,views,components,state,theme,styles}/
│   │   │   └── app/cep/         THE ONLY place CEP APIs are touched (ADR-0001)
│   │   └── public/
│   │
│   ├── sidecar/                 Standalone Node 22 binary (ADR-0005)
│   │   └── src/{server,rpc,ai,captions,media,index,db,secrets,updates,licensing,log}/
│   │
│   └── native/aegp/             AEGP C++ helper — DEFERRED, optional, flagged
│
├── cep/
│   ├── CSXS/                    manifest.xml, .debug
│   └── icons/
│
├── assets/{presets,expressions}/   Shipped content
├── build/                          Build output (git-ignored)
├── scripts/                        Dev-link, packaging, signing, fixture generation
└── tools/                          Lint rules (ES3 guard, Chromium-99 CSS guard, boundaries)
```

## User data — never in the install directory

```
Windows   %APPDATA%\KVFXTools\
macOS     ~/Library/Application Support/KVFXTools/
          config/  presets/  expressions/  palettes/
          workspaces/  references/  logs/  cache/
```

Resolved once at startup through a platform-safe API. No hard-coded paths
anywhere in the codebase; a lint rule blocks path literals containing `C:\`,
`/Users/` or `%APPDATA%` outside the path-resolution module.

## Dependency direction

```
ui ──▶ bridge ──▶ host          ui ──▶ core
sidecar ──▶ core                host ──▶ (nothing)
core ──▶ (nothing)
```

`core` depends on nothing and is imported by everything. `host` imports nothing —
it receives plans as data. These rules are enforced by a lint boundary rule, not
by convention, because they are the reason the test strategy works at all.
