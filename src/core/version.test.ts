import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("version", () => {
  it("is the workspace's version in Cargo.toml and package.json alike", () => {
    const cargo = /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/.exec(read("Cargo.toml"));
    const npm = (JSON.parse(read("package.json")) as { version: string }).version;
    expect(cargo?.[1]).toBeDefined();
    expect(npm).toBe(cargo?.[1]);
    // tauri.conf.json takes it from Cargo.toml rather than repeating it.
    expect(read("src-tauri/tauri.conf.json")).not.toMatch(/"version"/);
  });
});
