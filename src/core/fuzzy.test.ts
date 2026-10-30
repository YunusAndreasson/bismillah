import { describe, expect, it } from "vitest";
import {
  commandTier,
  countFiles,
  fileTier,
  fold,
  rankCommands,
  rankFiles,
  score,
} from "./fuzzy.ts";

const files = [
  { path: "notes.md", name: "notes.md" },
  { path: "essays/notes.md", name: "notes.md" },
  { path: "essays/ḥadīth and ʿilm.md", name: "ḥadīth and ʿilm.md" },
  { path: "رسائل/سَلَامٌ عَلَيْكُمْ.md", name: "سَلَامٌ عَلَيْكُمْ.md" },
  { path: "letters/to Hasan.md", name: "to Hasan.md" },
  { path: "letters/2026/new year.md", name: "new year.md" },
];
const paths = (list: { path: string }[]) => list.map((f) => f.path);

/** Exhaustive ranking oracle: score every candidate and sort the entire result.
 * Production keeps only the best page; both must return exactly the same order. */
function exhaustive(query: string, candidates: typeof files, recent: string[], limit: number) {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  const recency = new Map(recent.map((path, i) => [path, i]));
  const rank = (file: (typeof files)[number]) => recency.get(file.path) ?? Infinity;
  return candidates
    .map((file, index) => {
      let total = 0;
      for (const word of words) {
        const name = score(word, fold(file.name));
        const path = score(word, fold(file.path));
        if (name === null && path === null) return { file, index, total: -Infinity };
        total += Math.max((name ?? -Infinity) * 2, path ?? -Infinity);
      }
      return { file, index, total };
    })
    .filter((entry) => entry.total > -Infinity)
    .sort((a, b) =>
      words.length === 0
        ? rank(a.file) - rank(b.file) || a.index - b.index
        : b.total - a.total ||
          rank(a.file) - rank(b.file) ||
          a.file.path.length - b.file.path.length ||
          a.file.path.localeCompare(b.file.path) ||
          a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.file);
}

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
  it("returns the exhaustive ranking's exact page across queries, ties and limits", () => {
    const names = ["notes", "ḥadīth", "سَلَامٌ", "chapter", "nōtes", "ʿilm", "chapter 1"];
    const candidates = Array.from({ length: 800 }, (_, i) => {
      const name = `${names[i % names.length] ?? ""} ${i % 11}.md`;
      return { name, path: `Part ${i % 23}/Draft ${i}/${name}` };
    });
    const recent = [candidates[799]?.path ?? "", "missing.md", candidates[45]?.path ?? ""];
    for (const query of [
      "",
      "  ",
      "n",
      "note",
      "part",
      "ch 1",
      "slm",
      "سلام",
      "hadith",
      "ilm",
      "zzzz",
    ]) {
      for (const limit of [0, 1, 2, 50, 1000]) {
        expect(paths(rankFiles(query, candidates, recent, limit)), `${query}; ${limit}`).toEqual(
          paths(exhaustive(query, candidates, recent, limit)),
        );
      }
    }
  });

  it("invalidates folded keys when a candidate changes, including name-only changes", () => {
    const candidate = { name: "ḥadīth.md", path: "notes/ḥadīth.md" };
    expect(rankFiles("hadith", [candidate], [])).toEqual([candidate]);
    candidate.name = "سَلَام.md";
    candidate.path = "letters/سَلَام.md";
    expect(rankFiles("hadith", [candidate], [])).toEqual([]);
    expect(rankFiles("سلام", [candidate], [])).toEqual([candidate]);
    candidate.name = "ʿilm.md";
    expect(rankFiles("ilm", [candidate], [])).toEqual([candidate]);
  });

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

describe("match tiers, which compare files with commands and settings", () => {
  it("ranks a start over a word's start over the middle over scattered letters", () => {
    const file = { path: "essays/to Hasan.md", name: "to Hasan.md" };
    expect(fileTier("to", file)).toBe(3);
    expect(fileTier("hasan", file)).toBe(2);
    expect(fileTier("asan", file)).toBe(1);
    expect(fileTier("thn", file)).toBe(0);
    expect(fileTier("xyz", file)).toBe(null);
    // Every word must match; the worst one counts.
    expect(fileTier("to asan", file)).toBe(1);
    expect(commandTier("dark", { label: "Theme", aliases: ["dark"] })).toBe(3);
    expect(commandTier("ḥadīth", { label: "Hadith notes" })).toBe(3);
  });

  it("counts the files that match at a tier or better", () => {
    expect(countFiles("notes", files)).toBe(2);
    expect(countFiles("nts", files, 1)).toBe(0);
    expect(countFiles("nts", files, 0)).toBe(2);
  });
});
