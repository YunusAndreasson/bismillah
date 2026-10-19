import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { linkAt, opensOutside } from "./links.ts";

/** The link at the `‸` in `doc`, as [its text, its address]. */
function at(doc: string): [string, string] | null {
  const pos = doc.indexOf("‸");
  const text = doc.replace("‸", "");
  const state = EditorState.create({ doc: text, extensions: [markdownDialect()] });
  ensureSyntaxTree(state, text.length, 5000);
  const link = linkAt(state, pos);
  return link ? [text.slice(link.from, link.to), link.address] : null;
}

describe("the link at a position", () => {
  it("finds inline links, autolinks, bare addresses and definitions", () => {
    expect(at("See [the n‸otes](https://example.org/n) here.")).toEqual([
      "[the notes](https://example.org/n)",
      "https://example.org/n",
    ]);
    expect(at("Mail <wri‸ter@example.org>.")).toEqual([
      "<writer@example.org>",
      "writer@example.org",
    ]);
    expect(at("Go to https://exa‸mple.org now.")).toEqual([
      "https://example.org",
      "https://example.org",
    ]);
    expect(at("[ref]: https://ex‸ample.org/r")).toEqual([
      "[ref]: https://example.org/r",
      "https://example.org/r",
    ]);
  });

  it("follows a reference link to its definition, and only a defined one", () => {
    const defs = "\n\n[Ibn Kathir]: https://example.org/tafsir";
    expect(at(`As [Ibn Ka‸thir] says.${defs}`)?.[1]).toBe("https://example.org/tafsir");
    expect(at(`As [he‸][ibn kathir] says.${defs}`)?.[1]).toBe("https://example.org/tafsir");
    // A scholarly [sic] is text, and a footnote is no link.
    expect(at("He wrote it [s‸ic].")).toBeNull();
    expect(at("A claim[^1‸].\n\n[^1]: A note.")).toBeNull();
  });

  it("takes a linked image as its link, and a plain image as nothing", () => {
    expect(at("[![a cov‸er](cover.png)](https://example.org/book)")?.[1]).toBe(
      "https://example.org/book",
    );
    expect(at("![a cov‸er](cover.png)")).toBeNull();
  });

  it("works from either edge, so the caret just after a link opens it", () => {
    expect(at("[a](https://example.org)‸ and more")?.[1]).toBe("https://example.org");
    expect(at("‸[a](https://example.org)")?.[1]).toBe("https://example.org");
  });

  it("finds links in Arabic text", () => {
    expect(at("انظر [الت‸فسير](https://example.org/تفسير) هنا")?.[1]).toBe(
      "https://example.org/تفسير",
    );
  });

  it("finds nothing in code, plain text or Markdown that isn't a link", () => {
    expect(at("Some `https://exa‸mple.org` code.")).toBeNull();
    expect(at("Plain te‸xt.")).toBeNull();
    expect(at("```\nhttps://exa‸mple.org\n```")).toBeNull();
  });
});

describe("which addresses open outside", () => {
  it("says so for the web and email, as Rust decides", () => {
    for (const yes of [
      "https://example.org",
      "http://example.org",
      "<https://example.org>",
      "www.example.org",
      "mailto:a@example.org",
      "a@example.org",
    ])
      expect(opensOutside(yes), yes).toBe(true);
    for (const no of [
      "chapter-2.md",
      "../notes.md",
      "#heading",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "",
    ])
      expect(opensOutside(no), no).toBe(false);
  });
});
