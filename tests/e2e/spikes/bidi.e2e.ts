import { browser, expect } from "@wdio/globals";
import { setViewport, waitForApp } from "../../app.ts";
import {
  caret,
  click,
  clusters,
  fixture,
  head,
  isLtrLetter,
  isRtlLetter,
  lineBox,
  lineOf,
  loadDoc,
  press,
  scrollIntoView,
  setCursor,
} from "./helpers.ts";

/**
 * Phase 0 spike: bidi (PLAN.md). Per-line direction and isolation for mixed paragraphs,
 * URLs and inline code inside Arabic: cursor movement, selection and mouse placement
 * must match the visible order.
 */

const LINES: [needle: string, dir: "ltr" | "rtl"][] = [
  ["The word أمانة means", "ltr"],
  ["نستخدم Markdown", "rtl"],
  ["راجع الرابط https://", "rtl"],
  ["An Arabic phrase with a link", "ltr"],
  ["سُجِّلت 1234", "rtl"],
];

describe("bidi", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1600, 900);
    await loadDoc(fixture("bidi.md"));
    // The Phase 1 view, which "Always show Markdown" keeps (ADR-0012); live preview has
    // its own spike (live-preview.e2e.ts).
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.setProfile("duo");
      await window.__bismillah?.changeSettings({ always_show_markdown: true });
    });
  });

  after(async () => {
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ always_show_markdown: false });
    });
  });

  it("gives each line the direction of its text", async () => {
    for (const [needle, dir] of LINES) {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      expect((await lineBox(line.from))?.dir).toBe(dir);
    }
  });

  for (const [needle, dir] of LINES) {
    it(`walks the caret in visual order with ArrowRight: ${needle}`, async () => {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      // Start at the visual left end of the line.
      await setCursor(dir === "ltr" ? line.from : line.to);
      const steps = line.to - line.from + 4;
      let previous = await caret();
      const stops: number[] = previous ? [previous.left] : [];
      for (let i = 0; i < steps; i++) {
        await press("ArrowRight");
        const now = await caret();
        const h = await head();
        if (h < line.from || h > line.to || !now || !previous) break;
        if (Math.abs(now.top - previous.top) < 2) {
          // Same visual row: the caret must move right (never left, never stand still).
          expect(now.left).toBeGreaterThan(previous.left + 0.5);
        }
        stops.push(now.left);
        previous = now;
        if ((dir === "ltr" && h === line.to) || (dir === "rtl" && h === line.from)) break;
      }
      // Every visual caret slot (each glyph cluster's left and right edge) is visited.
      // At a direction boundary two logical positions share one slot; CodeMirror stops
      // there once, so the test counts slots rather than logical offsets.
      // Whitespace is skipped: its edges coincide with its neighbours', except at a wrap
      // point, where the trailing space has no caret slot of its own.
      for (const c of await clusters(line.from, line.to)) {
        if (c.text.trim() === "") continue;
        for (const edge of [c.left, c.right]) {
          const hit = stops.some((x) => Math.abs(x - edge) < 1.5);
          expect([c.text, c.from - line.from, Math.round(edge), hit]).toEqual([
            c.text,
            c.from - line.from,
            Math.round(edge),
            true,
          ]);
        }
      }
    });
  }

  for (const [needle] of LINES) {
    it(`highlights exactly the selected characters: ${needle}`, async () => {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      const from = line.from + 4;
      const to = Math.min(line.to, line.from + 30);
      await browser.execute(
        (a: number, b: number) => {
          const view = window.__bismillah?.view;
          view?.focus();
          view?.dispatch({ selection: { anchor: a, head: b } });
        },
        from,
        to,
      );
      // A lone key lets the selection layer draw. Not Shift: two in a row open Find anything.
      await press("Control");
      const boxes = await browser.execute(() => window.__bismillah?.geometry.selectionBoxes() ?? []);
      const inside = (x: number, y: number) =>
        boxes.some((b) => x > b.left && x < b.right && y > b.top && y < b.bottom);
      for (const c of await clusters(line.from, line.to)) {
        if (c.right - c.left < 2 || c.text.trim() === "") continue;
        const selected = c.from >= from && c.to <= to;
        expect([c.text, inside((c.left + c.right) / 2, (c.top + c.bottom) / 2)]).toEqual([
          c.text,
          selected,
        ]);
      }
    });
  }

  for (const [needle] of LINES) {
    it(`places the caret on the clicked side of a letter: ${needle}`, async () => {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      const parts = (await clusters(line.from, line.to)).filter(
        (c, i) => i % 3 === 0 && c.right - c.left >= 6,
      );
      for (const c of parts) {
        const rtl = isRtlLetter(c.text);
        if (!rtl && !isLtrLetter(c.text)) continue;
        const y = (c.top + c.bottom) / 2;
        const quarter = (c.right - c.left) / 4;
        await click(c.left + quarter, y);
        expect([c.text, await head()]).toEqual([c.text, rtl ? c.to : c.from]);
        await click(c.right - quarter, y);
        expect([c.text, await head()]).toEqual([c.text, rtl ? c.from : c.to]);
      }
    });
  }
});
