import { syntaxTree } from "@codemirror/language";
import { Facet, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { copy } from "../core/copy.ts";
import { linkAddress, opensOutside } from "./links.ts";
import { inlineEdit, revealed } from "./livePreview.ts";

/**
 * Live preview's blocks (ADR-0012): the frontmatter folded to one quiet line outside the
 * caret, local images below their line, a placeholder with the address for images from
 * the web (never fetched), and a link's or image's address in a tooltip on hover (with
 * how to open a web or email link, links.ts). The tooltip moves nothing, and the same address is in the source once the caret is in
 * the block, so nothing is reachable by hover alone (DESIGN.md §7).
 */

/** A URL for a local image as the open document writes it, or null for none. */
export type ImageAddress = (src: string) => string | null;

export const imageAddress = Facet.define<ImageAddress, ImageAddress>({
  combine: (values) => values.at(-1) ?? (() => null),
});

export type ImageKind = "local" | "embedded" | "web" | "none";

/** How an image destination is treated: read from the library, embedded, or not shown. */
export function imageKind(src: string): ImageKind {
  const s = src.trim();
  if (/^(?:https?:)?\/\//i.test(s)) return "web";
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(s)) return "embedded";
  if (/^file:/i.test(s)) return "local";
  // Any other scheme: javascript:, mailto:, data:text/html…
  if (/^[a-z][a-z0-9+.-]+:/i.test(s)) return "none";
  return s ? "local" : "none";
}

// ---------------------------------------------------------------------------------------
// The frontmatter, folded to one quiet line.

/** "title: Specimen · lang: en": the frontmatter's top-level keys and their values. */
export function frontmatterSummary(text: string): string {
  const lines = text.split("\n").slice(1);
  if (lines.length && /^(?:---|\.\.\.)[ \t]*$/.test(lines.at(-1) ?? "")) lines.pop();
  const fields: string[] = [];
  for (const line of lines) {
    const field = /^([^\s:#-][^:]*):[ \t]*(.*)$/.exec(line);
    if (!field?.[1]) continue;
    const value = field[2]?.trim() ?? "";
    fields.push(value ? `${field[1]}: ${value}` : field[1]);
  }
  return fields.join(" · ");
}

class FrontmatterFold extends WidgetType {
  constructor(readonly summary: string) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof FrontmatterFold && other.summary === this.summary;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-frontmatter-fold";
    el.dir = "ltr";
    el.textContent = this.summary || copy.preview.frontmatter;
    return el;
  }

  /** A click opens it: the caret goes in and the block reveals. */
  override ignoreEvent(): boolean {
    return false;
  }
}

export function foldFrontmatter(state: EditorState): DecorationSet {
  const node = syntaxTree(state).topNode.firstChild;
  if (node?.name !== "Frontmatter" || node.from !== 0) return Decoration.none;
  const open = state.field(revealed).lines;
  if (open.from <= node.to && open.to >= node.from) return Decoration.none;
  const to = state.doc.lineAt(node.to).to;
  const fold = new FrontmatterFold(frontmatterSummary(state.sliceDoc(0, to)));
  return Decoration.set([Decoration.replace({ widget: fold, block: true }).range(0, to)]);
}

const folded = StateField.define<DecorationSet>({
  create: foldFrontmatter,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.state.field(revealed) !== tr.startState.field(revealed, false) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    )
      return foldFrontmatter(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------------------------------------------------------------------------------------
// Images below their line.

function note(message: string, src: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-image-note";
  const text = document.createElement("span");
  text.textContent = message;
  const address = document.createElement("span");
  address.className = "cm-image-address";
  address.dir = "ltr";
  address.textContent = src.trim();
  el.append(text, address);
  return el;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly kind: ImageKind,
    /** Where the image loads from: our image scheme or embedded data; null: not shown. */
    readonly url: string | null,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.kind === this.kind &&
      other.url === this.url
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "cm-image";
    if (this.url) {
      const img = document.createElement("img");
      // Its description is the text on the line above it.
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", () => {
        figure.replaceChildren(note(copy.preview.imageMissing, this.src));
        view.requestMeasure();
      });
      img.src = this.url;
      figure.append(img);
    } else {
      const message = this.kind === "web" ? copy.preview.imageWeb : copy.preview.imageMissing;
      figure.append(note(message, this.src));
    }
    return figure;
  }

  override get estimatedHeight(): number {
    return this.url ? 240 : 64;
  }

  /** A click puts the caret at the end of the image's line, revealing it. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The Image node that starts at `pos`, with its destination. An image in a table cell
 * stays its alt text: below a row it would split the table. */
function imageAt(state: EditorState, pos: number): { src: string } | null {
  let image: SyntaxNode | null = null;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "Table") return null;
    if (!image && node.from !== pos) return null;
    if (!image && node.name === "Image") image = node;
  }
  const url = image?.getChild("URL");
  return url ? { src: state.sliceDoc(url.from, url.to) } : null;
}

/** Image widgets for the whole document (block widgets must come from state). */
export function imageWidgets(state: EditorState): DecorationSet {
  const address = state.facet(imageAddress);
  const out: Range<Decoration>[] = [];
  let from = 0;
  for (const text of state.doc.iterLines()) {
    for (let at = text.indexOf("!["); at >= 0; at = text.indexOf("![", at + 2)) {
      const image = imageAt(state, from + at);
      if (!image) continue;
      const kind = imageKind(image.src);
      const url =
        kind === "local" ? address(image.src) : kind === "embedded" ? image.src.trim() : null;
      const widget = new ImageWidget(image.src, kind, url);
      out.push(Decoration.widget({ widget, block: true, side: 1 }).range(from + text.length));
    }
    from += text.length + 1;
  }
  return Decoration.set(out, true);
}

const images = StateField.define<DecorationSet>({
  create: imageWidgets,
  update(value, tr) {
    // Typing in the revealed block, away from any image, only moves them.
    if (tr.docChanged && inlineEdit(tr)) return value.map(tr.changes);
    if (
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.state.facet(imageAddress) !== tr.startState.facet(imageAddress)
    )
      return imageWidgets(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------------------------------------------------------------------------------------
// Addresses on hover.

const addressTooltip = hoverTooltip(
  (view, pos, side) => {
    const open = view.state.field(revealed).lines;
    // In the revealed block the address is in the source.
    if (pos >= open.from && pos <= open.to) return null;
    for (
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (node.name !== "Link" && node.name !== "Image") continue;
      const address = linkAddress(view.state, node);
      if (!address || /^\[\^/.test(view.state.sliceDoc(node.from, node.to))) return null;
      return {
        pos: node.from,
        end: node.to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-address";
          const text = document.createElement("div");
          text.dir = "ltr";
          text.textContent = address;
          dom.append(text);
          if (node.name === "Link" && opensOutside(address)) {
            const hint = document.createElement("div");
            hint.className = "cm-address-hint";
            hint.textContent = copy.links.hint;
            dom.append(hint);
          }
          return { dom };
        },
      };
    }
    return null;
  },
  { hoverTime: 400 },
);

/** The folded frontmatter, images and address tooltips of live preview. */
export function previewBlocks(): Extension {
  return [folded, images, addressTooltip];
}
