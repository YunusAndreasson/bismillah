import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Dispatched when fonts finish loading or a typography setting changes, so extensions
 * that measure rendered text (hanging marks, the Basmallah) measure again
 * (DESIGN.md §8.5 rule 6).
 */
export const remeasureTypography = StateEffect.define<null>();

export function remeasure(view: EditorView): void {
  view.dispatch({ effects: remeasureTypography.of(null) });
  view.requestMeasure();
}
