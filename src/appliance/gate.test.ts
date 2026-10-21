import { describe as group, expect, it } from "vitest";
import { copy } from "../core/copy.ts";
import type { GateState, Home } from "../core/ipc.ts";
import { describe, viewFor } from "./gate.ts";

const gate = (home: Home, source: GateState["keyboard"]["source"] = "default"): GateState => ({
  home,
  keyboard: { layouts: "us", options: "", source },
  resume: false,
});

group("the stick's first screen", () => {
  it("sets up a blank stick, keyboard first unless it was chosen before the reload", () => {
    expect(viewFor(gate({ state: "blank" }))).toEqual({ view: "setup", keyboardChosen: false });
    expect(viewFor(gate({ state: "blank" }, "pending"))).toEqual({
      view: "setup",
      keyboardChosen: true,
    });
  });

  it("finishes an interrupted setup and unlocks a ready stick", () => {
    expect(viewFor(gate({ state: "initialising" }))).toEqual({ view: "finish" });
    expect(viewFor(gate({ state: "ready" }))).toEqual({ view: "unlock", verb: "unlock" });
  });

  it("asks again, without reopening, when the session restarts with home open", () => {
    expect(viewFor(gate({ state: "unlocked" }))).toEqual({ view: "unlock", verb: "verify" });
  });

  it("never offers setup for a stick it can't read", () => {
    for (const reason of [
      "foreign",
      "damaged_header",
      "unknown_token",
      "damaged_file_system",
    ] as const) {
      const view = viewFor(gate({ state: "unreadable", reason }));
      expect(view).toMatchObject({ view: "stop", restart: false, ...copy.appliance.unreadable });
    }
  });

  it("asks for the other stick to be removed", () => {
    expect(viewFor(gate({ state: "not_found", reason: "two_sticks" }))).toMatchObject({
      view: "stop",
      restart: true,
      title: copy.appliance.twoSticks.title,
    });
    expect(viewFor(gate({ state: "not_found", reason: "no_home" }))).toMatchObject({
      title: copy.appliance.notFound.title,
    });
  });

  it("explains refusals and failures without promising more than is true", () => {
    expect(describe({ answer: "too_weak" })).toBe(copy.appliance.setup.weak);
    expect(
      describe({
        answer: "refused",
        state: { state: "unreadable", reason: "damaged_file_system" },
      }),
    ).toBe(copy.appliance.unreadable.body);
    expect(describe({ answer: "failed", step: "mount" })).toBe(copy.appliance.failed);
  });
});
