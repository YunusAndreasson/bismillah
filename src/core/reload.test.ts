import { describe, expect, it } from "vitest";
import type { OpenedDocument } from "./ipc.ts";
import { quietReload } from "./reload.ts";

/** A stand-in for Rust's doc_reload: each call opens the file afresh under a new id, and
 * `typing` runs while it is "reading", as the writer might. */
function fakeRust(disk: string, typing: (call: number) => void) {
  const kept: string[] = [];
  let next = 10;
  let calls = 0;
  const reload = async (_id: number, local: string | null): Promise<OpenedDocument> => {
    calls++;
    if (local !== null) kept.push(local);
    typing(calls);
    await Promise.resolve();
    return { id: next++, text: disk } as OpenedDocument;
  };
  return { reload, kept };
}

describe("the quiet reload", () => {
  it("takes the new version when nothing was typed while it was read", async () => {
    const text = "ours\n";
    const rust = fakeRust("theirs\n", () => {});
    const { opened, kept } = await quietReload({ id: 1, text: () => text, reload: rust.reload });
    expect(opened).toMatchObject({ id: 10, text: "theirs\n" });
    expect(kept).toBe(false);
    expect(rust.kept).toEqual([]);
  });

  it("keeps text typed while the new version was read, never replacing it unseen", async () => {
    let text = "ours\n";
    const rust = fakeRust("theirs\n", (call) => {
      if (call === 1) text = "ours\nmine";
    });
    const { opened, kept } = await quietReload({ id: 1, text: () => text, reload: rust.reload });
    expect(kept).toBe(true);
    expect(rust.kept).toEqual(["ours\nmine"]);
    // The last reload opened the file with the kept text on offer.
    expect(opened.id).toBe(11);
  });

  it("keeps the newest text when the writer types again meanwhile", async () => {
    let text = "ours\n";
    const rust = fakeRust("theirs\n", (call) => {
      if (call === 1) text = "ours\nm";
      if (call === 2) text = "ours\nmine";
    });
    const { kept } = await quietReload({ id: 1, text: () => text, reload: rust.reload });
    expect(kept).toBe(true);
    expect(rust.kept).toEqual(["ours\nm", "ours\nmine"]);
  });
});
