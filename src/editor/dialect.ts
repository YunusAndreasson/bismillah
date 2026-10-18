import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import { styleTags, tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const FENCE = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * YAML frontmatter: a `---` on the very first line, up to the next `---` or `...`
 * (ARCHITECTURE.md §11). Its contents are never parsed as Markdown, so they are never
 * styled, hung or linted as prose.
 */
export const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true }, { name: "FrontmatterMark" }],
  props: [styleTags({ Frontmatter: t.meta, FrontmatterMark: t.processingInstruction })],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || !/^---[ \t]*$/.test(line.text)) return false;
        const from = cx.lineStart;
        const marks = [cx.elt("FrontmatterMark", from, from + 3)];
        let end = from + line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (FENCE.test(line.text)) {
            marks.push(cx.elt("FrontmatterMark", cx.lineStart, cx.lineStart + 3));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("Frontmatter", from, end, marks));
        return true;
      },
    },
  ],
};

/** The shared dialect: CommonMark + GFM + frontmatter (ARCHITECTURE.md §11). */
export function markdownDialect(): Extension {
  return markdown({ base: markdownLanguage, extensions: [frontmatter] });
}
