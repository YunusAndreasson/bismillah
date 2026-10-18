import { describe, expect, it } from "vitest";
import { lineHang } from "./hangingMarks.ts";
import { stateOf } from "./testing.ts";

function hangs(doc: string) {
  const state = stateOf(doc);
  const out = [];
  for (let n = 1; n <= state.doc.lines; n++) out.push(lineHang(state, state.doc.line(n)));
  return out;
}

describe("lineHang", () => {
  it("hangs ATX heading marks with their space, at the heading's level", () => {
    expect(hangs("# Title\n\n### عنوانٌ عربي")).toEqual([
      { prefix: "# ", shift: [], level: 1 },
      null,
      { prefix: "### ", shift: [], level: 3 },
    ]);
  });

  it("hangs list markers, keeping nested indentation as a shift", () => {
    expect(hangs("- one\n  - two\n    - three\n\n10. ten")).toEqual([
      { prefix: "- ", shift: [], level: 0 },
      { prefix: "  - ", shift: ["- "], level: 0 },
      { prefix: "    - ", shift: ["- ", "- "], level: 0 },
      null,
      { prefix: "10. ", shift: [], level: 0 },
    ]);
  });

  it("hangs every quote mark, including on empty quote lines", () => {
    expect(hangs("> one\n>\n> > two")).toEqual([
      { prefix: "> ", shift: [], level: 0 },
      { prefix: ">", shift: [], level: 0 },
      { prefix: "> > ", shift: [], level: 0 },
    ]);
  });

  it("indents by marker widths, not by the source's spaces", () => {
    expect(hangs("10. ten\n    - nested")).toEqual([
      { prefix: "10. ", shift: [], level: 0 },
      { prefix: "    - ", shift: ["- "], level: 0 },
    ]);
  });

  it("keeps task boxes on the reading edge", () => {
    expect(hangs("- [ ] open")[0]).toEqual({ prefix: "- ", shift: [], level: 0 });
  });

  it("aligns a list item's continuation line with the item's text", () => {
    expect(hangs("- item\n  more\n  - nested\n    more")).toEqual([
      { prefix: "- ", shift: [], level: 0 },
      { prefix: "  ", shift: [], level: 0 },
      { prefix: "  - ", shift: ["- "], level: 0 },
      { prefix: "    ", shift: ["- "], level: 0 },
    ]);
  });

  it("never hangs inside code, frontmatter or setext underlines", () => {
    expect(
      hangs("---\ntitle: x\n---\n```\n# not a heading\n- not a list\n```\nTitle\n==="),
    ).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
