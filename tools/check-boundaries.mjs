import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { repoRoot } from "../scripts/paths.mjs";
import { stripLiterals } from "./strip-source.mjs";

/**
 * Enforces the dependency direction from docs/FOLDER-STRUCTURE.md.
 *
 *   core    → nothing
 *   bridge  → core
 *   host    → nothing (tests may use core/bridge to pin the contract)
 *   ui      → core, bridge
 *
 * These are not style rules. `@kvfx/core` having no host dependency is the
 * reason most of the product can be unit-tested without After Effects, and
 * `@kvfx/host` importing nothing is what keeps the ES5 bundle free of ES2021
 * output. Left to convention, both erode within a month.
 */

const ALLOWED = {
  core: new Set(),
  bridge: new Set(["@kvfx/core"]),
  host: new Set(),
  ui: new Set(["@kvfx/core", "@kvfx/bridge"]),
};

/** Modules that must never appear in `core` — it is pure logic by contract. */
const FORBIDDEN_IN_CORE = [/^node:/, /^fs$/, /^path$/, /^os$/, /^child_process$/];

const IMPORT_RE = /(?:^|\s)(?:import|export)\s[^;]*?from\s*"([^"]+)"|(?:^|\s)import\s*\(\s*"([^"]+)"/g;

async function* sourceFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-types") continue;
      yield* sourceFiles(full);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

const failures = [];
let checked = 0;

for (const pkg of Object.keys(ALLOWED)) {
  const srcDir = join(repoRoot, "packages", pkg, "src");
  for await (const file of sourceFiles(srcDir)) {
    checked += 1;
    const source = await readFile(file, "utf8");
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of stripped.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;

      const isRelative = specifier.startsWith(".");
      const where = relative(repoRoot, file);

      if (pkg === "core" && FORBIDDEN_IN_CORE.some((re) => re.test(specifier))) {
        failures.push(`  ${where} imports "${specifier}" — core must stay free of platform APIs`);
        continue;
      }
      if (isRelative) continue;
      if (!ALLOWED[pkg].has(specifier)) {
        failures.push(
          `  ${where} imports "${specifier}" — @kvfx/${pkg} may only import: ` +
            (ALLOWED[pkg].size === 0 ? "(nothing)" : [...ALLOWED[pkg]].join(", ")),
        );
      }
    }
  }
}

// `stripLiterals` is imported so this file fails loudly if the shared helper is
// removed, keeping the guards' dependencies visible.
void stripLiterals;

if (failures.length > 0) {
  console.error("Dependency boundary check FAILED:\n" + failures.join("\n"));
  process.exit(1);
}

console.log(`Dependency boundaries passed (${String(checked)} source files).`);
