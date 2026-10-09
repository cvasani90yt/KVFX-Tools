/* eslint-disable no-magic-numbers -- an icon's coordinates *are* its content;
   naming 200 path numbers would obscure the drawings rather than clarify them. */

/**
 * Inline SVG icons.
 *
 * Original drawings on a 16×16 grid, inheriting `currentColor` so they follow
 * the theme, and inlined so nothing is fetched inside a `file://` panel.
 *
 * Built mostly from **filled** rectangles rather than outlines. An earlier
 * stroked set was tested in the headless preview and several icons were simply
 * unreadable at 16px — thin outlines of small shapes turn to mush. Solid bars
 * against a single thin guide line survive the size, which is the only test
 * that matters for an icon this small.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_BOX = "0 0 16 16";

type Shape =
  | { readonly kind: "bar"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "box"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "rule"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: "dot"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: "tri"; readonly points: string }
  | { readonly kind: "ring"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: "path"; readonly d: string; readonly fill: boolean };

/** A solid bar — the workhorse, because it reads at any size. */
const bar = (x: number, y: number, w: number, h: number): Shape => ({ kind: "bar", x, y, w, h });
/** An outlined box, for "a layer" where fill would be too heavy. */
const box = (x: number, y: number, w: number, h: number): Shape => ({ kind: "box", x, y, w, h });
/** A thin guide line — the edge being aligned to. */
const rule = (x1: number, y1: number, x2: number, y2: number): Shape => ({ kind: "rule", x1, y1, x2, y2 });
const dot = (cx: number, cy: number, r: number): Shape => ({ kind: "dot", cx, cy, r });
/** A solid triangle — direction, which bars alone cannot convey. */
const tri = (points: string): Shape => ({ kind: "tri", points });

/** An outlined circle. */
const ring = (cx: number, cy: number, r: number): Shape => ({ kind: "ring", cx, cy, r });
/** A stroked path — curves, which no bar can draw. */
const line = (d: string): Shape => ({ kind: "path", d, fill: false });
/** A filled path. */
const solid = (d: string): Shape => ({ kind: "path", d, fill: true });

/** A gear outline, generated rather than hand-written so its teeth are even. */
function gear(): Shape {
  const teeth = 8;
  const outer = 7;
  const inner = 5.4;
  const parts: string[] = [];
  for (let i = 0; i < teeth * 2; i += 1) {
    const angle = (Math.PI * i) / teeth;
    const radius = i % 2 === 0 ? outer : inner;
    const half = Math.PI / teeth / 2.4;
    for (const a of [angle - half, angle + half]) {
      const x = 8 + radius * Math.cos(a);
      const y = 8 + radius * Math.sin(a);
      parts.push(`${parts.length === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  }
  // Even-odd fill punches the centre hole out of the toothed disc.
  return { kind: "path", d: `${parts.join(" ")} Z M8 5.6 A2.4 2.4 0 1 0 8 10.4 A2.4 2.4 0 1 0 8 5.6 Z`, fill: true };
}

const ARROW_UP = "8,3 12.5,8 3.5,8";
const ARROW_DOWN = "8,13 3.5,8 12.5,8";

const ICONS: Readonly<Record<string, readonly Shape[]>> = {
  // Align: one guide line, two bars of different lengths against it.
  "align-left": [rule(1.5, 1.5, 1.5, 14.5), bar(3.5, 3.5, 10, 3.5), bar(3.5, 9, 6, 3.5)],
  "align-center-h": [rule(8, 1.5, 8, 14.5), bar(3, 3.5, 10, 3.5), bar(5, 9, 6, 3.5)],
  "align-right": [rule(14.5, 1.5, 14.5, 14.5), bar(2.5, 3.5, 10, 3.5), bar(6.5, 9, 6, 3.5)],
  "align-top": [rule(1.5, 1.5, 14.5, 1.5), bar(3.5, 3.5, 3.5, 10), bar(9, 3.5, 3.5, 6)],
  "align-center-v": [rule(1.5, 8, 14.5, 8), bar(3.5, 3, 3.5, 10), bar(9, 5, 3.5, 6)],
  "align-bottom": [rule(1.5, 14.5, 14.5, 14.5), bar(3.5, 2.5, 3.5, 10), bar(9, 6.5, 3.5, 6)],

  // Distribute: three bars, evenly gapped — the gaps are the message.
  "distribute-h": [bar(1, 3, 2.5, 10), bar(6.75, 3, 2.5, 10), bar(12.5, 3, 2.5, 10)],
  "distribute-v": [bar(3, 1, 10, 2.5), bar(3, 6.75, 10, 2.5), bar(3, 12.5, 10, 2.5)],

  // Even gaps: bars of different widths with equal guide-marked gaps.
  "gaps-h": [bar(1, 4, 2, 8), rule(4.5, 8, 5.5, 8), bar(7, 3, 3.5, 10), rule(12, 8, 13, 8), bar(14.5, 5, 1, 6)],
  "gaps-v": [bar(4, 1, 8, 2), rule(8, 4.5, 8, 5.5), bar(3, 7, 10, 3.5), rule(8, 12, 8, 13), bar(5, 14.5, 6, 1)],
  // Follow: a leader and a trailing copy joined by a dashed path.
  follow: [bar(9.5, 2.5, 5, 5), box(1.5, 8.5, 5, 5), line("M6.5 9.5 Q8.5 9 9.5 7.5")],

  // UI Motion.
  "ui-stagger": [bar(1.5, 2, 6, 3), bar(4.5, 6.5, 6, 3), bar(7.5, 11, 6, 3), tri("14.5,4 12,2.5 12,5.5")],
  cursor: [solid("M3 1.5 L3 13 L6 10.4 L8 14.6 L10.2 13.6 L8.2 9.4 L12.2 9.4 Z")],
  "card-carousel": [box(0.8, 5, 3.4, 6), bar(5, 3, 6, 10), box(11.8, 5, 3.4, 6)],
  backdrop: [box(1.5, 2.5, 13, 11), solid("M1.5 13.5 Q5 7.5 8.5 10 T14.5 8 V13.5 Z"), dot(11.5, 5.5, 1.3)],

  hover: [box(2, 6, 9, 7), tri("9,1.5 9,9.5 11.2,7.4 12.6,10.4 14,9.8 12.6,6.8 15.2,6.6")],
  "dot-pulse": [dot(8, 8, 2.2), ring(8, 8, 5), dot(2, 2, 1), dot(14, 2, 1), dot(2, 14, 1), dot(14, 14, 1)],
  glass: [box(1.5, 2.5, 13, 11), rule(4, 11, 9, 5), rule(7, 12, 12, 6)],
  wipe: [box(1.5, 2.5, 13, 11), bar(1.5, 2.5, 7, 11), rule(10.5, 1, 10.5, 15)],
  code: [line("M5 4 L1.8 8 L5 12"), line("M11 4 L14.2 8 L11 12"), rule(9.2, 3, 6.8, 13)],
  "input-bar": [box(0.8, 4.5, 14.4, 7), bar(3, 7.25, 1.2, 2.5), dot(12.3, 8, 1.6)],
  resize: [box(1.5, 4.5, 10, 10), line("M8.5 1.5 H14.5 V7.5"), rule(14.5, 1.5, 9, 7)],
  silence: [bar(1, 6, 1.6, 4), bar(3.6, 3.5, 1.6, 9), rule(6.5, 8, 9.5, 8), bar(10.8, 4.5, 1.6, 7), bar(13.4, 6.5, 1.6, 3)],
  swap: [line("M2.5 5.5 H12.5"), tri("14.5,5.5 11.5,3 11.5,8"), line("M13.5 10.5 H3.5"), tri("1.5,10.5 4.5,8 4.5,13")],

  // Order: an arrow for direction, plus a rule for the "all the way" variants.
  // Bars alone cannot distinguish up from down — an earlier set drew move-up and
  // move-down identically.
  "move-top": [rule(2.5, 2, 13.5, 2), tri("8,4.5 12.5,9.5 3.5,9.5"), bar(6.5, 9.5, 3, 4.5)],
  "move-up": [tri(ARROW_UP), bar(6.5, 8, 3, 5)],
  "move-down": [tri(ARROW_DOWN), bar(6.5, 3, 3, 5)],
  "move-bottom": [rule(2.5, 14, 13.5, 14), tri("8,11.5 3.5,6.5 12.5,6.5"), bar(6.5, 2, 3, 4.5)],

  // Switches.
  solo: [dot(8, 8, 2.5), bar(7.25, 1, 1.5, 3), bar(7.25, 12, 1.5, 3)],
  eye: [line("M1.5 8 Q8 1.5 14.5 8 Q8 14.5 1.5 8 Z"), dot(8, 8, 2.2)],
  "eye-off": [line("M1.5 8 Q8 1.5 14.5 8 Q8 14.5 1.5 8 Z"), dot(8, 8, 2.2), rule(2.5, 13.5, 13.5, 2.5)],
  // A closed eye: the layer is there, just keeping its head down.
  shy: [line("M2 6.5 Q8 12.5 14 6.5"), rule(4.2, 9.2, 3, 11.2), rule(8, 10.4, 8, 12.8), rule(11.8, 9.2, 13, 11.2)],
  cube: [box(2.5, 5.5, 8, 8), box(5.5, 2.5, 8, 8)],
  guide: [rule(1.5, 4.5, 14.5, 4.5), rule(1.5, 11.5, 14.5, 11.5), bar(6, 6.5, 4, 3)],
  lock: [bar(3.5, 7, 9, 7), line("M5.5 7 V5 A2.5 2.5 0 0 1 10.5 5 V7")],
  // The shackle swung open to the left.
  unlock: [bar(5.5, 7, 9, 7), line("M2.5 5.5 V5 A2.75 2.75 0 0 1 8 5 V7")],

  // Create.
  null: [box(3, 3, 10, 10), rule(3, 3, 13, 13), rule(13, 3, 3, 13)],
  adjustment: [box(2, 5.5, 12, 5), bar(5, 2.5, 1.5, 11), bar(9.5, 2.5, 1.5, 11)],
  solid: [bar(3, 3, 10, 10)],
  text: [bar(2.5, 2.5, 11, 2.5), bar(6.75, 2.5, 2.5, 11)],
  shape: [solid("M8 1.8 L9.8 6 L14.3 6.2 L10.8 9 L12 13.6 L8 11 L4 13.6 L5.2 9 L1.7 6.2 L6.2 6 Z")],
  camera: [bar(1.5, 4.5, 9, 7), tri("11,8 14.5,5.5 14.5,10.5")],
  link: [ring(5.5, 8, 3), ring(10.5, 8, 3)],

  // Layer tools.
  precompose: [box(1.5, 1.5, 13, 13), bar(4.5, 4.5, 7, 7)],
  split: [bar(1.5, 4, 5, 8), bar(9.5, 4, 5, 8), rule(8, 1.5, 8, 14.5)],
  duplicate: [box(1.5, 5.5, 9, 9), bar(5.5, 1.5, 9, 9)],
  trim: [bar(2.5, 2.5, 1.75, 11), bar(11.75, 2.5, 1.75, 11), bar(5.5, 7, 5, 2)],
  sequence: [bar(1.5, 2.5, 6, 2.5), bar(5, 6.75, 6, 2.5), bar(8.5, 11, 6, 2.5)],
  fill: [solid("M3 7 L8 2 L13 7 L8 12 Z"), dot(13.5, 11.5, 1.6)],
  gradient: [box(2, 2, 12, 12), bar(2, 2, 4, 12), bar(6, 2, 2.5, 12)],
  select: [box(1.5, 1.5, 9, 9), tri("8,8 14.5,11 11.5,11.8 10.6,14.6")],
  label: [solid("M1.5 3 H9 L14.5 8 L9 13 H1.5 Z"), dot(5, 8, 1.2)],

  // Keyframes and motion.
  ease: [line("M2 14 C8 14 8 2 14 2"), dot(2, 14, 1.5), dot(14, 2, 1.5)],
  "key-linear": [rule(3, 13, 13, 3), solid("M3 10.5 L5.5 13 L3 15.5 L0.5 13 Z"), solid("M13 0.5 L15.5 3 L13 5.5 L10.5 3 Z")],
  "key-hold": [line("M2 12 H8 V4 H14"), dot(2, 12, 1.5), dot(8, 4, 1.5)],
  "key-bezier": [line("M2 13 C7 13 9 3 14 3"), solid("M2 10.5 L4.5 13 L2 15.5 L-0.5 13 Z"), solid("M14 0.5 L16.5 3 L14 5.5 L11.5 3 Z")],
  reverse: [tri("2,5 6.5,1.5 6.5,8.5"), bar(6.5, 4, 7.5, 2), tri("14,11 9.5,7.5 9.5,14.5"), bar(2, 10, 7.5, 2)],
  elastic: [line("M1 8 C3 1 4 1 5 8 S7 13 8.5 8 S10.5 5.5 11.5 8 S13.5 9.5 15 8")],
  bounce: [line("M1.5 2 Q4 14 6.5 14 Q8.5 7 10.5 14 Q12 10.5 13.5 14"), dot(13.5, 12, 1.5)],
  loop: [line("M12.5 5.5 A5 5 0 1 0 13 9.5"), tri("14.5,2 14.5,7 9.8,5.6")],
  wiggle: [line("M1 9 L3.5 4 L6 12 L8.5 3 L11 11 L13 6 L15 8")],
  clear: [box(2, 2, 12, 12), rule(5, 5, 11, 11), rule(11, 5, 5, 11)],

  // Text.
  "text-animate": [bar(5, 2.5, 9.5, 2.5), bar(8.5, 2.5, 2.5, 11), rule(1, 7, 4, 7), rule(1.5, 10.5, 5, 10.5)],
  explode: [bar(1.5, 5, 3, 6), bar(6.5, 2, 3, 6), bar(11.5, 6.5, 3, 6), dot(8, 12.5, 1.25)],
  "text-style": [solid("M8 1.5 L13.2 12.5 H10.8 L9.7 10 H6.3 L5.2 12.5 H2.8 Z M7 8 H9 L8 5.5 Z"), bar(2, 13.5, 12, 1.5)],

  // Effects.
  "fx-blur": [dot(3.5, 8, 2.4), dot(8.5, 8, 1.8), dot(12.5, 8, 1.2)],
  "fx-glow": [dot(8, 8, 2.8), rule(8, 1, 8, 3), rule(8, 13, 8, 15), rule(1, 8, 3, 8), rule(13, 8, 15, 8), rule(3, 3, 4.4, 4.4), rule(11.6, 11.6, 13, 13), rule(13, 3, 11.6, 4.4), rule(3, 13, 4.4, 11.6)],
  "fx-shadow": [bar(4.5, 4.5, 10, 10), box(1.5, 1.5, 10, 10)],
  "fx-tint": [ring(8, 8, 6), solid("M8 2 A6 6 0 0 1 8 14 Z")],
  "fx-bevel": [box(1.5, 1.5, 13, 13), box(4.5, 4.5, 7, 7), rule(1.5, 1.5, 4.5, 4.5), rule(14.5, 14.5, 11.5, 11.5)],
  "fx-slider": [rule(1.5, 8, 14.5, 8), dot(10, 8, 2.75)],
  "fx-checkbox": [box(2, 2, 12, 12), line("M4.5 8.2 L7 10.7 L11.5 5.3")],
  "fx-color": [dot(8, 4.5, 3), dot(4.5, 10.5, 3), dot(11.5, 10.5, 3)],
  "fx-point": [rule(8, 1, 8, 15), rule(1, 8, 15, 8), ring(8, 8, 3.5)],
  "fx-angle": [ring(8, 8, 6), rule(8, 8, 12.5, 4)],

  // Generators.
  counter: [rule(5.5, 2, 4.5, 14), rule(11.5, 2, 10.5, 14), rule(2, 5.5, 14, 5.5), rule(2, 10.5, 14, 10.5)],
  carousel: [line("M1.5 8 A6.5 3 0 0 0 14.5 8 A6.5 3 0 0 0 1.5 8"), bar(6.5, 7.5, 3, 5), bar(1.8, 4.5, 2.2, 4), bar(12, 4.5, 2.2, 4)],
  extrude: [box(5.5, 1.5, 9, 9), box(3.5, 3.5, 9, 9), bar(1.5, 5.5, 9, 9)],

  // Anchor arrows — the persistent 3×3 grid.
  "arrow-nw": [tri("2,2 9,2 2,9"), rule(5, 5, 13, 13)],
  "arrow-n": [tri("8,1.5 13,7.5 3,7.5"), bar(7, 7.5, 2, 7)],
  "arrow-ne": [tri("14,2 14,9 7,2"), rule(11, 5, 3, 13)],
  "arrow-w": [tri("1.5,8 7.5,3 7.5,13"), bar(7.5, 7, 7, 2)],
  "arrow-c": [ring(8, 8, 5), dot(8, 8, 2)],
  "arrow-e": [tri("14.5,8 8.5,3 8.5,13"), bar(1.5, 7, 7, 2)],
  "arrow-sw": [tri("2,14 2,7 9,14"), rule(5, 11, 13, 3)],
  "arrow-s": [tri("8,14.5 3,8.5 13,8.5"), bar(7, 1.5, 2, 7)],
  "arrow-se": [tri("14,14 7,14 14,7"), rule(11, 11, 3, 3)],

  // Tabs.
  "tab-tools": [bar(2, 2, 5, 5), bar(9, 2, 5, 5), bar(2, 9, 5, 5), box(9, 9, 5, 5)],
  "tab-ease": [line("M2 14 C9 14 7 2 14 2"), dot(14, 2, 1.6)],
  "tab-text": [bar(2.5, 2.5, 11, 2.5), bar(6.75, 2.5, 2.5, 11)],
  "tab-fx": [solid("M8 1 L9.6 6.4 L15 8 L9.6 9.6 L8 15 L6.4 9.6 L1 8 L6.4 6.4 Z")],
  "tab-gen": [solid("M8 1.5 L13.6 4.75 V11.25 L8 14.5 L2.4 11.25 V4.75 Z M8 5.5 L5.8 6.8 V9.2 L8 10.5 L10.2 9.2 V6.8 Z")],
  "tab-labels": [solid("M1.5 3 H9 L14.5 8 L9 13 H1.5 Z"), dot(5, 8, 1.2)],
  "tab-library": [bar(2, 3, 2.5, 11), bar(5.5, 2, 2.5, 12), solid("M9.5 3.6 L11.9 3 L14.5 13.4 L12.1 14 Z")],
  "tab-media": [box(1.5, 2.5, 13, 11), tri("3.5,12 7.5,6.5 11,12"), dot(11, 6, 1.5)],

  // Chrome.
  gear: [gear()],
  search: [ring(7, 7, 4.5), rule(10.5, 10.5, 14, 14)],
  memory: [bar(3.5, 3.5, 9, 9), rule(5.5, 1, 5.5, 3.5), rule(10.5, 1, 10.5, 3.5), rule(5.5, 12.5, 5.5, 15), rule(10.5, 12.5, 10.5, 15)],
  close: [rule(3.5, 3.5, 12.5, 12.5), rule(12.5, 3.5, 3.5, 12.5)],
  refresh: [line("M13 8 A5 5 0 1 1 11.5 4.5"), tri("14,1.5 14,6.5 9.5,5")],
  plus: [bar(7, 2.5, 2, 11), bar(2.5, 7, 11, 2)],
  trash: [bar(2.5, 3, 11, 1.75), bar(6, 1.5, 4, 1.5), solid("M3.8 5.5 H12.2 L11.4 14.5 H4.6 Z")],
  folder: [solid("M1.5 3.5 H6.5 L8 5 H14.5 V13 H1.5 Z")],
  file: [solid("M3 1.5 H9.5 L13 5 V14.5 H3 Z")],
  film: [box(1.5, 2.5, 13, 11), bar(1.5, 2.5, 2.5, 11), bar(12, 2.5, 2.5, 11)],
  audio: [bar(2, 6, 2, 4), bar(5.5, 3.5, 2, 9), bar(9, 1.5, 2, 13), bar(12.5, 5, 2, 6)],
  play: [tri("4,2.5 13,8 4,13.5")],
  check: [line("M2.5 8.5 L6.5 12.5 L13.5 4")],
  warning: [solid("M8 1.5 L15 14 H1 Z"), bar(7.25, 5.5, 1.5, 4.5)],
  star: [solid("M8 1.5 L9.9 5.9 L14.6 6.3 L11 9.4 L12.1 14 L8 11.5 L3.9 14 L5 9.4 L1.4 6.3 L6.1 5.9 Z")],
  palette: [box(1.5, 3, 13, 10), bar(3.5, 6, 2, 2), bar(7, 6, 5.5, 2), bar(3.5, 9.5, 9, 1.5)],
  "chevron-down": [line("M3.5 6 L8 10.5 L12.5 6")],
  "chevron-right": [line("M6 3.5 L10.5 8 L6 12.5")],
};

/** The sizes the panel draws icons at. */
export const IconSize = {
  tiny: 10,
  small: 12,
  medium: 14,
  regular: 16,
  large: 22,
  huge: 28,
} as const;

export function createIcon(name: string, size: number = IconSize.regular): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("kvfx-icon");

  for (const shape of ICONS[name] ?? []) {
    if (shape.kind === "bar" || shape.kind === "box") {
      const node = document.createElementNS(SVG_NS, "rect");
      const inset = shape.kind === "box" ? 0.5 : 0;
      node.setAttribute("x", String(shape.x + inset));
      node.setAttribute("y", String(shape.y + inset));
      node.setAttribute("width", String(Math.max(shape.w - inset * 2, 0)));
      node.setAttribute("height", String(Math.max(shape.h - inset * 2, 0)));
      node.setAttribute("rx", "0.75");
      if (shape.kind === "bar") {
        node.setAttribute("fill", "currentColor");
      } else {
        node.setAttribute("fill", "none");
        node.setAttribute("stroke", "currentColor");
        node.setAttribute("stroke-width", "1");
        node.setAttribute("opacity", "0.55");
      }
      svg.append(node);
    } else if (shape.kind === "rule") {
      const node = document.createElementNS(SVG_NS, "line");
      node.setAttribute("x1", String(shape.x1));
      node.setAttribute("y1", String(shape.y1));
      node.setAttribute("x2", String(shape.x2));
      node.setAttribute("y2", String(shape.y2));
      node.setAttribute("stroke", "currentColor");
      node.setAttribute("stroke-width", "1.5");
      node.setAttribute("stroke-linecap", "round");
      svg.append(node);
    } else if (shape.kind === "ring") {
      const node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", String(shape.cx));
      node.setAttribute("cy", String(shape.cy));
      node.setAttribute("r", String(shape.r));
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", "currentColor");
      node.setAttribute("stroke-width", "1.5");
      svg.append(node);
    } else if (shape.kind === "path") {
      const node = document.createElementNS(SVG_NS, "path");
      node.setAttribute("d", shape.d);
      if (shape.fill) {
        node.setAttribute("fill", "currentColor");
        node.setAttribute("fill-rule", "evenodd");
      } else {
        node.setAttribute("fill", "none");
        node.setAttribute("stroke", "currentColor");
        node.setAttribute("stroke-width", "1.6");
        node.setAttribute("stroke-linecap", "round");
        node.setAttribute("stroke-linejoin", "round");
      }
      svg.append(node);
    } else if (shape.kind === "tri") {
      const node = document.createElementNS(SVG_NS, "polygon");
      node.setAttribute("points", shape.points);
      node.setAttribute("fill", "currentColor");
      svg.append(node);
    } else {
      const node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", String(shape.cx));
      node.setAttribute("cy", String(shape.cy));
      node.setAttribute("r", String(shape.r));
      node.setAttribute("fill", "currentColor");
      svg.append(node);
    }
  }

  return svg;
}

export function hasIcon(name: string): boolean {
  return ICONS[name] !== undefined;
}
