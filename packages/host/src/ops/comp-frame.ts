import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { requireComp } from "./raw.js";

/**
 * Saves the open comp's frame at the playhead as a PNG, for the panel's
 * Pick from comp eyedropper.
 *
 *   { path }  →  { path, width, height, time, background: [r, g, b], bitsPerChannel }
 *
 * `path` is a file in KVFX's own cache folder, chosen by the panel; nothing
 * else may be written. After Effects can return from saving before the file
 * is on disk, so the panel waits for it to appear and stop growing before it
 * reads it. The project doesn't change, so this is a query, not an undo step.
 */

/**
 * Only ever a PNG directly inside a "KVFXTools/cache" folder. The slashes in
 * the character classes are escaped: ExtendScript reads regex literals by
 * ECMAScript 3's grammar, where an unescaped "/" ends the literal even inside
 * [...], and the whole host script then fails to load.
 */
const CACHE_FILE = /[\\\/]KVFXTools[\\\/]cache[\\\/][^\\\/]+\.png$/i;
const DEFAULT_DEPTH = 8;

export const compFrameOperation: Operation = {
  id: "kvfx.op.comp.frame",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const path = ctx.args["path"];
    if (typeof path !== "string" || !CACHE_FILE.test(path)) {
      throw hostError(ErrorCode.InvalidArgument, "path must be a PNG in KVFX's cache folder.");
    }
    if (typeof comp.saveFrameToPng !== "function") {
      throw hostError(ErrorCode.UnsupportedHostVersion, "This version of After Effects can't save a comp frame.");
    }
    comp.saveFrameToPng(comp.time, ctx.env.file(path));
    const project = ctx.env.rawProject();
    const bg = comp.bgColor;
    return {
      path: path,
      width: comp.width,
      height: comp.height,
      time: comp.time,
      background: bg ? [bg[0], bg[1], bg[2]] : [0, 0, 0],
      bitsPerChannel: project && typeof project.bitsPerChannel === "number" ? project.bitsPerChannel : DEFAULT_DEPTH,
    };
  },
};
