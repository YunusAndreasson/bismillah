import { history, undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { canFormat, formatState, setBlock, toggleMark, type Block, type Mark } from "./format.ts";

/** A parsed state with the selection between two `|`, or the caret at one. */
function at(marked: string, readOnly = false): EditorState {
  const start = marked.indexOf("|");
  const end = marked.indexOf("|", start + 1);
  const doc = marked.replaceAll("|", "");
  const state = EditorState.create({
    doc,
    selection: end < 0 ? EditorSelection.cursor(start) : EditorSelection.range(start, end - 1),
    extensions: [markdownDialect(), history(), EditorState.readOnly.of(readOnly)],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** A selected cell: a table's own pipes would read as the marker above. */
function inTable(): EditorState {
  const doc = "| a | b |\n|---|---|\n| c | d |\n";
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(doc.indexOf("c"), doc.indexOf("c") + 1),
    extensions: [markdownDialect()],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state.update({}).state;
}

const show = (state: EditorState): string => {
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  return from === to
    ? `${doc.slice(0, from)}|${doc.slice(from)}`
    : `${doc.slice(0, from)}|${doc.slice(from, to)}|${doc.slice(to)}`;
};

/** Reparsed, as the next action would see it. */
function reparsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

function mark(marked: string, kind: Mark): string | null {
  const state = at(marked);
  const spec = toggleMark(state, kind);
  return spec ? show(state.update(spec).state) : null;
}

function block(marked: string, kind: Block): string | null {
  const state = at(marked);
  const spec = setBlock(state, kind);
  return spec ? show(state.update(spec).state) : null;
}

describe("marks", () => {
  it.each<[Mark, string, string]>([
    ["bold", "A |word| here", "A **|word|** here"],
    ["italic", "A |word| here", "A _|word|_ here"],
    ["strike", "A |word| here", "A ~~|word|~~ here"],
    ["code", "A |word| here", "A `|word|` here"],
  ])("%s wraps the selected words and keeps them selected", (kind, before, after) => {
    expect(mark(before, kind)).toBe(after);
  });

  it.each<[Mark, string, string]>([
    ["bold", "A **|word|** here", "A |word| here"],
    ["bold", "A |**word**| here", "A |word| here"],
    ["bold", "A **a |word| b** here", "A a |word| b here"],
    ["italic", "A _|word|_ here", "A |word| here"],
    ["italic", "A *|word|* here", "A |word| here"],
    ["strike", "A ~~|word|~~ here", "A |word| here"],
    ["code", "A `|word|` here", "A |word| here"],
  ])("%s comes off %s", (kind, before, after) => {
    expect(mark(before, kind)).toBe(after);
  });

  it.each<[Mark, string]>([
    ["bold", "A |word| here"],
    ["italic", "A |word| here"],
    ["strike", "A |word| here"],
    ["code", "A |word| here"],
    ["bold", "ٱلْ|حَمْدُ لِلَّهِ| رَبِّ"],
    ["italic", "قال |بِسْمِ ٱللَّهِ| ثم"],
    ["bold", "Mixed |أَمَانَةٌ means| trust"],
    ["strike", "ذَٰلِكَ |ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ|"],
  ])("%s on and off returns exactly %s", (kind, text) => {
    const state = at(text);
    const on = reparsed(state.update(toggleMark(state, kind) ?? {}).state);
    const off = on.update(toggleMark(on, kind) ?? {}).state;
    expect(off.doc.toString()).toBe(state.doc.toString());
    expect(show(off)).toBe(text);
  });

  it("leaves the spaces around a selection outside the marks", () => {
    expect(mark("A| word |here", "bold")).toBe("A| **word** |here");
  });

  it("wraps each block of a selection on its own", () => {
    expect(mark("|One\n\nTwo| three", "bold")).toBe("**|One**\n\n**Two|** three");
  });

  it("wraps within the words of a heading, not its mark", () => {
    expect(mark("|# Title|", "bold")).toBe("|# **Title|**");
  });

  it("keeps a list's and a quote's marks out", () => {
    expect(mark("- |item|", "bold")).toBe("- **|item|**");
    expect(mark("> |said|", "italic")).toBe("> _|said|_");
  });

  it("uses a star inside a word, where an underscore wouldn't open", () => {
    expect(mark("un|believ|able", "italic")).toBe("un*|believ|*able");
    expect(mark("بس|م|لة", "italic")).toBe("بس*|م|*لة");
  });

  it("never parts a letter from its vowel marks", () => {
    const text = "بِسْمِ";
    // After the first letter, before its kasra.
    const state = EditorState.create({
      doc: text,
      selection: EditorSelection.range(1, 3),
      extensions: [markdownDialect()],
    });
    ensureSyntaxTree(state, text.length, 5000);
    const parsed = state.update({}).state;
    const next = parsed.update(toggleMark(parsed, "bold") ?? {}).state;
    const doc = next.doc.toString();
    expect(doc.replaceAll("**", "")).toBe(text);
    expect(doc).not.toMatch(/\*\*[ً-ْ]/u);
  });

  it("takes a mark it would cut through whole", () => {
    expect(mark("a **b|old** an|d", "italic")).toBe("a ***b|old** an|*d");
  });

  it("refuses to mark inside code and addresses", () => {
    expect(mark("a `co|d|e` b", "bold")).toBeNull();
    expect(mark("[link](http://ex|am|ple.org)", "bold")).toBeNull();
  });

  it("won't set marked text or a backtick as code", () => {
    expect(mark("a |**b**| c", "code")).toBeNull();
    expect(mark("a |b`c| d", "code")).toBeNull();
  });

  it("leaves code blocks, tables and frontmatter alone", () => {
    expect(mark("```\n|code|\n```", "bold")).toBeNull();
    expect(mark("---\n|title: a|\n---\n\nText", "bold")).toBeNull();
    expect(toggleMark(inTable(), "bold")).toBeNull();
  });

  it("wraps only the text when a selection runs out of frontmatter", () => {
    expect(mark("---\nti|tle: a\n---\n\nText| b", "bold")).toBe(
      "---\nti|tle: a\n---\n\n**Text|** b",
    );
  });

  it("with only a caret, takes the word it's in", () => {
    expect(mark("A wo|rd here", "bold")).toBe("A **wo|rd** here");
    expect(mark("A |word here", "bold")).toBe("A **|word** here");
    expect(mark("A word| here", "bold")).toBe("A **word|** here");
    expect(mark("A **wo|rd** here", "bold")).toBe("A wo|rd here");
    expect(mark("قال بِسْ|مِ ثم", "italic")).toBe("قال _بِسْ|مِ_ ثم");
  });

  it.each<Mark>(["bold", "italic", "strike", "code"])(
    "%s writes no empty pair, which wouldn't be that mark",
    (kind) => {
      expect(mark("|", kind)).toBeNull();
      expect(mark("A | here", kind)).toBeNull();
    },
  );

  it.each<[Mark, string]>([
    ["bold", 'a |"word"|x'],
    ["bold", 'x|"word"| a'],
    ["strike", 'a |"word"|x'],
    ["italic", "\\|word| a"],
  ])("refuses %s where the parser wouldn't read it as one: %s", (kind, text) => {
    expect(mark(text, kind)).toBeNull();
    expect(formatState(at(text)).enabled[kind]).toBe(false);
  });

  it.each<[Mark, string, string]>([
    ["bold", "A |word| here", "StrongEmphasis"],
    ["bold", 'A |"word"| here', "StrongEmphasis"],
    ["bold", "(|word|)", "StrongEmphasis"],
    ["bold", "un|believ|able", "StrongEmphasis"],
    ["italic", "A |word| here", "Emphasis"],
    ["italic", "(|word|)", "Emphasis"],
    ["italic", "un|believ|able", "Emphasis"],
    ["italic", "بس|م|لة", "Emphasis"],
    ["strike", "A |word| here", "Strikethrough"],
    ["code", "A |word| here", "InlineCode"],
    ["bold", "- |item|", "StrongEmphasis"],
    ["bold", "> |one\n> two|", "StrongEmphasis"],
    ["bold", "# |Title|", "StrongEmphasis"],
  ])("%s of %s reads as Markdown", (kind, text, node) => {
    const state = at(text);
    const next = reparsed(state.update(toggleMark(state, kind) ?? {}).state);
    let found = false;
    syntaxTree(next).iterate({
      enter(n) {
        if (n.name === node) found = true;
      },
    });
    expect(found).toBe(true);
  });

  it("is one undo step", () => {
    const state = at("A |word| here");
    const next = state.update(toggleMark(state, "bold") ?? {}).state;
    let undone: EditorState | null = null;
    undo({
      state: next,
      dispatch: (tr) => {
        undone = tr.state;
      },
    });
    expect((undone as EditorState | null)?.doc.toString()).toBe("A word here");
  });
});

describe("turn into", () => {
  it.each<[Block, string, string]>([
    ["h1", "|Title|", "# |Title|"],
    ["h2", "|Title|", "## |Title|"],
    ["h3", "# |Title|", "### |Title|"],
    ["text", "## |Title|", "|Title|"],
    ["quote", "|said|", "> |said|"],
    ["bullet", "1. |item|", "- |item|"],
    ["numbered", "- |item|", "1. |item|"],
    ["text", "> |said|", "|said|"],
    ["text", "#### |Title|", "|Title|"],
  ])("%s: %s", (kind, before, after) => {
    expect(block(before, kind)).toBe(after);
  });

  it.each<[Block, string]>([
    ["h1", "ATXHeading1"],
    ["h2", "ATXHeading2"],
    ["h3", "ATXHeading3"],
    ["quote", "Blockquote"],
    ["bullet", "BulletList"],
    ["numbered", "OrderedList"],
  ])("%s reads as Markdown", (kind, node) => {
    const state = at("|one|");
    const next = reparsed(state.update(setBlock(state, kind) ?? {}).state);
    let found = false;
    syntaxTree(next).iterate({
      enter(n) {
        if (n.name === node) found = true;
      },
    });
    expect(found).toBe(true);
  });

  it("changes every line touched, numbering a list", () => {
    expect(block("|one\ntwo\nthree|", "numbered")).toBe("1. |one\n2. two\n3. three|");
    expect(block("|one\ntwo|", "bullet")).toBe("- |one\n- two|");
  });

  it("skips blank lines, and a line the selection only reaches the start of", () => {
    expect(block("|one\n\ntwo|", "quote")).toBe("> |one\n\n> two|");
    expect(block("|one\n|two", "quote")).toBe("> |one\n|two");
  });

  it("keeps a nested item's indent", () => {
    expect(block("- a\n  - |b|", "numbered")).toBe("- a\n  1. |b|");
  });

  it("works on the caret's line", () => {
    expect(block("Ti|tle", "h1")).toBe("# Ti|tle");
  });

  it("works on Arabic without touching its marks", () => {
    expect(block("|بِسْمِ ٱللَّهِ|", "h1")).toBe("# |بِسْمِ ٱللَّهِ|");
  });

  it("does nothing when the line is already that", () => {
    expect(block("# |Title|", "h1")).toBeNull();
    expect(block("|Text|", "text")).toBeNull();
  });

  it("leaves code, frontmatter, tables, rules and underlined headings", () => {
    expect(block("```\n|code|\n```", "h1")).toBeNull();
    expect(block("---\n|a: b|\n---\n", "h1")).toBeNull();
    expect(setBlock(inTable(), "h1")).toBeNull();
    expect(block("|---|", "h1")).toBeNull();
    expect(block("|Title|\n=====", "h1")).toBeNull();
  });
});

describe("the bar's state", () => {
  it("says which marks the selection has", () => {
    const { active, enabled, block: kind } = formatState(at("# A **|word|** here"));
    expect(active).toEqual({ bold: true, italic: false, strike: false, code: false });
    expect(enabled.italic).toBe(true);
    expect(kind).toBe("h1");
  });

  it("disables what can't apply", () => {
    const { active, enabled } = formatState(at("a `|code|` b"));
    expect(active.code).toBe(true);
    expect(enabled.code).toBe(true);
    expect(enabled.bold).toBe(false);
  });

  it("has nothing to offer without a selection, in a read-only file, or in code", () => {
    expect(canFormat(at("a |word"))).toBe(false);
    expect(canFormat(at("a |word| b", true))).toBe(false);
    expect(canFormat(at("```\n|code|\n```"))).toBe(false);
    expect(canFormat(at("---\n|a: b|\n---\n"))).toBe(false);
    expect(canFormat(at("a |word| b"))).toBe(true);
  });
});
