import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/** Stamped at build time by `scripts/assemble-extension.mjs`. */
declare const __KVFX_HOST_VERSION__: string;

/**
 * Round-trip check and host identification.
 *
 * This is the operation the panel runs at startup: it proves the bridge works
 * end to end and returns everything a diagnostic bundle needs about the host
 * (ARCHITECTURE §11). It reads nothing from the project, so it is safe to call
 * with no composition open and cheap enough to call on every panel load.
 */
export const pingOperation: Operation = {
  id: "kvfx.op.system.ping",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const env = ctx.env;
    return {
      hostBundleVersion: typeof __KVFX_HOST_VERSION__ === "string" ? __KVFX_HOST_VERSION__ : "dev",
      aeVersion: env.version(),
      aeBuild: env.buildName(),
      aeLanguage: env.language(),
      os: env.os(),
      engineVersion: env.engineVersion(),
      hostTimeMs: env.nowMs(),
    };
  },
};

/**
 * Memory After Effects has in use, for the header meter.
 *
 * Unlike a selection scan this is a single property read that does not grow
 * with project size, which is why the panel may refresh it periodically while
 * it is visible — the polling ADR-0002 rejects is polling whose cost scales
 * with the project.
 */
export const memoryOperation: Operation = {
  id: "kvfx.op.system.memory",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    return { bytes: ctx.env.memoryInUse() };
  },
};

/**
 * Purges every cache.
 *
 * Declared non-mutating on purpose: it changes no project data and After
 * Effects cannot undo it, so wrapping it in an undo group would put a no-op
 * entry in Edit ▸ Undo and imply the purge could be reversed.
 */
export const purgeOperation: Operation = {
  id: "kvfx.op.system.purge",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const before = ctx.env.memoryInUse();
    ctx.env.purgeAllCaches();
    return { bytesBefore: before, bytesAfter: ctx.env.memoryInUse() };
  },
};

export const systemOperations: Operation[] = [pingOperation, memoryOperation, purgeOperation];
