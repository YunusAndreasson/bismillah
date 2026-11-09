import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { stateOf } from "./testing.ts";
import { focusedRange, type FocusGranularity } from "./zuhd.ts";

/** The focused text with the caret at the `|` in `doc`. */
function focused(doc: string, granularity: FocusGranularity): string | null {
  const caret = doc.indexOf("|");
  const state = stateOf(doc.replaceAll("|", "")).update({
    selection: EditorSelection.cursor(caret),
  }).state;
  const range = focusedRange(state, granularity);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

describe("Zuhd mode focus", () => {
  const doc =
    "# Title\n\nFirst sentence. Sec|ond one here.\nStill the same paragraph.\n\nNext paragraph.";

  it("keeps the paragraph around the caret", () => {
    expect(focused(doc, "paragraph")).toBe(
      "First sentence. Second one here.\nStill the same paragraph.",
    );
  });

  it("keeps only the sentence around the caret", () => {
    expect(focused(doc, "sentence")).toBe("Second one here.");
  });

  it("counts a caret right after a full stop as part of that sentence", () => {
    expect(focused("One.| Two.", "sentence")).toBe("One.");
  });

  it("focuses headings and list items as their own blocks", () => {
    expect(focused("# Ti|tle\n\nText.", "paragraph")).toBe("# Title");
    expect(focused("- one\n- tw|o\n- three", "paragraph")).toBe("two");
  });

  it("works for Arabic sentences and paragraphs", () => {
    const arabic = "قال الكاتب: الكتابة أمانة. ثم سك|ت؟ نعم.";
    expect(focused(arabic, "sentence")).toBe("ثم سكت؟");
    expect(focused(arabic, "paragraph")).toBe(arabic.replaceAll("|", ""));
  });

  it("focuses nothing on a blank line", () => {
    expect(focused("One.\n|\nTwo.", "paragraph")).toBeNull();
  });

  it("treats the caret at the start of a paragraph as inside it", () => {
    expect(focused("One.\n\n|Two.", "paragraph")).toBe("Two.");
  });
});
