# Adobe Platform Findings (verified)

Every claim below was checked against a primary or near-primary source in
September 2026, not recalled from memory. Claims that could **not** be verified
are marked `SPIKE` and must be proven with a throwaway prototype before any
design depends on them.

Re-verify this document at the start of every major AE release cycle.

---

## F1 — UXP panels are not available for After Effects

**Status: verified. Decisive.**

After Effects appears in the UXP version matrix from AE 22.0, but that entry
covers *scripting-only UXP APIs*, not the panel/plugin framework that Photoshop,
InDesign and Premiere Pro ship. As of April 2026 there is no production UXP
panel surface for After Effects. Premiere Pro made UXP standard in its 2026
release; After Effects did not follow.

**Consequence:** UXP is not a candidate for the KVFX Tools UI. This is not a
preference — the surface does not exist.

## F2 — CEP is fully supported in After Effects 26 and is the only HTML panel option

**Status: verified.**

CEP-based extensions load in every current After Effects release. Adobe has said
CEP will eventually be retired and that CEP 12 is the last major CEP version
(security fixes continue), but no cut-off date has been announced and the
horizon given is "several years".

**Consequence:** Build on CEP 12, and isolate every CEP-specific API behind a
single adapter module so a future UXP port replaces one layer, not the product.

## F3 — CEP 12 runtime versions

**Status: verified** (Adobe CEP 12 HTML Extension Cookbook).

| | CEP 9 | CEP 10 | CEP 11 | **CEP 12** |
|---|---|---|---|---|
| Chromium | 61 | 74 | 88 | **99** |
| Node.js | 8.6.0 | 12.3.1 | 15.9.0 | **17.7.1** |
| CEF/Node integration | NW 0.25 | NW 0.38 | NW 0.50.1 | **NW 0.62.1** |

**Consequences — these are hard constraints on the UI layer:**

* Browser baseline is **Chromium 99 (March 2022)**. Not available: CSS `:has()`
  (Chrome 105), container queries (105), `color-mix()` (111), `oklch()` (111),
  native CSS nesting (112), `subgrid` (117). The design system must be authored
  within that baseline and the build must target it — a stylesheet that looks
  correct in a 2026 browser can silently break in the panel.
* JS build target is **ES2021**, not "latest".
* Any Node native module loaded *inside* the panel must match the Node-Webkit
  0.62.1 / Node 17 ABI on both Windows and macOS. This is a maintenance trap and
  is the single strongest argument for the out-of-process sidecar (see ADR-0005).

## F4 — After Effects emits no selection-change events, and no CEP standard events

**Status: verified. Shapes the entire UI data-flow.**

There is no callback, hook or event for "the user selected a different layer or
composition" in After Effects. Adobe's stated reason is performance. The common
workaround — polling ExtendScript every ~200 ms — is explicitly not recommended:
it is survivable on small projects and can hang or crash After Effects on large
ones. Adobe's own guidance is to refresh when the panel gains focus, or to offer
an explicit refresh control.

Separately, the CEP 12 "Standard Events in Point Products" table lists PS, ID,
AI, AN, PR, PL and AU. **After Effects has no column at all** — so
`applicationActivate`, `documentAfterActivate` and friends must be treated as
unavailable in AE.

**Consequence:** selection is **pull-based, never push-based**. See ADR-0002.

## F5 — Invisible CEP extensions are not documented as supported in After Effects

**Status: verified (by absence). Treat as unsupported.**

The CEP 12 invisible-extension support table lists Photoshop, Premiere Pro,
Prelude, Animate, Audition, InDesign, InCopy and Illustrator. After Effects is
absent.

**Consequence:** no architecture may depend on a background/`Custom`-type
extension in AE. MVP ships exactly one visible extension.

## F6 — Scripts cannot register global keyboard shortcuts

**Status: verified, with a documented partial workaround.**

After Effects' visual keyboard-shortcut editor covers built-in commands. It does
not expose arbitrary scripts. Two partial routes exist:

1. `Ctrl+F2`…`Ctrl+F4` run the first three items of the Scripts menu.
2. The AE preferences `Shortcuts` file contains `ExecuteScriptMenuItem` entries
   that can be hand-edited to bind a key to a specific Scripts-menu slot
   (slot is alphabetical, so scripts are named to control ordering).

A CEP panel can only capture keystrokes while the panel itself has focus.

**Consequence:** "`Cmd/Ctrl+Space` opens the command palette" is honest only
*while the KVFX panel has focus*. Everything else is a workaround with caveats.
See ADR-0003 for the tiered plan and its limits — this must not be oversold in
marketing copy.

## F7 — `app.findMenuCommandId` / `app.executeCommand` exist

**Status: API verified. Behaviour for CEP entries is `SPIKE`.**

`app.findMenuCommandId(commandText)` resolves a menu item by its exact UI text
and `app.executeCommand(id)` invokes it.

`SPIKE-01`: confirm this resolves the `Window > Extensions > KVFX Tools` entry in
AE 26 on both platforms. If it does, a shortcut-bound launcher script can open
and focus the panel even when it is closed, which is what makes F6's tier 2
worth building.

## F8 — AEGP C++ plugins can add menu commands; shortcut assignment is unconfirmed

**Status: partially verified. `SPIKE`.**

AEGPs can add menu items and hook AE's internal commands. Whether an
AEGP-registered command becomes assignable in AE's keyboard-shortcut editor is
**not confirmed** — available sources suggest it is not natively customisable
there. An AEGP can, however, look up and invoke an existing command.

`SPIKE-02`: register a command from a minimal AEGP and check whether it appears
in the shortcut editor, and whether it can open the CEP panel.

**Consequence:** the native helper is an optional accelerator, deferred to after
the core is stable. Nothing in the MVP may depend on it.

## F9 — Scripting APIs we are relying on (all confirmed present)

| API | Since | Used by |
|---|---|---|
| `Layer.id`, `Project.layerByID()` | AE 22.0 | stable object identity (ADR-0004) |
| `KeyframeEase`, `Property.setTemporalEaseAtKey()`, `keyIn/OutTemporalEase()` | long-standing | easing engine |
| `Property.setSpatialTangentsAtKey()`, `setInterpolationTypeAtKey()` | long-standing | keyframe engine |
| `app.fonts` (`FontsObject`, `FontObject`) | AE 24.0 | font scanning, preview metadata |
| `FontsObject.favoriteFontFamilyList`, `mruFontFamilyList` | AE 24.6 | font favourites / recents |
| `Project.usedFonts`, `Project.replaceFont()` | AE 24.5 | font audit + global replacement |
| `Project.autoFixExpressions()` | long-standing | expression repair |
| `Layer.applyPreset(File)` | long-standing | `.ffx` application |
| `Layer.copyToComp()` | long-standing | deep duplicate |
| `MarkerValue.get/setParameters()` | long-standing | rig + preset metadata |
| `app.begin/endUndoGroup()` | long-standing | undo discipline (ADR-0006) |
| `app.settings.saveSetting/getSetting` | long-standing | small preference values |
| `app.scheduleTask(code, delayMs, repeat)` | long-standing | cooperative deferral inside AE |
| `system.callSystem()` | long-standing | sidecar launch (last resort) |
| `Project.xmpPacket` | AE 9.0 | per-project id stamp (`SPIKE-03`) |
| `app.setMultiFrameRenderingConfig()` | AE 22.0 | diagnostics reporting only |
| `PropertyGroup.addVariableFontAxis()`, `Property.propertyParameters`, `Property.valueText` | **AE 26.0** | variable-font text tools, dropdown-effect reads |

## F10 — ExtendScript language and threading reality

**Status: verified.**

ExtendScript is ECMAScript 3rd Edition with Adobe extensions. It runs on After
Effects' main thread. There is no `Promise`, no `let`/`const`, no arrow
functions, no `JSON` guarantee, no modules, and **no threading** — while a script
runs, After Effects is frozen.

**Consequences:**
* The host bundle is compiled to ES3 and ships its own minimal JSON serialiser.
* Long work is chunked and yielded via `app.scheduleTask`, or moved off-host.
* Wall-clock budgets are enforced per operation; nothing heavy runs on the host.

---

## Open spikes (blocking nothing in the MVP, but scheduled)

| ID | Question | Blocks |
|---|---|---|
| SPIKE-01 | Does `findMenuCommandId` resolve the CEP extension entry in AE 26? | palette launcher tier 2 |
| SPIKE-02 | Do AEGP-registered commands accept user shortcuts? | native helper value |
| SPIKE-03 | Can we merge into `xmpPacket` additively without clobbering other metadata? | project notes storage |
| SPIKE-04 | Cost of the cheapest useful selection fingerprint on a 5 000-layer project | selection polling defaults |
| SPIKE-05 | Does AE's panel system allow a usefully small floating window for the HUD? | HUD form factor |

## Sources

* [UXP status note for After Effects (AE SDK knowledge base)](https://github.com/pushREC/after-effects-sdk-kb/blob/main/scripting/UXP-STATUS-NOTE.md)
* [ExtendScript complete reference through AE 26.0 (AE SDK knowledge base)](https://github.com/pushREC/after-effects-sdk-kb/blob/main/scripting/01-extendscript-complete-reference.md)
* [Adobe CEP 12 HTML Extension Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
* [After Effects Scripting Guide (community reference)](https://ae-scripting.docsforadobe.dev/)
* [Adobe: Scripts in After Effects](https://helpx.adobe.com/after-effects/using/scripts.html)
* [Adobe: preset and customizable keyboard shortcuts](https://helpx.adobe.com/after-effects/using/keyboard-shortcuts-reference.html)
* [Adobe Tech Blog: updates for Creative Cloud desktop extensibility](https://medium.com/adobetech/updates-for-creative-cloud-desktop-extensibility-0dd5c663563e)
* [Hyper Brew: UXP plugins in Premiere 2026 — the CEP migration clock](https://hyperbrew.co/blog/uxp-plugins-in-premiere-2026/)
* [Adobe community: detecting selection changes in a CEP extension](https://community.adobe.com/t5/after-effects-discussions/cep-extension-development-how-to-detect-user-selection-changes-in-active-project/td-p/13899040)
* [After Effects C++ SDK Guide](https://ae-plugins.docsforadobe.dev/)
