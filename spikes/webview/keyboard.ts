#!/usr/bin/env node
/**
 * Phase 0 keyboard-input spike: XKB layout switching (Swedish ↔ Arabic), dead keys and
 * compose sequences typed into the real editor through the X11/GTK input path.
 *
 *   scripts/headless.sh node spikes/webview/keyboard.ts
 *
 * Keys are raw keycodes sent with XTEST (xtest.py) to the private X server, so XKB and
 * GTK's input method do all the work, as with a physical keyboard. xdotool can't be used
 * here: it resets the XKB group on every key. The layout mirrors the author's (Swedish,
 * with a Compose key) plus Arabic; Caps Lock switches layouts and Right Alt composes.
 * Each case starts from an empty document in the Swedish layout (a case that leaves
 * Arabic selected is followed by one more Caps Lock; setxkbmap doesn't reset the group).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { remote } from "webdriverio";
import { setViewport, waitForApp } from "../../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../../tests/driver.ts";

const CAPS = "66"; // switches layout
const COMPOSE = "108"; // Right Alt
const LEVEL3 = "135"; // Menu key as AltGr
const CASES: [label: string, keys: string[], expected: string][] = [
  ["Swedish letters å ä ö", ["34", "48", "47"], "åäö"],
  ["dead acute + e", ["21", "26"], "é"],
  ["dead grave (Shift+´) + u", ["50+21", "30"], "ù"],
  ["dead circumflex (Shift+¨) + a", ["50+35", "38"], "â"],
  ["Compose - a", [COMPOSE, "61", "38"], "ā"],
  ["Compose a a", [COMPOSE, "38", "38"], "å"],
  ["AltGr+2 (menu stays closed)", [`${LEVEL3}+11`], "@"],
  ["switch to Arabic: h j k l", [CAPS, "43", "44", "45", "46"], "اتنم"],
  ["switch mid-word: Arabic, space, Latin", [CAPS, "43", "65", "44", CAPS, "43"], "ا تh"],
  ["Arabic, back to Swedish, dead acute + e", [CAPS, "45", CAPS, "21", "26"], "نé"],
  ["dead key, then a layout switch", ["21", CAPS], "´"],
];

const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const resetLayout = () =>
  run("setxkbmap", "-layout", "se,ara", "-option", "", "-option", "grp:caps_toggle,compose:ralt,lv3:menu_switch");
const press = (keys: string[]) =>
  run("uv", "run", "--quiet", "--with", "python-xlib", "python", "-I", resolve(REPO, "spikes/webview/xtest.py"), ...keys);

const port = await freePort();
const driver = await startDriver(port);
const browser = await remote({ hostname: "127.0.0.1", port, logLevel: "warn", capabilities: capabilities([]) });
let failures = 0;
try {
  await waitForApp(browser);
  await setViewport(browser, 1000, 700);
  await browser.execute(() => window.__bismillah?.setTypewriter(false));
  const id = run("xdotool", "search", "--name", "bismillah").split("\n").pop() ?? "";
  run("xdotool", "windowfocus", "--sync", id);
  for (const [label, keys, expected] of CASES) {
    resetLayout();
    await browser.execute(async () => {
      await window.__bismillah?.setDoc("");
      window.__bismillah?.view.focus();
    });
    press(keys);
    await sleep(200);
    const [text, menuOpen] = await browser.execute(async () => [
      window.__bismillah?.view.state.doc.toString() ?? "",
      (await window.__bismillah?.menuState())?.visible ?? false,
    ]);
    if (keys.filter((k) => k === CAPS).length % 2 === 1) press([CAPS]);
    const ok = text === expected && !menuOpen;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(text)}${menuOpen ? " (menu opened)" : ""}`);
  }
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
}
process.exitCode = failures ? 1 : 0;
