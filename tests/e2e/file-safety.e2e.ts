import { writeFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import {
  act,
  docText,
  fault,
  flush,
  Folder,
  notices,
  open,
  recoveryTexts,
  saveError,
  saveState,
  statusText,
  typeAtEnd,
  waitForState,
} from "./files.ts";

/**
 * The file-safety contract in the real app (ARCHITECTURE.md §5, PLAN.md Phase 1 accept):
 * exact round-trips, honest save state, visible failures with the text preserved, and
 * conflicts that never overwrite.
 */

const VOCALISED =
  "# بِسْمِ ٱللَّهِ\n\nقُلْ هُوَ ٱللَّهُ أَحَدٌ — *ḥadīth*, ʿilm and “quotes”.\nMixed: Allāh (ٱللَّه) said.\n";

describe("file safety", () => {
  let folder: Folder;

  before(async () => {
    await waitForApp(browser);
  });
  beforeEach(() => {
    folder = new Folder();
  });
  afterEach(async () => {
    await fault(null);
    folder.remove();
  });

  for (const [name, bytes] of [
    ["vocalised.md", Buffer.from(VOCALISED)],
    ["crlf.md", Buffer.from(VOCALISED.replaceAll("\n", "\r\n"))],
    [
      "bom-crlf.md",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Title\r\n\r\nبِسْمِ\r\n")]),
    ],
    ["no-final-newline.md", Buffer.from("last line without a newline ـ ﷽")],
  ] as const) {
    it(`round-trips ${name} byte for byte`, async () => {
      const path = folder.file(name, bytes);
      await open(path);
      expect(await saveState()).toBe("saved");
      // An edit and its undo: a new revision with the original text.
      await typeAtEnd("x");
      await browser.keys(["Backspace"]);
      expect(await flush()).toBe(true);
      expect(folder.read(name).equals(bytes)).toBe(true);
    });
  }

  it("writes edits with the file's own line endings", async () => {
    const path = folder.file("edit.md", "one\r\ntwo\r\n");
    await open(path);
    await typeAtEnd("three");
    expect(await flush()).toBe(true);
    expect(folder.read("edit.md").toString()).toBe("one\r\ntwo\r\nthree");
    expect(await statusText()).toContain("Saved");
  });

  it("shows Saved only after the save, and saves after the typing pause", async () => {
    const path = folder.file("pause.md", "start\n");
    await open(path);
    await typeAtEnd("abc");
    expect(await saveState()).toBe("saving");
    await waitForState("saved");
    expect(folder.read("pause.md").toString()).toBe("start\nabc");
  });

  it("makes an injected disk-full failure visible and keeps the text", async () => {
    const path = folder.file("full.md", "original\n");
    await open(path);
    await fault("disk_full");
    await typeAtEnd("unsaved words");
    expect(await flush()).toBe(false);
    expect(await saveError()).toBe("disk_full");
    expect(await statusText()).toContain("Not saved — the disk is full");
    const [notice] = await notices();
    expect(notice?.message).toBe(
      "Couldn't save “full.md” — the disk is full. Your text is kept in recovery.",
    );
    expect(notice?.actions).toEqual(["Try again", "Save elsewhere…"]);
    expect(folder.read("full.md").toString()).toBe("original\n");
    expect(recoveryTexts()).toContain("original\nunsaved words");
    // The failure stays visible through further typing.
    await typeAtEnd("!");
    await browser.pause(800);
    expect(await saveError()).toBe("disk_full");

    await fault(null);
    await act("Try again");
    await waitForState("saved");
    expect(folder.read("full.md").toString()).toBe("original\nunsaved words!");
    expect(await notices()).toEqual([]);
    expect(recoveryTexts()).not.toContain("original\nunsaved words!");
  });

  it("leaves the original intact when the rename fails", async () => {
    const path = folder.file("rename.md", "before\n");
    await open(path);
    await fault("rename_fails");
    await typeAtEnd("after");
    expect(await flush()).toBe(false);
    expect(folder.read("rename.md").toString()).toBe("before\n");
    expect((await notices())[0]?.message).toContain("Couldn't save “rename.md”");
  });

  it("explains a read-only folder", async function () {
    // Root ignores permission bits, and the offline run maps the user to root in its
    // namespace; the disk-full and rename cases above cover failures there.
    if (process.getuid?.() === 0) this.skip();
    const path = folder.file("locked.md", "locked\n");
    await open(path);
    folder.lock();
    await typeAtEnd("!");
    expect(await flush()).toBe(false);
    expect(await saveError()).toBe("permission_denied");
    expect(await statusText()).toContain("Not saved — bismillah isn't allowed to write there");
    folder.unlock();
    await act("Try again");
    await waitForState("saved");
    expect(folder.read("locked.md").toString()).toBe("locked\n!");
  });

  it("never overwrites a file changed by another program; Keep mine saves over it", async () => {
    const path = folder.file("shared.md", "ours\n");
    await open(path);
    writeFileSync(path, "theirs, from another editor\n");
    await typeAtEnd("mine");
    expect(await flush()).toBe(false);
    expect(await saveError()).toBe("conflict");
    expect((await notices())[0]?.actions).toEqual(["Keep mine", "Load theirs", "Save mine as…"]);
    expect(folder.read("shared.md").toString()).toBe("theirs, from another editor\n");
    await act("Keep mine");
    await waitForState("saved");
    expect(folder.read("shared.md").toString()).toBe("ours\nmine");
  });

  it("Load theirs reloads the file and keeps the writer's version in recovery", async () => {
    const path = folder.file("theirs.md", "ours\n");
    await open(path);
    writeFileSync(path, "theirs\n");
    await typeAtEnd("my words");
    await flush();
    await act("Load theirs");
    expect(await docText()).toBe("theirs\n");
    expect(await saveState()).toBe("saved");
    expect(recoveryTexts()).toContain("ours\nmy words");
  });

  it("reloads quietly on focus when there are no local edits", async () => {
    const path = folder.file("quiet.md", "first version\n");
    await open(path);
    writeFileSync(path, "second version\n");
    await browser.execute(async () => {
      await window.__bismillah?.regainFocus();
    });
    expect(await docText()).toBe("second version\n");
    expect(await notices()).toEqual([]);
  });

  it("flags a conflict on focus when there are local edits", async () => {
    const path = folder.file("edited.md", "first\n");
    await open(path);
    await fault("disk_full");
    await typeAtEnd("local");
    await flush();
    await fault(null);
    writeFileSync(path, "changed elsewhere\n");
    await browser.execute(async () => {
      await window.__bismillah?.regainFocus();
    });
    expect(await saveError()).toBe("conflict");
    expect(await docText()).toBe("first\nlocal");
  });

  it("opens a file that isn't UTF-8 read-only and never changes it", async () => {
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const path = folder.file("latin1.md", bytes);
    await open(path);
    expect(await saveState()).toBe("read_only");
    expect((await notices())[0]?.message).toBe(
      "“latin1.md” isn't UTF-8 text, so it opened read-only and stays unchanged.",
    );
    await typeAtEnd("x", { readOnly: true });
    expect(await docText()).toBe("caf�\n");
    expect(folder.read("latin1.md").equals(bytes)).toBe(true);
  });
});
