import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { setViewport, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";

const specimen = readFileSync(resolve(REPO, "docs/specimen.md"), "utf8");
const book = Array.from({ length: 25 }, (_, i) => `\n# Chapter ${i}\n\n${specimen}\n`).join("");

describe("scrolling through mixed typography", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1280, 860);
  });

  after(async () => {
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({
        theme: "system",
        writing_profile: "duo",
        text_scale: 1,
      });
    });
  });

  for (const profile of ["duo", "serif", "plex-arabic", "amiri"] as const) {
    it(`keeps text drawn while reversing scroll direction in ${profile}`, async () => {
      await browser.execute(
        async (text: string, writing_profile: "duo" | "serif" | "plex-arabic" | "amiri") => {
          const hooks = window.__bismillah;
          if (!hooks) throw new Error("no editor");
          await hooks.changeSettings({
            writing_profile,
            theme: "light",
            always_show_markdown: false,
            focus_mode: false,
            text_scale: 1,
          });
          await hooks.setDoc(text);
          await hooks.settle();
        },
        book,
        profile,
      );
      const result = await browser.execute(async () => {
        const view = window.__bismillah?.view;
        if (!view) throw new Error("no editor");
        const text = view.state.doc.toString();
        const next = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
        view.scrollDOM.scrollTop = 0;
        await next();
        await next();
        let blank = 0;
        let maxOffset = 0;
        for (let i = 0; i < 240; i++) {
          view.scrollDOM.scrollTop += Math.floor(i / 40) % 2 ? -180 : 180;
          await next();
          // Read after the frame's other callbacks, including CodeMirror's measure.
          await new Promise<void>((done) => setTimeout(done, 0));
          const area = view.scrollDOM.getBoundingClientRect();
          const hit = document.elementFromPoint(
            area.left + area.width / 2,
            area.top + area.height / 2,
          );
          if (hit?.closest(".cm-gap")) blank++;
          maxOffset = Math.max(maxOffset, view.scrollDOM.scrollTop);
        }
        return { blank, maxOffset, unchanged: text === view.state.doc.toString() };
      });
      expect(result.blank).toBe(0);
      expect(result.maxOffset).toBeGreaterThan(5000);
      expect(result.unchanged).toBe(true);
    });
  }

  it("keeps its place when a dialog closes and focus comes back to the text", async () => {
    // Bits UI returns focus with a plain focus(), and WebKit scrolled the whole text
    // to its top: Settings or the palette at the end of a chapter lost the place.
    await browser.execute(async (text: string) => {
      await window.__bismillah?.setDoc(text);
      await window.__bismillah?.settle();
    }, book);
    const press = async (...keys: string[]) => {
      await browser.keys(keys);
      await browser.keys(keys.filter((k) => k === "Control" || k === "Shift"));
    };
    await press("Control", "End");
    await browser.pause(300);
    const top = () =>
      browser.execute(() => Math.round(document.querySelector(".cm-scroller")?.scrollTop ?? 0));
    const end = await top();
    expect(end).toBeGreaterThan(5000);
    for (const keys of [
      ["Control", ","],
      ["Control", "Shift", "p"],
    ]) {
      await press(...keys);
      await browser.$('[role="dialog"]').waitForDisplayed();
      await browser.keys("Escape");
      await browser.$('[role="dialog"]').waitForExist({ reverse: true });
      await browser.pause(200);
      expect(await top()).toBe(end);
    }
  });
});
