import { describe, expect, it } from "vitest";
import { lineDirection } from "./bidi.ts";
import { stateOf } from "./testing.ts";

function dirs(doc: string) {
  const state = stateOf(doc);
  const out = [];
  for (let n = 1; n <= state.doc.lines; n++) out.push(lineDirection(state, state.doc.line(n)));
  return out;
}

describe("lineDirection", () => {
  it("uses the first strong character after Markdown marks", () => {
    expect(dirs("### عنوانٌ عربي\n- عنصرٌ\n> اقتباسٌ\n# Title")).toEqual([
      "rtl",
      "rtl",
      "rtl",
      "ltr",
    ]);
  });

  it("ignores inline code, URLs and link destinations when deciding", () => {
    expect(
      dirs("`notes.md` في مجلدٍ\n\n[الصفحة](https://example.com) inside\n\nhttps://x.y نص"),
    ).toEqual(["rtl", null, "rtl", null, "rtl"]);
  });

  it("gives every line of a paragraph the paragraph's direction", () => {
    expect(dirs("نصٌّ عربي\nEnglish continues here")).toEqual(["rtl", "rtl"]);
  });

  it("treats code and frontmatter as left-to-right", () => {
    expect(dirs("---\nlang: ar\n---\n```\nنص\n```")).toEqual([
      "ltr",
      "ltr",
      "ltr",
      "ltr",
      "ltr",
      "ltr",
    ]);
  });

  it("returns null for lines without strong text", () => {
    expect(dirs("1234\n\n---")).toEqual([null, null, null]);
  });
});
