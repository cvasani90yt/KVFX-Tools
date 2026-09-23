import { indexOf, isArray, keysOf, padZero } from "./es3.js";

/**
 * JSON serialisation for the host → panel direction.
 *
 * ExtendScript has no dependable `JSON` object, so we emit the reply ourselves.
 * Only the *write* direction is needed: requests arrive as an evaluated source
 * literal (see `@kvfx/bridge` `toExtendScriptLiteral`), so the host never has to
 * parse JSON and we avoid shipping a hand-written parser into ES3.
 *
 * Output is pure ASCII for the same reason the request literal is: the reply
 * crosses `evalScript` as a string, and we will not let host-side text encoding
 * decide whether a layer name survives intact.
 */

export type HostJson = string | number | boolean | null | HostJson[] | { [key: string]: HostJson };

const MAX_DEPTH = 32;

const CHAR_QUOTE = 0x22;
const CHAR_BACKSLASH = 0x5c;
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;
const HEX_RADIX = 16;
const UNICODE_ESCAPE_DIGITS = 4;

function escapeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === CHAR_QUOTE) {
      out += '\\"';
    } else if (code === CHAR_BACKSLASH) {
      out += "\\\\";
    } else if (code >= PRINTABLE_MIN && code <= PRINTABLE_MAX) {
      out += value.charAt(i);
    } else {
      out += `\\u${padZero(code.toString(HEX_RADIX), UNICODE_ESCAPE_DIGITS)}`;
    }
  }
  return `${out}"`;
}

function serialiseNumber(value: number): string {
  // NaN and Infinity have no JSON form. Emitting them would produce a reply the
  // panel cannot parse at all, losing the error along with the result, so they
  // degrade to null exactly as the JSON specification requires.
  if (isNaN(value) || value === Infinity || value === -Infinity) return "null";
  return String(value);
}

function serialiseValue(value: HostJson, depth: number, seen: unknown[]): string {
  if (value === null || typeof value === "undefined") return "null";

  const kind = typeof value;
  if (kind === "string") return escapeString(value as string);
  if (kind === "number") return serialiseNumber(value as number);
  if (kind === "boolean") return (value as boolean) ? "true" : "false";
  if (kind === "function") return "null";

  if (depth > MAX_DEPTH) return '"[max depth exceeded]"';

  // Reference equality scan: `indexOf` on an object array is not available in
  // ES3, and the nesting depth is bounded, so a linear scan is fine.
  for (let s = 0; s < seen.length; s += 1) {
    if (seen[s] === value) return '"[circular]"';
  }
  seen[seen.length] = value;

  let out: string;
  if (isArray(value)) {
    const list = value as HostJson[];
    const parts: string[] = [];
    for (let i = 0; i < list.length; i += 1) {
      parts[parts.length] = serialiseValue(list[i] as HostJson, depth + 1, seen);
    }
    out = `[${parts.join(",")}]`;
  } else {
    const record = value as { [key: string]: HostJson };
    const keys = keysOf(record);
    const parts: string[] = [];
    for (let k = 0; k < keys.length; k += 1) {
      const key = keys[k] as string;
      const entry = record[key];
      if (typeof entry === "undefined" || typeof entry === "function") continue;
      parts[parts.length] = `${escapeString(key)}:${serialiseValue(entry, depth + 1, seen)}`;
    }
    out = `{${parts.join(",")}}`;
  }

  seen.length = seen.length - 1;
  return out;
}

export function stringify(value: HostJson): string {
  return serialiseValue(value, 0, []);
}

/** Exposed for the guard tests: proves we never emit a non-ASCII byte. */
export function isPureAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < PRINTABLE_MIN || code > PRINTABLE_MAX) return false;
  }
  return true;
}

export function containsKey(keys: string[], key: string): boolean {
  return indexOf(keys, key) !== -1;
}
