import { describe, expect, it } from "vitest";
import type { LibraryNode } from "./ipc.ts";
import { allFiles, findNode, folderFor, parentOf } from "./tree.ts";

const file = (path: string, unavailable = false): LibraryNode => ({
  name: path.split("/").pop() ?? path,
  path,
  kind: "file",
  unavailable,
  children: [],
});
const folder = (path: string, children: LibraryNode[], unavailable = false): LibraryNode => ({
  ...file(path, unavailable),
  kind: "folder",
  children,
});

const NODES: LibraryNode[] = [
  folder("essays", [
    folder("essays/2026", [file("essays/2026/letter.md")]),
    file("essays/notes.md"),
  ]),
  folder("empty", []),
  folder("outside", [], true),
  file("ḥadīth.md"),
  file("notes.md"),
  file("leak.md", true),
];

describe("library tree", () => {
  it("knows parents and nodes by path", () => {
    expect(parentOf("essays/2026/letter.md")).toBe("essays/2026");
    expect(parentOf("notes.md")).toBe("");
    expect(findNode(NODES, "essays/2026/letter.md")?.name).toBe("letter.md");
    expect(findNode(NODES, "essays/missing.md")).toBeNull();
  });

  it("lists openable files in tree order, without unavailable links", () => {
    expect(allFiles(NODES).map((f) => f.path)).toEqual([
      "essays/2026/letter.md",
      "essays/notes.md",
      "ḥadīth.md",
      "notes.md",
    ]);
  });

  it("puts new entries in the selected folder, or beside the selected file", () => {
    expect(folderFor(NODES, "essays/2026")).toBe("essays/2026");
    expect(folderFor(NODES, "essays/notes.md")).toBe("essays");
    expect(folderFor(NODES, "notes.md")).toBe("");
    expect(folderFor(NODES, "outside")).toBe("");
    expect(folderFor(NODES, null)).toBe("");
  });
});
