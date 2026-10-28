import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { Folder, docText, fault, flush, open } from "./files.ts";

describe("typing while Load theirs completes", () => {
  it("can save elsewhere when retaining newer text exceeds the recovery limit", async function () {
    this.timeout(120_000);
    await waitForApp(browser);
    const folder = new Folder();
    const path = folder.file("large-conflict.md", "\uFEFFOriginal\r\n");
    const destination = join(folder.path, "rescued.md");
    try {
      await open(path);
      await fault("disk_full");
      await browser.execute(async () => {
        await window.__bismillah?.setDoc("small local snapshot\n");
      });
      expect(await flush()).toBe(false);
      writeFileSync(path, "\uFEFFThe other version.\r\n");
      await fault(null);
      expect(await flush()).toBe(false);
      await browser.execute(async () => {
        const hooks = window.__bismillah;
        if (!hooks) throw new Error("missing hooks");
        const pending = hooks.act("Load theirs");
        // Slightly over the real 16 MiB recovery cap, without filling a real disk.
        const text = "```\n" + ("x".repeat(255) + "\n").repeat(65_537) + "```\nlatest حَدِيث\n";
        const view = hooks.view;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        await pending;
        await hooks.flush();
      });
      expect(readFileSync(path, "utf8")).toBe("\uFEFFThe other version.\r\n");
      await browser.execute(async (target: string) => {
        const hooks = window.__bismillah;
        if (!hooks) throw new Error("missing hooks");
        await hooks.nextDialog(target);
        const label = hooks
          .notices()
          .flatMap((n) => n.actions)
          .find((a) => a === "Save mine as…" || a === "Save elsewhere…");
        if (!label) throw new Error("missing save action");
        await hooks.act(label);
      }, destination);
      expect(existsSync(destination)).toBe(true);
      const text = "```\n" + ("x".repeat(255) + "\n").repeat(65_537) + "```\nlatest حَدِيث\n";
      const expected = createHash("sha256")
        .update("\uFEFF" + text.replace(/\n/g, "\r\n"))
        .digest("hex");
      expect(createHash("sha256").update(readFileSync(destination)).digest("hex")).toBe(expected);
    } finally {
      await fault(null);
      folder.remove();
    }
  });

  for (const [name, latest] of [
    ["keeps newer English and Arabic in recovery", "Mine حَدِيث\nMore ﷺ\n"],
    ["keeps a deletion to empty text in recovery", ""],
  ] as const) {
    it(name, async () => {
      await waitForApp(browser);
      const folder = new Folder();
      const path = folder.file("conflict.md", "\uFEFFOriginal\r\n");
      try {
        await open(path);
        await fault("disk_full");
        await browser.execute(async () => {
          await window.__bismillah?.setDoc("Mine حَدِيث\n");
        });
        expect(await flush()).toBe(false);
        writeFileSync(path, "\uFEFFThe other version.\r\n");
        await fault(null);
        expect(await flush()).toBe(false);
        await browser.execute(async (text: string) => {
          const hooks = window.__bismillah;
          if (!hooks) throw new Error("missing hooks");
          const reloading = hooks.act("Load theirs");
          const view = hooks.view;
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
          await reloading;
        }, latest);
        expect(await docText()).toBe("The other version.\n");
        expect(readFileSync(path, "utf8")).toBe("\uFEFFThe other version.\r\n");
        await browser.execute(async () => {
          await window.__bismillah?.act("Restore");
        });
        expect(await docText()).toBe(latest);
        expect(readFileSync(path, "utf8")).toBe(`\uFEFF${latest.replace(/\n/g, "\r\n")}`);
      } finally {
        await fault(null);
        folder.remove();
      }
    });
  }
});
