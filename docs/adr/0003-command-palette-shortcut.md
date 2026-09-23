# ADR-0003 — Command palette activation, and what we will not claim

**Status:** Accepted · Phase 1 · Tier 2 gated on `SPIKE-01`

## Context
The specification asks for `Ctrl/Cmd+Space` to open the command palette. After
Effects does not let scripts or CEP panels register global keyboard shortcuts
(`F6`). A CEP panel captures keystrokes only while it has focus. Invisible
background extensions are not documented as supported in AE (`F5`).

## Decision — three tiers, honestly labelled

**Tier 1 (MVP, works today).** `Ctrl/Cmd+Space` opens the palette **while the
KVFX panel or HUD has focus**. The panel is designed to be docked and left open,
so in practice this is one click away at all times.

**Tier 2 (gated on `SPIKE-01`).** A small launcher script installed in AE's
Scripts menu can be bound to a key by the user via AE's `Shortcuts` preferences
file (`ExecuteScriptMenuItem`). The launcher uses
`app.findMenuCommandId` + `app.executeCommand` to open and focus the KVFX panel
(`F7`). If the spike confirms this resolves CEP extension entries in AE 26, this
gives a true global-feeling shortcut. The setup is documented, semi-manual, and
presented as such.

**Tier 3 (deferred, `SPIKE-02`).** An AEGP C++ helper registering a first-class
AE command. Whether such commands accept user-assigned shortcuts is unconfirmed
(`F8`). Deferred until the core is stable; the product must work fully without it.

## Consequences
* Marketing and docs must say "while the panel is focused" for tier 1. We do not
  claim a global hotkey we cannot deliver.
* A subset of the highest-value commands also ships as standalone shortcut-bindable
  launcher scripts, so they run without the panel at all.

## Rejected
* **OS-level global hotkey from the sidecar** — fights AE's own shortcut handling,
  needs elevated/native input hooks, and is hostile on both platforms.
