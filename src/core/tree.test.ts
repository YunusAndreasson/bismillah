import { describe, expect, it } from "vitest";
import type { LibraryNode } from "./ipc.ts";
import {
  allFiles,
  ancestors,
  findNode,
  folderFor,
  move,
  parentOf,
  typeahead,
  visibleRows,
} from "./tree.ts";

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

const paths = (rows: { node: LibraryNode }[]) => rows.map((r) => r.node.path);

describe("library tree", () => {
  it("shows the rows of open folders only, with ARIA levels and positions", () => {
    expect(paths(visibleRows(NODES, new Set()))).toEqual([
      "essays",
      "empty",
      "outside",
      "ḥadīth.md",
      "notes.md",
      "leak.md",
    ]);
    const rows = visibleRows(NODES, new Set(["essays", "essays/2026"]));
    expect(paths(rows).slice(0, 4)).toEqual([
      "essays",
      "essays/2026",
      "essays/2026/letter.md",
      "essays/notes.md",
    ]);
    const letter = rows[2];
    expect([letter?.level, letter?.parent, letter?.position, letter?.siblings]).toEqual([
      3,
      "essays/2026",
      1,
      1,
    ]);
    expect([rows[3]?.position, rows[3]?.siblings]).toEqual([2, 2]);
  });

  it("knows parents, ancestors and nodes by path", () => {
    expect(parentOf("essays/2026/letter.md")).toBe("essays/2026");
    expect(parentOf("notes.md")).toBe("");
    expect(ancestors("essays/2026/letter.md")).toEqual(["essays", "essays/2026"]);
    expect(ancestors("notes.md")).toEqual([]);
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

  it("moves with the arrow keys as the WAI-ARIA tree pattern describes", () => {
    const expanded = new Set(["essays"]);
    const rows = visibleRows(NODES, expanded);
    expect(move(rows, expanded, null, "ArrowDown")).toEqual({ focus: "essays" });
    expect(move(rows, expanded, "essays", "ArrowDown")).toEqual({ focus: "essays/2026" });
    expect(move(rows, expanded, "essays", "ArrowUp")).toEqual({ focus: "essays" });
    expect(move(rows, expanded, "leak.md", "ArrowDown")).toEqual({ focus: "leak.md" });
    expect(move(rows, expanded, "notes.md", "Home")).toEqual({ focus: "essays" });
    expect(move(rows, expanded, "essays", "End")).toEqual({ focus: "leak.md" });
    // Right: open a closed folder, then step into it; nothing on a file or empty folder.
    expect(move(rows, expanded, "essays/2026", "ArrowRight")).toEqual({ expand: "essays/2026" });
    expect(move(rows, expanded, "essays", "ArrowRight")).toEqual({ focus: "essays/2026" });
    expect(move(rows, expanded, "notes.md", "ArrowRight")).toEqual({});
    expect(move(rows, new Set(["empty"]), "empty", "ArrowRight")).toEqual({});
    expect(move(rows, expanded, "outside", "ArrowRight")).toEqual({});
    // Left: close an open folder, else go to the parent.
    expect(move(rows, expanded, "essays", "ArrowLeft")).toEqual({ collapse: "essays" });
    expect(move(rows, expanded, "essays/notes.md", "ArrowLeft")).toEqual({ focus: "essays" });
    expect(move(rows, expanded, "notes.md", "ArrowLeft")).toEqual({});
    expect(move([], expanded, null, "ArrowDown")).toEqual({});
  });

  it("finds rows by their first letters, folded and wrapping around", () => {
    const rows = visibleRows(NODES, new Set());
    expect(typeahead(rows, "essays", "h")).toBe("ḥadīth.md");
    expect(typeahead(rows, "essays", "n")).toBe("notes.md");
    expect(typeahead(rows, "notes.md", "e")).toBe("essays");
    expect(typeahead(rows, "notes.md", "em")).toBe("empty");
    expect(typeahead(rows, "notes.md", "x")).toBeNull();
    // A longer prefix may stay on the focused row; a single letter moves on.
    expect(typeahead(rows, "notes.md", "no")).toBe("notes.md");
    expect(typeahead(rows, "notes.md", "n")).toBe("notes.md");
    expect(typeahead(rows, "ḥadīth.md", "n")).toBe("notes.md");
  });
});
