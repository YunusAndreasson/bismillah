import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast of every semantic token pair (DESIGN.md §9.3–9.4), read from tokens.css itself
 * so a changed colour can't slip past. WCAG 2.x relative luminance, opaque sRGB.
 */

const css = readFileSync(resolve(import.meta.dirname, "tokens.css"), "utf8");

/** The declarations inside the first block whose selector matches. */
function block(selector: RegExp): Map<string, string> {
  const match = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match?.[1]) throw new Error(`no block for ${selector.source}`);
  const out = new Map<string, string>();
  for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (name && value) out.set(name, value.trim());
  }
  return out;
}

const primitives = block(/:root/);

/** The light block also holds aliases (`status-error`, `focus-ring`) that every theme
 * inherits; CSS resolves their var() against the active theme's values. */
const base = block(/:root,\s*:root\[data-theme="light"\]/);

function theme(selector: RegExp): (token: string) => string {
  const own = new Map([...base, ...block(selector)]);
  const resolveValue = (value: string): string => {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (!ref?.[1]) return value;
    const next = own.get(ref[1]) ?? primitives.get(ref[1]);
    if (!next) throw new Error(`unknown token ${ref[1]}`);
    return resolveValue(next);
  };
  return (token) => {
    const value = own.get(token);
    if (!value) throw new Error(`theme lacks --${token}`);
    return resolveValue(value);
  };
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** A translucent `#rrggbbaa` colour composited over an opaque one. */
function over(top: string, bottom: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const alpha = top.length === 9 ? channel(top, 7) / 255 : 1;
  return `#${[1, 3, 5]
    .map((i) => Math.round(channel(top, i) * alpha + channel(bottom, i) * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: theme(/:root,\s*:root\[data-theme="light"\]/),
  dark: theme(/:root\[data-theme="dark"\]/),
  "high-contrast light": theme(/:root\[data-contrast="high"\]/),
  "high-contrast dark": theme(/:root\[data-contrast="high"\]\[data-theme="dark"\]/),
};

const SURFACES = ["surface-editor", "surface-panel"];
/** Meaningful text: at least 4.5:1 on both surfaces (DESIGN.md §9.4). */
const TEXT = [
  "text-primary",
  "text-secondary",
  "syntax-marker",
  "accent",
  "diagnostic-spelling",
  "diagnostic-grammar",
  "status-error",
];
/** Control boundaries and state indicators: at least 3:1. */
const NON_TEXT = ["border-control", "focus-ring", "accent", "status-error"];

describe.each(Object.entries(THEMES))("%s theme contrast", (_name, token) => {
  it.each(TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])))("%s on %s ≥ 4.5:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])))("%s on %s ≥ 3:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it("draws code's ground as the panel, readable with a selection showing through", () => {
    const ground = over(token("surface-code"), token("surface-editor"));
    const panel = token("surface-panel");
    for (const i of [1, 3, 5]) {
      const diff = parseInt(ground.slice(i, i + 2), 16) - parseInt(panel.slice(i, i + 2), 16);
      expect(Math.abs(diff)).toBeLessThanOrEqual(1);
    }
    for (const fg of ["text-primary", "text-secondary", "syntax-marker"]) {
      expect(contrast(token(fg), ground)).toBeGreaterThanOrEqual(4.5);
    }
    const selected = over(token("surface-code"), token("selection-background"));
    expect(contrast(token("text-primary"), selected)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps Zuhd mode's faint text visible but fainter than text-secondary", () => {
    // editor.css: text-secondary 55% toward the page (the writer's choice, DESIGN.md §11.1).
    const mix = (a: string, b: string, share: number) =>
      `#${[1, 3, 5]
        .map((i) =>
          Math.round(
            parseInt(a.slice(i, i + 2), 16) * share + parseInt(b.slice(i, i + 2), 16) * (1 - share),
          ),
        )
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")}`;
    const faint = mix(token("text-secondary"), token("surface-editor"), 0.55);
    const ratio = contrast(faint, token("surface-editor"));
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(contrast(token("text-secondary"), token("surface-editor")));
  });

  it("keeps faint text visible, but fainter than text-secondary", () => {
    // tokens.css: text-faint is text-secondary 40% of the way toward the page. It is drawn
    // on the editor surface only (the status line, the Basmallah).
    const faint = over(`${token("text-secondary")}99`, token("surface-editor"));
    expect(contrast(faint, token("surface-editor"))).toBeGreaterThanOrEqual(2.4);
    expect(contrast(faint, token("surface-editor"))).toBeLessThan(
      contrast(token("text-secondary"), token("surface-editor")),
    );
  });

  it("draws Print to Phone's code black on white, whatever the theme", () => {
    expect(primitives.get("print-paper")).toBe("#ffffff");
    expect(primitives.get("print-ink")).toBe("#000000");
    expect(css.match(/--print-(paper|ink):/g)).toHaveLength(2);
  });

  it("gives prose more than 7:1", () => {
    expect(contrast(token("text-primary"), token("surface-editor"))).toBeGreaterThan(7);
  });

  it("keeps selected text readable (selected text is drawn in text-primary)", () => {
    expect(contrast(token("text-primary"), token("selection-background"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("keeps library, quick open and palette rows readable in every state", () => {
    // Rows sit on the panel (docked) or the editor surface (overlay, pickers); hover and
    // the picker's selection swap one surface for the other. The open file's edge bar
    // and the selection bar are accent on either.
    for (const bg of ["surface-panel", "surface-editor"]) {
      for (const fg of ["text-primary", "text-secondary"])
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token("accent"), token(bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it("makes the Settings switch readable in both states", () => {
    // On: the thumb (surface-editor) on the accent track; off: the thumb (border-control)
    // on the panel-coloured track.
    expect(contrast(token("surface-editor"), token("accent"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("border-control"), token("surface-panel"))).toBeGreaterThanOrEqual(3);
  });
});

describe("theme blocks", () => {
  it("defines dark the same way under the system preference and the explicit choice", () => {
    const system = block(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/,
    );
    const explicit = block(/:root\[data-theme="dark"\]/);
    expect(Object.fromEntries(system)).toEqual(Object.fromEntries(explicit));
    const highSystem = block(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-contrast="high"\]:not\(\[data-theme="light"\]\)/,
    );
    const highExplicit = block(/:root\[data-contrast="high"\]\[data-theme="dark"\]/);
    expect(Object.fromEntries(highSystem)).toEqual(Object.fromEntries(highExplicit));
  });
});

describe("high contrast", () => {
  // Its own colours throughout: nothing of the regular theme may show through it.
  const OWN = [
    "surface-editor",
    "surface-panel",
    "surface-code",
    "text-primary",
    "text-secondary",
    "syntax-marker",
    "accent",
    "selection-background",
    "border-control",
    "diagnostic-spelling",
    "diagnostic-grammar",
  ];
  it.each([
    ["light", /:root\[data-contrast="high"\]/, THEMES["high-contrast light"]],
    ["dark", /:root\[data-contrast="high"\]\[data-theme="dark"\]/, THEMES["high-contrast dark"]],
  ])("sets every colour itself in %s and keeps text at 7:1", (_name, selector, token) => {
    expect([...block(selector).keys()].filter((k) => k !== "color-scheme").sort()).toEqual(
      [...OWN].sort(),
    );
    for (const fg of TEXT)
      for (const bg of SURFACES) expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("text-primary"), token("selection-background"))).toBeGreaterThanOrEqual(
      7,
    );
  });
});
