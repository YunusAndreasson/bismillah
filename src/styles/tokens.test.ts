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

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: theme(/:root,\s*:root\[data-theme="light"\]/),
  dark: theme(/:root\[data-theme="dark"\]/),
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

  it("gives prose more than 7:1", () => {
    expect(contrast(token("text-primary"), token("surface-editor"))).toBeGreaterThan(7);
  });

  it("keeps selected text readable (selected text is drawn in text-primary)", () => {
    expect(contrast(token("text-primary"), token("selection-background"))).toBeGreaterThanOrEqual(
      4.5,
    );
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
  });
});
