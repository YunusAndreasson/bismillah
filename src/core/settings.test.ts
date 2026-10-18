import { describe, expect, it } from "vitest";
import { when } from "./copy.ts";
import { clampLineHeight, clampScale, DEFAULTS, fromSnapshot } from "./settings.svelte.ts";

describe("settings from Rust", () => {
  it("takes validated values and falls back for anything unexpected", () => {
    const s = fromSnapshot({
      theme: "dark",
      text_scale: 1.2,
      line_height: null,
      fade_chrome: false,
      measure: 3,
      unknown_key: "ignored",
    });
    expect(s.theme).toBe("dark");
    expect(s.text_scale).toBe(1.2);
    expect(s.line_height).toBeNull();
    expect(s.fade_chrome).toBe(false);
    expect(s.measure).toBe(DEFAULTS.measure);
    expect(fromSnapshot({ line_height: 1.9 }).line_height).toBe(1.9);
  });

  it("keeps sizes inside their ranges without float noise", () => {
    expect(clampScale(1 + 0.1 + 0.1)).toBe(1.2);
    expect(clampScale(9)).toBe(3);
    expect(clampScale(0.1)).toBe(0.5);
    expect(clampLineHeight(1.6 + 0.1)).toBe(1.7);
    expect(clampLineHeight(0)).toBe(1.2);
  });
});

describe("times in notices", () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  it("says only the time today, and yesterday or the date otherwise", () => {
    const today = new Date(2026, 9, 18, 14, 32).getTime();
    expect(when(today, now)).not.toMatch(/yesterday|October/);
    expect(when(new Date(2026, 9, 17, 9, 5).getTime(), now)).toMatch(/^yesterday /);
    expect(when(new Date(2026, 9, 12, 9, 5).getTime(), now)).toMatch(/12/);
  });
});
