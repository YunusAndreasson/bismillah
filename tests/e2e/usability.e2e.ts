import { browser, expect } from "@wdio/globals";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { settle, setViewport, waitForApp } from "../app.ts";
import { docText, Folder, open } from "./files.ts";

const shots = "/tmp/bismillah-usability-review";

describe("usability: feedback, discovery and escape routes", () => {
  let folder: Folder;
  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    mkdirSync(shots, { recursive: true });
    await browser.execute(async () =>
      window.__bismillah?.changeSettings({ fade_chrome: false, typewriter_scrolling: false }),
    );
  });
  after(() => folder.remove());

  afterEach(async () => {
    await browser.keys("Escape");
  });

  it("offers the Guide on the first screen without needing a hidden menu", async () => {
    await setViewport(browser, 640, 700);
    await browser.execute(() => window.__bismillah?.welcome());
    await settle(browser);
    await browser.saveScreenshot(`${shots}/after-welcome.png`);
    expect(await browser.$(".welcome .guide kbd").getText()).toBe("F1");
    await browser.$(".welcome .guide").click();
    await browser.waitUntil(async () => (await browser.getTitle()) === "guide.md — bismillah");
    expect(await browser.$(".status").getText()).toContain("changes aren't saved");
  });

  it("starts the Commands panel in its field, shows both toggle states and restores keyboard focus", async () => {
    await open(folder.file("specimen.md", readFileSync("docs/specimen.md", "utf8")));
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ focus_mode: false });
      window.__bismillah?.view.focus();
      window.__bismillah?.run("app.commandPalette");
    });
    await browser.$(".panel").waitForDisplayed();
    expect(
      await browser.execute(() => document.activeElement?.classList.contains("panel-input")),
    ).toBe(true);
    await browser.$(".panel-input").setValue("Zuhd");
    await browser.waitUntil(async () =>
      (await browser.$(".panel-row.current").getText()).includes("Off"),
    );
    // A switch changes in place: the panel stays, showing the new state.
    await browser.keys("Enter");
    await browser.waitUntil(async () =>
      (await browser.$(".panel-row.current").getText()).includes("On"),
    );
    await browser.saveScreenshot(`${shots}/after-commands.png`);
    await browser.$(".panel-close").click();
    await browser.$(".panel").waitForDisplayed({ reverse: true });
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement === window.__bismillah?.view.contentDOM),
    );
    await browser.execute(async () => window.__bismillah?.changeSettings({ focus_mode: false }));
    expect(await docText()).toBe(readFileSync("docs/specimen.md", "utf8"));
  });

  it("distinguishes an empty library from a failed query and offers a working New file action", async () => {
    const empty = new Folder();
    const action = (label: string) =>
      browser.$(`//*[contains(@class,'panel-row')][normalize-space()='${label}']`);
    try {
      await browser.execute(
        async (path: string) => window.__bismillah?.setLibrary(path),
        empty.path,
      );
      await browser.execute(() => window.__bismillah?.run("file.quickOpen"));
      await browser.$(".panel-note").waitForDisplayed();
      expect(await browser.$(".panel-note").getText()).toContain("No Markdown files in");
      await browser.execute(async () => window.__bismillah?.nextDialog(null));
      await action("New file…").click();
      await browser.$(".panel").waitForDisplayed({ reverse: true });
      await browser.waitUntil(() =>
        browser.execute(() => document.activeElement === window.__bismillah?.view.contentDOM),
      );
      await browser.execute(() => window.__bismillah?.run("file.quickOpen"));
      await browser.execute(
        async (path: string) => window.__bismillah?.nextDialog(path),
        join(empty.path, "new.md"),
      );
      await action("New file…").click();
      await browser.waitUntil(async () => (await browser.getTitle()).startsWith("new.md"));
      expect(empty.read("new.md").toString()).toBe("");
      await browser.execute(() => window.__bismillah?.run("file.quickOpen"));
      await browser.$(".panel-input").setValue("no-such-file");
      // The title can update before the debounced library watcher reports the new file.
      await browser.waitUntil(
        async () => (await browser.$(".panel-note").getText()) === "No file or folder matches.",
      );
      expect(await browser.$(".panel-row").isExisting()).toBe(false);
      await browser.keys("Escape");
    } finally {
      await open(folder.file("back.md", "بِسْمِ scatter"));
      empty.remove();
    }
  });

  it("explains failed searches and regex errors beside the field without editing text", async () => {
    const original = "بِسْمِ scatter";
    await open(folder.file("feedback.md", original));
    await browser.execute(() => window.__bismillah?.run("edit.find"));
    const query = async (text: string) =>
      browser.execute((value: string) => {
        const field = document.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
        if (!field) throw new Error("search field missing");
        field.value = value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }, text);
    await query("cat");
    await browser.$('.cm-search [name="word"]').click();
    expect(await browser.$(".cm-search-feedback").getText()).toContain("No matches");
    await browser.$('.cm-search [name="re"]').click();
    await query("[");
    expect(await browser.$('.cm-search input[name="search"]').getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(await browser.$(".cm-search-feedback").getText()).toContain(
      "Invalid regular expression",
    );
    await browser.saveScreenshot(`${shots}/after-invalid-search.png`);
    await query("بِسْمِ");
    expect(await browser.$(".cm-search-feedback").getText()).toContain("Match found");
    expect(await browser.$('.cm-search input[name="search"]').getAttribute("dir")).toBe("auto");
    expect(await docText()).toBe(original);
    await browser.keys("Escape");
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement === window.__bismillah?.view.contentDOM),
    );
  });

  it("offers a working folder chooser if the library disappears while Files is open", async () => {
    const missing = new Folder();
    const moved = `${missing.path}-moved`;
    try {
      await browser.execute(
        async (path: string) => window.__bismillah?.setLibrary(path),
        missing.path,
      );
      await browser.execute(() => window.__bismillah?.run("file.quickOpen"));
      await browser.$(".panel").waitForDisplayed();
      renameSync(missing.path, moved);
      await browser.execute(async () => window.__bismillah?.regainFocus());
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.library().kind === "unavailable"),
      );
      await browser.waitUntil(async () =>
        (await browser.$(".panel-note").getText()).includes("isn't available"),
      );
      await browser.execute(
        async (path: string) => window.__bismillah?.nextDialog(path),
        folder.path,
      );
      await browser
        .$("//*[contains(@class,'panel-row')][normalize-space()='Choose another folder…']")
        .click();
      // The chosen folder becomes the library, shown in the Files panel.
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.library().kind === "ready"),
      );
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.panel()?.kind === "files"),
      );
      expect(await browser.execute(() => window.__bismillah?.library().name)).toBe(
        folder.path.split("/").at(-1),
      );
    } finally {
      renameSync(moved, missing.path);
      missing.remove();
    }
  });

  it("closes a panel with a visible button and returns to writing", async () => {
    await setViewport(browser, 640, 700);
    await open(folder.file("panel-close.md", "Arabic العربية"));
    await browser.$("//footer//button[normalize-space()='Files']").click();
    await browser.$(".panel").waitForDisplayed();
    await browser.saveScreenshot(`${shots}/after-files.png`);
    await browser.$(".panel-close").click();
    await browser.$(".panel").waitForDisplayed({ reverse: true });
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement === window.__bismillah?.view.contentDOM),
    );
    expect(await docText()).toBe("Arabic العربية");
  });

  it("keeps search and panel controls inside short, narrow, wide and enlarged windows", async () => {
    await open(folder.file("specimen.md", readFileSync("docs/specimen.md", "utf8")));
    for (const theme of ["light", "dark"] as const) {
      await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
      for (const [width, height, scale] of [
        [480, 360, 1],
        [640, 700, 2],
        [1280, 900, 1],
        [1920, 900, 1],
        [2560, 900, 1],
      ]) {
        await setViewport(browser, width ?? 640, height ?? 700);
        await browser.execute(async (s: number) => window.__bismillah?.setScale(s), scale ?? 1);
        for (const [command, selector] of [
          ["app.commandPalette", ".panel"],
          ["edit.find", ".cm-search"],
        ] as const) {
          await browser.execute((id: typeof command) => window.__bismillah?.run(id), command);
          await browser.$(selector).waitForDisplayed();
          await settle(browser);
          expect(
            await browser.execute((sel: string) => {
              const el = document.querySelector(sel);
              const r = el?.getBoundingClientRect();
              return (
                !!r &&
                r.left >= 0 &&
                r.right <= innerWidth &&
                r.top >= 0 &&
                r.bottom <= innerHeight &&
                !!el &&
                el.scrollWidth <= el.clientWidth + 1
              );
            }, selector),
          ).toBe(true);
          if (width === 480 || scale === 2)
            await browser.saveScreenshot(
              `${shots}/after-${selector.slice(1)}-${theme}-${width}-${scale}.png`,
            );
          await browser.keys("Escape");
        }
      }
    }
    await browser.execute(async () => window.__bismillah?.setScale(1));
  });

  it("keeps the first screen's four actions visible at the minimum desktop size", async () => {
    await browser.execute(() => window.__bismillah?.welcome());
    await setViewport(browser, 480, 360);
    for (const theme of ["light", "dark"] as const) {
      await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
      expect(
        await browser.execute(() =>
          [...document.querySelectorAll(".welcome button")].every((el) => {
            const r = el.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
          }),
        ),
      ).toBe(true);
    }
  });
});
