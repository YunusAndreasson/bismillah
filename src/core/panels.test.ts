import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { COMMANDS, type CommandContext } from "./commands.ts";
import type { LibraryNode } from "./ipc.ts";
import {
  adjacent,
  groups,
  itemsOf,
  move,
  RECENT,
  SCOPES,
  splitQuery,
  type Input,
  type Scope,
} from "./panels.ts";
import type { FileCandidate } from "./fuzzy.ts";
import { settingEntries, type SettingsContext } from "./settingEntries.ts";
import { DEFAULTS } from "./settings.svelte.ts";
import { allFiles } from "./tree.ts";

// Every command can run: a document is open and every check passes.
const context = new Proxy(
  {},
  { get: (_, prop) => (prop === "view" ? { state: EditorState.create() } : () => true) },
) as unknown as CommandContext;

const node = (path: string, children?: LibraryNode[]): LibraryNode => ({
  name: path.split("/").pop() ?? path,
  path,
  kind: children ? "folder" : "file",
  unavailable: false,
  children: children ?? [],
});
const NODES: LibraryNode[] = [
  node("Essays", [node("Essays/2026", [node("Essays/2026/letter.md")]), node("Essays/ʿIlm.md")]),
  node("Notes", [node("Notes/notes.md")]),
  node("Research", []),
  node("Chapter 2.md"),
];
const settingsContext: SettingsContext = {
  colours: [],
  stick: false,
  library: { kind: "ready", name: "Writing" },
  shortcuts: { exists: false, changed: 0, unreadable: false, problems: 0 },
  folders: { config: "", data: "" },
};

const input = (recent: string[] = []) => ({
  files: allFiles(NODES),
  nodes: NODES,
  recent,
  commands: COMMANDS,
  context,
  settings: settingEntries(DEFAULTS, settingsContext),
});
const listed = (panel: Scope, query: string, recent: string[] = []) =>
  groups(panel, query, input(recent));
const values = (panel: Scope, query: string, recent: string[] = []) =>
  itemsOf(listed(panel, query, recent)).map((i) => i.value);

describe("Search narrowed to files", () => {
  it("lists recent files, then every file, before anything is typed", () => {
    const l = listed("files", "", ["Notes/notes.md"]);
    expect(l.map((g) => g.label)).toEqual(["Recent", "All files"]);
    // Listed again under All files, with a value of its own: one row is highlighted.
    expect(l[0]?.items.map((i) => i.value)).toEqual(["recent:Notes/notes.md"]);
    expect(l[1]?.items.map((i) => i.value)).toContain("file:Notes/notes.md");
    expect(l[1]?.items).toHaveLength(4);
    // Without recent files there is one list.
    expect(listed("files", "").map((g) => g.label)).toEqual(["All files"]);
  });

  it("lists the seven most recently opened files, most recent first", () => {
    const paths = Array.from({ length: 9 }, (_, i) => `Draft ${String(i + 1)}.md`);
    const files = paths.map((path) => ({ path, name: path }));
    const recent = [...paths].reverse();
    const l = groups("files", "", { ...input(recent), files, nodes: paths.map((p) => node(p)) });
    expect(RECENT).toBe(7);
    expect(l[0]?.items.map((i) => i.value)).toEqual(recent.slice(0, 7).map((p) => `recent:${p}`));
  });

  it("finds files, then folders, by name", () => {
    expect(values("files", "ilm")[0]).toBe("file:Essays/ʿIlm.md");
    expect(values("files", "research")).toEqual(["folder:Research"]);
    const l = listed("files", "notes");
    expect(l.map((g) => g.label)).toEqual(["Files", "Folders"]);
    expect(l[1]?.items.map((i) => i.value)).toEqual(["folder:Notes"]);
    // A folder's name, which no file has: the folder first.
    expect(listed("files", "essays").map((g) => g.label)).toEqual(["Folders", "Files"]);
  });

  it("shows a folder's own folders and files once its name ends in a slash", () => {
    expect(values("files", "essays/")).toEqual([
      "folder:Essays",
      "folder:Essays/2026",
      "file:Essays/2026/letter.md",
      "file:Essays/ʿIlm.md",
    ]);
    expect(values("files", "Essays/let")).toEqual(["file:Essays/2026/letter.md"]);
    // An empty folder still lists itself, so a file can be made in it.
    expect(values("files", "Research/")).toEqual(["folder:Research"]);
    expect(splitQuery("Essays/2026/let")).toEqual({ folder: "Essays/2026", rest: "let" });
    expect(splitQuery("letter")).toEqual({ folder: null, rest: "letter" });
  });
});

describe("Search narrowed to commands", () => {
  it("groups every usable command by its menu before anything is typed", () => {
    const l = listed("commands", "");
    expect(l.map((g) => g.label)).toEqual(["File", "Edit", "Format", "View", "Help"]);
    const ids = itemsOf(l).map((i) => i.value);
    expect(ids).toContain("command:file.save");
    // Search opens itself.
    expect(ids).not.toContain("command:app.commandPalette");
    expect(ids).not.toContain("command:app.findAnything");
  });

  it("ranks commands by label and aliases", () => {
    expect(values("commands", "zuhd")[0]).toBe("command:editor.toggleFocus");
    expect(values("commands", "quick open")[0]).toBe("command:file.quickOpen");
  });
});

describe("Search narrowed to settings", () => {
  it("groups its rows in sections before anything is typed, and ranks them after", () => {
    expect(listed("settings", "").map((g) => g.label)).toEqual([
      "Appearance",
      "Writing",
      "Language & checking",
      "Files & privacy",
    ]);
    expect(values("settings", "quotes")[0]).toBe("setting:smart");
    expect(listed("settings", "quotes").map((g) => g.label)).toEqual([null]);
  });
});

describe("Search over everything", () => {
  const drafts = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const path = `Draft ${String(i + 1)}.md`;
      return { path, name: path };
    });
  const everything = (query: string, over: Partial<Input<FileCandidate>> = {}) =>
    groups("all", query, { ...input(), ...over });

  it("lists only recent files with nothing typed, without the open one", () => {
    const files = drafts(9);
    const recent = files.map((f) => f.path).reverse();
    const l = everything("", { files, recent, active: recent[0] ?? null });
    expect(l.map((g) => g.label)).toEqual(["Recent"]);
    expect(l[0]?.items.map((i) => i.value)).toEqual(
      recent.slice(1, RECENT + 1).map((p) => `recent:${p}`),
    );
    // Nothing opened yet: the first files instead, still without the open one; an empty
    // library: nothing.
    expect(everything("").map((g) => g.label)).toEqual(["All files"]);
    expect(
      itemsOf(everything("", { active: "Essays/2026/letter.md" })).map((i) => i.value),
    ).not.toContain("file:Essays/2026/letter.md");
    expect(everything("", { files: [], nodes: [] })).toEqual([]);
  });

  it("lists files, then commands, then settings, a few of each", () => {
    const l = everything("spelling");
    expect(l.map((g) => g.id)).toEqual(["commands", "settings"]);
    const files = drafts(9);
    const cut = everything("draft", { files, nodes: files.map((f) => node(f.path)) });
    expect(cut[0]?.label).toBe("Files");
    expect(cut[0]?.items).toHaveLength(5);
    expect(cut[0]?.more).toEqual({ total: 9, scope: "files" });
  });

  it("leaves out scattered letters when anything matches as a run of letters", () => {
    // "dark" is scattered through "Draft about rocks", and a word in Theme's aliases.
    const files = [{ path: "Draft about rocks.md", name: "Draft about rocks.md" }];
    const l = everything("dark", { files, nodes: [node(files[0]?.path ?? "")] });
    expect(l.map((g) => g.id)).not.toContain("files");
    expect(itemsOf(l).map((i) => i.value)).toContain("setting:theme");
    // With nothing better, scattered letters are still found.
    expect(itemsOf(everything("dgrk", { files, nodes: [] })).map((i) => i.value)).toEqual([]);
    expect(itemsOf(everything("drbt", { files, nodes: [] }))[0]?.value).toBe(
      "file:Draft about rocks.md",
    );
  });

  it("lists a setting that is also a command once, as the command", () => {
    const shown = itemsOf(everything("zuhd")).map((i) => i.value);
    expect(shown).toContain("command:editor.toggleFocus");
    expect(shown).not.toContain("setting:zuhd");
    // Settings itself still lists it.
    expect(values("settings", "zuhd")).toContain("setting:zuhd");
  });

  it("lists a folder as Files does once a slash is typed", () => {
    expect(values("all", "essays/")).toEqual(values("files", "essays/"));
  });

  it("goes round everything, files, commands and settings with Tab", () => {
    expect(SCOPES).toEqual(["all", "files", "commands", "settings"]);
    expect(adjacent("all", 1)).toBe("files");
    expect(adjacent("settings", 1)).toBe("all");
    expect(adjacent("all", -1)).toBe("settings");
  });
});

describe("moving within Search", () => {
  it("wraps one step round the list, and stops a page at either end", () => {
    const items = itemsOf(listed("files", ""));
    const first = items[0]?.value ?? "";
    const last = items.at(-1)?.value ?? "";
    expect(move(items, first, -1)).toBe(last);
    expect(move(items, last, 1)).toBe(first);
    expect(move(items, first, 8)).toBe(last);
    expect(move(items, last, -8)).toBe(first);
    expect(move(items, "gone", 1)).toBe(first);
    expect(move([], "", 1)).toBe("");
  });
});
