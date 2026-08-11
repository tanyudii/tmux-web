import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_SIZE, nextZoomFontSize } from "./zoom";

describe("nextZoomFontSize", () => {
  it("increments the font size on + or =", () => {
    expect(nextZoomFontSize("+", 14)).toBe(15);
    expect(nextZoomFontSize("=", 14)).toBe(15);
  });

  it("decrements the font size on -", () => {
    expect(nextZoomFontSize("-", 14)).toBe(13);
  });

  it("resets to the default size on 0", () => {
    expect(nextZoomFontSize("0", 30)).toBe(DEFAULT_FONT_SIZE);
  });

  it("clamps at the maximum font size", () => {
    expect(nextZoomFontSize("+", 32)).toBe(32);
  });

  it("clamps at the minimum font size", () => {
    expect(nextZoomFontSize("-", 8)).toBe(8);
  });

  it("returns null for keys that are not a zoom shortcut", () => {
    expect(nextZoomFontSize("a", 14)).toBeNull();
  });
});
