import type { AeCompHandle, AeLayerHandle, LayerGeometry } from "../../ae/environment.js";
import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { isArray } from "../../runtime/es3.js";
import { parseTargetKind, readIds, resolveTarget } from "./target.js";

/**
 * Reading and writing layer geometry.
 *
 * Alignment is a two-step command (measure, then apply) rather than a single
 * plan, because the maths needs real numbers out of After Effects before it can
 * decide anything. Keeping the maths in `@kvfx/core` rather than duplicating it
 * in ExtendScript is worth the extra round trip: the transform composition is
 * the part most likely to be subtly wrong, and in core it is covered by tests
 * that run without a host.
 *
 * The apply step addresses layers by id and carries explicit values, so a
 * selection change between the two steps cannot misplace anything (ADR-0004).
 */

const MAX_ANCESTOR_DEPTH = 32;

function describe(layer: AeLayerHandle, geometry: LayerGeometry): HostJson {
  const record: { [key: string]: HostJson } = {
    id: layer.id(),
    name: layer.name(),
    sourceRect: {
      left: geometry.sourceRect.left,
      top: geometry.sourceRect.top,
      width: geometry.sourceRect.width,
      height: geometry.sourceRect.height,
    },
    anchorPoint: { x: geometry.anchorPoint.x, y: geometry.anchorPoint.y },
    position: { x: geometry.position.x, y: geometry.position.y },
    scale: { x: geometry.scale.x, y: geometry.scale.y },
    rotation: geometry.rotation,
    threeD: geometry.threeD,
    isAV: geometry.isAV,
    parentId: geometry.parentId === undefined ? null : geometry.parentId,
  };
  if (geometry.blockedReason) record["blockedReason"] = geometry.blockedReason;
  return record;
}

/**
 * Collects the selected layers plus every ancestor they are parented to.
 *
 * A parent may sit outside the selection but still determines where its child
 * renders, so the chain has to travel with the measurement. Walking upward from
 * the selection costs a handful of lookups; measuring every layer in the
 * composition would make this operation scale with project size for no benefit.
 */
function withAncestors(comp: AeCompHandle, selected: AeLayerHandle[], time: number): {
  entries: HostJson[];
  selectedIds: number[];
} {
  const all = comp.allLayers();
  const byId: { [id: string]: AeLayerHandle } = {};
  for (let i = 0; i < all.length; i += 1) {
    const candidate = all[i];
    if (candidate) byId[String(candidate.id())] = candidate;
  }

  const entries: HostJson[] = [];
  const selectedIds: number[] = [];
  const seen: { [id: string]: boolean } = {};

  function include(layer: AeLayerHandle, depth: number): void {
    const key = String(layer.id());
    if (seen[key] || depth > MAX_ANCESTOR_DEPTH) return;
    seen[key] = true;

    const geometry = layer.geometry(time);
    if (!geometry) return;

    entries[entries.length] = describe(layer, geometry);

    if (geometry.parentId !== undefined) {
      const parent = byId[String(geometry.parentId)];
      if (parent) include(parent, depth + 1);
    }
  }

  for (let i = 0; i < selected.length; i += 1) {
    const layer = selected[i];
    if (!layer) continue;
    selectedIds[selectedIds.length] = layer.id();
    include(layer, 0);
  }

  return { entries, selectedIds };
}

export const measureOperation: Operation = {
  id: "kvfx.op.layer.measure",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const comp = ctx.env.activeComp();
    if (!comp) {
      throw hostError(ErrorCode.PreconditionFailed, "No composition is open.");
    }

    const kind = parseTargetKind(ctx.args["target"]);
    if (!kind) {
      throw hostError(ErrorCode.InvalidArgument, "Missing or invalid target.");
    }

    const resolved = resolveTarget(comp, kind, readIds(ctx.args["ids"]));
    const time = comp.time();
    const collected = withAncestors(comp, resolved.layers, time);

    return {
      comp: { id: comp.id(), width: comp.width(), height: comp.height(), time: time },
      layers: collected.entries as unknown as HostJson,
      selectedIds: collected.selectedIds as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

interface PendingChange {
  readonly layer: AeLayerHandle;
  readonly position: { x: number; y: number } | undefined;
  readonly anchorPoint: { x: number; y: number } | undefined;
}

function readVec2(raw: HostJson | undefined): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== "object" || isArray(raw)) return undefined;
  const bag = raw as { [key: string]: HostJson };
  const x = bag["x"];
  const y = bag["y"];
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (!isFinite(x) || !isFinite(y)) return undefined;
  return { x: x, y: y };
}

export const setTransformOperation: Operation = {
  id: "kvfx.op.layer.setTransform",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = ctx.env.activeComp();
    if (!comp) {
      throw hostError(ErrorCode.PreconditionFailed, "No composition is open.");
    }

    const rawChanges = ctx.args["changes"];
    if (!rawChanges || !isArray(rawChanges)) {
      throw hostError(ErrorCode.InvalidArgument, "changes must be an array.");
    }

    const list = rawChanges as HostJson[];
    const all = comp.allLayers();
    const byId: { [id: string]: AeLayerHandle } = {};
    for (let i = 0; i < all.length; i += 1) {
      const candidate = all[i];
      if (candidate) byId[String(candidate.id())] = candidate;
    }

    const pending: PendingChange[] = [];
    const skipped: HostJson[] = [];
    const missing: number[] = [];
    const time = comp.time();

    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (!entry || typeof entry !== "object" || isArray(entry)) {
        throw hostError(ErrorCode.InvalidArgument, `Change ${String(i)} is not an object.`);
      }

      const bag = entry as { [key: string]: HostJson };
      const id = bag["id"];
      if (typeof id !== "number") {
        throw hostError(ErrorCode.InvalidArgument, `Change ${String(i)} has no layer id.`);
      }

      const layer = byId[String(id)];
      if (!layer) {
        missing[missing.length] = id;
        continue;
      }
      if (layer.getFlag("locked") === true) {
        skipped[skipped.length] = { id: id, name: layer.name(), reason: "Layer is locked" };
        continue;
      }

      const geometry = layer.geometry(time);
      if (geometry && geometry.blockedReason) {
        skipped[skipped.length] = { id: id, name: layer.name(), reason: geometry.blockedReason };
        continue;
      }

      pending[pending.length] = {
        layer: layer,
        position: readVec2(bag["position"]),
        anchorPoint: readVec2(bag["anchorPoint"]),
      };
    }

    // Everything is validated before anything is written, so a malformed change
    // late in the list cannot leave the composition half-modified.
    let changed = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const change = pending[i] as PendingChange;
      if (change.anchorPoint) change.layer.setAnchorPoint(change.anchorPoint);
      if (change.position) change.layer.setPosition(change.position);
      if (change.anchorPoint || change.position) changed += 1;
    }

    return {
      changedCount: changed,
      skipped: skipped as unknown as HostJson,
      missingIds: missing as unknown as HostJson,
    };
  },
};
