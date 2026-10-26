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

  it("opens Settings the same way each time, with focus in its search field", async () => {
    await setViewport(browser, 1280, 900);
    const positions: number[] = [];
    for (let i = 0; i < 8; i++) {
      await browser.execute(() => window.__bismillah?.run("app.settings"));
      await browser.$(".panel").waitForDisplayed();
      await settle(browser);
      const geometry = await browser.execute(() => ({
        top: document.querySelector(".panel-row")?.getBoundingClientRect().top,
        focused: document.activeElement?.classList.contains("panel-input") ?? false,
      }));
      expect(geometry.focused).toBe(true);
      positions.push(geometry.top ?? -1);
      await browser.keys("Escape");
      await browser.$(".panel").waitForDisplayed({ reverse: true });
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
    const steppers = async (id: string, label: string, top: boolean) => {
      await browser.execute(
        (row: string) => window.__bismillah?.openSettings({ row, open: true }),
        id,
      );
      await browser.$(`[aria-label="Bigger (${label})"]`).waitForDisplayed();
      expect(await browser.$(`[aria-label="Bigger (${label})"]`).isEnabled()).toBe(!top);
      expect(await browser.$(`[aria-label="Smaller (${label})"]`).isEnabled()).toBe(top);
    };
    await browser.execute(() => window.__bismillah?.run("app.settings"));
    await browser.$(".panel").waitForDisplayed();
    expect(await browser.$(".panel-input").getAttribute("placeholder")).toContain(
      "changes apply immediately",
    );
    await steppers("size", "Text size", true);
    await steppers("line", "Line height", true);
    await change({ text_scale: 0.5, line_height: 1.2 });
    await steppers("size", "Text size", false);
    await steppers("line", "Line height", false);
    await browser.$('[aria-labelledby="panel-label-line"]').$("button=Reset").click();
    await browser.waitUntil(async () =>
      (await browser.$('[aria-labelledby="panel-label-line"] output').getText()).includes(
        "font default",
      ),
    );
    await change({ writing_profile: "amiri" });
    expect(await browser.$('[aria-labelledby="panel-label-line"] output').getText()).toBe(
      "1.8 (font default)",
    );
    await browser.saveScreenshot(`${shots}/after-settings-default.png`);
    await browser.keys("Escape");
    await change({ text_scale: 1, line_height: null, writing_profile: "duo" });
  });

  it("reports settings failures inside the panel and retries without losing choices", async () => {
    const config = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah");
    const mode = statSync(config).mode & 0o777;
    await change({ theme: "light" });
    await browser.execute(() => window.__bismillah?.openSettings({ row: "theme", open: true }));
    await browser.$(".panel").waitForDisplayed();
    const before = readFileSync(join(config, "settings.toml"), "utf8");
    try {
      chmodSync(config, 0o555);
      await browser.$(".panel").$("button=Dark").click();
      await browser.$(".panel-save-error").waitForDisplayed();
      expect(await browser.$(".panel-save-error").getText()).toContain(
        "Couldn't save your settings",
      );
      expect(readFileSync(join(config, "settings.toml"), "utf8")).toBe(before);
      await setViewport(browser, 480, 360);
      await browser.saveScreenshot(`${shots}/after-settings-error.png`);
      // The list keeps room to read between the field and the hint.
      expect(
        await browser.execute(() => {
          const r = document.querySelector(".panel-list")?.getBoundingClientRect();
          return r ? r.height : 0;
        }),
      ).toBeGreaterThanOrEqual(48);
      expect(
        await browser.execute(() => {
          const r = document
            .querySelector(".panel-save-error .panel-action")
            ?.getBoundingClientRect();
          return !!r && r.top >= 0 && r.bottom <= innerHeight;
        }),
      ).toBe(true);
      chmodSync(config, mode);
      await browser.$(".panel-save-error .panel-action").click();
      await browser.$(".panel-save-error").waitForDisplayed({ reverse: true });
      expect(readFileSync(join(config, "settings.toml"), "utf8")).toContain('theme = "dark"');
    } finally {
      chmodSync(config, mode);
      await browser.keys("Escape");
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
          ["app.settings", ".panel"],
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
