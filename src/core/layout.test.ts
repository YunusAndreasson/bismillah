import { describe, expect, it } from "vitest";
import { LIBRARY_RESERVE, libraryLayout } from "./layout.ts";

describe("library layout (DESIGN.md §7)", () => {
  const column = 960;

  it("overlays below about 900px, and whenever the column wouldn't fit beside it", () => {
    expect(libraryLayout(640, 400).mode).toBe("overlay");
    expect(libraryLayout(899, 300).mode).toBe("overlay");
    expect(libraryLayout(column + LIBRARY_RESERVE - 1, column).mode).toBe("overlay");
  });

  it("docks and keeps the column centred when the margin holds the library", () => {
    expect(libraryLayout(1920, column)).toEqual({ mode: "docked", offset: 0 });
    expect(libraryLayout(column + 2 * LIBRARY_RESERVE, column)).toEqual({
      mode: "docked",
      offset: 0,
    });
  });

  it("moves the column just far enough to clear the library in between", () => {
    const width = 1280;
    const { mode, offset } = libraryLayout(width, column);
    expect(mode).toBe("docked");
    // The column starts where the library and its gap end, and still fits.
    const start = offset + (width - offset - column) / 2;
    expect(start).toBe(LIBRARY_RESERVE);
    expect(start + column).toBeLessThanOrEqual(width);
  });

  it("changes smoothly with the window width", () => {
    let last = libraryLayout(column + LIBRARY_RESERVE, column).offset;
    for (let w = column + LIBRARY_RESERVE + 1; w < 2000; w++) {
      const { offset } = libraryLayout(w, column);
      expect(Math.abs(offset - last)).toBeLessThanOrEqual(2);
      last = offset;
    }
  });
});
