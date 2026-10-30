import type { Command, CommandContext, MenuSection } from "./commands.ts";
import { copy } from "./copy.ts";
import {
  commandTier,
  countFiles,
  fileTier,
  fold,
  rankCommands,
  rankFiles,
  type FileCandidate,
} from "./fuzzy.ts";
import type { LibraryNode } from "./ipc.ts";
import type { SettingEntry, SettingsSection } from "./settingEntries.ts";
import { parentOf } from "./tree.ts";

/**
 * What Search lists (DESIGN.md §6, ADR-0018), apart from the component so it can be
 * tested: everything, or narrowed to files, commands or settings, with Tab moving
 * between them and the query carried along.
 */

export type Scope = "all" | "files" | "commands" | "settings";

/** In the order Tab moves through them. */
export const SCOPES: readonly Scope[] = ["all", "files", "commands", "settings"];

/** The scope after (1) or before (−1) this one, round the end. */
export function adjacent(scope: Scope, direction: 1 | -1): Scope {
  const at = SCOPES.indexOf(scope);
  return SCOPES[(at + direction + SCOPES.length) % SCOPES.length] ?? "all";
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
  /** In everything, a group cut short: how many its scope finds, and that scope. */
  more?: { total: number; scope: Scope };
}

export interface Input<F extends FileCandidate> {
  files: readonly F[];
  /** The library's tree, for its folders. */
  nodes: readonly LibraryNode[];
  recent: readonly string[];
  /** The open document, which everything's Recent leaves out (the status line names it). */
  active?: string | null;
  commands: readonly Command[];
  context: CommandContext;
  settings: readonly SettingEntry[];
}

/** Recent files listed before the others with nothing typed. */
export const RECENT = 7;
/** How many files and folders a query lists; the files with nothing typed. */
const FILES = 50;
const FOLDERS = 8;
export const ALL_FILES = 500;
/** How many of each kind everything lists for a query. */
const CAPS = { files: 5, folders: 2, commands: 4, settings: 4 } as const;

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
const commandItem = (command: Command): Item => ({
  kind: "command",
  value: `command:${command.id}`,
  command,
});
const settingItem = (entry: SettingEntry): Item => ({
  kind: "setting",
  value: `setting:${entry.id}`,
  entry,
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

/** Search opens itself: those commands aren't listed among the results. */
const NOT_LISTED = new Set(["app.commandPalette", "app.findAnything"]);
const SECTION_ORDER: readonly MenuSection[] = ["File", "Edit", "Format", "View", "Help"];

const usableCommands = (input: Input<FileCandidate>) =>
  input.commands.filter(
    (c) => !NOT_LISTED.has(c.id) && (!c.available || c.available(input.context)),
  );

function commandGroups(query: string, input: Input<FileCandidate>): Group[] {
  const usable = usableCommands(input);
  if (query.trim() !== "")
    return [
      { id: "commands", label: null, items: rankCommands(query, usable).map(commandItem) },
    ].filter((g) => g.items.length > 0);
  return SECTION_ORDER.map((section) => ({
    id: section,
    label: copy.panels.sections[section],
    items: usable.filter((c) => c.section === section).map(commandItem),
  })).filter((g) => g.items.length > 0);
}

function settingGroups(query: string, input: Input<FileCandidate>): Group[] {
  if (query.trim() !== "")
    return [
      {
        id: "settings",
        label: null,
        items: rankCommands(query, input.settings).map(settingItem),
      },
    ].filter((g) => g.items.length > 0);
  const sections: SettingsSection[] = [];
  for (const entry of input.settings)
    if (!sections.includes(entry.section)) sections.push(entry.section);
  return sections.map((section) => ({
    id: section,
    label: copy.settings.sectionNames[section],
    items: input.settings.filter((e) => e.section === section).map(settingItem),
  }));
}

/**
 * Everything: with nothing typed, only recent files (not the open one). With a query,
 * Files, Commands and Settings in that order, a few of each, and scattered-letter
 * matches left out whenever anything matches as a run of letters.
 */
function allGroups<F extends FileCandidate>(query: string, input: Input<F>): Group[] {
  if (query.trim() === "") {
    const recent = new Set(input.recent.filter((p) => p !== input.active));
    const recentFiles = rankFiles("", input.files, input.recent, RECENT + 1)
      .filter((f) => recent.has(f.path))
      .slice(0, RECENT);
    if (recentFiles.length > 0)
      return [
        {
          id: "recent",
          label: copy.panels.groups.recent,
          items: recentFiles.map((f) => fileItem(f, true)),
        },
      ];
    const first = input.files
      .filter((f) => f.path !== input.active)
      .slice(0, RECENT)
      .map((f) => fileItem(f));
    return first.length > 0 ? [{ id: "all", label: copy.panels.groups.all, items: first }] : [];
  }
  // A folder typed: that folder's own listing, as Files gives it.
  if (query.includes("/")) return filesGroups(query, input);

  const usable = usableCommands(input);
  const shown = new Set(usable.map((c) => c.id));
  // A setting that is also a command is listed once, as the command, with its shortcut.
  const settings = input.settings.filter((e) => !(e.command && shown.has(e.command)));
  let files = rankFiles(query, input.files, input.recent, FILES);
  let folders = rankFiles(query, allFolders(input.nodes), [], FOLDERS);
  let commands = rankCommands(query, usable);
  let entries = rankCommands(query, settings);

  // The ranked lists put runs of letters first, so their first rows tell.
  const runs =
    [...files.slice(0, 1), ...folders.slice(0, 1)].some((f) => (fileTier(query, f) ?? 0) > 0) ||
    [...commands.slice(0, 1), ...entries.slice(0, 1)].some((c) => (commandTier(query, c) ?? 0) > 0);
  const least = runs ? 1 : 0;
  if (runs) {
    files = files.filter((f) => (fileTier(query, f) ?? -1) >= least);
    folders = folders.filter((f) => (fileTier(query, f) ?? -1) >= least);
    commands = commands.filter((c) => (commandTier(query, c) ?? -1) >= least);
    entries = entries.filter((e) => (commandTier(query, e) ?? -1) >= least);
  }

  const fileTotal = countFiles(query, input.files, least) + folders.length;
  const fileItems = [
    ...files.slice(0, CAPS.files).map((f) => fileItem(f)),
    ...folders.slice(0, CAPS.folders).map(folderItem),
  ];
  const group = (id: Scope, label: string, items: Item[], total: number): Group => ({
    id,
    label,
    items,
    ...(total > items.length ? { more: { total, scope: id } } : {}),
  });
  return [
    group("files", copy.panels.groups.files, fileItems, fileTotal),
    group(
      "commands",
      copy.panels.groups.commands,
      commands.slice(0, CAPS.commands).map(commandItem),
      commands.length,
    ),
    group(
      "settings",
      copy.panels.groups.settings,
      entries.slice(0, CAPS.settings).map(settingItem),
      entries.length,
    ),
  ].filter((g) => g.items.length > 0);
}

/** What `scope` lists for `query`, in groups, best first. */
export function groups<F extends FileCandidate>(
  scope: Scope,
  query: string,
  input: Input<F>,
): Group[] {
  switch (scope) {
    case "all":
      return allGroups(query, input);
    case "files":
      return filesGroups(query, input);
    case "commands":
      return commandGroups(query, input);
    case "settings":
      return settingGroups(query, input);
  }
}

export const itemsOf = (list: readonly Group[]): Item[] => list.flatMap((g) => g.items);

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
