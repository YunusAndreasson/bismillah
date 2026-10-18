import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

/** The library (DESIGN.md §7): docked in the margin on a wide window, over the text on a
 * narrow one. A copy of tests/fixtures/library named "Writing", with a file open. */
describe("library screenshots", () => {
  const scratch = mkdtempSync(join(tmpdir(), "bismillah-visual-"));
  const root = join(scratch, "Writing");

  async function show(): Promise<void> {
    await browser.execute(async () => {
      const hooks = window.__bismillah;
      await hooks?.measure();
      if (!hooks?.library().visible) hooks?.run("view.toggleLibrary");
      await hooks?.settle();
      (document.activeElement as HTMLElement | null)?.blur();
      hooks?.view.contentDOM.blur();
    });
    await settle(browser);
  }

  before(async () => {
    cpSync(resolve(REPO, "tests/fixtures/library"), root, { recursive: true });
    await waitForApp(browser);
    await browser.execute(
      async (dir: string, file: string) => {
        const hooks = window.__bismillah;
        hooks?.setTypewriter(false);
        await hooks?.setLibrary(dir);
        await hooks?.open(file);
      },
      root,
      join(root, "Essays/2026/Letter to Ḥasan.md"),
    );
  });
  after(() => rmSync(scratch, { recursive: true, force: true }));

  it("docks in the margin of a wide window, light theme", async () => {
    await browser.execute(() => window.__bismillah?.setTheme("light"));
    await setViewport(browser, 1920, 1000);
    await show();
    expect(
      compareWithBaseline("library-docked-light-1920", await browser.takeScreenshot()),
    ).toBeLessThan(TOLERANCE);
  });

  it("opens over the text in a narrow window, dark theme", async () => {
    await browser.execute(() => window.__bismillah?.setTheme("dark"));
    await setViewport(browser, 640, 900);
    await show();
    expect(
      compareWithBaseline("library-overlay-dark-640", await browser.takeScreenshot()),
    ).toBeLessThan(TOLERANCE);
  });
});
