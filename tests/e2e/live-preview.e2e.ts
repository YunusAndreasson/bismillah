import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { setViewport, settle, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { head, lineOf, loadDoc, press } from "./spikes/helpers.ts";

/**
 * Live preview in the real app (ADR-0012, PLAN.md Phase 4): the folded frontmatter,
 * images below their line (local ones from the library only), addresses on hover,
 * Always show Markdown on Mod-R, the XSS fixture inert in the editor, and Copy as rich
 * text on the clipboard. The caret, selection and click checks on RTL and mixed lines
 * are in spikes/live-preview.e2e.ts (rendered) and spikes/bidi.e2e.ts (all shown).
 */

const fixture = (name: string) => readFileSync(resolve(REPO, "tests/fixtures", name), "utf8");

/** A scratch copy of tests/fixtures/preview, with an image outside it and a link out. */
function scratchLibrary(): { dir: string; library: string } {
  const dir = mkdtempSync(join(tmpdir(), "bismillah-preview-"));
  const library = join(dir, "library");
  cpSync(resolve(REPO, "tests/fixtures/preview"), library, { recursive: true });
  const outside = join(dir, "outside.png");
  writeFileSync(outside, readFileSync(join(library, "figures/arch.png")));
  symlinkSync(outside, join(library, "figures/link.png"));
  writeFileSync(
    join(library, "link.md"),
    "A link out of the library:\n\n![Linked](figures/link.png)\n",
  );
  return { dir, library };
}

async function drawnLine(pos: number): Promise<string> {
  return browser.execute((p: number) => {
    const view = window.__bismillah?.view;
    if (!view) return "";
    const { node } = view.domAtPos(p);
    return (
      (node instanceof Element ? node : node.parentElement)?.closest(".cm-line")?.textContent ?? ""
    );
  }, pos);
}

async function caretTo(needle: string, offset = 0): Promise<void> {
  await browser.execute(
    (n: string, o: number) => {
      window.__bismillah?.caretAt(n, o);
    },
    needle,
    offset,
  );
  await settle(browser);
}

async function images() {
  return browser.execute(() =>
    [...document.querySelectorAll(".cm-image")].map((figure) => {
      const img = figure.querySelector("img");
      return {
        src: img?.getAttribute("src") ?? null,
        loaded: img ? img.complete && img.naturalWidth > 0 : false,
        note: figure.querySelector(".cm-image-note")?.textContent ?? null,
      };
    }),
  );
}

/**
 * What could run or load inside the writing surface: elements that can, event
 * handlers, and images from anywhere but the checked image scheme or embedded data
 * (an image element never runs script, an embedded SVG's included). The Basmallah's
 * outlines are the one SVG of our own.
 */
async function activeContent() {
  return browser.execute(() => {
    const content = window.__bismillah?.view.contentDOM;
    if (!content) return null;
    const banned = content.querySelectorAll(
      "script, iframe, object, embed, form, base, meta, style, svg:not(.cm-basmallah-ink), math, details, a[href]",
    ).length;
    const handlers = [...content.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName} ${a.name}`),
    );
    // CodeMirror's caret helpers beside widgets are empty images of its own.
    const sources = [...content.querySelectorAll("img:not(.cm-widgetBuffer)")]
      .map((img) => img.getAttribute("src") ?? "")
      .filter((src) => !/^(?:bismillah-image:\/\/|data:image\/)/.test(src));
    return { banned, handlers, sources };
  });
}

describe("live preview", () => {
  const { dir, library } = scratchLibrary();

  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1280, 900);
    await browser.execute(async (path: string) => {
      const hooks = window.__bismillah;
      hooks?.setTypewriter(false);
      await hooks?.changeSettings({ always_show_markdown: false });
      await hooks?.setLibrary(path);
    }, library);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("opens a document with its frontmatter folded and the caret on its first line of text", async () => {
    await browser.execute(
      async (path: string) => {
        await window.__bismillah?.open(path);
      },
      join(library, "images.md"),
    );
    const heading = await lineOf("# Images in live preview");
    expect(await head()).toBe(heading.from);
    expect(
      await browser.execute(() => document.querySelector(".cm-frontmatter-fold")?.textContent),
    ).toBe("title: Images · lang: en");
    // The caret's block shows its Markdown.
    expect(await drawnLine(heading.from)).toBe("# Images in live preview");
  });

  it("unfolds the frontmatter when the caret goes into it, by keyboard or a click", async () => {
    await press("ArrowUp");
    await press("ArrowUp");
    expect(await head()).toBeLessThan(20);
    expect(await browser.execute(() => document.querySelector(".cm-frontmatter-fold"))).toBeNull();
    expect(await drawnLine(4)).toBe("title: Images");
    await caretTo("A local image");
    const fold = await browser.execute(() => {
      const rect = document.querySelector(".cm-frontmatter-fold")?.getBoundingClientRect();
      return rect ? { x: rect.left + 20, y: (rect.top + rect.bottom) / 2 } : null;
    });
    if (!fold) throw new Error("the frontmatter isn't folded");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(fold.x), y: Math.round(fold.y) })
      .down()
      .up()
      .perform();
    await settle(browser);
    // A block replacement can map a click to either source boundary. The closing
    // delimiter is a valid caret position too; both must reveal the metadata.
    const closing = fixture("preview/images.md").indexOf("\n---\n", 4) + 4;
    expect(await head()).toBeLessThanOrEqual(closing);
    expect(await browser.execute(() => document.querySelector(".cm-frontmatter-fold"))).toBeNull();
  });

  it("shows local images from the library below their line, and only those", async () => {
    await caretTo("Images in live preview");
    const shown = await images();
    expect(shown.length).toBe(4);
    const [local, web, outside, missing] = shown;
    expect(local?.loaded).toBe(true);
    expect(local?.src).toMatch(/^bismillah-image:\/\/localhost\//);
    expect(web).toEqual({
      src: null,
      loaded: false,
      note: expect.stringContaining("https://example.com/photo.jpg"),
    });
    expect(web?.note).toContain("never loaded");
    // Both exist as files; neither is in the library.
    expect(outside?.note).toContain("../outside.png");
    expect(missing?.note).toContain("figures/none.png");
    await browser.execute(
      async (path: string) => {
        await window.__bismillah?.open(path);
      },
      join(library, "link.md"),
    );
    await browser.waitUntil(async () => (await images())[0]?.note !== null, { timeout: 5000 });
    expect((await images())[0]?.note).toContain("figures/link.png");
  });

  it("shows a link's address on hover outside the caret's block, and moves nothing", async () => {
    await loadDoc("A [link with text](https://example.com/page) here.\n\nThe caret is here.");
    await caretTo("The caret");
    const target = await browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return null;
      const rect = view.coordsAtPos(view.state.doc.toString().indexOf("with"));
      return rect ? { x: rect.left + 4, y: (rect.top + rect.bottom) / 2 } : null;
    });
    if (!target) throw new Error("no link on screen");
    const before = await drawnLine(0);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(target.x), y: Math.round(target.y) })
      .perform();
    await browser.waitUntil(
      () =>
        browser.execute(
          () => document.querySelector(".cm-tooltip .cm-address")?.textContent ?? null,
        ),
      { timeout: 3000, timeoutMsg: "no address tooltip" },
    );
    expect(
      await browser.execute(
        () => document.querySelector(".cm-address")?.firstElementChild?.textContent,
      ),
    ).toBe("https://example.com/page");
    expect(await drawnLine(0)).toBe(before);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: 5, y: 5 })
      .perform();
  });

  it("shows every mark on Mod-R, exactly as Phase 1 draws them, and hides them again", async () => {
    const doc = fixture("live-preview.md");
    await loadDoc(`---\ntitle: T\n---\n\n${doc}\n![An arch](figures/arch.png)\n`);
    await caretTo("Plain closing");
    const rendered = () =>
      browser.execute(() => ({
        hidden: document.querySelectorAll(
          ".cm-content [class*='cm-md-'], .cm-content .cm-widgetBuffer",
        ).length,
        fold: document.querySelectorAll(".cm-frontmatter-fold, .cm-image").length,
      }));
    expect((await rendered()).hidden).toBeGreaterThan(10);
    await browser.keys(["Control", "r"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await rendered()).hidden === 0, { timeout: 5000 });
    await settle(browser);
    expect(await browser.execute(() => window.__bismillah?.commandLog.at(-1))).toEqual({
      id: "view.toggleMarkdown",
      source: "keymap",
    });
    expect(await rendered()).toEqual({ hidden: 0, fold: 0 });
    for (const needle of [
      "The word **أمانة**",
      "نستخدم **Markdown**",
      "> اقتباسٌ",
      "- **عنصرٌ**",
      "title: T",
    ]) {
      const line = await lineOf(needle);
      expect(await drawnLine(line.from)).toBe(
        await browser.execute(
          (p: number) => window.__bismillah?.view.state.doc.lineAt(p).text ?? "",
          line.from,
        ),
      );
    }
    await browser.keys(["Control", "r"]);
    await browser.keys(["Control"]);
    // The setting goes through Rust before it applies.
    await browser.waitUntil(async () => (await rendered()).hidden > 10, {
      timeout: 5000,
      timeoutMsg: "Mod-R didn't bring live preview back",
    });
  });

  it("keeps the XSS fixture inert in the editor, rendered and revealed", async () => {
    await loadDoc(fixture("xss.md"));
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      view?.focus();
      view?.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    });
    await settle(browser);
    // Every block reveals once as the caret passes through it.
    const lines = await browser.execute(() => window.__bismillah?.view.state.doc.lines ?? 0);
    for (let i = 0; i < lines; i++) {
      await press("ArrowDown");
      const found = await activeContent();
      expect(found).toEqual({ banned: 0, handlers: [], sources: [] });
    }
    // Hover and click the rendered links too.
    await caretTo("- [x]");
    for (const text of ["an anchor", "javascript link", "reference one"]) {
      await browser.execute((t: string) => {
        const view = window.__bismillah?.view;
        if (!view) return;
        const pos = view.state.doc.toString().indexOf(t);
        view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(pos).top - 200);
      }, text);
      await settle(browser);
      const at = await browser.execute((t: string) => {
        const view = window.__bismillah?.view;
        const rect = view?.coordsAtPos(view.state.doc.toString().indexOf(t) + 2);
        return rect ? { x: rect.left, y: (rect.top + rect.bottom) / 2 } : null;
      }, text);
      if (!at) continue;
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: Math.round(at.x), y: Math.round(at.y) })
        .pause(600)
        .down()
        .up()
        .perform();
      await settle(browser);
    }
    expect(await activeContent()).toEqual({ banned: 0, handlers: [], sources: [] });
    expect(
      await browser.execute(() => (window as unknown as { __xss?: string }).__xss ?? null),
    ).toBeNull();
    expect(await browser.execute(() => window.__cspViolations ?? [])).toEqual([]);
  });

  it("copies the selection, or the whole document, as rich text and plain text", async () => {
    await loadDoc(
      "---\ntitle: T\n---\n\nSome **strong** and a [link](https://e.com).\n\n- one\n- two\n",
    );
    const start = await browser.execute(
      () => window.__bismillah?.view.state.doc.toString().indexOf("**strong**") ?? 0,
    );
    await browser.execute(
      (a: number, b: number) => {
        const view = window.__bismillah?.view;
        view?.focus();
        view?.dispatch({ selection: { anchor: a, head: b } });
      },
      start,
      start + "**strong** and a [link](https://e.com)".length,
    );
    await browser.keys(["Control", "Shift", "c"]);
    await browser.keys(["Control", "Shift"]);
    await browser.waitUntil(
      () =>
        browser.execute(() => window.__bismillah?.note() === "Copied the selection as rich text."),
      { timeout: 5000, timeoutMsg: "no confirmation" },
    );
    const clip = () =>
      browser.execute(async () => ({
        html: await window.__bismillah?.clipboard("text/html"),
        text: await window.__bismillah?.clipboard("UTF8_STRING"),
      }));
    expect(await clip()).toEqual({
      html: '<meta charset="utf-8"><p><strong>strong</strong> and a <a href="https://e.com">link</a></p>\n',
      text: "strong and a link",
    });
    await caretTo("- one");
    await browser.execute(() => window.__bismillah?.run("edit.copyRich"));
    await browser.waitUntil(
      () => browser.execute(() => window.__bismillah?.note() === "Copied as rich text."),
      { timeout: 5000 },
    );
    const whole = await clip();
    expect(whole.text).toBe("Some strong and a link.\n\n• one\n• two");
    expect(whole.html).not.toContain("title");
  });

  it("copies the XSS fixture as inert rich text", async () => {
    await loadDoc(fixture("xss.md"));
    await caretTo("A footnote");
    await browser.execute(() => window.__bismillah?.run("edit.copyRich"));
    await browser.waitUntil(
      () => browser.execute(() => window.__bismillah?.note() === "Copied as rich text."),
      {
        timeout: 5000,
      },
    );
    const found = await browser.execute(async () => {
      const html = (await window.__bismillah?.clipboard("text/html")) ?? "";
      const doc = new DOMParser().parseFromString(html, "text/html");
      const banned = doc.querySelectorAll(
        "script, iframe, object, embed, form, base, style, svg, math, details, button",
      ).length;
      const risky = [...doc.querySelectorAll("*")].flatMap((el) =>
        [...el.attributes]
          .filter(
            (a) =>
              /^on/i.test(a.name) ||
              (/^(href|src)$/.test(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value)),
          )
          .map((a) => `${el.tagName} ${a.name}`),
      );
      return { length: html.length, banned, risky };
    });
    expect(found.length).toBeGreaterThan(1000);
    expect(found).toEqual({ length: found.length, banned: 0, risky: [] });
    expect(
      await browser.execute(() => (window as unknown as { __xss?: string }).__xss ?? null),
    ).toBeNull();
  });
});
