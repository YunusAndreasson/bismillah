import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** Inline token classes. Colours and fonts live in CSS (DESIGN.md §9, §11). */
export const inlineStyle = HighlightStyle.define([
  { tag: t.processingInstruction, class: "cm-mark" },
  { tag: t.contentSeparator, class: "cm-mark" },
  { tag: t.atom, class: "cm-mark" },
  { tag: t.emphasis, class: "cm-em" },
  { tag: t.strong, class: "cm-strong" },
  { tag: t.strikethrough, class: "cm-strike" },
  { tag: t.monospace, class: "cm-code" },
  { tag: t.url, class: "cm-url" },
  { tag: t.labelName, class: "cm-label" },
  { tag: t.meta, class: "cm-meta" },
]);

const HEADING = /^(?:ATXHeading|SetextHeading)([1-6])$/;
const lineClass = (cls: string) => Decoration.line({ class: cls });

/** Line classes for block structure: heading levels (and whether text is right against
 * them), code blocks, quotes, frontmatter. */
export function blockClasses(view: Pick<EditorView, "state" | "visibleRanges">): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const classes = new Map<number, string[]>();
  const add = (lineFrom: number, cls: string) => {
    const list = classes.get(lineFrom);
    if (list) list.push(cls);
    else classes.set(lineFrom, [cls]);
  };
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        let cls: string | null = null;
        const heading = HEADING.exec(node.name);
        if (heading) cls = `cm-h${heading[1]}`;
        else if (node.name === "FencedCode" || node.name === "CodeBlock") cls = "cm-codeblock";
        else if (node.name === "Frontmatter") cls = "cm-frontmatter";
        else if (node.name === "Blockquote") cls = "cm-quote";
        else if (node.name === "HorizontalRule") cls = "cm-hr";
        if (!cls) return true;
        // A code block or quote can span an entire book. Only walk its visible
        // lines, including the whole line at each clipped edge.
        const end = Math.min(node.to, to);
        for (let pos = Math.max(node.from, from); pos <= end;) {
          const line = doc.lineAt(pos);
          if (line.to >= from && line.from <= to) add(line.from, cls);
          pos = line.to + 1;
        }
        if (heading) {
          // Text right against a heading gets the space a blank line would give, so the
          // writer never needs an extra Enter for it (DESIGN.md §8.4).
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (first.number > 1 && doc.line(first.number - 1).text.trim() !== "")
            add(first.from, "cm-h-joined-above");
          if (last.number < doc.lines && doc.line(last.number + 1).text.trim() !== "")
            add(last.from, "cm-h-joined-below");
        }
        // Headings and code are leaves for our purposes; quotes contain other blocks.
        if (cls !== "cm-quote") return false;
        return true;
      },
    });
  }
  for (const lineFrom of [...classes.keys()].sort((a, b) => a - b)) {
    builder.add(lineFrom, lineFrom, lineClass([...new Set(classes.get(lineFrom))].join(" ")));
  }
  return builder.finish();
}

const blockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = blockClasses(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = blockClasses(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Visible-markup styling (ADR-0002): marks stay visible, structure is shown by type. */
export function markdownStyling(): Extension {
  return [syntaxHighlighting(inlineStyle), blockPlugin];
}
