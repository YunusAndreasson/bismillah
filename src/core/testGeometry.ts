import type { EditorView } from "@codemirror/view";

/**
 * Read-only geometry probes for the WebDriver spike tests: where the caret, glyphs and
 * selection are actually drawn in the webview. Rectangles are in viewport CSS px.
 */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Cluster extends Box {
  /** UTF-16 offsets of the grapheme cluster in the document. */
  from: number;
  to: number;
  text: string;
}

const toBox = (r: DOMRect): Box => ({
  left: r.left,
  right: r.right,
  top: r.top,
  bottom: r.bottom,
});

export interface Geometry {
  caret(): (Box & { head: number }) | null;
  clusters(from: number, to: number): Cluster[];
  selectionBoxes(): Box[];
  lineBox(pos: number): Box & { dir: string | null; from: number; to: number };
  coords(pos: number, side: -1 | 1): Box | null;
}

export function geometry(view: EditorView): Geometry {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return {
    caret() {
      const el = view.dom.querySelector(".cm-cursor-primary");
      if (!el) return null;
      return { ...toBox(el.getBoundingClientRect()), head: view.state.selection.main.head };
    },
    clusters(from, to) {
      const text = view.state.sliceDoc(from, to);
      const out: Cluster[] = [];
      for (const { segment, index } of segmenter.segment(text)) {
        const start = from + index;
        const end = start + segment.length;
        const a = view.domAtPos(start);
        const b = view.domAtPos(end);
        const range = document.createRange();
        try {
          range.setStart(a.node, a.offset);
          range.setEnd(b.node, b.offset);
        } catch {
          continue;
        }
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        const rect = rects[0] ?? range.getBoundingClientRect();
        out.push({ ...toBox(rect), from: start, to: end, text: segment });
      }
      return out;
    },
    selectionBoxes() {
      return [...view.dom.querySelectorAll(".cm-selectionBackground")].map((el) =>
        toBox(el.getBoundingClientRect()),
      );
    },
    lineBox(pos) {
      const line = view.state.doc.lineAt(pos);
      const { node } = view.domAtPos(line.from);
      const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
      const box = el ? toBox(el.getBoundingClientRect()) : { left: 0, right: 0, top: 0, bottom: 0 };
      return { ...box, dir: el?.getAttribute("dir") ?? null, from: line.from, to: line.to };
    },
    coords(pos, side) {
      const rect = view.coordsAtPos(pos, side);
      return rect
        ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
        : null;
    },
  };
}
