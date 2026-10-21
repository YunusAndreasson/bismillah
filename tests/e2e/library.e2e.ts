import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { setViewport, waitForApp } from "../app.ts";
import { APP_BINARY, REPO } from "../driver.ts";
import type { LibraryProbe } from "../../src/core/testHooks.ts";
import { act, docText, Folder, notices, open, statusText, typeAtEnd } from "./files.ts";

/**
 * The library in the real app (PLAN.md Phase 2 accept): every library action from the
 * keyboard alone, files with the same name told apart, and every attempt to leave the
 * library refused. Each test works on a fresh copy of tests/fixtures/library.
 */

const FIXTURE = resolve(REPO, "tests/fixtures/library");

async function frames(): Promise<void> {
  await browser.execute(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Presses a key or a chord, then releases the modifiers. One key per call (files.ts). */
async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  const modifiers = keys.filter((k) => ["Control", "Shift", "Alt"].includes(k));
  if (modifiers.length) await browser.keys(modifiers);
  await frames();
}

async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys(key);
  await frames();
}

const library = (): Promise<LibraryProbe> =>
  browser.execute(() => {
    const probe = window.__bismillah?.library();
    if (!probe) throw new Error("no test hooks");
    return probe;
  });

const rowPaths = async () => (await library()).rows.map((r) => r.path);

async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 5000) {
  await browser.waitUntil(check, { timeout, timeoutMsg: message });
}

async function focusedRowIs(path: string) {
  await until(async () => (await library()).focusedRow === path, `focus never reached ${path}`);
}

const picker = () => browser.execute(() => window.__bismillah?.picker() ?? null);
const prompt = () => browser.execute(() => window.__bismillah?.prompt() ?? null);

/** Invokes a Rust command directly, as a compromised or buggy frontend might. (Not
 * `error`: WebDriver reads a result with that key as a failure of its own.) */
async function invoke(command: string, args: Record<string, unknown>) {
  return browser.execute(
    async (c: string, a: Record<string, unknown>) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { ok: await internals.invoke(c, a) };
      } catch (error) {
        return { refused: error };
      }
    },
    command,
    args,
  );
}

describe("library", () => {
  let folder: Folder;
  let root: string;

  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, 1280, 860);
  });

  beforeEach(async () => {
    folder = new Folder();
    root = join(folder.path, "Writing");
    cpSync(FIXTURE, root, { recursive: true });
    await browser.execute(async (dir: string) => {
      await window.__bismillah?.setLibrary(dir);
      await window.__bismillah?.measure();
    }, root);
  });

  afterEach(async () => {
    // Leave the library hidden, so later suites start as they always did.
    await browser.execute(async () => {
      const hooks = window.__bismillah;
      await hooks?.flush();
      if (hooks?.library().visible) hooks.run("view.toggleLibrary");
      await hooks?.settle();
    });
    // Dismiss whatever is open; in the text, Escape would put the pen down instead.
    const inText = await browser.execute(
      () => document.activeElement?.classList.contains("cm-content") ?? false,
    );
    if (!inText) await browser.keys(["Escape"]);
    folder.remove();
  });

  it("lists folders first, in natural order, and only Markdown files", async () => {
    await press("Control", "\\");
    await until(async () => (await library()).visible, "the library never showed");
    expect(await rowPaths()).toEqual([
      "Essays",
      "Notes",
      "رسائل",
      "Chapter 2.md",
      "Chapter 10.md",
      "Qurʾān citations.markdown",
    ]);
    const probe = await library();
    expect(probe.name).toBe("Writing");
    expect(probe.mode).toBe("docked");
    expect(probe.rows[0]).toMatchObject({ level: 1, expanded: false });
  });

  it("is used from the keyboard alone: open, move, expand, open a file, go back", async () => {
    await press("Control", "\\");
    await focusedRowIs("Essays");
    await press("ArrowRight");
    expect((await library()).rows[0]?.expanded).toBe(true);
    await press("ArrowDown");
    await focusedRowIs("Essays/2026");
    await press("ArrowRight");
    await press("ArrowRight");
    await focusedRowIs("Essays/2026/Letter to Ḥasan.md");
    await press("Enter");
    await until(async () => (await docText()).startsWith("# Letter to Ḥasan"), "never opened");
    const probe = await library();
    expect(probe.active).toBe("Essays/2026/Letter to Ḥasan.md");
    expect(probe.rows.find((r) => r.selected)?.path).toBe("Essays/2026/Letter to Ḥasan.md");
    expect(await browser.getTitle()).toBe("Letter to Ḥasan.md — bismillah");
    // Back in the tree: Left goes to the parent folder, then closes it.
    await press("Control", "\\");
    await focusedRowIs("Essays/2026/Letter to Ḥasan.md");
    await press("ArrowLeft");
    await focusedRowIs("Essays/2026");
    await press("ArrowLeft");
    expect((await library()).rows.find((r) => r.path === "Essays/2026")?.expanded).toBe(false);
    // Type-ahead finds rows by their first letters, IJMES letters folded.
    await press("Home");
    await type("q");
    await focusedRowIs("Qurʾān citations.markdown");
    // Esc returns to the text; Mod-\ in the library hides it.
    await press("Escape");
    expect((await library()).focusedRow).toBeNull();
    await press("Control", "\\");
    await press("Control", "\\");
    expect((await library()).visible).toBe(false);
  });

  it("renames from the keyboard without ever replacing a file", async () => {
    await press("Control", "\\");
    await type("c");
    await focusedRowIs("Chapter 2.md");
    await press("F2");
    await until(async () => (await prompt())?.ready === true, "the rename prompt never opened");
    expect(await prompt()).toMatchObject({
      title: "Rename “Chapter 2.md”",
      value: "Chapter 2.md",
    });
    // The name starts selected up to its ending: typing replaces "Chapter 2".
    await type("Chapter 10");
    await press("Enter");
    await until(async () => (await prompt())?.problem != null, "no explanation for a taken name");
    expect((await prompt())?.problem).toContain("already there");
    expect(readFileSync(join(root, "Chapter 10.md"), "utf8")).toBe(
      "# Chapter 10\n\nThe tenth chapter.\n",
    );
    // Select all and give it a new name; .md is added.
    await press("Control", "a");
    await type("Chapter two");
    await press("Enter");
    await until(async () => (await prompt()) === null, "the prompt never closed");
    expect(existsSync(join(root, "Chapter two.md"))).toBe(true);
    expect(existsSync(join(root, "Chapter 2.md"))).toBe(false);
    await focusedRowIs("Chapter two.md");
  });

  it("renames the open document, saving its edits first, and keeps saving there", async () => {
    await open(join(root, "Notes/notes.md"));
    await typeAtEnd("More.");
    await press("F2");
    await until(async () => (await prompt())?.ready === true, "the rename prompt never opened");
    await press("Control", "a");
    await type("Reading list");
    await press("Enter");
    await until(async () => (await prompt()) === null, "the prompt never closed");
    expect(readFileSync(join(root, "Notes/Reading list.md"), "utf8")).toBe(
      "# Notes\n\nA list of things to read.\nMore.",
    );
    expect(existsSync(join(root, "Notes/notes.md"))).toBe(false);
    expect(await browser.getTitle()).toBe("Reading list.md — bismillah");
    expect((await library()).active).toBe("Notes/Reading list.md");
    await typeAtEnd(" Again.");
    await browser.execute(() => window.__bismillah?.flush());
    expect(readFileSync(join(root, "Notes/Reading list.md"), "utf8")).toContain("More. Again.");
    expect(await statusText()).toContain("Reading list.md · Saved");
  });

  it("creates a folder from the keyboard inside the focused folder", async () => {
    await press("Control", "\\");
    await focusedRowIs("Essays");
    await press("Control", "Shift", "n");
    await until(async () => (await prompt())?.ready === true, "the new folder prompt never opened");
    expect((await prompt())?.title).toBe("New folder in “Essays”");
    await press("Enter");
    await until(async () => (await prompt())?.problem === "Type a name.", "empty name accepted");
    await type("Drafts");
    await press("Enter");
    await until(async () => (await prompt()) === null, "the prompt never closed");
    expect(existsSync(join(root, "Essays/Drafts"))).toBe(true);
    await focusedRowIs("Essays/Drafts");
  });

  it("moves to the trash with Delete and puts it back with Undo", async () => {
    await press("Control", "\\");
    await type("chapter 1");
    await focusedRowIs("Chapter 10.md");
    await press("Delete");
    await until(() => !existsSync(join(root, "Chapter 10.md")), "never trashed");
    // The private trash of the headless run (scripts/headless.sh), never the author's.
    const trash = join(process.env.XDG_DATA_HOME ?? "", "Trash/files");
    expect(readdirSync(trash)).toContain("Chapter 10.md");
    expect(await notices()).toContainEqual({
      message: "Moved “Chapter 10.md” to the trash.",
      actions: ["Undo", "OK"],
    });
    await focusedRowIs("Qurʾān citations.markdown");
    await act("Undo");
    await until(() => existsSync(join(root, "Chapter 10.md")), "never restored");
    expect(readFileSync(join(root, "Chapter 10.md"), "utf8")).toBe(
      "# Chapter 10\n\nThe tenth chapter.\n",
    );
    await until(async () => (await rowPaths()).includes("Chapter 10.md"), "row never came back");
  });

  it("closes a trashed open document, and Undo opens it again", async () => {
    await open(join(root, "Chapter 2.md"));
    await typeAtEnd(" Edited.");
    await browser.execute(() => window.__bismillah?.run("file.trash"));
    await until(() => !existsSync(join(root, "Chapter 2.md")), "never trashed");
    await until(
      () => browser.execute(() => document.querySelector(".first-screen") !== null),
      "the first screen never showed",
    );
    await act("Undo");
    await until(async () => (await docText()).endsWith(" Edited."), "never reopened");
    expect(readFileSync(join(root, "Chapter 2.md"), "utf8")).toBe(
      "# Chapter 2\n\nThe second chapter.\n Edited.",
    );
  });

  it("tells files with the same name apart in quick open, by their folders", async () => {
    await press("Control", "p");
    await until(async () => (await picker()) !== null, "quick open never opened");
    await type("notes");
    await until(async () => (await picker())?.items.length === 2, "expected two notes.md");
    // Equally good matches: the shallower path first.
    expect((await picker())?.items).toEqual(["notes.md Notes", "notes.md Essays"]);
    await press("Enter");
    await until(async () => (await docText()).startsWith("# Notes\n"), "never opened");
    expect((await library()).active).toBe("Notes/notes.md");
  });

  it("searches a large library in both scripts and opens the exact keyboard selection", async () => {
    const many = join(root, "Many");
    mkdirSync(many);
    for (let i = 0; i < 600; i++) {
      writeFileSync(join(many, `ḥadīth ${i}.md`), `# Hadith ${i}\n`);
      writeFileSync(join(many, `سَلَام ${i}.md`), `# سَلَام ${i}\n\nالكتابةُ أمانةٌ.\n`);
    }
    await browser.execute(async (path: string) => window.__bismillah?.setLibrary(path), root);
    await press("Control", "p");
    await until(
      async () => (await picker())?.items.length === 50,
      "quick open never filled its page",
    );
    await type("hadith");
    await until(
      async () => (await picker())?.items.every((item) => item.startsWith("ḥadīth")) ?? false,
      "folded Latin query never matched",
    );
    expect((await picker())?.items).toHaveLength(50);
    await press("Control", "a");
    await type("سلام 599");
    await until(async () => (await picker())?.items.length === 1, "Arabic query never narrowed");
    expect((await picker())?.items[0]).toBe("سَلَام 599.md Many");
    await press("Enter");
    await until(async () => (await docText()).startsWith("# سَلَام 599"), "wrong file opened");
    expect(await docText()).toBe("# سَلَام 599\n\nالكتابةُ أمانةٌ.\n");
    expect(readFileSync(join(many, "سَلَام 599.md"), "utf8")).toBe(await docText());
  });

  it("finds files without their diacritics, ʿayn or vocalisation", async () => {
    await press("Control", "p");
    await type("hasan");
    await until(
      async () =>
        (await picker())?.items[0]?.replace(/\s*\/\s*/g, "/") === "Letter to Ḥasan.md Essays/2026",
      "Ḥasan not found by hasan",
    );
    await press("Control", "a");
    await type("ilm");
    await until(
      async () => (await picker())?.items[0] === "ʿIlm and adab.md Essays",
      "ʿIlm not found by ilm",
    );
    await press("Escape");
    await until(async () => (await picker()) === null, "quick open never closed");
  });

  it("runs commands from the palette, found by their aliases", async () => {
    await press("Control", "Shift", "p");
    await until(async () => (await picker())?.kind === "palette", "the palette never opened");
    await type("distraction");
    await until(
      async () => (await picker())?.selected?.startsWith("Zuhd mode") ?? false,
      "no Zuhd",
    );
    await press("Enter");
    await until(
      () => browser.execute(() => document.querySelector(".cm-zuhd-dim") !== null),
      "Zuhd mode never came on",
    );
    await press("Control", "Shift", "p");
    await type("zuhd");
    await until(async () => (await picker())?.selected?.includes("· On") ?? false, "not shown On");
    await press("Enter");
    await until(
      () => browser.execute(() => document.querySelector(".cm-zuhd-dim") === null),
      "Zuhd mode never went off",
    );
  });

  it("refuses every attempt to leave the library", async () => {
    const outside = folder.file("outside.md", "not in the library\n");
    symlinkSync(outside, join(root, "leak.md"));
    mkdirSync(join(folder.path, "elsewhere"));
    symlinkSync(join(folder.path, "elsewhere"), join(root, "away"));
    await browser.execute(() => window.__bismillah?.regainFocus());
    await press("Control", "\\");
    // Listed, so the writer sees them, but never opened or listed into.
    await until(async () => (await rowPaths()).includes("leak.md"), "the link isn't listed");
    expect(await rowPaths()).toContain("away");
    for (const path of ["../outside.md", "/etc/passwd", "Essays/../../outside.md", "leak.md"]) {
      expect(await invoke("library_open_file", { path })).toEqual({ refused: { kind: "outside" } });
    }
    for (const [command, args] of [
      ["library_rename", { path: "../outside.md", name: "taken.md" }],
      ["library_trash", { path: "../outside.md" }],
      ["library_trash", { path: "" }],
      ["library_new_folder", { parent: "..", name: "escape" }],
      ["library_new_folder", { parent: "away", name: "escape" }],
      ["library_rename", { path: "Chapter 2.md", name: "../escaped.md" }],
    ] as const) {
      const result = await invoke(command, args);
      expect(result).toHaveProperty("refused");
    }
    expect(readFileSync(outside, "utf8")).toBe("not in the library\n");
    expect(readdirSync(join(folder.path, "elsewhere"))).toEqual([]);
    expect(existsSync(join(folder.path, "escaped.md"))).toBe(false);
    expect(existsSync(join(folder.path, "escape"))).toBe(false);
    expect(existsSync(join(root, "Chapter 2.md"))).toBe(true);
  });

  it("follows changes other programs make, without focus or polling", async () => {
    await press("Control", "\\");
    writeFileSync(join(root, "From elsewhere.md"), "# New\n");
    await until(async () => (await rowPaths()).includes("From elsewhere.md"), "never listed");
    // The open file changes on disk: with no local edits it reloads quietly…
    await open(join(root, "Chapter 2.md"));
    writeFileSync(join(root, "Chapter 2.md"), "# Chapter 2\n\nRewritten elsewhere.\n");
    await until(async () => (await docText()).includes("Rewritten elsewhere."), "never reloaded");
    // …and with local edits it never overwrites: the conflict bar shows.
    await typeAtEnd(" Mine.");
    writeFileSync(join(root, "Chapter 2.md"), "# Chapter 2\n\nTheirs.\n");
    await until(
      async () => (await notices()).some((n) => n.actions.includes("Keep mine")),
      "no conflict bar",
    );
    expect(readFileSync(join(root, "Chapter 2.md"), "utf8")).toBe("# Chapter 2\n\nTheirs.\n");
    await act("Keep mine");
    await until(
      () => readFileSync(join(root, "Chapter 2.md"), "utf8").endsWith(" Mine."),
      "Keep mine never saved",
    );
  });

  it("docks beside the text on wide windows and opens over it on narrow ones", async () => {
    const left = () =>
      browser.execute(
        () => document.querySelector(".cm-content")?.getBoundingClientRect().left ?? -1,
      );
    await open(join(root, "Chapter 2.md"));
    await setViewport(browser, 1920, 900);
    await browser.execute(() => window.__bismillah?.measure());
    const before = await left();
    await press("Control", "\\");
    expect(await library()).toMatchObject({ visible: true, mode: "docked", offset: 0 });
    expect(await left()).toBe(before); // wide: opening the library moves no text
    await setViewport(browser, 1280, 860);
    await browser.execute(() => window.__bismillah?.measure());
    const probe = await library();
    expect(probe.mode).toBe("docked");
    expect(await left()).toBeGreaterThanOrEqual(287);
    await setViewport(browser, 640, 800);
    await browser.execute(() => window.__bismillah?.measure());
    expect(await library()).toMatchObject({ mode: "overlay", visible: false });
    await press("Control", "\\");
    await until(
      () => browser.execute(() => document.querySelector(".library-overlay") !== null),
      "the overlay never opened",
    );
    await focusedRowIs("Chapter 2.md");
    await press("Home");
    await press("ArrowRight");
    await press("ArrowDown");
    await press("ArrowDown");
    await focusedRowIs("Essays/ʿIlm and adab.md");
    await press("Enter");
    await until(async () => (await docText()).startsWith("# ʿIlm"), "never opened");
    expect(await browser.execute(() => document.querySelector(".library-overlay"))).toBeNull();
    await setViewport(browser, 1280, 860);
  });

  it("takes a folder from a second launch as the library", async () => {
    const other = join(folder.path, "Other folder");
    mkdirSync(other);
    writeFileSync(join(other, "only.md"), "# Only\n");
    const launch = spawnSync(APP_BINARY, [other], { timeout: 20_000, env: process.env });
    expect(launch.status).toBe(0);
    await until(async () => (await library()).name === "Other folder", "never switched");
    await until(async () => (await rowPaths()).join() === "only.md", "never listed its file");
  });
});
