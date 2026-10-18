import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { loadDoc, setCursor } from "./spikes/helpers.ts";

/**
 * Typing aids in the real app (DESIGN.md §11.3, ADR-0010): keys typed through WebKit's
 * input path reach CodeMirror's input handler, and the conversions, Backspace restores and
 * undo steps behave as the unit tests say.
 */

async function text(): Promise<string> {
  return browser.execute(() => window.__bismillah?.view.state.doc.toString() ?? "");
}

async function frames(): Promise<void> {
  await browser.execute(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * Types text one key at a time: WebKitWebDriver drops the second of two identical keys
 * sent in one action, so "--" would arrive as "-".
 */
async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys(key);
  await frames();
}

/** Presses a named key or a chord, then releases held modifiers. */
async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  const modifiers = keys.filter((k) => ["Control", "Shift", "Alt"].includes(k));
  if (modifiers.length) await browser.keys(modifiers);
  await frames();
}

/** A fresh one-line document with the caret at its end. */
async function start(doc: string, options: { translit: boolean; smart?: boolean }) {
  await loadDoc(doc);
  await browser.execute(
    (translit: boolean, smart: boolean) => {
      window.__bismillah?.setTransliteration(translit);
      window.__bismillah?.setSmartPunctuation(smart);
    },
    options.translit,
    options.smart ?? true,
  );
  await setCursor(doc.length);
  // Keep the first typed key out of the undo step that loaded the document.
  await browser.pause(600);
}

describe("typing aids", () => {
  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => window.__bismillah?.setTypewriter(false));
  });

  after(async () => {
    await browser.execute(() => {
      window.__bismillah?.setTransliteration(false);
      window.__bismillah?.setSmartPunctuation(true);
    });
  });

  it("makes smart quotes, dashes and ellipses in Latin text", async () => {
    await start("Start: ", { translit: false });
    await type(`"Read," she said -- pp. 10--12 --- and so...`);
    expect(await text()).toBe("Start: “Read,” she said – pp. 10–12 — and so…");
  });

  it("makes guillemets in an Arabic run", async () => {
    await start("قال ", { translit: false });
    await type(`"`);
    await browser.execute(() => {
      const view = window.__bismillah?.view;
      const head = view?.state.selection.main.head ?? 0;
      view?.dispatch({
        changes: { from: head, insert: "العلم نور" },
        selection: { anchor: head + "العلم نور".length },
      });
    });
    await type(`"`);
    expect(await text()).toBe("قال «العلم نور»");
  });

  it("transliterates IJMES sequences when the mode is on", async () => {
    await start("IJMES: ", { translit: true });
    await type("Qa=di= .hadi=th `ilm Qur''a=n");
    expect(await text()).toBe("IJMES: Qādī ḥadīth ʿilm Qurʾān");
  });

  it("leaves the keys alone when the mode is off", async () => {
    await start("Off: ", { translit: false, smart: false });
    await type(`a= .h ' "x" --`);
    expect(await text()).toBe(`Off: a= .h ' "x" --`);
  });

  it("restores the typed keys with an immediate Backspace", async () => {
    await start("Undo: ", { translit: true });
    await type("a=");
    expect(await text()).toBe("Undo: ā");
    await press("Backspace");
    expect(await text()).toBe("Undo: a=");
    await type(".h");
    await press("Backspace");
    expect(await text()).toBe("Undo: a=.h");
  });

  it("makes each conversion its own undo step", async () => {
    await start("Steps: ", { translit: true });
    await type("the Qa=");
    expect(await text()).toBe("Steps: the Qā");
    await press("Control", "z");
    expect(await text()).toBe("Steps: the Qa=");
    await press("Control", "z");
    expect(await text()).toBe("Steps: ");
  });

  it("never converts inside inline code", async () => {
    await start("Code: ", { translit: false });
    await type('see `"x" -- ...` then "y"');
    expect(await text()).toBe('Code: see `"x" -- ...` then “y”');

    // With transliteration on, a backtick is ʿ; Backspace makes it a literal backtick
    // that opens a code span.
    await start("Span: ", { translit: true });
    await type("`");
    expect(await text()).toBe("Span: ʿ");
    await press("Backspace");
    await type("a=b .h``");
    expect(await text()).toBe("Span: `a=b .h``");
  });
});
