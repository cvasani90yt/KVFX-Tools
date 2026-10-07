import type { JsonObject } from "../types/json.js";

/**
 * Text animation presets.
 *
 * Each preset is the "hidden" state of a character plus how the reveal runs.
 * The animator applies that state to the selected range; animating the range
 * selector's Start from 0 to 100 shrinks the selection left to right, so
 * characters arrive one after another. The same description drives the
 * panel's live CSS preview, so what the user sees in the tile is what the
 * preset does in the composition.
 */

export interface CharacterState {
  readonly opacity?: number;
  /** Pixels; positive x is right, positive y is down, as in After Effects. */
  readonly x?: number;
  readonly y?: number;
  /** Percent. */
  readonly scale?: number;
  /** Degrees. */
  readonly rotation?: number;
  /** Pixels of blur. */
  readonly blur?: number;
  /** Tracking amount, in thousandths of an em. */
  readonly tracking?: number;
}

export interface TextPreset {
  readonly id: string;
  readonly name: string;
  readonly from: CharacterState;
  /** Seconds for the whole reveal. */
  readonly duration: number;
  /** 0 = each character snaps in; 100 = soft, overlapping transitions. */
  readonly smoothness: number;
}

export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: "typewriter", name: "Typewriter", from: { opacity: 0 }, duration: 1.2, smoothness: 0 },
  { id: "fade", name: "Fade In", from: { opacity: 0 }, duration: 1, smoothness: 100 },
  { id: "rise", name: "Rise", from: { opacity: 0, y: 40 }, duration: 1, smoothness: 100 },
  { id: "drop", name: "Drop", from: { opacity: 0, y: -60 }, duration: 1, smoothness: 100 },
  { id: "slide", name: "Slide", from: { opacity: 0, x: 80 }, duration: 1, smoothness: 100 },
  { id: "pop", name: "Pop", from: { opacity: 0, scale: 0 }, duration: 0.9, smoothness: 100 },
  { id: "blur", name: "Blur In", from: { opacity: 0, blur: 24 }, duration: 1.2, smoothness: 100 },
  { id: "spin", name: "Spin", from: { opacity: 0, rotation: -90 }, duration: 1, smoothness: 100 },
  { id: "track", name: "Track In", from: { opacity: 0, tracking: 300 }, duration: 1.4, smoothness: 100 },
  { id: "zoom", name: "Zoom Out", from: { opacity: 0, scale: 300 }, duration: 1, smoothness: 100 },
];

/** Z scale is left alone: characters are flat. */
const FULL_DEPTH_SCALE = 100;

/** The `text.addAnimator` spec that reproduces a preset. */
export function animatorFor(preset: TextPreset): JsonObject {
  const s = preset.from;
  const properties: JsonObject[] = [];
  if (s.opacity !== undefined) properties.push({ matchName: "ADBE Text Opacity", value: s.opacity });
  if (s.x !== undefined || s.y !== undefined) {
    properties.push({ matchName: "ADBE Text Position 3D", value: [s.x ?? 0, s.y ?? 0, 0] });
  }
  if (s.scale !== undefined) {
    properties.push({ matchName: "ADBE Text Scale 3D", value: [s.scale, s.scale, FULL_DEPTH_SCALE] });
  }
  if (s.rotation !== undefined) properties.push({ matchName: "ADBE Text Rotation", value: s.rotation });
  if (s.blur !== undefined) properties.push({ matchName: "ADBE Text Blur", value: [s.blur, s.blur] });
  if (s.tracking !== undefined) properties.push({ matchName: "ADBE Text Tracking Amount", value: s.tracking });

  return {
    name: `KVFX ${preset.name}`,
    properties,
    selectors: [
      {
        units: "percent",
        smoothness: preset.smoothness,
        keys: {
          start: [
            { time: 0, value: 0 },
            { time: preset.duration, value: 100 },
          ],
        },
      },
    ],
  };
}

export function textPreset(id: string): TextPreset | undefined {
  return TEXT_PRESETS.find((preset) => preset.id === id);
}
