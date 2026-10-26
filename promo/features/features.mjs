// KVFX Tools: the top ten Tools features, one short video each.
//
// One source of truth for every video: what the panel recording does
// (read by scripts/promo-capture.mjs) and what the edit shows and says at
// each moment (read by the studio page). Times are seconds into the panel
// recording; a click time named here is used by both, so the comp reacts on
// the frame the button is pressed.

/** A button by its exact text or label, a CSS target, a tab. */
const B = (button, dx = 0, dy = 0) => ({ button, dx, dy });
const S = (sel, dx = 0, dy = 0) => ({ sel, dx, dy });
/** The cursor resting on a target from t0 to t1. */
const stay = (t0, t1, target) => [[t0, target], [t1, target]];
/** Typing a string, one key event per character from t. */
const typed = (t, text, perSecond = 9) => [...text].map((c, i) => [t + i / perSecond, "type", c]);

const DIALOG_OK = S(".kvfx-dialog__actions button:last-child");
/** A transition preset's tile in Generate ▸ Transitions. */
const TILE = (id) => S(`.kvfx-trans-tiles [data-preset="${id}"]`);

// ---------------------------------------------------------------------------
// The panel recordings. Each starts on the Tools tab, scrolled to the top.
// ---------------------------------------------------------------------------

const RESIZE = { tap: 3.0, fit: 6.0, resize: 9.0, confirm: 10.4 };
const SILENCE = { analyse: 4.2, cut: 9.8, confirm: 11.1 };
const FOLLOW = { rotation: 4.7, scale: 5.7, delay: 6.9, follow: 9.2 };
const UNPRECOMP = { unprecomp: 3.2, precomp: 12.0 };
const DUPLICATE = { duplicate: 9.2 };
const SEQUENCE = { first: 4.4, orderCentre: 10.2, centre: 11.6, orderRandom: 16.4, random: 18.4 };
const ALIGN = { centreY: 3.0, distribute: 7.0, grp: 11.0, groupX: 13.6, groupY: 16.2 };
const GAPS = { even: 3.2, gapField: 8.9, fixed: 11.2 };
const ANCHOR = { topLeft: 3.0, bottomCentre: 10.2, centre: 16.4 };
const GRADIENT = { direction: 4.8, lock: 6.4 };
// The tour of the other tabs.
const TEXT = { pop: 4.6, words: 5.8, stagger: 6.8, animate: 8.4 };
const EASE = { grab1: 2.4, drop1: 3.4, grab2: 4.0, drop2: 5.0, apply: 6.6 };
const FX = { scan: 2.6, shadowOn: 5.0, glowOff: 7.2, allOff: 9.4, allOn: 11.4 };
const GEN = { metric: 2.6, build: 7.4 };
// Transitions: a preset and Add Transition on each of three cuts, then the edit plays.
const TRANS = { whip: 3.2, add1: 4.5, glitch: 6.6, add2: 8.0, bars: 10.6, add3: 11.9, play: 13.4 };

export const FEATURE_CLIPS = {
  "tf-resize": {
    tab: "tools",
    duration: 22,
    cursor: [
      [0, 300, 720],
      ...stay(2.2, 3.4, S('select[aria-label="Format"]')),
      ...stay(4.0, 5.0, S('.kvfx-anchors--pick button[aria-label="centre"]')),
      ...stay(5.6, 6.4, B("Fit")),
      ...stay(7.0, 8.0, B("Fill backgrounds")),
      ...stay(8.6, 9.6, B("Resize Comps", 20)),
      ...stay(10.0, 10.8, DIALOG_OK),
      [12.5, 250, 560], [22, 240, 600],
    ],
    events: [
      [0.6, "scroll", S('[data-section="tools.resize"]'), 0.9],
      [RESIZE.tap, "tap"], [RESIZE.tap + 0.2, "select", S('select[aria-label="Format"]'), "vertical"],
      [RESIZE.fit, "click"], [RESIZE.resize, "click"], [RESIZE.confirm, "click"],
    ],
  },
  "tf-silence": {
    tab: "tools",
    duration: 24,
    cursor: [
      [0, 300, 720],
      ...stay(2.2, 3.2, S('[data-section="tools.silence"] canvas')),
      ...stay(3.8, 4.6, B("Analyse")),
      ...stay(5.4, 7.0, S('[data-section="tools.silence"] canvas', 40)),
      ...stay(7.6, 8.6, S('input[aria-label="Padding"]')),
      ...stay(9.4, 10.2, B("Cut Pauses")),
      ...stay(10.7, 11.5, DIALOG_OK),
      [13.5, 250, 560], [24, 240, 600],
    ],
    events: [
      [0.6, "scroll", S('[data-section="tools.silence"]'), 0.9],
      [SILENCE.analyse, "click"], [SILENCE.cut, "click"], [SILENCE.confirm, "click"],
    ],
  },
  "tf-follow": {
    tab: "tools",
    duration: 24,
    cursor: [
      [0, 300, 720],
      ...stay(2.4, 3.6, B("Top leads")),
      ...stay(4.4, 5.0, B("Rotation")),
      ...stay(5.4, 6.0, B("Scale")),
      ...stay(6.6, 7.8, S('[data-section="tools.follow"] input[aria-label="Delay"]')),
      ...stay(8.6, 9.6, B("Follow", 30)),
      [12, 250, 640], [24, 240, 660],
    ],
    events: [
      [0.6, "scroll", S('[data-section="tools.follow"]'), 0.9],
      [FOLLOW.rotation, "click"], [FOLLOW.scale, "click"],
      [FOLLOW.delay, "click"], [FOLLOW.delay + 0.1, "key", "Control+A"], ...typed(FOLLOW.delay + 0.3, "3"),
      [FOLLOW.follow, "click"],
    ],
  },
  "tf-unprecomp": {
    tab: "tools",
    duration: 22,
    cursor: [
      [0, 300, 720],
      ...stay(2.2, 3.6, B("Unprecomp")),
      [5.5, 250, 420], [9.5, 240, 400],
      ...stay(11.2, 12.4, B("Precomp")),
      [14.5, 250, 420], [22, 240, 430],
    ],
    events: [[UNPRECOMP.unprecomp, "click"], [UNPRECOMP.precomp, "click"]],
  },
  "tf-duplicate": {
    tab: "tools",
    duration: 22,
    cursor: [
      [0, 300, 720],
      ...stay(2.4, 7.4, S('[data-section="tools.duplicate"] .kvfx-target', 60)),
      ...stay(8.4, 9.6, B("Duplicate Comp + Nested Comps")),
      [12, 250, 480], [22, 240, 500],
    ],
    events: [[DUPLICATE.duplicate, "click"]],
  },
  "tf-sequence": {
    tab: "tools",
    duration: 24,
    cursor: [
      [0, 300, 720],
      ...stay(2.2, 3.2, S('[data-section="tools.sequence"] input[aria-label="Step"]')),
      ...stay(3.8, 4.8, B("Sequence Layers", 30)),
      [6.5, 250, 560],
      ...stay(9.6, 10.6, S('[data-section="tools.sequence"] select[aria-label="Order"]')),
      ...stay(11.1, 12.0, B("Sequence Layers", 30)),
      [13.5, 250, 560],
      ...stay(15.8, 16.8, S('[data-section="tools.sequence"] select[aria-label="Order"]')),
      ...stay(17.8, 18.8, B("Sequence Layers", 30)),
      [20.5, 250, 560], [24, 240, 580],
    ],
    events: [
      [0.6, "scroll", S('[data-section="tools.sequence"]'), 0.9],
      [SEQUENCE.first, "click"],
      [SEQUENCE.orderCentre, "tap"], [SEQUENCE.orderCentre + 0.2, "select", S('[data-section="tools.sequence"] select[aria-label="Order"]'), "centre"],
      [SEQUENCE.centre, "click"],
      [SEQUENCE.orderRandom, "tap"], [SEQUENCE.orderRandom + 0.2, "select", S('[data-section="tools.sequence"] select[aria-label="Order"]'), "random"],
      [SEQUENCE.random, "click"],
    ],
  },
  "tf-align": {
    tab: "tools",
    duration: 22,
    // The reference starts on Auto; Sel is two clicks along, made before
    // recording, so the one click the viewer sees lands on Grp.
    setup: [["click", ".kvfx-cycle"], ["click", ".kvfx-cycle"]],
    cursor: [
      [0, 300, 620],
      ...stay(2.2, 3.4, B("Align vertical centre")),
      [4.8, 230, 640],
      ...stay(6.2, 7.4, B("Distribute horizontally")),
      [8.8, 260, 640],
      ...stay(10.4, 11.4, S(".kvfx-cycle")),
      ...stay(13.0, 14.0, B("Align horizontal centre")),
      ...stay(15.6, 16.6, B("Align vertical centre")),
      [18.5, 240, 660], [22, 230, 670],
    ],
    events: [
      [ALIGN.centreY, "click"], [ALIGN.distribute, "click"], [ALIGN.grp, "click"],
      [ALIGN.groupX, "click"], [ALIGN.groupY, "click"],
    ],
  },
  "tf-gaps": {
    tab: "tools",
    duration: 20,
    cursor: [
      [0, 300, 720],
      ...stay(2.4, 3.6, B("Even gaps horizontally")),
      [5.5, 250, 560],
      ...stay(8.4, 9.8, S('[data-section="tools.arrange"] input[aria-label="Gap"]')),
      ...stay(10.6, 11.6, B("Even gaps horizontally")),
      [13.5, 250, 560], [20, 240, 580],
    ],
    events: [
      [0.6, "scroll", S('[data-section="tools.arrange"]'), 0.9],
      [GAPS.even, "click"],
      [GAPS.gapField, "click"], [GAPS.gapField + 0.1, "key", "Control+A"], ...typed(GAPS.gapField + 0.25, "40"),
      [GAPS.fixed, "click"],
    ],
  },
  "tf-anchor": {
    tab: "tools",
    duration: 22,
    cursor: [
      [0, 300, 600],
      ...stay(2.2, 3.4, B("Anchor top left")),
      [5.5, 150, 240], [8.5, 140, 230],
      ...stay(9.6, 10.6, B("Anchor bottom centre")),
      [12.5, 150, 240], [15, 140, 230],
      ...stay(15.8, 16.8, B("Anchor centre")),
      [19, 160, 250], [22, 150, 260],
    ],
    events: [[ANCHOR.topLeft, "click"], [ANCHOR.bottomCentre, "click"], [ANCHOR.centre, "click"]],
  },
  "tf-gradient": {
    tab: "tools",
    duration: 20,
    cursor: [
      [0, 300, 720],
      ...stay(2.2, 2.9, S('[data-section="tools.colour"] input[aria-label="From"]')),
      ...stay(3.2, 3.9, S('[data-section="tools.colour"] input[aria-label="To"]')),
      ...stay(4.4, 5.2, S('[data-section="tools.colour"] button[title="Left to right"]')),
      ...stay(5.8, 6.8, B("Gradient Lock")),
      [9, 250, 520], [20, 240, 540],
    ],
    events: [
      [0.6, "scroll", S('[data-section="tools.colour"]'), 0.9],
      [GRADIENT.direction, "click"], [GRADIENT.lock, "click"],
    ],
  },

  // The tour: one short take on each of the other tabs.
  "tf-text": {
    tab: "text",
    duration: 14,
    cursor: [
      [0, 300, 720],
      ...stay(2.0, 2.6, B("Rise")),
      ...stay(2.8, 3.4, B("Blur In")),
      ...stay(3.6, 4.2, B("Bounce Drop")),
      ...stay(4.4, 5.0, B("Pop")),
      ...stay(5.5, 6.1, B("Words")),
      ...stay(6.5, 7.6, S('[data-section="text.animate"] input[aria-label="Stagger"]')),
      ...stay(8.0, 8.9, B("Animate Text", 30)),
      [11, 250, 600], [14, 240, 620],
    ],
    events: [
      [0.6, "scroll", S('[data-section="text.animate"]'), 0.9],
      [TEXT.pop, "click"], [TEXT.words, "click"],
      [TEXT.stagger, "click"], [TEXT.stagger + 0.1, "key", "Control+A"], ...typed(TEXT.stagger + 0.3, "6"),
      [TEXT.animate, "click"],
    ],
  },
  "tf-ease": {
    tab: "ease",
    duration: 13,
    cursor: [
      [0, 320, 640],
      [2.0, 163, 432], [EASE.grab1, 163, 432], [EASE.drop1, 239, 432], [3.6, 239, 432],
      [3.9, 217, 271], [EASE.grab2, 217, 271], [EASE.drop2, 141, 271], [5.4, 141, 271],
      ...stay(6.1, 7.1, B("Apply to Keys", 30)),
      [9.5, 250, 660], [13, 240, 680],
    ],
    events: [[EASE.grab1, "down"], [EASE.drop1, "up"], [EASE.grab2, "down"], [EASE.drop2, "up"], [EASE.apply, "click"]],
  },
  "tf-fx": {
    tab: "fx",
    duration: 14,
    cursor: [
      [0, 300, 700],
      ...stay(1.2, 1.7, B("Glow")),
      ...stay(2.1, 3.0, B("Scan Selected Layers")),
      ...stay(4.4, 5.4, S('input[aria-label="Drop Shadow on"]')),
      ...stay(6.6, 7.6, S('input[aria-label="Glow on"]')),
      ...stay(8.8, 9.8, B("All off")),
      ...stay(10.8, 11.8, B("All on")),
      [14, 250, 640],
    ],
    events: [[FX.scan, "click"], [FX.shadowOn, "click"], [FX.glowOff, "click"], [FX.allOff, "click"], [FX.allOn, "click"]],
  },
  "tf-generate": {
    tab: "generate",
    duration: 13,
    cursor: [
      [0, 300, 700],
      ...stay(2.0, 3.0, B("Metric Cards")),
      ...stay(3.6, 5.2, S('input[aria-label="Values"]', 60)),
      ...stay(6.6, 7.8, B("Build Layout", 40)),
      [10, 250, 600], [13, 240, 620],
    ],
    events: [[GEN.metric, "click"], [5.6, "scroll", B("Build Layout"), 0.6], [GEN.build, "click"]],
  },
  "tf-transitions": {
    tab: "generate",
    duration: 22,
    cursor: [
      [0, 300, 720],
      ...stay(1.5, 1.9, TILE("spin")),
      ...stay(2.1, 2.6, TILE("zoomIn")),
      ...stay(2.8, 3.5, TILE("whipLeft")),
      ...stay(4.0, 4.9, B("Add Transition", 30)),
      ...stay(5.8, 6.2, TILE("signal")),
      ...stay(6.4, 6.9, TILE("glitch")),
      ...stay(7.5, 8.4, B("Add Transition", 30)),
      ...stay(9.6, 10.0, TILE("circle")),
      ...stay(10.2, 10.9, TILE("bars")),
      ...stay(11.4, 12.3, B("Add Transition", 30)),
      [14, 250, 640], [22, 240, 660],
    ],
    events: [
      [0.5, "scroll", S('[data-section="gen.transitions"]'), 0.8],
      [TRANS.whip, "click"], [TRANS.add1, "click"],
      [5.1, "scroll", TILE("glitch"), 0.7, ".kvfx-trans-tiles"],
      [TRANS.glitch, "click"], [TRANS.add2, "click"],
      [8.8, "scroll", TILE("bars"), 0.7, ".kvfx-trans-tiles"],
      [TRANS.bars, "click"], [TRANS.add3, "click"],
    ],
  },
};

// ---------------------------------------------------------------------------
// The videos, in series order. Captions are [time, text], times in the
// recording; `times` are the clicks the scene reacts to.
// ---------------------------------------------------------------------------

export const FEATURES = [
  {
    id: "resize",
    title: "Comp Resizer",
    promise: "Turn a 16:9 edit into a vertical one in a single click.",
    where: "Tools ▸ Comp Resizer",
    clip: "tf-resize",
    times: RESIZE,
    captions: [
      [0, "A 16:9 promo. Now you need it vertical."],
      [2.2, "Pick a format: 9:16, 1:1, 4:5 or your own size."],
      [5.6, "Fit scales the content evenly, so it all stays in frame."],
      [7.0, "Fill backgrounds makes them cover the new frame."],
      [8.6, "Resize Comps asks first, because it changes your comps."],
      [10.6, "The content stays pinned to the centre."],
      [14.0, "The background grows to fill the frame. No empty bands."],
      [18.0, "Comps that use it are fixed, so nothing jumps."],
    ],
  },
  {
    id: "silence",
    title: "Silence Remover",
    promise: "Cut the pauses out of a voiceover, with the picture kept in sync.",
    where: "Tools ▸ Silence Remover",
    clip: "tf-silence",
    times: SILENCE,
    captions: [
      [0, "A voiceover full of pauses, with footage cut to it."],
      [2.2, "Select the voice, plus the layers to cut with it."],
      [4.2, "Analyse finds every pause."],
      [7.6, "Padding leaves a little air, so no word sounds clipped."],
      [9.4, "Cut Pauses asks before it changes anything."],
      [11.3, "The pauses are cut and the gaps close up."],
      [15.0, "Every selected layer is cut in sync. Nothing is deleted."],
      [19.0, "24 seconds of voiceover, now 20.1."],
    ],
  },
  {
    id: "follow",
    title: "Follow Layer",
    promise: "Make layers follow another layer, without parenting them.",
    where: "Tools ▸ Follow Layer",
    clip: "tf-follow",
    times: FOLLOW,
    captions: [
      [0, "The card is animated. The tag and its shadow are not."],
      [2.4, "Select all three. The top layer leads."],
      [4.4, "Choose what follows: rotation, scale…"],
      [6.6, "…and a delay, in frames."],
      [9.2, "Follow. Now they move with the card, 3 frames behind."],
      [14.0, "No parenting, so each layer keeps its own animation."],
      [18.0, "Change the delay later on each follower."],
    ],
  },
  {
    id: "unprecomp",
    title: "Unprecompose",
    promise: "The undo for precomposing: get a precomp's layers back.",
    where: "Tools ▸ Layer",
    clip: "tf-unprecomp",
    times: UNPRECOMP,
    captions: [
      [0, "A precomp. You need its layers back in this comp."],
      [2.2, "Select it and click Unprecomp."],
      [3.4, "The layers come back in order, timed as they were."],
      [6.5, "The precomp layer is switched off, not deleted."],
      [9.6, "Going the other way? Select layers and click Precomp."],
      [12.2, "Each selected layer gets a precomp of its own."],
      [16.0, "Effects and keyframes go with them."],
    ],
  },
  {
    id: "duplicate",
    title: "Duplicate Comp + Nested",
    promise: "Copies of a comp that never change the original.",
    where: "Tools ▸ Duplicate Comp",
    clip: "tf-duplicate",
    times: DUPLICATE,
    captions: [
      [0, "A plain duplicate shares the comps nested inside."],
      [3.0, "Edit the copy, and the original changes too."],
      [6.4, "Duplicate Comp + Nested Comps copies everything inside."],
      [9.4, "Every nested comp gets its own copy."],
      [12.6, "Edit the copy. The original stays as it was."],
      [16.6, "Footage stays shared: only comps are copied."],
    ],
  },
  {
    id: "sequence",
    title: "Sequence Layers",
    promise: "Stagger layers in time, in any order, in one click.",
    where: "Tools ▸ Sequence",
    clip: "tf-sequence",
    times: SEQUENCE,
    captions: [
      [0, "Seven layers, all starting at once."],
      [2.2, "Set the step in frames."],
      [4.4, "Sequence Layers: each starts 5 frames after the last."],
      [9.6, "Pick an order: centre → out."],
      [11.6, "The middle starts first, spreading outwards."],
      [15.8, "Or random, for a looser feel."],
      [20.5, "Trims and keyframes move with each layer."],
    ],
  },
  {
    id: "align",
    title: "Align as Group",
    promise: "Line layers up, then move the whole set as one block.",
    where: "Align bar",
    clip: "tf-align",
    times: ALIGN,
    captions: [
      [0, "Four layers, placed by hand."],
      [2.2, "Align vertical centre: they line up."],
      [6.2, "Distribute: the same space between their centres."],
      [10.4, "Switch the align bar to Grp."],
      [13.0, "Now the row moves as one block to the comp's centre."],
      [17.0, "The spacing stays exactly as it was, keyframes and all."],
    ],
  },
  {
    id: "gaps",
    title: "Even Gaps",
    promise: "Equal space between edges, or exactly the gap you type.",
    where: "Tools ▸ Arrange",
    clip: "tf-gaps",
    times: GAPS,
    captions: [
      [0, "Different widths, uneven gaps."],
      [2.4, "Even gaps: the same space between every edge."],
      [6.0, "The two outer layers stay where they are."],
      [8.4, "Or type a gap: 40 px."],
      [11.4, "Now they sit exactly 40 px apart."],
      [15.0, "Animated layers move with their keyframes."],
    ],
  },
  {
    id: "anchor",
    title: "Anchor Point Grid",
    promise: "Move the anchor point anywhere. The layer stays put.",
    where: "Top of the panel",
    clip: "tf-anchor",
    times: ANCHOR,
    captions: [
      [0, "The anchor point sits in the middle."],
      [2.2, "Click a corner on the anchor grid."],
      [3.2, "The anchor jumps there. The layer doesn't move."],
      [5.2, "Now it rotates from that corner."],
      [9.6, "Bottom centre…"],
      [10.8, "…and it grows up from the floor."],
      [15.8, "Back to the centre: it spins in place."],
    ],
  },
  {
    id: "gradient",
    title: "Gradient Lock",
    promise: "A gradient that stays pinned to the layer's edges.",
    where: "Tools ▸ Colour",
    clip: "tf-gradient",
    times: GRADIENT,
    captions: [
      [0, "A bar that grows. Its gradient should grow with it."],
      [2.2, "Pick two colours and a direction."],
      [5.8, "Gradient Lock pins the gradient's ends to the edges."],
      [9.4, "As the bar grows, the gradient grows with it."],
      [13.6, "A plain Gradient Ramp stays where it was put."],
    ],
  },
];

// Videos of the other tabs, for the website's tour (not part of the ten).
export const TOUR = [
  {
    id: "text",
    badge: "TEXT",
    title: "Text Animate",
    promise: "Animate any text by letter, word or line, from 41 presets.",
    where: "Text ▸ Animate",
    clip: "tf-text",
    times: TEXT,
    captions: [
      [0, "Live text, standing still."],
      [2.0, "Hover a preset and the preview plays it."],
      [4.4, "Pop, word by word…"],
      [6.5, "…six frames apart."],
      [8.4, "Animate Text. It stays live text."],
    ],
  },
  {
    id: "ease",
    badge: "EASE",
    title: "Curve Editor",
    promise: "Draw an ease, then apply it to your keyframes.",
    where: "Ease ▸ Curve",
    clip: "tf-ease",
    times: EASE,
    captions: [
      [0, "Linear keys: the same speed all the way."],
      [2.0, "Drag the handles to shape the ease."],
      [6.1, "Apply to Keys sets the speed and influence of each key."],
      [8.0, "Now it eases in and out."],
    ],
  },
  {
    id: "fx",
    badge: "FX",
    title: "Effects Manager",
    promise: "Every effect on the selected layers, in one list.",
    where: "FX ▸ Effects Manager",
    clip: "tf-fx",
    times: FX,
    captions: [
      [0, "A title with a glow and a gradient."],
      [2.1, "Scan lists every effect on the selection."],
      [4.4, "Switch the drop shadow on…"],
      [6.6, "…and the glow off."],
      [8.8, "Or all of them at once."],
    ],
  },
  {
    id: "generate",
    badge: "GEN",
    title: "Layouts",
    promise: "Interface scenes built from your own words and numbers.",
    where: "Generate ▸ Layouts",
    clip: "tf-generate",
    times: GEN,
    captions: [
      [0, "An empty comp."],
      [2.0, "Pick Metric Cards and type your numbers."],
      [6.6, "Build Layout."],
      [7.8, "Ordinary layers on one null, and they animate in."],
    ],
  },
  {
    id: "transitions",
    badge: "GEN",
    title: "Transitions",
    promise: "Seamless transitions across any cut, from 27 presets.",
    where: "Generate ▸ Transitions",
    clip: "tf-transitions",
    times: TRANS,
    captions: [
      [0, "Three cuts. Every one of them hard."],
      [1.4, "Hover a preset and the panel plays it."],
      [2.8, "Whip Left, then Add Transition."],
      [4.6, "It lands on the cut, as one layer you trim to retime."],
      [5.8, "A glitch on the next cut, different every time."],
      [9.6, "Bars on the last one, in your colour."],
      [13.4, "Twenty-seven presets, built from After Effects' own effects."],
    ],
  },
];
