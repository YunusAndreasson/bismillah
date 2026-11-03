import { describe, expect, it } from "vitest";
import { rgb } from "./nativeWindow.ts";

describe("macOS window cues", () => {
  it("reads the page's computed colour for the window behind it", () => {
    expect(rgb("rgb(247, 246, 242)")).toEqual([247, 246, 242]);
    expect(rgb("rgba(21, 21, 21, 1)")).toEqual([21, 21, 21]);
    expect(rgb("transparent")).toBeNull();
  });
});
