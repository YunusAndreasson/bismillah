import { describe, expect, it } from "vitest";
import { fold, rankCommands, rankFiles, score } from "./fuzzy.ts";

const files = [
  { path: "notes.md", name: "notes.md" },
  { path: "essays/notes.md", name: "notes.md" },
  { path: "essays/ḥadīth and ʿilm.md", name: "ḥadīth and ʿilm.md" },
  { path: "رسائل/سَلَامٌ عَلَيْكُمْ.md", name: "سَلَامٌ عَلَيْكُمْ.md" },
  { path: "letters/to Hasan.md", name: "to Hasan.md" },
  { path: "letters/2026/new year.md", name: "new year.md" },
];
const paths = (list: { path: string }[]) => list.map((f) => f.path);

describe("folding for search", () => {
  it("ignores case, Latin diacritics, IJMES ʿ ʾ and Arabic vocalisation", () => {
    expect(fold("Ḥadīth")).toBe("hadith");
    expect(fold("ʿilm")).toBe("ilm");
    expect(fold("Qurʾān")).toBe("quran");
    expect(fold("سَلَامٌ")).toBe("سلام");
    expect(fold("ٱلرَّحْمَٰنِ")).toBe(fold("الرحمن"));
    expect(fold("إسلام")).toBe(fold("اسلام"));
  });
});

describe("matching", () => {
  it("prefers substrings, then word starts, then scattered letters", () => {
    const exact = score("not", "notes.md") ?? 0;
    const middle = score("tes", "notes.md") ?? 0;
    const scattered = score("nts", "notes.md") ?? 0;
    expect(exact).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(scattered);
    expect(score("zz", "notes.md")).toBeNull();
  });

  it("finds files by name or path and lets duplicates be told apart by folder", () => {
    expect(paths(rankFiles("notes", files, []))).toEqual(["notes.md", "essays/notes.md"]);
    expect(paths(rankFiles("essays notes", files, []))[0]).toBe("essays/notes.md");
    expect(paths(rankFiles("hadith", files, []))).toEqual(["essays/ḥadīth and ʿilm.md"]);
    expect(paths(rankFiles("ilm", files, []))).toEqual(["essays/ḥadīth and ʿilm.md"]);
    expect(paths(rankFiles("سلام", files, []))).toEqual(["رسائل/سَلَامٌ عَلَيْكُمْ.md"]);
    expect(paths(rankFiles("2026", files, []))).toEqual(["letters/2026/new year.md"]);
    expect(rankFiles("nothing like it", files, [])).toEqual([]);
  });

  it("lists recent files first when nothing is typed, then library order", () => {
    const recent = ["letters/to Hasan.md", "essays/notes.md"];
    expect(paths(rankFiles("", files, recent))).toEqual([
      "letters/to Hasan.md",
      "essays/notes.md",
      "notes.md",
      "essays/ḥadīth and ʿilm.md",
      "رسائل/سَلَامٌ عَلَيْكُمْ.md",
      "letters/2026/new year.md",
    ]);
    expect(rankFiles("", files, [], 2)).toHaveLength(2);
  });

  it("finds commands by label or alias", () => {
    const commands = [
      { label: "Save now" },
      { label: "Zuhd mode", aliases: ["focus", "distraction-free", "zuhd", "زهد"] },
      { label: "Typewriter scrolling" },
    ];
    const labels = (q: string) => rankCommands(q, commands).map((c) => c.label);
    expect(labels("")).toEqual(["Save now", "Zuhd mode", "Typewriter scrolling"]);
    expect(labels("focus")).toEqual(["Zuhd mode"]);
    expect(labels("زهد")).toEqual(["Zuhd mode"]);
    expect(labels("distraction")).toEqual(["Zuhd mode"]);
    expect(labels("type")[0]).toBe("Typewriter scrolling");
  });
});
