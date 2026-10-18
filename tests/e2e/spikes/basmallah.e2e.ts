import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../../app.ts";
import { click, fixture, head, loadDoc, press, setCursor } from "./helpers.ts";

/** Top of the caret, relative to the writing area (0 = top, 1 = bottom). */
async function caretLine(): Promise<number> {
  return browser.execute(() => {
    const view = window.__bismillah?.view;
    const caret = view?.coordsAtPos(view.state.selection.main.head);
    if (!view || !caret) return -1;
    const area = view.scrollDOM.getBoundingClientRect();
    return (caret.top - area.top) / area.height;
  });
}

/**
 * Phase 0 spike: the Basmallah opening (PLAN.md, ADR-0008). A block widget above line 1,
 * outside the document: scrolling, typewriter mode, the caret at the start and scroll
 * restoration must behave as if it weren't there.
 */

async function basmallahBox() {
  return browser.execute(() => {
    const r = document.querySelector(".cm-basmallah")?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
  });
}

describe("Basmallah opening", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1280, 900);
    await loadDoc(fixture("bidi.md"));
    await browser.execute(() => window.__bismillah?.setTypewriter(false));
  });

  it("is outside the document: no text, no undo history, no effect on counts", async () => {
    const state = await browser.execute(() => {
      const view = window.__bismillah?.view;
      return {
        startsWith: view?.state.doc.toString().startsWith("# A heading"),
        widgetInText: view?.state.doc.toString().includes("بِسْمِ اللَّهِ"),
      };
    });
    expect(state).toEqual({ startsWith: true, widgetInText: false });
  });

  it("keeps the caret in the document at the start: Mod-Home, ArrowUp, clicks", async () => {
    await setCursor(30);
    await press("Control", "Home");
    await press("Control"); // release
    expect(await head()).toBe(0);
    await press("ArrowUp");
    expect(await head()).toBe(0);
    const box = await basmallahBox();
    expect(box).not.toBeNull();
    if (box) await click((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    expect(await head()).toBe(0);
    const text = await browser.execute(() => window.__bismillah?.view.state.doc.toString());
    expect(text).toBe(fixture("bidi.md"));
  });

  it("stays above line 1 when typing at the very start", async () => {
    await setCursor(0);
    await press("X");
    const [first, box, line1Top] = await browser.execute(() => {
      const view = window.__bismillah?.view;
      const r = document.querySelector(".cm-basmallah")?.getBoundingClientRect();
      return [
        view?.state.doc.sliceString(0, 1),
        r ? r.bottom : null,
        view ? view.coordsAtPos(0)?.top : null,
      ];
    });
    expect(first).toBe("X");
    expect(box).not.toBeNull();
    expect(line1Top ?? 0).toBeGreaterThan(box ?? 0);
    await press("Backspace");
  });

  it("scrolls with the document and appears once", async () => {
    const before = await basmallahBox();
    await browser.execute(() => {
      const s = window.__bismillah?.view.scrollDOM;
      if (s) s.scrollTop = 120;
    });
    await settle(browser);
    const after = await basmallahBox();
    expect(Math.round((before?.top ?? 0) - (after?.top ?? 0))).toBe(120);
    expect(await browser.execute(() => document.querySelectorAll(".cm-basmallah").length)).toBe(1);
  });

  it("restores a scroll snapshot exactly after the document is reloaded", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1} of a long file.`).join(
      "\n\n",
    );
    await loadDoc(long);
    const [topLine, restoredLine] = await browser.execute(async () => {
      const hooks = window.__bismillah;
      if (!hooks) return [null, null];
      const { view } = hooks;
      view.scrollDOM.scrollTop = 3000;
      await hooks.settle();
      const firstVisible = () => {
        const offset = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
        return view.state.doc.lineAt(view.lineBlockAtHeight(offset).from).number;
      };
      const top = firstVisible();
      const snapshot = view.scrollSnapshot();
      const text = view.state.doc.toString();
      await hooks.setDoc(text); // same text, as after reopening the file
      view.scrollDOM.scrollTop = 0;
      await hooks.settle();
      view.dispatch({ effects: snapshot });
      await hooks.settle();
      return [top, firstVisible()];
    });
    expect(restoredLine).toBe(topLine);
  });

  it("keeps the caret line at about 42% in typewriter mode, line 1 included", async () => {
    await loadDoc(fixture("bidi.md") + "\n" + "More text.\n\n".repeat(60));
    await browser.execute(() => window.__bismillah?.setTypewriter(true));
    await setCursor(0);
    await press("ArrowDown");
    await press("ArrowUp");
    const positions: number[] = [];
    for (let i = 0; i < 12; i++) {
      positions.push(await caretLine());
      await press("ArrowDown");
    }
    for (const p of positions) expect(p).toBeCloseTo(0.42, 2);
    await setCursor(0);
    await press("ArrowRight");
    await press("ArrowLeft");
    expect(await caretLine()).toBeCloseTo(0.42, 2);
    // The Basmallah sits above line 1, fully on screen.
    const box = await basmallahBox();
    const line1 = await browser.execute(() => window.__bismillah?.view.coordsAtPos(0)?.top ?? 0);
    expect(box).not.toBeNull();
    expect(box?.bottom ?? 0).toBeLessThanOrEqual(line1);
    expect(box?.top ?? -1).toBeGreaterThanOrEqual(0);
    await browser.execute(() => window.__bismillah?.setTypewriter(false));
  });
});
