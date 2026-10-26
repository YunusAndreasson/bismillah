import type { Command, CommandContext, MenuSection } from "./commands.ts";
import { copy } from "./copy.ts";
import { fold, rankCommands, rankFiles, type FileCandidate } from "./fuzzy.ts";
import type { LibraryNode } from "./ipc.ts";
import type { SettingEntry, SettingsSection } from "./settingEntries.ts";
import { parentOf } from "./tree.ts";

/**
 * What the three panels list (DESIGN.md §6, ADR-0016), apart from the component so it
 * can be tested: Files, Commands and Settings, each opened from the status line, with
 * Tab moving between them and the query carried along.
 */

export type Panel = "files" | "commands" | "settings";

/** In the order Tab moves through them, as the tabs show them. */
export const PANELS: readonly Panel[] = ["files", "commands", "settings"];

/** The panel after (1) or before (−1) this one, round the end. */
export function adjacent(panel: Panel, direction: 1 | -1): Panel {
  const at = PANELS.indexOf(panel);
  return PANELS[(at + direction + PANELS.length) % PANELS.length] ?? "files";
}

export type Item =
  | { kind: "file"; value: string; path: string; name: string }
  | { kind: "folder"; value: string; path: string; name: string }
  | { kind: "command"; value: string; command: Command }
  | { kind: "setting"; value: string; entry: SettingEntry }
  /** What an empty or unavailable library offers (Open a folder…, New file…). */
  | { kind: "action"; value: string; label: string; run: () => void };

export interface Group {
  id: string;
  /** Shown above the group; none for a single ranked list. */
  label: string | null;
  items: Item[];
}

export interface Input<F extends FileCandidate> {
  files: readonly F[];
  /** The library's tree, for its folders. */
  nodes: readonly LibraryNode[];
  recent: readonly string[];
  commands: readonly Command[];
  context: CommandContext;
  settings: readonly SettingEntry[];
}

/** Recent files listed before the others with nothing typed. */
const RECENT = 6;
/** How many files and folders a query lists; the files with nothing typed. */
const FILES = 50;
const FOLDERS = 8;
export const ALL_FILES = 500;

/** A recent file is listed again under All files: its row there has its own value, so
 * only one of the two is highlighted. */
const fileItem = (f: FileCandidate, recent = false): Item => ({
  kind: "file",
  value: `${recent ? "recent" : "file"}:${f.path}`,
  path: f.path,
  name: f.name,
});
const folderItem = (f: FileCandidate): Item => ({
  kind: "folder",
  value: `folder:${f.path}`,
  path: f.path,
  name: f.name,
});

/** Every folder in the library that can be shown, in tree order. */
export function allFolders(nodes: readonly LibraryNode[]): FileCandidate[] {
  const out: FileCandidate[] = [];
  const walk = (list: readonly LibraryNode[]) => {
    for (const node of list) {
      if (node.kind !== "folder" || node.unavailable) continue;
      out.push({ path: node.path, name: node.name });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** "Essays/2026/let" → the folder "Essays/2026" (as written, matched without case or
 * marks) and "let" to find in it; no folder without a slash. */
export function splitQuery(query: string): { folder: string | null; rest: string } {
  const slash = query.lastIndexOf("/");
  if (slash < 0) return { folder: null, rest: query };
  return { folder: query.slice(0, slash).trim(), rest: query.slice(slash + 1) };
}

const within = (folder: string) => {
  const key = fold(folder);
  return (path: string) => {
    const parent = fold(parentOf(path));
    return parent === key || parent.startsWith(`${key}/`);
  };
};

function filesGroups<F extends FileCandidate>(query: string, input: Input<F>): Group[] {
  const folders = allFolders(input.nodes);
  const { folder, rest } = splitQuery(query);
  // "Essays/": the folder itself, its own folders and every file in it.
  if (folder !== null && folder !== "") {
    const key = fold(folder);
    const inside = within(folder);
    const self = folders.find((f) => fold(f.path) === key);
    const subfolders = folders.filter((f) => fold(parentOf(f.path)) === key);
    const files = input.files.filter((f) => inside(f.path));
    const all = rest.trim() === "";
    const ranked = all ? files.slice(0, ALL_FILES) : rankFiles(rest, files, input.recent, FILES);
    const shownFolders = all ? subfolders : rankFiles(rest, subfolders, [], FOLDERS);
    return [
      {
        id: "folder",
        label: null,
        // The folder itself first, so F2, Delete and New file act on it.
        items: [...(self && all ? [folderItem(self)] : []), ...shownFolders.map(folderItem)],
      },
      { id: "files", label: null, items: ranked.map((f) => fileItem(f)) },
    ].filter((g) => g.items.length > 0);
  }
  if (query.trim() === "") {
    const recent = new Set(input.recent);
    const recentFiles = rankFiles("", input.files, input.recent, RECENT).filter((f) =>
      recent.has(f.path),
    );
    return [
      {
        id: "recent",
        label: copy.panels.groups.recent,
        items: recentFiles.map((f) => fileItem(f, true)),
      },
      {
        id: "all",
        label: copy.panels.groups.all,
        items: input.files.slice(0, ALL_FILES).map((f) => fileItem(f)),
      },
    ].filter((g) => g.items.length > 0);
  }
  const files = rankFiles(query, input.files, input.recent, FILES).map((f) => fileItem(f));
  const matching = rankFiles(query, folders, [], FOLDERS).map(folderItem);
  const listed = [
    { id: "files", label: matching.length > 0 ? copy.panels.groups.files : null, items: files },
    { id: "folders", label: copy.panels.groups.folders, items: matching },
  ].filter((g) => g.items.length > 0);
  // A folder's name typed, and no file's: the folder first ("essays" → Essays/).
  const typed = fold(query.trim());
  const named = (items: Item[]) =>
    items.some((i) => (i.kind === "file" || i.kind === "folder") && fold(i.name).startsWith(typed));
  if (named(matching) && !named(files)) listed.reverse();
  return listed;
}

/** The panels open themselves: they aren't listed among the commands. */
const NOT_LISTED = new Set(["app.commandPalette", "app.findAnything"]);
const SECTION_ORDER: readonly MenuSection[] = ["File", "Edit", "View", "Help"];

function commandGroups(query: string, input: Input<FileCandidate>): Group[] {
  const usable = input.commands.filter(
    (c) => !NOT_LISTED.has(c.id) && (!c.available || c.available(input.context)),
  );
  const item = (command: Command): Item => ({
    kind: "command",
    value: `command:${command.id}`,
    command,
  });
  if (query.trim() !== "")
    return [{ id: "commands", label: null, items: rankCommands(query, usable).map(item) }].filter(
      (g) => g.items.length > 0,
    );
  return SECTION_ORDER.map((section) => ({
    id: section,
    label: copy.panels.sections[section],
    items: usable.filter((c) => c.section === section).map(item),
  })).filter((g) => g.items.length > 0);
}

function settingGroups(query: string, input: Input<FileCandidate>): Group[] {
  const item = (entry: SettingEntry): Item => ({
    kind: "setting",
    value: `setting:${entry.id}`,
    entry,
  });
  if (query.trim() !== "")
    return [
      { id: "settings", label: null, items: rankCommands(query, input.settings).map(item) },
    ].filter((g) => g.items.length > 0);
  const sections: SettingsSection[] = [];
  for (const entry of input.settings)
    if (!sections.includes(entry.section)) sections.push(entry.section);
  return sections.map((section) => ({
    id: section,
    label: copy.settings.sectionNames[section],
    items: input.settings.filter((e) => e.section === section).map(item),
  }));
}

/** What `panel` lists for `query`, in groups, best first. */
export function groups<F extends FileCandidate>(
  panel: Panel,
  query: string,
  input: Input<F>,
): Group[] {
  switch (panel) {
    case "files":
      return filesGroups(query, input);
    case "commands":
      return commandGroups(query, input);
    case "settings":
      return settingGroups(query, input);
  }
}

export const itemsOf = (list: readonly Group[]): Item[] => list.flatMap((g) => g.items);

/** How many items each panel finds for `query` (shown on the tabs while searching). */
export function counts<F extends FileCandidate>(
  query: string,
  input: Input<F>,
): Record<Panel, number> {
  const count = (panel: Panel) => itemsOf(groups(panel, query, input)).length;
  return { files: count("files"), commands: count("commands"), settings: count("settings") };
}

/** The item `steps` away from `value`, stopping at either end, or the first. */
export function move(items: readonly Item[], value: string, steps: number): string {
  if (items.length === 0) return "";
  const at = items.findIndex((i) => i.value === value);
  if (at < 0) return items[0]?.value ?? "";
  // One step wraps round, as a list does; a page stops at the end.
  const next =
    Math.abs(steps) === 1
      ? (at + steps + items.length) % items.length
      : Math.min(items.length - 1, Math.max(0, at + steps));
  return items[next]?.value ?? "";
}
