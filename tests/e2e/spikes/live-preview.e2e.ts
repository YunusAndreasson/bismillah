import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../../app.ts";
import type { Cluster } from "../../../src/core/testGeometry.ts";
import {
  clusters,
  coords,
  fixture,
  head,
  isLtrLetter,
  isRtlLetter,
  lineOf,
  loadDoc,
  press,
  scrollIntoView,
} from "./helpers.ts";

/**
 * Phase 4 spike: live preview in WebKitGTK (PLAN.md, ADR-0012). Outside the caret's
 * block the Markdown is hidden; these probes read where WebKit actually draws the caret,
 * glyphs and selection on RTL and mixed lines, and check that a click into rendered text
 * leaves the caret on the clicked character once the block has revealed.
 */

const LINES = [
  "The word **أمانة**",
  "نستخدم **Markdown**",
  "An Arabic phrase with a link",
  "**الكتابةُ** أمانةٌ",
  "- **عنصرٌ**",
  "- A *second* item",
  "> اقتباسٌ",
  "## عنوانٌ",
];
const PARKING = "Plain closing paragraph.";

const isLetter = (s: string) => isRtlLetter(s) || isLtrLetter(s);

/**
 * Puts the caret in the closing paragraph without scrolling, so every other block
 * renders; with `line`, then scrolls that line to the same place as before.
 */
async function park(line?: number): Promise<void> {
  await browser.execute((needle: string) => {
    const view = window.__bismillah?.view;
    if (!view) return;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(needle) } });
  }, PARKING);
  await settle(browser);
  if (line !== undefined) await scrollIntoView(line);
}

/** The line's text as the DOM holds it (hidden marks are missing). */
async function drawnText(pos: number): Promise<string> {
  return browser.execute((p: number) => {
    const view = window.__bismillah?.view;
    if (!view) return "";
    const { node } = view.domAtPos(p);
    const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
    return el?.textContent ?? "";
  }, pos);
}

async function sourceText(pos: number): Promise<string> {
  return browser.execute((p: number) => {
    const view = window.__bismillah?.view;
    return view ? view.state.doc.lineAt(p).text : "";
  }, pos);
}

/** Fresh coordinates of one cluster (scrolling may have moved it). */
async function at(c: Cluster): Promise<Cluster> {
  const [fresh] = await clusters(c.from, c.to);
  if (!fresh) throw new Error(`cluster ${c.text} is gone`);
  return fresh;
}

async function pointer(x: number, y: number, clicks: 1 | 2): Promise<void> {
  let chain = browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up();
  if (clicks === 2) chain = chain.pause(40).down().up();
  await chain.perform();
  await settle(browser);
}

async function selectedText(): Promise<string> {
  return browser.execute(() => {
    const view = window.__bismillah?.view;
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });
}

describe("live preview (spike)", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 900, 900);
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.setProfile("duo");
      await window.__bismillah?.changeSettings({ always_show_markdown: false });
    });
    await loadDoc(fixture("live-preview.md"));
  });

  it("draws rendered text outside the caret's block and the Markdown inside it", async () => {
    for (const needle of LINES) {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      await park();
      const drawn = await drawnText(line.from);
      expect([needle, /\*\*|\]\(|`/.test(drawn)]).toEqual([needle, false]);
      await browser.execute((p: number) => {
        window.__bismillah?.view.dispatch({ selection: { anchor: p } });
      }, line.to);
      await settle(browser);
      expect(await drawnText(line.from)).toBe(await sourceText(line.from));
    }
  });

  for (const needle of LINES) {
    it(`leaves the caret on the clicked side of a letter, after the reveal: ${needle}`, async () => {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      await park();
      // Hidden marks have no glyphs, so they show as gaps between clusters.
      const all = await clusters(line.from, line.to);
      const besideHidden = (i: number) =>
        all[i - 1]?.to !== all[i]?.from || all[i + 1]?.from !== all[i]?.to;
      // Letters next to a hidden mark, plus every fifth letter.
      const picks = all.filter(
        (c, i) => isLetter(c.text) && c.right - c.left >= 4 && (i % 5 === 0 || besideHidden(i)),
      );
      expect(picks.length).toBeGreaterThan(2);
      for (const pick of picks) {
        const rtl = isRtlLetter(pick.text);
        for (const quarter of [0.25, 0.75]) {
          await park(line.from);
          const c = await at(pick);
          const y = (c.top + c.bottom) / 2;
          await pointer(c.left + (c.right - c.left) * quarter, y, 1);
          const leftSide = quarter < 0.5;
          const expected = rtl === leftSide ? c.to : c.from;
          expect([c.text, c.from - line.from, quarter, await head()]).toEqual([
            c.text,
            c.from - line.from,
            quarter,
            expected,
          ]);
          // The block revealed, and the caret's row kept its height on screen.
          expect(await drawnText(line.from)).toBe(await sourceText(line.from));
          const caret = await coords(expected, rtl === leftSide ? -1 : 1);
          expect([c.text, Math.abs(caret.top - c.top) < 3]).toEqual([c.text, true]);
        }
      }
      // This checks both sides of many individual glyphs through WebDriver. Under
      // the offline proof's strace it can exceed the ordinary one-minute case budget.
    }).timeout(120_000);
  }

  const WORDS: [needle: string, word: string][] = [
    ["The word **أمانة**", "means"],
    ["The word **أمانة**", "trust"],
    ["نستخدم **Markdown**", "لكتابة"],
    ["An Arabic phrase with a link", "English"],
    ["**الكتابةُ** أمانةٌ", "فقرةٌ"],
  ];
  for (const [needle, word] of WORDS) {
    it(`selects the double-clicked word although its block moved: ${word}`, async () => {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      await park();
      const source = await sourceText(line.from);
      const start = line.from + source.indexOf(word);
      const [first] = await clusters(start, start + 1);
      const [last] = await clusters(start + word.length - 1, start + word.length);
      if (!first || !last) throw new Error(`no glyphs for ${word}`);
      const x = (Math.min(first.left, last.left) + Math.max(first.right, last.right)) / 2;
      await pointer(x, (first.top + first.bottom) / 2, 2);
      expect(await selectedText()).toBe(word);
    });
  }

  for (const needle of LINES.slice(0, 4)) {
    it(`highlights exactly the selected glyphs of a rendered line: ${needle}`, async () => {
      const line = await lineOf(needle);
      await scrollIntoView(line.from);
      const anchor = line.from + 12;
      await browser.execute(
        (a: number, needle: string) => {
          const view = window.__bismillah?.view;
          if (!view) return;
          view.dispatch({
            selection: { anchor: a, head: view.state.doc.toString().indexOf(needle) },
          });
        },
        anchor,
        PARKING,
      );
      await settle(browser);
      // The head's block is revealed; the anchor's line stays rendered.
      expect(/\*\*|\]\(/.test(await drawnText(line.from))).toBe(false);
      const boxes = await browser.execute(() => window.__bismillah?.geometry.selectionBoxes() ?? []);
      const inside = (x: number, y: number) =>
        boxes.some((b) => x > b.left && x < b.right && y > b.top && y < b.bottom);
      for (const c of await clusters(line.from, line.to)) {
        if (c.right - c.left < 2 || c.text.trim() === "") continue;
        expect([c.text, c.from - line.from, inside((c.left + c.right) / 2, (c.top + c.bottom) / 2)])
          .toEqual([c.text, c.from - line.from, c.from >= anchor]);
      }
    });
  }

  it("reveals the caret's block at every step of keyboard motion", async () => {
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.focus();
      view?.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    });
    await settle(browser);
    const end = await lineOf(PARKING);
    for (let step = 0; step < 80; step++) {
      await press("ArrowDown");
      const h = await head();
      expect([step, await drawnText(h)]).toEqual([step, await sourceText(h)]);
      if (h >= end.from) break;
    }
    expect(await head()).toBeGreaterThanOrEqual(end.from);
  });

  it("moves into a block across a hidden mark at its edge", async () => {
    // ArrowRight from the end of the paragraph above lands before the opening `**`.
    const line = await lineOf("**الكتابةُ** أمانةٌ");
    await scrollIntoView(line.from);
    await browser.execute((p: number) => {
      const view = window.__bismillah?.view;
      view?.focus();
      view?.dispatch({ selection: { anchor: p } });
    }, line.from - 2);
    await settle(browser);
    await press("ArrowRight");
    await press("ArrowRight");
    expect(await head()).toBe(line.from);
    expect(await drawnText(line.from)).toBe(await sourceText(line.from));
    // Into the end of the heading, after its hidden closing backtick: ArrowLeft onto the
    // blank line, which follows the Arabic heading's direction, then ArrowRight.
    const last = await lineOf(PARKING);
    const heading = await lineOf("## عنوانٌ");
    await browser.execute((p: number) => {
      window.__bismillah?.view.dispatch({ selection: { anchor: p } });
    }, last.from);
    await settle(browser);
    await press("ArrowLeft");
    await press("ArrowRight");
    expect(await head()).toBe(heading.to);
    expect(await drawnText(heading.from)).toBe(await sourceText(heading.from));
  });

  it("keeps the caret at the typewriter line while blocks reveal and fold", async () => {
    await browser.execute(() => window.__bismillah?.setTypewriter(true));
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.focus();
      view?.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    });
    await settle(browser);
    const end = await lineOf(PARKING);
    for (let step = 0; step < 80; step++) {
      await press("ArrowDown");
      await settle(browser);
      const offset = await browser.execute(() => {
        const view = window.__bismillah?.view;
        if (!view) return null;
        const rect = view.coordsAtPos(view.state.selection.main.head);
        const box = view.scrollDOM.getBoundingClientRect();
        return rect
          ? {
              top: rect.top - box.top,
              height: view.scrollDOM.clientHeight,
              scrollTop: view.scrollDOM.scrollTop,
            }
          : null;
      });
      if (!offset) throw new Error("no caret");
      const line = offset.height * 0.42;
      // Lines above the typewriter line stay put at the top of the document.
      const held = Math.abs(offset.top - line) <= 2 || (offset.scrollTop === 0 && offset.top < line);
      expect([step, held]).toEqual([step, true]);
      if ((await head()) >= end.from) break;
    }
    await browser.execute(() => window.__bismillah?.setTypewriter(false));
  });
});
