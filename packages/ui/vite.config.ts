import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (pkg: string): string =>
  fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  // CEP loads the panel from a file:// URL, so every asset reference must be
  // relative. An absolute base silently produces a blank panel.
  base: "./",
  resolve: {
    alias: {
      "@kvfx/core": src("core"),
      "@kvfx/bridge": src("bridge"),
    },
  },
  build: {
    // The CEP 12 engine is Chromium 99 (F3). This is the whole ballgame:
    // anything newer parses in a modern browser and fails inside After Effects.
    target: "chrome99",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Inlining keeps the packaged extension to a handful of files and avoids
    // file:// fetch quirks for small chunks.
    assetsInlineLimit: 4096,
  },
});
