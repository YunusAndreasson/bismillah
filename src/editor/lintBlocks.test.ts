import { describe, expect, it } from "vitest";
import { frontmatterLang, lintUnits, type LintUnit } from "./lintBlocks.ts";
import { stateOf } from "./testing.ts";

/** The units of `doc`, each with its skipped and marked text spelled out. */
function units(doc: string): { text: string; skip: string[]; marks: string[] }[] {
  const state = stateOf(doc);
  return lintUnits(state, 0, state.doc.length).map((u: LintUnit) => ({
    text: u.text,
    skip: u.skip.map(([a, b]) => u.text.slice(a, b)),
    marks: u.marks.map(([a, b]) => u.text.slice(a, b)),
  }));
}

describe("lint units", () => {
  it("sends paragraphs and headings, never frontmatter or code", () => {
    const doc =
      "---\ntitle: recieve\n---\n\n# A heading\n\nA paragraph.\n\n```\nrecieve\n```\n\n    indented recieve\n";
    expect(units(doc).map((u) => u.text)).toEqual(["# A heading", "A paragraph."]);
  });

  it("marks Markdown punctuation and skips code, URLs and HTML", () => {
    const [u] = units(
      'Text *em* and **strong**, `code`, [link](https://x.com "t"), <span>x</span> &amp; \\* end',
    );
    expect(u?.marks).toEqual(["*", "*", "**", "**", "[", "]", "(", ")", "\\"]);
    expect(u?.skip).toEqual(["`code`", "https://x.com", '"t"', "<span>", "</span>", "&amp;"]);
  });

  it("marks heading and quote marks, also on continuation lines", () => {
    expect(units("## Heading ##")[0]?.marks).toEqual(["##", "##"]);
    expect(units("Setext\n===")[0]?.marks).toEqual(["==="]);
    const [quote] = units("> one *two*\n> three");
    expect(quote?.text).toBe("one *two*\n> three");
    expect(quote?.marks).toEqual(["*", "*", ">"]);
  });

  it("sends list items without their marker and tasks without their box", () => {
    expect(units("- one\n- [ ] two\n  1. three").map((u) => [u.text, u.marks])).toEqual([
      ["one", []],
      ["[ ] two", ["[ ]"]],
      ["three", []],
    ]);
  });

  it("sends table cells one by one, never the delimiter row", () => {
    expect(units("| a | b |\n|---|---:|\n| iA Writer | 20 |").map((u) => u.text)).toEqual([
      "a",
      "b",
      "iA Writer",
      "20",
    ]);
  });

  it("skips footnote references and bare and angle-bracket links", () => {
    const [u] = units(
      "Quiet.[^1] Bare https://e.com/x and <https://y.z> [ref][lbl].\n\n[lbl]: https://e.com",
    );
    expect(u?.skip).toEqual(["[^1]", "https://e.com/x", "<https://y.z>", "[lbl]"]);
    expect(units("[^1]: Like this one.")[0]?.skip).toEqual(["[^1]:"]);
  });

  it("finds only the blocks in a range, up to a budget", () => {
    const state = stateOf("One.\n\nTwo.\n\nThree.");
    expect(lintUnits(state, 7, 8).map((u) => u.text)).toEqual(["Two."]);
    expect(lintUnits(state, 0, state.doc.length, 3).map((u) => u.text)).toEqual(["One."]);
  });

  it("gives offsets in UTF-16 units relative to the block", () => {
    const state = stateOf("Intro.\n\nA 😀 `x` here.");
    const [, u] = lintUnits(state, 0, state.doc.length);
    expect(u?.from).toBe(8);
    expect(u?.skip).toEqual([[5, 8]]);
  });
});

describe("the document's language", () => {
  it("reads lang from the frontmatter only", () => {
    expect(frontmatterLang(stateOf("---\ntitle: x\nlang: en-GB\n---\nText"))).toBe("en-GB");
    expect(frontmatterLang(stateOf("---\nlang: 'ar'\n---\n"))).toBe("ar");
    expect(frontmatterLang(stateOf("lang: fa\n\nText"))).toBeNull();
    expect(frontmatterLang(stateOf("---\nlang: not a tag\n---\n"))).toBeNull();
  });
});
