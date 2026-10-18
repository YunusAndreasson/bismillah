import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedDocument, SaveError } from "./ipc.ts";
import { AUTOSAVE_DELAY_MS, DocumentSession, type SaveIO } from "./session.svelte.ts";

const doc = (overrides: Partial<OpenedDocument> = {}): OpenedDocument => ({
  id: 7,
  name: "letter.md",
  text: "",
  line_ending: "lf",
  mixed_line_endings: false,
  read_only: false,
  sample: false,
  recovery: null,
  pending_recovery: [],
  ...overrides,
});

interface Call {
  text: string;
  revision: number;
  force: boolean;
  resolve(revision: number): void;
  reject(error: SaveError): void;
}

/** A fake Rust side whose saves the test completes by hand. */
function fakeIO() {
  const calls: Call[] = [];
  const io: SaveIO = {
    save: (_id, text, revision, force) =>
      new Promise<number>((resolve, reject) => {
        calls.push({ text, revision, force, resolve, reject });
      }),
  };
  return { io, calls };
}

const tick = () => vi.advanceTimersByTimeAsync(0);

describe("document session", () => {
  let text = "";
  beforeEach(() => {
    vi.useFakeTimers();
    text = "";
  });
  afterEach(() => vi.useRealTimers());

  function type(session: DocumentSession, more: string) {
    text += more;
    session.edited();
  }

  it("saves after the typing pause and says Saved only once Rust confirms", async () => {
    const { io, calls } = fakeIO();
    const session = new DocumentSession(doc(), () => text, io);
    type(session, "a");
    type(session, "b");
    expect(session.state.kind).toBe("saving");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ text: "ab", revision: 2, force: false });
    expect(session.state.kind).toBe("saving");
    calls[0]?.resolve(2);
    await tick();
    expect(session.state.kind).toBe("saved");
    expect(session.dirty).toBe(false);
  });

  it("runs one save at a time and sends the newest text next", async () => {
    const { io, calls } = fakeIO();
    const session = new DocumentSession(doc(), () => text, io);
    type(session, "one");
    void session.save();
    await tick();
    type(session, " two");
    type(session, " three");
    const flushed = session.flush();
    await tick();
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(1);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ text: "one two three", revision: 3 });
    expect(session.state.kind).toBe("saving");
    calls[1]?.resolve(3);
    expect(await flushed).toBe(true);
    expect(session.state.kind).toBe("saved");
  });

  it("keeps a failure visible through retries until a save succeeds", async () => {
    const { io, calls } = fakeIO();
    const session = new DocumentSession(doc(), () => text, io);
    type(session, "x");
    const first = session.flush();
    await tick();
    calls[0]?.reject({ kind: "disk_full" });
    expect(await first).toBe(false);
    expect(session.state).toEqual({ kind: "failed", error: { kind: "disk_full" } });

    type(session, "y");
    expect(session.state.kind).toBe("failed");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(session.state.kind).toBe("failed");
    calls[1]?.reject({ kind: "disk_full" });
    await tick();
    expect(session.state.kind).toBe("failed");

    const retry = session.save();
    await tick();
    calls[2]?.resolve(2);
    expect(await retry).toBe(true);
    expect(session.state.kind).toBe("saved");
  });

  it("forces only the save the writer asked to force", async () => {
    const { io, calls } = fakeIO();
    const session = new DocumentSession(doc(), () => text, io);
    type(session, "mine");
    void session.save();
    await tick();
    calls[0]?.reject({ kind: "conflict" });
    await tick();
    const kept = session.save(true);
    await tick();
    expect(calls[1]?.force).toBe(true);
    calls[1]?.resolve(1);
    expect(await kept).toBe(true);
    type(session, "!");
    void session.save();
    await tick();
    expect(calls[2]?.force).toBe(false);
  });

  it("never saves a sample or a read-only document", async () => {
    const { io, calls } = fakeIO();
    const sample = new DocumentSession(doc({ sample: true }), () => text, io);
    type(sample, "edit");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(await sample.flush()).toBe(true);
    expect(sample.state.kind).toBe("sample");
    const readOnly = new DocumentSession(doc({ read_only: true }), () => text, io);
    expect(readOnly.state.kind).toBe("read_only");
    expect(await readOnly.flush()).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("treats a newer revision already on disk as saved", async () => {
    const { io, calls } = fakeIO();
    const session = new DocumentSession(doc(), () => text, io);
    type(session, "a");
    const saved = session.flush();
    await tick();
    calls[0]?.resolve(5);
    expect(await saved).toBe(true);
    expect(session.savedRevision).toBe(5);
  });

  it("stops after it is disposed", async () => {
    const { io, calls } = fakeIO();
    const session = new DocumentSession(doc(), () => text, io);
    type(session, "a");
    session.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(calls).toHaveLength(0);
  });
});
