/** Helpers shared by the e2e and visual suites and `pnpm app:shot`. */

type Browser = WebdriverIO.Browser;

/** Waits until the app has loaded its document, fonts and test hooks. */
export async function waitForApp(browser: Browser): Promise<void> {
  await browser.waitUntil(
    () => browser.execute(() => document.documentElement.dataset.ready === "true"),
    { timeout: 20_000, timeoutMsg: "the app never became ready" },
  );
  await settle(browser);
}

export async function settle(browser: Browser): Promise<void> {
  await browser.execute(async () => {
    await window.__bismillah?.settle();
  });
}

/** Sets the webview's viewport to exactly `width` × `height` CSS px. */
export async function setViewport(browser: Browser, width: number, height: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inner = await browser.execute(() => [window.innerWidth, window.innerHeight]);
    const [w = 0, h = 0] = inner;
    if (w === width && h === height) break;
    const rect = await browser.getWindowRect();
    await browser.setWindowRect(null, null, rect.width + width - w, rect.height + height - h);
    await browser.pause(150);
  }
  await settle(browser);
}
