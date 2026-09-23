# ADR-0005 — Heavy work runs in a separate process, not in CEP's Node

**Status:** Accepted · Phase 1 · Implemented from Phase 11

## Context
CEP 12 embeds Node 17.7.1 with Node-Webkit 0.62.1 (`F3`). Native modules loaded
inside the panel must match that ABI on Windows and macOS, across Intel and ARM.
The product needs Whisper transcription, AI provider calls, SQLite indexing,
media thumbnailing and OS keychain access.

## Decision
A standalone sidecar process on its own modern runtime, communicating with the
panel over a localhost WebSocket bound to `127.0.0.1` on an ephemeral port, with
a per-session token in a user-only-readable file and strict `Origin` checking.

## Consequences
* We control the sidecar's runtime version independently of Adobe's.
* Native dependencies are built once per platform, not against a frozen ABI.
* Heavy work cannot block After Effects or the panel — different process.
* A crash in transcription or AI cannot take down the panel or AE.
* Cost: process lifecycle, port/token handshake, and shipping a second binary
  that must be signed and notarised.
* **Non-negotiable:** the sidecar is local IPC. It must never be reachable
  off-host.

## Rejected
* **Native Node modules inside CEP** — ABI trap, per-platform rebuild burden,
  crashes take down the panel.
* **Everything in ExtendScript** — single-threaded on AE's main thread (`F10`);
  would freeze After Effects.
