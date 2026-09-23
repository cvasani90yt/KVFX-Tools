import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { repoRoot } from "../scripts/paths.mjs";
import { findLines, stripLiterals } from "./strip-source.mjs";

/**
 * Keeps the panel's CSS inside the Chromium 99 baseline.
 *
 * CEP 12 embeds Chromium 99 (F3). Every feature listed below shipped later, so
 * it renders perfectly in the browser a designer previews in and does nothing
 * at all inside After Effects — the worst kind of bug, because it never fails
 * on the machine where it was written. Each entry records the Chrome version
 * that introduced it, so the list can be pruned honestly if CEP ever moves.
 */

const BANNED = [
  [/:has\s*\(/, ":has()", "Chrome 105"],
  [/@container\b/, "container queries", "Chrome 105"],
  [/\bcolor-mix\s*\(/, "color-mix()", "Chrome 111"],
  [/\boklch\s*\(/, "oklch()", "Chrome 111"],
  [/\boklab\s*\(/, "oklab()", "Chrome 111"],
  [/\bsubgrid\b/, "subgrid", "Chrome 117"],
  [/@layer\b/, "cascade layers", "Chrome 99 — unreliable at exactly 99"],
  [/\btext-wrap\s*:/, "text-wrap", "Chrome 114"],
  [/:is\s*\(/, ":is()", "Chrome 88 — safe, but prefer explicit selectors for clarity"],
  [/\binset\s*:/, "inset shorthand", "Chrome 87 — safe"],
];

/** Only the genuinely unavailable features fail the build. */
const FAILING = new Set([
  ":has()",
  "container queries",
  "color-mix()",
  "oklch()",
  "oklab()",
  "subgrid",
  "cascade layers",
  "text-wrap",
]);

async function* cssFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* cssFiles(full);
    } else if (entry.name.endsWith(".css")) {
      yield full;
    }
  }
}

const failures = [];
let checked = 0;

for await (const file of cssFiles(join(repoRoot, "packages"))) {
  checked += 1;
  const source = stripLiterals(await readFile(file, "utf8"));
  for (const [pattern, label, since] of BANNED) {
    if (!FAILING.has(label)) continue;
    const lines = findLines(source, pattern);
    if (lines.length > 0) {
      failures.push(`  ${relative(repoRoot, file)}:${lines.join(",")} — ${label} (${since})`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    "CSS baseline guard FAILED — the CEP 12 engine is Chromium 99 (F3):\n" +
      failures.join("\n") +
      "\n\nThese render correctly in a modern browser and silently do nothing in After Effects.",
  );
  process.exit(1);
}

console.log(`CSS baseline guard passed (${String(checked)} stylesheet${checked === 1 ? "" : "s"}).`);
