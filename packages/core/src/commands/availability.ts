import { satisfiesMinimum } from "../util/version.js";
import { AVAILABLE, type CommandAvailability, type CommandContext, type CommandMetadata, unavailable } from "./types.js";

/**
 * The standard availability check, derived from a command's metadata.
 *
 * Centralised so that every command phrases the same refusal the same way, and
 * so that "select at least one layer" is written once rather than fifty times
 * with fifty slightly different wordings.
 */
export function standardAvailability(
  metadata: CommandMetadata,
  ctx: CommandContext,
): CommandAvailability {
  if (!ctx.snapshot.hasProject) {
    return unavailable("Open a project first.");
  }

  if (metadata.aeMin !== undefined && !satisfiesMinimum(ctx.aeVersion, metadata.aeMin)) {
    return unavailable(`Needs After Effects ${metadata.aeMin} or newer.`);
  }

  if (metadata.requiresComp && ctx.snapshot.comp === undefined) {
    return unavailable("Open a composition first.");
  }

  const selected = ctx.snapshot.layers.length;
  if (selected < metadata.minLayers) {
    if (metadata.minLayers === 1) return unavailable("Select a layer first.");
    return unavailable(`Select at least ${String(metadata.minLayers)} layers.`);
  }

  return AVAILABLE;
}
