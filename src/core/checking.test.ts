import { describe, expect, it, vi } from "vitest";
import { Diagnostic } from "../editor/diagnostics.ts";
import { createEditor } from "../editor/setup.ts";
import { Checking, messageParts } from "./checking.svelte.ts";
import * as ipc from "./ipc.ts";
import { copy } from "./copy.ts";
import { IgnoredWords } from "./ignored.ts";

describe("pending spelling suggestions", () => {
  for (const action of ["close", "documentShown"] as const) {
    it(`drops a response that arrives after ${action}`, async () => {
      let release: ((values: string[]) => void) | undefined;
      const response = new Promise<string[]>((resolve) => {
        release = resolve;
      });
      const suggest = vi.spyOn(ipc, "lintSuggest").mockReturnValue(response);
      const parent = document.createElement("div");
      document.body.append(parent);
      const editor = createEditor({
        parent,
        doc: "recieve",
        config: { basmallah: false, livePreview: false, typewriter: false },
      });
      const checking = new Checking({
        editor: () => editor,
        documentKey: () => "scratch.md",
        checking: () => true,
        failed: () => {},
      });
      try {
        const opening = checking.open({
          from: 0,
          to: 7,
          diagnostic: new Diagnostic("spelling", "en", "", [], "spelling", "recieve"),
        });
        expect(suggest).toHaveBeenCalledOnce();
        checking[action]();
        release?.(["receive"]);
        await opening;
        expect(checking.menu).toBeNull();
        expect(editor.text()).toBe("recieve");
      } finally {
        editor.view.destroy();
        parent.remove();
        suggest.mockRestore();
      }
    });
  }
});

describe("grammar explanations", () => {
  it("turns Harper's backticks into quoted parts and ends the sentence", () => {
    expect(messageParts("Use `have` rather than `of` here.")).toEqual([
      { text: "Use ", quoted: false },
      { text: "have", quoted: true },
      { text: " rather than ", quoted: false },
      { text: "of", quoted: true },
      { text: " here.", quoted: false },
    ]);
    expect(messageParts("`About` is redundant")).toEqual([
      { text: "About", quoted: true },
      { text: " is redundant.", quoted: false },
    ]);
    expect(messageParts("Did you mean `there`?").at(-1)).toEqual({ text: "?", quoted: false });
  });
});

describe("ignored words", () => {
  it("are kept per document, as copies", () => {
    const ignored = new IgnoredWords();
    const first = ignored.add("a.md", "spelling:Ibn");
    expect([...first]).toEqual(["spelling:Ibn"]);
    expect([...ignored.of("a.md")]).toEqual(["spelling:Ibn"]);
    expect([...ignored.of("b.md")]).toEqual([]);
    ignored.add("a.md", "AnA:a");
    expect([...first]).toEqual(["spelling:Ibn"]);
    expect(ignored.of("a.md").size).toBe(2);
  });
});

describe("suggestion copy (DESIGN.md §14)", () => {
  it("names the kinds without calling grammar wrong", () => {
    expect(copy.checking.spelling).toBe("Possible spelling mistake");
    expect(copy.checking.grammar).toBe("Grammar suggestion");
    for (const text of Object.values(copy.checking)) {
      if (typeof text === "string") expect(text).not.toMatch(/\b(wrong|error)\b/i);
    }
  });

  it("says why Add to dictionary failed", () => {
    expect(
      copy.checking.addFailed("Taymiyya", { kind: "not_saved", error: { kind: "disk_full" } }),
    ).toBe("Couldn't add “Taymiyya” to your dictionary — the disk is full.");
  });
});
