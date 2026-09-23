import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { repoRoot } from "../scripts/paths.mjs";

/**
 * Fails the build on absolute path literals.
 *
 * The product ships on Windows and macOS, and a path that works on the machine
 * it was written on is the classic way to break the other platform without
 * noticing. All path resolution goes through `scripts/paths.mjs` (tooling) or
 * the platform-safe resolver in the product (ARCHITECTURE §10), so those are the
 * only files exempt.
 *
 * The drive-letter rule requires a quote, whitespace or line start before it and
 * a path character after the separator. A looser rule also matches ordinary
 * prose such as "cannot parse:\n", and a guard that cries wolf is a guard
 * someone switches off.
 */

const BANNED = [
  [/(?:^|["'`\s(=])[A-Za-z]:\\{1,2}[A-Za-z0-9_$.-]/, "Windows drive-letter path"],
  [/\/Users\/[A-Za-z0-9_.-]/, "macOS home path"],
  [/\/home\/[A-Za-z0-9_.-]/, "Linux home path"],
  [/%APPDATA%/, "raw %APPDATA% reference"],
  [/~\/Library\//, "raw ~/Library path"],
];

const EXEMPT = new Set([join("scripts", "paths.mjs"), join("tools", "check-hardcoded-paths.mjs")]);

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-types", ".git", "build", "coverage"]);
const SKIP_FILES = new Set(["package-lock.json"]);

async function* candidates(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* candidates(full);
    else if (/\.(ts|mjs|js|css|json)$/.test(entry.name)) yield full;
  }
}

const failures = [];
let checked = 0;

for await (const file of candidates(repoRoot)) {
  const where = relative(repoRoot, file);
  if (EXEMPT.has(where)) continue;
  checked += 1;
  const lines = (await readFile(file, "utf8")).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const [pattern, label] of BANNED) {
      if (pattern.test(lines[i])) failures.push(`  ${where}:${String(i + 1)} — ${label}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    "Hard-coded path check FAILED:\n" +
      failures.join("\n") +
      "\n\nResolve paths through scripts/paths.mjs instead.",
  );
  process.exit(1);
}

console.log(`Hard-coded path check passed (${String(checked)} files).`);
