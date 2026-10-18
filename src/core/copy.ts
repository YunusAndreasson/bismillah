import type { LibraryError, NameProblem, OpenError, SaveError, SettingsNotice } from "./ipc.ts";

/**
 * The interface's sentences, kept in one place so they stay consistent and can be
 * translated later (DESIGN.md §1, §14). Plain and specific: what happened, why if
 * known, and how the text is protected. Command labels live in commands.ts.
 */

const quote = (name: string) => `“${name}”`;

const SAVE_REASONS: Record<SaveError["kind"], string> = {
  disk_full: "the disk is full",
  read_only_volume: "the disk is read-only",
  permission_denied: "bismillah isn't allowed to write there",
  removed: "the file was moved or deleted",
  unavailable: "its folder is no longer available",
  conflict: "the file changed on disk",
  not_utf8: "the file isn't UTF-8 text",
  not_a_file: "it isn't saved to a file",
  closed: "the document was closed",
  exists: "a file with that name already exists",
  other: "of an input/output error",
};

const OPEN_REASONS: Record<OpenError["kind"], string> = {
  not_found: "it doesn't exist",
  permission_denied: "bismillah isn't allowed to read it",
  not_a_file: "it isn't a file",
  outside: "it leads outside the library",
  other: "of an input/output error",
};

const LIBRARY_REASONS: Record<Exclude<LibraryError["kind"], "invalid_name">, string> = {
  outside: "it leads outside the library",
  invalid_path: "that isn't a place in the library",
  not_found: "it isn't there any more",
  exists: "something with that name is already there",
  permission_denied: "bismillah isn't allowed to change that folder",
  read_only_volume: "the disk is read-only",
  disk_full: "the disk is full",
  unavailable: "the library folder isn't available",
  other: "of an input/output error",
};

/** Why a typed name can't be used, as a sentence shown under the name field. */
const NAME_PROBLEMS: Record<NameProblem, string> = {
  empty: "Type a name.",
  slash: "A name can't contain “/”.",
  dot: "A name can't start with a dot: such files are hidden.",
  too_long: "That name is too long.",
  control: "A name can't contain control characters.",
};

export const saveReason = (error: SaveError) => SAVE_REASONS[error.kind];
export const libraryReason = (error: LibraryError) =>
  error.kind === "invalid_name" ? NAME_PROBLEMS[error.reason] : LIBRARY_REASONS[error.kind];
/** A library error as one sentence under a name field. */
export const nameError = (error: LibraryError) =>
  error.kind === "invalid_name"
    ? NAME_PROBLEMS[error.reason]
    : `That didn't work — ${LIBRARY_REASONS[error.kind]}.`;

export const copy = {
  status: {
    saved: "Saved",
    saving: "Saving…",
    notSaved: (error: SaveError) => `Not saved — ${saveReason(error)}`,
    sample: "Sample — changes aren't saved",
    readOnly: "Read-only",
    words: (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`,
    minutes: (n: number) => `${n} min read`,
    transliteration: "Transliteration",
    region: "Document status",
  },
  failure: (name: string, error: SaveError) =>
    `Couldn't save ${quote(name)} — ${saveReason(error)}. Your text is kept in recovery.`,
  conflict: (name: string) =>
    `${quote(name)} changed on disk while you were editing it. Your text is kept in recovery.`,
  removed: (name: string) =>
    `${quote(name)} was moved or deleted while you were editing it. Your text is kept in recovery.`,
  recovered: (name: string, when: string) =>
    `Unsaved text from ${when} was kept for ${quote(name)}.`,
  pendingRecovery: (name: string, when: string) =>
    `Unsaved text from ${when} was kept for ${quote(name)}.`,
  readOnly: (name: string) =>
    `${quote(name)} isn't UTF-8 text, so it opened read-only and stays unchanged.`,
  mixedLineEndings: (name: string, ending: string) =>
    `${quote(name)} mixes line endings. Your edits will be saved with ${ending} throughout.`,
  openFailed: (name: string, error: OpenError) =>
    `Couldn't open ${quote(name)} — ${OPEN_REASONS[error.kind]}.`,
  newFailed: (error: SaveError) => `Couldn't create the file — ${saveReason(error)}.`,
  trashed: (name: string) => `Moved ${quote(name)} to the trash.`,
  trashFailed: (name: string, error: LibraryError) =>
    `Couldn't move ${quote(name)} to the trash — ${libraryReason(error)}. It wasn't changed.`,
  untrashFailed: (name: string, error: LibraryError) =>
    `Couldn't put ${quote(name)} back — ${libraryReason(error)}. It is still in the trash.`,
  renameFailed: (name: string, error: LibraryError) =>
    `Couldn't rename ${quote(name)} — ${libraryReason(error)}.`,
  unsavedFirst: (name: string) =>
    `${quote(name)} has changes that aren't saved yet, so it stays as it is until they are.`,
  recoveryFirst: (name: string) =>
    `Restore or discard the recovered text for ${quote(name)} first.`,
  settingsNotice: (notice: SettingsNotice) =>
    notice.kind === "unreadable"
      ? `settings.toml couldn't be read, so the defaults apply. Your file was kept as ${notice.backup}.`
      : `Some values in settings.toml weren't valid (${notice.keys.join(", ")}), so their defaults apply.`,
  settingsNotSaved: (error: SaveError) => `Couldn't save your settings — ${saveReason(error)}.`,
  actions: {
    tryAgain: "Try again",
    saveElsewhere: "Save elsewhere…",
    keepMine: "Keep mine",
    loadTheirs: "Load theirs",
    saveMineAs: "Save mine as…",
    saveAgain: "Save it again",
    restore: "Restore",
    discard: "Discard",
    open: (name: string) => `Open ${quote(name)}`,
    notNow: "Not now",
    dismiss: "OK",
    undo: "Undo",
  },
  welcome: {
    title: "Nothing open",
    openFolder: "Open a folder…",
    open: "Open a file…",
    create: "New file…",
    drop: "Or drop a Markdown file or folder here.",
  },
  library: {
    region: "Library",
    toggle: "Library",
    none: "No folder is open.",
    openFolder: "Open a folder…",
    unavailable: (name: string) =>
      `${quote(name)} isn't available. It may be on a disk that isn't connected.`,
    tryAgain: "Try again",
    chooseFolder: "Choose another folder…",
    empty: (name: string) => `No Markdown files in ${quote(name)} yet.`,
    newFile: "New file…",
    truncated: "Only part of this folder is shown: it holds too many entries.",
    outside: "outside the library",
    menu: {
      open: "Open",
      rename: "Rename…",
      trash: "Move to trash",
      newFile: "New file here…",
      newFolder: "New folder here…",
    },
  },
  prompt: {
    rename: (name: string) => `Rename ${quote(name)}`,
    newFolder: (folder: string) => `New folder in ${quote(folder)}`,
    name: "Name",
    fileHint: "Without .md or .markdown at the end, .md is added.",
    renameAction: "Rename",
    createAction: "Create",
    cancel: "Cancel",
  },
  picker: {
    quickOpen: "Quick open",
    quickOpenPlaceholder: "Find a file by name or folder",
    noFile: "No file matches.",
    palette: "Command palette",
    palettePlaceholder: "Find a command",
    noCommand: "No command matches.",
    on: "On",
    libraryOnly: "in the library",
  },
  settings: {
    title: "Settings",
    appearance: "Appearance",
    writing: "Writing",
    done: "Done",
    reset: "Reset",
    smaller: "Smaller",
    bigger: "Bigger",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    font: "Writing font",
    fonts: {
      duo: "iA Writer Duo",
      serif: "Source Serif",
      amiri: "Amiri",
      "plex-arabic": "IBM Plex Sans Arabic",
    },
    fontHint: "Amiri suits documents written mostly in Arabic.",
    textSize: "Text size",
    measure: "Line length",
    measures: { narrow: "Narrow", standard: "Standard", wide: "Wide" },
    lineHeight: "Line height",
    lineHeightDefault: "the font's default",
    fadeChrome: "Fade the status line while typing",
    basmallah: "Show the Basmallah opening",
    basmallahHint: "Shown above every document, centred. It is never part of the file.",
    smartPunctuation: "Smart punctuation",
    smartPunctuationHint:
      "Typed quotes, dashes and ellipses become “ ” ‘ ’ – — …, and « » in Arabic.",
    typewriter: "Typewriter scrolling",
    typewriterHint: "Keeps the line you're writing near the middle of the window.",
    zuhd: "Zuhd mode",
    zuhdHint: "Focus on the current sentence or paragraph.",
    focusOn: "Focus on",
    granularities: { sentence: "Sentence", paragraph: "Paragraph" },
  },
  lineEndings: {
    lf: "LF (Unix) line endings",
    crlf: "CRLF (Windows) line endings",
    cr: "CR line endings",
  },
} as const;

/** "14:32", "yesterday 14:32" or "12 October 14:32", in the writer's locale. */
export function when(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "long" })} ${time}`;
}
