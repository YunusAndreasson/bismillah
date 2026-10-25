import { StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { BASMALLAH_INK } from "./basmallahInk.ts";

/** The text of the opening, exactly as DESIGN.md §11.2 gives it. */
export const BASMALLAH = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The Basmallah opening (ADR-0008): a block widget above line 1, outside the document.
 * It is never part of the editable text, the file, counts or linting. Block widgets
 * that change vertical layout must come from a state field, not a view plugin.
 *
 * The visible ink is a quiet calligraphic wordmark, Amiri's ligature ﷽, as an SVG path
 * pre-shaped by HarfBuzz (`basmallahInk.ts`, ADR-0011), laid over the real text. The text stays
 * in the page, transparent, so it can be selected and copied and is what screen readers
 * read; the SVG is hidden from them. Text and ink share one line: the SVG's baseline is
 * the text's baseline (its `vertical-align` is its descent), and a negative inline
 * margin of its own width lays the text over the same advance box. editor.css has the
 * rules.
 */
class BasmallahWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof BasmallahWidget;
  }

  toDOM(): HTMLElement {
    const ink = BASMALLAH_INK;
    const em = (units: number) => String(units / ink.unitsPerEm);
    const el = document.createElement("div");
    el.className = "cm-basmallah";
    el.lang = "ar";
    el.dir = "rtl";
    // Custom properties through CSSOM, which the CSP allows (ARCHITECTURE.md §10).
    el.style.setProperty("--basmallah-advance", em(ink.advance));
    el.style.setProperty("--basmallah-ascent", em(ink.ascent));
    el.style.setProperty("--basmallah-descent", em(ink.descent));

    const line = document.createElement("span");
    line.className = "cm-basmallah-line";
    const text = document.createElement("span");
    text.className = "cm-basmallah-text";
    text.textContent = BASMALLAH;

    // Inline boxes paint in visual order, left to right. The ink comes first in this
    // right-to-left line, so it sits rightmost, paints last, and stays on top of the
    // text's selection background.
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cm-basmallah-ink");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("viewBox", `0 ${-ink.ascent} ${ink.advance} ${ink.ascent + ink.descent}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ink.d);
    svg.append(path);

    line.append(svg, text);
    el.append(line);
    return el;
  }

  /** About 17px × 1.8 plus 1.5 body lines; measured for real once drawn. */
  override get estimatedHeight(): number {
    return 79;
  }

  /** Let the browser handle events inside it, so the text can be selected natively. */
  override ignoreEvent(): boolean {
    return true;
  }
}

const widget = Decoration.widget({ widget: new BasmallahWidget(), block: true, side: -1 });

// ---------------------------------------------------------------------------------------
// Deduplication (DESIGN.md §11.2): no opening when the document already starts with one.
// A narrow comparison of one block's letters, never general religious-text detection.

/**
 * Ignored in the comparison: combining marks (vocalisation, superscript alef, Qur'anic
 * annotation), format characters (direction marks, joiners) and tatweel.
 */
const IGNORED = /\p{Mn}|\p{Cf}|\u0640/gu;
const BARE = "بسم الله الرحمن الرحيم";
/** ﷽, the Basmallah as a single ligature character. */
const LIGATURE = "\uFDFD";
const TRAILING_STOP = /[.,،۔؛]$/u;

/** True if `text`, read as plain inline text, is the Basmallah and nothing else. */
export function isBasmallah(text: string): boolean {
  const letters = text
    .replace(IGNORED, "")
    .replace(/\u0671/gu, "\u0627") // alef wasla → alef
    .replace(/\s+/gu, " ")
    .trim()
    .replace(TRAILING_STOP, "")
    .trim();
  return letters === BARE || letters === LIGATURE;
}

const ATX = /^ {0,3}#{1,6}(?=[ \t]|$)/;
const ATX_CLOSE = /[ \t]+#+[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
/** Lines that start a new block and so end a paragraph instead of continuing it. */
const INTERRUPTS =
  /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|`{3}|~{3}|[-*+][ \t]|1[.)][ \t]|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;
const FRONTMATTER_OPEN = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * True if a block's Markdown source is a standalone Basmallah: a paragraph, an ATX
 * heading or a setext heading whose only content is the Basmallah.
 */
export function isStandaloneBasmallah(block: string): boolean {
  const lines = block.split("\n");
  const first = lines[0] ?? "";
  if (INDENTED_CODE.test(first)) return false;
  if (lines.length === 2 && SETEXT.test(lines[1] ?? "")) return isBasmallah(first);
  if (lines.length !== 1) return false;
  if (ATX.test(first)) return isBasmallah(first.replace(ATX, "").replace(ATX_CLOSE, ""));
  return isBasmallah(first);
}

/**
 * The source of the document's first content block, after any YAML frontmatter and
 * blank lines, or null if there is none. Only as much of the block is returned as
 * deciding needs: a heading's line, or a paragraph's first line plus the next line when
 * it continues the paragraph (which already makes the block more than a Basmallah).
 */
export function firstContentBlock(doc: Text): string | null {
  let n = 1;
  if (FRONTMATTER_OPEN.test(doc.line(1).text)) {
    n = 2;
    while (n <= doc.lines && !FRONTMATTER_CLOSE.test(doc.line(n).text)) n++;
    n++; // past the closing fence; unclosed frontmatter runs to the end (dialect.ts)
  }
  while (n <= doc.lines && doc.line(n).text.trim() === "") n++;
  if (n > doc.lines) return null;
  const first = doc.line(n).text;
  if (ATX.test(first) || INDENTED_CODE.test(first) || n === doc.lines) return first;
  const next = doc.line(n + 1).text;
  if (next.trim() === "") return first;
  if (SETEXT.test(next)) return `${first}\n${next}`;
  if (INTERRUPTS.test(next)) return first;
  return `${first}\n${next}`; // a lazy continuation line joins the paragraph
}

/** True if the document's first content block already is a standalone Basmallah. */
export function opensWithBasmallah(doc: Text): boolean {
  const block = firstContentBlock(doc);
  return block !== null && isStandaloneBasmallah(block);
}

function decorations(doc: Text): DecorationSet {
  return opensWithBasmallah(doc) ? Decoration.none : Decoration.set([widget.range(0)]);
}

const basmallahField = StateField.define<DecorationSet>({
  create: (state) => decorations(state.doc),
  update(value, tr) {
    if (!tr.docChanged) return value;
    const shown = value.size > 0;
    // The widget always sits at 0, so only whether it is shown can change.
    return shown === !opensWithBasmallah(tr.newDoc)
      ? value.map(tr.changes)
      : decorations(tr.newDoc);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Whether the opening is drawn for this state (false when switched off or deduplicated). */
export function basmallahShown(state: EditorState): boolean {
  return (state.field(basmallahField, false)?.size ?? 0) > 0;
}

/**
 * Copying a selection inside the opening copies exactly the selected text. Without
 * this, CodeMirror would copy its own (empty) selection's whole line instead.
 */
function copyOpening(event: ClipboardEvent, view: EditorView): boolean {
  const selection = document.getSelection();
  const opening = view.dom.querySelector(".cm-basmallah");
  if (!selection || selection.isCollapsed || !opening || !event.clipboardData) return false;
  if (!opening.contains(selection.anchorNode) || !opening.contains(selection.focusNode))
    return false;
  event.clipboardData.setData("text/plain", selection.toString());
  return true; // CodeMirror then prevents the default copy (and any cut)
}

export function basmallah(): Extension {
  return [basmallahField, EditorView.domEventHandlers({ copy: copyOpening, cut: copyOpening })];
}
