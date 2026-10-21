import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { setViewport, waitForApp } from "../app.ts";

const TEXT = "العَرَبِيَّةُ أَمَانَةٌ.\n\nEnglish with العَرَبِيَّةُ mixed in.";

async function hidden(): Promise<boolean> {
  return browser.execute(() => !!window.__bismillah?.view.dom.hasAttribute("data-caret-hidden"));
}

async function focus(): Promise<void> {
  await browser.execute(() => window.__bismillah?.view.focus());
}

describe("normal caret blinking in the real webview", () => {
  let previousFocus: string | undefined;
  let previousSize: { width: number; height: number } | undefined;
  before(async () => {
    await waitForApp(browser);
    previousFocus = execFileSync("xdotool", ["getwindowfocus", "-f"], { encoding: "utf8" }).trim();
    previousSize = await browser.getWindowRect();
    const pid = await browser.execute(async () => window.__bismillah?.pid());
    if (!pid) throw new Error("no app process");
    const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(pid)], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1);
    if (!id) throw new Error("no private window");
    execFileSync("xdotool", ["windowfocus", "--sync", id]);
    await browser.execute(async (text: string) => {
      await window.__bismillah?.setDoc(text);
      window.__bismillah?.blinkCaret(true);
    }, TEXT);
    await focus();
  });

  after(async () => {
    await browser.execute(async () => {
      window.__bismillah?.blinkCaret(false);
      await window.__bismillah?.changeSettings({ theme: "system", text_scale: 1 });
    });
    if (previousSize)
      await browser.setWindowRect(null, null, previousSize.width, previousSize.height);
    // X focus and remembered window size otherwise leak into subsequent spec files.
    if (previousFocus) execFileSync("xdotool", ["windowfocus", previousFocus]);
  });

  it("blinks without an infinite CSS animation or changes to the text", async () => {
    await browser.waitUntil(hidden);
    await browser.waitUntil(async () => !(await hidden()));
    const state = await browser.execute(() => {
      const view = window.__bismillah?.view;
      const layer = view?.dom.querySelector(".cm-cursorLayer");
      return {
        focused: view?.hasFocus,
        animation: layer ? getComputedStyle(layer).animationName : null,
        text: view?.state.doc.toString(),
      };
    });
    expect(state).toEqual({ focused: true, animation: "none", text: TEXT });
  });

  it("shows the caret immediately when moving through vocalised Arabic and mixed text", async () => {
    for (const position of [0, 5, TEXT.indexOf("English"), TEXT.length]) {
      await browser.waitUntil(hidden);
      const visible = await browser.execute((anchor: number) => {
        const view = window.__bismillah?.view;
        view?.dispatch({ selection: { anchor } });
        return !view?.dom.hasAttribute("data-caret-hidden");
      }, position);
      expect(visible).toBe(true);
    }
  });

  it("stops when another control has focus, then resumes on return", async () => {
    await browser.waitUntil(hidden);
    await browser.execute(() => window.__bismillah?.view.contentDOM.blur());
    await browser.pause(1400);
    expect(await hidden()).toBe(false);
    await focus();
    await browser.waitUntil(hidden);
  });

  it("keeps typing and undo intact while normal blinking is enabled", async () => {
    const counts = await browser.execute(() => window.__bismillah?.wordCounter().runs);
    await browser.pause(1400);
    expect(await browser.execute(() => window.__bismillah?.wordCounter().runs)).toBe(counts);
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await browser.keys("x");
    await browser.pause(700);
    expect(await browser.execute(() => window.__bismillah?.wordCounter().runs)).toBeGreaterThan(
      counts ?? 0,
    );
    expect(await browser.execute(() => window.__bismillah?.view.state.doc.toString())).toBe(
      `${TEXT}x`,
    );
    await browser.keys(["Control", "z"]);
    await browser.keys("Control");
    expect(await browser.execute(() => window.__bismillah?.view.state.doc.toString())).toBe(TEXT);
  });

  it("draws a focused selection in selection-background, under readable text", async () => {
    // CodeMirror's own focused colour (a pale lavender) once outranked ours, and in the
    // dark theme the selected text vanished into it.
    for (const theme of ["light", "dark"] as const) {
      const drawn = await browser.execute(async (t: "light" | "dark") => {
        const hooks = window.__bismillah;
        if (!hooks) throw new Error("no editor");
        await hooks.changeSettings({ theme: t });
        hooks.view.focus();
        hooks.view.dispatch({ selection: { anchor: 0, head: hooks.view.state.doc.length } });
        await hooks.settle();
        const box = hooks.view.dom.querySelector(".cm-selectionBackground");
        return {
          focused: hooks.view.dom.classList.contains("cm-focused"),
          background: box ? getComputedStyle(box).backgroundColor : null,
          expected: hooks.token("selection-background"),
        };
      }, theme);
      expect(drawn.focused).toBe(true);
      expect(drawn.background).toBe(drawn.expected);
    }
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.dispatch({ selection: { anchor: 0 } });
    });
  });

  it("keeps the Arabic caret aligned in both themes, all specimen widths and at 200%", async () => {
    mkdirSync("/tmp/bismillah-caret-shots", { recursive: true });
    await browser.execute(() => window.__bismillah?.blinkCaret(false));
    for (const width of [640, 1280, 1920, 2560]) {
      for (const theme of ["light", "dark"] as const) {
        await setViewport(browser, width, 800);
        await browser.execute(
          async (t: "light" | "dark", zoom: number) => {
            const hooks = window.__bismillah;
            if (!hooks) throw new Error("no editor");
            await hooks.changeSettings({ theme: t, text_scale: zoom });
            hooks.view.focus();
            hooks.view.dispatch({ selection: { anchor: 5 }, scrollIntoView: true });
            await hooks.settle();
          },
          theme,
          width === 640 ? 2 : 1,
        );
        const aligned = await browser.execute(() => {
          const view = window.__bismillah?.view;
          if (!view) return false;
          const marker = view.dom.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
          const caret = view.coordsAtPos(view.state.selection.main.head);
          return (
            !!marker &&
            !!caret &&
            marker.height > 0 &&
            Math.abs(marker.left - caret.left) < 3 &&
            Math.abs(marker.top - caret.top) < 3
          );
        });
        expect(aligned).toBe(true);
        await browser.saveScreenshot(`/tmp/bismillah-caret-shots/${width}-${theme}.png`);
      }
    }
  });
});
