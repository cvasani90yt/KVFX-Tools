import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against TypeScript sources, not built output, so `npm test`
    // never depends on build ordering and a failure points at a source line.
    alias: {
      "@kvfx/core": src("core"),
      "@kvfx/bridge": src("bridge"),
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
