import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { type Args, layerById, requireComp, skipped, targets } from "./raw.js";

/**
 * Footage housekeeping and audio: find and relink missing files, read a
 * layer's loudness over time, and cut layers down to the parts worth keeping.
 */

// ---------------------------------------------------------------------------
// Missing footage
// ---------------------------------------------------------------------------

const MAX_LISTED = 2000;

function missingPath(item: AeRawItem): string {
  if (item.file && item.file.fsName) return item.file.fsName;
  return typeof item.missingFootagePath === "string" ? item.missingFootagePath : "";
}

/** Lists footage After Effects cannot find. Read-only. */
export const listMissingOperation: Operation = {
  id: "kvfx.op.project.missing",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const project = ctx.env.rawProject();
    if (!project) throw hostError(ErrorCode.PreconditionFailed, "Open a project first.");
    const items: HostJson[] = [];
    for (let i = 1; i <= project.numItems && items.length < MAX_LISTED; i += 1) {
      const item = project.item(i);
      if (item.footageMissing !== true) continue;
      const path = missingPath(item);
      const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      const file = slash >= 0 ? path.slice(slash + 1) : path;
      items[items.length] = { id: item.id, name: item.name, path: path, file: file || item.name };
    }
    return { items: items as unknown as HostJson };
  },
};

/**
 * Points missing footage items at files the user confirmed. Nothing on disk
 * is touched; an item that is no longer missing, or a file that is not
 * there, is skipped with a reason.
 */
export const relinkOperation: Operation = {
  id: "kvfx.op.project.relink",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const project = ctx.env.rawProject();
    if (!project) throw hostError(ErrorCode.PreconditionFailed, "Open a project first.");
    const raw = ctx.args["items"];
    if (!isArray(raw)) throw hostError(ErrorCode.InvalidArgument, "items must be an array.");
    const list = raw as HostJson[];

    const byId: { [id: string]: AeRawItem } = {};
    for (let i = 1; i <= project.numItems; i += 1) byId[String(project.item(i).id)] = project.item(i);

    let changed = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i] as Args;
      const id = entry ? entry["id"] : undefined;
      const path = entry ? entry["path"] : undefined;
      if (typeof id !== "number" || typeof path !== "string") continue;
      const item = byId[String(id)];
      if (!item) {
        skips[skips.length] = { id: id, reason: "Item no longer exists" };
        continue;
      }
      if (item.footageMissing !== true || typeof item.replace !== "function") {
        skips[skips.length] = { id: id, name: item.name, reason: "Not missing any more" };
        continue;
      }
      if (!ctx.env.fileExists(path)) {
        skips[skips.length] = { id: id, name: item.name, reason: "File not found" };
        continue;
      }
      item.replace(ctx.env.file(path));
      changed += 1;
    }
    return { changedCount: changed, skipped: skips as unknown as HostJson };
  },
};

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

const AMPLITUDE_COMMAND = "Convert Audio to Keyframes";
const MAX_SAMPLES = 120000;
const SAMPLE_DECIMALS = 100;
const BOTH_CHANNELS_INDEX = 3;

/** The "Both Channels" slider After Effects puts on its Audio Amplitude layer. */
function bothChannels(layer: AeRawLayer): AeRawProp | null {
  const effects = layer.property("ADBE Effect Parade");
  if (!effects) return null;
  for (let i = 1; i <= effects.numProperties; i += 1) {
    const effect = effects.property(i);
    if (effect && /both/i.test(effect.name)) return effect.property(1);
  }
  // Localised names: the third channel slider is "both".
  const third = effects.property(BOTH_CHANNELS_INDEX);
  return third ? third.property(1) : null;
}

/**
 * Reads one layer's loudness, a value per frame, using After Effects' own
 * Convert Audio to Keyframes. Its temporary Audio Amplitude layer, the work
 * area and the selection are all put back as they were before returning, so
 * the project ends unchanged.
 */
export const analyseAudioOperation: Operation = {
  id: "kvfx.op.audio.analyse",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const id = ctx.args["id"];
    const layer = typeof id === "number" ? layerById(comp, id) : undefined;
    if (!layer) throw hostError(ErrorCode.TargetNotFound, "The audio layer no longer exists.");
    if (layer.hasAudio === false) throw hostError(ErrorCode.PreconditionFailed, "That layer has no audio.");

    const selected = comp.selectedLayers;
    const workStart = comp.workAreaStart;
    const workDuration = comp.workAreaDuration;
    const before = comp.numLayers;
    const start = Math.max(0, layer.inPoint);
    const end = Math.min(comp.duration, layer.outPoint);
    if (!(end > start)) throw hostError(ErrorCode.PreconditionFailed, "That layer is not in the composition's time.");

    for (let i = 0; i < selected.length; i += 1) (selected[i] as { selected: boolean }).selected = false;
    (layer as { selected: boolean }).selected = true;
    comp.workAreaStart = start;
    comp.workAreaDuration = end - start;

    let samples: number[] = [];
    let error = "";
    try {
      if (!ctx.env.runMenuCommand(AMPLITUDE_COMMAND)) {
        error = "Convert Audio to Keyframes could not be found in this language of After Effects.";
      } else if (comp.numLayers > before) {
        const amplitude = comp.layer(1);
        const slider = bothChannels(amplitude);
        if (slider) {
          const count = Math.min(slider.numKeys, MAX_SAMPLES);
          for (let k = 1; k <= count; k += 1) {
            samples[samples.length] = Math.round((slider.keyValue(k) as number) * SAMPLE_DECIMALS) / SAMPLE_DECIMALS;
          }
        }
        amplitude.remove();
      }
    } finally {
      comp.workAreaStart = workStart;
      comp.workAreaDuration = workDuration;
      (layer as { selected: boolean }).selected = false;
      for (let i = 0; i < selected.length; i += 1) (selected[i] as { selected: boolean }).selected = true;
    }
    if (error) throw hostError(ErrorCode.PreconditionFailed, error);
    if (samples.length === 0) samples = [];
    return { id: layer.id, name: layer.name, start: start, frameDuration: comp.frameDuration, samples: samples as unknown as HostJson };
  },
};

interface Range {
  readonly start: number;
  readonly end: number;
}

function readRanges(raw: HostJson | undefined): Range[] {
  if (!isArray(raw)) throw hostError(ErrorCode.InvalidArgument, "keep must be an array of ranges.");
  const list = raw as HostJson[];
  const out: Range[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i] as Args;
    const start = entry ? entry["start"] : undefined;
    const end = entry ? entry["end"] : undefined;
    if (typeof start === "number" && typeof end === "number" && end > start) out[out.length] = { start: start, end: end };
  }
  out.sort(function (a: Range, b: Range): number {
    return a.start - b.start;
  });
  return out;
}

/**
 * Cuts layers down to the given time ranges.
 *
 * Each layer keeps its first range itself — it is trimmed, never deleted —
 * and gets a duplicate per further range. With `close`, every piece slides
 * earlier by the time removed before it, so the gaps close up and every
 * layer cut with the same ranges stays in sync.
 */
export const cutRangesOperation: Operation = {
  id: "kvfx.op.layer.cutRanges",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const keep = readRanges(ctx.args["keep"]);
    if (keep.length === 0) throw hostError(ErrorCode.PreconditionFailed, "There is nothing to keep.");
    const close = ctx.args["close"] === true;

    // Time removed before each range, measured from the first range's start.
    const shifts: number[] = [];
    let removed = 0;
    for (let r = 0; r < keep.length; r += 1) {
      if (r > 0) removed += (keep[r] as Range).start - (keep[r - 1] as Range).end;
      shifts[r] = removed;
    }

    let changed = 0;
    let pieces = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const inPoint = layer.inPoint;
      const outPoint = layer.outPoint;
      const parts: { range: Range; shift: number }[] = [];
      for (let r = 0; r < keep.length; r += 1) {
        const range = keep[r] as Range;
        const start = Math.max(range.start, inPoint);
        const end = Math.min(range.end, outPoint);
        if (end > start) parts[parts.length] = { range: { start: start, end: end }, shift: close ? (shifts[r] as number) : 0 };
      }
      if (parts.length === 0) {
        skips[skips.length] = skipped(layer, "Nothing to keep inside this layer");
        continue;
      }
      // Duplicates first, from the original's untouched state.
      for (let p = 1; p < parts.length; p += 1) {
        const part = parts[p] as { range: Range; shift: number };
        const copy = layer.duplicate();
        copy.inPoint = part.range.start;
        copy.outPoint = part.range.end;
        if (part.shift !== 0) copy.startTime = copy.startTime - part.shift;
        pieces += 1;
      }
      const first = parts[0] as { range: Range; shift: number };
      layer.inPoint = first.range.start;
      layer.outPoint = first.range.end;
      if (first.shift !== 0) layer.startTime = layer.startTime - first.shift;
      changed += 1;
    }
    return { changedCount: changed, pieceCount: pieces + changed, skipped: skips as unknown as HostJson, missingIds: resolved.missing as unknown as HostJson };
  },
};

/** Adds layer markers — at silences, beats, or anything else a plan has found. */
export const addMarkersOperation: Operation = {
  id: "kvfx.op.layer.markers",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const raw = ctx.args["markers"];
    if (!isArray(raw)) throw hostError(ErrorCode.InvalidArgument, "markers must be an array.");
    const list = raw as HostJson[];
    let added = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const markers = layer.property("ADBE Marker");
      if (!markers) continue;
      for (let m = 0; m < list.length; m += 1) {
        const spec = list[m] as Args;
        if (!spec || typeof spec["time"] !== "number") continue;
        const comment = typeof spec["comment"] === "string" ? spec["comment"] : "";
        const duration = typeof spec["duration"] === "number" ? spec["duration"] : 0;
        markers.setValueAtTime(spec["time"], ctx.env.newMarker(comment, duration));
        added += 1;
      }
    }
    return { markerCount: added, skipped: skips as unknown as HostJson, missingIds: resolved.missing as unknown as HostJson };
  },
};

export const mediaOperations: Operation[] = [
  listMissingOperation,
  relinkOperation,
  analyseAudioOperation,
  cutRangesOperation,
  addMarkersOperation,
];
