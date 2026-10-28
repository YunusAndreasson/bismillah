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
  for (const keepLocal of [false, true]) {
    it(`returns the last opened document if a later recovery write fails (${keepLocal})`, async () => {
      let text = "ours";
      let calls = 0;
      const result = quietReload({
        id: 1,
        keepLocal,
        text: () => text,
        reload: () => {
          if (++calls === 2) return Promise.reject(new Error("recovery unavailable"));
          text = "newer edits";
          return Promise.resolve({ id: 10, text: "theirs" } as OpenedDocument);
        },
      });
      await expect(result).resolves.toMatchObject({ opened: { id: 10 }, keepFailed: true });
      expect(text).toBe("newer edits");
    });
  }

  it("still rejects an initial reload failure, which has opened no replacement", async () => {
    await expect(
      quietReload({
        id: 1,
        text: () => "ours",
        reload: () => Promise.reject(new Error("initial recovery unavailable")),
      }),
    ).rejects.toThrow("initial recovery unavailable");
  });

  it("keeps the initial text for an explicit Load theirs", async () => {
    const text = "ours\n";
    const rust = fakeRust("theirs\n", () => {});
    const { opened, kept } = await quietReload({
      id: 1,
      keepLocal: true,
      text: () => text,
      reload: rust.reload,
    });
    expect(opened).toMatchObject({ id: 10, text: "theirs\n" });
    expect(kept).toBe(true);
    expect(rust.kept).toEqual([text]);
  });

  it("keeps repeated additions and a deletion during an explicit Load theirs", async () => {
    let text = "ours\n";
    const rust = fakeRust("theirs\n", (call) => {
      if (call === 1) text = "ours\nحَدِيث";
      if (call === 2) text = "";
    });
    const { opened, kept } = await quietReload({
      id: 1,
      keepLocal: true,
      text: () => text,
      reload: rust.reload,
    });
    expect(kept).toBe(true);
    expect(opened.id).toBe(12);
    expect(rust.kept).toEqual(["ours\n", "ours\nحَدِيث", ""]);
  });

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
