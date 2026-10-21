import { browser, expect } from "@wdio/globals";
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setViewport, settle, waitForApp } from "../app.ts";
import { docText, fault, Folder, open, saveState, typeAtEnd, waitForState } from "./files.ts";

const shots = "/tmp/bismillah-norman-review";
const change = (patch: Record<string, unknown>) =>
  browser.execute(async (p: typeof patch) => window.__bismillah?.changeSettings(p), patch);

describe("experience: clear actions and outcomes", () => {
  let folder: Folder;
  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
    mkdirSync(shots, { recursive: true });
    await setViewport(browser, 640, 700);
  });
  after(() => folder.remove());
  afterEach(async () => {
    await browser.keys("Escape");
    await fault(null);
  });

  it("keeps section navigation stable across repeated opens", async () => {
    await setViewport(browser, 1280, 900);
    const positions: number[] = [];
    for (let i = 0; i < 8; i++) {
      await browser.execute(() => window.__bismillah?.run("app.settings"));
      await browser.$(".settings-dialog").waitForDisplayed();
      await browser.$(".settings-dialog nav").$("button=Writing").click();
      await settle(browser);
      const geometry = await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(".settings-dialog");
        const header = panel?.querySelector("header");
        return {
          top: document.getElementById("settings-writing")?.getBoundingClientRect().top,
          headerBottom: header?.getBoundingClientRect().bottom,
          focused: document.activeElement?.id === "settings-writing",
        };
      });
      expect(geometry.focused).toBe(true);
      expect(geometry.top).toBeGreaterThan(geometry.headerBottom ?? Infinity);
      positions.push(geometry.top ?? -1);
      await browser.keys("Escape");
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.01);
  });

  it("keeps invalid navigation available for correction and explains accepted forms", async () => {
    const original = "One\nبِسْمِ\nThree";
    await open(folder.file("review.md", original));
    await browser.execute(() => window.__bismillah?.view.focus());
    await browser.keys(["Control", "Alt", "g"]);
    await browser.$(".cm-goto-line").waitForDisplayed();
    await browser.$(".cm-goto-line input").setValue("not a line");
    await browser.keys("Enter");
    expect(await browser.$(".cm-goto-line").isDisplayed()).toBe(true);
    expect(await browser.$(".cm-goto-line input").getAttribute("aria-invalid")).toBe("true");
    expect(await browser.$(".cm-navigation-feedback").getText()).toContain(
      "Your position hasn't changed",
    );
    expect(await browser.execute(() => window.__bismillah?.view.state.selection.main.head)).toBe(0);
    await browser.saveScreenshot(`${shots}/after-navigation-error.png`);
    await browser.$(".cm-goto-line input").setValue(" 3:2 ");
    await browser.$('.cm-goto-line button[type="submit"]').click();
    await browser.$(".cm-goto-line").waitForDisplayed({ reverse: true });
    expect(
      await browser.execute(() => {
        const state = window.__bismillah?.view.state;
        return state ? state.selection.main.head - state.doc.line(3).from : -1;
      }),
    ).toBe(2);
    expect(await docText()).toBe(original);
  });

  it("explains immediate application, enforces stepper limits and identifies font defaults", async () => {
    await change({ text_scale: 3, line_height: 3 });
    await browser.execute(() => window.__bismillah?.openSettings("appearance"));
    await browser.$(".settings-dialog").waitForDisplayed();
    expect(await browser.$(".settings-description").getText()).toBe("Changes apply immediately.");
    for (const label of ["Text size", "Line height"]) {
      expect(await browser.$(`[aria-label="Bigger (${label})"]`).isEnabled()).toBe(false);
      expect(await browser.$(`[aria-label="Smaller (${label})"]`).isEnabled()).toBe(true);
    }
    await change({ text_scale: 0.5, line_height: 1.2 });
    for (const label of ["Text size", "Line height"]) {
      expect(await browser.$(`[aria-label="Smaller (${label})"]`).isEnabled()).toBe(false);
      expect(await browser.$(`[aria-label="Bigger (${label})"]`).isEnabled()).toBe(true);
    }
    await browser.execute(() =>
      document.querySelector('[aria-labelledby="set-line"]')?.scrollIntoView(),
    );
    await browser.$('[aria-labelledby="set-line"]').$("button=Reset").click();
    await browser.waitUntil(async () =>
      (await browser.$('[aria-labelledby="set-line"] output').getText()).includes("font default"),
    );
    await change({ writing_profile: "amiri" });
    expect(await browser.$('[aria-labelledby="set-line"] output').getText()).toBe(
      "1.8 (font default)",
    );
    await browser.saveScreenshot(`${shots}/after-settings-default.png`);
    await browser.keys("Escape");
    await change({ text_scale: 1, line_height: null, writing_profile: "duo" });
  });

  it("reports settings failures inside the dialog and retries without losing choices", async () => {
    const config = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah");
    const mode = statSync(config).mode & 0o777;
    await change({ theme: "light" });
    await browser.execute(() => window.__bismillah?.openSettings("appearance"));
    await browser.$(".settings-dialog").waitForDisplayed();
    const before = readFileSync(join(config, "settings.toml"), "utf8");
    try {
      chmodSync(config, 0o555);
      await browser.$(".settings-dialog").$("button=Dark").click();
      await browser.$(".settings-save-error").waitForDisplayed();
      expect(await browser.$(".settings-save-error").getText()).toContain(
        "Couldn't save your settings",
      );
      expect(readFileSync(join(config, "settings.toml"), "utf8")).toBe(before);
      await setViewport(browser, 480, 360);
      await browser.saveScreenshot(`${shots}/after-settings-error.png`);
      expect(
        await browser.execute(() => {
          const panel = document.querySelector(".settings-dialog");
          const header = panel?.querySelector("header")?.getBoundingClientRect();
          const footer = panel?.querySelector("footer")?.getBoundingClientRect();
          return header && footer ? footer.top - header.bottom : 0;
        }),
      ).toBeGreaterThanOrEqual(48);
      await browser.keys("Tab");
      expect(
        await browser.execute(() => {
          const panel = document.querySelector(".settings-dialog");
          const r = document.activeElement?.getBoundingClientRect();
          const header = panel?.querySelector("header")?.getBoundingClientRect();
          const footer = panel?.querySelector("footer")?.getBoundingClientRect();
          return !!r && !!header && !!footer && r.top >= header.bottom && r.bottom <= footer.top;
        }),
      ).toBe(true);
      expect(
        await browser.execute(() => {
          const r = document.querySelector(".settings-save-error .action")?.getBoundingClientRect();
          return !!r && r.top >= 0 && r.bottom <= innerHeight;
        }),
      ).toBe(true);
      chmodSync(config, mode);
      await browser.$(".settings-save-error .action").click();
      await browser.$(".settings-save-error").waitForDisplayed({ reverse: true });
      expect(readFileSync(join(config, "settings.toml"), "utf8")).toContain('theme = "dark"');
    } finally {
      chmodSync(config, mode);
      await browser.keys("Escape");
      await change({ theme: "system" });
    }
  });

  it("acknowledges only durable explicit saves and clears stale feedback", async () => {
    await setViewport(browser, 640, 700);
    const original = "English العربية بِسْمِ\n";
    await open(folder.file("saving.md", original));
    await fault("disk_full");
    await typeAtEnd("x");
    await browser.keys(["Control", "s"]);
    await waitForState("failed");
    expect(await browser.execute(() => window.__bismillah?.note())).not.toBe("Saved now.");
    expect(folder.read("saving.md").toString()).toBe(original);
    expect(await docText()).toBe(`${original}x`);
    await fault(null);
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(() =>
      browser.execute(() => window.__bismillah?.note() === "Saved now."),
    );
    expect(folder.read("saving.md").toString()).toBe(`${original}x`);
    await typeAtEnd("y");
    expect(await browser.execute(() => window.__bismillah?.note())).toBe("");
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(() =>
      browser.execute(() => window.__bismillah?.note() === "Saved now."),
    );
    await open(folder.file("other.md", "Another file"));
    expect(await browser.execute(() => window.__bismillah?.note())).toBe("");
  });

  it("explains why samples and read-only files cannot be saved", async () => {
    await browser.execute(() => window.__bismillah?.run("app.guide"));
    await browser.waitUntil(async () => (await saveState()) === "sample");
    await browser.execute(() => window.__bismillah?.view.focus());
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(async () =>
      (await browser.$(".notice").getText()).includes("copy the text into a new file"),
    );
    expect(await saveState()).toBe("sample");
    await browser.saveScreenshot(`${shots}/after-sample-save.png`);
    const bytes = Buffer.from([0x61, 0xe9]);
    await open(folder.file("readonly.md", bytes));
    await browser.execute(async () => window.__bismillah?.act("OK"));
    await browser.execute(() => window.__bismillah?.view.focus());
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(async () =>
      (await browser.$(".notice").getText()).includes("opened read-only"),
    );
    expect(folder.read("readonly.md").equals(bytes)).toBe(true);
    expect(await browser.execute(() => window.__bismillah?.note())).not.toBe("Saved now.");
  });

  it("keeps explanations usable across desktop widths, themes and enlarged writing", async () => {
    await open(folder.file("layout.md", "بِسْمِ\nMixed أمانة text"));
    for (const theme of ["light", "dark"] as const) {
      await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
      for (const [width, height, scale] of [
        [480, 360, 1],
        [640, 500, 2],
        [1280, 900, 1],
        [1920, 900, 1],
        [2560, 900, 1],
      ] as const) {
        await setViewport(browser, width, height);
        await browser.execute(async (s: number) => window.__bismillah?.setScale(s), scale);
        for (const [command, selector] of [
          ["edit.goToLine", ".cm-goto-line"],
          ["app.settings", ".settings-dialog"],
        ] as const) {
          await browser.execute((id: typeof command) => window.__bismillah?.run(id), command);
          await browser.$(selector).waitForDisplayed();
          await settle(browser);
          expect(
            await browser.execute((sel: string) => {
              const el = document.querySelector(sel);
              const r = el?.getBoundingClientRect();
              return (
                !!el &&
                !!r &&
                r.left >= 0 &&
                r.right <= innerWidth &&
                r.top >= 0 &&
                r.bottom <= innerHeight &&
                el.scrollWidth <= el.clientWidth + 1
              );
            }, selector),
          ).toBe(true);
          if (width === 480 || scale === 2)
            await browser.saveScreenshot(
              `${shots}/after-${selector.slice(1)}-${theme}-${width}.png`,
            );
          await browser.keys("Escape");
        }
      }
    }
    await change({ text_scale: 1, theme: "system" });
  });
});
