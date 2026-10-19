#!/usr/bin/env node
/**
 * The performance budgets of ARCHITECTURE.md §14, measured in the real app. Runs
 * headless (scripts/headless.sh), never on the author's desktop.
 *
 *   pnpm perf [-- --binary target/release/bismillah] [--runs 10] [--idle 60]
 *             [--parts launch,typing,idle]
 *
 * 1. Launch to an editable caret: from the process's start to the `bismillah:editable`
 *    mark (the document is in the editor, which has focus), for a short document with no
 *    library and in a remembered library of 1,000 files, and a 50,000-word one. The
 *    first launch reads the binary from disk; the rest are warm.
 * 2. Typing: keys typed in bursts with pauses between them, so the word count, saving
 *    and checking run as they do for a writer, in a short document and in a 1 MB book
 *    (in prose, and on a line with code). For each key, the time from the key to the
 *    end of the next painted frame; and the frames longer than two refresh intervals.
 * 3. Idle: the CPU time of the app's processes (bismillah and WebKit's) over a quiet
 *    minute with the library open, once everything has settled, and their memory.
 *
 * Measures the release build by default (`pnpm tauri build --no-bundle`), as installed.
 * Under the harness no window has focus, so the caret doesn't blink (a focused window's
 * caret repaints about twice a second).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { remote } from "webdriverio";
import { freePort, REPO, startDriver } from "../tests/driver.ts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    binary: { type: "string", default: resolve(REPO, "target/release/bismillah") },
    runs: { type: "string", default: "10" },
    idle: { type: "string", default: "60" },
    parts: { type: "string", default: "launch,typing,idle" },
    out: { type: "string" },
  },
});

const binary = resolve(values.binary);
const runs = Number(values.runs);
const idleSeconds = Number(values.idle);
const parts = new Set(values.parts.split(","));

// ---------------------------------------------------------------------------------------
// Documents.

const body = (path: string) =>
  readFileSync(resolve(REPO, path), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
const SOURCE = `${body("docs/guide.md")}\n${body("docs/specimen.md")}\n`;

/** A document of chapters made from the guide and the specimen, at least `bytes` long. */
function book(bytes: number): string {
  const parts = ["---\ntitle: A long book\nlang: en\n---\n"];
  let size = parts[0]?.length ?? 0;
  for (let chapter = 1; size < bytes; chapter++) {
    const part = `\n# Chapter ${chapter}\n\n${SOURCE}`;
    parts.push(part);
    size += Buffer.byteLength(part);
  }
  return parts.join("");
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

function wordsBook(target: number): string {
  let text = book(0);
  while (words(text) < target) text += `\n# Part\n\n${SOURCE}`;
  return text;
}

// ---------------------------------------------------------------------------------------
// Processes.

const TICK_MS = 10; // getconf CLK_TCK = 100

/** When a process started, in ms since the epoch (to within a tick). */
function startedAt(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const startTicks = Number(fields[19]);
  const now = Date.now();
  const uptime = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  return now - (uptime * 1000 - startTicks * TICK_MS);
}

/** The process and every process below it (WebKit's web and network processes). */
function family(pid: number): number[] {
  const parents = new Map<number, number>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      parents.set(Number(entry), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
    } catch {
      // Gone since it was listed.
    }
  }
  const out = [pid];
  for (let i = 0; i < out.length; i++)
    for (const [child, parent] of parents) if (parent === out[i]) out.push(child);
  return out;
}

/** CPU time (user + system) of the processes, in ms. */
function cpuMs(pids: number[]): number {
  let ticks = 0;
  for (const pid of pids) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      ticks += Number(fields[11]) + Number(fields[12]);
    } catch {
      // Exited.
    }
  }
  return ticks * TICK_MS;
}

/** Resident memory of the processes, in MiB. */
function rssMiB(pids: number[]): number {
  let kib = 0;
  for (const pid of pids) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      kib += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    } catch {
      // Exited.
    }
  }
  return Math.round(kib / 1024);
}

// ---------------------------------------------------------------------------------------
// Statistics.

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[at] ?? NaN;
}
const ms = (n: number) => `${Math.round(n)} ms`;

// ---------------------------------------------------------------------------------------
// The app.

const port = await freePort();
const driver = await startDriver(port);
const scratch = mkdtempSync(join(tmpdir(), "bismillah-perf-"));

async function launch(doc: string) {
  const browser = await remote({
    hostname: "127.0.0.1",
    port,
    logLevel: "error",
    capabilities: { "tauri:options": { application: binary, args: [doc] } } as never,
  });
  // Not the e2e suite's waitForApp: it parses the whole document and waits for checking.
  await browser.waitUntil(
    () => browser.execute(() => document.documentElement.dataset.ready === "true"),
    { timeout: 60_000, interval: 20, timeoutMsg: "the app never became ready" },
  );
  const probe = await browser.execute(async () => {
    const at = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? null;
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    return {
      origin: performance.timeOrigin,
      // Since the page began loading: its script ran, then the editor was ready.
      script: nav?.domInteractive ?? null,
      editable: at("bismillah:editable"),
      pid: (await window.__bismillah?.pid()) ?? null,
    };
  });
  if (probe.editable === null || !probe.pid) throw new Error("no editable mark or pid");
  const start = startedAt(probe.pid);
  return {
    browser,
    pid: probe.pid,
    launchMs: probe.origin + probe.editable - start,
    // Where the time goes: the window and webview, the page's script, then the start
    // (settings, the document from Rust, the first fonts, the editor).
    stages: {
      webview: probe.origin - start,
      script: probe.script ?? NaN,
      start: probe.editable - (probe.script ?? NaN),
    },
  };
}

/** Resident memory of the app's processes, each named, then the sum. */
function memory(pid: number): string {
  const pids = family(pid);
  const each = pids.map((p) => {
    const name = readFileSync(`/proc/${p}/comm`, "utf8").trim();
    return `${name} ${rssMiB([p])}`;
  });
  return `${rssMiB(pids)} MiB resident (${each.join(", ")})`;
}

/**
 * Types eight bursts of a phrase at the end of the paragraph holding `needle` (its first
 * occurrence after the document's middle), with pauses that let saving, checking and
 * the word count run, and returns each key's time to the end of the next painted frame
 * and the frame intervals while typing.
 */
async function typeIn(browser: WebdriverIO.Browser, needle: string) {
  await browser.execute((n: string) => {
    const view = window.__bismillah?.view;
    if (!view) return;
    const text = view.state.doc.toString();
    const found = text.indexOf(n, Math.floor(text.length / 2));
    const at = text.indexOf("\n", found >= 0 ? found : text.indexOf(n));
    view.focus();
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  }, needle);
  await browser.execute(() => {
    const perf = { frames: [] as number[], keys: [] as number[], typing: [0, 0] };
    (window as unknown as { __perf: typeof perf }).__perf = perf;
    const loop = (t: number) => {
      perf.frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.addEventListener(
      "keydown",
      (event) => {
        const start = event.timeStamp;
        // After the next frame is painted: a message posted from its animation frame.
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => perf.keys.push(performance.now() - start);
          channel.port2.postMessage(null);
        });
      },
      true,
    );
  });
  const mark = (i: 0 | 1) =>
    browser.execute((n: number) => {
      (window as unknown as { __perf: { typing: number[] } }).__perf.typing[n] = performance.now();
    }, i);
  await mark(0);
  for (let burst = 0; burst < 8; burst++) {
    for (const key of " and the sentences find their order") await browser.keys(key);
    await browser.pause(700);
  }
  await mark(1);
  return browser.execute(() => {
    const perf = (
      window as unknown as { __perf: { frames: number[]; keys: number[]; typing: number[] } }
    ).__perf;
    const [from = 0, to = 0] = perf.typing;
    const frames = perf.frames.filter((t) => t >= from && t <= to);
    const intervals = frames.slice(1).map((t, i) => t - (frames[i] ?? t));
    return { keys: perf.keys, intervals };
  });
}

const results: Record<string, unknown> = { binary, date: new Date().toISOString() };
const lines: string[] = [];

try {
  // 1. Launch.
  const short = join(scratch, "letter.md");
  writeFileSync(short, `# A letter\n\n${body("docs/specimen.md").slice(0, 4000)}\n`);
  mkdirSync(join(scratch, "Book"));
  const long = join(scratch, "Book", "fifty-thousand-words.md");
  const longText = wordsBook(50_000);
  writeFileSync(long, longText);
  // A library as a writer keeps one: 1,000 files in 40 folders, two levels deep. The
  // first launch opens it, so the others start with it remembered, as the writer's do.
  const library = join(scratch, "Writing");
  for (let folder = 0; folder < 40; folder++) {
    const dir = join(library, `Part ${folder + 1}`, folder % 2 ? "Drafts" : "Notes");
    mkdirSync(dir, { recursive: true });
    for (let file = 0; file < 25; file++) {
      writeFileSync(join(dir, `Chapter ${file + 1}.md`), `# Chapter ${file + 1}\n\nText.\n`);
    }
  }
  const inLibrary = join(library, "letter.md");
  writeFileSync(inLibrary, readFileSync(short, "utf8"));
  if (parts.has("idle") && !parts.has("launch")) {
    const { browser } = await launch(library);
    await browser.deleteSession();
  }
  // A document alone in its folder, with nothing remembered: no library to list.
  const alone = join(scratch, "Alone");
  mkdirSync(alone);
  const lone = join(alone, "letter.md");
  writeFileSync(lone, readFileSync(short, "utf8"));
  const remembered = join(process.env.XDG_DATA_HOME ?? "", "bismillah", "state.json");
  for (const [name, doc, fresh] of !parts.has("launch")
    ? []
    : ([
        ["a short document, no library", lone, true],
        ["a short document in a library of 1,000 files", inLibrary, false],
        [`a ${words(longText).toLocaleString("en")}-word document, no library`, long, true],
      ] as const)) {
    const times: number[] = [];
    const stages: Record<string, number[]> = {};
    for (let i = 0; i < runs; i++) {
      if (fresh) rmSync(remembered, { force: true });
      else if (i === 0) await (await launch(library)).browser.deleteSession();
      const { browser, launchMs, stages: s } = await launch(doc);
      times.push(launchMs);
      if (i > 0) for (const [k, v] of Object.entries(s)) (stages[k] ??= []).push(v);
      await browser.deleteSession();
    }
    const [first = NaN, ...warm] = times;
    results[`launch: ${name}`] = { first, warm, stages };
    lines.push(
      `  stages (warm medians): ${Object.entries(stages)
        .map(([k, v]) => `${k} ${ms(quantile(v, 0.5))}`)
        .join(", ")}`,
    );
    lines.push(
      `Launch to an editable caret, ${name}: first ${ms(first)}; then median ${ms(quantile(warm, 0.5))}, slowest ${ms(Math.max(...warm))} (${warm.length} launches)`,
    );
  }

  // 2. Typing: in a short document, then in a 1 MB book, in prose (the usual case) and
  // on a line with code (where live preview draws its tables and images again).
  if (parts.has("typing")) {
    const big = join(scratch, "one-megabyte.md");
    const bigText = book(1024 * 1024);
    writeFileSync(big, bigText);
    const size = `${(Buffer.byteLength(bigText) / 1048576).toFixed(2)} MB (${words(bigText).toLocaleString("en")} words)`;
    for (const [name, doc, needle] of [
      ["a short document, prose", short, "The page fills slowly"],
      [`${size}, prose`, big, "The page fills slowly"],
      [`${size}, a line with code`, big, "The menu bar"],
    ] as const) {
      const { browser, pid } = await launch(doc);
      const typed = await typeIn(browser, needle);
      const refresh = quantile(typed.intervals, 0.5);
      const long = typed.intervals.filter((i) => i > 2 * refresh);
      results[`typing: ${name}`] = { keyToFrame: typed.keys, refresh, longFrames: long };
      lines.push(
        `Typing in ${name}, ${typed.keys.length} keys: key to painted frame median ${ms(quantile(typed.keys, 0.5))}, p95 ${ms(quantile(typed.keys, 0.95))}, slowest ${ms(Math.max(...typed.keys))}; frames over two refresh intervals (${ms(2 * refresh)}): ${long.length} of ${typed.intervals.length}`,
      );
      if (doc === big && needle === "The menu bar")
        lines.push(`Memory with the 1 MB document open: ${memory(pid)}`);
      await browser.deleteSession();
    }
  }

  // 3. Idle, with the short document in its library of 1,000 files, once checking has
  // settled.
  if (parts.has("idle")) {
    const { browser: idle, pid: idlePid } = await launch(inLibrary);
    await idle.execute(async () => {
      await window.__bismillah?.lintSettled(30_000);
    });
    await idle.pause(5000);
    const pids = family(idlePid);
    const before = cpuMs(pids);
    await idle.pause(idleSeconds * 1000);
    const used = cpuMs(pids) - before;
    results.idle = {
      seconds: idleSeconds,
      cpuMs: used,
      processes: pids.length,
      rssMiB: rssMiB(pids),
    };
    lines.push(
      `Idle for ${idleSeconds} s with a library of 1,000 files (${pids.length} processes): ${used} ms of CPU; ${memory(idlePid)}`,
    );
    await idle.deleteSession();
  }
} finally {
  driver.kill();
  rmSync(scratch, { recursive: true, force: true });
}

if (values.out) writeFileSync(values.out, JSON.stringify(results, null, 2));
console.log(`\nPerformance (${binary.replace(`${REPO}/`, "")})`);
for (const line of lines) console.log(`  ${line}`);
