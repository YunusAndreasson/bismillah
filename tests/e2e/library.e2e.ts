import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
 * The library in the real app, through the Files panel (PLAN.md Phase 2 accept,
 * ADR-0016): every library action from the keyboard alone, files with the same name
 * told apart, and every attempt to leave the library refused. Each test works on a
 * fresh copy of tests/fixtures/library.
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

async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 5000) {
  await browser.waitUntil(check, { timeout, timeoutMsg: message });
}

const panel = () => browser.execute(() => window.__bismillah?.panel() ?? null);
const prompt = () => browser.execute(() => window.__bismillah?.prompt() ?? null);
/** The Files panel's rows, by value ("file:notes.md", "folder:Essays"). */
const rows = async () => ((await panel())?.rows ?? []).map((r) => r.value);

async function selectedIs(value: string) {
  await until(async () => (await panel())?.selected === value, `${value} never highlighted`);
}

/** Opens the Files panel with Ctrl+P, and types `query` into it. */
async function files(query = ""): Promise<void> {
  await press("Control", "p");
  await until(async () => (await panel())?.kind === "files", "the Files panel never opened");
  if (query) await type(query);
}

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
    }, root);
  });

  afterEach(async () => {
    await browser.execute(async () => {
      const hooks = window.__bismillah;
      await hooks?.flush();
      await hooks?.settle();
    });
    // Dismiss whatever is open; in the text, Escape would put the pen down instead.
    for (let i = 0; i < 3; i++) {
      const open = await browser.execute(
        () =>
          window.__bismillah?.prompt() !== null || (window.__bismillah?.panel() ?? null) !== null,
      );
      if (open) await browser.keys(["Escape"]);
    }
    folder.remove();
  });

  it("lists recent files, then every file in natural order, and only Markdown files", async () => {
    await files();
    expect(await rows()).toEqual([
      "file:Essays/2026/Letter to Ḥasan.md",
      "file:Essays/ʿIlm and adab.md",
      "file:Essays/notes.md",
      "file:Notes/notes.md",
      "file:رسائل/سلام.md",
      "file:Chapter 2.md",
      "file:Chapter 10.md",
      "file:Qurʾān citations.markdown",
    ]);
    expect((await library()).name).toBe("Writing");
    await press("Enter");
    await until(async () => (await docText()).startsWith("# Letter to Ḥasan"), "never opened");
    // It comes first now, as a recent file.
    await files();
    expect((await rows())[0]).toBe("recent:Essays/2026/Letter to Ḥasan.md");
    expect(
      await browser.execute(() => document.querySelectorAll(".panel-row.current").length),
    ).toBe(1);
    expect((await panel())?.rows[0]?.text).toContain("Essays/2026");
  });

  it("is used from the keyboard alone: find, narrow to a folder, open a file", async () => {
    await files("essays");
    await selectedIs("folder:Essays");
    await press("Enter");
    await until(async () => (await panel())?.query === "Essays/", "never narrowed to Essays");
    expect(await rows()).toEqual([
      "folder:Essays",
      "folder:Essays/2026",
      "file:Essays/2026/Letter to Ḥasan.md",
      "file:Essays/ʿIlm and adab.md",
      "file:Essays/notes.md",
    ]);
    await press("ArrowDown");
    await selectedIs("folder:Essays/2026");
    await press("Enter");
    await until(async () => (await panel())?.query === "Essays/2026/", "never narrowed");
    await press("ArrowDown");
    await selectedIs("file:Essays/2026/Letter to Ḥasan.md");
    await press("Enter");
    await until(async () => (await docText()).startsWith("# Letter to Ḥasan"), "never opened");
    expect((await library()).active).toBe("Essays/2026/Letter to Ḥasan.md");
    expect(await browser.getTitle()).toBe("Letter to Ḥasan.md — bismillah");
    expect(
      await browser.execute(() => document.activeElement?.classList.contains("cm-content")),
    ).toBe(true);
  });

  it("renames from the keyboard without ever replacing a file", async () => {
    await files("chapter 2");
    await selectedIs("file:Chapter 2.md");
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
    await selectedIs("file:Chapter two.md");
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

  it("creates a folder from the keyboard inside the highlighted folder", async () => {
    await files("essays");
    await selectedIs("folder:Essays");
    await press("Control", "Shift", "n");
    await until(async () => (await prompt())?.ready === true, "the new folder prompt never opened");
    expect((await prompt())?.title).toBe("New folder in “Essays”");
    await press("Enter");
    await until(async () => (await prompt())?.problem === "Type a name.", "empty name accepted");
    await type("Drafts");
    await press("Enter");
    await until(async () => (await prompt()) === null, "the prompt never closed");
    expect(existsSync(join(root, "Essays/Drafts"))).toBe(true);
    // The panel shows the new, empty folder, so a file can be made in it.
    await until(async () => (await panel())?.query === "Essays/Drafts/", "never shown");
    await selectedIs("folder:Essays/Drafts");
  });

  it("moves to the trash with Delete and puts it back with Undo", async () => {
    await files("chapter 10");
    await selectedIs("file:Chapter 10.md");
    await press("Delete");
    await until(() => !existsSync(join(root, "Chapter 10.md")), "never trashed");
    // The private trash of the headless run (scripts/headless.sh), never the author's.
    const trash = join(process.env.XDG_DATA_HOME ?? "", "Trash/files");
    expect(readdirSync(trash)).toContain("Chapter 10.md");
    expect(await notices()).toContainEqual({
      message: "Moved “Chapter 10.md” to the trash.",
      actions: ["Undo", "OK"],
    });
    await act("Undo");
    await until(() => existsSync(join(root, "Chapter 10.md")), "never restored");
    expect(readFileSync(join(root, "Chapter 10.md"), "utf8")).toBe(
      "# Chapter 10\n\nThe tenth chapter.\n",
    );
    await until(
      async () => (await library()).paths.includes("Chapter 10.md"),
      "never listed again",
    );
  });

  it("says why a file couldn't go to the trash, and leaves it", async () => {
    chmodSync(root, 0o555);
    try {
      await files("chapter 10");
      await selectedIs("file:Chapter 10.md");
      await press("Delete");
      await until(
        async () => (await notices()).some((n) => n.message.startsWith("Couldn't move")),
        "no notice for the failure",
      );
      expect(existsSync(join(root, "Chapter 10.md"))).toBe(true);
    } finally {
      chmodSync(root, 0o755);
    }
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

  it("tells files with the same name apart, by their folders", async () => {
    await files("notes");
    await until(
      async () => (await rows()).filter((r) => r.startsWith("file:")).length === 2,
      "expected two notes.md",
    );
    // Equally good matches: the shallower path first.
    expect((await panel())?.rows.slice(0, 2).map((r) => r.text)).toEqual([
      "notes.md Notes",
      "notes.md Essays",
    ]);
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
    await files();
    // The first 500 are listed; typing finds the others.
    await until(async () => (await rows()).length === 500, "the list never filled");
    await type("hadith");
    await until(
      async () =>
        ((await panel())?.rows ?? []).every((r) => r.text.startsWith("ḥadīth")) &&
        (await rows()).length > 0,
      "folded Latin query never matched",
    );
    expect(await rows()).toHaveLength(50);
    await press("Control", "a");
    await type("سلام 599");
    await until(async () => (await rows()).length === 1, "Arabic query never narrowed");
    expect((await panel())?.rows[0]?.text).toBe("سَلَام 599.md Many");
    await press("Enter");
    await until(async () => (await docText()).startsWith("# سَلَام 599"), "wrong file opened");
    expect(await docText()).toBe("# سَلَام 599\n\nالكتابةُ أمانةٌ.\n");
    expect(readFileSync(join(many, "سَلَام 599.md"), "utf8")).toBe(await docText());
  });

  it("finds files without their diacritics, ʿayn or vocalisation", async () => {
    await files("hasan");
    await selectedIs("file:Essays/2026/Letter to Ḥasan.md");
    await press("Control", "a");
    await type("ilm");
    await selectedIs("file:Essays/ʿIlm and adab.md");
    await press("Escape");
    await until(async () => (await panel()) === null, "the panel never closed");
  });

  it("runs commands from the Commands panel, found by their aliases", async () => {
    await press("Control", "Shift", "p");
    await until(async () => (await panel())?.kind === "commands", "Commands never opened");
    await type("distraction");
    await selectedIs("command:editor.toggleFocus");
    // A switch changes in place, and the panel stays open.
    await press("Enter");
    await until(
      () => browser.execute(() => document.querySelector(".cm-zuhd-dim") !== null),
      "Zuhd mode never came on",
    );
    expect((await panel())?.rows[0]?.text).toMatch(/On/);
    await press("Enter");
    await until(
      () => browser.execute(() => document.querySelector(".cm-zuhd-dim") === null),
      "Zuhd mode never went off",
    );
    // Any other command closes the panel and runs in the text.
    await press("Control", "a");
    await type("go to line");
    await selectedIs("command:edit.goToLine");
    await press("Enter");
    await until(async () => (await panel()) === null, "the panel never closed");
    await until(
      () => browser.execute(() => document.querySelector(".cm-navigation-feedback") !== null),
      "Go to line never opened",
    );
    await press("Escape");
  });

  it("offers what an empty or missing library needs", async () => {
    const empty = join(folder.path, "Empty");
    mkdirSync(empty);
    await browser.execute(async (path: string) => window.__bismillah?.setLibrary(path), empty);
    await files();
    expect((await panel())?.rows.map((r) => r.text)).toEqual(["New file…"]);
    await press("Escape");
    await until(async () => (await panel()) === null, "the panel never closed");
  });

  it("refuses every attempt to leave the library", async () => {
    const outside = folder.file("outside.md", "not in the library\n");
    symlinkSync(outside, join(root, "leak.md"));
    mkdirSync(join(folder.path, "elsewhere"));
    symlinkSync(join(folder.path, "elsewhere"), join(root, "away"));
    await browser.execute(() => window.__bismillah?.regainFocus());
    // Rust lists them, but the Files panel never offers them.
    await until(async () => (await library()).paths.includes("leak.md"), "the link isn't seen");
    await files("leak");
    expect(await rows()).not.toContain("file:leak.md");
    await press("Escape");
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
    writeFileSync(join(root, "From elsewhere.md"), "# New\n");
    await until(async () => (await library()).paths.includes("From elsewhere.md"), "never listed");
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

  it("takes a folder from a second launch as the library", async () => {
    const other = join(folder.path, "Other folder");
    mkdirSync(other);
    writeFileSync(join(other, "only.md"), "# Only\n");
    const launch = spawnSync(APP_BINARY, [other], { timeout: 20_000, env: process.env });
    expect(launch.status).toBe(0);
    await until(async () => (await library()).name === "Other folder", "never switched");
    await until(async () => (await library()).paths.join() === "only.md", "never listed its file");
  });
});
