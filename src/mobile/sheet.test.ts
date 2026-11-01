import { describe, expect, it } from "vitest";
import { arrived, arrivedAt, matching, next, pathParts, type Row } from "./sheet.ts";

const row = (id: string, section: Row["section"], label: string): Row => ({
  id,
  section,
  label,
  run: () => undefined,
});

const rows = [
  row("a", "Texts", "سَلَام.md"),
  row("b", "Texts", "al-Ṭabarī notes.md"),
  row("c", "Commands", "Show the sample"),
  row("d", "Settings", "Theme: System"),
  row("e", "Settings", "Text size: Medium"),
];

describe("the sheet's list", () => {
  it("keeps every row, in order, with no query", () => {
    expect(matching(rows, "  ").map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("finds Arabic without its marks, and Latin without its diacritics", () => {
    expect(matching(rows, "سلام").map((r) => r.id)).toEqual(["a"]);
    expect(matching(rows, "tabari").map((r) => r.id)).toEqual(["b"]);
  });

  it("needs every word, and keeps sections in order", () => {
    expect(matching(rows, "text medium").map((r) => r.id)).toEqual(["e"]);
    expect(matching(rows, "s").map((r) => r.section)).toEqual(
      [...matching(rows, "s").map((r) => r.section)].sort(
        (x, y) =>
          ["Texts", "Commands", "Settings"].indexOf(x) -
          ["Texts", "Commands", "Settings"].indexOf(y),
      ),
    );
  });

  it("finds nothing rather than something near", () => {
    expect(matching(rows, "zzz")).toEqual([]);
  });

  it("steps through a setting's values and wraps", () => {
    expect(next(["a", "b", "c"], "a")).toBe("b");
    expect(next(["a", "b", "c"], "c")).toBe("a");
  });

  it("keeps the open text's versions after the texts, wherever they match", () => {
    const list = [
      row("c", "Commands", "two"),
      row("v", "Versions", "two"),
      row("t", "Texts", "two"),
    ];
    expect(matching(list, "two").map((r) => r.id)).toEqual(["t", "v", "c"]);
  });

  it("splits a path into its folder and file, and leaves odd names whole", () => {
    expect(pathParts("a/b/نص.md")).toEqual({ folder: "a/b", file: "نص.md" });
    expect(pathParts("one.md")).toEqual({ folder: "", file: "one.md" });
    expect(pathParts("/one.md")).toEqual({ folder: "", file: "/one.md" });
    expect(pathParts("odd/")).toEqual({ folder: "", file: "odd/" });
  });

  it("says when a date is unknown, and tells two prints in a day apart", () => {
    expect(arrivedAt(null)).toBe("Date unknown");
    expect(arrivedAt(Date.UTC(2026, 9, 31, 12))).toMatch(/31 Oct 2026/);
    expect(arrivedAt(Date.UTC(2026, 9, 31, 12))).not.toBe(arrivedAt(Date.UTC(2026, 9, 31, 13)));
  });

  it("shows a date only when it knows one", () => {
    expect(arrived(null)).toBe("");
    expect(arrived(0)).toBe("");
    expect(arrived(Date.UTC(2026, 9, 31, 12))).toBe("31 Oct 2026");
  });
});
