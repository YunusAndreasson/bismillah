import { describe, expect, it } from "vitest";
import { syntaxTree } from "@codemirror/language";
import { firstStrongDirection, lineDirection } from "./bidi.ts";
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

  it("skips multiline code and long destinations before the first prose letter", () => {
    const doc = `123 \`English\nالعربية\` [](https://example.test/${"path".repeat(500)}) **عَرَبِيّ**`;
    const state = stateOf(doc);
    expect(firstStrongDirection(state, 0, doc.length)).toBe("rtl");
    expect(firstStrongDirection(state, 0, doc.indexOf("**"))).toBeNull();
  });

  it("keeps the first line's direction throughout a long mixed paragraph", () => {
    const state = stateOf(`العَرَبِيَّةُ first\n${"English with **marks**.\n".repeat(4000)}`);
    for (const n of [1, 2, 2000, 4000]) expect(lineDirection(state, state.doc.line(n))).toBe("rtl");
  });

  it("agrees with syntax exclusions at every range boundary", () => {
    const doc = "123 `English\ncode` [عربي](https://example.test) **English** \\x <https://a.test>";
    const state = stateOf(doc);
    const skip = new Set([
      "HeaderMark",
      "QuoteMark",
      "ListMark",
      "TaskMarker",
      "EmphasisMark",
      "StrikethroughMark",
      "CodeMark",
      "InlineCode",
      "LinkMark",
      "URL",
      "Autolink",
      "LinkTitle",
      "LinkLabel",
      "Escape",
    ]);
    for (let from = 0; from <= doc.length; from++) {
      for (const to of [from, Math.min(doc.length, from + 8), doc.length]) {
        const excluded: [number, number][] = [];
        syntaxTree(state).iterate({
          from,
          to,
          enter(node) {
            if (skip.has(node.name)) {
              excluded.push([node.from, node.to]);
              return false;
            }
            return true;
          },
        });
        let expected: "ltr" | "rtl" | null = null;
        for (let pos = from; pos < to; pos++) {
          if (excluded.some(([a, b]) => a <= pos && pos < b)) continue;
          const ch = doc.charAt(pos);
          if (!/\p{L}/u.test(ch)) continue;
          expected = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(ch) ? "rtl" : "ltr";
          break;
        }
        expect(firstStrongDirection(state, from, to), `${from}..${to}`).toBe(expected);
      }
    }
  });
});
