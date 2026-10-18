import { describe, expect, it } from "vitest";
import { countWords, readingMinutes } from "./wordCount.ts";

describe("word count", () => {
  it("counts words in Latin, Arabic and transliterated text", () => {
    expect(countWords("The pen and what they write.")).toBe(6);
    expect(countWords("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ")).toBe(4);
    expect(countWords("ʿilm al-ḥadīth wa-l-fiqh")).toBeGreaterThanOrEqual(3);
  });

  it("ignores Markdown marks, frontmatter and URLs", () => {
    const doc = [
      "---",
      "title: Not counted",
      "tags: [a, b]",
      "---",
      "# Heading here",
      "",
      "A [link](https://example.com/path) and <https://example.org> or www.example.net.",
    ].join("\n");
    expect(countWords(doc)).toBe(6);
  });

  it("counts nothing in an empty document", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("---\ntitle: x\n---\n")).toBe(0);
  });

  it("estimates reading time in whole minutes", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(1150)).toBe(5);
  });
});
