import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { docText, Folder, open, statusText } from "./files.ts";

/**
 * Spelling and grammar in the real app (ADR-0004, DESIGN.md §11, §14): marks in both
 * scripts, never on Qur'anic text, transliteration, code or URLs; the suggestions menu
 * from F7, Shift-F7, Mod-. and a right-click, all by keyboard; Replace (undoable),
 * Ignore and Add to dictionary; the personal dictionary on disk; the switches and the
 * dialect in Settings.
 */

const DOC = [
  "# Checking",
  "",
  "I will recieve the letter tomorow.",
  "",
  "This is a apple, and Ibn Taymiyya’s student wrote it.",
  "",
  "هذا كتابب جميل.",
  "",
  "ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ",
  "",
  "al-Fātiḥa and ḥadīth, `recieve` in code, https://example.com/recieve and the colour grey.",
  "",
].join("\n");

const EXPECTED = [
  "spelling:recieve",
  "spelling:tomorow",
  "grammar:a",
  "spelling:Ibn",
  "spelling:Taymiyya",
  "spelling:كتابب",
];

type Probe = { text: string; kind: string; lang: string; drawn: boolean };

async function settled(): Promise<void> {
  const ok = await browser.execute(async () => (await window.__bismillah?.lintSettled()) ?? false);
  expect(ok).toBe(true);
}

async function marks(): Promise<string[]> {
  await settled();
  const found: Probe[] = await browser.execute(() => window.__bismillah?.diagnostics() ?? []);
  return found.map((d) => `${d.kind}:${d.text}`);
}

async function menu() {
  return browser.execute(() => window.__bismillah?.suggestions() ?? null);
}

async function waitForMenu() {
  let last: unknown = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await browser.execute(() => ({
          menu: window.__bismillah?.suggestions() ?? null,
          active: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
        }));
        return (await menu())?.focused != null;
      },
      { timeout: 5000 },
    );
  } catch {
    throw new Error(
      `the suggestions menu never opened with focus on an action: ${JSON.stringify(last)}`,
    );
  }
  return menu();
}

async function waitForNoMenu(): Promise<void> {
  await browser.waitUntil(async () => (await menu()) === null, {
    timeout: 5000,
    timeoutMsg: "the suggestions menu never closed",
  });
}

async function frames(): Promise<void> {
  await browser.execute(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** Presses a key or a chord, then releases held modifiers. */
async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  const modifiers = keys.filter((k) => ["Control", "Shift", "Alt"].includes(k));
  if (modifiers.length) await browser.keys(modifiers);
  await frames();
}

async function caretAt(text: string, offset = 0): Promise<void> {
  await browser.execute((t: string, o: number) => window.__bismillah?.caretAt(t, o), text, offset);
}

async function editorHasFocus(): Promise<boolean> {
  return browser.execute(() => document.activeElement?.closest(".cm-content") != null);
}

async function selected(): Promise<string> {
  return browser.execute(() => {
    const view = window.__bismillah?.view;
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });
}

const dictionary = () => join(process.env.XDG_CONFIG_HOME ?? "", "bismillah", "dictionary.txt");

describe("spelling and grammar", () => {
  const folder = new Folder();
  let path = "";

  before(async () => {
    await waitForApp(browser);
    rmSync(dictionary(), { force: true });
    path = folder.file("checking.md", DOC);
    await open(path);
  });

  after(async () => {
    rmSync(dictionary(), { force: true });
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({
        check_spelling: true,
        check_grammar: true,
        english_dialect: "british",
      });
    });
    folder.remove();
  });

  it("marks both scripts, but never Qur'anic text, transliteration, code or URLs", async () => {
    expect(await marks()).toEqual(EXPECTED);
    const drawn = await browser.execute(() =>
      [...document.querySelectorAll(".cm-diag")].map(
        (el) =>
          `${el.getAttribute("aria-invalid")}:${el.className.includes("cm-diag-ar") ? "ar" : "en"}`,
      ),
    );
    expect(drawn).toEqual([
      "spelling:en",
      "spelling:en",
      "grammar:en",
      "spelling:en",
      "spelling:en",
      "spelling:ar",
    ]);
  });

  it("F7 selects the next issue and opens its suggestions; Enter replaces it, undoably", async () => {
    await caretAt("# Checking");
    await press("F7");
    const opened = await waitForMenu();
    expect(opened?.kind).toBe("Possible spelling mistake");
    expect(opened?.explanation).toBe("“recieve” isn't in the English dictionary.");
    expect(opened?.items[0]).toBe("receive");
    expect(opened?.items.slice(-2)).toEqual(["Ignore", "Add to dictionary"]);
    expect(opened?.focused).toBe("receive");
    expect(await selected()).toBe("recieve");
    await press("Enter");
    await waitForNoMenu();
    expect(await docText()).toContain("I will receive the letter");
    expect(await editorHasFocus()).toBe(true);
    await press("Control", "z");
    expect(await docText()).toBe(DOC);
  });

  it("moves on with F7 inside the menu, back with Shift-F7, and Escape returns to the text", async () => {
    // The undo above changed the paragraph: it is checked again first.
    expect(await marks()).toEqual(EXPECTED);
    await caretAt("# Checking");
    await press("F7");
    await waitForMenu();
    await press("F7");
    await browser.waitUntil(async () => (await selected()) === "tomorow", { timeout: 5000 });
    // The menu follows the selection a moment later (under the offline run's strace, too
    // late for an immediate read).
    await browser.waitUntil(
      async () => (await waitForMenu())?.explanation.includes("tomorow") ?? false,
      { timeout: 5000, timeoutMsg: "the menu never moved on to “tomorow”" },
    );
    await press("Shift", "F7");
    await browser.waitUntil(async () => (await selected()) === "recieve", { timeout: 5000 });
    await waitForMenu();
    await press("Escape");
    await waitForNoMenu();
    expect(await editorHasFocus()).toBe(true);
    expect(await selected()).toBe("recieve");
    expect(await docText()).toBe(DOC);
  });

  it("offers Arabic corrections in the writing font", async () => {
    await caretAt("Taymiyya");
    await press("F7");
    const opened = await waitForMenu();
    expect(opened?.explanation).toBe("“كتابب” isn't in the Arabic dictionary.");
    expect(opened?.items).toContain("كتاب");
    const font = await browser.execute(
      () => getComputedStyle(document.querySelector(".suggestions .word") as Element).fontFamily,
    );
    expect(font).toMatch(/Amiri/);
    await press("Escape");
    await waitForNoMenu();
  });

  it("Mod-. opens the grammar suggestion at the caret, and a choice replaces the text", async () => {
    await caretAt("a apple");
    await press("Control", ".");
    const opened = await waitForMenu();
    expect(opened?.kind).toBe("Grammar suggestion");
    expect(opened?.items).toEqual(["an", "Ignore"]);
    await press("Enter");
    await waitForNoMenu();
    expect(await docText()).toContain("This is an apple");
    expect(await marks()).not.toContain("grammar:a");
    await press("Control", "z");
    expect(await docText()).toBe(DOC);
  });

  it("says so when there is nothing at the caret", async () => {
    await caretAt("letter");
    await press("Control", ".");
    await browser.waitUntil(async () => (await statusText()).includes("Nothing to suggest here."), {
      timeout: 5000,
    });
    expect(await menu()).toBeNull();
  });

  it("opens the suggestions from a right-click on a marked word", async () => {
    const [word] = await $$(".cm-diag-spelling");
    await word?.click({ button: "right" });
    const opened = await waitForMenu();
    expect(opened?.kind).toBe("Possible spelling mistake");
    await press("Escape");
    await waitForNoMenu();
  });

  it("Ignore hides a word in this document for the session", async () => {
    await caretAt("Ibn");
    await press("Control", ".");
    await waitForMenu();
    await browser.execute(() => {
      const items = [...document.querySelectorAll<HTMLElement>('.suggestions [role="menuitem"]')];
      items.find((el) => el.textContent?.trim() === "Ignore")?.focus();
    });
    await press("Enter");
    await waitForNoMenu();
    expect(await marks()).not.toContain("spelling:Ibn");
    // Reopening the document keeps it ignored; nothing was written anywhere.
    await open(path);
    expect(await marks()).not.toContain("spelling:Ibn");
    expect(existsSync(dictionary())).toBe(false);
  });

  it("Add to dictionary writes the word to dictionary.txt and checks again", async () => {
    await caretAt("Taymiyya");
    await press("Control", ".");
    const opened = await waitForMenu();
    expect(opened?.explanation).toBe("“Taymiyya” isn't in the English dictionary.");
    await browser.execute(() => {
      const items = [...document.querySelectorAll<HTMLElement>('.suggestions [role="menuitem"]')];
      items.find((el) => el.textContent?.trim() === "Add to dictionary")?.focus();
    });
    await press("Enter");
    await waitForNoMenu();
    await browser.waitUntil(async () => !(await marks()).includes("spelling:Taymiyya"), {
      timeout: 5000,
    });
    expect(readFileSync(dictionary(), "utf8")).toBe("Taymiyya\n");
  });

  it("picks up dictionary.txt edited in another program when the window regains focus", async () => {
    mkdirSync(join(process.env.XDG_CONFIG_HOME ?? "", "bismillah"), { recursive: true });
    writeFileSync(dictionary(), "Taymiyya\ntomorow\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(dictionary(), later, later);
    await browser.execute(async () => {
      await window.__bismillah?.regainFocus();
    });
    await browser.waitUntil(async () => !(await marks()).includes("spelling:tomorow"), {
      timeout: 5000,
    });
    expect(await marks()).toContain("spelling:recieve");
  });

  it("follows the switches in Settings", async () => {
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ check_spelling: false });
    });
    expect(await marks()).toEqual(["grammar:a"]);
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ check_grammar: false });
    });
    expect(await marks()).toEqual([]);
    await caretAt("# Checking");
    await press("F7");
    await browser.waitUntil(
      async () => (await statusText()).includes("Spelling and grammar checking are off."),
      { timeout: 5000 },
    );
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ check_spelling: true, check_grammar: true });
    });
    expect(await marks()).toEqual(["spelling:recieve", "grammar:a", "spelling:كتابب"]);
  });

  it("follows the dialect setting", async () => {
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ english_dialect: "american" });
    });
    await browser.waitUntil(async () => (await marks()).includes("spelling:colour"), {
      timeout: 5000,
    });
    expect(await marks()).toContain("spelling:grey");
    await browser.execute(async () => {
      await window.__bismillah?.changeSettings({ english_dialect: "british" });
    });
    await browser.waitUntil(async () => !(await marks()).includes("spelling:colour"), {
      timeout: 5000,
    });
  });

  it("checks what is typed once typing pauses, never the word being typed", async () => {
    await caretAt("student wrote it.", "student wrote it".length);
    for (const key of " mistaek") await browser.keys(key);
    // Still in the word: nothing is drawn under it even once checked.
    await settled();
    const probe: Probe[] = await browser.execute(() => window.__bismillah?.diagnostics() ?? []);
    expect(probe.find((d) => d.text === "mistaek")?.drawn).toBe(false);
    await caretAt("# Checking");
    await frames();
    const after: Probe[] = await browser.execute(() => window.__bismillah?.diagnostics() ?? []);
    expect(after.find((d) => d.text === "mistaek")?.drawn).toBe(true);
  });

  it("says so when the document has no issues", async () => {
    await open(folder.file("clean.md", "A clean sentence.\n"));
    await settled();
    await press("F7");
    await browser.waitUntil(
      async () => (await statusText()).includes("No spelling or grammar issues."),
      { timeout: 5000 },
    );
  });
});
