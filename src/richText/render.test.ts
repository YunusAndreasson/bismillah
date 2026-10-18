import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { plainText, renderHtml, richText } from "./render.ts";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../tests/fixtures", name), "utf8");

/** Every element and attribute of rendered HTML, parsed in an inert document. */
function parse(html: string): Element[] {
  const doc = new DOMParser().parseFromString(`<body>${html}`, "text/html");
  return [...doc.body.querySelectorAll("*")];
}

describe("Copy as rich text: the shared dialect", () => {
  it("renders emphasis, links, lists, quotes, code, tables and rules", () => {
    const html = renderHtml(
      [
        "# Title",
        "",
        'Text *em*, **strong**, ~~struck~~, `code` and a [link](https://e.com "T").',
        "",
        "- one",
        "- two",
        "",
        "3. three",
        "",
        "> quoted",
        "",
        "| a | b |",
        "|:--|--:|",
        "| 1 | 2 |",
        "",
        "---",
      ].join("\n"),
      true,
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain(
      'Text <em>em</em>, <strong>strong</strong>, <s>struck</s>, <code>code</code> and a <a href="https://e.com" title="T">link</a>.',
    );
    expect(html).toContain("<ul>\n<li>one</li>");
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("<blockquote>\n<p>quoted</p>");
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toContain("<hr>");
  });

  it("leaves the frontmatter out of a whole document, and keeps the text exactly", () => {
    const html = renderHtml('---\ntitle: A\n---\n\n"Straight" quotes -- and ... stay.', true);
    expect(html).toBe(`<p>"Straight" quotes -- and ... stay.</p>\n`);
  });

  it("links bare URLs, renders footnotes and task items", () => {
    const html = renderHtml(
      "See https://example.com.[^1]\n\n[^1]: A note.\n\n- [ ] open\n- [x] done",
      true,
    );
    expect(html).toContain('<a href="https://example.com">https://example.com</a>.');
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>');
    expect(html).toContain("<li>☐ open</li>");
    expect(html).toContain("<li>☑ done</li>");
  });

  it("keeps Arabic, vocalisation and Qur'anic marks byte for byte", () => {
    const text =
      "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ and ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ";
    expect(renderHtml(text, true)).toBe(`<p>${text}</p>\n`);
  });

  it("pastes local images as their description and keeps web images", () => {
    const html = renderHtml("![A cat](cat.png) ![A dog](https://e.com/dog.png)", true);
    expect(html).toBe('<p>A cat <img src="https://e.com/dog.png" alt="A dog"></p>\n');
  });
});

describe("Copy as rich text: plain text", () => {
  it("separates blocks, keeps list markers and leaves out footnote back-links", () => {
    const { text } = richText(
      "# Title\n\nOne *two*\nthree.\n\n- a\n- b\n\n2. x\n3. y\n\nNote.[^1]\n\n---\n\n[^1]: Here.",
      true,
    );
    expect(text).toBe(
      "Title\n\nOne two three.\n\n• a\n• b\n\n2. x\n3. y\n\nNote.[1]\n\n* * *\n\n1. Here.",
    );
  });

  it("puts table cells apart by tabs", () => {
    expect(plainText(renderHtml("| a | b |\n|---|---|\n| 1 | 2 |", true))).toBe("a\tb\n1\t2");
  });
});

describe("Copy as rich text: the XSS fixture stays inert", () => {
  const html = renderHtml(fixture("xss.md"), true);
  const elements = parse(html);

  it("contains no element that could run or load anything", () => {
    const tags = new Set(elements.map((e) => e.tagName.toLowerCase()));
    for (const banned of [
      "script",
      "iframe",
      "svg",
      "math",
      "object",
      "embed",
      "form",
      "button",
      "base",
      "meta",
      "style",
      "details",
      "link",
    ]) {
      expect([banned, tags.has(banned)]).toEqual([banned, false]);
    }
  });

  it("contains no event handlers, scripted URLs or styles beyond table alignment", () => {
    for (const element of elements) {
      for (const attr of element.attributes) {
        const name = attr.name.toLowerCase();
        expect([element.tagName, name, name.startsWith("on")]).toEqual([
          element.tagName,
          name,
          false,
        ]);
        if (name === "href" || name === "src") {
          expect([name, attr.value]).not.toEqual([
            name,
            expect.stringMatching(/^\s*(?:javascript|vbscript|data:text)/i),
          ]);
        }
        if (name === "style") expect(attr.value).toMatch(/^text-align:(?:left|right|center)$/);
      }
    }
    // Scripted URLs survive only as visible text (escaped raw HTML, rejected links),
    // which the attribute check above reads past.
  });

  it("shows raw HTML as text, as the editor does", () => {
    expect(html).toContain('&lt;script&gt;window.__xss = "script"&lt;/script&gt;');
    expect(html).toContain('&lt;img src="x" onerror=');
    expect(html).not.toContain("frontmatter");
  });
});
