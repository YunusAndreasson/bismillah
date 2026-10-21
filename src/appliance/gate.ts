import { copy } from "../core/copy.ts";
import type { GateState, HelperAnswer, Home } from "../core/ipc.ts";

/** Which of the stick's first screens a home state gets (os/PLAN.md, OS-2). */
export type View =
  | { view: "setup"; keyboardChosen: boolean }
  | { view: "finish" }
  | { view: "unlock"; verb: "unlock" | "verify" }
  | { view: "stop"; title: string; body: string; restart: boolean };

export function viewFor(gate: GateState): View {
  const home = gate.home;
  switch (home.state) {
    case "blank":
      return { view: "setup", keyboardChosen: gate.keyboard.source === "pending" };
    case "initialising":
      return { view: "finish" };
    case "ready":
      return { view: "unlock", verb: "unlock" };
    // A session restarted while home is open asks again, and reopens nothing.
    case "unlocked":
      return { view: "unlock", verb: "verify" };
    case "unreadable":
      return { view: "stop", ...copy.appliance.unreadable, restart: false };
    case "not_found":
      return home.reason === "two_sticks"
        ? { view: "stop", ...copy.appliance.twoSticks, restart: true }
        : { view: "stop", ...copy.appliance.notFound, restart: true };
  }
}

/** A refusal's new state, when the helper refused because home changed meanwhile. */
export function refusedState(answer: HelperAnswer): Home | null {
  return answer.answer === "refused" ? answer.state : null;
}

/** What to tell the writer about an answer other than success or a wrong passphrase. */
export function describe(answer: HelperAnswer): string {
  switch (answer.answer) {
    case "too_weak":
      return copy.appliance.setup.weak;
    case "refused":
      if (answer.state.state === "unreadable") return copy.appliance.unreadable.body;
      return copy.appliance.failed;
    default:
      return copy.appliance.failed;
  }
}

/** Focuses a field when it appears (autofocus works only at page load). */
export function focus(node: HTMLElement) {
  node.focus();
}
