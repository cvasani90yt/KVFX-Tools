import { rgbToHex } from "@kvfx/core";

/**
 * The eyedroppers' arithmetic, kept free of the DOM so it can be tested.
 */

/* eslint-disable no-magic-numbers -- PNG's fixed bytes and RGBA strides */

/** Every PNG starts with this in Base64: its 8-byte signature and the first byte of IHDR's length. */
const PNG_START = "iVBORw0KGgo";
/** …and ends with these bytes: the IEND chunk's type and its CRC. */
const PNG_END = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/**
 * Whether Base64 data holds a whole PNG — signature at the start, end chunk
 * at the end — rather than one After Effects is still writing.
 */
export function pngComplete(base64: string): boolean {
  const data = base64.replace(/\s+/g, "");
  if (!data.startsWith(PNG_START) || data.length < 64 || data.length % 4 !== 0) return false;
  let tail: string;
  try {
    tail = atob(data.slice(-24));
  } catch {
    return false;
  }
  const end = tail.slice(-PNG_END.length);
  return end.length === PNG_END.length && PNG_END.every((byte, i) => end.charCodeAt(i) === byte);
}

/** The colour of pixel (x, y) in RGBA data `width` pixels wide, as "#rrggbb". */
export function hexAt(data: ArrayLike<number>, width: number, x: number, y: number): string {
  const i = (Math.round(y) * width + Math.round(x)) * 4;
  return rgbToHex([(data[i] ?? 0) / 255, (data[i + 1] ?? 0) / 255, (data[i + 2] ?? 0) / 255]);
}

/** The largest size with this aspect that fits inside the box. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
