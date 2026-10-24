import { describe, expect, it } from "vitest";
import { DoubleShift, WINDOW_MS, type KeyMoment } from "./doubleShift.ts";

type Step = [type: "down" | "up", code: string, time: number, extra?: Partial<KeyMoment>];

/** Feeds the steps in order and returns the indexes at which the gesture completed. */
function fired(steps: (Step | "click")[]): number[] {
  const detector = new DoubleShift();
  const out: number[] = [];
  steps.forEach((step, i) => {
    if (step === "click") {
      detector.interrupt();
      return;
    }
    const [type, code, time, extra] = step;
    const moment: KeyMoment = {
      type: type === "down" ? "keydown" : "keyup",
      code,
      time,
      repeat: false,
      isComposing: false,
      modified: false,
      ...extra,
    };
    if (detector.feed(moment)) out.push(i);
  });
  return out;
}

const tap = (code: string, at: number): Step[] => [
  ["down", code, at],
  ["up", code, at + 60],
];

describe("Shift Shift", () => {
  it("fires on two clean taps, with either Shift", () => {
    expect(fired([...tap("ShiftLeft", 0), ...tap("ShiftLeft", 150)])).toEqual([3]);
    expect(fired([...tap("ShiftLeft", 0), ...tap("ShiftRight", 150)])).toEqual([3]);
  });

  it("doesn't fire while typing capitals", () => {
    expect(
      fired([
        ["down", "ShiftLeft", 0],
        ["down", "KeyA", 40],
        ["up", "KeyA", 80],
        ["up", "ShiftLeft", 100],
        ["down", "ShiftLeft", 200],
        ["down", "KeyB", 240],
        ["up", "KeyB", 280],
        ["up", "ShiftLeft", 300],
      ]),
    ).toEqual([]);
  });

  it("doesn't fire when another key comes between the taps", () => {
    expect(
      fired([
        ...tap("ShiftLeft", 0),
        ["down", "KeyA", 100],
        ["up", "KeyA", 120],
        ...tap("ShiftLeft", 150),
      ]),
    ).toEqual([]);
  });

  it("doesn't fire when the taps are too far apart", () => {
    expect(fired([...tap("ShiftLeft", 0), ...tap("ShiftLeft", 60 + WINDOW_MS + 1)])).toEqual([]);
  });

  it("doesn't count a held Shift as a tap", () => {
    expect(
      fired([
        ["down", "ShiftLeft", 0],
        ["down", "ShiftLeft", 500, { repeat: true }],
        ["up", "ShiftLeft", 600],
        ...tap("ShiftLeft", 700),
      ]),
    ).toEqual([]);
    expect(
      fired([
        ["down", "ShiftLeft", 0],
        ["up", "ShiftLeft", WINDOW_MS + 1],
        ...tap("ShiftLeft", 500),
      ]),
    ).toEqual([]);
  });

  it("doesn't fire on both Shifts pressed together (a layout switch)", () => {
    expect(
      fired([
        ["down", "ShiftLeft", 0],
        ["down", "ShiftRight", 20],
        ["up", "ShiftRight", 60],
        ["up", "ShiftLeft", 80],
        ["down", "ShiftLeft", 150],
        ["down", "ShiftRight", 170],
        ["up", "ShiftRight", 210],
        ["up", "ShiftLeft", 230],
      ]),
    ).toEqual([]);
  });

  it("doesn't fire with Ctrl, Alt or Super held (Alt+Shift switches layouts)", () => {
    const alt = { modified: true };
    expect(
      fired([
        ["down", "AltLeft", 0],
        ["down", "ShiftLeft", 20, alt],
        ["up", "ShiftLeft", 60, alt],
        ["down", "ShiftLeft", 150, alt],
        ["up", "ShiftLeft", 200, alt],
        ["up", "AltLeft", 260],
      ]),
    ).toEqual([]);
    // A layout switch, then one lone tap, isn't the gesture either.
    expect(
      fired([
        ["down", "AltLeft", 0],
        ["down", "ShiftLeft", 20, alt],
        ["up", "ShiftLeft", 60, alt],
        ["up", "AltLeft", 80],
        ...tap("ShiftLeft", 150),
      ]),
    ).toEqual([]);
  });

  it("doesn't fire on two Shift+clicks", () => {
    expect(
      fired([
        ["down", "ShiftLeft", 0],
        "click",
        ["up", "ShiftLeft", 150],
        ["down", "ShiftLeft", 250],
        "click",
        ["up", "ShiftLeft", 380],
      ]),
    ).toEqual([]);
  });

  it("starts clean after both Shifts, released in either order", () => {
    for (const [first, second] of [
      ["ShiftRight", "ShiftLeft"],
      ["ShiftLeft", "ShiftRight"],
    ] as const) {
      expect(
        fired([
          ["down", "ShiftLeft", 0],
          ["down", "ShiftRight", 20],
          ["up", first, 60],
          ["up", second, 80],
          ...tap("ShiftLeft", 1000),
          ...tap("ShiftLeft", 1150),
        ]),
      ).toEqual([7]);
    }
  });

  it("starts clean after a Shift released with Alt held", () => {
    expect(
      fired([
        ["down", "ShiftLeft", 0],
        ["down", "AltLeft", 20],
        ["up", "ShiftLeft", 60, { modified: true }],
        ["up", "AltLeft", 80],
        ...tap("ShiftLeft", 1000),
        ...tap("ShiftLeft", 1150),
      ]),
    ).toEqual([7]);
  });

  it("ignores keys inside an input method's composition", () => {
    expect(
      fired([
        ["down", "ShiftLeft", 0, { isComposing: true }],
        ["up", "ShiftLeft", 60, { isComposing: true }],
        ...tap("ShiftLeft", 150),
      ]),
    ).toEqual([]);
  });

  it("starts again after firing: a third tap alone doesn't fire", () => {
    expect(
      fired([...tap("ShiftLeft", 0), ...tap("ShiftLeft", 150), ...tap("ShiftLeft", 300)]),
    ).toEqual([3]);
  });
});
