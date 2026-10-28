import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { farewell, farewellThen, HOLD_MS, STILL_ON_MS } from "./farewell.svelte.ts";

describe("the stick's farewell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
      setTimeout(() => frame(performance.now()), 16),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    farewell.action = null;
  });

  it("shows at once, and asks only after the save and a readable moment", async () => {
    let saved!: () => void;
    const save = new Promise<void>((done) => (saved = done));
    const request = vi.fn(() => Promise.resolve());
    void farewellThen("off", save, request);
    expect(farewell.action).toBe("off");
    await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
    expect(request).not.toHaveBeenCalled();
    saved();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledOnce();
  });

  it("holds the screen even when the save is instant", async () => {
    const request = vi.fn(() => Promise.resolve());
    void farewellThen("reboot", Promise.resolve(), request);
    await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledOnce();
    expect(farewell.action).toBe("reboot");
  });

  it("steps aside when the helper fails", async () => {
    let finished = false;
    void farewellThen("off", Promise.resolve(), () => Promise.reject(new Error("down"))).then(
      () => (finished = true),
    );
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(finished).toBe(true);
    expect(farewell.action).toBeNull();
  });

  it("steps aside when the computer is plainly still on", async () => {
    let finished = false;
    void farewellThen("off", Promise.resolve(), () => Promise.resolve()).then(
      () => (finished = true),
    );
    await vi.advanceTimersByTimeAsync(HOLD_MS + STILL_ON_MS - 1);
    expect(finished).toBe(false);
    expect(farewell.action).toBe("off");
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    expect(farewell.action).toBeNull();
  });
});
