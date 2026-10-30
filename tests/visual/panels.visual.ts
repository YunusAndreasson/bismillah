import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

/** Search (DESIGN.md §6, ADR-0018), centred near the top: everything with nothing
 * typed and with a query, files in an Arabic-named folder, commands in a narrow window,
 * and settings with a row opened. A copy of tests/fixtures/library named "Writing", with
 * a file open. */
describe("search screenshots", () => {
  const scratch = mkdtempSync(join(tmpdir(), "bismillah-visual-"));
  const root = join(scratch, "Writing");

  async function shoot(
    name: string,
    open: () => Promise<void>,
    theme: "light" | "dark",
    width: number,
  ): Promise<void> {
    await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
    await setViewport(browser, width, 900);
    await open();
    await browser.$(".panel").waitForDisplayed();
    await settle(browser);
    const shot = await browser.takeScreenshot();
    for (let i = 0; i < 2 && (await browser.$(".panel").isExisting()); i++)
      await browser.keys(["Escape"]);
    expect(compareWithBaseline(name, shot)).toBeLessThan(TOLERANCE);
  }

  before(async () => {
    cpSync(resolve(REPO, "tests/fixtures/library"), root, { recursive: true });
    await waitForApp(browser);
    await browser.execute(
      async (dir: string, file: string) => {
        const hooks = window.__bismillah;
        hooks?.setTypewriter(false);
        hooks?.setFolderLabels({
          config: "/tmp/bismillah-visual/config",
          data: "/tmp/bismillah-visual/data",
        });
        await hooks?.setLibrary(dir);
        await hooks?.open(file);
      },
      root,
      join(root, "Essays/2026/Letter to Ḥasan.md"),
    );
  });
  after(async () => {
    await browser.execute(() => window.__bismillah?.setTheme("system"));
    rmSync(scratch, { recursive: true, force: true });
  });

  it("lists recent files with nothing typed, light theme", async () => {
    await shoot(
      "search-recent-light-1280",
      () => browser.execute(async () => window.__bismillah?.openPanel("all")),
      "light",
      1280,
    );
  });

  it("lists commands and settings together for a query, light theme", async () => {
    await shoot(
      "search-spelling-light-1280",
      () => browser.execute(async () => window.__bismillah?.openPanel("all", "spelling")),
      "light",
      1280,
    );
  });

  it("lists a folder with an Arabic name, its names isolated", async () => {
    await shoot(
      "search-files-arabic-light-1280",
      () => browser.execute(async () => window.__bismillah?.openPanel("files", "رسائل/")),
      "light",
      1280,
    );
  });

  it("lists the commands in a narrow window, dark theme", async () => {
    await shoot(
      "search-commands-dark-640",
      () => browser.execute(async () => window.__bismillah?.openPanel("commands")),
      "dark",
      640,
    );
  });

  it("opens a setting in place, dark theme", async () => {
    await shoot(
      "search-settings-measure-dark-1280",
      () =>
        browser.execute(async () => {
          window.__bismillah?.openSettings({ row: "measure", open: true });
          await window.__bismillah?.settle();
        }),
      "dark",
      1280,
    );
  });
});
