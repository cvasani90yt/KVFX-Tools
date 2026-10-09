import type { Bezier } from "../animation/easing.js";
import { easeExpression } from "../text/motion.js";
import type { TextEase } from "../text/motion.js";

/**
 * Expressions for the UI Motion rigs: staggered reveals, the cursor, the
 * card carousel and animated backdrops.
 *
 * Same rules as every generated expression: both engines, no array
 * arithmetic, controls found through `effect(…)` on the layer itself or its
 * parent — never through another layer's name.
 */

/* eslint-disable no-magic-numbers -- motion constants are the content */

const TAG = "// KVFX Tools";

function n(value: number): string {
  return String(Math.round(value * 1e4) / 1e4);
}

// ---------------------------------------------------------------------------
// UI Stagger
// ---------------------------------------------------------------------------

export const REVEAL_EFFECT = "KVFX Reveal";
export const REVEAL_BLUR_EFFECT = "KVFX Reveal Blur";

export type RevealStyle = "rise" | "drop" | "slideLeft" | "slideRight" | "pop" | "scale" | "blur" | "bounce" | "fade";

export const REVEAL_STYLES: readonly { readonly id: RevealStyle; readonly label: string; readonly ease: Exclude<TextEase, "preset" | "curve"> }[] = [
  { id: "rise", label: "Rise", ease: "expo" },
  { id: "drop", label: "Drop", ease: "expo" },
  { id: "slideLeft", label: "Slide →", ease: "expo" },
  { id: "slideRight", label: "Slide ←", ease: "expo" },
  { id: "pop", label: "Pop", ease: "back" },
  { id: "scale", label: "Scale", ease: "soft" },
  { id: "blur", label: "Blur", ease: "soft" },
  { id: "bounce", label: "Bounce", ease: "bounce" },
  { id: "fade", label: "Fade", ease: "smooth" },
];

export function parseRevealStyle(value: unknown): RevealStyle {
  return REVEAL_STYLES.some((s) => s.id === value) ? (value as RevealStyle) : "rise";
}

/** Shared head: progress from the reveal slider, eased. */
function revealHead(ease: Exclude<TextEase, "preset">, overshoot: number, bezier: Bezier): string {
  return [
    `${TAG} — reveal`,
    easeExpression(ease, overshoot, bezier),
    `var p = effect("${REVEAL_EFFECT}")(1) / 100;`,
    "var e = kvEase(p);",
  ].join("\n");
}

export interface RevealExpressions {
  readonly position?: string;
  readonly scale?: string;
  readonly opacity: string;
  readonly blur?: string;
}

/**
 * The reveal, as expressions over the layer's own values: the layer keeps its
 * position, scale and any animation it already had, and the slider's two
 * keys are the only timing to retime.
 */
export function revealExpressions(
  style: RevealStyle,
  distance: number,
  ease: Exclude<TextEase, "preset">,
  overshoot: number,
  bezier: Bezier,
): RevealExpressions {
  const head = revealHead(ease, overshoot, bezier);
  const opacity = [head, "value * Math.max(0, Math.min(1, p * 1.6));"].join("\n");
  const offset = (dx: string, dy: string): string =>
    [head, `var out = []; for (var i = 0; i < value.length; i++) out[i] = value[i];`, `out[0] += ${dx};`, `out[1] += ${dy};`, "out;"].join("\n");
  const scaleFrom = (from: number): string =>
    [head, `var k = (${n(from)} + (100 - ${n(from)}) * e) / 100;`, "var out = []; for (var i = 0; i < value.length; i++) out[i] = value[i] * k;", "out;"].join("\n");
  const d = n(Math.abs(distance));

  switch (style) {
    case "drop":
      return { position: offset("0", `-${d} * (1 - e)`), opacity };
    case "slideLeft":
      return { position: offset(`-${d} * (1 - e)`, "0"), opacity };
    case "slideRight":
      return { position: offset(`${d} * (1 - e)`, "0"), opacity };
    case "pop":
      return { scale: scaleFrom(0), opacity };
    case "scale":
      return { scale: scaleFrom(85), opacity };
    case "blur":
      return {
        position: offset("0", `${n(Math.abs(distance) * 0.3)} * (1 - e)`),
        opacity,
        blur: [head, "40 * (1 - Math.min(1, e));"].join("\n"),
      };
    case "bounce":
      return {
        position: offset("0", `${d} * (1 - e)`),
        // A squash on each landing: wide and short while the bounce eases out.
        scale: [
          head,
          "var land = Math.max(0, 1 - Math.abs(e - 1) * 12) * (1 - p);",
          "var out = []; for (var i = 0; i < value.length; i++) out[i] = value[i];",
          "out[0] *= 1 + 0.18 * land; out[1] *= 1 - 0.18 * land;",
          "out;",
        ].join("\n"),
        opacity,
      };
    case "fade":
      return { opacity: [head, "value * Math.max(0, Math.min(1, e));"].join("\n") };
    default:
      return { position: offset("0", `${d} * (1 - e)`), opacity };
  }
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export type CursorStyle = "arrow" | "pointer" | "touch";

/** Cursor artwork, tip at the origin, drawn for a 30 px tall cursor. */
export const CURSOR_PATHS: Readonly<Record<Exclude<CursorStyle, "touch">, readonly (readonly [number, number])[]>> = {
  arrow: [
    [0, 0],
    [0, 26],
    [6.4, 20.4],
    [10.6, 30],
    [15.2, 28],
    [11, 18.6],
    [19.2, 18.6],
  ],
  pointer: [
    [0, 0],
    [2.6, 1.6],
    [2.6, 11],
    [5.6, 10.2],
    [8.2, 11],
    [10.8, 10.4],
    [13.4, 11.8],
    [14.8, 14.2],
    [14.8, 21],
    [12.4, 27.6],
    [-0.8, 27.6],
    [-6.2, 20.4],
    [-8.8, 15.4],
    [-8.2, 13.2],
    [-6, 13.2],
    [-2.6, 16.4],
    [-2.6, 1.6],
  ],
};

/** Bends each travel between two keys into an arc, sideways by `arc` × its length. */
export function cursorArcExpression(arc: number): string {
  return [
    `${TAG} — cursor path`,
    `var arc = ${n(arc)};`,
    "var out = value;",
    "if (numKeys > 1 && arc !== 0) {",
    "  var k = nearestKey(time).index;",
    "  if (key(k).time > time) k--;",
    "  if (k >= 1 && k < numKeys) {",
    "    var a = key(k).value, b = key(k + 1).value;",
    "    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);",
    "    if (len > 1) {",
    "      var u = (time - key(k).time) / (key(k + 1).time - key(k).time);",
    "      var s = Math.sin(Math.PI * u) * arc * len;",
    "      out = []; for (var i = 0; i < value.length; i++) out[i] = value[i];",
    "      out[0] -= dy / len * s; out[1] += dx / len * s;",
    "    }",
    "  }",
    "}",
    "out;",
  ].join("\n");
}

/** Leans into horizontal movement, up to `tilt` degrees. */
export function cursorTiltExpression(tilt: number): string {
  return [
    `${TAG} — cursor tilt`,
    `var tilt = ${n(tilt)};`,
    "var v = transform.position.velocity[0];",
    "value + Math.max(-tilt, Math.min(tilt, v * 0.012));",
  ].join("\n");
}

/** Grows slightly while moving — the cursor "lifts" off the screen. */
export function cursorLiftExpression(lift: number): string {
  return [
    `${TAG} — cursor lift`,
    `var lift = ${n(lift / 100)};`,
    "var v = transform.position.velocity, speed = Math.sqrt(v[0] * v[0] + v[1] * v[1]);",
    "var k = 1 + lift * Math.min(1, speed / 1500);",
    "var out = []; for (var i = 0; i < value.length; i++) out[i] = i < 2 ? value[i] * k : value[i];",
    "out;",
  ].join("\n");
}

function clickList(clicks: readonly number[]): string {
  return `[${clicks.map((c) => n(c)).join(", ")}]`;
}

/** The time of the latest click before now, relative to the attach time. */
function lastClick(clicks: readonly number[]): string[] {
  return [
    "var t0 = __KVFX_NOW__;",
    `var clicks = ${clickList(clicks)};`,
    "var c = -1;",
    "for (var i = 0; i < clicks.length; i++) if (time >= t0 + clicks[i]) c = t0 + clicks[i];",
  ];
}

export const RIPPLE_SECONDS = 0.45;

export function rippleScaleExpression(clicks: readonly number[], size: number): string {
  return [
    `${TAG} — click ripple`,
    ...lastClick(clicks),
    `var u = c < 0 ? 1 : Math.min(1, (time - c) / ${n(RIPPLE_SECONDS)});`,
    `var s = ${n(size)} * (1 - Math.pow(1 - u, 3));`,
    "[s, s];",
  ].join("\n");
}

export function rippleOpacityExpression(clicks: readonly number[]): string {
  return [
    `${TAG} — click ripple`,
    ...lastClick(clicks),
    `c < 0 ? 0 : 100 * Math.max(0, 1 - (time - c) / ${n(RIPPLE_SECONDS)});`,
  ].join("\n");
}

/** The clicked layer dips when the cursor presses it. */
export function buttonPressExpression(click: number, depth: number): string {
  return [
    `${TAG} — button press`,
    `var c = __KVFX_NOW__ + ${n(click)};`,
    "var u = (time - c) / 0.28;",
    `var k = u > 0 && u < 1 ? 1 - ${n(depth / 100)} * Math.sin(Math.PI * u) : 1;`,
    "var out = []; for (var i = 0; i < value.length; i++) out[i] = i < 2 ? value[i] * k : value[i];",
    "out;",
  ].join("\n");
}

/** A name tag's plate, sized to the text it is parented to. */
export const TAG_PLATE_SIZE = `${TAG} — name tag\nvar r = parent.sourceRectAtTime(time, false);\n[r.width + 20, r.height + 12];`;
export const TAG_PLATE_POSITION = `${TAG} — name tag\nvar r = parent.sourceRectAtTime(time, false);\n[r.left + r.width / 2, r.top + r.height / 2];`;

// ---------------------------------------------------------------------------
// Card carousel
// ---------------------------------------------------------------------------

export const CARD_CONTROLS = {
  index: "Index",
  spacing: "Spacing",
  focus: "Focus Scale",
  side: "Side Scale",
  sideOpacity: "Side Opacity",
  hold: "Hold",
  move: "Move",
  loop: "Loop",
  visible: "Visible Cards",
} as const;

/** Advances one card per Hold + Move, eased, from the moment the rig was built. */
export function cardIndexExpression(count: number): string {
  const c = CARD_CONTROLS;
  return [
    `${TAG} — card carousel`,
    `var n = ${String(count)};`,
    `var hold = effect("${c.hold}")(1), move = Math.max(0.01, effect("${c.move}")(1));`,
    `var loop = effect("${c.loop}")(1) > 0;`,
    "var t = Math.max(0, time - __KVFX_NOW__), cycle = Math.max(0.01, hold + move);",
    "var k = Math.floor(t / cycle);",
    "var u = Math.max(0, Math.min(1, (t - k * cycle - hold) / move));",
    "var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;",
    "loop ? k + e : Math.min(n - 1, k + e);",
  ].join("\n");
}

function slotHead(slot: number, count: number): string[] {
  const c = CARD_CONTROLS;
  return [
    `${TAG} — card carousel`,
    `var n = ${String(count)}, slot = ${String(slot)};`,
    `var idx = parent.effect("${c.index}")(1);`,
    `var d = slot - idx;`,
    `if (parent.effect("${c.loop}")(1) > 0) d = d - n * Math.round(d / n);`,
    "var a = Math.min(1, Math.abs(d));",
  ];
}

export function cardPositionExpression(slot: number, count: number): string {
  const c = CARD_CONTROLS;
  return [
    ...slotHead(slot, count),
    `var sp = parent.effect("${c.spacing}")(1);`,
    "var hub = parent.anchorPoint;",
    // The card's visual centre lands on its slot, whatever its anchor point.
    "var r = sourceRectAtTime(time, false);",
    "var cx = r.left + r.width / 2, cy = r.top + r.height / 2;",
    "var s = transform.scale;",
    "var out = []; for (var i = 0; i < value.length; i++) out[i] = value[i];",
    "out[0] = hub[0] + d * sp + (anchorPoint[0] - cx) * s[0] / 100;",
    "out[1] = hub[1] + (anchorPoint[1] - cy) * s[1] / 100;",
    "out;",
  ].join("\n");
}

export function cardScaleExpression(slot: number, count: number): string {
  const c = CARD_CONTROLS;
  return [
    ...slotHead(slot, count),
    `var f = parent.effect("${c.focus}")(1), side = parent.effect("${c.side}")(1);`,
    "var k = (f + (side - f) * a) / 100;",
    "var out = []; for (var i = 0; i < value.length; i++) out[i] = i < 2 ? value[i] * k : value[i];",
    "out;",
  ].join("\n");
}

export function cardOpacityExpression(slot: number, count: number): string {
  const c = CARD_CONTROLS;
  return [
    ...slotHead(slot, count),
    `var so = parent.effect("${c.sideOpacity}")(1), vis = parent.effect("${c.visible}")(1);`,
    "var o = 100 + (so - 100) * a;",
    "var far = Math.abs(d) - vis;",
    "if (far > 0) o *= Math.max(0, 1 - far);",
    "value * o / 100;",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Backdrops
// ---------------------------------------------------------------------------

export const BACKDROP_SPEED = "Speed";

/** A 4-Color Gradient point drifting on its own slow loop. */
export function driftPointExpression(index: number): string {
  const phases: readonly (readonly [number, number, number, number, number, number])[] = [
    [0.22, 0.2, 0.31, 0.27, 0.0, 1.7],
    [0.78, 0.22, 0.23, 0.35, 2.1, 0.4],
    [0.25, 0.8, 0.29, 0.21, 4.2, 2.9],
    [0.8, 0.78, 0.19, 0.33, 1.3, 5.1],
  ];
  const [x, y, fx, fy, px, py] = phases[index % phases.length] ?? [0.5, 0.5, 0.2, 0.2, 0, 0];
  return [
    `${TAG} — backdrop drift`,
    `var s = effect("${BACKDROP_SPEED}")(1);`,
    "var w = thisLayer.width, h = thisLayer.height;",
    `[w * (${n(x)} + 0.16 * Math.sin(time * s * ${n(fx)} + ${n(px)})), h * (${n(y)} + 0.16 * Math.cos(time * s * ${n(fy)} + ${n(py)}))];`,
  ].join("\n");
}

export const GLOW_PULSE_EXPRESSION = [
  `${TAG} — backdrop glow`,
  `var s = effect("${BACKDROP_SPEED}")(1);`,
  "value * (0.82 + 0.18 * Math.sin(time * s * 0.8));",
].join("\n");

export function twinkleExpression(phase: number, rate: number): string {
  return [`${TAG} — star`, `var t = time * ${n(rate)} + ${n(phase)};`, "35 + 65 * Math.pow(0.5 + 0.5 * Math.sin(t), 3);"].join("\n");
}

export const STAR_DRIFT_EXPRESSION = [
  `${TAG} — star drift`,
  "var out = []; for (var i = 0; i < value.length; i++) out[i] = value[i];",
  "out[0] += time * 6;",
  "out;",
].join("\n");

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export const HOVER_CONTROLS = {
  cursor: "KVFX Hover Cursor",
  radius: "Hover Radius",
  scale: "Hover Scale",
  lift: "Hover Lift",
  transform: "KVFX Hover",
} as const;

/**
 * How near the cursor's tip is to this layer's bounds, 0 (far) to 1 (over
 * it), eased. Measured to the bounds rather than the centre, so a wide card
 * responds as soon as the cursor reaches its edge.
 */
const HOVER_HEAD = [
  `${TAG} — hover`,
  `var C = effect("${HOVER_CONTROLS.cursor}")(1);`,
  "var k = 0;",
  "if (C != null) {",
  "  var tip = C.toComp(C.anchorPoint);",
  "  var r = sourceRectAtTime(time, false);",
  "  var a = toComp([r.left, r.top]), b = toComp([r.left + r.width, r.top + r.height]);",
  "  var dx = Math.max(Math.min(a[0], b[0]) - tip[0], 0, tip[0] - Math.max(a[0], b[0]));",
  "  var dy = Math.max(Math.min(a[1], b[1]) - tip[1], 0, tip[1] - Math.max(a[1], b[1]));",
  `  var u = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / Math.max(1, effect("${HOVER_CONTROLS.radius}")(1)));`,
  "  k = u * u * (3 - 2 * u);",
  "}",
].join("\n");

export const HOVER_SCALE_EXPRESSION = [HOVER_HEAD, `value * (1 + k * effect("${HOVER_CONTROLS.scale}")(1) / 100);`].join("\n");
export const HOVER_LIFT_EXPRESSION = [HOVER_HEAD, `[value[0], value[1] - k * effect("${HOVER_CONTROLS.lift}")(1)];`].join("\n");

// ---------------------------------------------------------------------------
// Dot pulse
// ---------------------------------------------------------------------------

export const PULSE_CONTROLS = { speed: "Pulse Speed", width: "Pulse Width", every: "Pulse Every", idle: "Idle Size" } as const;

/**
 * One dot of the halftone wave. Its distance from the centre (0–1) is fixed
 * when the grid is built, so per frame it only compares that with the wave.
 */
export function dotPulseExpression(distance: number): string {
  const c = PULSE_CONTROLS;
  return [
    `${TAG} — dot pulse`,
    `var d = ${n(distance)};`,
    `var every = Math.max(0.1, effect("${c.every}")(1));`,
    `var w = Math.max(0.01, effect("${c.width}")(1) / 100);`,
    `var idle = effect("${c.idle}")(1);`,
    "var t = time - __KVFX_NOW__;",
    "var k = 0;",
    `if (t >= 0) { var front = (t % every) * effect("${c.speed}")(1); k = Math.max(0, 1 - Math.abs(front - d) / w); }`,
    "var s = idle + (100 - idle) * k * k * (3 - 2 * k);",
    "[s, s];",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Code glyphs and the input bar
// ---------------------------------------------------------------------------

/** Pseudo-code for the scrolling lines: generic, readable, and ours. */
export const CODE_LINES: readonly string[] = [
  "const scene = compose(layers);",
  "for (const card of deck) card.rise();",
  "await render({ fps: 60, quality: 'max' });",
  "if (frame.ready) ship(frame);",
  "const ease = curve(0.16, 1, 0.3, 1);",
  "timeline.add(title, { at: '+0.2' });",
  "export default motion(scene);",
  "const glow = light.bloom({ radius: 24 });",
  "while (idea.alive) iterate(idea);",
  "deck.stagger({ each: 3, from: 'center' });",
  "const ui = build(screen, theme.dark);",
  "cursor.moveTo(button).click();",
  "camera.dolly({ z: -400, ease });",
  "metrics.count(0, 12840, { suffix: '+' });",
  "return keyframes.map(k => k.smooth());",
  "status = 'ready to launch';",
];

export function codeLinesExpression(rows: number, linesPerSecond: number): string {
  const quoted = CODE_LINES.map((line) => JSON.stringify(line)).join(",\n  ");
  return [
    `${TAG} — code lines`,
    `var lines = [\n  ${quoted}\n];`,
    `var rows = ${String(Math.max(1, Math.round(rows)))};`,
    `var t = Math.max(0, time - __KVFX_NOW__) * ${n(linesPerSecond)};`,
    "var top = Math.floor(t), part = t - top, out = [];",
    "for (var i = 0; i < rows; i++) {",
    "  var line = lines[(top + i) % lines.length];",
    "  if (i === rows - 1) line = line.substr(0, Math.floor(line.length * part)) + '_';",
    "  out.push(line);",
    "}",
    "out.join('\\r');",
  ].join("\n");
}

export function glyphFieldExpression(columns: number, rows: number, rate: number): string {
  return [
    `${TAG} — glyph field`,
    "var chars = '01<>/{}[]#$%&*+=?;:ABCDEF0123456789';",
    `seedRandom(Math.floor(time * ${n(rate)}), true);`,
    "var s = '';",
    `for (var r = 0; r < ${String(Math.round(rows))}; r++) {`,
    `  for (var c = 0; c < ${String(Math.round(columns))}; c++) s += chars.charAt(Math.floor(random(chars.length)));`,
    `  if (r < ${String(Math.round(rows) - 1)}) s += '\\r';`,
    "}",
    "s;",
  ].join("\n");
}

export const FLICKER_EXPRESSION = [
  `${TAG} — flicker`,
  "seedRandom(Math.floor(time / thisComp.frameDuration), true);",
  "value * (random() < 0.07 ? random(0.25, 0.7) : 1);",
].join("\n");

/** The placeholder shows until typing starts. */
export const PLACEHOLDER_EXPRESSION = [`${TAG} — input placeholder`, "time < __KVFX_NOW__ ? value : 0;"].join("\n");
