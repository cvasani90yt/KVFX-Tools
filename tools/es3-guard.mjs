import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tokenizer } from "acorn";
import { repoRoot } from "../scripts/paths.mjs";
import { findLines, stripLiterals } from "./strip-source.mjs";

/**
 * Verifies that the shipped After Effects host bundle is readable by
 * ExtendScript.
 *
 * ExtendScript is ECMAScript 3rd Edition (F10). A single arrow function or
 * `const` in this artefact makes the whole bundle fail to parse, which takes
 * the panel down with no usable error — and neither `tsc` nor `rollup` will
 * tell us, because both consider the output perfectly valid JavaScript. So we
 * check the finished artefact rather than trusting the pipeline that produced
 * it.
 *
 * `target: ES5` is deprecated in TypeScript 6 and scheduled for removal in
 * TypeScript 7 (BUILD.md, "Known limitations"). When that lands, this guard is
 * what will catch the regression on day one.
 */

const BANNED_SYNTAX = [
  [/=>/, "arrow function"],
  [/\b(?:const|let)\s/, "block-scoped declaration (const/let)"],
  [/\bclass\s+[A-Za-z_$]/, "class declaration"],
  [/\bfor\s*\([^;)]*\bof\b/, "for-of loop"],
  [/\.\.\./, "spread or rest"],
  [/`/, "template literal"],
  [/\bfunction\s*\*/, "generator"],
  [/\basync\s+function\b/, "async function"],
  [/\bawait\s/, "await"],
  [/\byield\s/, "yield"],
  [/\?\./, "optional chaining"],
  [/\?\?/, "nullish coalescing"],
  [/\bSymbol\b/, "Symbol"],
  [/\bPromise\b/, "Promise"],
  [/\{\s*[A-Za-z_$][\w$]*\s*(?:,|\})\s*=/, "destructuring assignment"],
];

/**
 * ES5 library methods ExtendScript does not provide. We supply internal helpers
 * in `runtime/es3.ts` instead of polyfilling prototypes, because every script in
 * After Effects shares one global scope.
 */
const BANNED_LIBRARY = [
  [/\bObject\.keys\b/, "Object.keys — use keysOf()"],
  [/\bObject\.assign\b/, "Object.assign"],
  [/\bObject\.defineProperty\b/, "Object.defineProperty"],
  [/\bArray\.isArray\b/, "Array.isArray — use isArray()"],
  [/\bJSON\./, "JSON — use runtime/serialize.ts"],
  [/\bDate\.now\b/, "Date.now — use nowMs()"],
  [/\.forEach\s*\(/, "Array.prototype.forEach"],
  [/\.(?:map|filter|some|every|reduce|reduceRight|find|findIndex)\s*\(/, "ES5+ array iteration method — use a for loop"],
  [/\.includes\s*\(/, "includes — use indexOf on strings, a loop on arrays"],
  [/\.trim\s*\(\s*\)/, "String.prototype.trim"],
  [/\.bind\s*\(/, "Function.prototype.bind"],
  [/\.padStart\s*\(/, "String.prototype.padStart — use padZero()"],
  [/\bMap\s*\(/, "Map"],
  [/\bSet\s*\(/, "Set"],
];

const bundlePath = join(repoRoot, "packages", "host", "dist", "bundle", "kvfx-host.jsx");

try {
  await access(bundlePath);
} catch {
  console.error(`ES3 guard: host bundle not found at ${bundlePath}\nRun \`npm run build:host\` first.`);
  process.exit(1);
}

const raw = await readFile(bundlePath, "utf8");
const source = stripLiterals(raw);

const failures = [];

/**
 * Regex literals, read by a real tokenizer. Stripping literals (above) hides
 * them from the syntax scan, but ExtendScript reads them by ECMAScript 3's
 * grammar, which differs from today's in ways that break the whole bundle:
 * an unescaped "/" inside a character class ends the literal there (ES5 made
 * [...] contain it), and the engine knows only the g, i and m flags, with no
 * lookbehind or named groups.
 */
function slashInClass(pattern) {
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
    } else if (inClass) {
      if (ch === "]") inClass = false;
      else if (ch === "/") return true;
    } else if (ch === "[") {
      inClass = true;
    }
  }
  return false;
}

const regexProblems = [];
for (const token of tokenizer(raw, { ecmaVersion: 5, locations: true })) {
  if (token.type.label !== "regexp") continue;
  const { pattern, flags } = token.value;
  const where = `line ${String(token.loc.start.line)}: /${pattern}/${flags}`;
  if (slashInClass(pattern)) regexProblems.push(`  unescaped "/" inside a regex character class (write \\/) at ${where}`);
  if (/[^gim]/.test(flags)) regexProblems.push(`  regex flag ExtendScript lacks at ${where}`);
  if (/\(\?<[=!]/.test(pattern)) regexProblems.push(`  regex lookbehind at ${where}`);
  if (/\(\?<[A-Za-z]/.test(pattern)) regexProblems.push(`  named regex group at ${where}`);
}
failures.push(...regexProblems);
for (const [pattern, label] of [...BANNED_SYNTAX, ...BANNED_LIBRARY]) {
  const lines = findLines(source, pattern);
  if (lines.length > 0) {
    failures.push(`  ${label} at line${lines.length > 1 ? "s" : ""} ${lines.slice(0, 8).join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error(
    `ES3 guard FAILED for ${bundlePath}\n` +
      "The host bundle contains constructs ExtendScript cannot parse:\n" +
      failures.join("\n") +
      "\n\nThis bundle would break the panel in After Effects. Fix the source in packages/host/src.",
  );
  process.exit(1);
}

console.log(`ES3 guard passed (${String(raw.split("\n").length)} lines checked).`);
