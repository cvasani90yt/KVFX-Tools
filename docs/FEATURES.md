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
| **Save** | Appears only when the project file hasn't been written for the time set in Settings ▸ Save reminder (20 min by default). Click to save to the project's existing file — the same as File ▸ Save. A project that was never saved is not saved for you: where it goes is your choice, in Save As. |
| **Settings** | Tabs and sections, display, the save reminder, where pasted media is saved, diagnostics, reset. |

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
several), **Comp**, **Sel**, or **Grp**.

**Grp** aligns the selection *as one block*: its combined bounds go to the
composition's edge and every layer moves by the same amount, so the
arrangement is kept. Animated layers move with all their keyframes (the path
shape and timing are unchanged); separated X/Y positions move too. A layer
whose parent is also selected travels with the parent rather than twice.

---

## Tools

| Control | What it does | Limits |
|---|---|---|
| **Precomp Each** | Precomposes every selected layer into its *own* composition, moving all attributes so the outer comp looks unchanged. | Locked layers are skipped. |
| **Split** | Splits the selected layers at the playhead, using After Effects' own Edit ▸ Split Layer. | That command is looked up by its English name. On a non-English install it reports that it is unavailable rather than guessing a command id. |
| **Duplicate Comp + Nested Comps** | Duplicates a composition **and every composition nested inside it, at any depth**, so editing the copy never changes the original. Acts on the comps selected in the **Project panel**; with none selected there, on the **open comp**. The panel shows which before you click. Copies are named `Name 2`, `Name 3`… and sit in the same folder as the originals. A comp used twice inside the original is copied once and used twice inside the copy. Footage and solids are shared, not copied. Expressions that name a copied comp with a literal `comp("Name")` are pointed at the copy. | Expressions that build a comp name at runtime are left alone; the result message says how many. |
| **Duplicate Precomp Layer + Nested** | The same, for a precomp *layer* selected in a timeline: the copy sits directly above it and uses its own copies of the comps. | As above. |
| **Trim to WA** | Sets in and out points to the work area. | |
| **Null Parent** | Creates a null and parents the selection to it, keeping every layer where it is on screen. | |
| **Same Label** | Selects every layer sharing the first selected layer's label. | |
| **Even Gaps** ↔ ↕ (Arrange) | Equal space between the selected layers' **edges**. With **Gap** empty, the outer two stay put and the space between them is shared out (three or more layers); with a value, the first layer stays and the others stack that many pixels apart (two or more). Keyframed layers move with their animation. | 3D layers are skipped, as for alignment. |
| **Sequence** | Staggers the selection in time. **Offset** spaces in-points by the step; **Chain** starts each layer where the previous one ends, the step being the gap (negative overlaps). **Order**: first → last, last → first, centre → out, edges → in, or random (a new shuffle each click). Layers of equal rank — the two middle ones of an even row, say — start together. Layers move by start time, so trims are kept. | |
| **Follow Layer** | Followers copy a leader's movement **without parenting** — optionally its rotation, scale and opacity — with a delay in frames. The top (or bottom) selected layer leads. Each follower gets a **KVFX Follow** Layer Control (so renaming or reordering the leader doesn't break it) and **KVFX Follow Delay**. Followers keep their own values and animation: only the leader's change since you clicked is added. | A property that already has an expression is left alone and reported. |
| **Comp Resizer** | New size, length or frame rate for the comps selected in the Project panel — or the open comp. Formats (16:9, 9:16, 1:1, 4:5, 4K, 720p, 21:9), W × H, swap, or **Scale %**. Content stays pinned to one of nine spots: **Keep** its size, **Fit** inside or **Fill** the new frame (keyframes, spatial tangents and separated positions included; only unparented layers move, children follow). **Extend layers** runs layers that reached the old end to the new end. **Fix parents** corrects every precomp layer that shows a resized comp — anchor point, and scale for Fit/Fill — so nothing jumps in the comps that use it. Asks first. | Cameras and lights are moved but not scaled. Footage that ends sooner than the new length is reported, not stretched. |
| **Silence Remover** | **Analyse** reads the first selected layer's loudness with After Effects' own Convert Audio to Keyframes (the temporary Audio Amplitude layer, work area and selection are all put back) and draws it, pauses greyed. Threshold (a share of the track's loud level), minimum pause and padding update the result live; presets Gentle, Balanced, Tight. **Cut Pauses** then cuts *every selected layer* to the kept parts — **Cut + close** slides later pieces up so picture and sound stay in sync, **Keep gaps** leaves the time, **Markers** only marks the pauses. Each layer is trimmed and duplicated, never deleted; asks first. | Convert Audio to Keyframes is found by its English menu name. |
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
| **Animate** | 41 presets in eight families (Fade, Move, Scale, Blur, Rotate, Spacing, Colour, Code) — from Rise and Pop to Squash, Whip, Elastic Pop, Bounce Drop, Typing with a caret, Scramble, Decode, Colour Typing and Highlight Sweep. Filter by family, ★ favourites or Recent. **In**, **Out** or **In+Out** (in from the playhead, out at the layer's end); by **characters, words or lines**; **order** first → last, last → first, centre → out, edges → in or random; **ease** from the preset, the Ease tab's curve, or Soft, Smooth, Expo, Back, Elastic, Bounce, Snap, Linear, Step, with an **overshoot** amount; **stagger** and per-unit duration in frames; an **accent** colour for the colour presets. The preview runs the same order and easing maths as After Effects will. | **Live** (default) builds an expression selector — every option works and timing follows later text edits. **Keys** builds range-selector keyframes you can drag, stretched to each layer's own text; overshooting eases are approximated by a curve there. Typing writes a Source Text expression and leaves one you wrote alone. |
| **Kinetic Title** | A phrase as big animated type, sized to fit: **Stack**, **Punch** (one word at a time), **Slide**, **Pop**, **Zoom**, **Bounce**, **Type**, **Highlight**. Words in \*stars\* get the accent colours. Optional solid or drifting background. Builds in this comp or a new **16:9, 9:16, 1:1 or 4:5** comp, opened for you. | Each line is live text — restyle it with Style. Up to 40 words. |
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

Chips at the top filter the tab: **Layouts**, **UI Motion**, **Scenes**, **Builders**.

### Layouts

Fourteen interface scenes, each drawn here from scratch: **Chat Thread**,
**Notification**, **Metric Cards**, **Bar Chart**, **Line Chart**, **Progress
Ring**, **Feature Card**, **Card Stack**, **Pricing Card**, **Testimonial**,
**Kanban Board**, **Team List**, **Phone Frame** and **Browser Window**. The
gallery's thumbnails are drawn from the same data the builder uses.

Type your own words (lists are comma-separated), pick **Dark** or **Light**, an
accent and corner roundness, then the reveal (as designed, or one style for
everything), stagger and duration. The scene is fitted to the comp — the same
template reads right in 16:9, 9:16 or square — and arrives in order: bars grow
from their base, lines and rings draw on, numbers count up. Every part is an
ordinary layer, parented to one **KVFX Layout** null you can move or scale.

### UI Motion

| Rig | What it builds | Adjust afterwards |
|---|---|---|
| **UI Stagger** | Reveals the selected interface layers one after another — rise, drop, slide either way, pop, scale, blur, bounce (with a squash on landing) or fade — **in screen order** (top → bottom, bottom → top, left → right, right → left, centre → out), stack order or shuffled. In, Out or In+Out. | Each layer gets one **KVFX Reveal** slider with two keys; its own position, scale and animation are untouched. |
| **Cursor** | An arrow, hand or touch cursor that travels to each selected layer in click order and clicks it: arcing paths, tilt into the motion, a slight lift while moving, soft shadow, a ripple at each click, the clicked layer dipping as it is pressed, and an optional name tag on an accent plate. | Retime by moving the cursor's position keys; arc, tilt and lift are numbers in its expressions. |
| **Card Carousel** | The selected cards in a flat row: the focused card full size, its neighbours smaller and faded, advancing by itself — hold, move, loop. | Everything lives on the **KVFX Card Carousel** null; key its **Index** to drive it by hand. |
| **Hover Lift** | The selected layers grow and lift as a cursor comes near (measured to their edges, not their centres). The cursor is a selected **KVFX Cursor**, or the top selected layer. | A **KVFX Hover** Transform effect does the work, so it stacks with any other animation; Hover Radius, Scale and Lift sliders. |
| **Input Bar** | A search or message bar that types your text with a caret, hides its placeholder as typing starts, then presses its send button. Dark or light. | One **KVFX Input Bar** null to move it. |

### Scenes

| Rig | What it builds | Adjust afterwards |
|---|---|---|
| **Backdrop** | A moving background: **Drift** (a slow four-colour gradient), **Horizon** (a glowing horizon) or **Stars** (seventy twinkling points), in six palettes, with optional film grain. Goes to the bottom of the stack, or with **Clip to layer** fills the selected layer's shape. | **Speed** slider on the layer. |
| **Dot Pulse** | A halftone grid of dots with a shockwave rippling out from the centre — behind the selected layer, inside its shape, or over the whole comp. | Pulse Speed, Width, Every and Idle Size sliders. |
| **Frosted Glass** | Blurs and frosts whatever is behind the selected card, within its shape. Optionally sets the card's own opacity. | **KVFX Glass** adjustment layer: blur and frost effects. |
| **Wipe Reveal** | Soft-edged linear wipes in or out from the playhead, in a direction, one layer after another, on the Ease tab's curve. | **KVFX Wipe** effect keys. |
| **Code Glyphs** | A decoding headline over scrolling pseudo-code and a flickering field of glyphs, in your colour. | Rows and speed are numbers in the code layer's expression. |

Anything clipped "to a layer" — Backdrop, Dot Pulse inside, Frosted Glass — is
matted by a **hidden copy** of that layer, so the layer itself is never changed.

Rigs find their controls through `parent` or the layer's own effects, never by a
layer name, so renaming or duplicating a rig cannot rewire it to another one.
Rigs never replace an expression that is already on one of your layers.

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

### Missing Footage

**Find Missing** lists the footage this project can't locate. **Search…** looks
through a folder you choose (and its subfolders) for files with the same names,
nearest first, and ticks the matches. **Relink** asks, then points only the
ticked items at their files. Nothing on disk is moved, renamed or written.

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
* **Sections** — show, hide and reorder the sections inside each tab.
* **Display** — tooltips on or off (why a control is disabled always shows), and
  compact spacing for small docked panels.
* **Save reminder** — off, or after 10, 20, 30 or 60 minutes without saving.
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
| Morphing between layouts | Matching shapes across two arbitrary layouts can't be done reliably; a wrong morph looks worse than a cut. |
| Depth-based reveals from a single image, and turning a screenshot into separate layers | Both need a model to estimate depth or recognise interface parts. KVFX ships no AI ([ADR-0007](adr/0007-scope-reduction.md)); stack your own layers and use UI Stagger, or Dot Pulse inside a layer. |
| Importing subtitle (`.srt`) files | Captions were cut with ADR-0007. |
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
* Text: the expression selector's match names (`ADBE Text Expressible
  Selector`, `ADBE Text Expressible Amount`), Randomize Order and Random Seed,
  and Based On numbering (characters excluding spaces = 2, words = 3, lines = 4).
* Linear Wipe's angle convention for the four directions; 4-Color Gradient,
  Drop Shadow, Fill, Noise and Transform effect parameter order (addressed by
  value type and position, not by name).
* `setTrackMatte` on After Effects 23+ and the adjacent-matte fallback before it.
* Convert Audio to Keyframes analysing the selected layer within the work area,
  and its slider names.
* `CompItem.openInViewer()` making the new comp the active item for the rest of
  a Kinetic Title plan.
* Layer Control values tracking the leader when layers are reordered.
