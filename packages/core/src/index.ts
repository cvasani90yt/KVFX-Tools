/**
 * @kvfx/core — pure logic, no host dependency.
 *
 * This package must not import After Effects APIs, the DOM, Node built-ins or
 * CEP APIs. That constraint is what makes the majority of the product testable
 * without After Effects present, and it is enforced by
 * `tools/check-boundaries.mjs` rather than by convention.
 */

export * from "./types/product.js";
export * from "./types/result.js";
export * from "./types/errors.js";
export * from "./types/json.js";
export * from "./util/version.js";
export * from "./commands/index.js";
export * from "./search/index.js";
export * from "./storage/index.js";
export * from "./input/index.js";
export * from "./geometry/index.js";
