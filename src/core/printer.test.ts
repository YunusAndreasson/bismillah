import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_MODULE_PIXELS,
  PrintRun,
  REST_AFTER_MS,
  chooseDensity,
  holdPrints,
} from "./printer.svelte.ts";
import type { PrintIO, PrintSubject } from "./printer.svelte.ts";
import { ALL_COMMANDS, COMMANDS, offerPreviewCommands } from "./commands.ts";
import { copy } from "./copy.ts";

const SIDES = [105, 85, 65, 49];
const subject: PrintSubject = { id: 1, name: "نص.md", text: "text", selection: false, words: 1 };

function fakeIO(still = false) {
  const frame = { size: 1, quiet: 4, modules: "1", place: null };
  return {
    sizes: vi.fn(() => Promise.resolve({ sides: SIDES, frames_per_second: 10 })),
    start: vi.fn<PrintIO["start"]>(() =>
      Promise.resolve({
        still,
        seconds: 30,
        texts: 0,
        left_out: [],
        truncated: false,
        sealed_words: null,
      }),
    ),
    goTo: vi.fn(() => Promise.resolve()),
    frame: vi.fn(() => Promise.resolve(frame)),
    stop: vi.fn(() => Promise.resolve()),
  } satisfies PrintIO;
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("chooseDensity", () => {
  it("takes the densest size whose modules stay large enough", () => {
    expect(chooseDensity(105 * MIN_MODULE_PIXELS, SIDES)).toBe(0);
    expect(chooseDensity(105 * MIN_MODULE_PIXELS - 1, SIDES)).toBe(1);
    expect(chooseDensity(49 * MIN_MODULE_PIXELS, SIDES)).toBe(3);
    expect(chooseDensity(49 * MIN_MODULE_PIXELS - 1, SIDES)).toBeNull();
  });
});

describe("PrintRun", () => {
  let reducedMotion = false;
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = false;
    vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  });
  afterEach(() => {
    holdPrints(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays frames one at a time, and pause stops them", async () => {
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    expect(run.status).toBe("playing");
    expect(run.shown).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(run.shown).toBe(4);
    run.pause();
    expect(run.status).toBe("paused");
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.shown).toBe(4);
    run.toggle();
    await vi.advanceTimersByTimeAsync(100);
    expect(run.shown).toBe(5);
    run.close();
  });

  it("shows short text as one still frame, with no timer", async () => {
    const io = fakeIO(true);
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    expect(run.status).toBe("still");
    run.toggle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(io.frame).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    run.close();
  });

  it("waits for the writer under reduced motion", async () => {
    reducedMotion = true;
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    expect(run.status).toBe("ready");
    await vi.advanceTimersByTimeAsync(2000);
    expect(run.shown).toBe(1);
    run.toggle();
    expect(run.status).toBe("playing");
    run.close();
  });

  it("rests after five minutes, and the timer stops", async () => {
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    await vi.advanceTimersByTimeAsync(REST_AFTER_MS + 500);
    expect(run.status).toBe("rested");
    expect(vi.getTimerCount()).toBe(0);
    run.toggle();
    expect(run.status).toBe("playing");
    run.close();
  });

  it("stops and lets go when closed, even mid-start", async () => {
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    const fitting = run.fit(1000);
    run.close();
    await fitting;
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(io.stop).toHaveBeenCalled();
    expect(run.status).not.toBe("playing");
  });

  it("leaves no timer after closing while playing", async () => {
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    run.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(io.stop).toHaveBeenCalledTimes(1);
  });

  it("restarts at a new size, and carries on at the same one", async () => {
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    await run.fit(1001);
    expect(io.start).toHaveBeenCalledTimes(1);
    await run.fit(300);
    expect(io.start).toHaveBeenCalledTimes(2);
    expect(run.density).toBe(2);
    run.close();
  });

  it("asks for a larger window when no size fits, and recovers", async () => {
    const io = fakeIO();
    const run = new PrintRun(subject, io);
    await run.fit(100);
    expect(run.status).toBe("too-small");
    expect(io.start).not.toHaveBeenCalled();
    await run.fit(1000);
    expect(run.status).toBe("playing");
    run.close();
  });

  it("says so when the code can't be made, and stops", async () => {
    const io = fakeIO();
    io.frame.mockImplementationOnce(() => Promise.reject(new Error("failed")));
    const run = new PrintRun(subject, io);
    await run.fit(1000);
    expect(run.status).toBe("failed");
    expect(run.frame).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    run.close();
  });
});

describe("what it says", () => {
  it("rounds time up and always says about", () => {
    expect(copy.print.time(1)).toBe("About 5 seconds.");
    expect(copy.print.time(31)).toBe("About 35 seconds.");
    expect(copy.print.time(60)).toBe("About a minute.");
    expect(copy.print.time(61)).toBe("About 2 minutes.");
  });

  it("never claims the phone received anything", () => {
    const words = JSON.stringify(copy.print);
    expect(words).not.toMatch(/\bsent\b|\breceived\b|\bdelivered\b/i);
  });
});

describe("a library run", () => {
  const library: PrintSubject = { ...subject, library: { unsaved: false } };
  const place = (index: number) => ({ index, count: 40, name: "a.md", round: 1 });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function runIO() {
    const io = fakeIO();
    io.start.mockImplementation(() =>
      Promise.resolve({
        still: false,
        seconds: 1200,
        texts: 40,
        left_out: [],
        truncated: false,
        sealed_words: null,
      }),
    );
    vi.mocked(io.frame).mockImplementation(() =>
      Promise.resolve({ size: 1, quiet: 4, modules: "1", place: place(12) }),
    );
    return io;
  }

  it("keeps its place when a new QR size starts it again", async () => {
    const io = runIO();
    const run = new PrintRun(library, io);
    await run.fit(105 * MIN_MODULE_PIXELS);
    await flush();
    await run.fit(85 * MIN_MODULE_PIXELS);
    await flush();
    expect(io.start).toHaveBeenLastCalledWith(library, 1, 12);
    run.close();
  });

  it("goes to a text within the run, and rests only after several rounds", async () => {
    const io = runIO();
    const run = new PrintRun(library, io);
    await run.fit(105 * MIN_MODULE_PIXELS);
    await flush();
    await run.goTo(99);
    expect(io.goTo).toHaveBeenLastCalledWith(39);
    await run.goTo(-3);
    expect(io.goTo).toHaveBeenLastCalledWith(0);
    await vi.advanceTimersByTimeAsync(REST_AFTER_MS + 1000);
    expect(run.status).toBe("playing");
    await vi.advanceTimersByTimeAsync(4 * 1200 * 1000);
    expect(run.status).toBe("rested");
    run.close();
  });

  it("says so when nothing in the library can be printed", async () => {
    const io = runIO();
    // Tauri rejects with the error's serialized form, a string here.
    io.start.mockRejectedValue("empty");
    const run = new PrintRun(library, io);
    await run.fit(105 * MIN_MODULE_PIXELS);
    await flush();
    expect(run.status).toBe("nothing");
    run.close();
  });
});

describe("the release gate (ADR-0021)", () => {
  it("leaves Print to phone out until previews are offered", () => {
    expect(ALL_COMMANDS.some((c) => c.id === "file.printToPhone")).toBe(true);
    expect(COMMANDS.some((c) => c.id === "file.printToPhone")).toBe(false);
    offerPreviewCommands();
    const print = COMMANDS.find((c) => c.id === "file.printToPhone");
    expect(print?.label).toBe("Print to phone…");
    expect(print?.key).toBeUndefined();
    expect(print?.aliases).toEqual(expect.arrayContaining(["print", "qr", "phone", "export"]));
  });
});
