import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import {
  fixture,
  head,
  isRtlLetter,
  lineOf,
  loadDoc,
  press,
  scrollIntoView,
} from "./spikes/helpers.ts";

/**
 * Live preview's tables and code blocks in the real app (ADR-0012, DESIGN.md §11):
 * a table outside the caret's block is a grid, a click in it leaves the caret on the
 * clicked character with the clicked row kept in place, the arrow keys step into it,
 * and a code block sits on its ground with its fences painted out.
 */

const PARKING = "Plain closing paragraph.";

/** Puts the caret in the closing paragraph without scrolling, so the tables draw. */
async function park(): Promise<void> {
  await browser.execute((needle: string) => {
    const view = window.__bismillah?.view;
    if (!view) return;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(needle) } });
  }, PARKING);
  await settle(browser);
}

interface Grid {
  dir: string;
  head: string[];
  rows: string[][];
}

async function grids(): Promise<Grid[]> {
  return browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".cm-table")].map((wrap) => ({
      dir: wrap.dir,
      head: [...wrap.querySelectorAll("th")].map((th) => th.textContent ?? ""),
      rows: [...wrap.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
      ),
    })),
  );
}

interface Letter {
  text: string;
  /** UTF-16 offset of the letter in the needle. */
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Each letter of `needle` as a drawn grid shows it, with its box on screen. */
async function gridLetters(needle: string): Promise<Letter[]> {
  return browser.execute((n: string) => {
    for (const wrap of document.querySelectorAll(".cm-table")) {
      const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(n) ?? -1;
        if (at < 0) continue;
        const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
        return [...segmenter.segment(n)].map(({ segment, index }) => {
          const range = document.createRange();
          range.setStart(node, at + index);
          range.setEnd(node, at + index + segment.length);
          const r = range.getBoundingClientRect();
          return {
            text: segment,
            index,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          };
        });
      }
    }
    return [];
  }, needle);
}

/** Where CodeMirror puts the caret (the drawn caret needs window focus, which Xvfb
 * never gives). */
async function caretBox(): Promise<{ top: number; bottom: number } | null> {
  return browser.execute(() => {
    const view = window.__bismillah?.view;
    if (!view) return null;
    const { head, assoc } = view.state.selection.main;
    const rect = view.coordsAtPos(head, assoc < 0 ? -1 : 1);
    return rect ? { top: rect.top, bottom: rect.bottom } : null;
  });
}

async function drawnLine(pos: number): Promise<string> {
  return browser.execute((p: number) => {
    const view = window.__bismillah?.view;
    if (!view) return "";
    const { node } = view.domAtPos(p);
    const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
    return el?.textContent ?? "";
  }, pos);
}

describe("live preview: tables and code", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1000, 900);
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.setProfile("duo");
      await window.__bismillah?.changeSettings({ always_show_markdown: false });
    });
    await loadDoc(fixture("live-preview-blocks.md"));
  });

  it("draws tables as grids outside the caret's block, cells rendered, in their direction", async () => {
    await park();
    expect(await grids()).toEqual([
      {
        dir: "ltr",
        head: ["Profile", "Size", "Line height"],
        rows: [
          ["iA Writer Duo", "20", "1.6"],
          ["Source Serif 4", "21", "1.6"],
          ["Amiri", "24", "1.8"],
        ],
      },
      {
        dir: "rtl",
        head: ["الخط", "الحجم"],
        rows: [
          ["أميري القرآن", "٢٤"],
          ["خطٌّ آخر", "٢١"],
        ],
      },
    ]);
    // A right-aligned column is drawn so; emphasis and code keep their look.
    const looks = await browser.execute(() => {
      const table = document.querySelector(".cm-table");
      const size = table?.querySelector("tbody td:nth-child(2)");
      return {
        size: size ? getComputedStyle(size).textAlign : null,
        em: table?.querySelector(".cm-em")?.textContent ?? null,
        code: table?.querySelector(".cm-md-code")?.textContent ?? null,
      };
    });
    expect(looks).toEqual({ size: "right", em: "Duo", code: "Amiri" });
  });

  for (const [needle, source] of [
    ["Profile", "Profile"],
    ["Duo", "*Duo*"],
    ["Source Serif", "Source Serif"],
    ["Amiri", "`Amiri`"],
    ["الحجم", "الحجم"],
    ["القرآن", "**القرآن**"],
    ["خطٌّ آخر", "خطٌّ آخر"],
  ] as const) {
    it(`puts the caret on the clicked side of a letter in a grid, and keeps its row: ${needle}`, async () => {
      const at = await browser.execute(
        (s: string) => window.__bismillah?.view.state.doc.toString().indexOf(s) ?? -1,
        source,
      );
      const start = at + source.indexOf(needle);
      const line = await lineOf(source);
      // CodeMirror draws only what is on screen.
      await park();
      await scrollIntoView(line.from);
      const letters = (await gridLetters(needle)).filter((l) => /\p{L}/u.test(l.text));
      const picks = [letters[0], letters[Math.floor(letters.length / 2)], letters.at(-1)];
      for (const pick of picks) {
        if (!pick) throw new Error(`${needle} isn't drawn`);
        const rtl = isRtlLetter(pick.text);
        for (const quarter of [0.25, 0.75]) {
          await park();
          await scrollIntoView(line.from);
          const [c] = (await gridLetters(needle)).filter((l) => l.index === pick.index);
          if (!c) throw new Error(`${pick.text} is gone`);
          const pointer = () => browser.action("pointer", { parameters: { pointerType: "mouse" } });
          await pointer()
            .move({
              x: Math.round(c.left + (c.right - c.left) * quarter),
              y: Math.round((c.top + c.bottom) / 2),
            })
            .down()
            .perform();
          await settle(browser);
          // While the button is down the grid stays, with the caret drawn in the clicked row.
          const held = await caretBox();
          expect(await grids()).toHaveLength(2);
          expect(held && held.top >= c.top - 8 && held.bottom <= c.bottom + 8).toBe(true);
          await pointer().up().perform();
          await settle(browser);
          const leftSide = quarter < 0.5;
          const expected = start + pick.index + (rtl === leftSide ? pick.text.length : 0);
          expect([pick.text, quarter, await head()]).toEqual([pick.text, quarter, expected]);
          // At the release the table reveals its Markdown, the caret's row where it was.
          expect(await drawnLine(line.from)).toBe(
            await browser.execute(
              (p: number) => window.__bismillah?.view.state.doc.lineAt(p).text ?? "",
              line.from,
            ),
          );
          expect(Math.abs(((await caretBox())?.top ?? -1000) - (held?.top ?? 0))).toBeLessThan(1);
        }
      }
    });
  }

  it("selects the clicked word on a double-click in a grid", async () => {
    for (const [needle, word] of [
      ["Serif", "Serif"],
      ["آخر", "آخر"],
    ] as const) {
      const line = await lineOf(word);
      await park();
      await scrollIntoView(line.from);
      const [c] = await gridLetters(needle);
      if (!c) throw new Error(`${needle} isn't drawn`);
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: Math.round((c.left + c.right) / 2), y: Math.round((c.top + c.bottom) / 2) })
        .down()
        .up()
        .pause(40)
        .down()
        .up()
        .perform();
      await settle(browser);
      const selected = await browser.execute(() => {
        const view = window.__bismillah?.view;
        if (!view) return "";
        const { from, to } = view.state.selection.main;
        return view.state.sliceDoc(from, to);
      });
      expect(selected).toBe(word);
    }
  });

  it("steps into a table with the arrow keys instead of over it", async () => {
    const above = await lineOf("Above the table.");
    const header = await lineOf("| Profile");
    await browser.execute((p: number) => {
      const view = window.__bismillah?.view;
      view?.focus();
      view?.dispatch({ selection: { anchor: p }, scrollIntoView: true });
    }, above.to);
    await settle(browser);
    await press("ArrowDown");
    await press("ArrowDown");
    expect(await head()).toBe(header.from);
    expect(await drawnLine(header.from)).toBe("| Profile | Size | Line height |");
    await press("ArrowDown");
    expect(await head()).toBe((await lineOf("|---|---:|---:|")).from);

    const below = await lineOf("Below the table.");
    await browser.execute((p: number) => {
      window.__bismillah?.view.dispatch({ selection: { anchor: p }, scrollIntoView: true });
    }, below.from);
    await settle(browser);
    await press("ArrowUp");
    await press("ArrowUp");
    expect(await head()).toBe((await lineOf("| `Amiri`")).from);
    // Shift extends the selection into the table the same way.
    await browser.execute((p: number) => {
      window.__bismillah?.view.dispatch({ selection: { anchor: p } });
    }, below.from - 1);
    await settle(browser);
    await press("Shift", "ArrowUp");
    await browser.keys("Shift");
    const selection = await browser.execute(() => {
      const main = window.__bismillah?.view.state.selection.main;
      return main ? { anchor: main.anchor, head: main.head } : null;
    });
    expect(selection).toEqual({ anchor: below.from - 1, head: (await lineOf("| `Amiri`")).from });
  });

  it("puts a code block on its ground with its fences painted out, and shows them in it", async () => {
    await park();
    const code = () =>
      browser.execute(() => {
        const lines = [...document.querySelectorAll(".cm-line.cm-md-codeblock")];
        return {
          lines: lines.length,
          fence: document.querySelector(".cm-line.cm-md-fence")?.textContent ?? null,
          label: document.querySelector(".cm-md-codeinfo")?.textContent ?? null,
          hidden: [...document.querySelectorAll(".cm-md-codeblock .cm-md-hidden")].map((el) => [
            el.textContent,
            getComputedStyle(el).color,
          ]),
          ground: lines[0] ? getComputedStyle(lines[0]).backgroundColor : null,
        };
      });
    const rendered = await code();
    expect(rendered.lines).toBe(5);
    expect(rendered.fence).toBe("```rust");
    expect(rendered.label).toBe("rust");
    expect(rendered.hidden).toEqual([
      ["```", "rgba(0, 0, 0, 0)"],
      ["```", "rgba(0, 0, 0, 0)"],
    ]);
    expect(rendered.ground).not.toBe("rgba(0, 0, 0, 0)");
    await browser.execute(() => window.__bismillah?.caretAt("println"));
    await settle(browser);
    expect(await code()).toEqual({ lines: 0, fence: null, label: null, hidden: [], ground: null });
  });

  it("shows tables and code as Markdown with Always show Markdown", async () => {
    await park();
    await press("Control", "r");
    await browser.keys("Control");
    await settle(browser);
    const counts = () =>
      browser.execute(() => ({
        tables: document.querySelectorAll(".cm-table").length,
        code: document.querySelectorAll(".cm-md-codeblock").length,
      }));
    expect(await counts()).toEqual({ tables: 0, code: 0 });
    await press("Control", "r");
    await browser.keys("Control");
    await settle(browser);
    expect(await counts()).toEqual({ tables: 2, code: 5 });
  });
});
