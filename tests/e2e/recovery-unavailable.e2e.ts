import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  typeAtEnd,
} from "./files.ts";

/** Keep every existing journal entry intact while blocking the recovery path.
 * chmod is insufficient: create_private_dir repairs the directory's permissions. */
function blockRecovery(): () => void {
  const recovery = join(process.env.XDG_DATA_HOME ?? "", "bismillah", "recovery");
  const backup = `${recovery}-regression-backup`;
  const existed = existsSync(recovery);
  if (existed) renameSync(recovery, backup);
  writeFileSync(recovery, "blocked recovery fixture");
  let active = true;
  return () => {
    if (!active) return;
    unlinkSync(recovery);
    if (existed) renameSync(backup, recovery);
    active = false;
  };
}

describe("when saving and recovery both fail", () => {
  it("keeps the text open until a durable copy exists", async () => {
    await waitForApp(browser);
    const folder = new Folder();
    const original = folder.file("original.md", "بِسْمِ الله — original\n");
    folder.file("next.md", "next document\n");
    const created = join(folder.path, "new.md");
    let restoreRecovery = () => {};
    try {
      await browser.execute(async (path) => window.__bismillah?.setLibrary(path), folder.path);
      await open(original);
      restoreRecovery = blockRecovery();
      await fault("disk_full");
      await typeAtEnd("unsaved fixture words");
      expect(await flush()).toBe(false);
      const text = await docText();
      expect((await notices())[0]?.message).toContain("only in this window");
      expect((await notices())[0]?.message).not.toContain("kept in recovery");

      await browser.execute(async () => window.__bismillah?.openLibraryFile("next.md"));
      expect(await docText()).toBe(text);
      await browser.execute(async (path) => {
        await window.__bismillah?.nextDialog(path);
        await window.__bismillah?.newFile();
      }, created);
      expect(await docText()).toBe(text);
      expect(existsSync(created)).toBe(false);

      // Tauri awaits the close handler: a failed unprotected save must veto it.
      await browser.execute(async () => {
        window.__bismillah?.run("app.quit");
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(await docText()).toBe(text);

      // Recovery can protect a failed save once its directory is writable again.
      restoreRecovery();
      expect(await flush()).toBe(false);
      expect((await notices())[0]?.message).toContain("kept in recovery");
      expect(recoveryTexts()).toContain(text);
      // A retry can overwrite the old mirror: its confirmation must be forgotten.
      restoreRecovery = blockRecovery();
      expect(await flush()).toBe(false);
      expect((await notices())[0]?.message).toContain("only in this window");
      await browser.execute(async () => window.__bismillah?.newFile());
      expect(await docText()).toBe(text);
      expect(existsSync(created)).toBe(false);
      restoreRecovery();
      expect(await flush()).toBe(false);
      await browser.execute(async () => window.__bismillah?.openLibraryFile("next.md"));
      expect(await docText()).toBe("next document\n");
      await browser.execute(async () => window.__bismillah?.newFile());
      expect(existsSync(created)).toBe(true);
    } finally {
      restoreRecovery();
      await fault(null);
      await flush();
      folder.remove();
    }
  });
  it("can save elsewhere even while recovery remains unavailable", async () => {
    await waitForApp(browser);
    const folder = new Folder();
    const original = folder.file("elsewhere.md", "بِسْمِ الله — original\n");
    const saved = join(folder.path, "safe-copy.md");
    let restoreRecovery = () => {};
    try {
      await open(original);
      restoreRecovery = blockRecovery();
      await fault("disk_full");
      await typeAtEnd("unsaved fixture words");
      expect(await flush()).toBe(false);
      const text = await docText();
      await browser.execute(async (path) => window.__bismillah?.nextDialog(path), saved);
      await act("Save elsewhere…");
      expect(readFileSync(saved, "utf8")).toBe(text);
      expect(await docText()).toBe(text);
      expect(await flush()).toBe(true);
    } finally {
      restoreRecovery();
      await fault(null);
      await flush();
      folder.remove();
    }
  });
});
