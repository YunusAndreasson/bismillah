import { browser, expect } from "@wdio/globals";
import { PNG } from "pngjs";
import { setViewport, settle, waitForApp } from "../app.ts";
import { loadDoc } from "./spikes/helpers.ts";

/**
 * The Basmallah opening (ADR-0008, DESIGN.md §11.2), drawn from pre-shaped outlines over
 * the real text (ADR-0011). Geometry is read from the real webview.
 */

const BASMALLAH = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Geometry {
  text: Rect;
  textRects: number;
  ink: Rect;
  box: Rect;
  baseline: number;
  inkBaseline: number;
}

/** The text's and the ink's boxes, the content box they must fit, and both baselines. */
async function geometry(): Promise<Geometry | null> {
  return browser.execute(() => {
    const opening = document.querySelector<HTMLElement>(".cm-basmallah");
    const line = opening?.querySelector<HTMLElement>(".cm-basmallah-line");
    const text = opening?.querySelector(".cm-basmallah-text");
    const ink = opening?.querySelector(".cm-basmallah-ink");
    if (!opening || !line || !text || !ink) return null;
    const rect = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    // A zero-size inline block sits on the line's baseline.
    const probe = document.createElement("span");
    probe.style.display = "inline-block";
    probe.style.width = "0";
    probe.style.height = "0";
    line.append(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const style = getComputedStyle(opening);
    const outer = opening.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(line).fontSize);
    const descent = parseFloat(style.getPropertyValue("--basmallah-descent"));
    const inkRect = ink.getBoundingClientRect();
    return {
      text: rect(text.getBoundingClientRect()),
      textRects: text.getClientRects().length,
      ink: rect(inkRect),
      box: {
        left: outer.left + parseFloat(style.paddingLeft),
        right: outer.right - parseFloat(style.paddingRight),
        top: outer.top,
        bottom: outer.bottom,
      },
      baseline,
      inkBaseline: inkRect.bottom - descent * fontSize,
    };
  });
}

async function selectOpening(): Promise<string> {
  return browser.execute(() => {
    const text = document.querySelector(".cm-basmallah-text")?.firstChild;
    const selection = document.getSelection();
    if (!text || !selection) return "";
    selection.selectAllChildren(text.parentNode as Node);
    return selection.toString();
  });
}

describe("the Basmallah opening", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => window.__bismillah?.setTypewriter(false));
    await setViewport(browser, 1280, 900);
  });

  afterEach(async () => {
    await browser.execute(() => document.getSelection()?.removeAllRanges());
  });

  it("keeps the real text for screen readers and hides the ink from them", async () => {
    const dom = await browser.execute(() => {
      const opening = document.querySelector<HTMLElement>(".cm-basmallah");
      const ink = opening?.querySelector(".cm-basmallah-ink");
      return {
        count: document.querySelectorAll(".cm-basmallah").length,
        lang: opening?.lang,
        dir: opening?.dir,
        text: opening?.querySelector(".cm-basmallah-text")?.textContent,
        inkHidden: ink?.getAttribute("aria-hidden"),
        inkText: ink?.textContent,
        inDoc: window.__bismillah?.view.state.doc.toString().includes("بِسْمِ"),
      };
    });
    expect(dom).toEqual({
      count: 1,
      lang: "ar",
      dir: "rtl",
      text: BASMALLAH,
      inkHidden: "true",
      inkText: "",
      inDoc: false,
    });
  });

  it("lays the ink exactly over the text's advance box and baseline", async () => {
    for (const scale of [1, 1.5]) {
      await browser.execute(async (s: number) => {
        await window.__bismillah?.setScale(s);
      }, scale);
      const g = await geometry();
      expect(g).not.toBeNull();
      if (!g) return;
      expect(Math.abs(g.ink.left - g.text.left)).toBeLessThan(1);
      expect(Math.abs(g.ink.right - g.text.right)).toBeLessThan(1);
      expect(Math.abs(g.inkBaseline - g.baseline)).toBeLessThan(0.5);
      expect(g.textRects).toBe(1);
    }
    await browser.execute(async () => {
      await window.__bismillah?.setScale(1);
    });
  });

  it("stays on one line inside the column at the narrowest window and largest size", async () => {
    await setViewport(browser, 480, 600);
    await browser.execute(async () => {
      await window.__bismillah?.setScale(3);
    });
    const g = await geometry();
    expect(g).not.toBeNull();
    if (g) {
      expect(g.textRects).toBe(1);
      expect(g.ink.left).toBeGreaterThanOrEqual(g.box.left - 0.5);
      expect(g.ink.right).toBeLessThanOrEqual(g.box.right + 0.5);
      expect(Math.abs(g.ink.left - g.text.left)).toBeLessThan(1);
      expect(Math.abs(g.inkBaseline - g.baseline)).toBeLessThan(0.5);
    }
    await browser.execute(async () => {
      await window.__bismillah?.setScale(1);
    });
    await setViewport(browser, 1280, 900);
  });

  it("can be selected, showing the selection colour behind the ink", async () => {
    // selection-background and text-primary per theme (DESIGN.md §9.2).
    const colours = {
      light: { selection: [0xd6, 0xea, 0xdf], ink: [0x1e, 0x1e, 0x1e] },
      dark: { selection: [0x23, 0x43, 0x2f], ink: [0xd4, 0xd4, 0xd2] },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      // The theme applies once Rust has saved it, and then remeasures (redrawing the
      // opening): select only after that, or the redraw drops the selection.
      await browser.execute(async (t: "light" | "dark") => {
        await window.__bismillah?.changeSettings({ theme: t });
      }, theme);
      expect(await selectOpening()).toBe(BASMALLAH);
      await settle(browser);
      // CodeMirror leaves a selection inside the widget alone, and its own is unchanged.
      const [kept, head] = await browser.execute(() => [
        document.getSelection()?.toString(),
        window.__bismillah?.view.state.selection.main.head,
      ]);
      expect(kept).toBe(BASMALLAH);
      expect(head).toBe(0);

      const [rect, ratio] = await browser.execute(() => {
        const r = document.querySelector(".cm-basmallah-text")?.getBoundingClientRect();
        return [
          r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null,
          devicePixelRatio,
        ];
      });
      expect(rect).not.toBeNull();
      if (!rect) return;
      const png = PNG.sync.read(Buffer.from(await browser.takeScreenshot(), "base64"));
      const near = (i: number, [r, g, b]: readonly number[]) =>
        Math.abs((png.data[i] ?? 0) - (r ?? 0)) <= 3 &&
        Math.abs((png.data[i + 1] ?? 0) - (g ?? 0)) <= 3 &&
        Math.abs((png.data[i + 2] ?? 0) - (b ?? 0)) <= 3;
      let selection = 0;
      let ink = 0;
      let total = 0;
      for (let y = Math.ceil(rect.top * ratio); y < Math.floor(rect.bottom * ratio); y++) {
        for (let x = Math.ceil(rect.left * ratio); x < Math.floor(rect.right * ratio); x++) {
          const i = (y * png.width + x) * 4;
          total++;
          if (near(i, colours[theme].selection)) selection++;
          else if (near(i, colours[theme].ink)) ink++;
        }
      }
      // The box is mostly selection colour, and the ink stays fully drawn on top of it.
      expect(selection / total).toBeGreaterThan(0.5);
      expect(ink / total).toBeGreaterThan(0.04);
      await browser.execute(() => document.getSelection()?.removeAllRanges());
    }
    await browser.execute(() => window.__bismillah?.setTheme("light"));
  });

  it("selects with the mouse: a drag across it, a double-click on a word", async () => {
    const r = await browser.execute(() => {
      const b = document.querySelector(".cm-basmallah-text")?.getBoundingClientRect();
      return b ? { left: b.left, right: b.right, y: (b.top + b.bottom) / 2 } : null;
    });
    expect(r).not.toBeNull();
    if (!r) return;
    const y = Math.round(r.y);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(r.right - 3), y })
      .down()
      .move({ x: Math.round((r.left + r.right) / 2), y, duration: 100 })
      .move({ x: Math.round(r.left + 3), y, duration: 100 })
      .up()
      .perform();
    await settle(browser);
    const dragged = await browser.execute(() => ({
      text: document.getSelection()?.toString(),
      editor: window.__bismillah?.view.state.selection.main.toJSON(),
    }));
    expect(dragged).toEqual({ text: BASMALLAH, editor: { anchor: 0, head: 0 } });

    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(r.right - 15), y })
      .down()
      .up()
      .pause(40)
      .down()
      .up()
      .perform();
    await settle(browser);
    expect(await browser.execute(() => document.getSelection()?.toString())).toBe("بِسْمِ");
  });

  it("copies exactly the selected Basmallah", async () => {
    await selectOpening();
    const copied = await browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return null;
      const event = new ClipboardEvent("copy", {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      return {
        text: event.clipboardData?.getData("text/plain"),
        prevented: event.defaultPrevented,
      };
    });
    expect(copied).toEqual({ text: BASMALLAH, prevented: true });
  });

  it("is left out when the document already opens with a Basmallah, and returns", async () => {
    await loadDoc("بسم الله الرحمن الرحيم\n\nThe letter begins here.\n");
    expect(await browser.execute(() => document.querySelectorAll(".cm-basmallah").length)).toBe(0);
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.dispatch({ changes: { from: 0, to: view.state.doc.line(1).to, insert: "# A letter" } });
    });
    await settle(browser);
    expect(await browser.execute(() => document.querySelectorAll(".cm-basmallah").length)).toBe(1);
  });

  it("causes no content-security-policy violations", async () => {
    expect(await browser.execute(() => window.__cspViolations ?? [])).toEqual([]);
  });
});
