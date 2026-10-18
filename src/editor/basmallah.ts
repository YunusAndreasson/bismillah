import { StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/** The text of the opening, exactly as DESIGN.md §11.2 gives it. */
export const BASMALLAH = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

/**
 * The Basmallah opening (ADR-0008): a block widget above line 1, outside the document.
 * It is never part of the editable text, the file, counts or linting. Block widgets
 * that change vertical layout must come from a state field, not a view plugin.
 */
class BasmallahWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof BasmallahWidget;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-basmallah";
    el.lang = "ar";
    el.dir = "rtl";
    el.textContent = BASMALLAH;
    return el;
  }

  /** About 28px × 1.8 plus its margins; measured for real once drawn. */
  override get estimatedHeight(): number {
    return 140;
  }

  /** Let the browser handle events inside it, so the text can be selected natively. */
  override ignoreEvent(): boolean {
    return true;
  }
}

const widget = Decoration.widget({ widget: new BasmallahWidget(), block: true, side: -1 });

function decorations(): DecorationSet {
  return Decoration.set([widget.range(0)]);
}

const basmallahField = StateField.define<DecorationSet>({
  create: decorations,
  update: (value, tr) => (tr.docChanged ? value.map(tr.changes) : value),
  provide: (field) => EditorView.decorations.from(field),
});

export function basmallah(): Extension {
  return basmallahField;
}
