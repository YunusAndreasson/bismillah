import { isError, type OpenedDocument, type SaveError, type SaveFailure } from "./ipc.ts";

/**
 * The open document's save state (ARCHITECTURE.md §5, DESIGN.md §12).
 *
 * Every edit is a new revision. Saves run about 500 ms after typing pauses, one at a
 * time: while one is in flight, newer edits wait and the newest text goes next. The
 * state says "saved" only when Rust has confirmed that the latest revision is durably
 * on disk, and a failure stays until a save succeeds or the writer acts.
 */

export type SaveState =
  | { kind: "saved" }
  /** Edits are waiting for the next save, or a save is in flight. */
  | { kind: "saving" }
  | { kind: "failed"; error: SaveError }
  /** The bundled specimen: edits are never saved. */
  | { kind: "sample" }
  /** Not UTF-8: opened for reading only. */
  | { kind: "read_only" };

export interface SaveIO {
  /** Resolves with the durable revision, or rejects with a `SaveFailure`. */
  save(id: number, text: string, revision: number, force: boolean): Promise<number>;
}

export const AUTOSAVE_DELAY_MS = 500;

export class DocumentSession {
  readonly id: number;
  /** Changes when the file is renamed from the library. */
  name = $state("");
  readonly sample: boolean;
  readonly readOnly: boolean;
  revision = $state(0);
  savedRevision = $state(0);
  state = $state<SaveState>({ kind: "saved" });

  #text: () => string;
  #io: SaveIO;
  #delay: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | null = null;
  #again = false;
  #force = false;
  #requiresResolution = false;
  #disposed = false;
  #recoveredRevision = $state(-1);

  constructor(doc: OpenedDocument, text: () => string, io: SaveIO, delay = AUTOSAVE_DELAY_MS) {
    this.id = doc.id;
    this.name = doc.name;
    this.sample = doc.sample;
    this.readOnly = doc.read_only;
    this.#text = text;
    this.#io = io;
    this.#delay = delay;
    if (doc.sample) this.state = { kind: "sample" };
    else if (doc.read_only) this.state = { kind: "read_only" };
  }

  get saveable(): boolean {
    return !this.sample && !this.readOnly && !this.#disposed;
  }

  /** Whether some edits are not yet durably on disk. */
  get dirty(): boolean {
    return this.revision > this.savedRevision;
  }

  /** Rust confirmed a durable recovery copy of the latest edits. */
  get recoveryCurrent(): boolean {
    return this.#recoveredRevision >= this.revision;
  }

  /** Replacing the editor or ending the process cannot lose these edits. */
  get canLeave(): boolean {
    if (this.#requiresResolution) return false;
    return this.sample || this.readOnly || !this.dirty || this.recoveryCurrent;
  }

  /** Records an edit and schedules a save after the typing pause. */
  edited(): void {
    this.revision++;
    if (!this.saveable) return;
    // A visible failure stays until a save succeeds; retries don't flicker it.
    if (this.state.kind !== "failed") this.state = { kind: "saving" };
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.save(), this.#delay);
  }

  /** A reload opened a new disk version but could not keep the latest local text.
   * Keep it visible; autosave must not silently overwrite the version just read. */
  requireConflictResolution(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#requiresResolution = true;
    this.#recoveredRevision = -1;
    this.state = { kind: "failed", error: { kind: "conflict" } };
  }

  /**
   * Saves now. With `force`, the save goes ahead even though the file changed on disk
   * ("Keep mine"). Resolves true when every edit is durably on disk.
   */
  save(force = false): Promise<boolean> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.saveable) return Promise.resolve(!this.dirty || this.sample);
    if (force) {
      this.#requiresResolution = false;
      this.#force = true;
    }
    if (this.#running) {
      this.#again = true;
      return this.#running.then(() => this.save());
    }
    if (this.#requiresResolution) return Promise.resolve(false);
    this.#running = this.#loop().finally(() => (this.#running = null));
    return this.#running.then(() => !this.dirty);
  }

  /** Saves pending edits now (Mod-S, window blur, switching documents, quitting). */
  flush(): Promise<boolean> {
    return this.save();
  }

  async #loop(): Promise<void> {
    for (;;) {
      this.#again = false;
      const revision = this.revision;
      if (revision <= this.savedRevision) {
        if (this.state.kind !== "failed" || !this.dirty) this.state = { kind: "saved" };
        return;
      }
      const force = this.#force;
      this.#force = false;
      if (this.state.kind !== "failed") this.state = { kind: "saving" };
      // A retry may overwrite the old mirror before its new durable write.
      // Never let a timeout rely on the previous recovery confirmation.
      this.#recoveredRevision = -1;
      try {
        const saved = await this.#io.save(this.id, this.#text(), revision, force);
        this.savedRevision = Math.max(this.savedRevision, saved);
      } catch (error) {
        if (isError<SaveFailure>(error) && error.recovered === true)
          this.#recoveredRevision = Math.max(this.#recoveredRevision, revision);
        this.state = {
          kind: "failed",
          error: isError<SaveError>(error) ? error : { kind: "other", detail: String(error) },
        };
        return;
      }
      if (this.#disposed) return;
      if (!this.dirty) {
        this.state = { kind: "saved" };
        return;
      }
      // Newer edits arrived during the save. If their save was already asked for, run
      // it now; otherwise their own typing pause will.
      if (!this.#again) {
        this.state = { kind: "saving" };
        return;
      }
    }
  }

  /** Stops scheduling saves (the document was replaced after a flush). */
  dispose(): void {
    clearTimeout(this.#timer);
    this.#disposed = true;
  }
}
