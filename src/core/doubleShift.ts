/**
 * Shift Shift opens Find anything (DESIGN.md §13). Two taps of Shift, each pressed and
 * released on its own, with no other key between them and the second within
 * `WINDOW_MS` of the first. Typing a capital puts a letter between the taps, so it never
 * counts; neither do a held or repeating Shift, both Shifts together (some layouts
 * switch with that), Shift with Ctrl, Alt or Super held (the stick switches layouts
 * with Alt+Shift), a mouse press during it (Shift+click extends a selection) or keys
 * inside an input method's composition.
 */

export const WINDOW_MS = 400;

export interface KeyMoment {
  type: "keydown" | "keyup";
  /** `KeyboardEvent.code`: "ShiftLeft", "ShiftRight", "KeyA"… */
  code: string;
  repeat: boolean;
  isComposing: boolean;
  /** Ctrl, Alt or Super is held. */
  modified: boolean;
  /** Milliseconds, from the event's `timeStamp`. */
  time: number;
}

const isShift = (code: string) => code === "ShiftLeft" || code === "ShiftRight";

export class DoubleShift {
  /** The Shift held now, alone, and when it went down; null when none is. */
  #press: { code: string; at: number } | null = null;
  /** This press can't be a tap: another key, a second Shift or a repeat came with it. */
  #spoiled = false;
  /** When the last tap was released, while it waits for its pair. */
  #tapAt: number | null = null;

  /** Feeds one key event; true when it completes the gesture. */
  feed(e: KeyMoment): boolean {
    if (e.isComposing || e.modified || !isShift(e.code)) {
      if (e.type === "keydown" || e.isComposing || e.modified) this.#spoil();
      if (e.modified && isShift(e.code) && e.type === "keyup") {
        this.#press = null;
        this.#spoiled = false;
      }
      return false;
    }
    if (e.type === "keydown") {
      if (e.repeat || this.#press) this.#spoil();
      else this.#press = { code: e.code, at: e.time };
      return false;
    }
    const press = this.#press;
    if (press?.code !== e.code) {
      // The other Shift of a pair, or a release we never saw pressed. The next press
      // starts clean.
      this.#tapAt = null;
      this.#press = null;
      this.#spoiled = false;
      return false;
    }
    this.#press = null;
    const tap = !this.#spoiled && e.time - press.at <= WINDOW_MS;
    this.#spoiled = false;
    if (!tap) {
      this.#tapAt = null;
      return false;
    }
    if (this.#tapAt !== null && e.time - this.#tapAt <= WINDOW_MS) {
      this.#tapAt = null;
      return true;
    }
    this.#tapAt = e.time;
    return false;
  }

  /** Something other than a key, such as a mouse press, came between the taps. */
  interrupt(): void {
    this.#spoil();
  }

  #spoil(): void {
    this.#tapAt = null;
    if (this.#press) this.#spoiled = true;
  }
}
