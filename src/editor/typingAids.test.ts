import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import {
  convert,
  isExcluded,
  planConversion,
  restoreTyped,
  setTransliteration,
  typingAids,
  typingAidsConfig,
} from "./typingAids.ts";

/**
 * Types into an EditorState the way the editor does: each key goes in as ordinary input
 * ("input.type"), then any conversion follows as its own transaction (the input handler
 * dispatches exactly this pair). Enter is CodeMirror's newline command ("input").
 */
class Typist {
  state: EditorState;

  constructor(doc = "", options: { smart?: boolean; translit?: boolean } = {}) {
    this.state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdownDialect(),
        EditorState.allowMultipleSelections.of(true),
        history(),
        typingAids(),
        typingAidsConfig.of({ smartPunctuation: options.smart ?? true }),
      ],
    });
    this.apply(this.state.update({ effects: setTransliteration.of(options.translit ?? true) }));
  }

  private apply(tr: Transaction): void {
    this.state = tr.state;
  }

  private get head(): number {
    return this.state.selection.main.head;
  }

  type(key: string): void {
    if (key === "\n") {
      this.apply(
        this.state.update({
          changes: { from: this.head, insert: "\n" },
          selection: { anchor: this.head + 1 },
          userEvent: "input",
        }),
      );
      return;
    }
    const conversion = planConversion(this.state, key);
    const typed = this.state.update({
      changes: { from: this.head, insert: key },
      selection: { anchor: this.head + key.length },
      userEvent: "input.type",
    });
    this.apply(conversion ? convert(typed, conversion) : typed);
  }

  typeAll(keys: string): this {
    for (const key of keys) this.type(key);
    return this;
  }

  /** Backspace as the editor binds it: restore after a conversion, else delete. */
  backspace(): void {
    const spec = restoreTyped(this.state);
    if (spec) this.apply(this.state.update(spec));
    else {
      // An ordinary delete of the character before the caret (the tests type no clusters).
      const from = this.head - (this.state.sliceDoc(0, this.head).at(-1)?.length ?? 0);
      this.apply(
        this.state.update({
          changes: { from, to: this.head },
          selection: { anchor: from },
          userEvent: "delete.backward",
        }),
      );
    }
  }

  undo(): void {
    undo({ state: this.state, dispatch: (tr) => this.apply(tr) });
  }

  redo(): void {
    redo({ state: this.state, dispatch: (tr) => this.apply(tr) });
  }

  moveTo(pos: number): void {
    this.apply(this.state.update({ selection: { anchor: pos }, userEvent: "select" }));
  }

  get text(): string {
    return this.state.doc.toString();
  }
}

const out = (keys: string, smart = true) => new Typist("", { smart }).typeAll(keys).text;

describe("transliteration (IJMES)", () => {
  it("makes macrons from a vowel then =", () => {
    expect(out("Qa=di= Iya=d")).toBe("Qādī Iyād");
    expect(out("A=l `Imra=n")).toBe("Āl ʿImrān");
    expect(out("I= U=")).toBe("Ī Ū");
  });

  it("leaves hyphenated particles and compounds alone", () => {
    expect(out("wa-l-`ilm, bi-lla=h, li-l-na=s, fa-qa=la")).toBe(
      "wa-l-ʿilm, bi-llāh, li-l-nās, fa-qāla",
    );
    expect(out("the Sunni-Shi`i divide, a multi-ethnic state")).toBe(
      "the Sunni-Shiʿi divide, a multi-ethnic state",
    );
  });

  it("makes dots below from a dot before the letter", () => {
    expect(out(".hadi=th, .sala=h, .dala=l, .taha=ra, .zulm")).toBe(
      "ḥadīth, ṣalāh, ḍalāl, ṭahāra, ẓulm",
    );
    expect(out(".Hanbali=, .Sa=diq, .Ta=`if")).toBe("Ḥanbalī, Ṣādiq, Ṭāʿif");
    expect(out("A.hmad and i.sla=.h")).toBe("Aḥmad and iṣlāḥ");
  });

  it("leaves sentence ends and upper-case abbreviations alone", () => {
    expect(out("Alla=h. Then")).toBe("Allāh. Then");
    expect(out("1000 A.H./1591 C.E., 800 A.D., a Ph.D. in the U.S. P.S.")).toBe(
      "1000 A.H./1591 C.E., 800 A.D., a Ph.D. in the U.S. P.S.",
    );
  });

  it("treats an ellipsis as one unit, so a letter after it never takes a dot", () => {
    expect(out("wait...then")).toBe("wait…then");
    expect(out("so...h")).toBe("so…h");
  });

  it("makes ʿayn from a backtick, including at the start of a line", () => {
    expect(out("`ilm and al-`Arab")).toBe("ʿilm and al-ʿArab");
    expect(out("`Umar said\n`Ali= said")).toBe("ʿUmar said\nʿAlī said");
  });

  it("keeps fences and double backticks: a second backtick undoes the ʿ", () => {
    expect(out("```\nqiya=s .h `x ''\n```\nafter: `ilm")).toBe(
      "```\nqiya=s .h `x ''\n```\nafter: ʿilm",
    );
    expect(out("a span ``x`` here")).toBe("a span ``x`` here");
  });

  it("makes hamza from two apostrophes, with smart punctuation on or off", () => {
    expect(out("Qur''a=n, `ulama=''")).toBe("Qurʾān, ʿulamāʾ");
    expect(out("Qur''a=n, `ulama=''", false)).toBe("Qurʾān, ʿulamāʾ");
    expect(out("it's 'quoted'")).toBe("it’s ‘quoted’");
  });

  it("converts only just-typed keys: a sequence split by another key does not", () => {
    expect(out(". h")).toBe(". h");
    expect(out("a =b")).toBe("a =b");
  });

  it("never combines with text that was already there", () => {
    const typist = new Typist("a");
    typist.type("=");
    expect(typist.text).toBe("a=");
    const dot = new Typist("x.");
    dot.type("h");
    expect(dot.text).toBe("x.h");
  });

  it("is off by default and leaves everything literal when off", () => {
    const typist = new Typist("", { translit: false, smart: false });
    typist.typeAll("a= .h ` '' \"x\" -- ...");
    expect(typist.text).toBe("a= .h ` '' \"x\" -- ...");
  });
});

describe("Backspace and undo", () => {
  it("restores the typed keys with a Backspace straight after a conversion", () => {
    for (const [keys, converted] of [
      ["x.h", "xḥ"],
      ["a=", "ā"],
      ["`", "ʿ"],
      ["Qur''", "Qurʾ"],
      ['say "', "say “"],
      ["10--", "10–"],
      ["so...", "so…"],
    ] as const) {
      const typist = new Typist().typeAll(keys);
      expect(typist.text, keys).toBe(converted);
      typist.backspace();
      expect(typist.text, keys).toBe(keys);
    }
  });

  it("never converts restored keys again; a later Backspace is an ordinary delete", () => {
    const typist = new Typist().typeAll("Qur''");
    typist.backspace();
    typist.type("'");
    expect(typist.text).toBe("Qur''’");
    typist.type("a");
    typist.backspace();
    expect(typist.text).toBe("Qur''’");
  });

  it("keeps an undone opening backtick literal, so the code span stays code", () => {
    const typist = new Typist().typeAll("see `");
    typist.backspace();
    typist.typeAll("a=b .h''` and `ilm");
    expect(typist.text).toBe("see `a=b .h''` and ʿilm");
  });

  it("ends the immediate window when the caret moves", () => {
    const typist = new Typist().typeAll("Ra=");
    typist.moveTo(1);
    typist.moveTo(2);
    typist.backspace();
    expect(typist.text).toBe("Rā".slice(0, 1) + "ā".slice(1));
    expect(typist.text).toBe("R");
  });

  it("makes the conversion its own undo step", () => {
    const typist = new Typist().typeAll("the Qa=");
    expect(typist.text).toBe("the Qā");
    typist.undo();
    expect(typist.text).toBe("the Qa=");
    expect(typist.state.selection.main.head).toBe(7);
    typist.undo();
    expect(typist.text).toBe("");
    typist.redo();
    expect(typist.text).toBe("the Qa=");
    typist.redo();
    expect(typist.text).toBe("the Qā");
  });

  it("starts a new undo step after a conversion", () => {
    const typist = new Typist().typeAll('"x');
    expect(typist.text).toBe("“x");
    typist.undo();
    expect(typist.text).toBe("“");
    typist.undo();
    expect(typist.text).toBe('"');
  });
});

describe("smart punctuation", () => {
  it("makes dashes inside a line but keeps rules and tables", () => {
    expect(out("pp. 10--12, a pause --- then")).toBe("pp. 10–12, a pause — then");
    expect(out("text\n\n---\n")).toBe("text\n\n---\n");
    expect(out("| a | b |\n|---|---|")).toBe("| a | b |\n|---|---|");
    expect(out("a | b\n---|---")).toBe("a | b\n---|---");
  });

  it("uses guillemets in an Arabic run", () => {
    expect(out('قال "العلم نور"')).toBe("قال «العلم نور»");
    expect(out("'x' and 'y'", true)).toBe("‘x’ and ‘y’");
  });

  it("chooses quotes by position", () => {
    expect(out('"Read," he said. ("Yes.")')).toBe("“Read,” he said. (“Yes.”)");
    expect(out("the '90s and rock 'n' roll")).toBe("the ‘90s and rock ‘n’ roll");
  });

  it("never touches Arabic punctuation", () => {
    expect(out("هل قرأت؟ نعم، قرأت؛ حسناً")).toBe("هل قرأت؟ نعم، قرأت؛ حسناً");
  });
});

describe("exclusions", () => {
  it("leaves code, URLs, link targets and frontmatter alone; link text converts", () => {
    expect(out("---\ntitle: a= .h\n---\n.hadi=th")).toBe("---\ntitle: a= .h\n---\nḥadīth");
    expect(out("https://example.org/a=b/.html and a=")).toBe("https://example.org/a=b/.html and ā");
    expect(out("[al-Fa=ti.ha](https://quran.com/a=1.html)")).toBe(
      "[al-Fātiḥa](https://quran.com/a=1.html)",
    );
    expect(out("    indented a= .h\n\n.h")).toBe("    indented a= .h\n\nḥ");
    const code = new Typist("", { translit: false }).typeAll('see `"x" -- a=` then "y"');
    expect(code.text).toBe('see `"x" -- a=` then “y”');
  });

  it("uses the parser for blocks: fenced code typed into an existing document", () => {
    const doc = "Before\n\n```\ncode\n```\n";
    const typist = new Typist(doc);
    typist.moveTo(doc.indexOf("code") + 4);
    typist.typeAll(' "a=" ...');
    expect(typist.text).toBe('Before\n\n```\ncode "a=" ...\n```\n');
  });

  it("leaves indented list continuations as prose, not code", () => {
    const doc = "- item\n\n    continued";
    const typist = new Typist(doc);
    typist.typeAll(" a= .h");
    expect(typist.text).toBe("- item\n\n    continued ā ḥ");
  });

  it("knows a bare URL token and an angle-bracket autolink", () => {
    const state = EditorState.create({
      doc: "see <https://x.org/a",
      extensions: markdownDialect(),
    });
    expect(isExcluded(state, state.doc.length)).toBe(true);
    const plain = EditorState.create({ doc: "see www.example", extensions: markdownDialect() });
    expect(isExcluded(plain, plain.doc.length)).toBe(true);
    const prose = EditorState.create({ doc: "see the example", extensions: markdownDialect() });
    expect(isExcluded(prose, prose.doc.length)).toBe(false);
  });
});

describe("only plain typing at one caret", () => {
  it("does nothing with several carets or a selection", () => {
    const base = new Typist("a\na");
    const multi = base.state.update({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
    }).state;
    expect(planConversion(multi, '"')).toBeNull();
    const ranged = base.state.update({ selection: { anchor: 0, head: 1 } }).state;
    expect(planConversion(ranged, '"')).toBeNull();
  });

  it("does nothing for pasted or multi-character input", () => {
    const typist = new Typist();
    expect(planConversion(typist.state, '"x"')).toBeNull();
    // A paste is not typing: it never starts a run that a later key could complete.
    typist.state = typist.state.update({
      changes: { from: 0, insert: "a" },
      selection: { anchor: 1 },
      userEvent: "input.paste",
    }).state;
    typist.type("=");
    expect(typist.text).toBe("a=");
  });
});
