# KVFX Tools: the walkthrough video

A long-form YouTube video (16:9, about five and a half minutes) that builds
one promo for a made-up app, **Kovo**, live, chapter by chapter, with KVFX
Tools. It opens on the finished promo, rewinds to an empty comp, and then
builds that promo one tool at a time, ending on the 16:9 and 9:16 versions
side by side.

Everything in the comp viewer is real KVFX output. The builder asks the
installed KVFX host to run the exact plans the panel's commands produce, so
what viewers see is what the panel does. The panel close-ups are recordings of
the real panel.

| File | What it is |
|---|---|
| `KVFX-Walkthrough-Builder.jsx` | Builds the whole edit in After Effects. |
| `walkthrough-script.jsxinc` | The voiceover script: one entry per voiceover file, with caption breaks. |
| `walkthrough-shots.jsxinc` | The shot list: what the panel and the viewer show at each caption. |
| `walkthrough-recipes.jsxinc` | The demo scenes as KVFX plans. **Generated**; do not edit by hand. |
| `assets/clips/wt-*.mp4` | Panel recordings, one per chapter, at 2× (760 × 1720, 30 fps). |
| `assets/vo/` | The voiceover takes (not in the repository). |
| `assets/music/`, `assets/sfx/` | Licensed music and sound effects (not in the repository). |

The builder also uses `../assets/clips/ease.mp4` and `palette.mp4` from the
promo kit, and its sound effects from `../assets/sfx` when this folder has none.

## Build it

1. **Voiceover.** Download the 12 takes from Higgsfield into `assets/vo`. You
   can keep Higgsfield's file names, since the builder finds each take by its job id,
   or rename them `01-hook.wav` … `12-end.wav`.
2. **Music (optional).** Put one licensed track in `assets/music`.
3. **Fonts.** Install **Unbounded**, **Inter** and **JetBrains Mono** (free on
   Google Fonts). Without them the builder falls back and says so.
4. **KVFX Tools.** Install it and open the panel once
   (**Window ▸ Extensions ▸ KVFX Tools**). The builder runs the demo scenes
   through it. If the panel has not been opened, the builder loads the host
   script from the installed extension itself. If KVFX Tools isn't installed at
   all, every scene becomes a labelled stand-in.
5. **Run** `KVFX-Walkthrough-Builder.jsx` with **File ▸ Scripts ▸ Run Script
   File…**. Keep the `.jsxinc` files and `assets` next to it.

It adds a **KVFX Walkthrough** folder and opens `WT · MAIN 16x9`. A message
lists the YouTube chapters with their times, any scene that needs a look, and
anything that was missing. Nothing already in the project changes. To remove
the build, delete the folder.

Each demo scene is built in its own new comp, and only while that comp is the
active one. If After Effects doesn't make it active, the scene is left empty and
reported rather than built somewhere else.

## How the edit works

* **The voice sets the pace.** Each segment is as long as its take. The builder
  asks KVFX Tools for the take's loudness (the same analysis Silence Remover
  uses) to find where the speech starts and ends. Captions are spread over
  the speech by length.
* **Shots follow the captions.** In `walkthrough-shots.jsxinc`, a beat starts
  at a caption (`cap: 3.5` is halfway through the fourth one) and sets what the
  panel or the viewer shows:
  * `sync: [scene, run time, click time]` starts a scene so that its command
    runs at the moment the recording clicks the button for it.
  * `panel: [clip, from, rate, a, b]` can slow a recording down, hold a
    frame (rate 0), or loop a stretch while the voice catches up.
  * `focus` pushes in on part of the panel, `wide` gives the viewer the
    whole frame, and `chip` names where the tool lives.
* **Chapters** open with a card over the viewer, then keep an `01 / 08` chip.
  `MAIN` has a marker at each chapter and a progress line along the top.
* **Sound.** Each take sits in its segment. A click plays where the recording
  clicks, a whoosh on each wide shot, a pop on each chip and a riser on each
  chapter card. The music runs under everything in `MAIN`.
* **The Kovo promo** (`Kovo Promo 16x9`) is cut from the demo scenes.
  `Kovo Promo 9x16` is a copy made vertical with **Comp Resizer** (Fit), over
  a soft, dark copy of itself.

The Silence Remover and Missing Footage scenes are drawn by the builder. One
needs a recorded voice and the other genuinely missing files, so neither can
be staged for real. The silence scene draws the waveform of the chapter's own
voiceover.

## Export

| Target | Comp | Settings |
|---|---|---|
| YouTube | `WT · MAIN 16x9` | 1920 × 1080, 30 fps, H.264 High, VBR 2-pass, target 20 Mbps, AAC 320 kbps |
| Shorts / Reels | `Kovo Promo 9x16` | 1080 × 1920, 30 fps, H.264, target 16 Mbps |

Paste the chapter list from the build message into the YouTube description.
The first line must be `0:00`.

## Changing it

* **Words.** Edit `walkthrough-script.jsxinc` and generate that take again. The
  edit re-times itself on the next build.
* **Shots.** Edit `walkthrough-shots.jsxinc`.
* **Demo scenes.** They are defined in
  `packages/host/tests/walkthrough-recipes.test.ts`, which runs each one
  through the shipped commands against the mock After Effects and proves the
  recipe replays identically. Regenerate the file after a change, or when a
  command changes:

  ```
  KVFX_WRITE_RECIPES=1 npx vitest run packages/host/tests/walkthrough-recipes.test.ts
  ```

  The normal test run fails while the file is out of date.
* **Recordings.** Each clip's cursor path, clicks, scrolls and typing is a list
  in `scripts/promo-capture.mjs`:

  ```
  npm run build && node scripts/preview.mjs --all --width 380
  node scripts/promo-capture.mjs --clip wt-layouts,wt-motion   # --dry checks targets first
  ```

  If you move a click, update its time in `WT_CLIP_CLICKS` and in the `sync`
  beats that use it.

## Script and chapters

| # | Chapter | Shows |
|---|---|---|
| — | The result first | The finished Kovo promo, full frame |
| — | By hand | What the promo costs without the panel, then an empty comp |
| — | KVFX Tools | The mark, the tab tour, 8 tabs · 100+ commands · 1 undo each |
| 1 | Start with a layout | Layouts gallery, five templates, Metric Cards built from the panel |
| 2 | Make it move | UI Stagger in four styles and orders, Card Carousel |
| 3 | Show how it's used | Cursor, Hover Lift, Input Bar |
| 4 | Type that talks | Animate (Blur Rise, in and out, by word), Kinetic Title, 9:16 title |
| 5 | Set the scene | Backdrop (drift, horizon, stars), Dot Pulse, Frosted Glass, Wipe Reveal, Code Glyphs |
| 6 | Polish | Curve editor, Elastic, Bounce, Follow Layer, Align as Group, Even Gaps |
| 7 | Ship it | Silence Remover, Comp Resizer, Missing Footage |
| 8 | Also inside | Duplicate Comp, Explode, Replace Fonts, Effects, Counter, 3D Carousel, Labels, Library, Media, search |
| — | Both versions | 16:9 and 9:16 side by side, then the call to action |
