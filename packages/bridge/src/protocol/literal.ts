import { ProtocolError } from "./envelope.js";
import type { JsonValue } from "./json.js";

/**
 * Serialises a JSON value to an ExtendScript *source literal*.
 *
 * Why this exists instead of a JSON parser on the host: `evalScript` hands the
 * host a string of ExtendScript source, and ExtendScript has no dependable
 * `JSON` object (F10). The alternatives were to hand-write a JSON parser in ES3
 * — a large, subtle, security-relevant piece of code — or to emit the request as
 * a literal the interpreter already knows how to read. We do the latter.
 *
 * That makes this function a security boundary: everything it emits is
 * evaluated as code by the host. It is therefore deliberately strict —
 *
 *   - only JSON types are accepted; functions, `undefined`, symbols, dates,
 *     class instances and sparse arrays are rejected rather than coerced,
 *   - every string is escaped to pure 7-bit ASCII, so no character can close a
 *     literal early and no encoding mismatch between the panel and the host can
 *     change the meaning of the source,
 *   - object keys are emitted as quoted strings, so a key can never become an
 *     identifier or a reserved word,
 *   - depth and cycles are bounded, so a malformed value cannot blow the stack.
 *
 * `tests/literal.test.ts` covers the escape vectors directly. Treat any change
 * here as security-relevant.
 */

const MAX_DEPTH = 32;

const CHAR_QUOTE = 0x22;
const CHAR_BACKSLASH = 0x5c;
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;
const HEX_RADIX = 16;
const UNICODE_ESCAPE_DIGITS = 4;

/** Characters we allow through unescaped: printable ASCII minus `"` and `\`. */
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
      // Everything else — control characters, line/paragraph separators and all
      // non-ASCII — becomes an explicit escape. ExtendScript reads \uXXXX, and
      // the emitted source stays pure ASCII regardless of how the host decodes
      // the byte stream.
      out += `\\u${code.toString(HEX_RADIX).padStart(UNICODE_ESCAPE_DIGITS, "0")}`;
    }
  }
  return `${out}"`;
}

function serialise(value: JsonValue, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) {
    throw new ProtocolError("invalid_argument", `Value nested deeper than ${String(MAX_DEPTH)} levels`);
  }

  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return escapeString(value);

    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isFinite(value)) {
        // NaN and Infinity have no literal form that survives the round trip.
        throw new ProtocolError("invalid_argument", `Non-finite number: ${String(value)}`);
      }
      return String(value);

    case "object":
      break;

    default:
      throw new ProtocolError("invalid_argument", `Unsupported value type: ${typeof value}`);
  }

  const asObject = value as unknown as object;
  if (seen.has(asObject)) {
    throw new ProtocolError("invalid_argument", "Value contains a cycle");
  }
  seen.add(asObject);

  let out: string;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) {
        throw new ProtocolError("invalid_argument", "Sparse arrays are not supported");
      }
      parts.push(serialise(value[i] as JsonValue, depth + 1, seen));
    }
    out = `[${parts.join(",")}]`;
  } else {
    const record = value as Record<string, JsonValue>;
    if (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) {
      throw new ProtocolError("invalid_argument", "Only plain objects may cross the bridge");
    }
    const parts: string[] = [];
    for (const key of Object.keys(record)) {
      const entry = record[key];
      if (entry === undefined) {
        // `{ a: undefined }` is a mistake on our side, not a value to drop
        // silently — dropping it would change the request shape invisibly.
        throw new ProtocolError("invalid_argument", `Property "${key}" is undefined`);
      }
      parts.push(`${escapeString(key)}:${serialise(entry, depth + 1, seen)}`);
    }
    out = `{${parts.join(",")}}`;
  }

  seen.delete(asObject);
  return out;
}

export function toExtendScriptLiteral(value: JsonValue): string {
  return serialise(value, 0, new Set<object>());
}
