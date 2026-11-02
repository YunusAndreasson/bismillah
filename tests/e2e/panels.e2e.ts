import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { settle, setViewport, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { act, Folder, notices, open } from "./files.ts";

/**
 * Search (DESIGN.md §6, §13, ADR-0018): one palette for files, commands and settings,
 * opened by Ctrl+K and Shift Shift, or narrowed by Ctrl+P, Ctrl+Shift+P and Ctrl+,.
 * Tab narrows with the query kept; ↑ ↓ and Enter act on the highlighted row, ← → change
 * a setting in Settings; typing capitals never opens it; Esc closes an opened row, then
 * Search.
 */

const FIXTURE = resolve(REPO, "tests/fixtures/library");
const shots = "/tmp/bismillah-panels";

const panel = () => browser.execute(() => window.__bismillah?.panel() ?? null);

async function frames(): Promise<void> {
  await browser.execute(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** WebDriver's Shift and Tab keys. */
const SHIFT = "\uE008";
const TAB = "\uE004";

/** Two clean taps of Shift, as a writer's fingers make them. */
async function shiftShift(): Promise<void> {
  await browser
    .action("key")
    .down(SHIFT)
    .pause(40)
    .up(SHIFT)
    .pause(80)
    .down(SHIFT)
    .pause(40)
    .up(SHIFT)
    .perform();
  await frames();
}

const activeIs = (selector: string) =>
  browser.execute((s: string) => document.activeElement?.matches(s) ?? false, selector);

const inText = () =>
  browser.execute(() => document.activeElement === window.__bismillah?.view.contentDOM);

const selected = async () => (await panel())?.selected ?? "";

async function search(text: string, first: string): Promise<void> {
  await browser.$(".panel-input").setValue(text);
  await browser.waitUntil(async () => (await selected()) === first, {
    timeoutMsg: `"${text}" didn't highlight ${first} (${await selected()})`,
  });
}

describe("The panels", () => {
  let folder: Folder;
  let root: string;

  before(async () => {
    await waitForApp(browser);
    mkdirSync(shots, { recursive: true });
  });

  beforeEach(async () => {
    await setViewport(browser, 1280, 860);
    folder = new Folder();
    root = join(folder.path, "Writing");
    cpSync(FIXTURE, root, { recursive: true });
    await browser.execute(async (dir: string) => {
      await window.__bismillah?.setLibrary(dir);
      await window.__bismillah?.changeSettings({ smart_punctuation: true, measure: "standard" });
    }, root);
    await open(join(root, "Chapter 2.md"));
    await browser.execute(() => window.__bismillah?.view.focus());
  });

  afterEach(async () => {
    for (let i = 0; i < 3 && (await panel()) !== null; i++) await browser.keys(["Escape"]);
    await browser.execute(async () => {
      await window.__bismillah?.flush();
      await window.__bismillah?.changeSettings({ smart_punctuation: true, measure: "standard" });
    });
    folder.remove();
  });

  it("opens Search over everything on Ctrl+K and on Shift Shift, and closes on them", async () => {
    await browser.keys(["Control", "k"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    expect((await panel())?.chip).toBe(null);
    await browser.keys(["Control", "k"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel()) === null);
    await browser.waitUntil(inText, { timeoutMsg: "focus never came back to the text" });
    await shiftShift();
    await browser.waitUntil(async () => (await panel())?.kind === "all", {
      timeoutMsg: "Shift Shift didn't open Search",
    });
    expect(await activeIs(".panel-input")).toBe(true);
    await shiftShift();
    await browser.waitUntil(async () => (await panel()) === null);
    await browser.waitUntil(inText, { timeoutMsg: "focus never came back to the text" });
  });

  it("never opens while typing capitals", async () => {
    await browser.keys(["Shift", "A", "Shift"]);
    await browser.keys(["Shift", "B", "Shift"]);
    await frames();
    await browser.pause(450);
    expect(await panel()).toBe(null);
  });

  it("finds a file by its folder and opens it with the caret in it", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    await browser.saveScreenshot(`${shots}/files-1280.png`);
    await search("2026 hasan", "file:Essays/2026/Letter to Ḥasan.md");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await browser.getTitle()).startsWith("Letter to Ḥasan"));
    await browser.waitUntil(inText, { timeoutMsg: "the caret never reached the opened file" });
  });

  it("narrows with Tab, keeping the query and the highlighted row", async () => {
    await browser.keys(["Control", "k"]);
    await browser.keys(["Control"]);
    await search("notes", "file:Notes/notes.md");
    await browser.keys("ArrowDown");
    const second = (await panel())?.rows[1]?.value;
    await browser.waitUntil(async () => (await selected()) === second);
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    // The same row, still highlighted; the scope shows in the field.
    expect(await selected()).toBe(second);
    expect((await panel())?.chip).toBe("Files");
    expect((await panel())?.query).toBe("notes");
    expect(await activeIs(".panel-input")).toBe(true);
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await panel())?.kind === "commands");
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await panel())?.kind === "settings");
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    await browser.action("key").down(SHIFT).down(TAB).up(TAB).up(SHIFT).perform();
    await browser.waitUntil(async () => (await panel())?.kind === "settings");
    expect((await panel())?.query).toBe("notes");
  });

  it("widens to everything from its scope's ×, or Backspace in an empty field", async () => {
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.chip === "Settings");
    await browser.keys("Backspace");
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    await browser.$(".panel-scope").click();
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    expect(await activeIs(".panel-input")).toBe(true);
  });

  it("lists files, commands and settings together, a few of each, at one height", async () => {
    await browser.keys(["Control", "k"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    const height = () =>
      browser.execute(() => document.querySelector(".panel")?.getBoundingClientRect().height);
    const empty = await height();
    await search("spelling", "command:check.toggleSpelling");
    expect((await panel())?.groups).toEqual(["Commands", "Settings"]);
    expect(await height()).toBe(empty);
    await search("zzzz", "");
    expect(await height()).toBe(empty);
    await browser.saveScreenshot(`${shots}/search-1280.png`);
  });

  it("acts on a file in everything, and keeps ← → for the caret there", async () => {
    await browser.keys(["Control", "k"]);
    await browser.keys(["Control"]);
    await search("line length", "setting:measure");
    await browser.keys("ArrowRight");
    await frames();
    expect((await panel())?.rows[0]?.text).toMatch(/Standard/);
    await search("chapter 10", "file:Chapter 10.md");
    expect((await panel())?.description).toBe("");
    await browser.keys("F2");
    await browser.waitUntil(async () =>
      Boolean(await browser.execute(() => window.__bismillah?.prompt()?.ready)),
    );
    await browser.keys("Escape");
    await browser.waitUntil(() => activeIs(".panel-input"));
    expect((await panel())?.kind).toBe("all");
  });

  it("runs a command opened from the status line in the text", async () => {
    await browser.$("//footer//button[@aria-label='Search']").click();
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    await search("go to line", "command:edit.goToLine");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel()) === null);
    await browser.waitUntil(
      () => browser.execute(() => document.activeElement?.closest(".cm-goto-line") !== null),
      { timeoutMsg: "Go to line… never took focus" },
    );
    await browser.keys("Escape");
  });

  it("moves round the list with the arrows and narrows to a folder with Enter", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await search("essays", "folder:Essays");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel())?.query === "Essays/");
    const rows = ((await panel())?.rows ?? []).map((r) => r.value);
    expect(rows[0]).toBe("folder:Essays");
    expect(rows).toContain("file:Essays/notes.md");
    expect(rows).not.toContain("file:Notes/notes.md");
    await browser.keys("ArrowUp");
    await browser.waitUntil(async () => (await selected()) === rows.at(-1));
    await browser.keys("ArrowDown");
    await browser.waitUntil(async () => (await selected()) === rows[0]);
  });

  it("renames the highlighted file with the panel open behind the prompt", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await search("chapter 10", "file:Chapter 10.md");
    await browser.keys("F2");
    await browser.waitUntil(async () =>
      Boolean(await browser.execute(() => window.__bismillah?.prompt()?.ready)),
    );
    // Shift Shift doesn't close the panel behind the prompt.
    await shiftShift();
    expect((await panel())?.kind).toBe("files");
    await browser.keys(["Control", "a"]);
    await browser.keys(["Control"]);
    // One word without doubled letters: the driver drops the second of two.
    await browser.keys("Chapter Nine");
    await browser.keys("Enter");
    await browser.waitUntil(() => existsSync(join(root, "Chapter Nine.md")), {
      timeoutMsg: "never renamed",
    });
    await browser.waitUntil(() => activeIs(".panel-input"), {
      timeoutMsg: "focus never came back to the panel",
    });
    await browser.waitUntil(async () => (await selected()) === "file:Chapter Nine.md", {
      timeoutMsg: "the renamed row isn't highlighted",
    });
  });

  it("moves the highlighted file to the trash, then closes so Undo can be reached", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await search("quran", "file:Qurʾān citations.markdown");
    const file = join(root, "Qurʾān citations.markdown");
    // With text after the caret, Delete deletes text.
    await browser.keys("Home");
    await browser.keys("Delete");
    await browser.waitUntil(async () => (await panel())?.query === "uran");
    expect(existsSync(file)).toBe(true);
    await browser.keys("End");
    await browser.waitUntil(async () => (await selected()) === "file:Qurʾān citations.markdown");
    await browser.keys("Delete");
    await browser.waitUntil(async () => (await panel()) === null);
    await browser.waitUntil(() => !existsSync(file), { timeoutMsg: "never trashed" });
    await browser.waitUntil(async () => (await notices()).some((n) => n.actions.includes("Undo")));
    await act("Undo");
    await browser.waitUntil(() => existsSync(file), { timeoutMsg: "Undo never put it back" });
  });

  it("changes a switch in place and keeps the panel open", async () => {
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await search("smart punctuation", "setting:smart");
    expect((await panel())?.rows[0]?.text).toMatch(/Smart punctuation\s*On/);
    await browser.keys("Enter");
    await browser.waitUntil(async () => /Off/.test((await panel())?.rows[0]?.text ?? ""));
    expect(await activeIs(".panel-input")).toBe(true);
    expect(await browser.execute(() => window.__bismillah?.status())).toBeTruthy();
  });

  it("changes a choice with the arrows, opens it with Enter, and closes it with Esc", async () => {
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await search("line length", "setting:measure");
    await browser.keys("ArrowRight");
    await browser.waitUntil(async () => /Wide/.test((await panel())?.rows[0]?.text ?? ""));
    await browser.keys("ArrowLeft");
    await browser.waitUntil(async () => /Standard/.test((await panel())?.rows[0]?.text ?? ""));
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel())?.opened === "setting:measure");
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.activeElement?.closest("[aria-labelledby='panel-label-measure']") !== null &&
            document.activeElement?.getAttribute("aria-checked") === "true",
        ),
      { timeoutMsg: "focus never reached Line length's chosen option" },
    );
    await browser.saveScreenshot(`${shots}/settings-opened-1280.png`);
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel())?.opened === null);
    expect((await panel())?.kind).toBe("settings");
    expect(await activeIs(".panel-input")).toBe(true);
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel()) === null);
  });

  it("steps an opened size, resets it with Backspace and closes it with Enter", async () => {
    await browser.execute(() => window.__bismillah?.changeSettings({ text_scale: 1 }));
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await search("text size", "setting:size");
    expect((await panel())?.keys).toBe("← → change Enter open");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel())?.opened === "setting:size");
    await browser.waitUntil(async () => (await panel())?.focus === "opened");
    expect((await panel())?.keys).toBe("← → change Backspace reset Enter or Esc done");
    // The stepper shows the size; the row's end doesn't repeat it.
    expect(
      await browser.execute(() => {
        const value = document.querySelector(".panel-row.open .value");
        return value ? getComputedStyle(value).visibility : null;
      }),
    ).toBe("hidden");
    await browser.keys("ArrowRight");
    await browser.waitUntil(async () => /110%/.test((await panel())?.rows[0]?.text ?? ""));
    await browser.keys("Backspace");
    await browser.waitUntil(async () => /100%/.test((await panel())?.rows[0]?.text ?? ""));
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel())?.opened === null, {
      timeoutMsg: "Enter never closed the size",
    });
    expect(await activeIs(".panel-input")).toBe(true);
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel()) === null);
  });

  it("says what an opened choice's keys do, and opens only rows that hold something", async () => {
    await browser.execute(() => window.__bismillah?.openSettings({ row: "measure", open: true }));
    await browser.waitUntil(async () => (await panel())?.opened === "setting:measure");
    expect((await panel())?.keys).toBe("← → change Enter or Esc done");
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel())?.opened === null);
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel()) === null);
    // A sentence to read has nothing to open: it is highlighted, not opened.
    await browser.execute(() => window.__bismillah?.openSettings({ row: "recovery", open: true }));
    await browser.waitUntil(async () => (await panel())?.selected === "setting:recovery");
    expect((await panel())?.opened).toBe(null);
    expect((await panel())?.keys).toBe("");
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel()) === null);
  });

  it("shows a file's full name on hover only when it is cut short", async () => {
    const long = `${"A long letter about patience ".repeat(5).trim()}.md`;
    writeFileSync(join(root, long), "Text\n");
    await browser.execute(() => window.__bismillah?.openPanel("files", "letter"));
    const name = (value: string) => browser.$(`.panel-row[data-value="${value}"] .primary`);
    await name(`file:${long}`).waitForExist({ timeoutMsg: "the long file was never listed" });
    const hovered = async (value: string) => {
      await name(value).moveTo();
      // WebKitWebDriver reads a missing attribute as "".
      return browser.execute(
        (v: string) =>
          document.querySelector(`.panel-row[data-value="${v}"] .primary`)?.getAttribute("title") ??
          null,
        value,
      );
    };
    expect(await hovered("file:Essays/2026/Letter to Ḥasan.md")).toBe(null);
    expect(await hovered(`file:${long}`)).toBe(long);
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel()) === null);
  });

  it("narrows with each scope's shortcut and closes on the open one's", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    await browser.keys(["Control", "k"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    await browser.keys(["Control", "Shift", "P"]);
    await browser.keys(["Control", "Shift"]);
    await browser.waitUntil(async () => (await panel())?.kind === "commands");
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "settings");
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel()) === null);
  });

  it("keeps the window's shortcuts from acting behind Search", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    await browser.keys("F1");
    await frames();
    expect((await panel())?.kind).toBe("files");
    expect(await browser.getTitle()).toMatch(/^Chapter 2/);
  });

  it("opens from the status line's Search, named as its shortcut says", async () => {
    const button = browser.$("//footer//button[@aria-label='Search']");
    expect(await button.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    await button.click();
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    expect(await activeIs(".panel-input")).toBe(true);
  });

  it("keeps a row's height and the palette's as the highlight reaches a description", async () => {
    await browser.execute(async () => window.__bismillah?.openPanel("all", "spelling"));
    await browser.waitUntil(async () => (await panel())?.description !== "");
    const heights = () =>
      browser.execute(() => ({
        row: document.querySelector(".panel-row:not(.current)")?.getBoundingClientRect().height,
        current: document.querySelector(".panel-row.current")?.getBoundingClientRect().height,
        panel: document.querySelector(".panel")?.getBoundingClientRect().height,
      }));
    const before = await heights();
    expect(before.current).toBe(before.row);
    await browser.keys("ArrowDown");
    await frames();
    expect(await heights()).toEqual(before);
    // Described to screen readers, but not part of the row's name.
    const linked = await browser.execute(() => {
      const row = document.querySelector(".panel-row.current");
      const about = document.getElementById(row?.getAttribute("aria-describedby") ?? "");
      return about ? about.getAttribute("aria-hidden") : null;
    });
    expect(linked).toBe("true");
  });

  it("marks what matched, without splitting the name", async () => {
    await browser.execute(async () => window.__bismillah?.openPanel("files", "سلام"));
    await frames();
    const marks = await browser.execute(() =>
      [...(CSS.highlights.get("panel-match") ?? [])].map((r) => ({
        text: (r as Range).toString(),
        whole: r.startContainer === r.endContainer,
      })),
    );
    expect(marks).toEqual([{ text: "سلام", whole: true }]);
    await browser.execute(async () => window.__bismillah?.openPanel("all"));
    await frames();
    const left = await browser.execute(() => CSS.highlights.get("panel-match")?.size ?? 0);
    expect(left).toBe(0);
  });

  it("offers everything when a narrowed search finds nothing, with the query kept", async () => {
    await browser.execute(async () => window.__bismillah?.openPanel("files", "zzzz"));
    await browser.waitUntil(async () => (await selected()) === "action:everything");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel())?.kind === "all");
    expect((await panel())?.query).toBe("zzzz");
    expect(await activeIs(".panel-input")).toBe(true);
    expect((await panel())?.rows).toEqual([]);
  });

  it("shows all of an opened setting, clear of the footer", async () => {
    await browser.execute(async () => {
      window.__bismillah?.openSettings({ row: "measure", open: true });
      await window.__bismillah?.settle();
    });
    await browser.$(".panel-opened").waitForDisplayed();
    await frames();
    const clear = await browser.execute(() => {
      const list = document.querySelector(".panel-list")?.getBoundingClientRect();
      const box = document.querySelector(".panel-opened")?.getBoundingClientRect();
      return list !== undefined && box !== undefined && box.bottom <= list.bottom;
    });
    expect(clear).toBe(true);
  });

  it("brings a group's heading into view with its first row", async () => {
    await browser.execute(async () => window.__bismillah?.openPanel("commands"));
    await browser.waitUntil(async () => ((await panel())?.rows.length ?? 0) > 10);
    await browser.keys("ArrowUp");
    await frames();
    await browser.keys("ArrowDown");
    await frames();
    const seen = await browser.execute(() => {
      const list = document.querySelector(".panel-list")?.getBoundingClientRect();
      const heading = document.querySelector(".panel-group")?.getBoundingClientRect();
      return list !== undefined && heading !== undefined && heading.top >= list.top;
    });
    expect(seen).toBe(true);
  });

  it("fits a 480 by 360 window", async () => {
    await setViewport(browser, 480, 360);
    await shiftShift();
    await browser.$(".panel").waitForDisplayed();
    await settle(browser);
    const fits = await browser.execute(() => {
      const box = document.querySelector(".panel")?.getBoundingClientRect();
      const page = document.scrollingElement;
      return (
        box !== undefined &&
        box.left >= 0 &&
        box.right <= window.innerWidth &&
        box.top >= 0 &&
        box.bottom <= window.innerHeight &&
        (page?.scrollWidth ?? 0) <= window.innerWidth
      );
    });
    expect(fits).toBe(true);
    await browser.saveScreenshot(`${shots}/panel-480.png`);
  });
});
