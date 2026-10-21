import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

const change = (patch: Record<string, unknown>) =>
  browser.execute(async (p: Record<string, unknown>) => {
    await window.__bismillah?.changeSettings(p);
  }, patch);

/** High contrast over the specimen, and the Settings screen (Phase 5). */
describe("high contrast and Settings", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => {
      window.__bismillah?.setTypewriter(false);
      window.__bismillah?.view.contentDOM.blur();
    });
    await setViewport(browser, 1280, 900);
    await browser.execute(async () => {
      const hooks = window.__bismillah;
      // Variable-width random directory names can add a wrapped line above Writing.
      // Stable display data makes its fractional scroll position deterministic.
      hooks?.setFolderLabels({
        config: "/tmp/bismillah-visual/config",
        data: "/tmp/bismillah-visual/data",
      });
      await hooks?.measure();
      if (hooks?.library().visible) hooks.run("view.toggleLibrary");
      const s = hooks?.view.scrollDOM;
      if (s) s.scrollTop = 0;
      await hooks?.settle();
    });
  });
  after(() => change({ theme: "system", high_contrast: false }));

  for (const theme of ["light", "dark"] as const) {
    it(`draws the specimen in high contrast, ${theme}`, async () => {
      await change({ theme, high_contrast: true });
      await settle(browser);
      const name = `specimen-top-${theme}-1280-high-contrast`;
      expect(compareWithBaseline(name, await browser.takeScreenshot())).toBeLessThan(TOLERANCE);
    });
  }

  // The Writing section: Appearance and Files & privacy name the run's private folders.
  it("draws Settings at its Writing section", async () => {
    await change({ theme: "light", high_contrast: false });
    await browser.execute(() => window.__bismillah?.run("app.settings"));
    await browser.$(".settings-dialog").waitForDisplayed();
    await browser.$(".settings-dialog nav").$("button=Writing").click();
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    await settle(browser);
    const shot = await browser.takeScreenshot();
    await browser.keys(["Escape"]);
    await browser.$(".settings-dialog").waitForDisplayed({ reverse: true });
    expect(compareWithBaseline("settings-writing-light-1280", shot)).toBeLessThan(TOLERANCE);
  });
});
