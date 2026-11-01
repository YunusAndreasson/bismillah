import * as ipc from "./ipc.ts";

/**
 * One print to the phone, while its dialog is open (ADR-0021). It knows nothing of what
 * the phone received: there is no way back from the phone, so it never claims delivery.
 * The timer runs only while frames are playing; nothing runs once it is paused or closed.
 */

/** A module smaller than this, in device pixels, is too fine to trust to a camera.
 * Provisional until a real phone has read them. */
export const MIN_MODULE_PIXELS = 4;
/** Longer than any print needs to be left running by accident: stop moving, stay quiet. */
export const REST_AFTER_MS = 5 * 60 * 1000;

export interface PrintSubject {
  id: number;
  name: string;
  text: string;
  selection: boolean;
  words: number;
  /** Every text in the library, from the disk: `text` is then unused. */
  library?: { unsaved: boolean };
}

export type PrintStatus =
  | "measuring"
  | "preparing"
  | "ready" // Waits for the writer: reduced motion never starts by itself.
  | "playing"
  | "paused"
  | "rested"
  | "still"
  | "too-small"
  | "failed"
  | "nothing"; // A library with no text to print.

export interface PrintIO {
  sizes(): Promise<ipc.PrintSizes>;
  start(subject: PrintSubject, density: number, from: number): Promise<ipc.PrintJob>;
  goTo(index: number): Promise<void>;
  frame(): Promise<ipc.PrintFrame | null>;
  stop(): Promise<void>;
}

export const printIO: PrintIO = {
  sizes: ipc.printSizes,
  start: (s, density, from) =>
    s.library
      ? ipc.printLibraryStart(density, from)
      : ipc.printStart(s.id, s.text, s.selection, density),
  goTo: ipc.printGoTo,
  frame: ipc.printFrame,
  stop: ipc.printStop,
};

/** The densest QR size whose modules stay large enough in `pixels`, or null. */
export function chooseDensity(pixels: number, sides: readonly number[]): number | null {
  const index = sides.findIndex((side) => Math.floor(pixels / side) >= MIN_MODULE_PIXELS);
  return index < 0 ? null : index;
}

let held = false;
/** Tests: every print opens as under reduced motion, on a first frame that stays. */
export const holdPrints = (on: boolean) => (held = on);

const opensHeld = () => held || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class PrintRun {
  status = $state<PrintStatus>("measuring");
  job = $state.raw<ipc.PrintJob | null>(null);
  frame = $state.raw<ipc.PrintFrame | null>(null);
  density = $state<number | null>(null);
  /** Frames shown so far. */
  shown = $state(0);

  readonly subject: PrintSubject;
  #io: PrintIO;
  #sizes: ipc.PrintSizes | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #playedFor = 0;
  #closed = false;
  /** Which start or resize is current, so a slow one can't overwrite a newer one. */
  #generation = 0;

  constructor(subject: PrintSubject, io: PrintIO) {
    this.subject = subject;
    this.#io = io;
  }

  /** Fits the code to the room there is, in device pixels. A new QR size starts afresh;
   * the same one carries on. */
  async fit(pixels: number): Promise<void> {
    if (this.#closed) return;
    try {
      this.#sizes ??= await this.#io.sizes();
    } catch {
      this.#fail();
      return;
    }
    if (this.#closed) return;
    const density = chooseDensity(pixels, this.#sizes.sides);
    if (density === this.density && this.status !== "measuring") return;
    this.density = density;
    this.#stopTimer();
    const generation = ++this.#generation;
    if (density === null) {
      this.frame = null;
      this.status = "too-small";
      void this.#io.stop().catch(() => {});
      return;
    }
    this.status = "preparing";
    try {
      const job = await this.#io.start(this.subject, density, this.frame?.place?.index ?? 0);
      if (generation !== this.#generation) return;
      if (this.#closed) {
        void this.#io.stop().catch(() => {});
        return;
      }
      this.job = job;
      await this.#show();
      if (generation !== this.#generation || this.#closed) return;
      if (job.still) this.status = "still";
      else if (opensHeld()) this.status = "ready";
      else this.play();
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#fail();
      if (error === "empty") this.status = "nothing";
    }
  }

  /** Starts or resumes the frames. */
  play(): void {
    if (this.#closed || this.job === null || this.job.still) return;
    if (this.status === "rested") this.#playedFor = 0;
    this.status = "playing";
    this.#schedule();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.#stopTimer();
    this.status = "paused";
  }

  toggle(): void {
    if (this.status === "playing") this.pause();
    else if (this.status === "paused" || this.status === "rested" || this.status === "ready")
      this.play();
  }

  /** Goes straight to a text of a library run, from 0, as the phone asks for it. */
  async goTo(index: number): Promise<void> {
    if (this.#closed || !this.job?.texts) return;
    const generation = this.#generation;
    try {
      await this.#io.goTo(Math.min(Math.max(index, 0), this.job.texts - 1));
      if (generation === this.#generation && this.status !== "playing") await this.#show();
    } catch {
      if (generation === this.#generation) this.#fail();
    }
  }

  /** Stops for good and lets go of the text. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation++;
    this.#stopTimer();
    void this.#io.stop().catch(() => {});
  }

  #schedule(): void {
    const interval = 1000 / (this.#sizes?.frames_per_second ?? 6);
    this.#timer = setTimeout(() => void this.#tick(interval), interval);
  }

  /** One frame at a time: the next is asked for only once this one is drawn, so a slow
   * machine shows fewer frames rather than falling behind. */
  async #tick(interval: number): Promise<void> {
    const generation = this.#generation;
    try {
      await this.#show();
    } catch {
      if (generation === this.#generation) this.#fail();
      return;
    }
    if (generation !== this.#generation || this.status !== "playing") return;
    this.#playedFor += interval;
    if (this.#playedFor >= this.#restAfter()) {
      this.status = "rested";
      return;
    }
    this.#schedule();
  }

  /** A library run takes as long as it takes: it rests only once it has gone round more
   * than a camera should need, the first two rounds and their slower third. */
  #restAfter(): number {
    return Math.max(REST_AFTER_MS, this.job?.texts ? 4 * this.job.seconds * 1000 : 0);
  }

  async #show(): Promise<void> {
    const frame = await this.#io.frame();
    if (frame === null || this.#closed) return;
    this.frame = frame;
    this.shown++;
  }

  #stopTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #fail(): void {
    this.#stopTimer();
    this.frame = null;
    this.status = "failed";
  }
}
