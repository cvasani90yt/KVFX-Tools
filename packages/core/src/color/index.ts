/**
 * Colour helpers and After Effects' label colours.
 */

export type Rgb = readonly [number, number, number];

/** Parses "#rgb" or "#rrggbb" into 0–1 channels, as After Effects stores colour. */
const CHANNEL_MAX = 255;
const HEX_RADIX = 16;
const SHORT_HEX = 3;
const RED = 0;
const GREEN = 2;
const BLUE = 4;

export function hexToRgb(hex: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  let digits = match[1] ?? "";
  if (digits.length === SHORT_HEX) digits = digits.replace(/./g, (d) => d + d);
  const channel = (i: number): number => parseInt(digits.slice(i, i + 2), HEX_RADIX) / CHANNEL_MAX;
  return [channel(RED), channel(GREEN), channel(BLUE)];
}

export function rgbToHex(rgb: readonly number[]): string {
  const part = (n: number | undefined): string =>
    Math.round(Math.min(1, Math.max(0, n ?? 0)) * CHANNEL_MAX)
      .toString(HEX_RADIX)
      .padStart(2, "0");
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** Scales brightness: 0.5 halves it. For the darker sides of an extrusion. */
export function shade(rgb: Rgb, factor: number): Rgb {
  const f = Math.max(0, factor);
  return [Math.min(1, rgb[0] * f), Math.min(1, rgb[1] * f), Math.min(1, rgb[2] * f)];
}

export interface LabelColor {
  /** 1–16, as `Layer.label` numbers them. 0 is "None". */
  readonly index: number;
  readonly name: string;
  readonly hex: string;
}

/**
 * After Effects' factory label colours.
 *
 * Users can rename and recolour labels in Preferences ▸ Labels, and scripting
 * cannot read those preferences; these are the defaults a fresh install shows.
 */
export const LABEL_COLORS: readonly LabelColor[] = [
  { index: 1, name: "Red", hex: "#b53838" },
  { index: 2, name: "Yellow", hex: "#e4d84c" },
  { index: 3, name: "Aqua", hex: "#a9cbc7" },
  { index: 4, name: "Pink", hex: "#e5bcc9" },
  { index: 5, name: "Lavender", hex: "#a9a9ca" },
  { index: 6, name: "Peach", hex: "#e7c19e" },
  { index: 7, name: "Sea Foam", hex: "#b3c7b3" },
  { index: 8, name: "Blue", hex: "#677de0" },
  { index: 9, name: "Green", hex: "#4aa44c" },
  { index: 10, name: "Purple", hex: "#8e2c9a" },
  { index: 11, name: "Orange", hex: "#e8920d" },
  { index: 12, name: "Brown", hex: "#7f452a" },
  { index: 13, name: "Fuchsia", hex: "#f46dd6" },
  { index: 14, name: "Cyan", hex: "#3da2a5" },
  { index: 15, name: "Sandstone", hex: "#a89677" },
  { index: 16, name: "Dark Green", hex: "#1e401e" },
];
