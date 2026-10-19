import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { settle, waitForApp } from "../app.ts";
import { Folder, open } from "./files.ts";

/**
 * Phase 5 in the real app: colour themes (built in and the writer's files, checked by
 * Rust), high contrast, keybindings.toml applied as soon as it is saved, the full
 * Settings screen and About (DESIGN.md §6, §9, §13; ARCHITECTURE.md §8–9).
 *
 * The harness gives every run a private config folder (scripts/headless.sh), so these
 * tests write theme files and keybindings.toml there, as a writer would in an editor.
 */
const config = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah");
const themes = join(config, "themes");
const keybindings = join(config, "keybindings.toml");
const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

const token = (name: string) =>
  browser.execute((n: string) => window.__bismillah?.token(n) ?? "", name);
const notices = () => browser.execute(() => window.__bismillah?.notices() ?? []);
const shortcuts = () =>
  browser.execute(() => window.__bismillah?.shortcuts() ?? { keys: {}, problems: [], changed: 0 });
const listed = () => browser.execute(() => window.__bismillah?.colourThemes() ?? []);
const change = (patch: Record<string, unknown>) =>
  browser.execute(async (p: Record<string, unknown>) => {
    await window.__bismillah?.changeSettings(p);
  }, patch);

/** Presses a chord, then releases its modifiers. */
async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  const modifiers = keys.filter((k) => ["Control", "Shift", "Alt"].includes(k));
  if (modifiers.length) await browser.keys(modifiers);
  await settle(browser);
}

const radio = (name: string) => `//button[@role="radio" and normalize-space()="${name}"]`;

/** A computed colour, rgb() or WebKit's color(srgb …), as 0–255 channels. */
function channels(css: string): [number, number, number] {
  const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  throw new Error(`not a colour: ${css}`);
}

function contrast(a: string, b: string): number {
  const lum = (css: string) => {
    const [r, g, b2] = channels(css).map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Closes any dialog a failed test left open, so the next starts from the text. */
async function closeDialogs(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const open = await browser.execute(() => document.querySelector("[role=dialog]") !== null);
    if (!open) return;
    await browser.keys(["Escape"]);
    await browser.pause(200);
  }
}
afterEach(closeDialogs);

const zuhdOn = () => browser.execute(() => document.querySelector(".cm-editor.cm-zuhd") !== null);

describe("colour themes", () => {
  before(async () => {
    await waitForApp(browser);
    mkdirSync(themes, { recursive: true });
  });
  after(async () => {
    rmSync(themes, { recursive: true, force: true });
    await change({ theme: "system", colour_theme: "bismillah", high_contrast: false });
  });

  it("applies a built-in theme's colours for the variant on screen", async () => {
    await change({ theme: "light", colour_theme: "sepia" });
    expect(await token("surface-editor")).toBe("rgb(244, 236, 221)");
    // Aliases follow their source: the focus ring is the theme's accent.
    expect(await token("focus-ring")).toBe("rgb(29, 100, 71)");
    await change({ theme: "dark" });
    expect(await token("surface-editor")).toBe("rgb(28, 24, 20)");
    await change({ theme: "light", colour_theme: "bismillah" });
    expect(await token("surface-editor")).toBe("rgb(247, 246, 242)");
  });

  it("picks up a theme file as soon as it is saved, listing what is wrong with it", async () => {
    writeFileSync(
      join(themes, "night.toml"),
      'name = "Night ink"\n[dark]\nsurface-editor = "#0d1117"\ntext-secondary = "#4a4f55"\nacent = "#0f0"\n',
    );
    await browser.waitUntil(async () => (await listed()).some((t) => t.id === "night"), {
      timeout: 5000,
      timeoutMsg: "the new theme file never appeared",
    });
    const night = (await listed()).find((t) => t.id === "night");
    expect(night?.usable).toBe(true);
    expect(night?.problems).toEqual([
      "“dark.acent” isn't something a theme sets, so it's ignored.",
      expect.stringMatching(
        /^Dark: text-secondary is \d\.\d:1 on surface-editor, .* needs 4\.5:1\.$/,
      ),
    ]);
    await change({ theme: "dark", colour_theme: "night" });
    expect(await token("surface-editor")).toBe("rgb(13, 17, 23)");
    // A dark-only theme leaves light to bismillah's own colours.
    await change({ theme: "light" });
    expect(await token("surface-editor")).toBe("rgb(247, 246, 242)");
    await change({ theme: "dark" });
    // Edited in another program: applied without the window regaining focus.
    writeFileSync(join(themes, "night.toml"), '[dark]\nsurface-editor = "#101010"\n');
    await browser.waitUntil(async () => (await token("surface-editor")) === "rgb(16, 16, 16)", {
      timeout: 5000,
      timeoutMsg: "the edited theme never applied",
    });
  });

  it("falls back to bismillah's colours, and says so, when the chosen theme can't be used", async () => {
    writeFileSync(join(themes, "night.toml"), 'name = "Broken\n');
    await browser.waitUntil(
      async () => (await listed()).find((t) => t.id === "night")?.usable === false,
      { timeout: 5000 },
    );
    await change({ theme: "dark", colour_theme: "night" });
    expect(await token("surface-editor")).toBe("rgb(21, 21, 21)");
    const notice = (await notices()).find((n) => n.message.includes("“night” can't be used"));
    expect(notice?.actions).toEqual(["Show in Settings", "OK"]);
    expect((await listed()).find((t) => t.id === "night")?.problems).toEqual([
      "It couldn't be read: it stops being TOML or JSON at line 1.",
    ]);
  });

  it("lets high contrast override any theme, in both variants", async () => {
    await change({ theme: "light", colour_theme: "slate", high_contrast: true });
    expect(await token("surface-editor")).toBe("rgb(255, 255, 255)");
    expect(await token("text-primary")).toBe("rgb(0, 0, 0)");
    await change({ theme: "dark" });
    expect(await token("surface-editor")).toBe("rgb(0, 0, 0)");
    expect(await token("text-primary")).toBe("rgb(255, 255, 255)");
    await change({ high_contrast: false });
    expect(await token("surface-editor")).toBe("rgb(20, 24, 29)");
  });

  it("chooses colours from Settings by keyboard and saves the choice", async () => {
    await change({ theme: "light", colour_theme: "bismillah" });
    await browser.execute(() => window.__bismillah?.openSettings("appearance"));
    const slate = await browser.$(radio("Slate"));
    await slate.waitForDisplayed();
    // The checked radio holds the group's tab stop; arrows move the choice.
    const bismillah = await browser.$(radio("bismillah"));
    await bismillah.click();
    // Arrows move along the radios and Space chooses (the focus event that also chooses
    // never fires under Xvfb).
    await browser.keys(["ArrowRight"]);
    await browser.keys(["ArrowRight"]);
    await browser.keys(["Space"]);
    await browser.waitUntil(async () => (await token("surface-editor")) === "rgb(243, 245, 247)");
    expect(readFileSync(join(config, "settings.toml"), "utf8")).toContain('colour_theme = "slate"');
    await browser.keys(["Escape"]);
    await browser.$("[role=dialog]").waitForDisplayed({ reverse: true });
  });
});

describe("keybindings.toml", () => {
  let folder: Folder;

  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    await open(folder.file("keys.md", "First paragraph.\n\nSecond paragraph.\n"));
  });
  after(async () => {
    rmSync(keybindings, { force: true });
    await browser.waitUntil(async () => (await shortcuts()).changed === 0, { timeout: 5000 });
    await change({ focus_mode: false });
    folder.remove();
  });

  it("applies the file as soon as it is saved: new shortcuts work and old ones stop", async () => {
    writeFileSync(
      keybindings,
      'schema = 1\n"editor.toggleFocus" = "Ctrl+Shift+D"\n[view]\nfullscreen = ""\n',
    );
    await browser.waitUntil(async () => (await shortcuts()).changed === 2, {
      timeout: 5000,
      timeoutMsg: "keybindings.toml was never applied",
    });
    const { keys, problems } = await shortcuts();
    expect(keys["editor.toggleFocus"]).toBe("Mod-Shift-d");
    expect(keys["view.fullscreen"]).toBeUndefined();
    expect(problems).toEqual([]);
    await browser.execute(() => window.__bismillah?.caretAt("First"));
    await press("Control", "d");
    expect(await zuhdOn()).toBe(false);
    // With Shift held a real keyboard sends "D", which CodeMirror matches as Shift-d.
    await press("Control", "Shift", "D");
    await browser.waitUntil(zuhdOn, { timeoutMsg: "Ctrl+Shift+D didn't run Zuhd mode" });
    await press("Control", "Shift", "D");
    await browser.waitUntil(async () => !(await zuhdOn()));
  });

  it("shows the shortcut the writer gave in the palette", async () => {
    await browser.execute(() => window.__bismillah?.run("app.commandPalette"));
    await browser.keys([..."zuhd"]);
    await browser.waitUntil(async () => {
      const picker = await browser.execute(() => window.__bismillah?.picker());
      return picker?.items.some((i) => i.includes("Zuhd mode") && i.includes("Ctrl+Shift+D"));
    });
    await browser.keys(["Escape"]);
  });

  it("lists lines it couldn't use and offers to show them in Settings", async () => {
    writeFileSync(
      keybindings,
      '"file.save" = "Ctrl+C"\n"view.fulscreen" = "F12"\n"edit.undo" = "Ctrl+U"\n',
    );
    await browser.waitUntil(async () => (await shortcuts()).problems.length === 3, {
      timeout: 5000,
    });
    expect((await shortcuts()).problems).toEqual([
      "Line 1: Ctrl+C is kept for the text, so Save now keeps its own shortcut.",
      "Line 2: “view.fulscreen” isn't a command.",
      "Line 3: Undo keeps its standard shortcut.",
    ]);
    expect((await shortcuts()).keys["file.save"]).toBe("Mod-s");
    await browser.execute(() => window.__bismillah?.act("Show in Settings"));
    const heading = await browser.$("#settings-files");
    await heading.waitForDisplayed();
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.id === "settings-files"),
    );
    const text = await browser.$("[role=dialog]").getText();
    expect(text).toContain("Line 2: “view.fulscreen” isn't a command.");
    await browser.keys(["Escape"]);
    await browser.$("[role=dialog]").waitForDisplayed({ reverse: true });
  });

  it("creates a starting file that changes nothing until a line is uncommented", async () => {
    rmSync(keybindings, { force: true });
    await browser.waitUntil(async () => (await shortcuts()).problems.length === 0, {
      timeout: 5000,
    });
    await browser.execute(() => window.__bismillah?.openSettings("files"));
    const create = await browser.$("button=Create keybindings.toml");
    await create.waitForDisplayed();
    await create.click();
    await browser.waitUntil(() => existsSync(keybindings));
    await browser.keys(["Escape"]);
    expect(await shortcuts()).toMatchObject({ problems: [], changed: 0 });
    // Every line uncommented gives every command its own shortcut back: the file is
    // valid TOML and each shortcut reads back as itself.
    const text = readFileSync(keybindings, "utf8");
    const all = text
      .split("\n")
      .map((l) => (l.startsWith('# "') ? l.slice(2) : l))
      .join("\n");
    writeFileSync(keybindings, all);
    await browser.waitUntil(async () => (await shortcuts()).changed > 20, { timeout: 5000 });
    const after = await shortcuts();
    expect(after.problems).toEqual([]);
    expect(after.keys["view.toggleLibrary"]).toBe("Mod-\\");
    expect(after.keys["file.trash"]).toBe("Delete");
  });
});

describe("Settings and About", () => {
  let folder: Folder;

  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    await open(folder.file("prose.md", "First paragraph.\n\nSecond paragraph.\n"));
  });
  after(async () => {
    await change({
      writing_profile: "duo",
      custom_font: "",
      focus_dimming: "quiet",
      focus_mode: false,
    });
    folder.remove();
  });

  it("moves between its four sections from the links at the top", async () => {
    await browser.execute(() => window.__bismillah?.run("app.settings"));
    const dialog = await browser.$("[role=dialog]");
    await dialog.waitForDisplayed();
    for (const name of ["Appearance", "Writing", "Language & checking", "Files & privacy"])
      expect(await browser.$(`h2=${name}`).isExisting()).toBe(true);
    const link = await browser.$('//nav//button[normalize-space()="Writing"]');
    await link.click();
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.id === "settings-writing"),
    );
    await browser.keys(["Escape"]);
    await dialog.waitForDisplayed({ reverse: true });
  });

  it("uses an installed font by name, and says when there is none by that name", async () => {
    await change({ writing_profile: "custom", custom_font: "Liberation Serif" });
    const family = () =>
      browser.execute(
        () => getComputedStyle(document.querySelector(".cm-content") ?? document.body).fontFamily,
      );
    await browser.waitUntil(async () => (await family()).includes("Liberation Serif"), {
      timeoutMsg: "the installed font was never used",
    });
    await browser.execute(() => window.__bismillah?.openSettings("appearance"));
    const field = await browser.$("#set-font-name");
    await field.waitForDisplayed();
    await field.setValue("No Such Font");
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () =>
      (await browser.$("#set-font-name-hint").getText()).includes(
        "No installed font is called “No Such Font”",
      ),
    );
    // Not handed to the webview, which would draw a substitute: Duo is used instead.
    expect(await family()).not.toContain("No Such Font");
    expect(await family()).toContain("Bismillah Duo");
    await browser.keys(["Escape"]);
    await browser.$("[role=dialog]").waitForDisplayed({ reverse: true });
  });

  it("draws Zuhd mode's other text fainter when the writer chooses, still a measurable colour", async () => {
    await change({ focus_mode: true, focus_dimming: "faint" });
    const [dimmed, secondary, page] = await browser.execute(() => {
      const el = document.querySelector(".cm-zuhd-dim");
      const hooks = window.__bismillah;
      return [
        el ? getComputedStyle(el).color : "",
        hooks?.token("text-secondary") ?? "",
        hooks?.token("surface-editor") ?? "",
      ];
    });
    expect(dimmed).not.toBe(secondary);
    // Fainter than text needs (the writer's choice), yet plainly there.
    const ratio = contrast(dimmed, page);
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(4.5);
    await change({ focus_dimming: "quiet" });
    const quiet = await browser.execute(() => {
      const el = document.querySelector(".cm-zuhd-dim");
      return el ? getComputedStyle(el).color : "";
    });
    expect(quiet).toBe(secondary);
  });

  it("shows About with the inspiration and the licences, and returns focus on Escape", async () => {
    await browser.execute(() => window.__bismillah?.caretAt("Second"));
    await browser.execute(() => window.__bismillah?.run("app.about"));
    const dialog = await browser.$(".about-dialog");
    await dialog.waitForDisplayed();
    const text = await dialog.getText();
    expect(text).toContain("bismillah");
    expect(text).toContain(`Version ${version}`);
    expect(text).toContain("amanah");
    expect(text).toContain("GNU General Public License, version 3 or later");
    expect(text).toContain("SIL Open Font License 1.1");
    // Opened at its start, with Close focused.
    expect(await browser.execute(() => document.querySelector(".about-dialog")?.scrollTop)).toBe(0);
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe("Close");
    await browser.keys(["Escape"]);
    await dialog.waitForDisplayed({ reverse: true });
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.closest(".cm-content") != null),
    );
  });
});
