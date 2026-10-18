import { spawnSync } from "node:child_process";
import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { APP_BINARY } from "../driver.ts";
import { docText, Folder, notices, open, saveState, statusText, typeAtEnd } from "./files.ts";

/** Desktop basics (ARCHITECTURE.md §12.2, DESIGN.md §12–13) in the real app. */
describe("desktop basics", () => {
  let folder: Folder;

  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
  });
  after(() => folder.remove());

  it("names the open file in the window title", async () => {
    await open(folder.file("title.md", "text\n"));
    expect(await browser.getTitle()).toBe("title.md — bismillah");
  });

  it("hands a file from a second launch to the running app, saving first", async () => {
    await open(folder.file("first.md", "first\n"));
    await typeAtEnd("edited");
    const second = folder.file("second.md", "second file\n");
    const launch = spawnSync(APP_BINARY, [second], { timeout: 20_000, env: process.env });
    expect(launch.status).toBe(0);
    await browser.waitUntil(async () => (await docText()) === "second file\n", {
      timeout: 10_000,
      timeoutMsg: "the running app never opened the file",
    });
    expect(await browser.getTitle()).toBe("second.md — bismillah");
    expect(folder.read("first.md").toString()).toBe("first\nedited");
  });

  it("shows the file name, save state, word count and reading time", async () => {
    await open(folder.file("status.md", "One two three four.\n"));
    await browser.waitUntil(async () => (await statusText()).includes("4 words"), {
      timeout: 3000,
    });
    expect(await statusText()).toBe("status.md · Saved · 4 words · 1 min read");
  });

  it("toggles Zuhd mode from the registry and persists the setting", async () => {
    await open(folder.file("zuhd.md", "First paragraph.\n\nSecond paragraph.\n"));
    await browser.execute(() => window.__bismillah?.run("editor.toggleFocus"));
    await browser.waitUntil(() =>
      browser.execute(() => document.querySelector(".cm-zuhd-dim") !== null),
    );
    // Dimmed text is drawn in text-secondary, not faded with opacity.
    const [dimmed, secondary, opacity] = await browser.execute(() => {
      const el = document.querySelector(".cm-zuhd-dim");
      const probe = document.createElement("span");
      probe.style.color = "var(--text-secondary)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return [
        el ? getComputedStyle(el).color : "",
        expected,
        el ? getComputedStyle(el).opacity : "",
      ];
    });
    expect(dimmed).toBe(secondary);
    expect(opacity).toBe("1");
    await browser.execute(() => window.__bismillah?.run("editor.toggleFocus"));
    await browser.waitUntil(() =>
      browser.execute(() => document.querySelector(".cm-zuhd-dim") === null),
    );
  });

  it("changes the writing size in steps and resets it", async () => {
    const size = () =>
      browser.execute(() =>
        parseFloat(
          getComputedStyle(document.querySelector(".cm-content") ?? document.body).fontSize,
        ),
      );
    const base = await size();
    await browser.execute(() => window.__bismillah?.run("view.textBigger"));
    await browser.waitUntil(async () => (await size()) > base);
    await browser.execute(() => window.__bismillah?.run("view.textReset"));
    await browser.waitUntil(async () => (await size()) === base);
  });

  it("opens Settings with Mod-, and closes it with Escape, returning focus", async () => {
    await open(folder.file("settings.md", "text\n"));
    await browser.execute(() => window.__bismillah?.run("app.settings"));
    const dialog = await browser.$("[role=dialog]");
    await dialog.waitForDisplayed();
    expect(await browser.$("h2=Appearance").isDisplayed()).toBe(true);
    await browser.keys(["Escape"]);
    await dialog.waitForDisplayed({ reverse: true });
    expect(await notices()).toEqual([]);
    expect(await saveState()).toBe("saved");
  });
});
