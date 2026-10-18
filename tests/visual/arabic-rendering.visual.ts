import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { PNG } from "pngjs";
import { setViewport, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";

/**
 * Arabic rendering check (ADR-0011): does WebKitGTK put each vocalised word's ink where
 * HarfBuzz says it belongs? WebKitGTK 2.54 drops the vertical offsets of Arabic marks
 * (WebKit bug 255972), so some words are drawn wrong; this test keeps count, per font.
 *
 * Every vocalised word of the specimen and the Qur'an fixtures is rendered in its own
 * span, as the editor renders text (`white-space: pre-wrap`). The ink's top and bottom,
 * read from a screenshot and measured from the baseline, are compared with the HarfBuzz
 * reference in tests/fixtures/arabic-rendering-reference.json (regenerate it with
 * tests/visual/tools/arabic_reference.py). A word's error is its larger edge difference,
 * in em; a word is "off" above 0.08 em, far beyond anti-aliasing and well below a mark on
 * the wrong side of a letter.
 *
 * The errors measured today are recorded in tests/visual/baselines/arabic-rendering.json.
 * The test fails when a word gets worse or more words are off (a regression), and passes
 * with a note when words improve: a WebKitGTK fix, and the moment to revisit ADR-0011.
 * Run with UPDATE_BASELINES=1 to record new numbers, and review the diff before
 * committing it.
 */

const OFF = 0.08;
/** Rendering is deterministic on one machine; this absorbs a pixel of rounding. */
const GROWTH = 0.02;
const VIEWPORT = { width: 1800, height: 1200 };

interface Reference {
  size: number;
  words: string[];
  fonts: { family: string; file: string; sha256: string; ink: { top: number; bottom: number }[] }[];
}

interface Expected {
  note: string;
  off: number;
  fonts: Record<string, { off: number; errors: Record<string, number> }>;
}

const referencePath = resolve(REPO, "tests/fixtures/arabic-rendering-reference.json");
const expectedPath = resolve(REPO, "tests/visual/baselines/arabic-rendering.json");
const reference = JSON.parse(readFileSync(referencePath, "utf8")) as Reference;
const updating = process.env.UPDATE_BASELINES === "1";
const recorded: Expected = {
  note:
    "Per-word ink error in em against HarfBuzz (ADR-0011). Written by " +
    "tests/visual/arabic-rendering.visual.ts with UPDATE_BASELINES=1.",
  off: OFF,
  fonts: {},
};

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  baseline: number;
}

/** Lays out one page of words in `family` over the app and returns each cell's box. */
async function layOut(family: string, words: string[], size: number): Promise<Box[]> {
  return browser.execute(
    (f: string, list: string[], px: number) => {
      document.getElementById("rendering-probe")?.remove();
      const host = document.createElement("div");
      host.id = "rendering-probe";
      host.style.cssText =
        "position:fixed;inset:0;background:#fff;z-index:100;display:flex;flex-wrap:wrap;" +
        "align-content:flex-start;gap:24px;padding:40px;direction:rtl";
      const cells = list.map((word) => {
        const cell = document.createElement("div");
        cell.style.cssText = `font-family:'${f}';font-size:${px}px;line-height:${px * 3}px;white-space:pre-wrap;color:#000`;
        const span = document.createElement("span");
        span.lang = "ar";
        span.textContent = word;
        // A zero-height inline-block sits on the baseline.
        const mark = document.createElement("span");
        mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        cell.append(span, mark);
        host.appendChild(cell);
        return { cell, mark };
      });
      document.body.appendChild(host);
      return cells.map(({ cell, mark }) => {
        const c = cell.getBoundingClientRect();
        return {
          left: c.left,
          top: c.top,
          right: c.right,
          bottom: c.bottom,
          baseline: mark.getBoundingClientRect().bottom,
        };
      });
    },
    family,
    words,
    size,
  );
}

/** Ink top and bottom of each cell, in CSS px above the baseline (y up). */
function inkOf(shot: PNG, boxes: Box[]): { top: number; bottom: number }[] {
  const scale = shot.width / VIEWPORT.width;
  return boxes.map((b) => {
    let inkTop = Infinity;
    let inkBottom = -Infinity;
    for (let y = Math.floor(b.top * scale); y < Math.ceil(b.bottom * scale); y++) {
      for (let x = Math.floor(b.left * scale); x < Math.ceil(b.right * scale); x++) {
        if ((shot.data[(y * shot.width + x) * 4] ?? 255) < 128) {
          inkTop = Math.min(inkTop, y);
          inkBottom = Math.max(inkBottom, y + 1);
        }
      }
    }
    return { top: b.baseline - inkTop / scale, bottom: b.baseline - inkBottom / scale };
  });
}

function summary(family: string, errors: Record<string, number>): string {
  const sorted = Object.values(errors).sort((a, b) => a - b);
  const q = (f: number) => (sorted[Math.floor(f * (sorted.length - 1))] ?? 0).toFixed(2);
  const off = sorted.filter((e) => e > OFF).length;
  const worst = Object.entries(errors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w, e]) => `${w} ${e.toFixed(2)}`)
    .join("  ");
  return (
    `${family}: ${off}/${sorted.length} words off by > ${OFF} em; ` +
    `median ${q(0.5)}, p90 ${q(0.9)}, max ${q(1)} em; worst: ${worst}`
  );
}

describe("Arabic rendering against HarfBuzz (ADR-0011)", () => {
  const expected: Expected | null = existsSync(expectedPath)
    ? (JSON.parse(readFileSync(expectedPath, "utf8")) as Expected)
    : null;

  before(async () => {
    await waitForApp(browser);
    await setViewport(browser, VIEWPORT.width, VIEWPORT.height);
  });

  after(async () => {
    await browser.execute(() => document.getElementById("rendering-probe")?.remove());
    if (updating) writeFileSync(expectedPath, `${JSON.stringify(recorded, null, 1)}\n`);
  });

  for (const font of reference.fonts) {
    it(`draws ${font.family} no worse than recorded`, async () => {
      const sha = createHash("sha256")
        .update(readFileSync(resolve(REPO, font.file)))
        .digest("hex");
      if (sha !== font.sha256) {
        throw new Error(
          `${font.file} changed since the HarfBuzz reference was made; regenerate it with ` +
            "tests/visual/tools/arabic_reference.py (see its docstring).",
        );
      }

      const size = reference.size;
      const errors: Record<string, number> = {};
      let firstShot: PNG | null = null;
      // Screenshots dominate the run time, so each page holds as many words as fit.
      let start = 0;
      while (start < reference.words.length) {
        const rest = reference.words.slice(start);
        const laidOut = await layOut(font.family, rest, size);
        const overflow = laidOut.findIndex((b) => b.bottom > VIEWPORT.height || b.left < 0);
        if (overflow === 0) throw new Error("not even one word fits the viewport");
        const fits = overflow < 0 ? rest.length : overflow;
        const words = rest.slice(0, fits);
        const boxes = laidOut.slice(0, fits);
        await browser.pause(300);
        const shot = PNG.sync.read(Buffer.from(await browser.takeScreenshot(), "base64"));
        firstShot ??= shot;
        inkOf(shot, boxes).forEach((ink, i) => {
          const word = words[i];
          const ref = font.ink[start + i];
          if (word === undefined || !ref) return;
          const error = Math.max(Math.abs(ink.top - ref.top), Math.abs(ink.bottom - ref.bottom));
          errors[word] = Math.round((error / size) * 1000) / 1000;
        });
        start += fits;
      }
      const off = Object.values(errors).filter((e) => e > OFF).length;
      recorded.fonts[font.family] = { off, errors };
      console.log(summary(font.family, errors));
      if (updating) return;

      const before = expected?.fonts[font.family];
      if (!before) {
        throw new Error(`No recorded errors for ${font.family}. Run with UPDATE_BASELINES=1.`);
      }
      const worse: string[] = [];
      const better: string[] = [];
      for (const [word, error] of Object.entries(errors)) {
        const was = before.errors[word];
        if (was === undefined) worse.push(`${word} (not recorded)`);
        else if (error > was + GROWTH) worse.push(`${word} ${was} → ${error}`);
        else if (error < was - GROWTH) better.push(`${word} ${was} → ${error}`);
      }
      if (better.length > 0 || off < before.off) {
        console.log(
          `NOTE (ADR-0011): ${font.family} renders closer to HarfBuzz than recorded ` +
            `(${before.off} → ${off} words off; ${better.length} improved, e.g. ` +
            `${better.slice(0, 5).join(", ")}). WebKitGTK may have fixed bug 255972: ` +
            "revisit ADR-0011, then record the new numbers with UPDATE_BASELINES=1.",
        );
      }
      if (worse.length > 0 || off > before.off) {
        const out = resolve(REPO, "target/visual");
        mkdirSync(out, { recursive: true });
        const name = `arabic-rendering-${font.family.replaceAll(" ", "-")}.png`;
        if (firstShot) writeFileSync(resolve(out, name), PNG.sync.write(firstShot));
        console.log(
          `${font.family} renders worse than recorded (${before.off} → ${off} words off): ` +
            `${worse.slice(0, 10).join(", ")}. First page: target/visual/${name}`,
        );
      }
      expect(worse).toEqual([]);
      expect(off).toBeLessThanOrEqual(before.off);
    });
  }
});
