#!/usr/bin/env node
/**
 * Native clipboard round trips for Qur'anic text, through GTK's clipboard and WebKit.
 *
 *   scripts/headless.sh node spikes/webview/clipboard.ts
 *
 * Paste in: another X client (serve_clipboard.py) owns the clipboard with a verse, as a
 * browser would after copying from tanzil.net, and a real Ctrl+V pastes it.
 * Copy out: the verse is selected in the editor, a real Ctrl+C copies it, and
 * read_clipboard.py reads what other apps would receive.
 * Both are compared byte for byte with tests/fixtures/quran/.
 *
 * The e2e glyph tests can only dispatch a synthetic paste event, because the webview
 * refuses navigator.clipboard.writeText; this script covers the platform path.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { remote } from "webdriverio";
import { waitForApp } from "../../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../../tests/driver.ts";

const files = ["tanzil-uthmani.txt", "tanzil-uthmani-no-tatweel.txt", "qurancom-uthmani.txt", "qurancom-qpc-hafs.txt"];
const verses = files.flatMap((f) =>
  readFileSync(resolve(REPO, "tests/fixtures/quran", f), "utf8")
    .split("\n")
    .filter((l) => /^\d+\|\d+\|/.test(l))
    .map((l) => [f, l.split("|").slice(0, 2).join(":"), l.split("|").slice(2).join("|")] as const),
);
const py = (script: string, ...args: string[]) =>
  ["run", "--quiet", "--with", "python-xlib", "python", "-I", resolve(REPO, "spikes/webview", script), ...args];
const xdo = (...a: string[]) => execFileSync("xdotool", a, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scratch = mkdtempSync(join(tmpdir(), "bismillah-clip-"));

const port = await freePort();
const driver = await startDriver(port);
const browser = await remote({ hostname: "127.0.0.1", port, logLevel: "warn", capabilities: capabilities([]) });
const failed = { in: [] as string[], out: [] as string[] };
const docText = () => browser.execute(() => window.__bismillah?.view.state.doc.toString() ?? "");
const setDoc = (t: string) =>
  browser.execute(async (text: string) => {
    await window.__bismillah?.setDoc(text);
    window.__bismillah?.view.focus();
  }, t);
try {
  await waitForApp(browser);
  await browser.execute(() => window.__bismillah?.setTypewriter(false));
  xdo("windowfocus", "--sync", xdo("search", "--name", "bismillah").split("\n").pop() ?? "");
  for (const [file, key, verse] of verses) {
    // Paste in from another app.
    const source = join(scratch, "verse.txt");
    writeFileSync(source, verse);
    await setDoc("");
    const owner = spawn("uv", py("serve_clipboard.py", source), { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((ready) => owner.stdout.once("data", () => ready()));
    xdo("key", "ctrl+v");
    await sleep(200);
    owner.kill();
    if ((await docText()) !== verse) failed.in.push(`${file} ${key}`);
    // Copy out to another app.
    await setDoc(verse);
    xdo("key", "ctrl+a");
    xdo("key", "ctrl+c");
    const copied = JSON.parse(execFileSync("uv", py("read_clipboard.py"), { encoding: "utf8" })) as string;
    if (copied !== verse) failed.out.push(`${file} ${key}`);
  }
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
}
const n = verses.length;
console.log(`paste in:  ${n - failed.in.length}/${n} byte-identical ${failed.in.length ? `(failed: ${failed.in.join(", ")})` : ""}`);
console.log(`copy out:  ${n - failed.out.length}/${n} byte-identical ${failed.out.length ? `(failed: ${failed.out.length}, e.g. ${failed.out[0]})` : ""}`);
process.exitCode = failed.in.length || failed.out.length ? 1 : 0;
