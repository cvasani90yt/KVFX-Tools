# KVFX Tools: promo kit

This folder builds a vertical promo for KVFX Tools (Reels, TikTok and Shorts),
plus a 16:9 version for YouTube, as a normal After Effects project. Every
scene, camera move, text animation and feature callout is created by one
script, and all of it stays editable.

| File | What it is |
|---|---|
| `KVFX-Promo-Builder.jsx` | Builds the whole project. Run it in After Effects. |
| `assets/ui/*.png` | Screenshots of the real panel at 2× (760 × 1720), one per tab, plus the search palette. |
| `assets/anime/` | Key art for the anime section, included (see [Assets](#assets)). |
| `assets/music.mp3` | Optional. If present it is placed under the edit. `.wav`, `.m4a` and `.aac` work too. |

## Build it

1. The anime stills are already in `assets/anime/`. To use your own, keep the
   same names (`.png` or `.jpg`). A missing file becomes a purple placeholder
   named `MISSING anime/…` that you can swap later with
   **File ▸ Replace Footage**.
2. Install the fonts. All three are free on Google Fonts: **Unbounded**,
   **Inter** and **JetBrains Mono**. Without them the script falls back to
   Arial and Courier and says so.
3. In After Effects, **File ▸ Scripts ▸ Run Script File…** and pick
   `KVFX-Promo-Builder.jsx`. Keep the `assets` folder next to the script.
4. The project gets a new **KVFX Promo** folder and `KVFX Promo · MAIN 9x16`
   opens. A message lists anything that was missing or fell back.

The script only **adds** things. Nothing that is already in the project
changes, and **Edit ▸ Undo** removes the whole build in one step.

## What's in the edit (45.5 s)

`SCENES` at the top of the script sets every scene's length. The
`Scenes (guide)` layer in MAIN has a marker at each cut, and the
`Beat grid 120 BPM (guide)` layer has a marker on every beat, labelled per bar.
Neither one renders.

| Time | Scene | What happens | Feature on screen |
|---|---|---|---|
| 0–3 s | **Hook** | "POV: you found the AFTER EFFECTS CHEAT CODE" slams in word by word with camera shake. A sticker says "(not a preset pack)". | — |
| 3–5.5 s | **Brand sting** | The KVFX mark spins in, a ring draws on, the wordmark tracks in, and the line "after effects, but make it fast." appears. | 8 tabs · 100+ commands · 1 shortcut |
| 5.5–18.5 s | **01 Anime edits** | Rooftop push-in with rain and the hero dropping on the beat. Eye close-up with zoom punch and a chromatic glitch. 2.5D parallax orbit. Impact slam with overshoot. Lyric builds letter by letter and then explodes. 3D carousel of the stills. | Split · Add Wiggle · Curve editor · Add Elastic · Explode · 3D Carousel · Sequence |
| 18.5–29.5 s | **02 SaaS promos** | A neo-brutalist dashboard tilts in on a 3D camera. Counters run, rows stagger in, cards snap into alignment, bars grow from their base, a cursor clicks Upgrade, a headline types on under a fitted gradient, and the dashboard splits into three versions. | Number Counter · Sequence · Align + Distribute · Anchor Grid · Gradient Lock · Duplicate Comp + Nested |
| 29.5–37.5 s | **03 Everyday mograph** | A 2×2 grid: kinetic type, a lower third, a 3D extruded logo and label swatches. Then the Media and Library tabs in 3D, with a file dropped into the panel. | Animate presets · One-click FX · 3D Extrude · Labels · Paste + Drop · Library |
| 37.5–42 s | **Feature wall** | Command tickers, "8 TABS. 100+ COMMANDS. 1 SHORTCUT.", Ctrl + Space keycaps, every tab fanned out in 3D, and the search palette. | Search palette · One undo per action |
| 42–45.5 s | **CTA** | Amber end card with the logo, KVFX TOOLS, and a pulsing LINK IN BIO pill, then "save this for your next edit" and "follow for more AE tricks". | — |

Every callout chip names a real command and the tab it lives in, so a viewer
can find it in the panel.

### How it's built

* **Cameras.** Every 3D shot has its own **Rig** null carrying a one-node
  camera. Animate the null to move the camera. Its **Shake Amount** and
  **Shake Speed** sliders drive a wiggle on the camera, and the impact hits are
  just keyframes on Shake Amount.
* **Text.** Letter-by-letter reveals use an expression selector (`KV In`
  animator), and the lyric explosion uses a second one (`KV Scatter`). Change
  `t0` in the expression to retime one.
* **Feature demos use the panel's own rigs:** the carousel (Radius and Spin
  sliders on the hub), the elastic overshoot, the counter (**KVFX Counter**
  slider) and the gradient lock (Gradient Ramp ends that follow
  `sourceRectAtTime`).
* **MAIN** adds the whip blur and flash on every cut, light grain, and a
  **Reels safe area** guide. Keep text inside the pink box so the app's
  buttons and caption don't cover it.
* **YouTube 16x9** puts the vertical edit in the centre over a blurred copy of
  itself.

## Assets

| File | Content |
|---|---|
| `anime/city.jpg` | Empty rooftop at night over a neon city in the rain. Amber signs, teal shadows, no people, no text. |
| `anime/hero.jpg` | Original character, three-quarter close-up: ash-grey undercut, eyebrow scar, amber eyes, techwear, orange rim light. Used as a carousel card. |
| `anime/hero-cutout.png` | The same character on a transparent background, for the parallax shots. |
| `anime/leap.jpg` | Original character mid-leap, swinging a glowing orange blade. |
| `anime/leap-cutout.png` | The same frame on a transparent background, with the blade, its arc and the sparks kept in the matte. |
| `anime/eye.jpg` | Extreme close-up of an amber eye reflecting neon. |

All six are 1125 × 2000. The script sizes the characters by on-screen height,
so a higher-resolution version with the same name drops straight in and comes
out sharper on the camera push-ins. If only one version of a character exists,
the script uses it in both places. Use original characters only. Clips or
stills from existing anime need a licence before they go into a paid ad.

Screenshots in `assets/ui/` come from the built panel. Regenerate them after a
UI change:

```
npm run build
node scripts/preview.mjs --all --width 380
```

Then capture each `build/preview/work/panel-<tab>.html` at 380 × 860 with a
device scale factor of 2.

## Music and sound

* **Reels and TikTok:** export **without** music and add a trending sound in
  the app. In-app sounds are licensed for that platform, and trending audio
  gets reach. Keep a quiet bed under the edit only while you're working.
* **YouTube:** use a track you're licensed for: the YouTube Audio Library
  (free), Pixabay Music (free), or Epidemic Sound or Artlist (paid, safe for
  monetised channels). Phonk, hyperpop and drill beats at 120–150 BPM fit
  this cut.
* **SFX** sell the motion: a whoosh on each whip, an impact on each slam and
  shake hit, a soft click for each chip, and a riser into the CTA. Free SFX are
  on Pixabay and Mixkit.
* **Retiming:** set `CFG.bpm` and the `SCENES` durations, then run the script
  again. Or slide keys to the beat markers by hand.

## Export

| Target | Comp | Settings |
|---|---|---|
| Reels / TikTok / Shorts | `MAIN 9x16` | 1080 × 1920, 30 fps, H.264 High, VBR 2-pass, target 16 Mbps / max 24, AAC 320 kbps |
| YouTube | `YouTube 16x9` | 1920 × 1080, 30 fps, H.264 High, VBR 2-pass, target 20 Mbps, AAC 320 kbps |

Use **Composition ▸ Add to Adobe Media Encoder Queue**, or render H.264
directly from the Render Queue in After Effects 2023 and later. Motion blur is
on in every comp. If previews feel slow, switch it off in MAIN with the comp's
motion blur button. The render is unaffected.

## Hooks, captions and posting

The first second decides the scroll. Swap the hook text in `buildHook` to A/B
test:

* "POV: you found the After Effects cheat code" (built in)
* "editors are gatekeeping this panel"
* "stop doing this by hand in After Effects"
* "your timeline after installing this"

Caption ideas: *"100+ one-click After Effects commands in one panel. Which
one are you using first? 🔖 save this for your next edit"*

Hashtags: `#aftereffects #motiongraphics #amv #animeedit #motiondesign
#aetips #editingtips #saas #mograph`

Post the anime section as its own cut too (`Scene · 03 Anime Edits`, 13 s).
The AMV crowd shares edits, not tool ads.

## Customising

Everything you'd change is at the top of the script:

* `CFG`: size, frame rate, BPM, camera zoom, grain, and whether to build the
  16:9 version.
* `C`: the palette. It uses the panel's amber `#FF8F3F` with ink, cream and a
  teal accent.
* `FONT_CHOICES`: the PostScript names to try, in order.
* `SCENES`: the order and length of the scenes.

Each scene is one `build…` function, and every callout is a single `chip(…)`
call, so a line is all it takes to add, remove or reword one.
