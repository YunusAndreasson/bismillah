import { describe, expect, it } from "vitest";
import { arrivedAs, exact, nameParts, receiving, refused, runStanding } from "./receiving.ts";

describe("the words for receiving", () => {
  it("counts bytes in plain English", () => {
    expect(exact(1)).toBe("Exact, 1 byte");
    expect(exact(50_123)).toBe("Exact, 50,123 bytes");
    expect(receiving(12, 1_040)).toBe("Receiving, 12 of 1,040");
  });

  it("names a print that wasn't sealed, and needs no word for one that was", () => {
    expect(arrivedAs(5, true)).toBe("Exact, 5 bytes");
    expect(arrivedAs(5, false)).toBe("Exact, 5 bytes. Not sealed");
    expect(refused("other_key")).toContain("sealed to another key");
  });

  it("names what a run still lacks, in the stick's numbers", () => {
    const run = (have: number, count: number, lacks: number[], lacks_more = 0) => ({
      have,
      count,
      lacks,
      lacks_more,
    });
    expect(runStanding(run(2, 3, [3]))).toBe("2 of 3 texts are here. Still lacks 3.");
    expect(runStanding(run(1, 3, [1, 3]))).toBe("1 of 3 texts are here. Still lacks 1 and 3.");
    expect(runStanding(run(0, 1_012, [1, 2], 1_010))).toBe(
      "0 of 1,012 texts are here. Still lacks 1, 2 and 1,010 more.",
    );
    expect(runStanding(run(12, 12, []))).toBe("All 12 texts are here, each exact.");
    expect(runStanding(run(1, 1, []))).toBe("The 1 text is here, exact.");
  });

  it("keeps a name's ending out of its isolate", () => {
    expect(nameParts("نص.md")).toEqual({ stem: "نص", ending: ".md" });
    expect(nameParts("Chapter.MARKDOWN")).toEqual({ stem: "Chapter", ending: ".MARKDOWN" });
    expect(nameParts("notes.txt")).toEqual({ stem: "notes.txt", ending: "" });
  });

  it("says nothing was stored, whatever went wrong", () => {
    for (const error of ["damaged", "version", "too_long", "not_stored", "unknown", null]) {
      expect(refused(error)).toMatch(/nothing was (stored|kept)/);
    }
  });

  it("never claims more on an error it doesn't know", () => {
    expect(refused({ message: "toString" })).toBe(refused("not_stored"));
    expect(refused("toString")).toBe(refused("not_stored"));
  });
});
