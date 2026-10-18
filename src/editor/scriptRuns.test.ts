import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { arabicRuns } from "./scriptRuns.ts";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../tests/fixtures/quran", name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");

describe("arabicRuns", () => {
  it("joins the words of an Arabic phrase into one run, spaces included", () => {
    const text = "The word أمانة means trust, and زهد is";
    expect(arabicRuns(text).map((r) => text.slice(r.from, r.to))).toEqual(["أمانة", "زهد"]);
  });

  it("keeps diacritics inside the run", () => {
    const text = "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ";
    expect(arabicRuns(text)).toEqual([
      { from: 0, to: text.length, quranic: false, vocalised: true },
    ]);
  });

  it("tells vocalised runs from bare ones", () => {
    expect(arabicRuns("نصٌّ بلا تشكيل").map((r) => r.vocalised)).toEqual([true]);
    expect(arabicRuns("الكتابة رحلة هادئة").map((r) => r.vocalised)).toEqual([false]);
  });

  it("splits at Latin digits", () => {
    const text = "سُجِّلت 1234 كلمة";
    expect(arabicRuns(text).length).toBe(2);
  });

  it("marks runs with Qur'anic annotation marks or alef wasla", () => {
    expect(arabicRuns("ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ")[0]?.quranic).toBe(true);
    expect(arabicRuns("نصٌّ بلا تشكيل")[0]?.quranic).toBe(false);
  });

  it("recognises pasted Uthmani verses by alef wasla or annotation marks", () => {
    const verses = new Map(
      fixture("tanzil-uthmani.txt")
        .filter((line) => /^\d+\|\d+\|/.test(line))
        .map((line) => [line.split("|").slice(0, 2).join(":"), line.split("|")[2] ?? ""]),
    );
    const quranic = (key: string) => arabicRuns(verses.get(key) ?? "").some((r) => r.quranic);
    expect(quranic("1:1")).toBe(true); // alef wasla only
    expect(quranic("2:2")).toBe(true); // annotation mark U+06DB
    expect(quranic("2:26")).toBe(true); // rub el hizb U+06DE
    // Standard vocalisation only: set as ordinary Arabic, which renders it correctly.
    expect(quranic("1:5")).toBe(false);
  });
});
