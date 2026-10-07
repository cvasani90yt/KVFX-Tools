# Testing KVFX Tools

No build tools required. You need After Effects (22.0 or newer; 26.x is the
development target) and about five minutes.

`npm run build` produces `build/KVFX-Tools-v<version>.zip`. If you were sent
the zip, start here.

## The quick way — double-click the installer

1. **Quit After Effects.**
2. **Unzip** the download anywhere (your Downloads folder is fine). Running the
   installer from inside the zip will not work: unzip first.
3. In the unzipped `KVFX Tools …` folder, double-click:
   * **Windows** — `Install KVFX Tools (Windows).cmd`
   * **macOS** — `Install KVFX Tools (macOS).command`
4. Open After Effects ▸ **Window ▸ Extensions ▸ KVFX Tools**.

The installers are not code-signed yet, so the first run is blocked once:

* **Windows** — "Windows protected your PC": click **More info ▸ Run anyway**.
* **macOS** — "cannot be opened": **right-click ▸ Open ▸ Open**.

What the installer does, for your user account only and without
administrator rights: it sets Adobe's `PlayerDebugMode` so After Effects loads
an unsigned extension, and copies `com.kvfx.tools` into your CEP extensions
folder. If KVFX Tools is already installed it asks before replacing it; your
settings are kept either way. `Uninstall KVFX Tools …` removes it again.

If you would rather do it by hand, steps 1–3 below are the same thing.

## Step 1 — Enable CEP debug mode (one time per machine)

After Effects refuses to load an **unsigned** extension unless this is set. Code
signing is a Phase 14 deliverable, so until then this step is required. It is
per-user, needs no administrator rights, and is reversible.

### The easy way — double-click an installer

From [`scripts/setup/`](scripts/setup/):

| Platform | Run this | To undo later |
|---|---|---|
| Windows | `windows/enable-cep-debug.reg` | `windows/disable-cep-debug.reg` |
| macOS | `macos/enable-cep-debug.command` | `macos/disable-cep-debug.command` |

**Windows** will ask you to confirm a registry change. That prompt is expected —
say yes.

**macOS** may block the script because it was downloaded. Right-click ▸ **Open**
▸ **Open** is the standard way to run an unsigned script you trust.

### Or by hand

**macOS** — Terminal:

```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
killall cfprefsd
```

**Windows** — Command Prompt:

```bat
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

Both CEP versions are set because CSXS.12 covers After Effects 26 and CSXS.11
covers 22–25; setting the one you do not have is harmless.

Either way it changes one documented Adobe developer switch and nothing else.
[`scripts/setup/README.md`](scripts/setup/README.md) says exactly what is
written and where.

**Quit and reopen After Effects afterwards.**

## Step 2 — Unzip into the extensions folder

Unzip so that the folder `com.kvfx.tools` sits directly inside `extensions`:

**macOS** — `~/Library/Application Support/Adobe/CEP/extensions/`

In Finder press `⇧⌘G` and paste `~/Library/Application Support/Adobe/CEP/extensions`.
If the `CEP` or `extensions` folders do not exist, create them, or run:

```bash
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
```

**Windows** — `%APPDATA%\Adobe\CEP\extensions\`

Paste that into the Explorer address bar. Create the folders if missing.

The result must look like this:

```
extensions/
└── com.kvfx.tools/
    ├── CSXS/manifest.xml
    ├── host/kvfx-host.jsx
    ├── assets/
    └── index.html
```

A common mistake is ending up with `extensions/com.kvfx.tools/com.kvfx.tools/`.
If `manifest.xml` is not exactly two levels down, the panel will not appear.

## Step 3 — Open the panel

In After Effects: **Window ▸ Extensions ▸ KVFX Tools**

---

## What you should see

A dark panel with an amber diamond and **KVFX** at the top left, your comp's
name and selection beside it, a RAM meter, and search and settings buttons.
Under that, a 3×3 grid of arrows and the create buttons; then a row of tab
icons; and an align bar along the bottom.

If the header says **Not connected**, see *If something does not work* below.

## What to check

Open a project with a composition containing a few layers, including a text
layer. Every item below should be **one** step in Edit ▸ Undo, named
`KVFX Tools — …`. That is the single most important thing to verify: press
`Ctrl/⌘+Z` once after each and everything that command did should revert.

**1. Basics.** Select two layers, click the panel: the header shows
`<comp> · 2 layers`. Click **Null**, pick a colour in the swatch and click
**Solid**. Select a layer and click the bottom-right arrow of the grid: its
anchor moves to the corner and the layer stays put.

**2. Align.** Select three layers, click **Align left**, then **Distribute
horizontally**. Click **Auto** on the right of the align bar to cycle the
reference to **Comp** and align again.

**3. Tools.** Select a comp that contains precomps in the Project panel, click
the panel, and press **Duplicate Comp + Nested Comps**: you get `Name 2` plus a
copy of every comp inside it — change something in a nested copy and the
original stays as it was. Then select two layers and try **Precomp Each** (two new comps),
**Sequence Layers** (staggered by 5 frames), **Null Parent**, **Gradient Lock**
on a text layer (then type more text: the gradient should stay fitted). Edit the
**Transform** fields: on an animated property a keyframe should appear at the
playhead.

**4. Ease.** Animate a layer's position or opacity with two keyframes. Select
both keyframes. Drag the curve's handles, click **Apply to Keys**, and open the
Graph Editor — the curve should match. Click **⟳ Read** to read it back. Select
a property with keyframes and click **Add Bounce**, then **Clear Expr**.

**5. Text.** Type a title and click **Create Text**. Hover the animation
presets to preview them, select the text layer, pick **Rise** and click
**Animate Text**, then play from the playhead. Click **Explode Text** with
**Words**: one layer per word, in place, original hidden. In **Replace Fonts**,
scan and replace a font (After Effects 24.5+).

**6. FX.** Click **Glow** with a layer selected. Then **Scan Selected Layers**,
switch an effect off, and remove one — it asks first.

**7. Generate.** **Create Counter** (watch it count from the playhead).
Select one layer and **Build Carousel** — then change the **Spin** angle on the
`KVFX Carousel` null. Select a text or logo layer and **Extrude**, then orbit
a camera around it.

**8. Library and Media.** **Add Folder** in Library, click an image (imported
and placed) and an `.ffx` preset with a layer selected (applied). In Media, copy
a screenshot and press `Ctrl/⌘+V` with the panel focused: it is saved and
placed in the comp.

**9. Search.** Press `Ctrl/⌘+Space` with the panel focused and type `mtt`
(Move to Top), `eye` (Toggle Visibility), `bounce`. `Enter` runs, `Esc` closes,
☆ pins a command to the top — the pin survives closing the panel.

On macOS `⌘Space` is also Spotlight; if Spotlight opens, macOS took the
shortcut first. Use the search button in the header instead. The shortcut only
works while the panel has keyboard focus — After Effects allows no global
shortcuts from a panel.

**10. Nothing selected.** Deselect everything. Layer commands grey out and their
tooltip says why ("Select a layer first."); the create buttons stay available.

### Behaviour that needs a real After Effects

The test suite runs every command against a model of After Effects, not the
real thing. Please look closely at these, which the model cannot settle
([details](docs/FEATURES.md#verified-so-far-and-what-still-needs-a-real-after-effects)):

* **Explode**: does each piece show exactly its own letters, including on a
  text layer with several lines?
* **Carousel**: do the cards face outwards (front card facing the camera)?
* **Ease** on **Scale** keyframes: does the Graph Editor match the curve?
* **Gradient Lock**: does the gradient span the layer from edge to edge?
* **Media**: does dragging a file from the desktop onto the drop zone import it?

## If something does not work

**Panel missing from the Extensions menu** — almost always step 1 or a wrong
folder depth. Check `manifest.xml` is exactly two levels below `extensions`, and
that After Effects was restarted after the registry/defaults change.

**Header says "Not connected"** — the host script did not load. Close and
reopen the panel, which reloads it.

**Panel opens blank** — the UI failed to load. With the panel open, browse to
<http://localhost:8099> in Chrome or Edge for the panel's developer console.

**"After Effects could not evaluate the request"** — the host script did not
load. Close and reopen the panel, which reloads it.

Fuller symptom list: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## What to report back

Anything from the checklist that did not behave as described — especially a
command that does **not undo in one step**, which is a correctness bug rather
than a rough edge — and the answers to *Behaviour that needs a real After
Effects*. Settings ▸ Diagnostics has the version details to paste.

Screenshots of the panel are useful. So is the exact After Effects version from
**Help ▸ About After Effects**.

---

## Removing it

Delete the `com.kvfx.tools` folder from the extensions directory. That removes
the panel and nothing else.

To also undo step 1, run the matching `disable-cep-debug` script from
[`scripts/setup/`](scripts/setup/). After that, After Effects will again refuse
unsigned extensions — which is the default, and the right state to be in once
you are finished testing.

Your settings live separately and are left alone:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\KVFXTools\` |
| macOS | `~/Library/Application Support/KVFXTools/` |

Delete that folder too for a completely clean slate.
