/**
 * Re-exported from `@kvfx/core` so that commands (which live in core and cannot
 * import this package) and the wire protocol share one definition of what may
 * cross a boundary.
 */
export type { JsonObject, JsonPrimitive, JsonValue } from "@kvfx/core";
