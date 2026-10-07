# KVFX Tools — Feature Reference

What every control in the panel does, how it does it, and where its limits are.
Every action that changes your project is **one entry in Edit ▸ Undo**, named
`KVFX Tools — …`, however many steps it took.

The panel never assumes it knows your selection: After Effects sends no
selection events, so it re-reads the selection when the panel gains focus,
after every command, and when you click the composition name in the header.
Commands always act on what is selected *at the moment you click*.

---

## Always visible

### Header

| Control | What it does |
|---|---|
| **Composition · selection** | The active comp and how many layers are selected. Click to re-read. |
| **RAM meter** | Memory After Effects is using, refreshed every 15 s while the panel is visible and whenever it gains focus. The bar is scaled to a nominal 32 GB — After Effects reports what *it* uses, not what the machine has. |
| ↳ **Purge image caches** | Frees rendered frames. Undo history is kept. |
| ↳ **Purge everything…** | Frees every memory cache **including the undo history**. Asks first. |
| **Search** (`Ctrl/⌘+Space`) | Every command by name, keyword or acronym — `mtt` finds Move to Top. ☆ pins a command to the top. The shortcut works while the panel has keyboard focus; After Effects allows no global shortcuts from a panel ([ADR-0003](adr/0003-command-palette-shortcut.md)). |
| **Settings** | Show or hide tabs, choose where pasted media is saved, diagnostics, reset. |

### Anchor grid and creators

* **3×3 anchor grid** — moves the anchor point to that spot of each selected
  layer's bounds *without moving the layer*. Handles scale, rotation and
  parenting; declines 3D layers and animated anchors with a reason rather than
  guessing.
* **Null · Adjust · Solid ▪ · Text · Shape · Camera** — created at the top of the
  composition. The swatch beside Solid sets its colour and is remembered.

### Align bar

Align left / centre / right / top / middle / bottom, and distribute horizontally
or vertically (three or more layers). The button on the right cycles what you
align against: **Auto** (the composition for one layer, the selection for
several), **Comp**, or **Sel**.

---

## Tools

| Control | What it does | Limits |
|---|---|---|
| **Precomp Each** | Precomposes every selected layer into its *own* composition, moving all attributes so the outer comp looks unchanged. | Locked layers are skipped. |
| **Split** | Splits the selected layers at the playhead, using After Effects' own Edit ▸ Split Layer. | That command is looked up by its English name. On a non-English install it reports that it is unavailable rather than guessing a command id. |
| **Deep Dupe** | Duplicates a precomp **and every composition nested in it**, so editing the copy never edits the original. Shared nested comps stay shared inside the copy. Expressions that name a copied comp with a literal `comp("Name")` are pointed at the copy. | Expressions that build a comp name at runtime are counted and reported, not rewritten. |
| **Trim to WA** | Sets in and out points to the work area. | |
| **Null Parent** | Creates a null and parents the selection to it, keeping every layer where it is on screen. | |
| **Same Label** | Selects every layer sharing the first selected layer's label. | |
| **Sequence** | Staggers the selection top to bottom. **Offset** spaces in-points by the step; **Chain** starts each layer where the previous one ends, the step being the gap (negative overlaps). Layers move by start time, so trims are kept. | |
| **Fill** | Adds a Fill effect in the chosen colour. | |
| **Gradient Lock** | Adds a Gradient Ramp whose ends follow the layer's own bounds via `sourceRectAtTime`, so the gradient stays fitted as text or shapes change size. Vertical, horizontal or diagonal. | |
| **Switches** | Solo, visibility, lock, unlock all, shy, 3D, guide, adjustment. A mixed selection is normalised to *on* rather than flipped layer by layer. | |
| **Order** | Move to top, up one, down one, to bottom. | |
| **Transform** | A live inspector for the first selected layer: anchor, position, scale (linked or not), rotation, opacity — plus Z values on 3D layers. Enter applies. **Animated values get a keyframe at the playhead**, exactly like After Effects' own Properties panel; ◆ marks animated values. Values driven by an expression are shown read-only. | Separated position dimensions are written to X/Y/Z Position individually. |

---

## Ease

### Curve editor

Drag the two handles, type or paste values (`cubic-bezier(.25,1,.5,1)` works),
or pick a preset. A dot underneath plays the curve live.

* **Apply to Keys** — converts the curve to After Effects' speed and influence on
  the **selected keyframes**: each selected key gets the curve on both of its
  sides, so selecting every keyframe eases the whole animation.
* **Read** (⟳) — reads the curve back from the selected keyframes, so you can see
  and copy what a key already has.
* **Flip** (⇄) — mirrors the curve in time: an ease-in becomes the matching
  ease-out.
* **Presets** — Linear, Easy Ease, Smooth, Snap, and Sine / Quad / Cubic / Quart /
  Expo / Back in each of In, Out and In-Out. **Saved** holds your own named curves.

How the conversion works: for a segment with average speed *v*, the outgoing
influence is `x1 · 100` with speed `(y1/x1) · v`, and the incoming influence is
`(1 − x2) · 100` with speed `((1 − y2)/(1 − x2)) · v`. That is exact for
one-dimensional values and per dimension for Scale and other multi-value
properties.

**Limits:** for spatial properties (Position) After Effects measures speed along
the motion path, which cannot be negative — so anticipation handles (y below 0)
are flattened to zero speed. Colours and shape paths keep the curve's influence
but not its speed. Influence is clamped to After Effects' 0.1–100 % range.

### Keyframes and motion

| Control | What it does |
|---|---|
| **Linear · Bezier · Hold** | Interpolation of the selected keyframes. |
| **Reverse** | Mirrors the selected keyframes in time across their own span; each keeps its value and its in/out ease, interpolation and spatial tangents swap sides. |
| **Add Elastic** | An overshoot-and-settle expression after each keyframe, driven by the speed the property arrives with. Amplitude, frequency and decay are adjustable. |
| **Add Bounce** | A physical bounce off each keyframe: elasticity and gravity adjustable. |
| **Add Wiggle** | `wiggle(frequency, amount)`. |
| **Loop · Ping-Pong · Continue** | `loopOut()` in the matching mode. |
| **Clear Expr** | Removes expressions from the selected properties and disables evaluation, so the property returns exactly to its keyframed value. |

Motion commands act on **properties selected in the timeline**. Elastic, bounce
and loops skip properties with fewer than two keyframes and say so. Every
generated expression runs unchanged on both After Effects expression engines.

---

## Text

| Control | What it does | Limits |
|---|---|---|
| **Create Text** | A text layer with the text, font, size, colour and tracking above. The font field suggests installed fonts as you type. | Font names are PostScript names (`Inter-Bold`). |
| **Apply Style** | The same styling on the selected text layers. | Layers whose Source Text is animated are skipped — restyling would rewrite the animation. |
| **Animate** | Typewriter, Fade In, Rise, Drop, Slide, Pop, Blur In, Spin, Track In, Zoom Out — a text animator whose range selector sweeps from the playhead. Hover a preset to preview it live; **Speed** scales its duration. | |
| **Explode** | One live-text layer per letter, word or line, each still in its exact place, with the original's styling and animation. The original is **hidden, not deleted**. | Up to 300 pieces. Each piece is a duplicate with an animator that hides the rest of the text. |
| **Replace Fonts** | Lists every font the project uses, with use counts, and swaps one for another everywhere — asks first. | Needs After Effects 24.5 or later (`Project.replaceFont`). |

---

## FX

* **Add Effect** — Gaussian Blur, Glow, Drop Shadow, Tint, Gradient Ramp, Bevel
  Alpha, and Slider / Checkbox / Color / Point / Angle controls. Added by match
  name, so they work in every language of After Effects.
* **Effects Manager** — **Scan Selected Layers** lists every effect on them. Switch
  effects on or off, all at once or individually, or remove them (asks first;
  Edit ▸ Undo brings them back). If a layer's effect stack changed since the
  scan, the panel refuses the edit and asks you to rescan rather than touching
  the wrong effect.

---

## Generate

| Generator | What it builds | How you adjust it afterwards |
|---|---|---|
| **Number Counter** | A text layer that counts from *From* to *To* over *Time*, eased with the Ease tab's curve, with decimals, thousands grouping (`1,000` / `1.000` / `1 000` / none), decimal mark, prefix and suffix. The preview shows exactly what it will display. | Move the two keyframes on the layer's **KVFX Counter** slider (0–100 % progress). The range lives in the expression, so any size of number works — Slider Control alone stops at ±1,000,000. |
| **3D Carousel** | The selected layers — or copies of one — on a ring around a **KVFX Carousel** null, each facing outwards. | **Radius** and **Spin** sliders on the null; rotate the null itself to tilt the ring. |
| **3D Extrude** | Depth for the selected layers: stacked, parented slices behind each face, filled with the side colour. | **KVFX Extrude** slider on the face layer. |

Rigs find their controls through `parent` or the layer's own effects, never by a
layer name, so renaming or duplicating a rig cannot rewire it to another one.

---

## Labels

Sixteen label colours plus **No Label**, applied to the selection, and **Select
Same**. Shows which labels the selection has.

**Limit:** the swatches are After Effects' factory colours. If you changed label
colours in Preferences ▸ Labels, the panel cannot read them — scripting has no
access to those preferences.

---

## Library

Add your own folders of footage, templates and presets. Browse folders, filter
by name, click to use:

| File | Click does |
|---|---|
| Images, video, audio | Imports it and places it at the top of the active comp |
| `.aep` / `.aepx` | Imports the project into its own folder (not placed) |
| `.ffx` | Applies the animation preset to the selected layers |

Folders are read one level at a time, on demand. Nothing is ever written to
them; removing a folder from the Library leaves the folder itself untouched.
Scripts (`.jsx`, `.jsxbin`) are never run or imported.

---

## Media

**Paste** (`Ctrl/⌘+V` with the panel focused) or **drop** images, video or audio.
After Effects can only import files, so each one is saved first and then
imported and placed in the comp:

* **Beside the project** (default) — a `KVFX Media` folder next to the saved
  `.aep`, so the project stays portable. Used whenever the project is saved.
* **KVFX app data** — your user application-data folder. Used anyway while the
  project is unsaved.

Pasted screenshots are named `Paste YYYYMMDD-HHMMSS.png`. An existing file is
never overwritten — a new name gets ` 2`, ` 3`… Files over 512 MB are refused
with a pointer to File ▸ Import, because they would be held in memory.

---

## Settings

* **Tabs** — hide the ones you don't use (their commands stay in search). The last
  visible tab cannot be hidden.
* **Pasted and dropped media** — where Media saves files.
* **Diagnostics** — versions, round-trip time and the settings file location, to
  copy into a bug report.
* **Reset all…** — every preference back to its default, after asking. Projects
  are not touched.

Settings live in the platform application-data folder (`%APPDATA%\KVFXTools\`
on Windows, `~/Library/Application Support/KVFXTools/` on macOS), never in the
extension's install folder.

---

## Not included, and why

| Feature | Why not |
|---|---|
| Saving a composition out as its own `.aep` | Scripting can only save the *whole* project. Trimming a copy down to one comp means reducing the project in place, which is destructive — not worth the risk to your work. |
| Saving `.ffx` presets from the panel | There is no scripting API for it. Save with Animation ▸ Save Animation Preset; the Library then applies them in one click. |
| Glass / morph style looks | A tuned look is a stack of effects chosen per shot; a one-click version would mostly be wrong. Deferred until it can be done well. |
| Tabs as separate, undockable panels | Possible (one manifest extension per tab) but not built yet. |
| Interface languages other than English | Not translated yet. Commands work in every language of After Effects — they use match names — except **Split**, noted above. |
| AI, automatic captions, downloading media from URLs, reference board, licence activation, auto-update | Cut by [ADR-0007](adr/0007-scope-reduction.md). |
| A RAM meter against total system memory | Needs Node.js in the panel, which is deliberately off; the meter shows what After Effects uses. |

## Verified so far, and what still needs a real After Effects

Every command runs end to end in the test suite — probe, plan and execution
through the real dispatcher — against a mock of the After Effects scripting DOM,
and the panel is exercised in Chromium. That proves the wiring, the maths and the
safety rules. It cannot prove how After Effects itself behaves, so these points
are on the first real-host checklist ([TESTING.md](../TESTING.md)):

* Text animators: whether a new animator already contains a range selector (the
  code handles both), and Index-unit selectors counting line breaks as characters.
* The carousel's `lookAt` orientation turning cards outwards rather than inwards.
* Easing speed signs on multi-dimensional, non-spatial properties such as Scale.
* Gradient Ramp's point parameters being two-dimensional spatial values.
* Dropped files arriving as readable `File` objects with Node.js disabled.
