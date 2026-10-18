import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../../app.ts";
import { clusters, fixture, head, loadDoc, press, setCursor } from "./helpers.ts";

/**
 * Phase 0 spike: Uthmani and transliteration glyphs (PLAN.md). Pasted Uthmani verses
 * render in Amiri Quran and survive unchanged; IJMES letters come from Bismillah Duo,
 * never a system fallback; the caret crosses stacked marks as one character.
 */

function verses(name: string): string[] {
  return fixture(`quran/${name}`)
    .split("\n")
    .filter((line) => /^\d+\|\d+\|/.test(line))
    .map((line) => line.split("|").slice(2).join("|"));
}

/**
 * Pastes text into the editor with the DOM paste event CodeMirror receives from the
 * platform. The webview refuses navigator.clipboard.writeText, so the native clipboard
 * path is covered separately by spikes/webview/clipboard.ts.
 */
async function paste(text: string): Promise<void> {
  await browser.execute((t: string) => {
    const view = window.__bismillah?.view;
    view?.focus();
    const data = new DataTransfer();
    data.setData("text/plain", t);
    view?.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

describe("Uthmani and transliteration glyphs", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1280, 900);
    await browser.execute(() => window.__bismillah?.setTypewriter(false));
  });

  for (const file of [
    "tanzil-uthmani.txt",
    "tanzil-uthmani-no-tatweel.txt",
    "qurancom-uthmani.txt",
    "qurancom-qpc-hafs.txt",
  ]) {
    it(`pastes ${file} and keeps every byte`, async () => {
      for (const verse of verses(file)) {
        await loadDoc("");
        await paste(verse);
        await settle(browser);
        const text = await browser.execute(() => window.__bismillah?.view.state.doc.toString());
        expect(text).toBe(verse);
      }
    });
  }

  it("sets Uthmani runs in Amiri Quran and modern Arabic in the paired font", async () => {
    const [verse] = verses("tanzil-uthmani.txt").slice(8, 9); // 2:2, has U+06DB
    await loadDoc(`${verse ?? ""}\n\nالْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ`);
    const [fonts, paired] = await browser.execute(() => {
      const family = (el: Element) => getComputedStyle(el).fontFamily.replaceAll('"', "").trim();
      const runs = [...document.querySelectorAll(".cm-ar")].map((el) => [
        el.classList.contains("cm-quran"),
        family(el),
      ]);
      const root = getComputedStyle(document.documentElement);
      return [runs, root.getPropertyValue("--doc-font-arabic").replaceAll('"', "").trim()];
    });
    expect(fonts).toEqual([
      [true, "Amiri Quran"],
      [false, paired],
    ]);
  });

  it("draws every IJMES letter from Bismillah Duo at Duo's width", async () => {
    // Spaced apart so kerning can't change a width. A system fallback font would be
    // about half as wide (ʿ ʾ) or proportional (Ī), far outside the 1px allowance.
    const letters = [..."hāīūĀĪŪḥṣḍṭẓḤṢḌṬẒʿʾ"];
    const text = letters.join(" ");
    await loadDoc(text);
    const parts = (await clusters(0, text.length)).filter((c) => c.text !== " ");
    const width = (c: { left: number; right: number }) => c.right - c.left;
    const h = parts[0];
    expect(h?.text).toBe("h");
    for (const c of parts.slice(1)) {
      expect([c.text, Math.abs(width(c) - width(h ?? c)) <= 1]).toEqual([c.text, true]);
    }
  });

  it("renders a decomposed ḥ (h + U+0323) in Duo, like the precomposed letter", async () => {
    await loadDoc("ḥ h\u0323");
    const parts = await clusters(0, 4);
    const [pre, , dec] = parts;
    expect(dec?.text).toBe("h\u0323");
    expect((dec?.right ?? 0) - (dec?.left ?? 0)).toBeCloseTo((pre?.right ?? 0) - (pre?.left ?? 0), 0);
  });

  it("moves the caret over a letter and its marks as one character", async () => {
    const word = "بِسْمِ ٱللَّهِ";
    await loadDoc(word);
    const boundaries = (await clusters(0, word.length)).map((c) => c.from).concat(word.length);
    await setCursor(0);
    const visited: number[] = [];
    for (let i = 0; i < boundaries.length + 1; i++) {
      visited.push(await head());
      await press("ArrowLeft"); // RTL line: visual left is logical forward
    }
    for (const pos of visited) expect(boundaries).toContain(pos);
    expect(new Set(visited).size).toBe(boundaries.length);
  });
});
