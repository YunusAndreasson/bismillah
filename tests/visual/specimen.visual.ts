import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

async function scrollToText(needle: string): Promise<void> {
  await browser.execute((text: string) => {
    const view = window.__bismillah?.view;
    if (!view) return;
    const index = view.state.doc.toString().indexOf(text);
    view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(index).top - 40);
  }, needle);
  await settle(browser);
}

describe("specimen screenshots", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => {
      window.__bismillah?.setTypewriter(false);
      window.__bismillah?.view.contentDOM.blur();
    });
    await setViewport(browser, 1280, 900);
  });

  it("matches the baseline at the top, light theme", async () => {
    await browser.execute(() => window.__bismillah?.setTheme("light"));
    await scrollToText("---\ntitle");
    expect(
      compareWithBaseline("specimen-top-light-1280", await browser.takeScreenshot()),
    ).toBeLessThan(TOLERANCE);
  });

  it("matches the baseline in the Arabic section, dark theme", async () => {
    await browser.execute(() => window.__bismillah?.setTheme("dark"));
    await scrollToText("## Arabic");
    expect(
      compareWithBaseline("specimen-arabic-dark-1280", await browser.takeScreenshot()),
    ).toBeLessThan(TOLERANCE);
  });
});
