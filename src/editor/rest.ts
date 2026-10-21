import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Escape puts the pen down (DESIGN.md §11): the caret hides, the block it was in folds
 * back to its rendered look and Zuhd mode lights no sentence or paragraph, so the page
 * reads as a whole. Typing, a key that moves the caret, a click, or the text taking focus
 * back (from a menu, the palette, the library) picks the pen up where it was. Nothing in
 * the text changes; a selection collapses to its head.
 */

export const setResting = StateEffect.define<boolean>();

const restingField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setResting)) return effect.value;
    if (!value) return false;
    // CodeMirror also re-reads an unchanged DOM selection on its own; that keeps the rest.
    const moved = tr.selection !== undefined && !tr.selection.eq(tr.startState.selection);
    return !(tr.docChanged || moved || tr.isUserEvent("select"));
  },
  provide: (field) =>
    EditorView.editorAttributes.compute([field], (state) =>
      state.field(field) ? { class: "cm-resting" } : {},
    ),
});

/** Whether the pen is down. False in a state without this extension. */
export function isResting(state: EditorState): boolean {
  return state.field(restingField, false) ?? false;
}

/** Whether a transaction put the pen down or picked it up. */
export function restChanged(start: EditorState, end: EditorState): boolean {
  return isResting(start) !== isResting(end);
}

function putDown(view: EditorView): boolean {
  if (isResting(view.state)) return false;
  const { main } = view.state.selection;
  view.dispatch({
    effects: setResting.of(true),
    selection: main.empty ? undefined : EditorSelection.cursor(main.head),
  });
  return true;
}

export function rest(): Extension {
  return [
    restingField,
    // Ahead of CodeMirror's own Escape, which only drops extra selections.
    Prec.high(keymap.of([{ key: "Escape", run: putDown }])),
    EditorView.focusChangeEffect.of((state, focusing) =>
      focusing && isResting(state) ? setResting.of(false) : null,
    ),
    EditorView.baseTheme({ "&.cm-resting .cm-cursorLayer": { visibility: "hidden" } }),
  ];
}
