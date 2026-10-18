#!/usr/bin/env node
/**
 * Arabic rendering check: does WebKitGTK put each vocalised word's ink where HarfBuzz
 * says it belongs? Catches WebKit bug 255972 (marks and words drawn at the wrong height
 * for some Arabic fonts) on the fonts bismillah bundles.
 *
 *   scripts/headless.sh node spikes/webview/arabic-rendering.ts [--out dir]
 *
 * For every font it renders each vocalised word from the specimen and the Qur'an
 * fixtures in its own span, as the editor does (white-space: pre-wrap), reads the ink
 * box from the screenshot, and compares the ink's top and bottom (relative to the
 * baseline) with arabic_reference.py. A word is wrong when either edge is off by more
 * than 8% of the font size; that is far beyond hinting and anti-aliasing noise, and
 * well below the error of a mark on the wrong side of a letter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { remote } from "webdriverio";
import { setViewport, waitForApp } from "../../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../../tests/driver.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { out: { type: "string", default: resolve(REPO, "target/arabic-rendering") } },
});
mkdirSync(values.out, { recursive: true });

const SIZE = 40;
const FONTS: [family: string, file: string][] = [
  ["IBM Plex Sans Arabic", "fonts/source/ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.ttf"],
  ["Amiri", "fonts/source/amiri/Amiri-Regular.ttf"],
  ["Amiri Quran", "fonts/source/amiri/AmiriQuran.ttf"],
];

// Vocalised words from the specimen and the Qur'an fixtures.
const VOCALISED = /[\u064B-\u0652\u0670\u06D6-\u06ED]/u;
const sources = [
  "docs/specimen.md",
  "tests/fixtures/profiles.md",
  "tests/fixtures/quran/tanzil-uthmani.txt",
  "tests/fixtures/quran/qurancom-qpc-hafs.txt",
];
const words = [
  ...new Set(
    sources
      .flatMap((p) => readFileSync(resolve(REPO, p), "utf8").split(/[\s|]+/u))
      .map((w) => w.replace(/[^\u0600-\u06FF\u08A0-\u08FF]/gu, ""))
      .filter((w) => w.length > 1 && VOCALISED.test(w)),
  ),
];
const wordsFile = resolve(values.out, "words.json");
writeFileSync(wordsFile, JSON.stringify(words));

interface Ref {
  word: string;
  top: number;
  bottom: number;
}

const port = await freePort();
const driver = await startDriver(port);
const browser = await remote({
  hostname: "127.0.0.1",
  port,
  logLevel: "warn",
  capabilities: capabilities([]),
});

const summary: string[] = [];
try {
  await waitForApp(browser);
  await setViewport(browser, 1800, 1200);
  for (const [family, file] of FONTS) {
    const refs: Ref[] = JSON.parse(
      execFileSync(
        "uv",
        [
          "run",
          "--quiet",
          "--with",
          "uharfbuzz",
          "--with",
          "fonttools",
          "python",
          "-I",
          resolve(REPO, "spikes/webview/arabic_reference.py"),
          resolve(REPO, file),
          wordsFile,
          String(SIZE),
        ],
        { encoding: "utf8" },
      ),
    );
    let wrong = 0;
    const examples: string[] = [];
    const errors: number[] = [];
    const worst: [number, string][] = [];
    // Render in pages that fit the viewport.
    for (let start = 0; start < words.length; start += 60) {
      const page = words.slice(start, start + 60);
      const boxes = await browser.execute(
        (f: string, list: string[], size: number) => {
          document.getElementById("rendering-probe")?.remove();
          const host = document.createElement("div");
          host.id = "rendering-probe";
          host.style.cssText =
            "position:fixed;inset:0;background:#fff;z-index:100;display:flex;flex-wrap:wrap;" +
            "align-content:flex-start;gap:24px 40px;padding:40px;direction:rtl";
          const out = [];
          for (const word of list) {
            const cell = document.createElement("div");
            cell.style.cssText = `font-family:'${f}';font-size:${size}px;line-height:${size * 3}px;white-space:pre-wrap;color:#000`;
            const span = document.createElement("span");
            span.lang = "ar";
            span.textContent = word;
            // A zero-height inline-block sits on the baseline.
            const mark = document.createElement("span");
            mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
            cell.append(span, mark);
            host.appendChild(cell);
            out.push({ cell, span, mark });
          }
          document.body.appendChild(host);
          return out.map(({ cell, span, mark }) => {
            const c = cell.getBoundingClientRect();
            const s = span.getBoundingClientRect();
            return {
              left: c.left,
              top: c.top,
              right: c.right,
              bottom: c.bottom,
              spanLeft: s.left,
              spanRight: s.right,
              baseline: mark.getBoundingClientRect().bottom,
            };
          });
        },
        family,
        page,
        SIZE,
      );
      await browser.pause(300);
      const shot = PNG.sync.read(Buffer.from(await browser.takeScreenshot(), "base64"));
      const scale = shot.width / 1800;
      page.forEach((word, i) => {
        const b = boxes[i];
        const ref = refs[start + i];
        if (!b || !ref) return;
        let inkTop = Infinity;
        let inkBottom = -Infinity;
        for (let y = Math.floor(b.top * scale); y < Math.ceil(b.bottom * scale); y++) {
          for (let x = Math.floor(b.left * scale); x < Math.ceil(b.right * scale); x++) {
            const k = (y * shot.width + x) * 4;
            if ((shot.data[k] ?? 255) < 128) {
              inkTop = Math.min(inkTop, y);
              inkBottom = Math.max(inkBottom, y + 1);
            }
          }
        }
        const top = b.baseline - inkTop / scale; // px above the baseline
        const bottom = b.baseline - inkBottom / scale;
        const tolerance = SIZE * 0.08;
        const error = Math.max(Math.abs(top - ref.top), Math.abs(bottom - ref.bottom)) / SIZE;
        errors.push(error);
        worst.push([error, word]);
        if (Math.abs(top - ref.top) > tolerance || Math.abs(bottom - ref.bottom) > tolerance) {
          wrong++;
          if (examples.length < 6) {
            examples.push(
              `${word} ink ${top.toFixed(1)}/${bottom.toFixed(1)} vs HarfBuzz ${ref.top}/${ref.bottom}`,
            );
          }
        }
      });
      if (start === 0) {
        writeFileSync(
          resolve(values.out, `${family.replaceAll(" ", "-")}.png`),
          PNG.sync.write(shot),
        );
      }
    }
    errors.sort((a, b) => a - b);
    const q = (f: number) => (errors[Math.floor(f * (errors.length - 1))] ?? 0).toFixed(2);
    summary.push(
      `${family}: ${wrong}/${words.length} words drawn at the wrong height; ` +
        `error in em: median ${q(0.5)}, p90 ${q(0.9)}, max ${q(1)}\n    worst: ` +
        worst
          .sort((a, b) => b[0] - a[0])
          .slice(0, 8)
          .map(([e, w]) => `${w} ${e.toFixed(2)}`)
          .join("  ") +
        (examples.length ? `\n    ${examples.join("\n    ")}` : ""),
    );
  }
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
}
console.log(summary.join("\n"));
