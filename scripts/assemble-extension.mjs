import { cp, mkdir, rm, writeFile, readFile, access } from "node:fs/promises";
import { basename, join } from "node:path";
import { repoRoot, stagedExtensionDir } from "./paths.mjs";

/**
 * Assembles the loadable CEP extension from the per-package build output.
 *
 * Layout produced (this is exactly what After Effects loads):
 *
 *   com.kvfx.tools/
 *     CSXS/manifest.xml
 *     .debug                (development builds only)
 *     index.html + assets/  (from @kvfx/ui)
 *     host/kvfx-host.jsx    (from @kvfx/host)
 */

const isRelease = process.argv.includes("--release");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function requireBuilt(path, hint) {
  if (!(await exists(path))) {
    throw new Error(`Missing build output: ${path}\nRun \`${hint}\` first.`);
  }
}

const uiDist = join(repoRoot, "packages", "ui", "dist");
const hostBundle = join(repoRoot, "packages", "host", "dist", "bundle", "kvfx-host.jsx");

await requireBuilt(uiDist, "npm run build:ui");
await requireBuilt(hostBundle, "npm run build:host");

await rm(stagedExtensionDir, { recursive: true, force: true });
await mkdir(join(stagedExtensionDir, "CSXS"), { recursive: true });
await mkdir(join(stagedExtensionDir, "host"), { recursive: true });

await cp(uiDist, stagedExtensionDir, { recursive: true });
await cp(hostBundle, join(stagedExtensionDir, "host", "kvfx-host.jsx"));

// Keep the manifest's bundle version in step with the workspace version so a
// packaged build can never claim a version it was not built from.
const { version } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const manifest = (await readFile(join(repoRoot, "cep", "CSXS", "manifest.xml"), "utf8")).replaceAll(
  /(ExtensionBundleVersion|Version)="0\.1\.0"/g,
  `$1="${version.replace(/-.*$/, "")}"`,
);
await writeFile(join(stagedExtensionDir, "CSXS", "manifest.xml"), manifest, "utf8");

const iconsDir = join(repoRoot, "cep", "icons");
if (await exists(iconsDir)) {
  await cp(iconsDir, join(stagedExtensionDir, "icons"), {
    recursive: true,
    // Keep repository housekeeping files out of the shipped bundle.
    filter: (src) => !basename(src).startsWith("."),
  });
}

if (isRelease) {
  // Remote debugging must never ship: it opens a local port into the panel.
  console.log("Release build — omitting .debug");
} else {
  await cp(join(repoRoot, "cep", ".debug"), join(stagedExtensionDir, ".debug"));
}

console.log(`Assembled extension at ${stagedExtensionDir}`);
