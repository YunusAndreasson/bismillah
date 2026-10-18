// markdown-it-footnote ships no types, and @types/markdown-it-footnote is written against
// markdown-it 14's community types, which clash with markdown-it 15's own.
declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";
  const footnote: (md: MarkdownIt) => void;
  export default footnote;
}
