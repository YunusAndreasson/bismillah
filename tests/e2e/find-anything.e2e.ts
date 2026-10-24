import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { settle, setViewport, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { act, Folder, notices, open } from "./files.ts";

/**
 * Find anything (DESIGN.md §6, §13): Shift Shift opens one panel with the library tree,
 * recent files, the main commands and settings; typing capitals never opens it; files
 * open with the caret in them; switches change in place; other settings open Settings
 * at their control; narrow windows drop the tree.
 */

const FIXTURE = resolve(REPO, "tests/fixtures/library");
const shots = "/tmp/bismillah-find-anything";

const picker = () => browser.execute(() => window.__bismillah?.picker() ?? null);

async function frames(): Promise<void> {
  await browser.execute(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Two clean taps of Shift, as a writer's fingers make them. */
async function shiftShift(): Promise<void> {
  await browser
    .action("key")
    .down("")
    .pause(40)
    .up("")
    .pause(80)
    .down("")
    .pause(40)
    .up("")
    .perform();
  await frames();
}

const activeIs = (selector: string) =>
  browser.execute((s: string) => document.activeElement?.matches(s) ?? false, selector);

const inText = () =>
  browser.execute(() => document.activeElement === window.__bismillah?.view.contentDOM);

describe("Find anything", () => {
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
      await window.__bismillah?.changeSettings({ smart_punctuation: true });
      await window.__bismillah?.measure();
    }, root);
    await open(join(root, "Chapter 2.md"));
    await browser.execute(() => window.__bismillah?.view.focus());
  });

  afterEach(async () => {
    if ((await picker()) !== null) await browser.keys(["Escape"]);
    if (await browser.$(".settings-dialog").isExisting()) await browser.keys(["Escape"]);
    await browser.execute(async () => {
      await window.__bismillah?.flush();
      await window.__bismillah?.changeSettings({ smart_punctuation: true });
    });
    folder.remove();
  });

  it("opens on Shift Shift from the text, and closes on it again", async () => {
    await shiftShift();
    await browser.waitUntil(async () => (await picker())?.kind === "everything", {
      timeoutMsg: "Shift Shift never opened Find anything",
    });
    expect(await activeIs(".picker-input")).toBe(true);
    const items = (await picker())?.items ?? [];
    expect(items.some((i) => i.startsWith("Zuhd mode"))).toBe(true);
    expect(items.some((i) => i.startsWith("Smart punctuation · On"))).toBe(true);
    // The library tree is beside the list, with the open file selected.
    expect(await browser.$(".picker-library [role='tree']").isDisplayed()).toBe(true);
    await browser.saveScreenshot(`${shots}/everything-1280.png`);
    await shiftShift();
    await browser.waitUntil(async () => (await picker()) === null);
    await browser.waitUntil(inText, { timeoutMsg: "focus never came back to the text" });
  });

  it("never opens while typing capitals", async () => {
    await browser.keys(["Shift", "A", "Shift"]);
    await browser.keys(["Shift", "B", "Shift"]);
    await frames();
    await browser.pause(450);
    expect(await picker()).toBe(null);
  });

  it("finds a file by its folder and opens it with the caret in it", async () => {
    await shiftShift();
    await browser.$(".picker-input").setValue("hasan");
    await browser.waitUntil(async () =>
      ((await picker())?.items[0] ?? "").includes("Letter to Ḥasan"),
    );
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await browser.getTitle()).startsWith("Letter to Ḥasan"));
    await browser.waitUntil(inText, { timeoutMsg: "the caret never reached the opened file" });
  });

  it("opens a file from its library tree", async () => {
    await shiftShift();
    await browser.$(".picker-input").waitForDisplayed();
    // One Tab from the search field, as the hint says.
    await browser.keys("Tab");
    await browser.waitUntil(() => activeIs(".picker-library [role='treeitem']"), {
      timeoutMsg: "Tab never reached the library tree",
    });
    // The tree's keys stay in the tree: the list's highlight doesn't move with them, and
    // Enter opens the row, not the highlighted item too.
    const before = (await picker())?.selected;
    await browser.keys("ArrowDown");
    await browser.keys("Home");
    await browser.keys("End");
    await frames();
    expect((await picker())?.selected).toBe(before);
    const path = await browser.execute(() => window.__bismillah?.library().focusedRow ?? null);
    expect(path).toBe("Qurʾān citations.markdown");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await picker()) === null);
    await browser.waitUntil(inText, { timeoutMsg: "the caret never reached the opened file" });
    expect(await browser.execute(() => window.__bismillah?.library().active ?? null)).toBe(path);
    // Nothing else ran: Smart punctuation is still on.
    await shiftShift();
    await browser.$(".picker-input").setValue("smart punctuation");
    await browser.waitUntil(async () =>
      ((await picker())?.selected ?? "").startsWith("Smart punctuation · On"),
    );
  });

  it("keeps the window's shortcuts from acting behind the panel's tree", async () => {
    await shiftShift();
    await browser.keys("Tab");
    await browser.waitUntil(() => activeIs(".picker-library [role='treeitem']"));
    await browser.keys("F1");
    await browser.keys(["Control", "\\"]);
    await browser.keys(["Control"]);
    await frames();
    expect((await picker())?.kind).toBe("everything");
    expect(await browser.getTitle()).toMatch(/^Chapter 2/);
    expect(await activeIs(".picker-library [role='treeitem']")).toBe(true);
  });

  it("returns focus to the panel's tree after Rename…, and isn't closed by Shift Shift in it", async () => {
    await shiftShift();
    await browser.keys("Tab");
    await browser.waitUntil(() => activeIs(".picker-library [role='treeitem']"));
    await browser.keys("End");
    await browser.keys("F2");
    await browser.waitUntil(async () =>
      Boolean(await browser.execute(() => window.__bismillah?.prompt()?.ready)),
    );
    await shiftShift();
    expect((await picker())?.kind).toBe("everything");
    expect(await browser.execute(() => window.__bismillah?.prompt() !== null)).toBe(true);
    await browser.keys("Escape");
    await browser.waitUntil(() => activeIs(".picker-library [role='treeitem']"), {
      timeoutMsg: "focus never came back to the panel's tree",
    });
    expect((await picker())?.kind).toBe("everything");
  });

  it("moves a row to the trash from the panel's tree, then closes it so Undo can be reached", async () => {
    await shiftShift();
    await browser.keys("Tab");
    await browser.waitUntil(() => activeIs(".picker-library [role='treeitem']"));
    await browser.keys("End");
    const file = join(root, "Qurʾān citations.markdown");
    await browser.keys("Delete");
    await browser.waitUntil(async () => (await picker()) === null);
    await browser.waitUntil(() => !existsSync(file), { timeoutMsg: "never trashed" });
    await browser.waitUntil(async () => (await notices()).some((n) => n.actions.includes("Undo")));
    await act("Undo");
    await browser.waitUntil(() => existsSync(file), { timeoutMsg: "Undo never put it back" });
  });

  it("changes a switch in place and keeps the panel open", async () => {
    await shiftShift();
    await browser.$(".picker-input").setValue("smart punctuation");
    await browser.waitUntil(async () =>
      ((await picker())?.selected ?? "").startsWith("Smart punctuation · On"),
    );
    await browser.keys("Enter");
    await browser.waitUntil(async () =>
      ((await picker())?.selected ?? "").startsWith("Smart punctuation · Off"),
    );
    expect(await activeIs(".picker-input")).toBe(true);
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await picker()) === null);
    // Saved: opening it again reads the stored value.
    await shiftShift();
    await browser.$(".picker-input").setValue("smart punctuation");
    await browser.waitUntil(async () =>
      ((await picker())?.selected ?? "").startsWith("Smart punctuation · Off"),
    );
  });

  it("opens Settings at a choice's control", async () => {
    await shiftShift();
    await browser.$(".picker-input").setValue("line length");
    await browser.waitUntil(async () =>
      ((await picker())?.selected ?? "").startsWith("Line length · Standard"),
    );
    await browser.keys("Enter");
    await browser.$(".settings-dialog").waitForDisplayed();
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.activeElement?.closest("[aria-labelledby='set-measure']") !== null &&
            document.activeElement?.getAttribute("aria-checked") === "true",
        ),
      { timeoutMsg: "focus never reached Line length's chosen option" },
    );
    await browser.keys("Escape");
    await browser.$(".settings-dialog").waitForDisplayed({ reverse: true });
  });

  it("keeps the first item highlighted when the scope changes", async () => {
    await shiftShift();
    await browser.$(".picker-input").setValue("chapter");
    await browser.waitUntil(async () =>
      ((await picker())?.selected ?? "").startsWith("Chapter 2.md"),
    );
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await picker())?.kind === "quickOpen");
    expect((await picker())?.selected ?? "").toMatch(/^Chapter 2\.md/);
    await browser.$(".picker-input").setValue("sa");
    await browser.keys(["Control", "Shift", "P"]);
    await browser.keys(["Control", "Shift"]);
    await browser.waitUntil(async () => (await picker())?.kind === "palette");
    await browser.waitUntil(async () => (await picker())?.selected != null, {
      timeoutMsg: "nothing was highlighted after switching to commands",
    });
    expect((await picker())?.selected).toBe((await picker())?.items[0]);
  });

  it("brings focus back to the field when the scope changes from the tree", async () => {
    await shiftShift();
    await browser.keys("Tab");
    await browser.waitUntil(() => activeIs(".picker-library [role='treeitem']"));
    await browser.keys(["Control", "Shift", "P"]);
    await browser.keys(["Control", "Shift"]);
    await browser.waitUntil(async () => (await picker())?.kind === "palette");
    await browser.waitUntil(() => activeIs(".picker-input"), {
      timeoutMsg: "focus didn't return to the search field",
    });
    // Shift Shift goes back to Everything before it closes the panel.
    await shiftShift();
    await browser.waitUntil(async () => (await picker())?.kind === "everything");
  });

  it("keeps the tree in a window just over 760px wide", async () => {
    await setViewport(browser, 780, 700);
    await shiftShift();
    await browser.$(".picker").waitForDisplayed();
    expect(await browser.$(".picker-library").isDisplayed()).toBe(true);
  });

  it("narrows to files on Ctrl+P and to commands on Ctrl+Shift+P", async () => {
    await shiftShift();
    await browser.$(".picker-input").waitForDisplayed();
    await browser.keys(["Control", "p"]);
    await browser.keys(["Control"]);
    await browser.waitUntil(async () => (await picker())?.kind === "quickOpen");
    await browser.keys(["Control", "Shift", "P"]);
    await browser.keys(["Control", "Shift"]);
    await browser.waitUntil(async () => (await picker())?.kind === "palette");
    expect(await browser.$(".picker-library").isExisting()).toBe(false);
    expect(await browser.$(".picker-scope[aria-pressed='true']").getText()).toBe("Commands");
  });

  it("drops the tree in a narrow window and stays inside it", async () => {
    await setViewport(browser, 480, 360);
    await browser.execute(async () => window.__bismillah?.measure());
    await shiftShift();
    await browser.$(".picker").waitForDisplayed();
    await settle(browser);
    expect(await browser.$(".picker-library").isExisting()).toBe(false);
    const fits = await browser.execute(() => {
      const box = document.querySelector(".picker")?.getBoundingClientRect();
      const page = document.scrollingElement;
      return (
        box !== undefined &&
        box.left >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight &&
        (page?.scrollWidth ?? 0) <= window.innerWidth
      );
    });
    expect(fits).toBe(true);
    await browser.saveScreenshot(`${shots}/everything-480.png`);
  });
});
