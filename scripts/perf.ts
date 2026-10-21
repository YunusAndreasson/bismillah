#!/usr/bin/env node
/**
 * The performance budgets of ARCHITECTURE.md §14, measured in the real app. Runs
 * headless (scripts/headless.sh), never on the author's desktop.
 *
 *   pnpm perf [-- --binary target/release/bismillah] [--runs 10] [--idle 60]
 *             [--parts launch,typing,editing,scrolling,wordcount,idle,caret,resources,navigation]
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
 * caret repaints about twice a second). The optional `caret` part explicitly focuses
 * the private X11 window and exercises normal blinking, then checks unfocused idle.
 * It still does not measure the native Wayland/GPU rendering path.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { remote } from "webdriverio";
import { freePort, REPO, startDriver } from "../tests/driver.ts";
import { countWords, WordCounter } from "../src/editor/wordCount.ts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    binary: { type: "string", default: resolve(REPO, "target/release/bismillah") },
    runs: { type: "string", default: "10" },
    idle: { type: "string", default: "60" },
    parts: { type: "string", default: "launch,typing,editing,scrolling,wordcount,idle" },
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
      milestones: Object.fromEntries(
        performance
          .getEntriesByType("mark")
          .filter((entry) => entry.name.startsWith("bismillah:"))
          .map((entry) => [entry.name, entry.startTime]),
      ),
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
      ...Object.fromEntries(
        Object.entries(probe.milestones).map(([name, at]) => [name, at - (probe.script ?? 0)]),
      ),
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
  // A CPU comparison in Node's Intl engine, separate from WebKit's frame timings.
  // Use the actual counters and assert identical totals for every edited document.
  if (parts.has("wordcount")) {
    const source = book(1024 * 1024);
    const counter = new WordCounter();
    counter.count(source);
    const full: number[] = [];
    const cached: number[] = [];
    for (let i = 0; i < 30; i++) {
      const edited = `${source}\nA new sentence ${i}.`;
      let start = performance.now();
      const expected = countWords(edited);
      full.push(performance.now() - start);
      start = performance.now();
      const actual = counter.count(edited);
      cached.push(performance.now() - start);
      if (expected !== actual) throw new Error("word counts differ");
    }
    results.wordcount = { engine: process.version, full, cached };
    lines.push(
      `Word count in 1 MB after edits (Node ${process.version}, not WebKit): full median ${ms(quantile(full, 0.5))}, p95 ${ms(quantile(full, 0.95))}; cached median ${ms(quantile(cached, 0.5))}, p95 ${ms(quantile(cached, 0.95))}`,
    );
  }
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

  // Measure demand-loading separately: ordinary English checking, Arabic-only
  // checking, and a session whose writer switched both checkers off. Keep the same
  // fonts/window and include the old speculative one-second checker warm-up.
  if (parts.has("resources")) {
    const configDir = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah");
    mkdirSync(configDir, { recursive: true });
    for (const [name, text, checking] of [
      ["disabled", "I will recieve it. This is a apple.", false],
      ["arabic", "الكتابةُ أمانةٌ. والكلمةُ مسؤوليةٌ.", true],
      ["english", "I will recieve it. This is a apple.", true],
    ] as const) {
      const folder = join(scratch, `resources-${name}`);
      mkdirSync(folder);
      const doc = join(folder, "letter.md");
      writeFileSync(doc, text);
      writeFileSync(
        join(configDir, "settings.toml"),
        `schema = 1\ncheck_spelling = ${checking}\ncheck_grammar = ${checking}\n`,
      );
      rmSync(remembered, { force: true });
      const { browser, pid, launchMs } = await launch(doc);
      try {
        const initialCpu = cpuMs(family(pid));
        const samples = [];
        for (let i = 0; i < 3; i++) {
          await browser.pause(5000);
          samples.push({
            seconds: (i + 1) * 5,
            rssMiB: rssMiB(family(pid)),
            mainRssMiB: rssMiB([pid]),
            cpuMs: cpuMs(family(pid)) - initialCpu,
          });
        }
        const diagnostics = await browser.execute(
          () => window.__bismillah?.diagnostics().length ?? -1,
        );
        results[`resources: ${name}`] = { launchMs, samples, diagnostics };
        lines.push(
          `Resources, ${name}: ${JSON.stringify(samples.at(-1))}; ${diagnostics} diagnostics`,
        );
      } finally {
        await browser.deleteSession();
      }
    }
    // Later parts exercise normal defaults, independently of the last scenario.
    rmSync(join(configDir, "settings.toml"), { force: true });
  }

  if (parts.has("navigation")) {
    const root = join(scratch, "Navigation");
    for (let folder = 0; folder < 40; folder++) {
      const dir = join(root, `Part ${folder}`);
      mkdirSync(dir, { recursive: true });
      for (let file = 0; file < 250; file++) {
        const name = ["notes", "ḥadīth", "سَلَام", "chapter"][file % 4] ?? "notes";
        writeFileSync(join(dir, `${name} ${file}.md`), "Text.\n");
      }
    }
    const { browser } = await launch(lone);
    try {
      await browser.execute(async (path: string) => {
        await window.__bismillah?.setLibrary(path);
        await window.__bismillah?.lintSettled(30_000);
      }, root);
      await browser.pause(3000);
      const measured = await browser.execute(async () => {
        // A MessageChannel task after rAF runs after the frame paints, as in typeIn.
        const painted = () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => {
              const channel = new MessageChannel();
              channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                done();
              };
              channel.port2.postMessage(null);
            }),
          );
        const opened: number[] = [];
        const queries: { query: string; ms: number; count: number }[] = [];
        for (let round = 0; round < 4; round++) {
          let start = performance.now();
          window.__bismillah?.run("file.quickOpen");
          await painted();
          opened.push(performance.now() - start);
          const input = document.querySelector<HTMLInputElement>(".picker-input");
          if (!input) throw new Error("quick open did not open");
          for (const query of [
            "n",
            "no",
            "not",
            "notes",
            "part",
            "hadith",
            "سلام",
            "chapter 2",
            "zzzz",
            "",
          ]) {
            start = performance.now();
            input.value = query;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await painted();
            queries.push({
              query,
              ms: performance.now() - start,
              count: document.querySelectorAll(".picker-item").length,
            });
          }
          // Escape follows the actual dialog close path, including focus return.
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await painted();
        }
        return { opened, queries };
      });
      results.navigation = measured;
      lines.push(
        `Quick open, 10,000 files: open median ${ms(quantile(measured.opened, 0.5))}; query median ${ms(
          quantile(
            measured.queries.map((q) => q.ms),
            0.5,
          ),
        )}, p95 ${ms(
          quantile(
            measured.queries.map((q) => q.ms),
            0.95,
          ),
        )}`,
      );
    } finally {
      await browser.deleteSession();
    }
  }
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

  // Isolate synchronous editing work from WebDriver latency and frame scheduling.
  // Real transactions, including preview, autosave scheduling and checking, in the
  // same book as the typing test. This is not a key-to-paint measurement.
  if (parts.has("editing") || parts.has("scrolling")) {
    const path = join(scratch, "hot-paths.md");
    writeFileSync(path, book(1024 * 1024));
    const { browser } = await launch(path);
    try {
      // The first check of a book is background work that can take minutes. Keep
      // it enabled as in normal use, but don't wait for the entire book to finish.
      await browser.pause(2000);
      if (parts.has("editing")) {
        for (const [name, needle, insert] of [
          ["prose", "The page fills slowly", "s"],
          ["inline code", "The menu bar", "s"],
          ["line break", "The page fills slowly", "\n"],
        ] as const) {
          const durations = await browser.execute(
            async (n: string, text: string) => {
              const view = window.__bismillah?.view;
              if (!view) throw new Error("no editor");
              const doc = view.state.doc.toString();
              const found = doc.indexOf(n, Math.floor(doc.length / 2));
              if (found < 0) throw new Error("benchmark paragraph missing");
              const at = doc.indexOf("\n", found);
              view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
              await new Promise<void>((done) => requestAnimationFrame(() => done()));
              const times: number[] = [];
              for (let i = 0; i < 60; i++) {
                const start = performance.now();
                view.dispatch({
                  changes: { from: at, insert: text },
                  selection: { anchor: at + text.length },
                });
                times.push(performance.now() - start);
                view.dispatch({
                  changes: { from: at, to: at + text.length },
                  selection: { anchor: at },
                });
                // Give painting and background work time between independent edits.
                await new Promise<void>((done) => requestAnimationFrame(() => done()));
              }
              return times.slice(10); // warm up each path before collecting samples
            },
            needle,
            insert,
          );
          results[`editing: ${name}`] = durations;
          lines.push(
            `Synchronous edit in 1 MB, ${name}: median ${ms(quantile(durations, 0.5))}, p95 ${ms(quantile(durations, 0.95))}`,
          );
        }
      }
      if (parts.has("scrolling")) {
        const scrolling = await browser.execute(async () => {
          const view = window.__bismillah?.view;
          if (!view) throw new Error("no editor");
          view.scrollDOM.scrollTop = 0;
          await new Promise<void>((done) => requestAnimationFrame(() => done()));
          const intervals: number[] = [];
          let last = performance.now();
          for (let i = 0; i < 180; i++) {
            view.scrollDOM.scrollTop += 120;
            const now = await new Promise<number>((done) => requestAnimationFrame(done));
            intervals.push(now - last);
            last = now;
          }
          return { intervals: intervals.slice(10), top: view.scrollDOM.scrollTop };
        });
        results.scrolling = scrolling;
        lines.push(
          `Scroll 1 MB (120 CSS px/frame), ${scrolling.intervals.length} frames: median ${ms(quantile(scrolling.intervals, 0.5))}, p95 ${ms(quantile(scrolling.intervals, 0.95))}; final offset ${scrolling.top} px`,
        );
        const reversing = await browser.execute(async () => {
          const view = window.__bismillah?.view;
          if (!view) throw new Error("no editor");
          const text = view.state.doc.toString();
          const next = () => new Promise<number>((done) => requestAnimationFrame(done));
          view.scrollDOM.scrollTop = 0;
          await next();
          await next();
          const intervals: number[] = [];
          let previous = performance.now();
          let blankFrames = 0;
          for (let i = 0; i < 240; i++) {
            view.scrollDOM.scrollTop += Math.floor(i / 40) % 2 ? -180 : 180;
            const now = await next();
            intervals.push(now - previous);
            previous = now;
            await new Promise<void>((done) => setTimeout(done, 0));
            const area = view.scrollDOM.getBoundingClientRect();
            const hit = document.elementFromPoint(
              area.left + area.width / 2,
              area.top + area.height / 2,
            );
            if (hit?.closest(".cm-gap")) blankFrames++;
          }
          if (view.state.doc.toString() !== text) throw new Error("scroll changed text");
          return { intervals: intervals.slice(10), blankFrames, frames: 240 };
        });
        results["scrolling: reversals"] = reversing;
        lines.push(
          `Reverse scroll 1 MB (180 CSS px/frame): median ${ms(quantile(reversing.intervals, 0.5))}, p95 ${ms(quantile(reversing.intervals, 0.95))}; virtual spacer at viewport centre in ${reversing.blankFrames} of ${reversing.frames} frames`,
        );
      }
    } finally {
      await browser.deleteSession();
    }
  }

  // Normal caret behaviour, separate from the deterministic steady-caret harness.
  if (parts.has("caret")) {
    const { browser, pid } = await launch(short);
    try {
      await browser.setTimeout({ script: idleSeconds * 1000 + 10_000 });
      await browser.execute(async () => {
        const hooks = window.__bismillah;
        if (!hooks || !(await hooks.lintSettled(30_000)))
          throw new Error("checking did not settle");
        hooks.blinkCaret(true);
      });
      const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(pid)], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .at(-1);
      if (!id) throw new Error("private app window not found");
      execFileSync("xdotool", ["windowfocus", "--sync", id]);
      for (const phase of ["blinking", "resting", "unfocused"] as const) {
        const focused = phase !== "unfocused";
        await browser.execute((focus: boolean) => {
          const view = window.__bismillah?.view;
          if (!view) throw new Error("no editor");
          if (focus) view.focus();
          else view.contentDOM.blur();
        }, focused);
        await browser.pause(10_000);
        if (phase === "blinking") await browser.execute(() => window.__bismillah?.blinkCaret(true));
        const pids = family(pid);
        const before = cpuMs(pids);
        const state = await browser.execute(async (seconds: number) => {
          const view = window.__bismillah?.view;
          const layer = view?.dom.querySelector(".cm-cursorLayer");
          if (!view || !layer) throw new Error("no caret layer");
          let edges = 0;
          const observer = new MutationObserver((changes) => (edges += changes.length));
          observer.observe(view.dom, {
            attributes: true,
            attributeFilter: ["data-caret-hidden"],
          });
          await new Promise<void>((done) => setTimeout(done, seconds * 1000));
          observer.disconnect();
          return {
            focused: view.hasFocus,
            edges,
            animation: getComputedStyle(layer).animationName,
          };
        }, idleSeconds);
        const used = cpuMs(pids) - before;
        if (
          state.focused !== focused ||
          state.animation !== "none" ||
          (phase === "blinking"
            ? state.edges < 2 || state.edges > Math.ceil(idleSeconds / 0.6) + 1
            : state.edges !== 0)
        )
          throw new Error(`unexpected caret activity: ${JSON.stringify(state)}`);
        results[`caret:${phase}`] = {
          ...state,
          seconds: idleSeconds,
          cpuMs: used,
        };
        lines.push(
          `Caret ${phase}, ${idleSeconds} s: ${used} ms CPU across ${pids.length} processes; ${state.edges} blink edges; CSS animation ${state.animation}`,
        );
      }
    } finally {
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
