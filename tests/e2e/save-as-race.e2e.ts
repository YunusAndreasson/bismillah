import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { Folder, docText } from "./files.ts";

describe("typing while Save elsewhere completes", () => {
  for (const [name, latest, cancelled] of [
    ["keeps newly typed English and Arabic", "Snapshot حَدِيث\nLater ﷺ\n", false],
    ["keeps a deletion to an empty document", "", false],
    ["keeps edits when the dialog is cancelled", "Still here حَدِيث\n", true],
  ] as const) {
    it(name, async () => {
      await waitForApp(browser);
      const folder = new Folder();
      const original = folder.file("original.md", "\uFEFFOriginal\r\n");
      const destination = join(folder.path, "saved.md");
      const snapshot = "Snapshot حَدِيث\n";
      try {
        await browser.execute(
          async (path: string, text: string, target: string | null) => {
            const hooks = window.__bismillah;
            if (!hooks) throw new Error("missing hooks");
            await hooks.open(path);
            await hooks.fault("disk_full");
            await hooks.setDoc(text);
            await hooks.flush();
            await hooks.nextDialog(target);
          },
          original,
          snapshot,
          cancelled ? null : destination,
        );
        await browser.execute(async (newText: string) => {
          const hooks = window.__bismillah;
          if (!hooks) throw new Error("missing hooks");
          // Start the actual save, then type before its asynchronous reply arrives.
          const saving = hooks.act("Save elsewhere…");
          const view = hooks.view;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newText },
            selection: { anchor: newText.length },
          });
          await saving;
        }, latest);
        expect(await docText()).toBe(latest);
        expect(
          await browser.execute(() => window.__bismillah?.view.state.selection.main.head),
        ).toBe(latest.length);
        if (cancelled) expect(existsSync(destination)).toBe(false);
        else expect(readFileSync(destination, "utf8")).toBe("\uFEFFSnapshot حَدِيث\r\n");
        const state = await browser.execute(() => window.__bismillah?.saveState());
        expect(state?.revision).toBeGreaterThan(state?.savedRevision ?? 0);
        await browser.execute(async () => {
          await window.__bismillah?.fault(null);
          await window.__bismillah?.flush();
        });
        const saved = cancelled ? original : destination;
        expect(readFileSync(saved, "utf8")).toBe(`\uFEFF${latest.replace(/\n/g, "\r\n")}`);
      } finally {
        await browser.execute(async () => {
          await window.__bismillah?.fault(null);
        });
        folder.remove();
      }
    });
  }
});
