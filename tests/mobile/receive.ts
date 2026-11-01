/**
 * M1 of mobile/PLAN.md: real frames through the debug app on the emulator, then the
 * stored file compared byte for byte outside the app. Run through `pnpm mobile:test`,
 * which builds and installs the app and picks the device.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const frames = join(root, "target/debug/examples/frames");
const libraryFrames = join(root, "target/debug/examples/library_frames");
const pkg = "org.bismillah.reader";
const scratch = mkdtempSync(join(tmpdir(), "bismillah-mobile-"));
/** The key the next frames are sealed to: this phone's, `other`, or none. */
let sealTo = "";
const withSeal = () => ({ ...process.env, BISMILLAH_SEAL_TO: sealTo });

type RunProgress = { have: number; count: number; lacks: number[]; lacks_more: number };
type Result = { state: string; name?: string; bytes?: number; run?: RunProgress | null };
type Doc = {
  name: string | null;
  selection: boolean;
  versions: { digest: string; bytes: number }[];
};

function adb(...args: string[]): Buffer {
  return execFileSync("adb", args, { maxBuffer: 1 << 28 });
}
const shell = (command: string) => adb("exec-out", "run-as", pkg, "sh", "-c", command);

/** Prints `bytes` through the example, as `count` frames per fragment. */
function print(bytes: Uint8Array, density: number, name: string, kind: string, count = 4) {
  const file = join(scratch, "text");
  writeFileSync(file, bytes);
  return execFileSync(frames, [String(density), name, kind, String(count), file], {
    maxBuffer: 1 << 28,
    env: withSeal(),
  })
    .toString()
    .trim()
    .split("\n");
}

/** The library as a folder on this machine, then its frames from the real `Playlist`. */
function writeLibrary(texts: Record<string, Uint8Array>): string {
  const folder = mkdtempSync(join(scratch, "library-"));
  for (const [name, bytes] of Object.entries(texts)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), bytes);
  }
  return folder;
}

function printLibrary(folder: string, density: number, from: number, count: number): string[] {
  return execFileSync(libraryFrames, [String(density), folder, String(from), String(count)], {
    maxBuffer: 1 << 28,
    env: withSeal(),
  })
    .toString()
    .trim()
    .split("\n");
}

/** Chrome DevTools on the app's WebView, the only line into a phone's page we have. */
class Page {
  #socket: WebSocket;
  #next = 0;
  #waiting = new Map<number, (reply: unknown) => void>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      };
      if (reply.id !== undefined) this.#waiting.get(reply.id)?.(reply);
    });
    // A socket that closes answers nothing, and node would exit on the unsettled wait.
    socket.addEventListener("close", () => {
      for (const answer of this.#waiting.values()) answer({ error: "the page went away" });
    });
  }

  static async open(): Promise<Page> {
    adb("shell", "am", "force-stop", pkg);
    adb("shell", "am", "start", "-n", `${pkg}/.MainActivity`);
    let lastError: unknown;
    for (let tries = 0; tries < 60; tries++) {
      await new Promise((done) => setTimeout(done, 500));
      try {
        // pidof fails until the process exists, which is only a reason to wait.
        const pid = adb("shell", "pidof", pkg).toString().trim();
        if (!pid) continue;
        const port = adb("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`)
          .toString()
          .trim();
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
          webSocketDebuggerUrl: string;
        }[];
        const target = list[0];
        if (!target) continue;
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((done, fail) => {
          socket.addEventListener("open", done);
          socket.addEventListener("error", fail);
        });
        const page = new Page(socket);
        for (let wait = 0; wait < 60; wait++) {
          // Before the page has loaded, DevTools has no context to evaluate in.
          const ready = await page
            .evaluate<boolean>("typeof window.bismillahTest === 'object'")
            .catch(() => false);
          if (ready) return page;
          await new Promise((done) => setTimeout(done, 500));
        }
        throw new Error("the page never installed its test hook");
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`could not reach the WebView: ${String(lastError)}`);
  }

  evaluate<T>(expression: string): Promise<T> {
    const id = ++this.#next;
    return new Promise<T>((done, fail) => {
      this.#waiting.set(id, (reply) => {
        const { result, error } = reply as {
          result?: { result: { value: T }; exceptionDetails?: unknown };
          error?: unknown;
        };
        if (!result || result.exceptionDetails) {
          fail(new Error(JSON.stringify(error ?? result?.exceptionDetails)));
        } else {
          done(result.result.value);
        }
      });
      this.#socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  }

  /** Feeds frames until one finishes the text or is refused, and says what happened. */
  feed(parts: string[]): Promise<Result> {
    return this.evaluate<Result>(`(async () => {
      let last = { state: "none" };
      for (const part of ${JSON.stringify(parts)}) {
        last = await window.bismillahTest.receiveFrame(part);
        if (last.state === "stored" || last.state === "refused") break;
      }
      const { text, ...rest } = last;
      return rest;
    })()`);
  }

  /** Feeds every frame, as a run does, and says how the run last stood. */
  feedRun(parts: string[]): Promise<RunProgress | null> {
    return this.evaluate<RunProgress | null>(`(async () => {
      let run = null;
      for (const part of ${JSON.stringify(parts)}) {
        const frame = await window.bismillahTest.receiveFrame(part);
        if (frame.state === "stored") run = frame.run;
      }
      return run;
    })()`);
  }

  documents = () => this.evaluate<Doc[]>("window.bismillahTest.documents()");

  status = () => this.evaluate<string>("window.bismillahTest.status()");

  async waitForStatus(part: string): Promise<void> {
    for (let tries = 0; tries < 40; tries++) {
      if ((await this.status()).includes(part)) return;
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(`the status never said "${part}": ${await this.status()}`);
  }

  /** The sheet's rows, as they read. */
  rows(): Promise<string[]> {
    return this.evaluate<string[]>(
      "[...document.querySelectorAll('.sheet li button')].map((b) => b.textContent.trim())",
    );
  }

  async search(query: string): Promise<void> {
    await this.evaluate(`(() => {
      const input = document.querySelector('.sheet input');
      input.value = ${JSON.stringify(query)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await new Promise((done) => setTimeout(done, 100));
  }

  async tapRow(label: string): Promise<void> {
    for (let tries = 0; tries < 20; tries++) {
      const tapped = await this.evaluate<boolean>(`(() => {
        const row = [...document.querySelectorAll('.sheet li button')]
          .find((b) => b.textContent.includes(${JSON.stringify(label)}));
        row?.click();
        return !!row;
      })()`);
      if (tapped) {
        await new Promise((done) => setTimeout(done, 150));
        return;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`no row says "${label}": ${JSON.stringify(await this.rows())}`);
  }
  close = () => this.#socket.close();
}

/** On software rendering and under load, the emulator's own System UI can stop responding.
 * Its dialog takes focus, which hides the app's bars and covers screenshots. "Wait" is at
 * this place on the bismillah AVD's Pixel 7 screen. */
async function clearSystemDialog(): Promise<void> {
  for (let tries = 0; tries < 5; tries++) {
    const focus = adb("shell", "dumpsys", "window").toString();
    if (!/mCurrentFocus=.*Not Responding/.test(focus)) return;
    adb("shell", "input", "tap", "322", "1368");
    await new Promise((done) => setTimeout(done, 1500));
  }
}

function stored(): string[] {
  const out = shell(`find . -path '*/received/*' -type f 2>/dev/null; true`).toString().trim();
  return out ? out.split("\n").sort() : [];
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** That these exact bytes, and only those so far, are on the phone's disk. */
function expectStored(bytes: Uint8Array, before: string[]): string[] {
  const now = stored();
  const digest = sha256(bytes);
  const path = now.find((file) => file.endsWith(`/received/${digest}`));
  check(path !== undefined, `nothing stored under ${digest}: ${now.join(" ")}`);
  const kept = shell(`cat '${path}'`);
  check(Buffer.compare(kept, Buffer.from(bytes)) === 0, `the stored bytes differ: ${path}`);
  check(
    now.filter((file) => !before.includes(file)).length <= 1,
    `more than one file appeared: ${now.join(" ")}`,
  );
  return now;
}

/** Text that doesn't compress away, with vocalised Arabic, IJMES and CRLF all through. */
function chapter(bytes: number, seed: number): Buffer {
  const words = ["أَمَانَةٌ", "al-Ṭabarī", "بِسْمِ", "writer", "ٱللَّهِ", "ʿilm", "page", "زُهْد"];
  const out: Buffer[] = [Buffer.from([0xef, 0xbb, 0xbf])];
  let length = 3;
  while (length < bytes) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const word = Buffer.from(
      `${words[(seed >>> 0) % words.length]}${String.fromCharCode(97 + ((seed >>> 8) % 26))}${
        (seed >>> 0) % 11 === 0 ? "\r\n" : " "
      }`,
    );
    out.push(word);
    length += word.length;
  }
  return Buffer.concat(out);
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  let seed = 0x9e3779b9;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const VOCALISED = Buffer.from("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\n");
const BOM_CRLF = Buffer.from("﻿line one\r\nline two\r\n");
// A lone CR, trailing spaces, a NUL, and marks a normaliser would reorder.
const AWKWARD = Buffer.from("a\rb  \n\0ََّّ é é");

let failures = 0;
async function test(name: string, run: (page: Page) => Promise<void>): Promise<void> {
  shell(
    "find . -type d \\( -name received -o -name about -o -name runs \\) -exec rm -rf {} +; rm -f $(find . -name settings.json); true",
  );
  sealTo = "";
  const page = await Page.open();
  try {
    await run(page);
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    page.close();
  }
}

await test("short vocalised Arabic, as a selection with an Arabic name", async (page) => {
  const result = await page.feed(print(VOCALISED, 1, "نص.md", "selection"));
  check(result.state === "stored" && result.name === "نص.md", JSON.stringify(result));
  expectStored(VOCALISED, []);
  check((await page.status()).startsWith("Part of نص.md. Exact,"), await page.status());
});

await test("a BOM and CRLF", async (page) => {
  const result = await page.feed(print(BOM_CRLF, 0, "a.md", "whole"));
  check(result.state === "stored", JSON.stringify(result));
  expectStored(BOM_CRLF, []);
});

await test("lone CR, trailing spaces, NUL and unnormalised marks", async (page) => {
  const result = await page.feed(print(AWKWARD, 2, "a.md", "whole"));
  check(result.state === "stored", JSON.stringify(result));
  expectStored(AWKWARD, []);
});

await test("a 50 KB chapter, at every density", async (page) => {
  const text = chapter(50_000, 0x2545f491);
  for (const density of [0, 1, 2, 3]) {
    shell("find . -type d -name received -exec rm -rf {} +; true");
    const parts = print(text, density, "Chapter.md", "whole", density === 3 ? 2 : 3);
    const result = await page.feed(parts);
    check(result.state === "stored", `density ${density}: ${JSON.stringify(result)}`);
    expectStored(text, []);
  }
  check((await page.status()).includes("Exact, 50,0"), await page.status());
});

await test("frames out of order", async (page) => {
  const text = chapter(8_000, 0x1234567);
  const result = await page.feed(shuffled(print(text, 2, "a.md", "whole", 4)));
  check(result.state === "stored", JSON.stringify(result));
  expectStored(text, []);
});

await test("three frames in ten lost", async (page) => {
  const text = chapter(8_000, 0x7654321);
  const kept = print(text, 2, "a.md", "whole", 4).filter((_, i) => i % 10 >= 3);
  const result = await page.feed(kept);
  check(result.state === "stored", JSON.stringify(result));
  expectStored(text, []);
});

await test("strays from another document among the frames", async (page) => {
  const text = chapter(8_000, 0x1111111);
  const other = print(chapter(8_000, 0x2222222), 2, "other.md", "whole", 4);
  const mixed = print(text, 2, "a.md", "whole", 4).flatMap((part, i) => [
    part,
    other[i % other.length] as string,
    other[(i + 1) % other.length] as string,
  ]);
  const result = await page.feed(mixed);
  check(result.state === "stored" && result.name === "a.md", JSON.stringify(result));
  expectStored(text, []);
  check(stored().length === 1, `the stray document was stored: ${stored().join(" ")}`);
});

await test("a new print takes over, and the abandoned one leaves nothing", async (page) => {
  const abandoned = print(chapter(8_000, 0x3333333), 2, "old.md", "whole", 1).slice(0, 8);
  const partial = await page.feed(abandoned);
  check(partial.state === "receiving", JSON.stringify(partial));
  check((await page.status()).startsWith("Receiving, "), await page.status());
  check(stored().length === 0, "an unfinished print stored something");
  const wanted = chapter(8_000, 0x4444444);
  const result = await page.feed(print(wanted, 2, "new.md", "whole", 4));
  check(result.name === "new.md", JSON.stringify(result));
  expectStored(wanted, []);
});

await test("other codes and garbage change nothing", async (page) => {
  const result = await page.feed([
    "https://example.com",
    "UR:BYTES/1-2/LPADAOCSKBCYTKFHSAGHHDFD",
    "UR:BISMILLAH-PRINT/1-2/NOTBYTEWORDS",
    "UR:BISMILLAH-PRINT/4294967295-4000000000/LPAD",
    "",
  ]);
  check(result.state === "ignored", JSON.stringify(result));
  check((await page.status()).startsWith("A sample."), await page.status());
  check(stored().length === 0, "garbage stored something");
});

await test("a digest that disagrees shows an error and stores nothing", async (page) => {
  const parts = print(chapter(4_000, 0x5555555), 2, "a.md", "wrong-digest", 4);
  const result = await page.feed(parts);
  check(result.state === "refused", JSON.stringify(result));
  check((await page.status()).includes("nothing was stored"), await page.status());
  check(stored().length === 0, `a refused print stored: ${stored().join(" ")}`);
  // And it doesn't block the next one.
  const next = await page.feed(print(VOCALISED, 1, "next.md", "whole"));
  check(next.state === "stored", JSON.stringify(next));
  expectStored(VOCALISED, []);
});

await test("a received text survives the app being stopped", async (page) => {
  const text = chapter(8_000, 0x6666666);
  await page.feed(print(text, 2, "a.md", "whole", 4));
  const before = stored();
  adb("shell", "am", "force-stop", pkg);
  check(before.length === 1, before.join(" "));
  expectStored(text, before);
});

await test("texts stay listed, newest first, after the app restarts", async (page) => {
  await page.feed(print(VOCALISED, 1, "نص.md", "selection"));
  await new Promise((done) => setTimeout(done, 20));
  await page.feed(print(BOM_CRLF, 0, "second.md", "whole"));
  page.close();
  const again = await Page.open();
  const list = await again.documents();
  check(list.map((doc) => doc.name).join() === "second.md,نص.md", JSON.stringify(list));
  check(list[1]?.selection === true, JSON.stringify(list));
  // It opens on the newest, exact, without being told.
  await again.waitForStatus("second.md. Exact, ");
  const shown = await again.evaluate<string>("window.bismillahTest.shown()");
  check(shown.includes("line two"), shown);
  again.close();
});

await test("a name holding a path stays a name", async (page) => {
  const name = "../../../cmdline";
  const result = await page.feed(print(VOCALISED, 1, name, "whole"));
  check(result.state === "stored" && result.name === name, JSON.stringify(result));
  expectStored(VOCALISED, []);
  const everything = shell("find . -name '*cmdline*' 2>/dev/null; true").toString().trim();
  check(everything === "", `the name reached the disk: ${everything}`);
});

await test("a copy altered on the disk is not called exact", async () => {
  const first = await Page.open();
  await first.feed(print(VOCALISED, 1, "a.md", "whole"));
  first.close();
  const path = stored()[0] as string;
  shell(`printf x >> '${path}'`);
  const page = await Page.open();
  await page.waitForStatus("has changed");
  check(!(await page.status()).includes("Exact"), await page.status());
  page.close();
});

await test("a kill during receiving loses nothing that was reported stored", async () => {
  const reported: Buffer[] = [];
  for (let round = 0; round < 6; round++) {
    const page = await Page.open();
    const text = chapter(30_000, 0x700000 + round);
    const parts = print(text, 1, `round-${round}.md`, "whole", 3);
    // Odd rounds are killed part-way, at varying moments; even ones run to the end.
    if (round % 2 === 0) {
      const result = await page.feed(parts);
      check(result.state === "stored", JSON.stringify(result));
      reported.push(text);
    } else {
      void page.feed(parts).catch(() => undefined);
      await new Promise((done) => setTimeout(done, 30 + round * 120));
      const pid = adb("shell", "pidof", pkg).toString().trim();
      adb("shell", "run-as", pkg, "kill", "-9", pid);
    }
    page.close();
  }
  const page = await Page.open();
  const list = await page.documents();
  for (const text of reported) {
    check(
      list.some((doc) => doc.versions.some((version) => version.digest === sha256(text))),
      `a reported text is missing: ${sha256(text)}`,
    );
    expectStored(text, stored());
  }
  const halves = shell("find . -name '.*.part' 2>/dev/null; true").toString().trim();
  check(halves === "", `half-written files remain: ${halves}`);
  page.close();
});

await test("settings persist, and a bad setting file costs nothing", async (page) => {
  await page.evaluate("window.bismillahTest.openSheet()");
  await page.tapRow("Theme: System");
  await page.tapRow("Theme: Light");
  await page.tapRow("Text size: Medium");
  page.close();
  const again = await Page.open();
  const settings = await again.evaluate<{ theme: string; size: string }>(
    "window.bismillahTest.settings()",
  );
  check(settings.theme === "dark" && settings.size === "large", JSON.stringify(settings));
  again.close();
  shell("find . -name settings.json -exec sh -c 'echo { > \"$1\"' _ {} \\;");
  const third = await Page.open();
  const reset = await third.evaluate<{ theme: string }>("window.bismillahTest.settings()");
  check(reset.theme === "system", JSON.stringify(reset));
  third.close();
});

await test("the sheet lists texts and finds them, and opening one closes it", async (page) => {
  await page.feed(print(VOCALISED, 1, "سَلَام.md", "whole"));
  await page.feed(print(BOM_CRLF, 0, "al-Ṭabarī.md", "whole"));
  await page.evaluate("window.bismillahTest.openSheet()");
  const focus = await page.evaluate<string>("document.activeElement?.tagName ?? ''");
  check(focus !== "INPUT", "the keyboard came up by itself");
  await page.search("سلام");
  const rows = await page.rows();
  check(rows.length === 1 && rows[0]?.includes("سَلَام") === true, JSON.stringify(rows));
  await page.tapRow("سَلَام");
  await page.waitForStatus("Exact, ");
  const open = await page.evaluate<boolean>("!!document.querySelector('.sheet')");
  check(!open, "the sheet stayed open");
  const shown = await page.evaluate<string>("window.bismillahTest.shown()");
  check(shown === VOCALISED.toString(), shown);
});

/** A small library: folders, an Arabic path, two files with the same bytes, BOM and CRLF. */
function testLibrary(): Record<string, Buffer> {
  return {
    "chapters/one.md": chapter(6_000, 0x1a2b3c4),
    "chapters/نص.md": VOCALISED,
    "copies/same.md": BOM_CRLF,
    "notes/deep/awkward.md": AWKWARD,
    "other/same.md": BOM_CRLF,
    "top.md": chapter(2_500, 0x5d6e7f8),
  };
}

function expectLibrary(texts: Record<string, Buffer>, documents: Doc[]): void {
  check(documents.length === Object.keys(texts).length, JSON.stringify(documents));
  for (const [name, bytes] of Object.entries(texts)) {
    const doc = documents.find((d) => d.name === name);
    check(doc?.versions[0]?.digest === sha256(bytes), `${name}: ${JSON.stringify(doc)}`);
    const kept = shell(`cat "$(find . -path '*/received/${sha256(bytes)}')"`);
    check(Buffer.compare(kept, bytes) === 0, `the stored bytes differ: ${name}`);
  }
  const everything = shell("find . -name '*.md' 2>/dev/null; true").toString().trim();
  check(everything === "", `a path reached the disk: ${everything}`);
}

await test("a whole library arrives byte for byte, with its folders", async (page) => {
  const texts = testLibrary();
  const run = await page.feedRun(printLibrary(writeLibrary(texts), 2, 0, 400));
  check(run?.have === 6 && run.count === 6, JSON.stringify(run));
  await page.waitForStatus("All 6 texts are here");
  expectLibrary(texts, await page.documents());
});

await test("a run killed part-way picks up, and asks for what it lacks", async (first) => {
  const texts = testLibrary();
  const folder = writeLibrary(texts);
  // Frames until the first text is stored, then the process dies in the middle of the next.
  const frames = printLibrary(folder, 2, 0, 200);
  let early: RunProgress | null = null;
  while (early === null && frames.length > 0) early = await first.feedRun(frames.splice(0, 4));
  if (early === null) throw new Error("nothing arrived before the kill");
  check(early.have >= 1 && early.have < 6, JSON.stringify(early));
  void first.feedRun(printLibrary(folder, 2, early.have, 30)).catch(() => undefined);
  await new Promise((done) => setTimeout(done, 80));
  const pid = adb("shell", "pidof", pkg).toString().trim();
  adb("shell", "run-as", pkg, "kill", "-9", pid);
  first.close();

  // After the restart it still knows, and the sheet says so.
  const page = await Page.open();
  await page.evaluate("window.bismillahTest.openSheet()");
  // The list loads just after the page does, so the row can take a moment to appear.
  let rows: string[] = [];
  for (let tries = 0; tries < 40; tries++) {
    rows = await page.rows();
    if (rows.some((row) => row.startsWith("Library print: "))) break;
    await new Promise((done) => setTimeout(done, 250));
  }
  check(
    rows.some((row) => row.startsWith("Library print: ") && row.endsWith("of 6 texts")),
    JSON.stringify(rows),
  );
  await page.tapRow("Library print: ");
  await page.waitForStatus("Still lacks");
  await page.evaluate("window.bismillahTest.closeSheet()");

  // The stick goes straight to each text the phone names, by its number.
  let run: RunProgress | null = null;
  for (let tries = 0; tries < 8; tries++) {
    const lacking = run?.lacks[0] ?? early.lacks[0] ?? 1;
    run = await page.feedRun(printLibrary(folder, 2, lacking - 1, 80));
    if (run?.have === 6) break;
  }
  check(run?.have === 6, JSON.stringify(run));
  expectLibrary(texts, await page.documents());
  page.close();
});

await test("a changed text is a new version, and the old one stays readable", async (page) => {
  const first = Buffer.from("the first words\n");
  const second = Buffer.from("the second words\n");
  await page.feed(print(first, 1, "a/ch.md", "whole"));
  await new Promise((done) => setTimeout(done, 20));
  await page.feed(print(second, 1, "a/ch.md", "whole"));
  const list = await page.documents();
  check(list.length === 1 && list[0]?.versions.length === 2, JSON.stringify(list));
  check(list[0]?.versions[0]?.digest === sha256(second), JSON.stringify(list));

  await page.evaluate("window.bismillahTest.openSheet()");
  check(
    (await page.rows()).some((row) => row.includes("2 versions")),
    "no count of versions",
  );
  const earlier = await page.evaluate<boolean>(`(() => {
    const rows = [...document.querySelectorAll('.sheet li button')]
      .filter((b) => /\\d{4},? \\d{2}:\\d{2}/.test(b.textContent));
    rows.at(-1)?.click();
    return rows.length === 2;
  })()`);
  check(earlier, JSON.stringify(await page.rows()));
  await page.waitForStatus("An earlier version");
  check((await page.status()).includes("Exact, 16 bytes"), await page.status());
  const shown = await page.evaluate<string>("window.bismillahTest.shown()");
  check(shown === first.toString(), shown);
  expectStored(first, stored());
  expectStored(second, stored());
});

await test("a still code left on the screen doesn't rebuild the page", async (page) => {
  const parts = print(VOCALISED, 1, "a.md", "whole", 3);
  await page.feed(parts);
  await page.evaluate("window.bismillahBefore = document.querySelector('.cm-editor')");
  await page.feed(parts);
  const same = await page.evaluate<boolean>(
    "window.bismillahBefore === document.querySelector('.cm-editor')",
  );
  check(same, "the same text rebuilt the page");
});

await test("the bars follow the app's theme, not only the system's", async (page) => {
  const bars = await page.evaluate<boolean>("typeof window.bismillahBars?.set === 'function'");
  check(bars, "the page can't reach the bars");
  // What the system was told, since the bars are outside anything the page can see.
  const lightBars = async () => {
    await clearSystemDialog();
    const window = adb("shell", "dumpsys", "window", "displays").toString();
    return /AppearanceRegion\{[^}]*LIGHT_STATUS_BARS/.test(window);
  };
  adb("shell", "cmd", "uimode", "night", "no");
  await page.evaluate("window.bismillahTest.openSheet()");
  await page.tapRow("Theme: System");
  await new Promise((done) => setTimeout(done, 500));
  check(await lightBars(), "light theme, but the bars aren't");
  await page.tapRow("Theme: Light");
  await new Promise((done) => setTimeout(done, 500));
  check(!(await lightBars()), "dark theme, but the bars are light");
  await page.tapRow("Theme: Dark");
  await new Promise((done) => setTimeout(done, 500));
  check(await lightBars(), "back to the system's light, but the bars aren't");
  adb("shell", "cmd", "uimode", "night", "yes");
  await new Promise((done) => setTimeout(done, 1000));
  check(!(await lightBars()), "the system went dark, but the bars didn't follow");
  adb("shell", "cmd", "uimode", "night", "no");
});

/** This phone's key, as the writer would read it off the screen. */
const phoneKey = (page: Page) =>
  page.evaluate<{ key: string; words: string }>("window.bismillahTest.phoneKey()");

await test("a sealed text arrives byte for byte, and only this phone's key opens it", async (page) => {
  sealTo = (await phoneKey(page)).key;
  const parts = print(BOM_CRLF, 0, "sealed.md", "whole");
  const result = await page.feed(parts);
  check(result.state === "stored" && result.name === "sealed.md", JSON.stringify(result));
  expectStored(BOM_CRLF, []);
  const status = await page.status();
  check(status.includes("Exact, ") && !status.includes("Not sealed"), status);

  const everything = parts.join("").toLowerCase();
  check(!everything.includes("sealed.md"), "a sealed frame holds the name in the clear");
});

await test("a print sealed to another key is refused, stores nothing, and the next arrives", async (page) => {
  sealTo = "other";
  const refusedResult = await page.feed(print(VOCALISED, 1, "other.md", "whole"));
  check(refusedResult.state === "refused", JSON.stringify(refusedResult));
  check((await page.status()).includes("sealed to another key"), await page.status());
  check(stored().length === 0, `it stored: ${stored().join(" ")}`);

  sealTo = (await phoneKey(page)).key;
  const next = await page.feed(print(VOCALISED, 1, "mine.md", "whole"));
  check(next.state === "stored" && next.name === "mine.md", JSON.stringify(next));
  expectStored(VOCALISED, []);
});

await test("a print that isn't sealed says so", async (page) => {
  await page.feed(print(VOCALISED, 1, "open.md", "whole"));
  check((await page.status()).includes("Not sealed"), await page.status());
});

await test("a whole library arrives sealed, byte for byte", async (page) => {
  sealTo = (await phoneKey(page)).key;
  const texts = testLibrary();
  const run = await page.feedRun(printLibrary(writeLibrary(texts), 2, 0, 400));
  check(run?.have === 6, JSON.stringify(run));
  expectLibrary(texts, await page.documents());
});

await test("the phone's key stays through a restart, and the sheet shows it to type", async (page) => {
  const before = await phoneKey(page);
  check(/^bk1[a-z0-9 ]+$/.test(before.key), before.key);
  check(before.words.split(" ").length === 4, before.words);
  await page.evaluate("window.bismillahTest.openSheet()");
  await page.tapRow("Pair with a stick");
  await page.evaluate("window.bismillahTest.closeSheet()");
  await new Promise((done) => setTimeout(done, 300));
  const shown = await page.evaluate<string>(
    "document.querySelector('.pairing')?.textContent ?? ''",
  );
  check(shown.includes(before.key) && shown.includes(before.words), shown);
  page.close();
  const again = await Page.open();
  const after = await phoneKey(again);
  check(after.key === before.key, "the key changed on restart");
  again.close();
});

await test("the byte comparison itself can fail", async (page) => {
  await page.feed(print(VOCALISED, 1, "a.md", "whole"));
  const path = stored()[0] as string;
  shell(`printf x >> '${path}'`);
  let caught = false;
  try {
    expectStored(VOCALISED, []);
  } catch {
    caught = true;
  }
  check(caught, "an altered file passed as exact");
});

// For looking at: a received text and its quiet line, in both themes.
const shots = process.argv[2];
if (shots) {
  const page = await Page.open();
  const text = Buffer.from(
    "# نص\n\nThe word أَمَانَةٌ sits in an English line.\n\nبِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\n",
  );
  await page.feed(print(Buffer.from("first draft\\n"), 1, "Notes/مسودة.md", "whole"));
  await page.feed(print(Buffer.from("second draft\\n"), 1, "Notes/مسودة.md", "whole"));
  await page.feed(
    print(BOM_CRLF, 0, "Books/al-Ṭabarī, a long chapter name for this list.md", "whole"),
  );
  await page.feed(print(Buffer.from("third draft\\n"), 1, "Notes/مسودة.md", "whole"));
  await page.feed(print(text, 1, "نص.md", "selection"));
  await page.evaluate("window.bismillahTest.openSheet()");
  await page.tapRow("Pair with a stick");
  await page.evaluate("window.bismillahTest.closeSheet()");
  await new Promise((done) => setTimeout(done, 1500));
  await clearSystemDialog();
  writeFileSync(join(shots, "pairing-light.png"), adb("exec-out", "screencap", "-p"));
  await page.evaluate("window.bismillahTest.closePairing()");
  for (const [theme, night] of [
    ["light", "no"],
    ["dark", "yes"],
  ] as const) {
    adb("shell", "cmd", "uimode", "night", night);
    await new Promise((done) => setTimeout(done, 2000));
    await clearSystemDialog();
    writeFileSync(join(shots, `received-${theme}.png`), adb("exec-out", "screencap", "-p"));
    await page.evaluate("window.bismillahTest.openSheet()");
    await new Promise((done) => setTimeout(done, 800));
    await clearSystemDialog();
    writeFileSync(join(shots, `sheet-${theme}.png`), adb("exec-out", "screencap", "-p"));
    await page.evaluate("window.bismillahTest.closeSheet()");
  }
  adb("shell", "cmd", "uimode", "night", "no");
  page.close();
}

rmSync(scratch, { recursive: true });
if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
