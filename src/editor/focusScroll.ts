import { ViewPlugin, type EditorView } from "@codemirror/view";

/**
 * Focus coming back to the text never moves it. A dialog closing (Settings, the
 * palette, About, a prompt) returns focus with a plain `focus()`, and WebKit then
 * scrolls the whole content element into view: a long document jumped to its top.
 * The jump happens inside that `focus()`, after `focusin`, so the position seen on
 * `focusin` is put back before the frame is drawn. CodeMirror's own `view.focus()`
 * never scrolls, and a click doesn't either, so for them this changes nothing.
 */
export function focusKeepsScroll() {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("focusin", this.keep);
      }

      readonly keep = (): void => {
        const scroller = this.view.scrollDOM;
        const top = scroller.scrollTop;
        queueMicrotask(() => {
          if (scroller.scrollTop !== top) scroller.scrollTop = top;
        });
      };

      destroy(): void {
        this.view.contentDOM.removeEventListener("focusin", this.keep);
      }
    },
  );
}
