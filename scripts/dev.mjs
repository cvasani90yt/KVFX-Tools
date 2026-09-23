import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

/**
 * Development loop.
 *
 * Runs an initial full build, then keeps three watchers alive and re-assembles
 * the extension whenever either half changes. The assemble step is debounced
 * because a single save fires several filesystem events, and re-assembling
 * mid-write would leave After Effects loading a half-copied panel.
 */

const children = [];

function run(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = (line) => `[${label}] ${line}`;
  child.stdout.on("data", (d) => process.stdout.write(String(d).replace(/^/gm, prefix(""))));
  child.stderr.on("data", (d) => process.stderr.write(String(d).replace(/^/gm, prefix(""))));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(prefix(`exited with code ${String(code)}`));
  });
  children.push(child);
  return child;
}

function runToCompletion(command, args, cwd, label) {
  return new Promise((resolve, reject) => {
    const child = run(command, args, cwd, label);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed`))));
  });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

console.log("Building once before watching…");
await runToCompletion(npm, ["run", "build"], repoRoot, "build");

const uiDir = join(repoRoot, "packages", "ui");
const hostDir = join(repoRoot, "packages", "host");

run(npm, ["run", "dev"], uiDir, "ui");
run("npx", ["tsc", "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], hostDir, "host:tsc");
run("npx", ["rollup", "-c", "rollup.config.mjs", "--watch"], hostDir, "host:bundle");

let timer;
function scheduleAssemble() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    run("node", [join(repoRoot, "scripts", "assemble-extension.mjs")], repoRoot, "assemble");
  }, 400);
}

for (const dir of [join(uiDir, "dist"), join(hostDir, "dist", "bundle")]) {
  if (existsSync(dir)) watch(dir, { recursive: true }, scheduleAssemble);
}

console.log("\nWatching. Reopen the KVFX Tools panel in After Effects to pick up changes.");
console.log("Press Ctrl+C to stop.\n");

function shutdown() {
  for (const child of children) child.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
