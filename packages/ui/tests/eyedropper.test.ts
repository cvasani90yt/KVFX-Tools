import { describe, expect, it } from "vitest";
import { fitWithin, hexAt, pngComplete } from "../src/ui/eyedropper-core.js";

/** A real 1×1 PNG (an orange pixel), as Base64. */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==";

describe("pngComplete", () => {
  it("accepts a whole PNG", () => {
    expect(pngComplete(PNG_1X1)).toBe(true);
  });

  it("refuses one still being written, or anything that isn't a PNG", () => {
    expect(pngComplete(PNG_1X1.slice(0, 40))).toBe(false);
    expect(pngComplete(PNG_1X1.slice(0, -4))).toBe(false);
    expect(pngComplete(PNG_1X1.slice(0, -1))).toBe(false);
    expect(pngComplete("")).toBe(false);
    expect(pngComplete(btoa("this is not an image, just some text long enough to pass the length test"))).toBe(false);
  });

  it("ignores line breaks some encoders add", () => {
    expect(pngComplete(PNG_1X1.replace(/(.{20})/g, "$1\n"))).toBe(true);
  });
});

describe("hexAt", () => {
  it("reads a pixel out of RGBA data", () => {
    // 2×2: red, green / blue, white.
    const data = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
    expect(hexAt(data, 2, 0, 0)).toBe("#ff0000");
    expect(hexAt(data, 2, 1, 0)).toBe("#00ff00");
    expect(hexAt(data, 2, 0, 1)).toBe("#0000ff");
    expect(hexAt(data, 2, 1, 1)).toBe("#ffffff");
  });
});

describe("fitWithin", () => {
  it("keeps the frame's shape inside the space", () => {
    expect(fitWithin(1920, 1080, 340, 400)).toEqual({ width: 340, height: 191 });
    expect(fitWithin(1080, 1920, 340, 400)).toEqual({ width: 225, height: 400 });
  });
});
