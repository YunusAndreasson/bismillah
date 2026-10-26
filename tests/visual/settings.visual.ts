import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

const change = (patch: Record<string, unknown>) =>
  browser.execute(async (p: Record<string, unknown>) => {
    await window.__bismillah?.changeSettings(p);
  }, patch);

/** High contrast over the specimen (Phase 5). The Settings panel is in panels.visual.ts. */
describe("high contrast", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => {
      window.__bismillah?.setTypewriter(false);
      window.__bismillah?.view.contentDOM.blur();
    });
    await setViewport(browser, 1280, 900);
    await browser.execute(async () => {
      const hooks = window.__bismillah;
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
});
