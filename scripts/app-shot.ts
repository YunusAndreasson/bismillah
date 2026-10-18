#!/usr/bin/env node
/**
 * Screenshots of the real app's webview, for review and design checks
 * (.claude/skills/run-app). Runs headless; never touches the author's desktop.
 *
 *   pnpm app:shot [-- options]
 *
 *   --doc <file>          document to open (default: the bundled specimen)
 *   --widths <list>       viewport widths in CSS px (default: 640,1280,1920,2560)
 *   --height <px>         viewport height (default: 1000)
 *   --themes <list>       light,dark (default: light)
 *   --profiles <list>     duo,serif,plex-arabic,amiri (default: duo)
 *   --scale <n>           writing-size multiplier (default: 1)
 *   --full                capture the whole document by scrolling and stitching
 *   --scroll-to <text>    scroll so the first line containing <text> is near the top
 *   --typewriter          keep typewriter scrolling on (off by default for shots)
 *   --library <dir>       show a copy of <dir> as the library (docked or overlay, by width)
 *   --library-file <rel>  open this file from that library instead of the specimen
 *   --out <dir>           output directory (default: <repo>/target/shots)
 *
 * Needs `pnpm app:build` first. Prints the paths of the PNGs it wrote.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { remote } from "webdriverio";
import { setViewport, settle, waitForApp } from "../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../tests/driver.ts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    doc: { type: "string" },
    widths: { type: "string", default: "640,1280,1920,2560" },
    height: { type: "string", default: "1000" },
    themes: { type: "string", default: "light" },
    profiles: { type: "string", default: "duo" },
    scale: { type: "string", default: "1" },
    full: { type: "boolean", default: false },
    "scroll-to": { type: "string" },
    typewriter: { type: "boolean", default: false },
    library: { type: "string" },
    "library-file": { type: "string" },
    out: { type: "string", default: resolve(REPO, "target/shots") },
  },
});

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const widths = list(values.widths).map(Number);
const height = Number(values.height);
const outDir = resolve(values.out);
mkdirSync(outDir, { recursive: true });

const port = await freePort();
const driver = await startDriver(port);
const args = values.doc ? [resolve(values.doc)] : [];
const browser = await remote({
  hostname: "127.0.0.1",
  port,
  logLevel: "warn",
  capabilities: capabilities(args),
});

async function shoot(): Promise<PNG> {
  return PNG.sync.read(Buffer.from(await browser.takeScreenshot(), "base64"));
}

/** Scrolls through the document and stitches the viewports into one image. */
async function shootFull(): Promise<PNG> {
  const [scrollHeight, clientHeight] = await browser.execute(() => {
    const s = window.__bismillah?.view.scrollDOM;
    return [s?.scrollHeight ?? 0, s?.clientHeight ?? 0];
  });
  const first = await shoot();
  const ratio = first.height / clientHeight;
  const out = new PNG({ width: first.width, height: Math.round(scrollHeight * ratio) });
  for (let top = 0; top < scrollHeight; top += clientHeight) {
    const actual = await browser.execute((y: number) => {
      const s = window.__bismillah?.view.scrollDOM;
      if (!s) return 0;
      s.scrollTop = y;
      return s.scrollTop;
    }, top);
    await settle(browser);
    const shot = await shoot();
    const destY = Math.round(actual * ratio);
    const rows = Math.min(shot.height, out.height - destY);
    PNG.bitblt(shot, out, 0, 0, shot.width, rows, 0, destY);
    if (actual + clientHeight >= scrollHeight) break;
  }
  return out;
}

// The library is a scratch copy, so screenshots never touch the original.
const scratch = values.library ? mkdtempSync(join(tmpdir(), "bismillah-shot-")) : null;
if (scratch && values.library) cpSync(resolve(values.library), scratch, { recursive: true });

/** Shows the library at this width, docked or as the overlay. */
async function showLibrary(): Promise<void> {
  await browser.execute(async () => {
    const hooks = window.__bismillah;
    await hooks?.measure();
    if (!hooks?.library().visible) hooks?.run("view.toggleLibrary");
    await hooks?.settle();
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

const written: string[] = [];
try {
  await waitForApp(browser);
  if (scratch) {
    await browser.execute(async (dir: string) => {
      await window.__bismillah?.setLibrary(dir);
    }, scratch);
    if (values["library-file"]) {
      await browser.execute(
        async (path: string) => {
          await window.__bismillah?.open(path);
        },
        join(scratch, values["library-file"]),
      );
    }
  }
  await browser.execute(
    (typewriter: boolean, scale: number) => {
      const hooks = window.__bismillah;
      hooks?.setTypewriter(typewriter);
      hooks?.view.contentDOM.blur();
      void hooks?.setScale(scale);
    },
    values.typewriter,
    Number(values.scale),
  );
  for (const profile of list(values.profiles)) {
    await browser.execute(async (p: string) => {
      await window.__bismillah?.setProfile(p as "duo");
    }, profile);
    for (const theme of list(values.themes)) {
      await browser.execute((t: string) => window.__bismillah?.setTheme(t as "light"), theme);
      for (const width of widths) {
        await setViewport(browser, width, height);
        if (scratch) await showLibrary();
        if (values["scroll-to"]) {
          await browser.execute((needle: string) => {
            const view = window.__bismillah?.view;
            if (!view) return;
            const index = view.state.doc.toString().indexOf(needle);
            if (index < 0) return;
            const block = view.lineBlockAt(index);
            view.scrollDOM.scrollTop = Math.max(0, block.top - 40);
          }, values["scroll-to"]);
        } else {
          await browser.execute(() => {
            const s = window.__bismillah?.view.scrollDOM;
            if (s) s.scrollTop = 0;
          });
        }
        await settle(browser);
        const png = values.full ? await shootFull() : await shoot();
        const suffix = `${scratch ? "-library" : ""}${values.full ? "-full" : ""}`;
        const name = `${profile}-${theme}-${width}${suffix}.png`;
        const path = resolve(outDir, name);
        writeFileSync(path, PNG.sync.write(png));
        written.push(path);
      }
    }
  }
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
for (const path of written) console.log(path);
