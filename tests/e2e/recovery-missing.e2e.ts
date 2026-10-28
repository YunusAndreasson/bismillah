import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { remote } from "webdriverio";
import { waitForApp } from "../app.ts";
import { capabilities } from "../driver.ts";
import { Folder } from "./files.ts";

describe("recovery when the original file is missing", () => {
  it("opens retained text without recreating a missing file or folder", async () => {
    const folder = new Folder();
    const anchor = folder.file("anchor.md", "another document\n");
    let active: WebdriverIO.Browser = browser;
    try {
      for (const missing of ["file", "folder"]) {
        await waitForApp(active);
        const parent = join(folder.path, missing);
        mkdirSync(parent);
        const path = join(parent, "lost.md");
        const text = "unsaved ḥadīth — حَدِيث\n";
        // A failed save leaves durable recovery before the original disappears.
        writeFileSync(path, "old text\n");
        await active.execute(
          async (p: string, value: string) => {
            const hooks = window.__bismillah;
            if (!hooks) throw new Error("missing test hooks");
            await hooks.open(p);
            await hooks.fault("disk_full");
            await hooks.setDoc(value);
            await hooks.flush();
          },
          path,
          text,
        );
        const pid = await active.execute(async () => (await window.__bismillah?.pid()) ?? 0);
        expect(pid).toBeGreaterThan(0);
        process.kill(pid, "SIGKILL");
        await active.deleteSession().catch(() => undefined);
        rmSync(missing === "file" ? path : parent, { recursive: true });
        active = await remote({
          hostname: "127.0.0.1",
          port: browser.options.port ?? 0,
          logLevel: "warn",
          capabilities: capabilities([anchor]),
        });
        await waitForApp(active);
        await active.execute(async () => {
          await window.__bismillah?.act("Open “lost.md”");
        });
        const notices = await active.execute(() => window.__bismillah?.notices() ?? []);
        expect(notices.some((n) => n.actions.includes("Restore"))).toBe(true);
        expect(existsSync(path)).toBe(false);
        await active.execute(async () => {
          await window.__bismillah?.act("Restore");
        });
        expect(await active.execute(() => window.__bismillah?.view.state.doc.toString())).toBe(
          text,
        );
        expect(existsSync(path)).toBe(false);
        const output = missing === "file" ? path : join(folder.path, "rescued.md");
        if (missing === "file") {
          await active.execute(async () => {
            await window.__bismillah?.act("Save it again");
          });
        } else {
          await active.execute(async (p: string) => {
            await window.__bismillah?.nextDialog(p);
            await window.__bismillah?.act("Save elsewhere…");
          }, output);
          expect(existsSync(parent)).toBe(false);
        }
        expect(readFileSync(output, "utf8")).toBe(text);
      }
    } finally {
      await active.deleteSession().catch(() => undefined);
      folder.remove();
    }
  });
});
