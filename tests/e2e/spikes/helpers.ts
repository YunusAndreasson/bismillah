import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browser } from "@wdio/globals";
import { settle } from "../../app.ts";
import { REPO } from "../../driver.ts";
import type { Box, Cluster } from "../../../src/core/testGeometry.ts";

export const fixture = (name: string) => readFileSync(resolve(REPO, "tests/fixtures", name), "utf8");

export async function loadDoc(text: string): Promise<void> {
  await browser.execute(async (t: string) => {
    await window.__bismillah?.setDoc(t);
  }, text);
}

/** Document offset of the line containing `needle`. */
export async function lineOf(needle: string): Promise<{ from: number; to: number }> {
  const line = await browser.execute((n: string) => {
    const view = window.__bismillah?.view;
    if (!view) return null;
    const index = view.state.doc.toString().indexOf(n);
    if (index < 0) return null;
    const l = view.state.doc.lineAt(index);
    return { from: l.from, to: l.to };
  }, needle);
  if (!line) throw new Error(`no line contains ${JSON.stringify(needle)}`);
  return line;
}

export async function scrollIntoView(pos: number): Promise<void> {
  await browser.execute((p: number) => {
    const view = window.__bismillah?.view;
    if (!view) return;
    view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(p).top - 200);
  }, pos);
  await settle(browser);
}

export async function clusters(from: number, to: number): Promise<Cluster[]> {
  return browser.execute((a: number, b: number) => window.__bismillah?.geometry.clusters(a, b) ?? [], from, to);
}

export async function coords(pos: number, side: -1 | 1): Promise<Box> {
  const box = await browser.execute(
    (p: number, s: -1 | 1) => window.__bismillah?.geometry.coords(p, s) ?? null,
    pos,
    side,
  );
  if (!box) throw new Error(`no coordinates for ${pos}`);
  return box;
}

export async function lineBox(pos: number) {
  return browser.execute((p: number) => window.__bismillah?.geometry.lineBox(p), pos);
}

export async function setCursor(pos: number): Promise<void> {
  await browser.execute((p: number) => {
    const view = window.__bismillah?.view;
    view?.focus();
    view?.dispatch({ selection: { anchor: p } });
  }, pos);
  await settle(browser);
}

export async function head(): Promise<number> {
  return browser.execute(() => window.__bismillah?.view.state.selection.main.head ?? -1);
}

export async function caret() {
  return browser.execute(() => window.__bismillah?.geometry.caret() ?? null);
}

export async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  await browser.execute(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export async function click(x: number, y: number): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
  await settle(browser);
}

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
export const isRtlLetter = (s: string) => RTL.test(s) && /\p{L}/u.test(s);
export const isLtrLetter = (s: string) => !RTL.test(s) && /\p{L}/u.test(s);
