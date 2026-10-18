import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Where the caret line sits, as a fraction of the writing area (DESIGN.md §11). */
export const TYPEWRITER_POSITION = 0.42;

/**
 * Typewriter scrolling: after typing and keyboard motion, the caret line's top sits 42%
 * down the writing area. Every transaction that would scroll the caret into view gets
 * an explicit scroll target instead of CodeMirror's "nearest" scroll, which would only
 * keep the caret somewhere on screen. Mouse clicks don't scroll, so text never jumps
 * away from the pointer. The content gets padding (`.cm-typewriter`) so the first and
 * last lines can reach the 42% line.
 */
export function typewriter(): Extension {
  // The writing area's height, kept current by the plugin below. A transaction
  // extender has no view, so it reads the latest measurement from here.
  let height = 0;
  const measure = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        height = view.scrollDOM.clientHeight;
      }
      update(update: ViewUpdate) {
        if (update.geometryChanged) height = update.view.scrollDOM.clientHeight;
      }
    },
  );
  return [
    measure,
    EditorState.transactionExtender.of((tr) => {
      if (!tr.scrollIntoView || !height) return null;
      const head = tr.newSelection.main.head;
      return {
        effects: EditorView.scrollIntoView(head, {
          y: "start",
          yMargin: Math.round(height * TYPEWRITER_POSITION),
        }),
      };
    }),
    EditorView.editorAttributes.of({ class: "cm-typewriter" }),
  ];
}
