import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { settle, setViewport, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { act, Folder, notices, open } from "./files.ts";

/**
 * Files, Commands and Settings (DESIGN.md §6, §13, ADR-0016): three panels that rise
 * from the status line. Shift Shift opens the last one; Tab moves between them with the
 * query kept; ↑ ↓ and Enter act on the highlighted row, ← → change a setting; typing
 * capitals never opens one; Esc closes an opened row, then the panel.
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

  it("opens the last panel on Shift Shift, and closes on it again", async () => {
    await browser.keys(["Control", ","]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "settings");
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await panel()) === null);
    await browser.waitUntil(inText, { timeoutMsg: "focus never came back to the text" });
    await shiftShift();
    await browser.waitUntil(async () => (await panel())?.kind === "settings", {
      timeoutMsg: "Shift Shift didn't reopen the last panel",
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

  it("carries the query to the next panel with Tab, and counts what each finds", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    await browser.$(".panel-input").setValue("notes");
    await browser.waitUntil(async () => (await panel())?.counts !== null);
    const counts = (await panel())?.counts;
    expect(counts?.files).toBeGreaterThan(1);
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await panel())?.kind === "commands");
    expect((await panel())?.query).toBe("notes");
    expect(await activeIs(".panel-input")).toBe(true);
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await panel())?.kind === "settings");
    await browser.action("key").down(SHIFT).down(TAB).up(TAB).up(SHIFT).perform();
    await browser.waitUntil(async () => (await panel())?.kind === "commands");
    // Each panel starts on its first row.
    const p = await panel();
    expect(p?.selected).toBe(p?.rows[0]?.value ?? null);
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
    expect((await panel())?.keys).toBe("← → change · Enter open");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await panel())?.opened === "setting:size");
    await browser.waitUntil(async () => (await panel())?.focus === "opened");
    expect((await panel())?.keys).toBe("← → change · Backspace reset · Enter or Esc done");
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
    expect((await panel())?.keys).toBe("← → change · Enter or Esc done");
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

  it("switches panels with their shortcuts and closes on the open one's", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
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

  it("keeps the window's shortcuts from acting behind the panel", async () => {
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    await browser.keys("F1");
    await frames();
    expect((await panel())?.kind).toBe("files");
    expect(await browser.getTitle()).toMatch(/^Chapter 2/);
  });

  it("opens from the status line, with its tabs where the status line's items are", async () => {
    await browser.$("//footer//button[normalize-space()='Commands']").click();
    await browser.waitUntil(async () => (await panel())?.kind === "commands");
    const offsets = await browser.execute(() => {
      const a = [...document.querySelectorAll(".status .panel-toggle")];
      const b = [...document.querySelectorAll(".panel-tab")];
      return a.map((el, i) => {
        const x = el.getBoundingClientRect();
        const y = b[i]?.getBoundingClientRect();
        return y ? Math.abs(x.left - y.left) + Math.abs(x.bottom - y.bottom) : 99;
      });
    });
    for (const offset of offsets) expect(offset).toBeLessThan(1.5);
    await browser.$("//*[@role='tab'][normalize-space()='Files']").click();
    await browser.waitUntil(async () => (await panel())?.kind === "files");
    expect(await activeIs(".panel-input")).toBe(true);
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
