import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { revealed } from "./livePreview.ts";
import {
  foldFrontmatter,
  frontmatterSummary,
  imageAddress,
  imageKind,
  imageWidgets,
  linkAddress,
  previewBlocks,
} from "./previewBlocks.ts";

function stateWith(doc: string, caret = doc.length): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [
      markdownDialect(),
      revealed,
      previewBlocks(),
      imageAddress.of((src) => `bismillah-image://localhost/7/${src}`),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state.update({}).state;
}

describe("the folded frontmatter", () => {
  it("summarises the top-level keys on one line", () => {
    expect(frontmatterSummary("---\ntitle: Specimen\nlang: en\n---")).toBe(
      "title: Specimen · lang: en",
    );
    expect(frontmatterSummary("---\ntags:\n  - a\n  - b\nauthor: Yūnus\n...")).toBe(
      "tags · author: Yūnus",
    );
    expect(frontmatterSummary("---\n# a comment\n---")).toBe("");
  });

  it("folds outside the caret and opens when the caret is in it", () => {
    const doc = "---\ntitle: A\n---\n\nText.";
    const folds = (caret: number) => {
      const ranges: [number, number][] = [];
      foldFrontmatter(stateWith(doc, caret)).between(0, doc.length, (from, to) => {
        ranges.push([from, to]);
      });
      return ranges;
    };
    // Lines 1–3 are replaced by one line while the caret is below them.
    expect(folds(doc.length)).toEqual([[0, 16]]);
    expect(folds(5)).toEqual([]);
    expect(folds(16)).toEqual([]);
  });
});

describe("images", () => {
  it("tells local files, embedded data and the web apart", () => {
    expect(imageKind("figures/map.png")).toBe("local");
    expect(imageKind("../a b.png")).toBe("local");
    expect(imageKind("file:///home/a.png")).toBe("local");
    expect(imageKind("https://example.com/a.png")).toBe("web");
    expect(imageKind("//example.com/a.png")).toBe("web");
    expect(imageKind("data:image/png;base64,AAAA")).toBe("embedded");
    expect(imageKind("data:text/html,<script>")).toBe("none");
    expect(imageKind("javascript:alert(1)")).toBe("none");
    expect(imageKind("")).toBe("none");
  });

  it("puts each image below its line, never one inside code", () => {
    const doc =
      "Text ![A](a.png) and ![B](https://e.com/b.png).\n\n`![C](c.png)`\n\n```\n![D](d.png)\n```\n\n![E](e.png)";
    const state = stateWith(doc);
    const found: { at: number; src: string; url: string | null }[] = [];
    imageWidgets(state).between(0, doc.length, (from, _to, deco) => {
      const widget = deco.spec.widget as { src: string; url: string | null };
      found.push({ at: from, src: widget.src, url: widget.url });
    });
    const firstLineEnd = doc.indexOf("\n");
    expect(found).toEqual([
      { at: firstLineEnd, src: "a.png", url: "bismillah-image://localhost/7/a.png" },
      { at: firstLineEnd, src: "https://e.com/b.png", url: null },
      { at: doc.length, src: "e.png", url: "bismillah-image://localhost/7/e.png" },
    ]);
  });
});

describe("addresses on hover", () => {
  function linkIn(doc: string, at: number): { state: EditorState; node: SyntaxNode } {
    const state = stateWith(doc);
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1);
    while (node && node.name !== "Link" && node.name !== "Image") node = node.parent;
    if (!node) throw new Error("no link");
    return { state, node };
  }

  it("is the link's own address, or its reference's", () => {
    const inline = linkIn("A [link](https://e.com/a) here.", 3);
    expect(linkAddress(inline.state, inline.node)).toBe("https://e.com/a");
    const doc = "A [full][Ref] and [ref][] and [ref].\n\n[REF]: https://r.example\n";
    for (const at of [3, 19, 31]) {
      const ref = linkIn(doc, at);
      expect(linkAddress(ref.state, ref.node)).toBe("https://r.example");
    }
    const undefinedRef = linkIn("A [sic] here.", 3);
    expect(linkAddress(undefinedRef.state, undefinedRef.node)).toBeNull();
  });
});

describe("switching live preview off and on", () => {
  it("rebuilds its fields without reading them from the state before the switch", () => {
    // A compartment's new fields are created, then updated against a transaction whose
    // start state never had them (Always show Markdown, then Mod-R again).
    const slot = new Compartment();
    const on = () => [revealed, previewBlocks()];
    let state = EditorState.create({
      doc: "---\ntitle: A\n---\n\nText ![A](a.png).",
      extensions: [markdownDialect(), slot.of(on())],
    });
    state = state.update({ effects: slot.reconfigure([]) }).state;
    expect(() => (state = state.update({ effects: slot.reconfigure(on()) }).state)).not.toThrow();
    expect(state.field(revealed).held).toBe(false);
  });
});
