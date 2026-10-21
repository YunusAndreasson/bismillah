import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { openGoToLine } from "./goToLine.ts";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view?.dom.remove();
});

function editor(): EditorView {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "One\nبِسْمِ\nThree" }),
  });
  openGoToLine(view);
  return view;
}

function field(v: EditorView): HTMLInputElement {
  const input = v.dom.querySelector<HTMLInputElement>(".cm-goto-line input");
  if (!input) throw new Error("Go to line field missing");
  return input;
}

describe("line navigation feedback", () => {
  it("keeps invalid input in place with an accessible explanation and no document change", () => {
    const v = editor();
    const input = field(v);
    for (const value of ["", "no such line", "+", "1.5"]) {
      input.value = value;
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(v.dom.querySelector(".cm-goto-line")).not.toBeNull();
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const hint = v.dom.querySelector(".cm-navigation-feedback");
      expect(input.getAttribute("aria-describedby")).toBe(hint?.id);
      expect(hint?.getAttribute("aria-label")).toContain("Your position hasn't changed");
      expect(v.state.selection.main.head).toBe(0);
      expect(v.state.doc.toString()).toBe("One\nبِسْمِ\nThree");
    }
  });

  it("accepts a corrected position through the original submit button", async () => {
    const v = editor();
    const input = field(v);
    input.value = "oops";
    v.dom.querySelector<HTMLButtonElement>('.cm-goto-line button[type="submit"]')?.click();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.value = " 3:2 ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(v.dom.querySelector(".cm-navigation-feedback")?.textContent).toContain(
      "columns start at 0",
    );
    v.dom.querySelector<HTMLButtonElement>('.cm-goto-line button[type="submit"]')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(v.dom.querySelector(".cm-goto-line")).toBeNull();
    expect(v.state.selection.main.head).toBe(v.state.doc.line(3).from + 2);
    expect(v.state.doc.toString()).toBe("One\nبِسْمِ\nThree");
  });

  it("reuses one panel and keeps Escape as a non-editing exit", async () => {
    const v = editor();
    openGoToLine(v);
    expect(v.dom.querySelectorAll(".cm-navigation-feedback")).toHaveLength(1);
    field(v).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(v.dom.querySelector(".cm-goto-line")).toBeNull();
    expect(v.state.selection.main.head).toBe(0);
  });
});
