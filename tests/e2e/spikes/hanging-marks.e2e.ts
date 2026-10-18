import { browser, expect } from "@wdio/globals";
import { setViewport, waitForApp } from "../../app.ts";
import {
  click,
  clusters,
  coords,
  fixture,
  head,
  lineOf,
  loadDoc,
  press,
  scrollIntoView,
  setCursor,
} from "./helpers.ts";

/**
 * Phase 0 spike: hanging marks (PLAN.md). Headings, quotes and list marks hang in the
 * gutter in Duo and Source Serif, in LTR and RTL, and the text after them starts on the
 * paragraph's reading edge. Caret motion and mouse placement still work on the marks.
 */

/** Start edge (left for LTR, right for RTL) of the text after a line's first `skip` chars. */
async function textEdge(needle: string, skip: number, rtl: boolean): Promise<number> {
  const line = await lineOf(needle);
  await scrollIntoView(line.from);
  const box = await coords(line.from + skip, 1);
  return rtl ? box.right : box.left;
}

for (const profile of ["duo", "serif"] as const) {
  describe(`hanging marks (${profile})`, () => {
    before(async () => {
      await waitForApp(browser);
      await setViewport(browser, 1280, 900);
      await loadDoc(fixture("bidi.md"));
      // The Phase 1 view, which "Always show Markdown" keeps (ADR-0012).
      await browser.execute(async (p: string) => {
        window.__bismillah?.setTypewriter(false);
        await window.__bismillah?.setProfile(p as "duo");
        await window.__bismillah?.changeSettings({ always_show_markdown: true });
      }, profile);
    });

    after(async () => {
      await browser.execute(async () => {
        await window.__bismillah?.changeSettings({ always_show_markdown: false });
      });
    });

    it("starts LTR heading, list, quote and ordered text on the paragraph's edge", async () => {
      const edge = await textEdge("A plain paragraph", 0, false);
      expect(await textEdge("# A heading", 2, false)).toBeCloseTo(edge, 0);
      expect(await textEdge("- A first item", 2, false)).toBeCloseTo(edge, 0);
      expect(await textEdge("> A quotation", 2, false)).toBeCloseTo(edge, 0);
      expect(await textEdge("10. Ordered ten", 4, false)).toBeCloseTo(edge, 0);
    });

    it("starts RTL heading, list and quote text on the Arabic paragraph's edge", async () => {
      const edge = await textEdge("فقرةٌ عربيةٌ عاديةٌ", 0, true);
      expect(await textEdge("## عنوانٌ", 3, true)).toBeCloseTo(edge, 0);
      expect(await textEdge("- عنصرٌ أوّل", 2, true)).toBeCloseTo(edge, 0);
      expect(await textEdge("> اقتباسٌ", 2, true)).toBeCloseTo(edge, 0);
    });

    it("puts the marks in the gutter, before the reading edge", async () => {
      const ltrEdge = await textEdge("A plain paragraph", 0, false);
      const hash = await lineOf("# A heading");
      expect((await coords(hash.from, 1)).left).toBeLessThan(ltrEdge - 10);
      const rtlEdge = await textEdge("فقرةٌ عربيةٌ عاديةٌ", 0, true);
      const arHash = await lineOf("## عنوانٌ");
      expect((await coords(arHash.from, 1)).right).toBeGreaterThan(rtlEdge + 10);
    });

    it("indents nested items so their marker sits under the parent's text", async () => {
      const parentText = await textEdge("- A first item", 2, false);
      const nested = await lineOf("  - A nested item");
      expect((await coords(nested.from + 2, 1)).left).toBeCloseTo(parentText, 0);
      const arParentText = await textEdge("- عنصرٌ أوّل", 2, true);
      const arNested = await lineOf("  - عنصرٌ متداخل");
      expect((await coords(arNested.from + 2, 1)).right).toBeCloseTo(arParentText, 0);
    });

    it("wraps headings back to the reading edge in both directions at 640px", async () => {
      await setViewport(browser, 640, 900);
      for (const [needle, skip, rtl, edgeNeedle] of [
        ["# A heading", 2, false, "A plain paragraph"],
        ["## عنوانٌ", 3, true, "فقرةٌ عربيةٌ عاديةٌ"],
      ] as const) {
        const edge = await textEdge(edgeNeedle, 0, rtl);
        const line = await lineOf(needle);
        await scrollIntoView(line.from);
        const parts = await clusters(line.from + skip, line.to);
        const firstTop = parts[0]?.top ?? 0;
        const secondRow = parts.find((c) => c.top > firstTop + 5 && c.text.trim() !== "");
        expect(secondRow).toBeDefined();
        if (secondRow) expect(rtl ? secondRow.right : secondRow.left).toBeCloseTo(edge, 0);
      }
      await setViewport(browser, 1280, 900);
    });

    it("moves the caret through the marks with the arrow keys and Home", async () => {
      const line = await lineOf("# A heading");
      await setCursor(line.from + 2);
      await press("ArrowLeft");
      expect(await head()).toBe(line.from + 1);
      await press("ArrowLeft");
      expect(await head()).toBe(line.from);
      await setCursor(line.from + 10);
      await press("Home");
      expect(await head()).toBe(line.from);
      const ar = await lineOf("## عنوانٌ");
      await setCursor(ar.from + 3);
      await press("ArrowRight"); // visual right = logical backward on an RTL line
      expect(await head()).toBe(ar.from + 2);
    });

    it("places the caret on a mark that is clicked", async () => {
      for (const needle of ["# A heading", "> A quotation", "## عنوانٌ"]) {
        const line = await lineOf(needle);
        await scrollIntoView(line.from);
        const [first] = await clusters(line.from, line.from + 1);
        if (!first) throw new Error("no glyph for the mark");
        await click((first.left + first.right) / 2, (first.top + first.bottom) / 2);
        expect([line.from, line.from + 1]).toContain(await head());
      }
    });
  });
}
