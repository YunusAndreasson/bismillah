import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { compareWithBaseline } from "./compare.ts";

/** Anti-aliasing noise only; a real layout change moves far more pixels. */
const TOLERANCE = 0.001;

/**
 * Scrolls so the line holding `needle` sits 40px below the top. A second pass corrects
 * from where the line is really drawn: far-off lines are placed from height estimates,
 * which depend on what the app showed before.
 */
async function scrollToText(needle: string): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    await browser.execute((text: string) => {
      const view = window.__bismillah?.view;
      if (!view) return;
      const index = view.state.doc.toString().indexOf(text);
      const { node } = view.domAtPos(index);
      const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
      const scroller = view.scrollDOM;
      if (line && view.visibleRanges.some((r) => r.from <= index && index <= r.to)) {
        const offset = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += offset - 40;
      } else {
        scroller.scrollTop = Math.max(0, view.lineBlockAt(index).top - 40);
      }
    }, needle);
    await settle(browser);
  }
}

/**
 * Scrolls through the whole document once, so every line is measured: lines CodeMirror
 * hasn't drawn yet are placed from estimated heights, whose fractions would otherwise
 * shift a shot by a pixel depending on what ran before.
 */
async function measureAll(): Promise<void> {
  const [height, page] = await browser.execute(() => {
    const s = window.__bismillah?.view.scrollDOM;
    return [s?.scrollHeight ?? 0, s?.clientHeight ?? 1];
  });
  for (let top = 0; top < height; top += page) {
    await browser.execute((y: number) => {
      const s = window.__bismillah?.view.scrollDOM;
      if (s) s.scrollTop = y;
    }, top);
    await settle(browser);
  }
}

/** Live preview on or off ("Always show Markdown"); the caret stays where the specimen
 * opened it, on its first heading, so that block shows its Markdown. */
async function markdown(shown: boolean): Promise<void> {
  await browser.execute(async (on: boolean) => {
    await window.__bismillah?.changeSettings({ always_show_markdown: on });
    window.__bismillah?.view.contentDOM.blur();
  }, shown);
  await settle(browser);
  await measureAll();
}

describe("specimen screenshots", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => {
      window.__bismillah?.setTypewriter(false);
      window.__bismillah?.view.contentDOM.blur();
    });
    await setViewport(browser, 1280, 900);
    // An earlier spec's library is remembered within a run; the specimen is shot alone.
    await browser.execute(async () => {
      const hooks = window.__bismillah;
      await hooks?.measure();
      if (hooks?.library().visible) hooks.run("view.toggleLibrary");
      await hooks?.settle();
    });
  });

  // With every mark shown, the baselines are Phase 1's own: "Always show Markdown"
  // matches Phase 1 exactly (ADR-0012).
  describe("with all Markdown shown", () => {
    before(() => markdown(true));

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

  describe("rendered (live preview)", () => {
    before(() => markdown(false));

    for (const [name, theme, needle] of [
      ["specimen-top-light-1280-rendered", "light", "---\ntitle"],
      ["specimen-lists-dark-1280-rendered", "dark", "## Lists"],
      ["specimen-code-light-1280-rendered", "light", "## Code"],
      ["specimen-table-dark-1280-rendered", "dark", "## Table"],
      ["specimen-arabic-dark-1280-rendered", "dark", "## Arabic"],
      ["specimen-mixed-light-1280-rendered", "light", "## Transliteration"],
    ] as const) {
      it(`matches the baseline: ${name}`, async () => {
        await browser.execute((t: "light" | "dark") => window.__bismillah?.setTheme(t), theme);
        await scrollToText(needle);
        expect(compareWithBaseline(name, await browser.takeScreenshot())).toBeLessThan(TOLERANCE);
      });
    }
  });
});
