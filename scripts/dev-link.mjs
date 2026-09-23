import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import {
  EXTENSION_BUNDLE_ID,
  UnsupportedPlatformError,
  cepExtensionsDir,
  stagedExtensionDir,
} from "./paths.mjs";

/**
 * Links the staged extension into the per-user CEP extensions directory so
 * After Effects loads the dev build directly.
 *
 * A symlink rather than a copy: rebuilding then refreshes the panel without
 * re-running this, which is the difference between a tight loop and a tedious
 * one. On Windows a symlink needs either Developer Mode or an elevated shell —
 * the error below says so rather than failing cryptically.
 */

let extensionsDir;
try {
  extensionsDir = cepExtensionsDir();
} catch (cause) {
  if (cause instanceof UnsupportedPlatformError) {
    console.error(cause.message);
    process.exit(1);
  }
  throw cause;
}

const linkPath = join(extensionsDir, EXTENSION_BUNDLE_ID);

await mkdir(extensionsDir, { recursive: true });

let existing;
try {
  existing = await lstat(linkPath);
} catch {
  existing = undefined;
}

if (existing !== undefined) {
  if (existing.isSymbolicLink()) {
    const target = await readlink(linkPath);
    if (target === stagedExtensionDir) {
      console.log(`Already linked: ${linkPath}`);
      process.exit(0);
    }
    await rm(linkPath, { force: true });
  } else {
    // A real directory here is almost certainly an installed release. Removing
    // it would silently uninstall the user's copy, so we stop and let them
    // decide (ARCHITECTURE §7 — never overwrite what we did not create).
    console.error(
      `Refusing to replace ${linkPath}: it is a real directory, not a link.\n` +
        "That is most likely an installed copy of KVFX Tools. Remove or rename it yourself, then re-run.",
    );
    process.exit(1);
  }
}

try {
  await symlink(stagedExtensionDir, linkPath, "junction");
} catch (cause) {
  if (platform() === "win32" && cause.code === "EPERM") {
    console.error(
      "Could not create the link. On Windows, enable Developer Mode (Settings ▸ System ▸ For developers)\n" +
        "or run this command from an elevated terminal, then try again.",
    );
    process.exit(1);
  }
  throw cause;
}

console.log(`Linked ${linkPath}\n     -> ${stagedExtensionDir}`);
console.log("\nIn After Effects: Window ▸ Extensions ▸ KVFX Tools");
console.log("If the panel is missing, CEP debug mode is not enabled — see INSTALL.md.");
