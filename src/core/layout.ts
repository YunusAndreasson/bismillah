/**
 * Where the library goes at a given window width (DESIGN.md §7). It docks only when its
 * width, the gap and edge padding *and* the whole writing column (measure plus hanging
 * gutters) fit beside it; otherwise it opens as an overlay.
 *
 * Docked, the column stays centred in the window whenever the margin is wide enough to
 * hold the library, so opening it moves no text. When the margin is narrower, the column
 * moves just far enough to clear the library: `offset` is the extra inline-start padding
 * that puts it there. The column never narrows for the library.
 */

export const LIBRARY_WIDTH = 240;
export const LIBRARY_GAP = 24;
export const LIBRARY_EDGE = 24;
/** Edge padding, the library and the gap: what the column must clear. */
export const LIBRARY_RESERVE = LIBRARY_EDGE + LIBRARY_WIDTH + LIBRARY_GAP;
/** Below this the library is always an overlay (DESIGN.md §7, "< ~900px"). */
export const DOCK_MIN_WIDTH = 900;
/** The column to plan for before any document has been opened. */
export const DEFAULT_COLUMN = 640;

export interface LibraryLayout {
  mode: "docked" | "overlay";
  /** CSS px of inline-start padding for the writing area while docked. */
  offset: number;
}

export function libraryLayout(windowWidth: number, columnWidth: number): LibraryLayout {
  const fits = windowWidth >= DOCK_MIN_WIDTH && windowWidth - LIBRARY_RESERVE >= columnWidth;
  if (!fits) return { mode: "overlay", offset: 0 };
  const margin = (windowWidth - columnWidth) / 2;
  return { mode: "docked", offset: Math.max(0, Math.round(2 * (LIBRARY_RESERVE - margin))) };
}
