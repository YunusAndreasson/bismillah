#!/usr/bin/env node
/**
 * Copy as rich text, read by another X client (Phase 4).
 *
 *   scripts/headless.sh node spikes/webview/rich-text-clipboard.ts
 *
 * The e2e suite reads the clipboard back through GTK inside the app (test_clipboard);
 * this checks the platform path: read_clipboard.py, a separate X client, asks for
 * text/html and UTF8_STRING as a mail client or word processor would.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { remote } from "webdriverio";
import { waitForApp } from "../../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../../tests/driver.ts";

const read = (target: string) =>
  JSON.parse(
    execFileSync(
      "uv",
      ["run", "--quiet", "--with", "python-xlib", "python", "-I", resolve(REPO, "spikes/webview/read_clipboard.py"), target],
      { encoding: "utf8" },
    ),
  ) as string;

const port = await freePort();
const driver = await startDriver(port);
const browser = await remote({ hostname: "127.0.0.1", port, logLevel: "warn", capabilities: capabilities([]) });
let failures = 0;
try {
  await waitForApp(browser);
  await browser.execute(async () => {
    await window.__bismillah?.setDoc("Some **strong** text, ذَٰلِكَ ٱلْكِتَٰبُ, and a [link](https://e.com).\n\n- one\n");
    window.__bismillah?.run("edit.copyRich");
  });
  await browser.pause(500);
  const html = read("text/html");
  const text = read("UTF8_STRING");
  const checks: [string, boolean][] = [
    ["text/html has the strong text", html.includes("<strong>strong</strong>")],
    ["text/html has the link", html.includes('<a href="https://e.com">link</a>')],
    ["text/html keeps the Qur'anic marks", html.includes("ذَٰلِكَ ٱلْكِتَٰبُ")],
    ["text/plain is the rendered text", text === "Some strong text, ذَٰلِكَ ٱلْكِتَٰبُ, and a link.\n\n• one"],
  ];
  for (const [label, ok] of checks) {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  if (failures) console.log(JSON.stringify({ html, text }));
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
}
process.exitCode = failures ? 1 : 0;
