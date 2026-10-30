import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  showTooltip,
  ViewPlugin,
  type Tooltip,
  type TooltipView,
  type ViewUpdate,
} from "@codemirror/view";
import { canFormat, FORMAT_EVENT, formatState, type FormatState } from "./format.ts";

/**
 * The bar over a selection (ADR-0019). It follows a deliberate selection only: the
 * release of the mouse, or a pause after the last Shift+arrow. Typing, a search match or
 * focus going elsewhere puts it away. Focus stays in the text until the writer moves
 * into the bar with F6. The contents come from the app, through `mount`.
 */

/** Long enough that a run of Shift+arrows doesn't make it flicker. */
export const KEYBOARD_PAUSE_MS = 300;

/** The bar's contents, mounted in `dom`; the app's Svelte component in practice. */
export type FormatBarMount = (
  view: EditorView,
  dom: HTMLElement,
  format: FormatState,
) => { update(format: FormatState): void; destroy(): void };

const setShown = StateEffect.define<boolean>();

export const barShown = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setShown)) return effect.value;
    if (!value || tr.isUserEvent(FORMAT_EVENT)) return value;
    if (tr.docChanged) return false;
    // CodeMirror also re-reads an unchanged DOM selection on its own; that keeps the bar.
    return !(tr.selection && !tr.selection.eq(tr.startState.selection));
  },
});

/** Whether a transaction's selection is one the writer made, by mouse or keyboard. A
 * match from Find or an issue from F7 is the app's selection and brings no bar. */
const madeByWriter = (update: ViewUpdate) =>
  update.transactions.some((tr) => tr.isUserEvent("select") && !tr.isUserEvent("select.search"));

const follow = ViewPlugin.fromClass(
  class {
    private pressed = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly release = () => {
      if (!this.pressed) return;
      this.pressed = false;
      // After CodeMirror's own release handler and live preview's reveal.
      this.schedule(0);
    };
    private readonly focusMoved = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (this.view.dom.contains(target) || target.closest(".format-menu")) return;
      this.hide();
    };
    private readonly windowBlur = () => {
      // A release outside the window never reaches us.
      this.pressed = false;
      this.hide();
    };

    constructor(readonly view: EditorView) {
      window.addEventListener("mouseup", this.release);
      window.addEventListener("dragend", this.release);
      window.addEventListener("blur", this.windowBlur);
      document.addEventListener("focusin", this.focusMoved);
    }

    press() {
      this.pressed = true;
      this.clear();
    }

    update(update: ViewUpdate) {
      if (update.focusChanged && update.view.hasFocus) {
        // Back from Search or another window, the selection is still there.
        if (!this.pressed) this.schedule(KEYBOARD_PAUSE_MS);
        return;
      }
      if (update.docChanged && !update.transactions.some((tr) => tr.isUserEvent(FORMAT_EVENT))) {
        this.clear();
        return;
      }
      if (!update.selectionSet || !madeByWriter(update)) return;
      const byPointer = update.transactions.some((tr) => tr.isUserEvent("select.pointer"));
      if (this.pressed && byPointer) return;
      // The keyboard moving the selection during a press ends the press, as in live preview.
      this.pressed = false;
      this.schedule(KEYBOARD_PAUSE_MS);
    }

    private schedule(ms: number) {
      this.clear();
      this.timer = setTimeout(() => {
        this.timer = null;
        const { view } = this;
        if (!canFormat(view.state) || view.state.field(barShown)) return;
        view.dispatch({ effects: setShown.of(true) });
      }, ms);
    }

    private clear() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }

    private hide() {
      this.clear();
      if (this.view.state.field(barShown)) this.view.dispatch({ effects: setShown.of(false) });
    }

    destroy() {
      this.clear();
      window.removeEventListener("mouseup", this.release);
      window.removeEventListener("dragend", this.release);
      window.removeEventListener("blur", this.windowBlur);
      document.removeEventListener("focusin", this.focusMoved);
    }
  },
  {
    eventHandlers: {
      mousedown(event) {
        if (event.button === 0) this.press();
      },
    },
  },
);

/** Moves focus into the bar (F6), bringing it up first if the selection allows it. */
export function focusFormatBar(view: EditorView): boolean {
  if (!canFormat(view.state)) return false;
  const { head } = view.state.selection.main;
  view.dispatch({
    effects: [setShown.of(true), EditorView.scrollIntoView(head, { y: "nearest" })],
  });
  view.dom.querySelector<HTMLElement>(".format-bar [tabindex='0']")?.focus();
  return true;
}

/** Whether the bar is up. False in a state without this extension. */
export function isBarShown(state: EditorState): boolean {
  return (state.field(barShown, false) ?? false) && canFormat(state);
}

export function formatBar(mount: FormatBarMount): Extension {
  // The same `create` keeps the mounted bar as the selection moves under a format action.
  const create = (view: EditorView): TooltipView => {
    const dom = document.createElement("div");
    const bar = mount(view, dom, formatState(view.state));
    return {
      dom,
      update(update) {
        if (update.docChanged || update.selectionSet) bar.update(formatState(update.state));
      },
      destroy: () => bar.destroy(),
      // A selection on one row: the bar starts over its left edge, whichever way that row
      // reads. Across rows, over the head, where the writer's eye and pointer ended up.
      getCoords: (pos) => {
        const { from, to } = view.state.selection.main;
        const start = view.coordsAtPos(from, 1);
        const end = view.coordsAtPos(to, -1);
        const here = view.coordsAtPos(pos);
        if (!start || !end || start.top !== end.top) return here ?? new DOMRect();
        const left = Math.min(start.left, end.left);
        return { left, right: left, top: start.top, bottom: start.bottom };
      },
    };
  };
  return [
    barShown,
    follow,
    showTooltip.compute([barShown, "doc", "selection"], (state): Tooltip | null =>
      isBarShown(state)
        ? { pos: state.selection.main.head, above: true, arrow: false, create }
        : null,
    ),
  ];
}
