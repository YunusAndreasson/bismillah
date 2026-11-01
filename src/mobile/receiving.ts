/** What a frame did, as Rust reports it (mobile/src-tauri/src/lib.rs). */
export type Frame =
  | { state: "ignored" }
  | { state: "receiving"; resolved: number; total: number }
  | {
      state: "stored";
      digest: string;
      name: string;
      selection: boolean;
      bytes: number;
      /** Sealed to this phone's key. Otherwise a camera alone could have read it. */
      sealed: boolean;
      /** To read at once. A run's texts wait in the library, so `run` comes instead. */
      text: string | null;
      run: RunProgress | null;
    };

/** How far a *Print whole library* run has got, in the numbers the stick shows. */
export interface RunProgress {
  have: number;
  count: number;
  lacks: number[];
  lacks_more: number;
}

export type ReceiveError = "damaged" | "version" | "too_long" | "not_stored" | "other_key";

const grouped = new Intl.NumberFormat("en-US");

/** *Exact* means the stored bytes matched the digest, and it's never said before that. */
export function exact(bytes: number): string {
  return `Exact, ${grouped.format(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
}

export function receiving(resolved: number, total: number): string {
  return `Receiving, ${grouped.format(resolved)} of ${grouped.format(total)}`;
}

/** What's said beside a text that has just arrived: a print anyone could have filmed is
 * named, and a sealed one needs no word. */
export function arrivedAs(bytes: number, sealed: boolean): string {
  return sealed ? exact(bytes) : `${exact(bytes)}. Not sealed`;
}

/** How a run stands. "Exact" belongs here only when every text has passed its digest. */
export function runStanding(run: RunProgress): string {
  if (run.have >= run.count) {
    return run.count === 1
      ? "The 1 text is here, exact."
      : `All ${grouped.format(run.count)} texts are here, each exact.`;
  }
  const named = run.lacks.map((n) => grouped.format(n));
  const list =
    run.lacks_more > 0
      ? `${named.join(", ")} and ${grouped.format(run.lacks_more)} more`
      : named.length > 1
        ? `${named.slice(0, -1).join(", ")} and ${named.at(-1) ?? ""}`
        : (named[0] ?? "");
  return `${grouped.format(run.have)} of ${grouped.format(run.count)} texts are here. Still lacks ${list}.`;
}

/** As on the desktop's status line: the name is isolated without its ending, so an Arabic
 * name reads "سلام.md" in the interface's direction rather than "md.سلام". */
export function nameParts(name: string): { stem: string; ending: string } {
  const match = /\.(md|markdown)$/i.exec(name);
  return match
    ? { stem: name.slice(0, match.index), ending: match[0] }
    : { stem: name, ending: "" };
}

const refusals: Record<ReceiveError, string> = {
  damaged: "These codes didn't make a whole text, so nothing was stored. Show the print again.",
  version: "These codes are from another version of bismillah, so nothing was stored.",
  too_long: "This text is too long for this app, so nothing was stored.",
  not_stored: "The text arrived, but this phone couldn't store it, so nothing was kept.",
  other_key:
    "These codes are sealed to another key, so nothing was stored. Type this phone's key into the stick again.",
};

export function refused(error: unknown): string {
  return typeof error === "string" && Object.hasOwn(refusals, error)
    ? refusals[error as ReceiveError]
    : refusals.not_stored;
}
