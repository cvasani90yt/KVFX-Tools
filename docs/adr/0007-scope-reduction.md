# ADR-0007 — Cut the high-complexity modules; collapse the sidecar

**Status:** Accepted · supersedes ADR-0005 · decided by the product owner

## Context

The original specification describes roughly 2–3 years of work for a team. The
owner asked to drop features that are too complicated or error-prone, and to
keep moving.

## Decision

**Cut, not deferred** — these are out of the product until there is a concrete
reason to revisit:

| Cut | Why it was the right thing to lose |
|---|---|
| AI module | Needs provider abstraction, secure key storage, a confirmation model for every generated expression, and ongoing support when a provider changes. Large, and orthogonal to "make repetitive work fast". |
| Whisper captions | Multi-gigabyte model downloads, per-platform native binaries, GPU/CPU variance, cancellable long jobs. A product of its own. |
| Media-from-URL downloader | Network, codecs, disk, and a legal surface, for a workflow the clipboard path already covers. |
| Reference board | An infinite canvas with video playback inside a Chromium 99 engine is a serious performance project by itself. |
| Native AEGP C++ helper | Two toolchains, per-AE-version SDK churn, a much harder crash surface — and its main promised benefit (assignable shortcuts) was never confirmed (`SPIKE-02`). |
| Licensing activation + machine management | Needs a server, key management and a support process. |
| Update installer | Silent-update bugs damage trust permanently, and signing/verification is its own project. |

**The local sidecar goes with them (ADR-0005 superseded).** Its entire reason for
existing was AI, Whisper, media processing, the SQLite asset index and update
downloads. With those gone it would be a second binary to build, sign, notarise,
launch, port-negotiate and keep alive — for nothing. Removing it deletes a whole
class of failure (orphaned processes, port collisions, handshake bugs, a second
notarisation pipeline) before any of it was written.

The architecture is now **three moving parts instead of five**: a CEP panel, an
ExtendScript host bundle, and JSON files on disk.

## Consequences

* Storage is versioned JSON files under the platform app-data directory. No
  SQLite, no database layer, no migration engine beyond the schema versioning
  already designed. Search indexes are built in memory at startup.
* `packages/sidecar` and `packages/native` are removed from the tree.
* Nothing in the product opens a network socket. That is a meaningful security
  and support simplification, and it stays true by default.
* Licensing keeps its *interfaces* in `core` so a future activation flow has a
  seam, but no enforcement ships.
* Deep duplicate survives, with its documented limitation intact: literal
  `comp("…")` references are rewritten, and anything computed at runtime is
  **reported**, never silently broken.
* Anchor-point and alignment geometry survives, but the rotated/3D/parented cases
  are handled explicitly or declined explicitly — never approximated in silence.

## What the product still is

Everything that made the original pitch worth building: the command palette,
layer and keyframe engines, easing, presets, text, colour, effect management,
rigs, shapes, guides and project analysis. The parts that were cut were the
parts that were not really After Effects workflow tools at all.
