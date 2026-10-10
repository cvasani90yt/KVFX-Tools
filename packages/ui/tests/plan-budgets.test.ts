import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_PLAN_BUDGET_MS } from "@kvfx/bridge";

/**
 * The bridge refuses a plan whose budget is above its ceiling before After
 * Effects ever sees it, and the user only gets "Something went wrong". Silence
 * Remover's Analyse shipped asking for twice the ceiling; this keeps every
 * budget the panel writes as a number within it.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("plan budgets", () => {
  it("no runPlan call asks for more than the bridge allows", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/runPlan\([^;]*?,\s*([\d_]+)\s*\)/g)) {
        const budget = Number((match[1] ?? "").replace(/_/g, ""));
        if (budget > MAX_PLAN_BUDGET_MS) offenders.push(`${file}: ${String(budget)} ms`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
