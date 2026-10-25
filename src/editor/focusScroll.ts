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
      private top: number;
      private readonly resize: ResizeObserver;

      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("focusin", this.keep);
        this.top = view.scrollDOM.getBoundingClientRect().top;
        this.resize = new ResizeObserver(() => this.keepRow());
        this.resize.observe(view.scrollDOM);
      }

      /** Top panels resize the scroller before paint. Compensate their offset only
       * when the reading row still fits below the panel; near the document's start
       * or an occluded caret, ordinary scrolling keeps the text reachable. */
      private keepRow(): void {
        const scroller = this.view.scrollDOM;
        const box = scroller.getBoundingClientRect();
        const delta = box.top - this.top;
        this.top = box.top;
        if (Math.abs(delta) < 0.5) return;
        const { main } = this.view.state.selection;
        const caret = this.view.coordsAtPos(main.head, main.assoc < 0 ? -1 : 1);
        if (!caret || caret.top - delta < box.top || caret.bottom - delta > box.bottom) return;
        scroller.scrollTop += delta;
        this.view.requestMeasure();
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
        this.resize.disconnect();
      }
    },
  );
}
