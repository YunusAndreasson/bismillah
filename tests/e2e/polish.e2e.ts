import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { Folder, open } from "./files.ts";
import { loadDoc, setCursor } from "./spikes/helpers.ts";

/** Daily writing stays still as typography, Markdown and save acknowledgements change. */
describe("daily writing polish", () => {
  let folder: Folder;
  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({
        always_show_markdown: false,
        typewriter_scrolling: false,
        focus_mode: false,
        fade_chrome: false,
      });
    });
  });
  after(() => folder.remove());

  it("leaves room for the first paragraph on a short laptop screen", async () => {
    await loadDoc("# A beginning\n\nThe first paragraph invites the writer to continue.\n");
    for (const [width, height] of [
      [640, 360],
      [1280, 800],
      [1920, 900],
      [2560, 900],
    ] as const) {
      await setViewport(browser, width, height);
      const position = await browser.execute(() => {
        const view = window.__bismillah?.view;
        if (!view) return null;
        view.scrollDOM.scrollTop = 0;
        const at = view.state.doc.toString().indexOf("The first");
        return { top: view.coordsAtPos(at)?.top ?? Infinity, height: innerHeight };
      });
      expect(position).not.toBeNull();
      expect(position?.top).toBeLessThan((position?.height ?? 0) * 0.7);
    }
  });

  it("keeps mixed-script line geometry when the caret crosses languages", async () => {
    await setViewport(browser, 1280, 800);
    const text =
      "The word أَمَانَةٌ means trust, and زهد names the focus mode.\n\nبِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\n\nذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ\n";
    await loadDoc(text);
    for (const profile of ["duo", "serif", "amiri", "plex-arabic"] as const) {
      await browser.execute(
        async (p: typeof profile) => window.__bismillah?.setProfile(p),
        profile,
      );
      await setCursor(1);
      const before = await browser.execute(() => window.__bismillah?.geometry.lineBox(1));
      await setCursor(text.indexOf("أَمَانَةٌ") + 3);
      const after = await browser.execute(() => window.__bismillah?.geometry.lineBox(1));
      expect(after).toEqual(before);
      expect(await browser.execute(() => window.__bismillah?.view.state.doc.toString())).toBe(text);
    }
    await browser.execute(async () => window.__bismillah?.setProfile("duo"));
  });

  it("keeps the reading row when Escape folds a wrapped Markdown paragraph", async () => {
    await setViewport(browser, 640, 600);
    const prefix = "An earlier paragraph.\n\n".repeat(16);
    const paragraph = "A *word* and a [reference](a-long-local-reference.md) in prose. ".repeat(14);
    await loadDoc(`${prefix}${paragraph}\n\nAfter the paragraph.\n`);
    await setCursor(prefix.length + paragraph.length - 3);
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return;
      const caret = view.coordsAtPos(view.state.selection.main.head);
      if (caret) view.scrollDOM.scrollTop += caret.top - 230;
    });
    await settle(browser);
    const top = () =>
      browser.execute(() => {
        const view = window.__bismillah?.view;
        return view?.coordsAtPos(view.state.selection.main.head)?.top ?? null;
      });
    const before = await top();
    await browser.keys("Escape");
    await settle(browser);
    const after = await top();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(Math.abs((after ?? Infinity) - (before ?? 0))).toBeLessThan(2);
  });

  it("keeps the reading row when Find opens and closes", async () => {
    await setViewport(browser, 1280, 800);
    await loadDoc("A paragraph to keep in view.\n\n".repeat(80));
    await setCursor(1100);
    await browser.execute(() => {
      const v = window.__bismillah?.view;
      const caret = v?.coordsAtPos(v.state.selection.main.head);
      if (v && caret) v.scrollDOM.scrollTop += caret.top - 300;
    });
    await settle(browser);
    const top = () =>
      browser.execute(() => {
        const v = window.__bismillah?.view;
        return v?.coordsAtPos(v.state.selection.main.head)?.top ?? null;
      });
    const before = await top();
    await browser.execute(() => window.__bismillah?.run("edit.find"));
    await browser.$(".cm-search").waitForDisplayed();
    await settle(browser);
    expect(Math.abs(((await top()) ?? Infinity) - (before ?? 0))).toBeLessThan(2);
    await browser.keys("Escape");
    await settle(browser);
    expect(Math.abs(((await top()) ?? Infinity) - (before ?? 0))).toBeLessThan(2);
  });

  it("keeps the filename and reading time still through real save acknowledgements", async () => {
    await setViewport(browser, 1280, 800);
    await open(folder.file("A daily page.md", "A quiet page.\n"));
    const positions = () =>
      browser.execute(() => {
        const rect = (selector: string) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? { left: r.left, right: r.right, top: r.top } : null;
        };
        return { name: rect(".status .name"), count: rect(".status .count") };
      });
    const before = await positions();
    const saving = await browser.execute(async () => {
      const hooks = window.__bismillah;
      const view = hooks?.view;
      view?.dispatch({ changes: { from: view.state.doc.length, insert: "Another sentence." } });
      await Promise.resolve();
      return hooks?.saveState()?.state.kind;
    });
    expect(saving).toBe("saving");
    expect(await positions()).toEqual(before);
    expect(await browser.execute(async () => window.__bismillah?.flush())).toBe(true);
    await settle(browser);
    expect(await positions()).toEqual(before);

    for (const words of [1800, 2000]) {
      await loadDoc("word ".repeat(words));
      await settle(browser);
      expect((await positions()).count).toEqual(before.count);
    }
  });
});
