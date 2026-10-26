import type { LibraryNode } from "./ipc.ts";

/** The library's tree as Rust lists it: paths, nodes and files (the Files panel). */

/** "essays/2026/letter.md" → "essays/2026"; "" at the top. */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
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
