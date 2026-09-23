# ADR-0001 — Build the UI on CEP 12, not UXP

**Status:** Accepted · Phase 1 · Revisit each AE major release

## Context
The product needs a modern, dense, keyboard-first panel UI inside After Effects.

## Decision
Build on CEP 12.

## Rationale
UXP panels do not exist for After Effects (`F1`). AE's UXP entry covers
scripting-only APIs. CEP is fully supported in AE 26 (`F2`). There is no third
HTML-panel option.

## Consequences
* Chromium 99 / Node 17.7.1 baseline (`F3`) constrains CSS and JS.
* CEP is on a long, undated deprecation runway.
* **Mitigation:** all CEP API usage is confined to `packages/ui/src/app/cep/`. A
  future UXP port replaces that adapter and the packaging pipeline, not the
  product.

## Rejected
* **UXP** — the panel surface does not exist for AE.
* **ScriptUI panels** — no realistic path to the required UI density, theming or
  keyboard behaviour.
