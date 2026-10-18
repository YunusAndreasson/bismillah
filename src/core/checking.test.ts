import { describe, expect, it } from "vitest";
import { messageParts } from "./checking.svelte.ts";
import { copy } from "./copy.ts";
import { IgnoredWords } from "./ignored.ts";

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
