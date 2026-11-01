import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

// Words that don't compress: a repeated sentence deflates into one frame, a still code.
const TEXT = Array.from({ length: 4000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join(
  " ",
);

/** Print to Phone's dialog on a first frame that stays (ADR-0021). */
describe("print to phone screenshots", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(async (text: string) => {
      const hooks = window.__bismillah;
      hooks?.offerPrint(true);
      await hooks?.setDoc(text);
    }, TEXT);
  });
  after(async () => {
    await browser.execute(() => {
      window.__bismillah?.offerPrint(false);
      window.__bismillah?.setTheme("system");
    });
  });

  async function shoot(name: string, theme: "light" | "dark", width: number, height: number) {
    await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
    await setViewport(browser, width, height);
    await browser.execute(() => window.__bismillah?.run("file.printToPhone"));
    await browser.$(".print-dialog").waitForDisplayed();
    await browser.waitUntil(() =>
      browser.execute(() => window.__bismillah?.printProbe()?.status === "ready"),
    );
    await settle(browser);
    expect(compareWithBaseline(name, await browser.takeScreenshot())).toBeLessThan(TOLERANCE);
    await browser.keys(["Escape"]);
    await browser.$(".print-dialog").waitForExist({ reverse: true });
  }

  it("light, wide", () => shoot("print-light-1280", "light", 1280, 800));
  it("dark, wide", () => shoot("print-dark-1280", "dark", 1280, 800));
  it("dark, narrow", () => shoot("print-dark-640", "dark", 640, 700));
  it("light, the minimum window", () => shoot("print-light-480", "light", 480, 360));
});
