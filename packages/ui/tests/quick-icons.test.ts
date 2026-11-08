import { describe, expect, it } from "vitest";
import { QUICK_TOOLS } from "@kvfx/core";
import { hasIcon } from "../src/components/icons.js";

describe("Quick tab tiles", () => {
  it("each have an icon that exists, so no tile is blank", () => {
    for (const tool of QUICK_TOOLS) expect(hasIcon(tool.icon), `${tool.id} → ${tool.icon}`).toBe(true);
    expect(hasIcon("tab-quick")).toBe(true);
    expect(hasIcon("edit")).toBe(true);
  });
});
