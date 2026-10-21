import { syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { normaliseLabel, references } from "./livePreview.ts";
import { tablePosAt } from "./previewTables.ts";

/**
 * Links open in the writer's browser or mail app on an explicit Ctrl+click (Cmd+click
 * on macOS) or *Open link* (ADR-0003, DESIGN.md §11): never on a plain click, which
 * puts the caret in the text, and never in the webview. Rust checks the address and
 * hands it to the system (src-tauri/src/links.rs); this file only finds the link.
 */

/** Where a link or image leads: its URL, or its reference's; null for none. */
export function linkAddress(state: EditorState, node: SyntaxNode): string | null {
  const url = node.getChild("URL");
  if (url) return state.sliceDoc(url.from, url.to);
  const marks = node.getChildren("LinkMark");
  const start = marks[0];
  const close = marks.find((m) => state.sliceDoc(m.from, m.to) === "]");
  if (!start || !close) return null;
  const label = node.getChild("LinkLabel");
  const name =
    label && label.to - label.from > 2
      ? state.sliceDoc(label.from + 1, label.to - 1)
      : state.sliceDoc(start.to, close.from);
  return references(state).links.get(normaliseLabel(name)) ?? null;
}

/** Whether the address is one Ctrl+click opens: the web or email. Rust decides
 * (src-tauri/src/links.rs); this only lets the tooltip say so. */
export function opensOutside(address: string): boolean {
  const a = address.trim().replace(/^<(.*)>$/s, "$1");
  return (
    /^(?:https?:\/\/|www\.|mailto:)/i.test(a) || /^[^\s@/:<>]+@[^\s@/<>]+\.[^\s@/<>]+$/.test(a)
  );
}

/** A link in the text, and where it leads as written. */
export interface FoundLink {
  from: number;
  to: number;
  address: string;
}

/**
 * The link `node` is: a found link; null for one that leads nowhere (a footnote, an
 * undefined `[sic]`), which ends the search; undefined for no link, so its parent is
 * asked next. A linked image is its link.
 */
function linkOf(state: EditorState, node: SyntaxNode): FoundLink | null | undefined {
  const at = (address: string | null) =>
    address ? { from: node.from, to: node.to, address } : null;
  switch (node.name) {
    case "Link":
      if (state.sliceDoc(node.from, node.from + 2) === "[^") return null;
      return at(linkAddress(state, node));
    case "Autolink":
    case "LinkReference": {
      const url = node.getChild("URL");
      return at(url ? state.sliceDoc(url.from, url.to) : null);
    }
    case "URL":
      // A bare address; the others belong to the node above.
      return node.parent && /^(?:Link|Autolink|LinkReference|Image)$/.test(node.parent.name)
        ? undefined
        : at(state.sliceDoc(node.from, node.to));
    default:
      return undefined;
  }
}

/** The link at `pos` (on either side of it): an inline or reference link, an autolink,
 * a bare address, or a link's definition. */
export function linkAt(state: EditorState, pos: number): FoundLink | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      const found = linkOf(state, node);
      if (found) return found;
      if (found === null) break;
    }
  }
  return null;
}

/** Whether a point is on the link's drawn text, not beside it at a line's end. */
function covers(view: EditorView, link: FoundLink, x: number, y: number): boolean {
  const start = view.domAtPos(link.from);
  const end = view.domAtPos(link.to);
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return false;
  }
  for (const box of range.getClientRects()) {
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true;
  }
  return false;
}

/** The link drawn under a point: in the text, or in a table drawn as a grid. */
export function linkAtPoint(view: EditorView, x: number, y: number): FoundLink | null {
  const inTable = tablePosAt(view, x, y);
  if (inTable) {
    // On a cell's link text only, not the space around it.
    if (!document.elementFromPoint(x, y)?.closest(".cm-md-link")) return null;
    return linkAt(view.state, inTable.pos);
  }
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return null;
  const link = linkAt(view.state, pos);
  return link && covers(view, link, x, y) ? link : null;
}

const isMod = (event: MouseEvent | KeyboardEvent) =>
  /Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;

/** Whether the pointer is on a link with Ctrl held: it shows as a hand. */
const setOnLink = StateEffect.define<boolean>();
const onLink = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setOnLink) ? e.value : v), value),
  provide: (field) =>
    EditorView.contentAttributes.compute([field], (state) =>
      state.field(field) ? { class: "cm-on-link" } : {},
    ),
});

function pointAt(view: EditorView, on: boolean): void {
  if (view.state.field(onLink) !== on) view.dispatch({ effects: setOnLink.of(on) });
}

/** Ctrl+click on a link calls `open` with its address, as written. */
export function links(open: (address: string) => void): Extension {
  return [
    onLink,
    // Before live preview's own press handling, which would reveal the block.
    Prec.highest(
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (event.button !== 0 || !isMod(event) || event.shiftKey || event.altKey) return false;
          const link = linkAtPoint(view, event.clientX, event.clientY);
          if (!link) return false;
          event.preventDefault();
          open(link.address);
          return true;
        },
        mousemove(event, view) {
          pointAt(view, isMod(event) && linkAtPoint(view, event.clientX, event.clientY) !== null);
          return false;
        },
        mouseleave(_event, view) {
          pointAt(view, false);
          return false;
        },
        keyup(event, view) {
          if (!isMod(event)) pointAt(view, false);
          return false;
        },
      }),
    ),
  ];
}
