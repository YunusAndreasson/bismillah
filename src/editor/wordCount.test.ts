import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { countWords, readingMinutes, WordCounter } from "./wordCount.ts";

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

  it("excludes unclosed and empty frontmatter until prose starts", () => {
    const counter = new WordCounter();
    for (const [text, expected] of [
      ["---\ntitle: Hidden words\nlang: en\n", 0],
      ["---\ntitle: Hidden words\n---\nVisible words.", 2],
      ["---\ntitle: Hidden words\n--- x\nVisible words.", 0],
      ["---\n---\nVisible words.", 2],
      ["--- \ntitle: Hidden words\n... \nكلمات عربية", 2],
    ] as const) {
      expect(countWords(text)).toBe(expected);
      expect(counter.count(text)).toBe(expected);
    }
  });

  it("estimates reading time in whole minutes", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(1150)).toBe(5);
  });
});

describe("word counts after edits", () => {
  it("match whole-document segmentation through metadata, URL and multilingual edits", () => {
    const counter = new WordCounter();
    const documents = [
      readFileSync("docs/specimen.md", "utf8"),
      readFileSync("docs/guide.md", "utf8"),
      '---\ntitle: Hidden words\n---\nA [link](local.md "a\nmultiline title") here.\nبِسْمِ اللَّهِ',
      "---\ntitle: Hidden while unclosed\nA line",
      "one\ntwo\r\nthree\u2028four\u2029five",
      "ไทยภาษา\n日本語\n中文\nالعَرَبِيَّةُ Latin\ncan't rock’n’roll\na\u200db\n👩‍👩‍👧‍👦",
      "same words\nsame words\n\n",
      "",
    ];
    for (const doc of documents) {
      for (const text of [doc, `${doc}\nNew words عَرَبِيَّةٌ`, doc.slice(0, doc.length / 2), doc])
        expect(counter.count(text)).toBe(countWords(text));
    }
  });

  it("segments only new lines and forgets text that has left the current document", () => {
    const counter = new WordCounter();
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      expect(counter.count("One sentence.\nAnother sentence.")).toBe(4);
      segment.mockClear();
      expect(counter.count("One sentence.\nAnother sentence.\nOne sentence.")).toBe(6);
      expect(segment).not.toHaveBeenCalled();
      expect(counter.count("One sentence.\nAnother edited sentence.")).toBe(5);
      expect(segment).toHaveBeenCalledTimes(1);
      counter.count("A different file.");
      segment.mockClear();
      counter.count("One sentence.");
      expect(segment).toHaveBeenCalledTimes(1);
    } finally {
      segment.mockRestore();
    }
  });
});
