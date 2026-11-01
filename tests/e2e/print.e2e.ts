import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { settle, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";

// Words that don't compress: a repeated sentence deflates into one frame, a still code.
const TEXT =
  "# Trust\n\nبِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\n\nThe word أَمَانَةٌ sits in an English line.\n\n" +
  Array.from({ length: 4000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join(" ");

// A key made for this test by `PhoneSecret::generate`, and its check words.
const PHONE_KEY = "bk1vz8yu5r3mfqfgx0yzxle6vq244dm56k9qc5u47d9zfakf945dgrqyty4xt";
const PHONE_WORDS = "monk jury lung luau";

const probe = () => browser.execute(() => window.__bismillah?.printProbe() ?? null);

/** Print to Phone's computer side (ADR-0021). The phone side is a later step. */
describe("Print to phone", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(async (text: string) => {
      const hooks = window.__bismillah;
      hooks?.offerPrint();
      await hooks?.setDoc(text);
    }, TEXT);
    await settle(browser);
  });

  async function open() {
    await browser.execute(() => window.__bismillah?.run("file.printToPhone"));
    const dialog = await browser.$(".print-dialog");
    await dialog.waitForDisplayed();
    await browser.waitUntil(async () => ((await probe())?.shown ?? 0) > 0);
    return dialog;
  }

  afterEach(async () => {
    await browser.execute(() => window.__bismillah?.offerPrint(false));
    if (await browser.$(".print-dialog").isExisting()) {
      await browser.keys(["Escape"]);
      await browser.$(".print-dialog").waitForExist({ reverse: true });
    }
  });

  it("plays the whole document, pauses by keyboard, and returns focus on Escape", async () => {
    await browser.execute(() => window.__bismillah?.caretAt("Trust"));
    const dialog = await open();
    const text = await dialog.getText();
    expect(text).toContain("whole document");
    expect(text).toContain("bismillah Reader");
    expect(text).toMatch(/About \d+ (seconds|minutes)|About a minute/);
    await browser.waitUntil(async () => (await probe())?.status === "playing");
    const before = (await probe())?.shown ?? 0;
    await browser.waitUntil(async () => ((await probe())?.shown ?? 0) > before + 1);
    // The toggle has focus, so Space pauses with no special handling.
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.textContent?.trim() === "Pause"),
    );
    await browser.keys([" "]);
    await browser.waitUntil(async () => (await probe())?.status === "paused");
    const held = (await probe())?.shown;
    await browser.pause(500);
    expect((await probe())?.shown).toBe(held);
    await browser.keys(["Escape"]);
    await dialog.waitForExist({ reverse: true });
    expect(await probe()).toBeNull();
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.closest(".cm-content") != null),
    );
  });

  it("prints a selection as one still code, with Done its one control", async () => {
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return;
      const at = view.state.doc.toString().indexOf("أَمَانَةٌ");
      view.dispatch({ selection: { anchor: at, head: at + 9 }, userEvent: "select" });
    });
    const dialog = await open();
    expect(await dialog.getText()).toContain("selection · 1 word");
    await browser.waitUntil(async () => (await probe())?.status === "still");
    expect((await probe())?.still).toBe(true);
    expect(await browser.$$(".print-button").length).toBe(1);
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.textContent?.trim() === "Done"),
    );
    await browser.execute(() => window.__bismillah?.caretAt("Trust"));
  });

  it("draws black on white in whole pixels, in the dark theme too", async () => {
    await browser.execute(() => {
      window.__bismillah?.setTheme("dark");
      window.__bismillah?.offerPrint(true);
    });
    await open();
    const drawn = await browser.execute(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".print-dialog canvas");
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return null;
      const corner = [...context.getImageData(0, 0, 1, 1).data];
      const colours = new Set<number>();
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) colours.add(data[i] ?? 0);
      return { corner, colours: [...colours].sort((a, b) => a - b), width: canvas.width };
    });
    expect(drawn?.corner).toEqual([255, 255, 255, 255]);
    expect(drawn?.colours).toEqual([0, 255]);
    await browser.execute(() => window.__bismillah?.setTheme("system"));
  });

  it("waits for Start when held, as under reduced motion", async () => {
    await browser.execute(() => window.__bismillah?.offerPrint(true));
    await open();
    await browser.waitUntil(async () => (await probe())?.status === "ready");
    const shown = (await probe())?.shown;
    await browser.pause(400);
    expect((await probe())?.shown).toBe(shown);
    await browser.waitUntil(() =>
      browser.execute(() => document.activeElement?.textContent?.trim() === "Start"),
    );
    await browser.keys([" "]);
    await browser.waitUntil(async () => (await probe())?.status === "playing");
  });

  it("prints unsaved edits and leaves the save state alone", async () => {
    await browser.execute(async () => {
      const hooks = window.__bismillah;
      await hooks?.setDoc("Unsaved words, only on screen.\n");
    });
    const before = await browser.execute(() => window.__bismillah?.saveState()?.revision);
    const dialog = await open();
    expect(await dialog.getText()).toContain("5 words");
    await browser.keys(["Escape"]);
    await dialog.waitForExist({ reverse: true });
    expect(await browser.execute(() => window.__bismillah?.saveState()?.revision)).toBe(before);
    await browser.execute((text: string) => window.__bismillah?.setDoc(text), TEXT);
  });

  it("asks for nothing when the document is empty", async () => {
    await browser.execute(() => window.__bismillah?.setDoc(""));
    await browser.execute(() => window.__bismillah?.run("file.printToPhone"));
    await browser.pause(150);
    expect(await browser.$(".print-dialog").isExisting()).toBe(false);
    await browser.execute((text: string) => window.__bismillah?.setDoc(text), TEXT);
  });

  it("shows a whole library text by text, and goes to the number the phone names", async () => {
    const root = mkdtempSync(join(tmpdir(), "bismillah-print-library-"));
    cpSync(resolve(REPO, "tests/fixtures/library"), root, { recursive: true });
    await browser.execute(async (path: string) => window.__bismillah?.setLibrary(path), root);
    await browser.execute(() => window.__bismillah?.run("file.printLibrary"));
    const dialog = await browser.$(".print-dialog");
    await dialog.waitForDisplayed();
    await browser.waitUntil(async () => ((await probe())?.shown ?? 0) > 0);
    const first = await probe();
    expect(first?.texts).toBeGreaterThan(3);
    expect(first?.place?.count).toBe(first?.texts);
    const text = await dialog.getText();
    expect(text).toContain("whole library");
    expect(text).toContain("still lacks");

    const field = await browser.$(".print-dialog .place input");
    await field.setValue("3");
    await browser.execute(() =>
      document.querySelector(".print-dialog .place input")?.dispatchEvent(new Event("change")),
    );
    await browser.waitUntil(async () => (await probe())?.place?.index === 2);
    expect(await dialog.getText()).toContain((await probe())?.place?.name.split("/").at(-1));
  });

  it("says a print isn't sealed, catches a typed slip, then seals to the key", async () => {
    let dialog = await open();
    expect(await dialog.getText()).toContain("Not sealed");
    await browser.keys(["Escape"]);
    await dialog.waitForExist({ reverse: true });

    await browser.execute(() => window.__bismillah?.run("file.pairPhone"));
    const field = await browser.$(".prompt input");
    await field.waitForDisplayed();
    await field.setValue(PHONE_KEY.replace("bk1", "bk1q"));
    await browser.keys(["Enter"]);
    const error = await browser.$("#prompt-error");
    await error.waitForDisplayed();
    expect(await error.getText()).toContain("isn't the whole key");
    expect(await field.getValue()).toContain("bk1q");

    await field.setValue(PHONE_KEY.toUpperCase().replace(/(.{4})/g, "$1 "));
    await browser.keys(["Enter"]);
    await browser.$(".prompt").waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await browser.$("body").getText()).includes(PHONE_WORDS));

    dialog = await open();
    const text = await dialog.getText();
    expect(text).toContain(`Sealed to your phone: ${PHONE_WORDS}.`);
    expect(text).not.toContain("Not sealed");
  });

  it("broke no content security rule", async () => {
    await open();
    const violations = await browser.execute(
      () => (window as unknown as { __cspViolations?: unknown[] }).__cspViolations?.length ?? 0,
    );
    expect(violations).toBe(0);
  });
});
