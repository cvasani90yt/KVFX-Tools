/* eslint-disable no-magic-numbers -- an icon's coordinates *are* its content;
   naming 200 path numbers would obscure the drawings rather than clarify them. */

/**
 * Inline SVG icons.
 *
 * Drawn here rather than pulled from an icon set: these are all original, they
 * inherit `currentColor` so they follow the theme without a second palette, and
 * inlining avoids a network or file fetch inside a `file://` panel. A 16×16
 * grid keeps every stroke on a whole pixel at the panel's default scale.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_BOX = "0 0 16 16";

type Shape =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: "circle"; readonly cx: number; readonly cy: number; readonly r: number };

const rect = (x: number, y: number, w: number, h: number): Shape => ({ kind: "rect", x, y, w, h });
const line = (x1: number, y1: number, x2: number, y2: number): Shape => ({ kind: "line", x1, y1, x2, y2 });
const circle = (cx: number, cy: number, r: number): Shape => ({ kind: "circle", cx, cy, r });

/**
 * Each align icon is a guide line plus two bars of different lengths, so the
 * edge being aligned to is unambiguous at 16 pixels.
 */
const ICONS: Readonly<Record<string, readonly Shape[]>> = {
  "align-left": [line(2, 2, 2, 14), rect(3.5, 3.5, 10, 3.5), rect(3.5, 9, 6, 3.5)],
  "align-center-h": [line(8, 2, 8, 14), rect(3, 3.5, 10, 3.5), rect(5, 9, 6, 3.5)],
  "align-right": [line(14, 2, 14, 14), rect(2.5, 3.5, 10, 3.5), rect(6.5, 9, 6, 3.5)],
  "align-top": [line(2, 2, 14, 2), rect(3.5, 3.5, 3.5, 10), rect(9, 3.5, 3.5, 6)],
  "align-center-v": [line(2, 8, 14, 8), rect(3.5, 3, 3.5, 10), rect(9, 5, 3.5, 6)],
  "align-bottom": [line(2, 14, 14, 14), rect(3.5, 2.5, 3.5, 10), rect(9, 6.5, 3.5, 6)],
  "distribute-h": [rect(1.5, 3, 2.5, 10), rect(6.75, 3, 2.5, 10), rect(12, 3, 2.5, 10)],
  "distribute-v": [rect(3, 1.5, 10, 2.5), rect(3, 6.75, 10, 2.5), rect(3, 12, 10, 2.5)],
  "move-top": [line(2, 2.5, 14, 2.5), rect(4, 5, 8, 3), rect(4, 10, 8, 3)],
  "move-bottom": [line(2, 13.5, 14, 13.5), rect(4, 3, 8, 3), rect(4, 8, 8, 3)],
  "move-up": [rect(4, 3, 8, 3), rect(4, 9, 8, 3), line(2, 7.5, 14, 7.5)],
  "move-down": [rect(4, 4, 8, 3), rect(4, 10, 8, 3), line(2, 8.5, 14, 8.5)],
  null: [line(3, 3, 13, 13), line(13, 3, 3, 13), rect(3, 3, 10, 10)],
  adjustment: [rect(2.5, 5, 11, 6), line(5.5, 2.5, 5.5, 13.5), line(10.5, 2.5, 10.5, 13.5)],
  solo: [circle(8, 8, 3), line(8, 1.5, 8, 4), line(8, 12, 8, 14.5)],
  lock: [rect(3.5, 7, 9, 6.5), line(5.5, 7, 5.5, 4.5), line(10.5, 7, 10.5, 4.5), line(5.5, 4.5, 10.5, 4.5)],
  unlock: [rect(3.5, 7, 9, 6.5), line(5.5, 7, 5.5, 4.5), line(5.5, 4.5, 10.5, 4.5)],
  shy: [circle(8, 8, 2), line(2, 8, 14, 8)],
  eye: [circle(8, 8, 2.5), line(1.5, 8, 5.5, 8), line(10.5, 8, 14.5, 8)],
  cube: [rect(3, 3, 10, 10), line(3, 3, 6, 6), line(13, 3, 10, 6), rect(6, 6, 4, 4)],
  guide: [line(2, 4.5, 14, 4.5), line(2, 11.5, 14, 11.5), rect(6, 6.5, 4, 3)],
};

/** Builds one icon, or an empty element when the name is unknown. */
export function createIcon(name: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.25");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("kvfx-icon");

  for (const shape of ICONS[name] ?? []) {
    if (shape.kind === "rect") {
      const node = document.createElementNS(SVG_NS, "rect");
      node.setAttribute("x", String(shape.x));
      node.setAttribute("y", String(shape.y));
      node.setAttribute("width", String(shape.w));
      node.setAttribute("height", String(shape.h));
      node.setAttribute("rx", "1");
      svg.append(node);
    } else if (shape.kind === "line") {
      const node = document.createElementNS(SVG_NS, "line");
      node.setAttribute("x1", String(shape.x1));
      node.setAttribute("y1", String(shape.y1));
      node.setAttribute("x2", String(shape.x2));
      node.setAttribute("y2", String(shape.y2));
      svg.append(node);
    } else {
      const node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", String(shape.cx));
      node.setAttribute("cy", String(shape.cy));
      node.setAttribute("r", String(shape.r));
      svg.append(node);
    }
  }

  return svg;
}

export function hasIcon(name: string): boolean {
  return ICONS[name] !== undefined;
}
