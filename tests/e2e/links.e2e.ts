import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { head, loadDoc } from "./spikes/helpers.ts";

/**
 * Links and folders handed to other apps (ADR-0003, PLAN.md Phase 6): Ctrl+click and
 * *Open link* send web and email links to the browser or mail app, and nothing else;
 * Settings › Files & privacy shows bismillah's folders and the library in the file
 * manager. Under the harness Rust records what it would hand on instead of opening it
 * (`handed()`), so nothing leaves the test run.
 */

const DOC = [
  "A [link with text](https://example.org/page) in a line.",
  "",
  "Mail <writer@example.org> or visit www.example.org/w today.",
  "",
  "A [script](javascript:alert(1)) and a [file](notes.md) stay put.",
  "",
  "| Source | Where |",
  "|---|---|",
  "| Tafsir | [online](https://example.org/tafsir) |",
  "",
  "انظر [التفسير](https://example.org/ar) هنا.",
  "",
  "The caret is here.",
].join("\n");

const handed = () => browser.execute(async () => (await window.__bismillah?.handed()) ?? []);
const note = () => browser.execute(() => window.__bismillah?.note() ?? "");

async function caretTo(needle: string): Promise<void> {
  await browser.execute((n: string) => window.__bismillah?.caretAt(n), needle);
  await settle(browser);
}

/** The middle of the character `offset` letters into the first `needle`. */
async function pointAt(needle: string, offset = 1): Promise<{ x: number; y: number }> {
  const point = await browser.execute(
    (n: string, o: number) => {
      const view = window.__bismillah?.view;
      const at = view?.state.doc.toString().indexOf(n) ?? -1;
      const box = at >= 0 ? view?.coordsAtPos(at + o, 1) : null;
      return box ? { x: box.left + 2, y: (box.top + box.bottom) / 2 } : null;
    },
    needle,
    offset,
  );
  if (!point) throw new Error(`${needle} isn't on screen`);
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/** A press and release of the main button with Ctrl held, as the writer does it. */
async function ctrlClick({ x, y }: { x: number; y: number }): Promise<void> {
  const pause = { type: "pause", duration: 0 } as const;
  await browser.performActions([
    {
      type: "key",
      id: "keyboard",
      actions: [{ type: "keyDown", value: "\u{E009}" }, pause, pause, pause, pause],
    },
    {
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        pause,
        { type: "pointerMove", duration: 0, x, y, origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
        pause,
      ],
    },
  ]);
  await browser.releaseActions();
  await settle(browser);
}

async function plainClick({ x, y }: { x: number; y: number }): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x, y })
    .down()
    .up()
    .perform();
  await settle(browser);
}

describe("links open in the browser on Ctrl+click", () => {
  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1280, 900);
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.changeSettings({ always_show_markdown: false });
    });
    await loadDoc(DOC);
    await handed();
  });

  beforeEach(async () => {
    await caretTo("The caret");
  });

  it("hands a rendered link to the browser, and moves nothing", async () => {
    const caret = await head();
    await ctrlClick(await pointAt("link with", 3));
    expect(await handed()).toEqual(["https://example.org/page"]);
    // The caret stayed where it was and the block didn't reveal.
    expect(await head()).toBe(caret);
    expect(await browser.execute(() => window.__bismillah?.view.state.doc.toString())).toBe(DOC);
  });

  it("puts the caret in the link on a plain click, and opens nothing", async () => {
    await plainClick(await pointAt("link with", 3));
    expect(await handed()).toEqual([]);
    expect(await head()).toBe(DOC.indexOf("link with") + 3);
  });

  it("opens email autolinks in the mail app and www. addresses over https", async () => {
    await ctrlClick(await pointAt("writer@example.org", 2));
    await ctrlClick(await pointAt("www.example.org/w", 4));
    expect(await handed()).toEqual(["mailto:writer@example.org", "https://www.example.org/w"]);
  });

  it("opens nothing but the web and email, and says so", async () => {
    await ctrlClick(await pointAt("script](", 2));
    expect(await handed()).toEqual([]);
    expect(await note()).toBe("Only web and email links open from bismillah.");
    await ctrlClick(await pointAt("file](", 2));
    expect(await handed()).toEqual([]);
  });

  it("opens a link in a table drawn as a grid, and in Arabic text", async () => {
    const cell = await browser.execute(() => {
      const box = document.querySelector(".cm-table .cm-md-link")?.getBoundingClientRect();
      return box
        ? { x: Math.round(box.left + 4), y: Math.round((box.top + box.bottom) / 2) }
        : null;
    });
    if (!cell) throw new Error("the table isn't drawn as a grid");
    await ctrlClick(cell);
    await ctrlClick(await pointAt("التفسير", 2));
    expect(await handed()).toEqual(["https://example.org/tafsir", "https://example.org/ar"]);
  });

  it("doesn't open on Ctrl+click beside a link, past the end of its line", async () => {
    const end = await pointAt("in a line.", 9);
    await ctrlClick({ x: end.x + 200, y: end.y });
    expect(await handed()).toEqual([]);
  });

  it("shows a hand while Ctrl is held over a link", async () => {
    const at = await pointAt("link with", 3);
    await browser.performActions([
      { type: "key", id: "keyboard", actions: [{ type: "keyDown", value: "\u{E009}" }] },
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [{ type: "pointerMove", duration: 0, x: at.x, y: at.y, origin: "viewport" }],
      },
    ]);
    const onLink = await browser.execute(
      () => document.querySelector(".cm-content.cm-on-link") !== null,
    );
    await browser.releaseActions();
    expect(onLink).toBe(true);
  });

  it("says in the address tooltip how to open a link", async () => {
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move(await pointAt("link with", 3))
      .perform();
    await browser.waitUntil(
      () => browser.execute(() => document.querySelector(".cm-address-hint") !== null),
      { timeout: 3000, timeoutMsg: "no hint in the tooltip" },
    );
    expect(
      await browser.execute(() => document.querySelector(".cm-address-hint")?.textContent),
    ).toBe("Ctrl+click to open");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: 5, y: 5 })
      .perform();
  });

  it("opens the link at the caret with Open link, from the keyboard", async () => {
    await caretTo("link with");
    await browser.execute(() => window.__bismillah?.run("edit.openLink"));
    await caretTo("The caret");
    await browser.execute(() => window.__bismillah?.run("edit.openLink"));
    await settle(browser);
    expect(await handed()).toEqual(["https://example.org/page"]);
    expect(await note()).toBe("There's no link at the caret.");
  });

  it("opens the address itself with Always show Markdown", async () => {
    await browser.execute(() => window.__bismillah?.changeSettings({ always_show_markdown: true }));
    await settle(browser);
    await ctrlClick(await pointAt("https://example.org/page", 10));
    await browser.execute(() =>
      window.__bismillah?.changeSettings({ always_show_markdown: false }),
    );
    expect(await handed()).toEqual(["https://example.org/page"]);
  });
});

describe("Settings shows bismillah's folders in the file manager", () => {
  const library = mkdtempSync(join(tmpdir(), "bismillah-folders-"));
  writeFileSync(join(library, "a.md"), "A\n");
  const uri = (dir: string) => `${pathToFileURL(dir).href}/`;

  before(async () => {
    await browser.execute(async (path: string) => {
      await window.__bismillah?.setLibrary(path);
      window.__bismillah?.openSettings("files");
    }, library);
    await handed();
  });

  after(async () => {
    await browser.keys(["Escape"]);
    rmSync(library, { recursive: true, force: true });
  });

  it("offers the library, the settings and the recovery folders", async () => {
    const buttons = await browser.$$("button*=Show in file manager");
    expect(buttons.length).toBe(3);
    for (const button of buttons) await button.click();
    const config = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah");
    const recovery = join(process.env.XDG_DATA_HOME ?? "", "bismillah", "recovery");
    expect(await handed()).toEqual([uri(library), uri(config), uri(recovery)]);
    // Each button is described by the setting it belongs to.
    const described = await browser.execute(() =>
      [...document.querySelectorAll(".settings-dialog button")]
        .filter((b) => b.textContent?.trim() === "Show in file manager")
        .map((b) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent),
    );
    expect(described).toEqual(["Library folder", "Your settings", "Unsaved text"]);
  });
});
