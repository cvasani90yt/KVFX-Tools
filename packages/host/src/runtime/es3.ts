/**
 * ES3-safe helpers.
 *
 * ExtendScript is ECMAScript 3rd Edition (F10): `Object.keys`, `Array.isArray`,
 * `Array.prototype.indexOf/forEach/map`, `String.prototype.trim`, `JSON` and
 * `Function.prototype.bind` are all absent.
 *
 * We deliberately do **not** ship prototype polyfills. Every script running in
 * After Effects shares one global scope, and adding enumerable properties to
 * `Array.prototype` or `Object.prototype` would corrupt `for...in` loops in
 * other vendors' scripts — a genuinely destructive side effect for something
 * that is only our own convenience. Internal helpers cost nothing and harm
 * nobody.
 *
 * `tools/es3-guard.mjs` fails the build if the compiled bundle uses an ES5
 * library method instead of one of these.
 */

export function keysOf(value: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out[out.length] = key;
    }
  }
  return out;
}

export function isArray(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Array]";
}

export function indexOf(list: string[], needle: string): number {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === needle) return i;
  }
  return -1;
}

/** Milliseconds since the epoch. `Date.now` is ES5. */
export function nowMs(): number {
  return new Date().getTime();
}

/** Left-pads with "0" to `width`. `String.prototype.padStart` is ES2017. */
export function padZero(value: string, width: number): string {
  let out = value;
  while (out.length < width) out = `0${out}`;
  return out;
}
