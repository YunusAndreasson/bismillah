import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { remote } from "webdriverio";
import { waitForApp } from "../app.ts";
import { capabilities } from "../driver.ts";
import { fault, flush, Folder, open, typeAtEnd } from "./files.ts";

/**
 * A killed process leaves restorable text (PLAN.md Phase 1 accept, ARCHITECTURE.md §5.7).
 * The app is killed with SIGKILL while a save keeps failing, then started again on the
 * same file: the text is offered, restored and saved.
 *
 * This spec ends the session wdio started (by killing its app), so it lives on its own.
 */
describe("recovery after a killed process", () => {
  it("offers the unsaved text in the next session and saves it when restored", async () => {
    await waitForApp(browser);
    const folder = new Folder();
    const path = folder.file("killed.md", "on disk\n");
    await open(path);
    await fault("disk_full");
    await typeAtEnd("written before the crash");
    expect(await flush()).toBe(false);
    const pid = await browser.execute(async () => (await window.__bismillah?.pid()) ?? 0);
    expect(pid).toBeGreaterThan(0);
    process.kill(pid, "SIGKILL");
    expect(readFileSync(path, "utf8")).toBe("on disk\n");
    // The driver allows one session; end the dead one before starting the app again.
    await browser.deleteSession().catch(() => undefined);

    const next = await remote({
      hostname: "127.0.0.1",
      port: browser.options.port ?? 0,
      logLevel: "warn",
      capabilities: capabilities([path]),
    });
    try {
      await waitForApp(next);
      const notices = await next.execute(() => window.__bismillah?.notices() ?? []);
      expect(notices[0]?.message).toMatch(/^Unsaved text from .+ was kept for “killed\.md”\.$/);
      expect(notices[0]?.actions).toEqual(["Restore", "Discard"]);
      expect(await next.execute(() => window.__bismillah?.view.state.doc.toString())).toBe(
        "on disk\n",
      );
      await next.execute(async () => {
        await window.__bismillah?.act("Restore");
      });
      await next.waitUntil(
        () => next.execute(() => window.__bismillah?.saveState()?.state.kind === "saved"),
        { timeout: 5000 },
      );
      expect(readFileSync(path, "utf8")).toBe("on disk\nwritten before the crash");
      const left = await next.execute(() => window.__bismillah?.notices() ?? []);
      expect(left.filter((n) => n.message.includes("killed.md"))).toEqual([]);

      // Quitting saves pending edits first and remembers the window.
      await next.execute(() => {
        const view = window.__bismillah?.view;
        view?.dispatch({ changes: { from: view.state.doc.length, insert: " Then quit." } });
        window.__bismillah?.run("app.quit");
      });
      await next.waitUntil(
        () => readFileSync(path, "utf8") === "on disk\nwritten before the crash Then quit.",
        { timeout: 5000, timeoutMsg: "quitting didn't save the last edit" },
      );
    } finally {
      await next.deleteSession().catch(() => undefined);
      folder.remove();
    }
    const state = join(process.env.XDG_DATA_HOME ?? "", "bismillah", "state.json");
    for (let i = 0; i < 50 && !existsSync(state); i++) await new Promise((r) => setTimeout(r, 100));
    const remembered = JSON.parse(readFileSync(state, "utf8")) as {
      last_document?: string;
      window?: { width: number; height: number };
    };
    expect(remembered.last_document?.endsWith("killed.md")).toBe(true);
    expect(remembered.window?.width).toBeGreaterThanOrEqual(480);
  });
});
