import { markdownKeymap, markdownLanguage, pasteURLAsLink } from "@codemirror/lang-markdown";
import { Language, LanguageSupport } from "@codemirror/language";
import { MarkdownParser, type BlockContext, type Line, type MarkdownConfig } from "@lezer/markdown";
import { styleTags, tags as t } from "@lezer/highlight";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

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

/**
 * Where the frontmatter ends (after its closing fence, before the line break), or null
 * when the text has none: the same rule as the parser above, for code that works on
 * plain text (the caret's starting place). Without a closing fence
 * the frontmatter runs to the end, as it does in the editor.
 */
export function frontmatterEnd(text: string): number | null {
  const first = /^---[ \t]*(?:\n|$)/.exec(text);
  if (!first) return null;
  let pos = first[0].length;
  if (!first[0].endsWith("\n")) return text.length;
  while (pos <= text.length) {
    const next = text.indexOf("\n", pos);
    const end = next < 0 ? text.length : next;
    if (FENCE.test(text.slice(pos, end))) return end;
    if (next < 0) return text.length;
    pos = next + 1;
  }
  return text.length;
}

/**
 * The shared dialect: CommonMark + GFM + frontmatter (ARCHITECTURE.md §11), with
 * lang-markdown's Enter and Backspace for lists and quotes and its link on pasting an
 * address over a selection. Built from lang-markdown's own parser and language data (so
 * those commands know it as Markdown) rather than with `markdown()`, which also parses
 * HTML with the HTML, CSS and JavaScript grammars, for highlighting bismillah never
 * shows, and would load all three at every launch (ARCHITECTURE.md §14).
 */
const base = markdownLanguage.parser;
if (!(base instanceof MarkdownParser)) throw new Error("lang-markdown's parser has changed");
const dialect = new Language(markdownLanguage.data, base.configure([frontmatter]), [], "markdown");

export function markdownDialect(): Extension {
  return new LanguageSupport(dialect, [Prec.high(keymap.of(markdownKeymap)), pasteURLAsLink]);
}
