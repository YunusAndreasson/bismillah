import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Diagnostic as Found, LintRequest, LintResponse } from "../core/ipc.ts";
import { markdownDialect } from "./dialect.ts";
import { visibleDiagnostics } from "./diagnostics.ts";
import { DEBOUNCE_MS, lintIdle, linter, recheck } from "./linter.ts";

/** A checker that answers when the test says so, flagging every word in `bad`. */
class FakeChecker {
  requests: LintRequest[] = [];
  pending: (() => void)[] = [];
  bad = ["recieve", "tomorow", "mistaek"];

  check = (request: LintRequest): Promise<LintResponse> => {
    this.requests.push(request);
    return new Promise((resolve) => {
      this.pending.push(() =>
        resolve({
          revision: request.revision,
          blocks: request.blocks.map((b) => this.flag(b.text)),
        }),
      );
    });
  };

  flag(text: string): Found[] {
    const out: Found[] = [];
    for (const word of this.bad) {
      for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
        out.push({
          from_utf16: at,
          to_utf16: at + word.length,
          kind: "spelling",
          lang: "en",
          message: "",
          suggestions: [],
          rule_id: "spelling",
        });
      }
    }
    return out;
  }

  /** Answers the oldest request and lets the editor take the answer in. */
  async answer(): Promise<void> {
    this.pending.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  }

  get lastTexts(): string[] {
    return this.requests.at(-1)?.blocks.map((b) => b.text) ?? [];
  }
}

let view: EditorView;
let checker: FakeChecker;

function open(doc: string): void {
  checker = new FakeChecker();
  const state = EditorState.create({
    doc,
    extensions: [markdownDialect(), linter({ check: checker.check })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  view = new EditorView({ state, parent: document.body });
}

const flagged = () => visibleDiagnostics(view.state).map((p) => view.state.sliceDoc(p.from, p.to));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  view.destroy();
  vi.useRealTimers();
});

describe("the checking scheduler", () => {
  it("checks a newly opened document at once and places the results", async () => {
    open("# A heading\n\nI will recieve it.\n\n```\nrecieve\n```\n\nSee you tomorow.");
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.requests).toHaveLength(1);
    expect(checker.lastTexts).toEqual(["# A heading", "I will recieve it.", "See you tomorow."]);
    expect(checker.requests[0]?.blocks[0]?.marks).toEqual([[0, 1]]);
    await checker.answer();
    expect(flagged()).toEqual(["recieve", "tomorow"]);
    expect(lintIdle(view)).toBe(true);
  });

  it("sends only the changed block, after typing pauses", async () => {
    open("First recieve.\n\nSecond.");
    await vi.advanceTimersByTimeAsync(0);
    await checker.answer();
    view.dispatch({ changes: { from: 22, insert: " mistaek" }, userEvent: "input.type" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(checker.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checker.lastTexts).toEqual(["Second mistaek."]);
    await checker.answer();
    expect(flagged()).toEqual(["recieve", "mistaek"]);
  });

  it("drops results for a block edited while it was being checked", async () => {
    open("Alpha recieve.\n\nBeta tomorow.");
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.requests).toHaveLength(1);
    // While the request is out, the first block is edited and the text moves.
    view.dispatch({ changes: { from: 0, insert: "Now " }, userEvent: "input.type" });
    await checker.answer();
    // The stale block's results are dropped; the untouched one lands where it now is.
    expect(flagged()).toEqual(["tomorow"]);
    const tomorow = visibleDiagnostics(view.state)[0];
    expect(tomorow?.from).toBe(view.state.doc.toString().indexOf("tomorow"));
    // The edited block is checked again once typing pauses.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(checker.lastTexts).toEqual(["Now Alpha recieve."]);
    await checker.answer();
    expect(flagged()).toEqual(["recieve", "tomorow"]);
  });

  it("never has more than one request in flight", async () => {
    open("One.\n\nTwo.");
    await vi.advanceTimersByTimeAsync(0);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
    expect(checker.requests).toHaveLength(1);
    await checker.answer();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(checker.requests).toHaveLength(2);
    expect(checker.lastTexts).toEqual(["xOne."]);
  });

  it("checks a long document in steps", async () => {
    const paragraph = "A sentence with a recieve in it, long enough to count for something here.";
    open(Array.from({ length: 300 }, () => paragraph).join("\n\n"));
    let sent = 0;
    for (let i = 0; i < 20 && !lintIdle(view); i++) {
      await vi.advanceTimersByTimeAsync(50);
      if (checker.pending.length) {
        sent += 1;
        await checker.answer();
      }
    }
    expect(sent).toBeGreaterThan(2);
    for (const r of checker.requests) {
      const size = r.blocks.reduce((n, b) => n + b.text.length, 0);
      expect(size).toBeLessThan(6000 + paragraph.length);
    }
    expect(flagged()).toHaveLength(300);
  });

  it("checks everything again when asked (the dictionary changed)", async () => {
    open("I will recieve it.");
    await vi.advanceTimersByTimeAsync(0);
    await checker.answer();
    checker.bad = [];
    view.dispatch({ effects: recheck.of(null) });
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.requests).toHaveLength(2);
    await checker.answer();
    expect(flagged()).toEqual([]);
  });

  it("clears results from text that stopped being prose", async () => {
    open("Intro.\n\nI will recieve it.\n\nEnd.");
    await vi.advanceTimersByTimeAsync(0);
    await checker.answer();
    expect(flagged()).toEqual(["recieve"]);
    // Fencing the paragraph makes it code: its results go without a word of it changing.
    view.dispatch({ changes: { from: 8, insert: "```\n" }, userEvent: "input.type" });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await checker.answer();
    expect(flagged()).toEqual([]);
  });

  it("sends the frontmatter language, and checks again when it changes", async () => {
    open("---\nlang: en-US\n---\n\nThe color.");
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.requests[0]?.lang).toBe("en-US");
    await checker.answer();
    view.dispatch({ changes: { from: 13, to: 15, insert: "GB" }, userEvent: "input.type" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(checker.requests[1]?.lang).toBe("en-GB");
    expect(checker.lastTexts).toEqual(["The color."]);
  });
});
