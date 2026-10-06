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
  | { readonly kind: "tri"; readonly points: string };

/** A solid bar — the workhorse, because it reads at any size. */
const bar = (x: number, y: number, w: number, h: number): Shape => ({ kind: "bar", x, y, w, h });
/** An outlined box, for "a layer" where fill would be too heavy. */
const box = (x: number, y: number, w: number, h: number): Shape => ({ kind: "box", x, y, w, h });
/** A thin guide line — the edge being aligned to. */
const rule = (x1: number, y1: number, x2: number, y2: number): Shape => ({ kind: "rule", x1, y1, x2, y2 });
const dot = (cx: number, cy: number, r: number): Shape => ({ kind: "dot", cx, cy, r });
/** A solid triangle — direction, which bars alone cannot convey. */
const tri = (points: string): Shape => ({ kind: "tri", points });

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

  // Order: an arrow for direction, plus a rule for the "all the way" variants.
  // Bars alone cannot distinguish up from down — an earlier set drew move-up and
  // move-down identically.
  "move-top": [rule(2.5, 2, 13.5, 2), tri("8,4.5 12.5,9.5 3.5,9.5"), bar(6.5, 9.5, 3, 4.5)],
  "move-up": [tri(ARROW_UP), bar(6.5, 8, 3, 5)],
  "move-down": [tri(ARROW_DOWN), bar(6.5, 3, 3, 5)],
  "move-bottom": [rule(2.5, 14, 13.5, 14), tri("8,11.5 3.5,6.5 12.5,6.5"), bar(6.5, 2, 3, 4.5)],

  // Switches.
  solo: [dot(8, 8, 2.5), bar(7.25, 1, 1.5, 3), bar(7.25, 12, 1.5, 3)],
  eye: [box(2, 5, 12, 6), dot(8, 8, 1.75)],
  "eye-off": [box(2, 5, 12, 6), dot(8, 8, 1.75), rule(2.5, 13.5, 13.5, 2.5)],
  shy: [bar(2, 7.25, 12, 1.5), dot(8, 3.5, 1.5), dot(8, 12.5, 1.5)],
  cube: [box(2.5, 5.5, 8, 8), box(5.5, 2.5, 8, 8)],
  guide: [rule(1.5, 4.5, 14.5, 4.5), rule(1.5, 11.5, 14.5, 11.5), bar(6, 6.5, 4, 3)],
  lock: [bar(3.5, 7, 9, 6.5), rule(5.5, 7, 5.5, 4.75), rule(10.5, 7, 10.5, 4.75), rule(5.5, 4.75, 10.5, 4.75)],
  unlock: [bar(3.5, 7, 9, 6.5), rule(5.5, 7, 5.5, 4.75), rule(5.5, 4.75, 10.5, 4.75), rule(10.5, 4.75, 10.5, 6)],

  // Create.
  null: [box(3, 3, 10, 10), rule(3, 3, 13, 13), rule(13, 3, 3, 13)],
  adjustment: [box(2, 5.5, 12, 5), bar(5, 2.5, 1.5, 11), bar(9.5, 2.5, 1.5, 11)],
};

export function createIcon(name: string, size = 16): SVGSVGElement {
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
      node.setAttribute("stroke-width", "1.25");
      node.setAttribute("stroke-linecap", "round");
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
