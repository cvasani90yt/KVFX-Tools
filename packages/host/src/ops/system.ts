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

export const systemOperations: Operation[] = [pingOperation];
