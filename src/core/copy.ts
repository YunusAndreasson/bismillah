import type { OpenError, SaveError, SettingsNotice } from "./ipc.ts";

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
  other: "of an input/output error",
};

export const saveReason = (error: SaveError) => SAVE_REASONS[error.kind];

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
  },
  welcome: {
    title: "Nothing open",
    open: "Open a file…",
    create: "New file…",
    drop: "Or drop a Markdown file here.",
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
