import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FONTS, LANGUAGE, SOFTWARE } from "./about.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** The names under `[dependencies]` (and Linux's) in a Cargo.toml, local crates aside. */
function crates(path: string): string[] {
  const names: string[] = [];
  let inDeps = false;
  for (const line of read(path).split("\n")) {
    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header)
      inDeps = /(^|\.)dependencies$/.test(header[1] ?? "") && !header[1]?.includes("build");
    const entry = /^([\w-]+)\s*=/.exec(line);
    if (inDeps && entry?.[1] && !line.includes("path =")) names.push(entry[1]);
  }
  return names;
}

describe("About", () => {
  const listed = new Set([...FONTS, ...LANGUAGE, ...SOFTWARE].flatMap((c) => c.packages));

  it("credits every package bismillah ships", () => {
    const npm = Object.keys(
      (JSON.parse(read("package.json")) as { dependencies: Record<string, string> }).dependencies,
    );
    const rust = [...crates("src-tauri/Cargo.toml"), ...crates("crates/bismillah-lint/Cargo.toml")];
    expect(rust).toContain("tauri");
    expect(rust).toContain("harper-core");
    for (const name of [...npm, ...rust]) expect(listed, name).toContain(name);
  });

  it("names a licence for every bundled font", () => {
    for (const font of ["Duo", "Source Serif 4", "Amiri", "IBM Plex Sans Arabic"])
      expect(FONTS.some((f) => f.name.includes(font))).toBe(true);
    for (const credit of [...FONTS, ...LANGUAGE, ...SOFTWARE]) expect(credit.licence).not.toBe("");
  });
});
