import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { loadDoc, setCursor } from "./spikes/helpers.ts";

/**
 * Enter as a paragraph break and Escape as putting the pen down (DESIGN.md §11), through
 * WebKit's real key path.
 */

async function text(): Promise<string> {
  return browser.execute(() => window.__bismillah?.view.state.doc.toString() ?? "");
}

async function frames(): Promise<void> {
  await browser.execute(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** Presses a named key or a chord, then releases held modifiers. */
async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  const modifiers = keys.filter((k) => ["Control", "Shift", "Alt"].includes(k));
  if (modifiers.length) await browser.keys(modifiers);
  await frames();
}

async function start(doc: string, caret = doc.length): Promise<void> {
  await loadDoc(doc);
  await setCursor(caret);
  // Keep the first key out of the undo step that loaded the document.
  await browser.pause(600);
}

describe("Enter and Escape", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.changeSettings({ always_show_markdown: false, focus_mode: false });
    });
  });

  after(async () => {
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ focus_mode: false });
    });
  });

  it("starts a new paragraph with one Enter, and one Backspace takes it back", async () => {
    await start("First paragraph.");
    await press("Enter");
    await browser.keys("S");
    expect(await text()).toBe("First paragraph.\n\nS");
    await start("First paragraph.");
    await press("Enter");
    await press("Backspace");
    expect(await text()).toBe("First paragraph.");
  });

  it("keeps a single line break on Shift+Enter and continues lists on Enter", async () => {
    await start("A line.");
    await press("Shift", "Enter");
    expect(await text()).toBe("A line.\n");
    await start("- one");
    await press("Enter");
    expect(await text()).toBe("- one\n- ");
  });

  it("breaks an Arabic paragraph the same way", async () => {
    await start("العلم نور.");
    await press("Enter");
    expect(await text()).toBe("العلم نور.\n\n");
  });

  it("spaces headings the same with or without blank lines around them", async () => {
    const gaps = async (doc: string) => {
      await start(doc, 0);
      return browser.execute(() => {
        const view = window.__bismillah?.view;
        if (!view) return null;
        // Measured between the glyphs: line blocks include padding (and, at the top,
        // the Basmallah), which is what differs between the two documents.
        const text = view.state.doc.toString();
        const at = (needle: string) => view.coordsAtPos(text.indexOf(needle) + 1);
        const [before, section, after] = [at("Before"), at("Section"), at("After")];
        if (!before || !section || !after) return null;
        return {
          before: Math.round(section.top - before.bottom),
          after: Math.round(after.top - section.bottom),
        };
      });
    };
    for (const level of ["#", "##", "###"]) {
      const spaced = await gaps(`Before.\n\n${level} Section\n\nAfter.`);
      const joined = await gaps(`Before.\n${level} Section\nAfter.`);
      expect([level, joined]).toEqual([level, spaced]);
    }
  });

  it("puts the pen down on Escape: no caret, no revealed block, no lit section", async () => {
    const doc = "# Title\n\nA *first* paragraph.\n\nA second one.";
    await start(doc, doc.indexOf("first"));
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ focus_mode: true });
    });
    const look = () =>
      browser.execute(() => {
        const view = window.__bismillah?.view;
        const layer = view?.dom.querySelector(".cm-cursorLayer");
        return {
          resting: !!view?.dom.classList.contains("cm-resting"),
          caretHidden: layer ? getComputedStyle(layer).visibility === "hidden" : false,
          // The paragraph shows its rendered look: its asterisks are no longer drawn.
          marksHidden: [...(view?.dom.querySelectorAll(".cm-line") ?? [])].some(
            (line) => line.textContent === "A first paragraph.",
          ),
          dimmed: view?.dom.querySelectorAll(".cm-zuhd-dim").length ?? -1,
        };
      });
    const writing = await look();
    expect(writing.resting).toBe(false);
    expect(writing.marksHidden).toBe(false);
    expect(writing.dimmed).toBeGreaterThan(0);

    await press("Escape");
    expect(await look()).toEqual({
      resting: true,
      caretHidden: true,
      marksHidden: true,
      dimmed: 0,
    });
    expect(await text()).toBe(doc);

    // A caret move picks the pen up where it was.
    await press("ArrowRight");
    const resumed = await look();
    expect(resumed.resting).toBe(false);
    expect(resumed.marksHidden).toBe(false);
    expect(resumed.dimmed).toBeGreaterThan(0);
  });
});
