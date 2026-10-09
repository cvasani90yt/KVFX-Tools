import type { Rgb } from "../color/index.js";
import { hexToRgb } from "../color/index.js";

/**
 * The parts layout templates are drawn with.
 *
 * Coordinates are design units around the template's centre, y down, as in
 * After Effects. The builder scales the whole set to fit the comp, so a
 * template reads the same in 16:9, 9:16 or square.
 */

export type ColorRole = "surface" | "raised" | "edge" | "text" | "muted" | "accent" | "onAccent" | "good" | "track" | "ink";

export type LayoutReveal = "rise" | "drop" | "slideLeft" | "slideRight" | "pop" | "scale" | "fade" | "blur" | "bounce" | "growY" | "growX" | "draw" | "none";

interface Common {
  readonly name: string;
  /** When it arrives, in stagger steps. */
  readonly order: number;
  readonly reveal?: LayoutReveal;
  readonly rotation?: number;
}

export interface CardElement extends Common {
  readonly kind: "card";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly fill: ColorRole;
  readonly stroke?: ColorRole;
  readonly shadow?: boolean;
}

export interface CircleElement extends Common {
  readonly kind: "circle";
  readonly x: number;
  readonly y: number;
  readonly d: number;
  readonly fill: ColorRole;
}

export interface CounterSpec {
  readonly from: number;
  readonly to: number;
  readonly decimals: number;
  readonly prefix: string;
  readonly suffix: string;
}

export interface TextElement extends Common {
  readonly kind: "text";
  readonly x: number;
  /** Baseline of the first line. */
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly color: ColorRole;
  readonly align: "left" | "center" | "right";
  readonly counter?: CounterSpec;
}

export interface BarElement extends Common {
  readonly kind: "bar";
  readonly x: number;
  /** The bar's base; it grows upwards from here. */
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly fill: ColorRole;
}

export interface RingElement extends Common {
  readonly kind: "ring";
  readonly x: number;
  readonly y: number;
  readonly d: number;
  readonly width: number;
  readonly color: ColorRole;
  readonly track: ColorRole;
  /** 0–1. */
  readonly progress: number;
}

export interface LineElement extends Common {
  readonly kind: "line";
  readonly points: readonly (readonly [number, number])[];
  readonly width: number;
  readonly color: ColorRole;
}

export interface DotsElement extends Common {
  readonly kind: "dots";
  readonly x: number;
  readonly y: number;
  readonly d: number;
  readonly color: ColorRole;
}

export type LayoutElement = CardElement | CircleElement | TextElement | BarElement | RingElement | LineElement | DotsElement;

export interface LayoutTheme {
  readonly id: "dark" | "light";
  readonly colors: Readonly<Record<Exclude<ColorRole, "accent" | "onAccent">, string>>;
}

export const LAYOUT_THEMES: readonly LayoutTheme[] = [
  {
    id: "dark",
    colors: { surface: "#16171c", raised: "#20222a", edge: "#2d3039", text: "#f4f4f5", muted: "#9a9ca6", good: "#34d399", track: "#2a2c34", ink: "#0b0b0d" },
  },
  {
    id: "light",
    colors: { surface: "#ffffff", raised: "#f3f4f6", edge: "#e5e7eb", text: "#111827", muted: "#6b7280", good: "#059669", track: "#e5e7eb", ink: "#111827" },
  },
];

const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722, light: 0.6 } as const;

/** A colour role in a theme, with the user's accent. */
export function resolveColor(role: ColorRole, theme: LayoutTheme, accent: Rgb): Rgb {
  if (role === "accent") return accent;
  if (role === "onAccent") {
    const luma = LUMA.r * accent[0] + LUMA.g * accent[1] + LUMA.b * accent[2];
    return luma > LUMA.light ? (hexToRgb("#111111") ?? [0, 0, 0]) : [1, 1, 1];
  }
  return hexToRgb(theme.colors[role]) ?? [1, 1, 1];
}

/** Breaks text into lines of about `width` characters, at spaces. */
export function wrapText(text: string, width: number): string {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      if (line.length > 0 && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line.length > 0 ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.join("\r");
}
