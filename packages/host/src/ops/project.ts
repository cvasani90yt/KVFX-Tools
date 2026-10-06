import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { requireComp, skipped, targets } from "./raw.js";

/**
 * Project-level operations for the Library and Media tabs.
 *
 * Paths always come from a file the user picked, dropped or pasted. They are
 * still checked here — extension allow-list, existence — because the host is
 * the last place a malformed request can be stopped before After Effects acts
 * on it. Nothing here runs scripts: `.jsx` and `.jsxbin` are not importable.
 */

const IMPORTABLE: { [ext: string]: boolean } = {
  aep: true, aepx: true,
  png: true, jpg: true, jpeg: true, gif: true, tif: true, tiff: true, psd: true, ai: true,
  eps: true, pdf: true, bmp: true, tga: true, exr: true, svg: true, webp: true, heic: true,
  mov: true, mp4: true, m4v: true, avi: true, mxf: true, mkv: true, webm: true,
  mp3: true, wav: true, aif: true, aiff: true, m4a: true,
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/") > path.lastIndexOf("\\") ? path.lastIndexOf("/") : path.lastIndexOf("\\");
  return dot > slash ? path.substring(dot + 1).toLowerCase() : "";
}

function requirePath(ctx: OperationContext): string {
  const path = ctx.args["path"];
  if (typeof path !== "string" || path.length === 0) throw hostError(ErrorCode.InvalidArgument, "path is required.");
  if (!ctx.env.fileExists(path)) throw hostError(ErrorCode.TargetNotFound, "That file no longer exists.");
  return path;
}

/** Whether the project is saved, and where — the Media tab saves pastes beside it. */
export const projectInfoOperation: Operation = {
  id: "kvfx.op.project.info",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const project = ctx.env.rawProject();
    if (!project) return { open: false, saved: false, folder: null };
    const file = project.file;
    if (!file) return { open: true, saved: false, folder: null };
    const full = file.fsName;
    const cut = full.lastIndexOf("/") > full.lastIndexOf("\\") ? full.lastIndexOf("/") : full.lastIndexOf("\\");
    return { open: true, saved: true, folder: cut > 0 ? full.substring(0, cut) : null };
  },
};

/**
 * Imports a file. With `addToComp`, footage is also placed at the top of the
 * active composition; projects (.aep) are only imported, never placed.
 */
export const importFileOperation: Operation = {
  id: "kvfx.op.project.import",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const path = requirePath(ctx);
    const ext = extensionOf(path);
    if (!IMPORTABLE[ext]) throw hostError(ErrorCode.InvalidArgument, "KVFX Tools does not import ." + ext + " files.");

    const item = ctx.env.importFile(path);
    let layerId: number | null = null;
    if (ctx.args["addToComp"] === true && ext !== "aep" && ext !== "aepx") {
      const comp = ctx.env.rawComp();
      if (comp) layerId = comp.layers.add(item).id;
    }
    return { itemId: item.id, name: item.name, layerId: layerId };
  },
};

/** Applies a saved animation preset (.ffx) to each target layer. */
export const applyPresetOperation: Operation = {
  id: "kvfx.op.layer.applyPreset",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const path = requirePath(ctx);
    if (extensionOf(path) !== "ffx") throw hostError(ErrorCode.InvalidArgument, "Only .ffx presets can be applied.");
    const resolved = targets(comp, ctx.args);

    let changed = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      if (typeof layer.applyPreset !== "function") {
        skips[skips.length] = skipped(layer, "This layer type cannot take a preset");
        continue;
      }
      ctx.env.applyPreset(layer, path);
      changed += 1;
    }
    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

export const projectOperations: Operation[] = [projectInfoOperation, importFileOperation, applyPresetOperation];
