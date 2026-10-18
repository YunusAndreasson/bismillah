#!/usr/bin/env node
/**
 * Phase 0 font-profile spike: measures each writing profile in the real webview.
 *
 *   scripts/headless.sh node spikes/webview/measure-profiles.ts [profile] [--var=value…]
 *
 * Extra arguments set CSS custom properties first, to try candidate values, e.g.
 *   … serif --doc-measure=30em --doc-arabic-scale=1.05
 *
 * For each profile it loads tests/fixtures/profiles.md and reports, per paragraph:
 * characters per full visual row, the column width, the row pitch (distance between
 * row tops), and the ink clearance between rows: the gap between one row's lowest
 * ink and the next row's highest ink, from canvas text metrics in the same font.
 * A negative clearance means marks on adjacent rows can touch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { remote } from "webdriverio";
import { setViewport, waitForApp } from "../../tests/app.ts";
import { capabilities, freePort, REPO, startDriver } from "../../tests/driver.ts";

const doc = readFileSync(resolve(REPO, "tests/fixtures/profiles.md"), "utf8");
const args = process.argv.slice(2);
const overrides = args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("="));
const only = args.filter((a) => !a.startsWith("--"));
const port = await freePort();
const driver = await startDriver(port);
const browser = await remote({
  hostname: "127.0.0.1",
  port,
  logLevel: "warn",
  capabilities: capabilities([]),
});

interface Row {
  top: number;
  baselines: number[];
  chars: number;
  /** Highest and lowest ink on the row (viewport y). */
  inkTop: number;
  inkBottom: number;
}

try {
  await waitForApp(browser);
  await setViewport(browser, 1600, 1200);
  await browser.execute(async (t: string) => {
    window.__bismillah?.setTypewriter(false);
    window.__bismillah?.setBasmallah(false);
    await window.__bismillah?.setDoc(t);
  }, doc);
  const profiles = only.length ? only : ["duo", "serif", "plex-arabic", "amiri"];
  for (const profile of profiles) {
    const report = await browser.execute(async (p: string, vars: string[][]) => {
      const hooks = window.__bismillah;
      if (!hooks) return null;
      for (const [name, value] of vars) document.documentElement.style.setProperty(`--${name}`, value ?? "");
      await hooks.setProfile(p as "duo");
      const { view } = hooks;
      const canvas = document.createElement("canvas").getContext("2d");
      const out = [];
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n);
        if (!line.text.trim()) continue;
        const { node } = view.domAtPos(line.from);
        const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
        if (!el) continue;
        // Walk text nodes, grouping characters into visual rows by their rect top.
        const rows: Row[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const text = t.textContent ?? "";
          const parent = t.parentElement;
          if (!parent || !canvas) continue;
          const style = getComputedStyle(parent);
          canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          for (let i = 0; i < text.length; i++) {
            if (/\p{M}/u.test(text[i] ?? "")) continue;
            let end = i + 1;
            while (end < text.length && /\p{M}/u.test(text[end] ?? "")) end++;
            range.setStart(t, i);
            range.setEnd(t, end);
            const r = range.getClientRects()[0];
            if (!r || r.width === 0) continue;
            const m = canvas.measureText(text.slice(i, end));
            let row = rows.find((x) => Math.abs(x.top - r.top) < r.height / 2);
            if (!row) {
              row = { top: r.top, baselines: [], chars: 0, inkTop: Infinity, inkBottom: -Infinity };
              rows.push(row);
            }
            row.chars += 1;
            row.top = Math.min(row.top, r.top);
            // The inline box is the font's ascent + descent plus equal half-leading, so
            // the baseline sits at a known offset inside the client rect.
            const ascent = m.fontBoundingBoxAscent;
            const descent = m.fontBoundingBoxDescent;
            const baseline = r.top + (r.height - (ascent + descent)) / 2 + ascent;
            row.baselines.push(baseline);
            row.inkTop = Math.min(row.inkTop, baseline - m.actualBoundingBoxAscent);
            row.inkBottom = Math.max(row.inkBottom, baseline + m.actualBoundingBoxDescent);
          }
        }
        rows.sort((a, b) => a.top - b.top);
        const full = rows.slice(0, -1);
        const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
        const pitches = rows
          .slice(1)
          .map((r, i) => median(r.baselines) - median(rows[i]?.baselines ?? []));
        const clearances = rows.slice(1).map((r, i) => r.inkTop - (rows[i]?.inkBottom ?? 0));
        const lineBox = el.getBoundingClientRect();
        out.push({
          paragraph: line.text.slice(0, 24),
          rows: rows.length,
          charsPerRow: full.map((r) => r.chars),
          width: Math.round(lineBox.width),
          pitch: [Math.min(...pitches), Math.max(...pitches)].map((x) => Math.round(x * 10) / 10),
          minClearance: Math.round(Math.min(...clearances) * 10) / 10,
          fontPx: parseFloat(getComputedStyle(el).fontSize),
        });
      }
      return out;
    }, profile, overrides);
    console.log(`\n## ${profile} ${overrides.map((o) => o.join("=")).join(" ")}`);
    for (const r of report ?? []) console.log(JSON.stringify(r));
  }
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill();
}
