import DOMPurify from "dompurify";
import markdownIt, { type MarkdownIt, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import { frontmatterEnd } from "../editor/dialect.ts";

/**
 * Copy as rich text (ADR-0012, DESIGN.md §11): Markdown as HTML and plain text, for
 * pasting into mail and word processors. The dialect is the editor's (ARCHITECTURE.md
 * §11): CommonMark with GFM tables, strikethrough, task lists and autolinks, footnotes,
 * and frontmatter left out. Raw HTML is never rendered: markdown-it escapes it as text,
 * and DOMPurify sanitises the HTML after every rendering extension has run, so a
 * document can never carry script to wherever it is pasted. Nothing typographic is
 * changed: no smart quotes, no replacements.
 */

const TASK = /^\[([ xX])\][ \t]+/;

/** GFM task items: `[ ]` and `[x]` become ☐ and ☑, which paste everywhere. */
function taskLists(md: MarkdownIt): void {
  md.core.ruler.after("inline", "task_lists", (state) => {
    const tokens: Token[] = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (
        inline?.type !== "inline" ||
        tokens[i - 1]?.type !== "paragraph_open" ||
        tokens[i - 2]?.type !== "list_item_open"
      )
        continue;
      const first = inline.children?.[0];
      const box = first?.type === "text" ? TASK.exec(first.content) : null;
      if (!first || !box) continue;
      first.content = `${box[1] === " " ? "☐" : "☑"} ${first.content.slice(box[0].length)}`;
    }
  });
}

/**
 * Images reach the paste target only from the web or embedded data; a local file is
 * out of its reach, so it pastes as its description.
 */
function localImagesAsText(md: MarkdownIt): void {
  const original = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = String(token?.attrGet("src") ?? "");
    if (token && !/^(?:https?:|data:image\/)/i.test(src)) {
      return md.utils.escapeHtml(self.renderInlineAsText(token.children ?? [], options, env));
    }
    return original ? original(tokens, idx, options, env, self) : "";
  };
}

const md = markdownIt("commonmark", { html: false, linkify: true, typographer: false })
  .enable(["table", "strikethrough", "linkify"])
  .use(footnote)
  .use(taskLists)
  .use(localImagesAsText);

const ALLOWED_TAGS = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "em",
  "strong",
  "s",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "hr",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "sup",
  "section",
];
const ALLOWED_ATTR = ["href", "title", "alt", "src", "start", "id", "class", "style"];
/** The only style markdown-it writes: a table column's alignment. */
const ALIGNMENT = /^text-align:(?:left|right|center)$/;

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "style" && !ALIGNMENT.test(data.attrValue)) data.keepAttr = false;
});

export interface RichText {
  html: string;
  text: string;
}

/** The HTML for `source`; `whole` leaves out the document's frontmatter. */
export function renderHtml(source: string, whole: boolean): string {
  const end = whole ? frontmatterEnd(source) : null;
  const body = end === null ? source : source.slice(end + 1);
  return DOMPurify.sanitize(md.render(body), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "HR"]);

/** Inline content as text: soft line breaks are spaces, `<br>` a new line. */
function inlineText(node: Node): string {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += (child.textContent ?? "").replace(/\s+/g, " ");
    else if (child instanceof Element) {
      if (child.tagName === "BR") out += "\n";
      else if (child.tagName === "IMG") out += child.getAttribute("alt") ?? "";
      else if (!child.classList.contains("footnote-backref")) out += inlineText(child);
    }
  }
  return out;
}

const indent = (text: string, by: string) => text.replace(/\n(?!\n)/g, `\n${by}`);

/** The blocks under `parent` as plain text, one entry per paragraph. */
function blocks(parent: Element): string[] {
  const out: string[] = [];
  let pending = "";
  const flush = () => {
    const text = pending.replace(/[ \t]+\n/g, "\n").trim();
    if (text) out.push(text);
    pending = "";
  };
  for (const child of parent.childNodes) {
    if (!(child instanceof Element)) {
      pending += (child.textContent ?? "").replace(/\s+/g, " ");
      continue;
    }
    const tag = child.tagName;
    if (tag === "UL" || tag === "OL") {
      flush();
      const start = Number(child.getAttribute("start") ?? "1") || 1;
      const items = [...child.children].filter((li) => li.tagName === "LI");
      const lines = items.map((li, i) => {
        const marker = tag === "OL" ? `${start + i}. ` : "• ";
        const body = blocks(li).join("\n");
        return marker + indent(body, " ".repeat(marker.length));
      });
      out.push(lines.join("\n"));
    } else if (tag === "TABLE") {
      flush();
      const rows = [...child.querySelectorAll("tr")].map((tr) =>
        [...tr.children].map((cell) => inlineText(cell).trim()).join("\t"),
      );
      out.push(rows.join("\n"));
    } else if (tag === "SECTION" || tag === "LI") {
      flush();
      out.push(...blocks(child));
    } else if (BLOCKS.has(tag)) {
      flush();
      if (tag === "HR") {
        if (!child.classList.contains("footnotes-sep")) out.push("* * *");
      } else if (tag === "PRE") out.push((child.textContent ?? "").replace(/\n$/, ""));
      else if (tag === "BLOCKQUOTE") out.push(...blocks(child));
      else out.push(inlineText(child).trim());
    } else {
      pending += inlineText(child);
    }
  }
  flush();
  return out;
}

/** Plain text of rendered HTML: paragraphs apart by a blank line, list markers kept. */
export function plainText(html: string): string {
  // An inert document: nothing in it loads or runs.
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  return blocks(doc.body).join("\n\n");
}

export function richText(source: string, whole: boolean): RichText {
  const html = renderHtml(source, whole);
  return { html, text: plainText(html) };
}
