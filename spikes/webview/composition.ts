#!/usr/bin/env node
/**
 * Phase 4 spike: IME composition at the edge of the revealed block (ADR-0012).
 *
 *   scripts/headless.sh node spikes/webview/composition.ts
 *
 * A dead key opens a real composition in WebKitGTK (GTK's input method shows the accent
 * as preedit until the next key), so it exercises the same path as an IME. Each case
 * composes ´ + e at a block edge where live preview changes what is revealed during the
 * composition, then checks the text, that composition events really fired, and that the
 * caret's block is drawn with its Markdown afterwards. Keys are raw XTEST keycodes in a
 * Swedish layout, as in keyboard.ts.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { remote } from "webdriverio";
import { setViewport, settle, waitForApp } from "../../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../../tests/driver.ts";

const DEAD_ACUTE = "21";
const E = "26";
const SPACE = "65";
const X = "53";

/** [label, document with ‸ for the caret, keys, expected text] */
const CASES: [string, string, string[], string][] = [
  [
    "a line typed straight after a rendered paragraph joins it (the paragraph reveals mid-composition)",
    "Intro.\n\nPara *one* and [a link](https://example.com).\n‸\n\nEnd.",
    [DEAD_ACUTE, E],
    "Intro.\n\nPara *one* and [a link](https://example.com).\né\n\nEnd.",
  ],
  [
    "start of a block that begins with a hidden mark",
    "Intro *a*.\n\n‸**bold** start.\n\nEnd *b*.",
    [DEAD_ACUTE, E],
    "Intro *a*.\n\né**bold** start.\n\nEnd *b*.",
  ],
  [
    "end of a block, next to a rendered one",
    "*a* b‸\n\n*c* d",
    [DEAD_ACUTE, E, SPACE, X],
    "*a* bé x\n\n*c* d",
  ],
  [
    "list item, at the marker",
    "Intro *a*.\n\n- ‸*item*\n- *other*",
    [DEAD_ACUTE, E],
    "Intro *a*.\n\n- é*item*\n- *other*",
  ],
  [
    "blank line between rendered paragraphs (a new paragraph)",
    "*a* one\n\n‸\n\n*b* two",
    [DEAD_ACUTE, E],
    "*a* one\n\né\n\n*b* two",
  ],
  [
    "RTL line, at the start of a hidden mark",
    "مقدمة *قصيرة*.\n\n‸**كلمة** في سطر.\n\nنهاية.",
    [DEAD_ACUTE, E],
    "مقدمة *قصيرة*.\n\né**كلمة** في سطر.\n\nنهاية.",
  ],
];

const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const press = (keys: string[]) =>
  run("uv", "run", "--quiet", "--with", "python-xlib", "python", "-I", resolve(REPO, "spikes/webview/xtest.py"), ...keys);

const port = await freePort();
const driver = await startDriver(port);
const browser = await remote({ hostname: "127.0.0.1", port, logLevel: "warn", capabilities: capabilities([]) });
let failures = 0;
try {
  await waitForApp(browser);
  await setViewport(browser, 1000, 700);
  await browser.execute(async () => {
    window.__bismillah?.setTypewriter(false);
    window.__bismillah?.setSmartPunctuation(false);
    await window.__bismillah?.changeSettings({ always_show_markdown: false });
  });
  run("setxkbmap", "-layout", "se", "-option", "");
  const id = run("xdotool", "search", "--name", "bismillah").split("\n").pop() ?? "";
  run("xdotool", "windowfocus", "--sync", id);
  for (const [label, doc, keys, expected] of CASES) {
    await browser.execute(async (d: string) => {
      const hooks = window.__bismillah;
      if (!hooks) return;
      await hooks.setDoc(d.replace("‸", ""));
      const view = hooks.view;
      view.dispatch({ selection: { anchor: d.indexOf("‸") } });
      view.focus();
      const log: string[] = [];
      (window as unknown as { __composition: string[] }).__composition = log;
      for (const type of ["compositionstart", "compositionend"]) {
        view.contentDOM.addEventListener(type, () => log.push(type));
      }
    }, doc);
    await settle(browser);
    press(keys);
    await sleep(250);
    await settle(browser);
    const result = await browser.execute(() => {
      const view = window.__bismillah?.view;
      if (!view) return null;
      const head = view.state.selection.main.head;
      const { node } = view.domAtPos(head);
      const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
      return {
        text: view.state.doc.toString(),
        events: (window as unknown as { __composition: string[] }).__composition,
        revealed: line?.textContent === view.state.doc.lineAt(head).text,
      };
    });
    const ok =
      !!result &&
      result.text === expected &&
      result.revealed &&
      result.events.includes("compositionstart") &&
      result.events.includes("compositionend");
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(result?.text)} events=${result?.events.join(",")} revealed=${result?.revealed}`,
    );
  }
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
}
process.exitCode = failures ? 1 : 0;
