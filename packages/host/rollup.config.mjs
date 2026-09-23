import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bundles the ES5 output of `tsc` into one IIFE that ExtendScript can read.
//
// The split matters: rollup does not downlevel syntax, it only concatenates and
// renames, so every ES5 construct in the bundle came from tsc and nothing in
// rollup's own glue can reintroduce ES6. `tools/es3-guard.mjs` verifies that
// claim against the finished artefact rather than trusting it.

const rootPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
);

export default {
  input: "dist/entry.js",
  output: {
    file: "dist/bundle/kvfx-host.jsx",
    format: "iife",
    // ExtendScript has no strict mode; emitting the directive would be noise.
    strict: false,
    banner:
      "/*\n" +
      " * KVFX Tools — After Effects host bundle\n" +
      " * Generated artefact. Do not edit; edit packages/host/src and rebuild.\n" +
      " */",
    // Stamps the build version the ping operation reports back to the panel.
    intro: `var __KVFX_HOST_VERSION__ = ${JSON.stringify(rootPackage.version)};`,
  },
  treeshake: { moduleSideEffects: true },
};
