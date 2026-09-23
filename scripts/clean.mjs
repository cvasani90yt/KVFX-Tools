import { rm } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

/** Removes build output. Never touches node_modules or anything user-owned. */
const targets = [
  join(repoRoot, "build"),
  join(repoRoot, "packages", "core", "dist"),
  join(repoRoot, "packages", "bridge", "dist"),
  join(repoRoot, "packages", "host", "dist"),
  join(repoRoot, "packages", "ui", "dist"),
  join(repoRoot, "packages", "ui", "dist-types"),
  join(repoRoot, "tsconfig.tsbuildinfo"),
];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}
console.log(`Cleaned ${String(targets.length)} build locations.`);
