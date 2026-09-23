import type { HostJson } from "./serialize.js";

/**
 * Errors operations raise deliberately.
 *
 * A real `Error` rather than a plain object, so the throw site behaves like a
 * throw site everywhere — including under lint rules and in ExtendScript, whose
 * `Error` carries the `message` and `line` the dispatcher reports. The
 * `kvfxCode` property is what lets an anticipated failure keep its specific
 * error code instead of collapsing into a generic host exception the panel
 * cannot explain (ARCHITECTURE §11).
 *
 * A class extending `Error` is avoided on purpose: downlevelled to ES5 the
 * prototype chain does not survive reliably, and ExtendScript is unforgiving
 * about it.
 */
export interface CodedHostError extends Error {
  kvfxCode: string;
}

export function hostError(code: string, message: string): CodedHostError {
  const error = new Error(message) as CodedHostError;
  error.kvfxCode = code;
  return error;
}

/**
 * Describes an untrusted value for an error message.
 *
 * `String(value)` on an object yields "[object Object]", which tells a user
 * nothing and a developer less.
 */
export function labelOf(value: HostJson | undefined): string {
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value;
}
