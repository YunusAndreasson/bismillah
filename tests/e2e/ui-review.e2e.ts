import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import type { CommandId } from "../../src/core/commands.ts";
import { setViewport, settle, waitForApp } from "../app.ts";
import { docText, fault, Folder, open, typeAtEnd, waitForState } from "./files.ts";

const LONG_NAME = `${"A".repeat(180)}.md`;
const TEXT = "A quiet paragraph.\n\nالعربية أمانة.\n";

async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  const modifiers = keys.filter((key) => ["Control", "Shift", "Alt"].includes(key));
  if (modifiers.length) await browser.keys(modifiers);
}

describe("UI review: small windows and command feedback", () => {
  let folder: Folder;
  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    await browser.execute(async () => {
      window.__bismillah?.setTypewriter(false);
      await window.__bismillah?.changeSettings({ fade_chrome: false });
    });
    await browser.execute(
      async (path: string) => window.__bismillah?.setLibrary(path),
      folder.path,
    );
    await browser.execute(() => {
      const hooks = window.__bismillah;
      if (hooks?.library().visible) hooks.run("view.toggleLibrary");
    });
  });
  after(async () => {
    await fault(null);
    await browser.execute(async () => window.__bismillah?.flush());
    await browser.execute(async () => window.__bismillah?.changeSettings({ theme: "system" }));
    folder.remove();
  });
  afterEach(async () => {
    await browser.keys("Escape");
    await fault(null);
    await browser.execute(async () => window.__bismillah?.flush());
  });

  for (const [label, name] of [
    ["Latin", LONG_NAME],
    ["maximum-length", `${"W".repeat(252)}.md`],
    ["Arabic", `${"سَلَام".repeat(15)}.md`],
  ] as const) {
    it(`keeps recovery messages and actions inside the window for ${label} names`, async () => {
      await open(folder.file(name, TEXT));
      await fault("disk_full");
      await typeAtEnd("x");
      await browser.execute(async () => window.__bismillah?.flush());
      for (const width of [480, 640, 1280]) {
        await setViewport(browser, width, 360);
        for (const theme of ["light", "dark"] as const) {
          await browser.execute((t: "light" | "dark") => window.__bismillah?.setTheme(t), theme);
          await settle(browser);
          const geometry = await browser.execute(() => {
            const notice = document.querySelector<HTMLElement>(".notice");
            const message = notice?.querySelector("p");
            const rect = notice?.getBoundingClientRect();
            return {
              page: document.documentElement.scrollWidth,
              width: innerWidth,
              text: message?.textContent ?? "",
              left: rect?.left ?? -1,
              right: rect?.right ?? Infinity,
              messageFits: !!message && message.scrollWidth <= message.clientWidth + 1,
              actionsVisible: [...document.querySelectorAll(".notice button")].every((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
                );
              }),
            };
          });
          expect(geometry.page).toBeLessThanOrEqual(geometry.width + 1);
          expect(geometry.left).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(geometry.width);
          expect(geometry.text).toContain(name);
          expect(geometry.messageFits).toBe(true);
          expect(geometry.actionsVisible).toBe(true);
        }
      }
      await fault(null);
      await browser.$("button=Try again").click();
      await waitForState("saved");
      expect(folder.read(name).toString()).toBe(`${TEXT}x`);
    });
  }

  it("keeps a long Rename dialog bounded and its actions reachable by keyboard", async () => {
    await open(folder.file(LONG_NAME, TEXT));
    await setViewport(browser, 480, 360);
    await browser.keys("F2");
    await browser.$(".prompt").waitForDisplayed();
    await browser.$("#prompt-name").setValue("bad/name");
    await browser.keys("Enter");
    await browser.waitUntil(() => browser.execute(() => !!window.__bismillah?.prompt()?.problem));
    const fits = await browser.execute(() => {
      const r = document.querySelector(".prompt")?.getBoundingClientRect();
      return !!r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    });
    expect(fits).toBe(true);
    const formVisible = await browser.execute(() =>
      [...document.querySelectorAll(".prompt input, .prompt .error, .prompt button")].every(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        },
      ),
    );
    expect(formVisible).toBe(true);
    await browser.keys("Tab");
    const cancel = await browser.execute(() => {
      const el = document.activeElement;
      const r = el?.getBoundingClientRect();
      return {
        label: el?.textContent?.trim(),
        visible: !!r && r.top >= 0 && r.bottom <= innerHeight,
      };
    });
    expect(cancel).toEqual({ label: "Cancel", visible: true });
    await browser.keys("Enter");
    await browser.$(".prompt").waitForDisplayed({ reverse: true });
    expect(folder.read(LONG_NAME).toString()).toBe(TEXT);
    expect(await browser.getTitle()).toBe(`${LONG_NAME} — bismillah`);
  });

  it("keeps spelling actions reachable in a short window", async () => {
    const text = "This is a sentense with speling mistakes.\n";
    await open(folder.file("short-suggestions.md", text));
    await setViewport(browser, 480, 360);
    for (const theme of ["light", "dark"] as const) {
      await browser.execute((t: "light" | "dark") => window.__bismillah?.setTheme(t), theme);
      expect(await browser.execute(async () => window.__bismillah?.lintSettled())).toBe(true);
      await browser.execute(() => window.__bismillah?.run("check.next"));
      await browser.$(".suggestions").waitForDisplayed();
      await settle(browser);
      expect(
        await browser.execute(() => {
          const r = document.querySelector(".suggestions")?.getBoundingClientRect();
          return !!r && r.top >= 0 && r.bottom <= innerHeight;
        }),
      ).toBe(true);
      await browser.keys("End");
      await browser.waitUntil(() =>
        browser.execute(() => {
          const el = document.activeElement;
          const r = el?.getBoundingClientRect();
          return (
            el?.textContent?.trim() === "Add to dictionary" &&
            !!r &&
            r.top >= 0 &&
            r.bottom <= innerHeight
          );
        }),
      );
      await browser.keys("Escape");
      expect(await docText()).toBe(text);
    }
  });

  it("keeps About's focused Close button visible while opening at the start", async () => {
    for (const width of [480, 1280]) {
      await setViewport(browser, width, 360);
      for (const theme of ["light", "dark"] as const) {
        await browser.execute((t: "light" | "dark") => {
          window.__bismillah?.setTheme(t);
          window.__bismillah?.run("app.about");
        }, theme);
        await browser.$(".about-dialog").waitForDisplayed();
        await settle(browser);
        const state = await browser.execute(() => {
          const panel = document.querySelector(".about-dialog");
          const close = document.querySelector(".about-close");
          const r = close?.getBoundingClientRect();
          return {
            atStart: panel?.scrollTop === 0,
            focused: document.activeElement === close,
            visible:
              !!r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
          };
        });
        expect(state).toEqual({ atStart: true, focused: true, visible: true });
        await browser.keys("Escape");
        await browser.$(".about-dialog").waitForDisplayed({ reverse: true });
      }
    }
  });

  it("scrolls Settings headings clear of wrapped navigation", async () => {
    for (const width of [480, 640, 1280]) {
      await setViewport(browser, width, 360);
      await browser.execute(() => window.__bismillah?.openSettings("files"));
      await browser.$(".settings-dialog").waitForDisplayed();
      for (const [label, id] of [
        ["Files & privacy", "files"],
        ["Appearance", "appearance"],
        ["Writing", "writing"],
        ["Language & checking", "checking"],
      ]) {
        await browser.$(".settings-dialog nav").$(`button=${label}`).click();
        await settle(browser);
        const heading = await browser.execute((section: string) => {
          const el = document.getElementById(`settings-${section}`);
          const top = el?.getBoundingClientRect().top ?? -1;
          const header =
            document.querySelector(".settings-dialog header")?.getBoundingClientRect().bottom ??
            Infinity;
          return { visible: top >= header, focused: el === document.activeElement };
        }, id ?? "");
        expect(heading).toEqual({ visible: true, focused: true });
      }
      await browser.keys("Escape");
    }
  });

  it("reveals the full filename and follows customised library shortcuts", async () => {
    await setViewport(browser, 480, 360);
    await open(folder.file(LONG_NAME, TEXT));
    expect(await browser.$(".status .name").getAttribute("title")).toBe(LONG_NAME);
    const keybindings = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah", "keybindings.toml");
    const previous = existsSync(keybindings) ? readFileSync(keybindings) : null;
    try {
      writeFileSync(keybindings, '"view.toggleLibrary" = "Ctrl+Shift+B"\n');
      await browser.waitUntil(
        async () =>
          (await browser.$(".library-toggle").getAttribute("title")) === "Library (Ctrl+Shift+B)",
      );
      expect(await browser.$(".library-toggle").getAttribute("aria-keyshortcuts")).toBe(
        "Control+Shift+B",
      );
      await press("Control", "Shift", "B");
      await browser.waitUntil(() => browser.execute(() => window.__bismillah?.library().visible));
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.library().focusedRow !== null),
      );
      await browser.keys("F2");
      await browser.$(".prompt").waitForDisplayed();
      await browser.keys("Escape");
      await browser.$(".prompt").waitForDisplayed({ reverse: true });
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.library().focusedRow !== null),
      );
      await press("Control", "Shift", "B");
      await browser.waitUntil(() => browser.execute(() => !window.__bismillah?.library().visible));
      writeFileSync(keybindings, '"view.toggleLibrary" = ""\n');
      await browser.waitUntil(() =>
        browser.execute(
          () => !document.querySelector(".library-toggle")?.hasAttribute("aria-keyshortcuts"),
        ),
      );
    } finally {
      if (previous) writeFileSync(keybindings, previous);
      else rmSync(keybindings, { force: true });
      await browser.waitUntil(() =>
        browser.execute(
          () => window.__bismillah?.shortcuts().keys["view.toggleLibrary"] === "Mod-\\",
        ),
      );
    }
  });

  it("returns to writing after Open and New file from the overlay library", async () => {
    await setViewport(browser, 480, 360);
    await open(folder.file("before-overlay.md", TEXT));
    const windowId = execFileSync(
      "xdotool",
      ["search", "--onlyvisible", "--class", "^bismillah$"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .at(-1);
    if (!windowId) throw new Error("the headless app window was not found");
    execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
    for (const [command, name, initial] of [
      ["o", "opened-from-overlay.md", TEXT],
      ["n", "created-from-overlay.md", ""],
    ] as const) {
      if (command === "o") folder.file(name, initial);
      if (command === "o") await browser.$(".library-toggle").click();
      else await press("Control", "\\");
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.library().focusedRow !== null),
      );
      await browser.execute(
        async (path: string) => window.__bismillah?.nextDialog(path),
        join(folder.path, name),
      );
      await press("Control", command);
      await browser.waitUntil(async () => (await browser.getTitle()) === `${name} — bismillah`);
      await browser.waitUntil(() => browser.execute(() => !window.__bismillah?.library().visible));
      await settle(browser);
      await browser.waitUntil(() =>
        browser.execute(() => window.__bismillah?.view.contentDOM === document.activeElement),
      );
      execFileSync("xdotool", ["key", "q"]);
      await browser.waitUntil(async () => (await docText()) === `q${initial}`);
      await browser.execute(async () => window.__bismillah?.flush());
      expect(folder.read(name).toString()).toBe(`q${initial}`);
    }
  });

  it("greys unavailable native commands and tracks Undo and Redo history", async () => {
    const enabled = (id: CommandId) =>
      browser.execute(async (key: CommandId) => window.__bismillah?.menuItemEnabled(key), id);
    const windowId = execFileSync(
      "xdotool",
      ["search", "--onlyvisible", "--class", "^bismillah$"],
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n")
      .at(-1);
    if (!windowId) throw new Error("the headless app window was not found");
    execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
    const menu = async (inspect: () => Promise<void>) => {
      execFileSync("xdotool", ["key", "F10"]);
      await browser.waitUntil(
        async () =>
          (await browser.execute(async () => window.__bismillah?.menuState()))?.visible ?? false,
      );
      try {
        await inspect();
      } finally {
        execFileSync("xdotool", ["key", "Escape"]);
        await browser.waitUntil(
          async () =>
            !(await browser.execute(async () => window.__bismillah?.menuState()))?.visible,
        );
      }
    };
    await browser.execute(() => window.__bismillah?.welcome());
    await menu(async () => {
      expect(await enabled("file.save")).toBe(false);
      expect(await enabled("edit.selectAll")).toBe(false);
      expect(await enabled("file.open")).toBe(true);
    });
    await open(folder.file("history.md", TEXT));
    await menu(async () => {
      expect(await enabled("file.save")).toBe(true);
      expect(await enabled("edit.undo")).toBe(false);
      expect(await enabled("edit.redo")).toBe(false);
    });
    await typeAtEnd("x");
    await menu(async () => {
      expect(await enabled("edit.undo")).toBe(true);
      expect(await enabled("edit.redo")).toBe(false);
    });
    await browser.keys(["Control", "z"]);
    await menu(async () => {
      expect(await enabled("edit.undo")).toBe(false);
      expect(await enabled("edit.redo")).toBe(true);
    });
  });
});
