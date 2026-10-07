import { Buffer } from "node:buffer";
import { cp, mkdir, rm, writeFile, readFile, access, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { repoRoot, stagedExtensionDir } from "./paths.mjs";
import { createZip } from "./zip.mjs";

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

await cp(uiDist, stagedExtensionDir, {
  recursive: true,
  // Vite copies everything in public/ to the bundle root, including repository
  // housekeeping files.
  filter: (src) => !basename(src).startsWith("."),
});
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

// ---------------------------------------------------------------------------
// The download a tester or user receives:
//
//   KVFX Tools <version>/
//     READ ME FIRST.txt
//     Install KVFX Tools (Windows).cmd      Install KVFX Tools (macOS).command
//     Uninstall KVFX Tools (Windows).cmd    Uninstall KVFX Tools (macOS).command
//     com.kvfx.tools/                       the extension itself
//
// Source maps stay out of it: they are for development, not for users.
// ---------------------------------------------------------------------------

// The read-me is a template beside the installers, so the paths it quotes for
// users live in a text file rather than in code.
const README = (await readFile(join(repoRoot, "scripts", "setup", "READ-ME-FIRST.txt"), "utf8"))
  .replaceAll("{{VERSION}}", version)
  .replace(/\r?\n/g, "\r\n");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield { full, isDir: true };
      yield* walk(full);
    } else {
      yield { full, isDir: false };
    }
  }
}

const top = `KVFX Tools ${version}/`;
const entries = [{ name: top }, { name: `${top}READ ME FIRST.txt`, data: Buffer.from(README, "utf8") }];
const setup = join(repoRoot, "scripts", "setup");
for (const [file, name, executable] of [
  [join(setup, "windows", "install-kvfx-tools.cmd"), "Install KVFX Tools (Windows).cmd", false],
  [join(setup, "windows", "uninstall-kvfx-tools.cmd"), "Uninstall KVFX Tools (Windows).cmd", false],
  [join(setup, "macos", "install-kvfx-tools.command"), "Install KVFX Tools (macOS).command", true],
  [join(setup, "macos", "uninstall-kvfx-tools.command"), "Uninstall KVFX Tools (macOS).command", true],
]) {
  entries.push({ name: `${top}${name}`, data: await readFile(file), executable });
}

const extensionRoot = `${top}${basename(stagedExtensionDir)}/`;
entries.push({ name: extensionRoot });
for await (const item of walk(stagedExtensionDir)) {
  if (item.full.endsWith(".map")) continue;
  const path = relative(stagedExtensionDir, item.full).split(/[\\/]/).join("/");
  entries.push(item.isDir ? { name: `${extensionRoot}${path}/` } : { name: `${extensionRoot}${path}`, data: await readFile(item.full) });
}

const zipPath = join(repoRoot, "build", `KVFX-Tools-v${version}.zip`);
await writeFile(zipPath, createZip(entries));
console.log(`Packaged ${zipPath}`);
