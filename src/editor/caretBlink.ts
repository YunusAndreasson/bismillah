import { type Extension } from "@codemirror/state";
import { drawSelection, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Blink at the two visible edges of a 1.2-second cycle, rather than asking WebKit
 * to run an infinite CSS animation. This avoids depending on WebKitGTK to skip
 * frames between animation steps. No editor transactions or measurements are needed.
 */
export function caretBlink(steady = false): Extension {
  return [
    drawSelection({ cursorBlinkRate: 0 }),
    EditorView.baseTheme({
      ".cm-cursorLayer": { animation: "none !important", willChange: "opacity" },
      "&[data-caret-hidden] .cm-cursorLayer": { opacity: "0" },
    }),
    steady
      ? []
      : ViewPlugin.fromClass(
          class {
            private timer: ReturnType<typeof setTimeout> | undefined;
            // Eight cycles, about ten seconds: then stay visible until interaction.
            private remaining = 16;
            private readonly motion = window.matchMedia("(prefers-reduced-motion: reduce)");

            constructor(private readonly view: EditorView) {
              view.dom.ownerDocument.addEventListener("visibilitychange", this.reset);
              this.motion.addEventListener("change", this.reset);
              this.reset();
            }

            private active(): boolean {
              return (
                this.view.hasFocus &&
                !this.view.dom.ownerDocument.hidden &&
                !this.motion.matches &&
                this.view.state.facet(EditorView.editable)
              );
            }

            private readonly tick = (): void => {
              this.timer = undefined;
              if (!this.active()) {
                this.reset();
                return;
              }
              this.view.dom.toggleAttribute("data-caret-hidden");
              if (--this.remaining > 0) this.timer = setTimeout(this.tick, 600);
            };

            private readonly reset = (): void => {
              clearTimeout(this.timer);
              this.timer = undefined;
              this.remaining = 16;
              this.view.dom.removeAttribute("data-caret-hidden");
              if (this.active()) this.timer = setTimeout(this.tick, 600);
            };

            update(update: ViewUpdate): void {
              if (
                update.docChanged ||
                update.selectionSet ||
                update.focusChanged ||
                update.startState.facet(EditorView.editable) !==
                  update.state.facet(EditorView.editable)
              )
                this.reset();
            }

            destroy(): void {
              clearTimeout(this.timer);
              this.view.dom.removeAttribute("data-caret-hidden");
              this.view.dom.ownerDocument.removeEventListener("visibilitychange", this.reset);
              this.motion.removeEventListener("change", this.reset);
            }
          },
        ),
  ];
}
