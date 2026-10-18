import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import {
  holdReveal,
  normaliseLabel,
  references,
  renderedDecorations,
  revealed,
  revealedLines,
} from "./livePreview.ts";

/** A parsed state with the caret at the `‸` in `doc`. */
function stateWith(doc: string): EditorState {
  const caret = doc.indexOf("‸");
  const text = doc.replace("‸", "");
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(Math.max(0, caret)),
    extensions: [markdownDialect(), revealed],
  });
  ensureSyntaxTree(state, text.length, 5000);
  return state.update({}).state;
}

/** The revealed lines' text with the caret at the `‸`. */
function revealedText(doc: string): string {
  const state = stateWith(doc);
  const { from, to } = revealedLines(state);
  return state.sliceDoc(from, to);
}

interface Rendered {
  /** The text as drawn: replaced marks left out, painted-out marks as `·`. */
  text: string;
  /** Text under each class-carrying mark, as "class: text". */
  marks: string[];
  /** Line classes, as "line N: class". */
  lines: string[];
  styles: string[];
}

/** Each character width 10px, so quote bars land on round numbers. */
const width = (text: string) => text.length * 10;

function render(doc: string): Rendered {
  const state = stateWith(doc);
  const set = renderedDecorations(state, [{ from: 0, to: state.doc.length }], width);
  const replaced: [number, number][] = [];
  const painted: [number, number][] = [];
  const marks: string[] = [];
  const lines: string[] = [];
  const styles: string[] = [];
  set.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; attributes?: { style?: string } };
    if (from === to) {
      lines.push(`line ${state.doc.lineAt(from).number}: ${spec.class ?? ""}`);
      if (spec.attributes?.style) styles.push(spec.attributes.style);
    } else if (!spec.class) {
      replaced.push([from, to]);
    } else {
      if (spec.class.includes("cm-md-hidden")) painted.push([from, to]);
      const cls = spec.class.replace("cm-md-hidden", "").trim();
      if (cls) marks.push(`${cls}: ${state.sliceDoc(from, to)}`);
    }
  });
  let text = "";
  for (let pos = 0; pos < state.doc.length; pos++) {
    if (replaced.some(([a, b]) => pos >= a && pos < b)) continue;
    const ch = state.sliceDoc(pos, pos + 1);
    text += painted.some(([a, b]) => pos >= a && pos < b) ? "·" : ch;
  }
  return { text, marks, lines, styles };
}

/** Rendered text of the first line(s), with the caret parked in a last paragraph. */
const shown = (doc: string) => render(`${doc}\n\n‸end`).text.replace(/\n\nend$/, "");

describe("the revealed block", () => {
  it("is the paragraph or heading that holds the caret, all its lines", () => {
    expect(revealedText("One\n\nTwo li‸ne\nstill two\n\nThree")).toBe("Two line\nstill two");
    expect(revealedText("## Head‸ing\n\nText")).toBe("## Heading");
    expect(revealedText("## Heading‸\n\nText")).toBe("## Heading");
  });

  it("is only the caret's line on a blank line", () => {
    expect(revealedText("One\n‸\nTwo")).toBe("");
  });

  it("includes the item's marker, from the marker or the text", () => {
    expect(revealedText("- one\n- ‸two\n  more\n- three")).toBe("- two\n  more");
    expect(revealedText("- one\n‸- two\n- three")).toBe("- two");
  });

  it("includes every line of a quoted paragraph with its marks", () => {
    expect(revealedText("> One\n> tw‸o\n>\n> > three")).toBe("> One\n> two");
    expect(revealedText("> One\n>‸\n> > three")).toBe(">");
  });

  it("takes whole tables, code blocks, setext headings and frontmatter", () => {
    expect(revealedText("| a | b |\n|---|---|\n| 1 | ‸2 |")).toBe(
      "| a | b |\n|---|---|\n| 1 | 2 |",
    );
    expect(revealedText("```\nco‸de\n```\n\nText")).toBe("```\ncode\n```");
    expect(revealedText("Ti‸tle\n===\n\nText")).toBe("Title\n===");
    expect(revealedText("---\ntitle: ‸A\n---\n\nText")).toBe("---\ntitle: A\n---");
  });

  it("waits for the mouse button's release, and keyboard motion ends the wait", () => {
    let state = stateWith("One\n\nTw‸o");
    state = state.update({ effects: holdReveal.of(true) }).state;
    state = state.update({ selection: { anchor: 1 }, userEvent: "select.pointer" }).state;
    expect(state.field(revealed)).toMatchObject({ held: true, lines: { from: 5, to: 8 } });
    state = state.update({ effects: holdReveal.of(false) }).state;
    expect(state.field(revealed)).toMatchObject({ held: false, lines: { from: 0, to: 3 } });

    state = state.update({ effects: holdReveal.of(true) }).state;
    state = state.update({ selection: { anchor: 6 }, userEvent: "select" }).state;
    expect(state.field(revealed)).toMatchObject({ held: false, lines: { from: 5, to: 8 } });
  });
});

describe("the rendered look", () => {
  it("hides inline marks and keeps the text", () => {
    expect(
      shown("Text *em*, **strong**, ***both***, ~~struck~~, `code`, \\*escaped\\* and _em_."),
    ).toBe("Text em, strong, both, struck, code, *escaped* and em.");
    expect(render("A `co de` span\n\n‸").marks).toEqual(["cm-md-code: co de"]);
  });

  it("leaves the caret's block exactly as written", () => {
    expect(render("Text *e‸m* and [a](https://e.com)").text).toBe(
      "Text *em* and [a](https://e.com)",
    );
  });

  it("does the same in Arabic and mixed lines", () => {
    expect(shown("The word **أمانة** means *trust*.")).toBe("The word أمانة means trust.");
    expect(shown("نستخدم **Markdown** في *مجلدٍ* تختاره.")).toBe(
      "نستخدم Markdown في مجلدٍ تختاره.",
    );
  });

  it("shows inline links as their text", () => {
    const r = render('A [link *x*](https://e.com "Title") here\n\n‸');
    expect(r.text).toBe("A link x here\n\n");
    expect(r.marks).toEqual(["cm-md-link: link *x*"]);
  });

  it("shows reference links only when their label is defined", () => {
    const doc = "[Full][r], [r][], [r] and [sic] or [ibid.][nope].\n\n[R]: https://r.example\n\n‸";
    expect(render(doc).text).toBe(
      "Full, r, r and [sic] or [ibid.][nope].\n\n[R]: https://r.example\n\n",
    );
  });

  it("keeps a link without text, and HTML, entities and code blocks as written", () => {
    expect(shown("[](https://e.com) <b>bold</b> &amp;")).toBe(
      "[](https://e.com) <b>bold</b> &amp;",
    );
    expect(shown("```js\nlet *a* = `b`;\n```")).toBe("```js\nlet *a* = `b`;\n```");
  });

  it("raises defined footnote references and hides the definition's marks", () => {
    const r = render("Quiet.[^1] And [^2].\n\n[^1]: Like this one.\n\n‸");
    expect(r.text).toBe("Quiet.1 And [^2].\n\n1 Like this one.\n\n");
    expect(r.marks).toEqual(["cm-md-footnote: 1", "cm-md-footnote: 1"]);
  });

  it("shows images as their alt text, and autolinks and bare URLs as links", () => {
    const r = render("![A cat](cat.png) <https://a.b> https://bare.example/x\n\n‸");
    expect(r.text).toBe("A cat https://a.b https://bare.example/x\n\n");
    expect(r.marks).toEqual([
      "cm-md-alt: A cat",
      "cm-md-link: https://a.b",
      "cm-md-link: https://bare.example/x",
    ]);
  });

  it("paints out heading marks where they hang, and hides closing ones", () => {
    expect(shown("## Title ##")).toBe("·· Title ");
    expect(shown("Title\n===")).toBe("Title\n···");
  });

  it("draws bullets, numbers and task boxes over the list markers", () => {
    const r = render("- one\n- two\n\n1. first\n\n- [ ] open\n- [x] done\n\n‸");
    expect(r.text).toBe("· one\n· two\n\n1. first\n\n· ··· open\n· ··· done\n\n");
    expect(r.marks).toEqual([
      "cm-md-bullet: -",
      "cm-md-bullet: -",
      "cm-md-number: 1.",
      "cm-md-task: [ ]",
      "cm-md-task cm-md-done: [x]",
    ]);
  });

  it("puts a bar on the place of every quote mark", () => {
    const r = render("> > nest\n> back\n\n‸");
    expect(r.text).toBe("· · nest\n· back\n\n");
    expect(r.lines).toEqual(["line 1: cm-md-quote", "line 2: cm-md-quote"]);
    // Back from the reading edge (40px of "> > "), at the middle of each `>`: the outer
    // bar 35px back, the inner one 15px, like the single `>` of the next line.
    expect(r.styles[0]).toContain("calc(var(--line-start) - 35.00px) 0/");
    expect(r.styles[0]).toContain("calc(var(--line-start) - 15.00px) 0/");
    expect(r.styles[0]).toContain("right calc(var(--line-start) - 15.00px) top 0/");
    expect(r.styles[1]).toContain("calc(var(--line-start) - 15.00px) 0/");
    // An empty quote line hangs only its `>`, but its bar stays in line.
    expect(render(">\n> text\n\n‸").styles[0]).toContain("calc(var(--line-start) - 15.00px) 0/");
  });

  it("draws a rule for a thematic break", () => {
    const r = render("Text\n\n---\n\n‸");
    expect(r.text).toBe("Text\n\n···\n\n");
    expect(r.lines).toEqual(["line 3: cm-md-rule"]);
  });

  it("leaves frontmatter and link definitions as written", () => {
    expect(shown("---\ntitle: *A*\n---\n\n[r]: https://r.example")).toBe(
      "---\ntitle: *A*\n---\n\n[r]: https://r.example",
    );
  });
});

describe("references", () => {
  it("collects link and footnote labels, normalised", () => {
    const refs = references(stateWith("[Foo  Bar]: /x\n\n[^n]: A note.\n\n> [q]: /y\n\n‸"));
    expect([...refs.links].sort()).toEqual([
      ["foo bar", "/x"],
      ["q", "/y"],
    ]);
    expect([...refs.footnotes]).toEqual(["n"]);
    expect(normaliseLabel("  Ḥadīth \n Notes ")).toBe("ḥadīth notes");
  });
});
