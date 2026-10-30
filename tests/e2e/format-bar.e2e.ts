import { chmodSync, readFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { Folder, open } from "./files.ts";
import { loadDoc } from "./spikes/helpers.ts";

/** The bar over a selection (ADR-0019): it follows the writer's selection, writes only
 * Markdown, and leaves the file alone when the font changes. */
describe("the formatting bar", () => {
  let folder: Folder;

  const docText = () => browser.execute(() => window.__bismillah?.view.state.doc.toString() ?? "");
  const selected = () =>
    browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return "";
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    });
  const bar = () => browser.$(".format-bar");

  /** A real press over the start of `word` and a drag to its end, still held. */
  async function press(word: string): Promise<void> {
    const points = await browser.execute((w: string) => {
      const view = window.__bismillah?.view;
      if (!view) return null;
      const at = view.state.doc.toString().indexOf(w);
      const a = view.coordsAtPos(at);
      const b = view.coordsAtPos(at + w.length);
      return a && b ? { x1: a.left, x2: b.left, y: (a.top + a.bottom) / 2 } : null;
    }, word);
    if (!points) throw new Error(`no coordinates for ${word}`);
    await browser
      .action("pointer", { id: "writer", parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(points.x1), y: Math.round(points.y) })
      .down()
      .move({ x: Math.round(points.x2), y: Math.round(points.y), duration: 50 })
      .perform(true);
  }

  async function select(word: string): Promise<void> {
    await browser.execute((w: string) => {
      const view = window.__bismillah?.view;
      if (!view) return;
      const at = view.state.doc.toString().indexOf(w);
      view.focus();
      view.dispatch({
        selection: { anchor: at, head: at + w.length },
        userEvent: "select",
      });
    }, word);
    await bar().waitForExist();
  }

  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    await setViewport(browser, 1280, 800);
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({
        always_show_markdown: false,
        typewriter_scrolling: false,
        focus_mode: false,
        fade_chrome: false,
        format_bar: true,
      });
    });
  });
  afterEach(async () => {
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ format_bar: true, writing_profile: "duo" });
    });
  });
  after(() => folder.remove());

  it("waits for the mouse's release, and keeps the words selected after it", async () => {
    await loadDoc("# Title\n\nThe first paragraph of the text.\n\nThe second one.\n");
    await press("paragraph");
    await settle(browser);
    expect(await bar().isExisting()).toBe(false);
    await browser
      .action("pointer", { id: "writer", parameters: { pointerType: "mouse" } })
      .up()
      .perform();
    await bar().waitForExist();
    expect(await selected()).toBe("paragraph");
  });

  it("a click writes the same Markdown as the shortcut, and the words stay selected", async () => {
    await loadDoc("A plain word here.\n");
    await select("word");
    await bar().$("button.bold").click();
    expect(await docText()).toBe("A plain **word** here.\n");
    expect(await selected()).toBe("word");
    expect(await bar().$("button.bold").getAttribute("aria-pressed")).toBe("true");
    await browser.execute(() => {
      window.__bismillah?.view.focus();
    });
    await browser.keys(["Control", "b"]);
    await browser.keys(["Control"]);
    expect(await docText()).toBe("A plain word here.\n");
  });

  it("saves exactly the marks, around vocalised Arabic", async () => {
    const text = "قال بِسْمِ ٱللَّهِ ثم\n";
    const path = folder.file("arabic.md", text);
    await open(path);
    await select("بِسْمِ ٱللَّهِ");
    await bar().$("button.bold").click();
    await browser.keys(["Control", "s"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(() => readFileSync(path, "utf8") === "قال **بِسْمِ ٱللَّهِ** ثم\n");
  });

  it("disables a mark the parser wouldn't read", async () => {
    await loadDoc('A "word"x here.\n');
    await select('"word"');
    expect(await bar().$("button.bold").isEnabled()).toBe(false);
    expect(await bar().$("button.italic").isEnabled()).toBe(false);
    expect(await bar().$("button.code").isEnabled()).toBe(true);
  });

  it("goes when the writer types", async () => {
    await loadDoc("A plain word here.\n");
    await select("word");
    await browser.keys("x");
    await settle(browser);
    expect(await bar().isExisting()).toBe(false);
    expect(await docText()).toBe("A plain x here.\n");
  });

  it("F6 moves into the bar, the arrows along it, and Esc back with the selection", async () => {
    await loadDoc("A plain word here.\n");
    await select("word");
    await browser.keys(["F6"]);
    const label = () =>
      browser.execute(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expect(await label()).toBe("Bold");
    await browser.keys(["ArrowRight"]);
    expect(await label()).toBe("Italic");
    await browser.keys(["Enter"]);
    expect(await docText()).toBe("A plain _word_ here.\n");
    await browser.keys(["Escape"]);
    expect(await selected()).toBe("word");
    expect(
      await browser.execute(() => document.activeElement?.classList.contains("cm-content")),
    ).toBe(true);
  });

  it("turns a line into a quote from the menu", async () => {
    await loadDoc("A plain word here.\n");
    await select("word");
    await bar().$('button[aria-label^="Turn into"]').click();
    const quote = browser.$(".menu-item*=Quote");
    await quote.waitForDisplayed();
    await quote.click();
    expect(await docText()).toBe("> A plain word here.\n");
    expect(await selected()).toBe("word");
  });

  it("changes the writing font without touching the file", async () => {
    const text = "A plain word here.\n";
    const path = folder.file("font.md", text);
    await open(path);
    await select("word");
    await bar().$('button[aria-label^="Writing font"]').click();
    const serif = browser.$(".menu-item*=Source Serif");
    await serif.waitForDisplayed();
    await serif.click();
    await browser.waitUntil(async () =>
      browser.execute(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--doc-font")
          .includes("Source Serif"),
      ),
    );
    expect(await docText()).toBe(text);
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(await selected()).toBe("word");
  });

  it("stays away from a read-only file", async () => {
    const path = folder.file("locked.md", "A plain word here.\n");
    chmodSync(path, 0o444);
    await open(path);
    await browser.execute(() => {
      window.__bismillah?.view.dispatch({
        selection: { anchor: 2, head: 7 },
        userEvent: "select",
      });
    });
    await browser.pause(450);
    expect(await bar().isExisting()).toBe(false);
  });

  it("stays away when switched off", async () => {
    await loadDoc("A plain word here.\n");
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ format_bar: false });
    });
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.dispatch({ selection: { anchor: 2, head: 7 }, userEvent: "select" });
    });
    await browser.pause(450);
    expect(await bar().isExisting()).toBe(false);
  });
});
