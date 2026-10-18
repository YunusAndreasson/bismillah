import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  BASMALLAH,
  basmallah,
  basmallahShown,
  firstContentBlock,
  isBasmallah,
  isStandaloneBasmallah,
  opensWithBasmallah,
} from "./basmallah.ts";
import { BASMALLAH_INK } from "./basmallahInk.ts";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const doc = (s: string) => Text.of(s.split("\n"));

describe("the pre-shaped ink", () => {
  it("was built from exactly the opening's text", () => {
    expect(BASMALLAH_INK.text).toBe(BASMALLAH);
  });

  it("is one path whose box starts at 0 and spans the advance", () => {
    expect(BASMALLAH_INK.d.startsWith("M")).toBe(true);
    expect(BASMALLAH_INK.advance).toBeGreaterThan(0);
    expect(BASMALLAH_INK.xMin).toBeGreaterThanOrEqual(0);
    expect(BASMALLAH_INK.yMin).toBeLessThan(0);
    expect(BASMALLAH_INK.yMax).toBeGreaterThan(0);
  });
});

describe("isBasmallah", () => {
  it.each([
    ["the opening's own text", BASMALLAH],
    ["no vocalisation", "بسم الله الرحمن الرحيم"],
    ["Uthmani, with alef wasla and small high marks", "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ"],
    ["tatweel", "بســم الله الرحمــن الرحيم"],
    ["extra and non-breaking spaces", `  بسم  الله${cp(0xa0)}الرحمن الرحيم `],
    ["direction marks", `${cp(0x200f)}بسم الله الرحمن الرحيم${cp(0x200f)}`],
    ["the ligature character", cp(0xfdfd)],
    ["a trailing full stop", "بسم الله الرحمن الرحيم."],
    ["a trailing Arabic comma", "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ،"],
  ])("accepts %s", (_, text) => {
    expect(isBasmallah(text)).toBe(true);
  });

  it.each([
    ["only part of it", "بسم الله"],
    ["more words after it", "بسم الله الرحمن الرحيم والحمد لله"],
    ["a different spelling", "بسم الله الرحمان الرحيم"],
    ["a transliteration", "Bismillāh al-raḥmān al-raḥīm"],
    ["an empty line", ""],
    ["two stops", "بسم الله الرحمن الرحيم.."],
  ])("rejects %s", (_, text) => {
    expect(isBasmallah(text)).toBe(false);
  });
});

describe("isStandaloneBasmallah", () => {
  it.each([
    ["a paragraph", BASMALLAH],
    ["an ATX heading", `# ${BASMALLAH}`],
    ["an ATX heading with a closing sequence", `## ${BASMALLAH} ##`],
    ["a setext heading", `${BASMALLAH}\n===`],
    ["a paragraph indented by three spaces", `   ${BASMALLAH}`],
  ])("accepts %s", (_, block) => {
    expect(isStandaloneBasmallah(block)).toBe(true);
  });

  it.each([
    ["a paragraph that continues on the next line", `${BASMALLAH}\nand more text`],
    ["indented code", `    ${BASMALLAH}`],
    ["a quote", `> ${BASMALLAH}`],
    ["a list item", `- ${BASMALLAH}`],
    ["a heading with more text", `# ${BASMALLAH} and an introduction`],
  ])("rejects %s", (_, block) => {
    expect(isStandaloneBasmallah(block)).toBe(false);
  });
});

describe("firstContentBlock", () => {
  it("skips frontmatter and blank lines", () => {
    expect(firstContentBlock(doc(`---\ntitle: x\n---\n\n\n${BASMALLAH}\n\nText.`))).toBe(BASMALLAH);
  });

  it("joins a lazy continuation line to the paragraph", () => {
    expect(firstContentBlock(doc(`${BASMALLAH}\nText.`))).toBe(`${BASMALLAH}\nText.`);
  });

  it("ends the paragraph at a line that starts a new block", () => {
    expect(firstContentBlock(doc(`${BASMALLAH}\n# Heading`))).toBe(BASMALLAH);
    expect(firstContentBlock(doc(`${BASMALLAH}\n- item`))).toBe(BASMALLAH);
  });

  it("keeps a setext underline with its heading", () => {
    expect(firstContentBlock(doc(`${BASMALLAH}\n---\n\nText.`))).toBe(`${BASMALLAH}\n---`);
  });

  it("finds nothing in an empty document or one that is all frontmatter", () => {
    expect(firstContentBlock(doc(""))).toBeNull();
    expect(firstContentBlock(doc("\n\n"))).toBeNull();
    expect(firstContentBlock(doc("---\ntitle: x\n---\n"))).toBeNull();
    expect(firstContentBlock(doc("---\ntitle: x"))).toBeNull();
  });
});

describe("opensWithBasmallah", () => {
  it("is true only when the first content block is the Basmallah", () => {
    expect(opensWithBasmallah(doc(`${BASMALLAH}\n\nText.`))).toBe(true);
    expect(opensWithBasmallah(doc(`---\nlang: ar\n---\n${cp(0xfdfd)}\n\nText.`))).toBe(true);
    expect(opensWithBasmallah(doc(`# Title\n\n${BASMALLAH}`))).toBe(false);
    expect(opensWithBasmallah(doc(`${BASMALLAH} — and then the text.`))).toBe(false);
    expect(opensWithBasmallah(doc("A letter."))).toBe(false);
  });
});

describe("the opening widget", () => {
  const stateOf = (text: string) => EditorState.create({ doc: text, extensions: [basmallah()] });

  it("is shown above an ordinary document", () => {
    expect(basmallahShown(stateOf("# A letter\n\nText."))).toBe(true);
    expect(basmallahShown(stateOf(""))).toBe(true);
  });

  it("is suppressed when the document already opens with a Basmallah", () => {
    expect(basmallahShown(stateOf(`${BASMALLAH}\n\nText.`))).toBe(false);
  });

  it("follows edits: suppressed when one is typed, back when it is edited away", () => {
    let state = stateOf("\n\nText.");
    expect(basmallahShown(state)).toBe(true);
    state = state.update({ changes: { from: 0, insert: BASMALLAH } }).state;
    expect(basmallahShown(state)).toBe(false);
    state = state.update({ changes: { from: 0, to: 3, insert: "" } }).state;
    expect(basmallahShown(state)).toBe(true);
  });

  it("is not shown when the extension is off", () => {
    expect(basmallahShown(EditorState.create({ doc: "Text." }))).toBe(false);
  });
});
