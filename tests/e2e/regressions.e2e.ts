import { readFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { waitForApp, settle, setViewport } from "../app.ts";
import { act, docText, Folder, open, words } from "./files.ts";

/** Reproductions found by driving the real app during the exploratory QA pass. */
describe("exploratory regressions", () => {
  let folder: Folder;
  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.changeSettings({ always_show_markdown: false });
    });
  });
  after(() => folder.remove());

  const preview = () =>
    browser.execute(() => ({
      images: document.querySelectorAll(".cm-image").length,
      links: [...document.querySelectorAll(".cm-md-link")].map((el) => el.textContent),
    }));

  for (const fence of ["opening", "closing"] as const) {
    it(`refreshes images and references after editing a spaced ${fence} frontmatter fence`, async () => {
      const inside = "![Figure](missing.png)\n\n[ref]: https://example.org";
      const text =
        fence === "opening"
          ? `--- \ntitle: QA\n\n${inside}\n---\n\nA [reference][ref].\n\nEnd.`
          : `---\ntitle: QA\n--- \n\n${inside}\n\nA [reference][ref].\n\nEnd.`;
      await open(folder.file(`${fence}.md`, text));
      const at = fence === "opening" ? 4 : text.indexOf("--- ", 4) + 4;
      await browser.execute((pos: number) => {
        const view = window.__bismillah?.view;
        view?.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view?.focus();
      }, at);
      await browser.keys("x");
      await browser.keys(["Control", "End"]);
      await settle(browser);
      expect(await preview()).toEqual(
        fence === "opening" ? { images: 1, links: ["reference"] } : { images: 0, links: [] },
      );
      expect(await docText()).toBe(`${text.slice(0, at)}x${text.slice(at)}`);
      await browser.keys(["Control", "z"]);
      await browser.keys(["Control", "End"]);
      await settle(browser);
      expect(await preview()).toEqual(
        fence === "opening" ? { images: 0, links: [] } : { images: 1, links: ["reference"] },
      );
      expect(await docText()).toBe(text);
    });
  }

  it("counts no prose in unclosed frontmatter, and counts text after closing it", async () => {
    await open(folder.file("unclosed.md", "---\ntitle: Hidden words\nlang: en\n"));
    await browser.waitUntil(async () => (await words()) === 0, {
      timeout: 3000,
    });
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return;
      view.dispatch({ changes: { from: view.state.doc.length, insert: "---\n\nVisible words." } });
    });
    await browser.waitUntil(async () => (await words()) === 2, {
      timeout: 3000,
    });
  });

  it("offers no document commands after trashing the file", async () => {
    await browser.execute(
      async (path: string) => window.__bismillah?.setLibrary(path),
      folder.path,
    );
    const text = "Closed document text.\n";
    await open(folder.file("closed.md", text));
    await browser.execute(() => window.__bismillah?.run("file.trash"));
    await browser.$(".welcome").waitForDisplayed();
    await browser.keys(["Control", "Shift", "P"]);
    const input = await browser.$(".picker-input");
    await input.waitForDisplayed();
    for (const label of ["Save now", "Undo", "Redo", "Select all", "Show suggestions"]) {
      await input.setValue(label);
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.picker()?.items.length === 0),
      );
    }
    await browser.keys("Escape");
    // Run directly, as the menu and shortcuts do, they still do nothing.
    const ran = await browser.execute(() => {
      const app = window.__bismillah;
      if (!app) return null;
      const before = app.commandLog.length;
      for (const id of ["file.save", "edit.selectAll", "edit.undo"] as const) app.run(id);
      return app.commandLog.length - before;
    });
    expect(ran).toBe(0);
    await act("Undo");
    await browser.waitUntil(async () => (await docText()) === text);
    expect(folder.read("closed.md").toString()).toBe(text);
  });

  it("keeps enlarged mixed-script text inside a narrow desktop window", async () => {
    const text = readFileSync("docs/specimen.md", "utf8");
    await open(folder.file("zoom.md", text));
    await browser.execute(() => {
      const hooks = window.__bismillah;
      if (hooks?.library().visible) hooks.run("view.toggleLibrary");
    });
    try {
      for (const width of [480, 640, 1280]) {
        await setViewport(browser, width, 600);
        for (const scale of [2, 3]) {
          await browser.execute(async (n: number) => window.__bismillah?.setScale(n), scale);
          await settle(browser);
          const size = await browser.execute(() => ({
            window: window.innerWidth,
            page: document.documentElement.scrollWidth,
            editor: window.__bismillah?.view.scrollDOM.getBoundingClientRect().width ?? Infinity,
          }));
          expect(size.page).toBeLessThanOrEqual(size.window + 1);
          expect(size.editor).toBeLessThanOrEqual(size.window + 1);
          expect(await docText()).toBe(text);
        }
      }
    } finally {
      await browser.execute(async () => window.__bismillah?.setScale(1));
      await setViewport(browser, 1280, 900);
    }
  });
});
