import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

const TEXT =
  "# Trust\n\nThe word **amānah** means trust, and it is written here in plain Markdown.\n\nبِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\n\nThe word أَمَانَةٌ sits in an English line.\n";

/** The bar over Latin, Arabic and mixed lines (DESIGN.md §11, ADR-0019). */
describe("formatting bar screenshots", () => {
  async function shoot(name: string, word: string, theme: "light" | "dark", width: number) {
    await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
    await setViewport(browser, width, 700);
    await browser.execute((w: string) => {
      const view = window.__bismillah?.view;
      if (!view) return;
      const at = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: at, head: at + w.length }, userEvent: "select" });
    }, word);
    await browser.$(".format-bar").waitForExist();
    await settle(browser);
    expect(compareWithBaseline(name, await browser.takeScreenshot())).toBeLessThan(TOLERANCE);
  }

  before(async () => {
    await waitForApp(browser);
    await browser.execute(async (text: string) => {
      const hooks = window.__bismillah;
      hooks?.setTypewriter(false);
      await hooks?.setDoc(text);
    }, TEXT);
  });
  after(async () => {
    await browser.execute(() => window.__bismillah?.setTheme("system"));
  });

  it("over a Latin line, light", () =>
    shoot("format-bar-latin-light", "plain Markdown", "light", 1280));
  it("over an Arabic line, dark", () =>
    shoot("format-bar-arabic-dark", "ٱلرَّحْمَٰنِ", "dark", 1280));
  it("over a mixed line in a narrow window, light", () =>
    shoot("format-bar-mixed-narrow", "أَمَانَةٌ sits", "light", 640));
});
