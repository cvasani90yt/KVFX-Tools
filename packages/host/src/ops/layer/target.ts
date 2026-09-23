import type { AeCompHandle, AeLayerHandle } from "../../ae/environment.js";
import type { HostJson } from "../../runtime/serialize.js";

/**
 * Resolves which layers an operation acts on.
 *
 * `"selection"` is read from After Effects *now*, not from the panel's
 * snapshot. That is the mechanism behind ADR-0002: the panel's view of the
 * selection can be stale by the time the user clicks, and acting on a stale
 * list would modify the wrong layers. Nothing else in the design prevents that.
 */

export type TargetKind = "selection" | "all" | "ids";

export interface ResolvedTarget {
  readonly layers: AeLayerHandle[];
  /** Ids that were requested but no longer exist — reported, never ignored. */
  readonly missing: number[];
}

export function parseTargetKind(raw: HostJson | undefined): TargetKind | undefined {
  if (raw === "selection" || raw === "all" || raw === "ids") return raw;
  return undefined;
}

export function resolveTarget(
  comp: AeCompHandle,
  kind: TargetKind,
  ids: number[],
): ResolvedTarget {
  if (kind === "selection") return { layers: comp.selectedLayers(), missing: [] };
  if (kind === "all") return { layers: comp.allLayers(), missing: [] };

  // Explicit ids: resolve against the live comp and report anything gone.
  const all = comp.allLayers();
  const found: AeLayerHandle[] = [];
  const missing: number[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    const wanted = ids[i];
    let match: AeLayerHandle | undefined;
    for (let a = 0; a < all.length; a += 1) {
      const candidate = all[a];
      if (candidate && candidate.id() === wanted) {
        match = candidate;
        break;
      }
    }
    if (match) found[found.length] = match;
    else if (typeof wanted === "number") missing[missing.length] = wanted;
  }

  return { layers: found, missing: missing };
}

export function readIds(raw: HostJson | undefined): number[] {
  if (!raw || typeof raw !== "object") return [];
  const list = raw as HostJson[];
  const out: number[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const value = list[i];
    if (typeof value === "number") out[out.length] = value;
  }
  return out;
}
