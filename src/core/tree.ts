import { fold } from "./fuzzy.ts";
import type { LibraryNode } from "./ipc.ts";

/**
 * The library tree's structure and keyboard model, kept apart from the component so it
 * can be tested (WAI-ARIA tree view pattern: arrows move, Right opens or enters a
 * folder, Left closes it or goes to the parent, Home/End, type-ahead).
 */

export interface Row {
  node: LibraryNode;
  /** 1 for the top level, as `aria-level` counts. */
  level: number;
  /** The containing folder's path; "" at the top. */
  parent: string;
  /** Position among its siblings, from 1, and their number (`aria-posinset`/`setsize`). */
  position: number;
  siblings: number;
}

/** The rows a tree with these folders open shows, top to bottom. */
export function visibleRows(nodes: readonly LibraryNode[], expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (list: readonly LibraryNode[], level: number, parent: string) => {
    list.forEach((node, i) => {
      rows.push({ node, level, parent, position: i + 1, siblings: list.length });
      if (node.kind === "folder" && expanded.has(node.path))
        walk(node.children, level + 1, node.path);
    });
  };
  walk(nodes, 1, "");
  return rows;
}

/** "essays/2026/letter.md" → "essays/2026"; "" at the top. */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** The folders containing `path`, outermost first: "a/b/c.md" → ["a", "a/b"]. */
export function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) out.push(path.slice(0, i));
  return out;
}

export function findNode(nodes: readonly LibraryNode[], path: string): LibraryNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.kind === "folder" && path.startsWith(`${node.path}/`)) {
      return findNode(node.children, path);
    }
  }
  return null;
}

/** Every file that can be opened, in tree order. */
export function allFiles(nodes: readonly LibraryNode[]): LibraryNode[] {
  const out: LibraryNode[] = [];
  const walk = (list: readonly LibraryNode[]) => {
    for (const node of list) {
      if (node.unavailable) continue;
      if (node.kind === "file") out.push(node);
      else walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Where something new goes for this entry: the folder itself, or a file's folder. */
export function folderFor(nodes: readonly LibraryNode[], path: string | null): string {
  if (path === null) return "";
  const node = findNode(nodes, path);
  return node?.kind === "folder" && !node.unavailable ? node.path : parentOf(path);
}

export type TreeKey = "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End";

export interface Move {
  focus?: string;
  expand?: string;
  collapse?: string;
}

/** What a navigation key does, from the focused row. */
export function move(
  rows: readonly Row[],
  expanded: ReadonlySet<string>,
  focused: string | null,
  key: TreeKey,
): Move {
  if (rows.length === 0) return {};
  const i = rows.findIndex((r) => r.node.path === focused);
  const at = (j: number): Move => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, j))];
    return target ? { focus: target.node.path } : {};
  };
  if (i < 0) return at(0);
  const row = rows[i];
  if (!row) return {};
  const folder = row.node.kind === "folder" && !row.node.unavailable;
  switch (key) {
    case "ArrowDown":
      return at(i + 1);
    case "ArrowUp":
      return at(i - 1);
    case "Home":
      return at(0);
    case "End":
      return at(rows.length - 1);
    case "ArrowRight":
      if (!folder) return {};
      if (!expanded.has(row.node.path)) return { expand: row.node.path };
      return row.node.children.length > 0 ? at(i + 1) : {};
    case "ArrowLeft":
      if (folder && expanded.has(row.node.path)) return { collapse: row.node.path };
      return row.parent ? { focus: row.parent } : {};
  }
}

/**
 * Type-ahead: the next row after the focused one whose name starts with what was typed
 * (letters folded as in quick open, so "h" finds "ḥadīth.md"). Wraps around. While more
 * letters are typed, the focused row itself still counts, so after "c" lands on
 * "Chapter 2", "ch" stays there and "chapter 1" moves on to "Chapter 10".
 */
export function typeahead(
  rows: readonly Row[],
  focused: string | null,
  typed: string,
): string | null {
  const prefix = fold(typed);
  if (!prefix) return null;
  const start = rows.findIndex((r) => r.node.path === focused);
  for (let k = [...typed].length > 1 ? 0 : 1; k <= rows.length; k++) {
    const row = rows[(start + k + rows.length) % rows.length];
    if (row && fold(row.node.name).startsWith(prefix)) return row.node.path;
  }
  return null;
}
