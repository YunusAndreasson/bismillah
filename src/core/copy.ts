import type {
  AddWordError,
  KeybindingsFile,
  LibraryError,
  NameProblem,
  OpenError,
  SaveError,
  SettingsNotice,
  ThemeProblem,
} from "./ipc.ts";
import type { ShortcutProblem } from "./shortcuts.ts";
import { commandById, shortcutLabel, type CommandId } from "./commands.ts";

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
    guide: "Guide — changes aren't saved",
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
    showInSettings: "Show in Settings",
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
  checking: {
    spelling: "Possible spelling mistake",
    grammar: "Grammar suggestion",
    /** Follows the word, which is shown in quotes before it. */
    notInDictionary: {
      en: "isn't in the English dictionary.",
      ar: "isn't in the Arabic dictionary.",
    },
    replaceWith: "Replace with",
    remove: (text: string) => `Remove ${quote(text)}`,
    noSuggestions: "No corrections found.",
    ignore: "Ignore",
    addToDictionary: "Add to dictionary",
    noIssues: "No spelling or grammar issues.",
    noIssueHere: "Nothing to suggest here.",
    off: "Spelling and grammar checking are off.",
    addFailed: (word: string, error: AddWordError) =>
      error.kind === "not_saved"
        ? `Couldn't add ${quote(word)} to your dictionary — ${saveReason(error.error)}.`
        : `${quote(word)} can't be added: the dictionary holds single words.`,
  },
  shortcuts: {
    title: "Keyboard shortcuts",
    problemsNotice:
      "Some lines in keybindings.toml couldn't be used, so those commands keep their own shortcuts.",
    none: "Every command has its own shortcut. To change them, create keybindings.toml and edit it in any text editor.",
    create: "Create keybindings.toml",
    changed: (n: number) =>
      n === 0
        ? "keybindings.toml changes no shortcuts yet."
        : `keybindings.toml changes ${n === 1 ? "one shortcut" : `${n} shortcuts`}.`,
    editHint: (folder: string) =>
      `It's in ${folder}/. Edit it in any text editor: changes apply as soon as it's saved.`,
    unreadable: (u: NonNullable<KeybindingsFile["unreadable"]>) =>
      `keybindings.toml ${unreadable(u)}, so every command keeps its own shortcut.`,
    createFailed: (error: SaveError) => `Couldn't create keybindings.toml — ${saveReason(error)}.`,
    problem: (p: ShortcutProblem) => `Line ${p.line}: ${shortcutProblem(p)}`,
  },
  themes: {
    builtin: "bismillah",
    unusableNotice: (id: string) =>
      `The colour theme ${quote(id)} can't be used, so bismillah's own colours apply.`,
    lightOnly: "light only",
    darkOnly: "dark only",
    hint: (folder: string) =>
      `Your own themes are TOML or JSON files in ${folder}/themes/, and apply as soon as they're saved.`,
    truncated: "Only the first 100 theme files are listed.",
    /** One sentence per problem, a colour's contrast on every background in one. */
    problems: themeProblems,
    /** Follows a theme file's name, shown in quotes before it. */
    inFolder: "in the themes folder:",
  },
  about: {
    title: "About bismillah",
    tagline: "A calm Markdown editor. Just you and your words.",
    version: (v: string) => `Version ${v}`,
    inspiration: "Inspiration",
    inspirationText: [
      "bismillah is inspired by Islamic ethics: the writer's words are a trust (amanah), their privacy is kept, and the tool practises restraint. These shape how it saves, what it refuses to collect, and how little it asks of your attention.",
      "Zuhd (زهد) inspires a quieter space for writing. And the original iA Writer showed the way: a typewriter, with only the best of the computer.",
    ],
    licences: "Licences",
    licenceText:
      "bismillah is free software: you may use, study, share and change it under the GNU General Public License, version 3 or later. It is made with:",
    fonts: "Fonts",
    language: "Spelling and grammar",
    software: "Software",
    installed:
      "The fonts' and the dictionary's licences are installed with bismillah, in /usr/share/licenses/bismillah/.",
    close: "Close",
  },
  settings: {
    title: "Settings",
    appearance: "Appearance",
    writing: "Writing",
    checking: "Language & checking",
    files: "Files & privacy",
    sections: "Settings sections",
    colours: "Colours",
    highContrast: "High contrast",
    highContrastHint: "Black and white, with the most contrast. Used instead of the colours above.",
    customFont: "Font name",
    customFontHint:
      "Any font installed on this computer, by name. Letters it lacks come from iA Writer Duo.",
    customFontMissing: (name: string) =>
      `No installed font is called ${quote(name)}, so iA Writer Duo is used.`,
    customFontEmpty: "Type a font's name; until then iA Writer Duo is used.",
    customFontInvalid: "A font's name can't contain quotes, backslashes, “;”, “{” or “}”.",
    focusDimming: "Other text",
    dimmings: { quiet: "Quiet", faint: "Faint" },
    focusDimmingHint: "Faint is harder to read. Quiet keeps every line easy to read.",
    library: "Library folder",
    libraryNone: "No folder is open.",
    libraryUnavailable: (name: string) => `${quote(name)} isn't available.`,
    recovery: "Unsaved text",
    recoveryText: (data: string) =>
      `While a save is under way, and whenever one fails, your text is kept in ${data}/recovery/ until it's saved or you discard it. Copies are removed after 30 days.`,
    yourFiles: "Your settings",
    yourFilesText: (config: string) =>
      `Settings, shortcuts, colour themes and your dictionary are plain text files in ${config}/: settings.toml, keybindings.toml, themes/ and dictionary.txt. Changes made there apply as soon as they're saved.`,
    privacy: "Privacy",
    privacyText:
      "bismillah has no networking features. What you write, your dictionary and these settings stay on this computer, and spelling and grammar are checked here too.",
    about: "About bismillah",
    spelling: "Check spelling",
    spellingHint: "English and Arabic. Qur’anic text and IJMES transliteration are never marked.",
    grammar: "Grammar suggestions",
    grammarHint: "English only. A suggestion can be wrong; every change is yours to make.",
    dialect: "English spelling",
    dialects: {
      british: "British",
      american: "American",
      canadian: "Canadian",
      australian: "Australian",
      indian: "Indian",
    },
    dialectHint: "A document whose frontmatter says lang: en-US or en-GB uses that instead.",
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
      custom: "Another font",
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
    alwaysShowMarkdown: "Always show Markdown",
    alwaysShowMarkdownHint:
      "Every mark stays visible. Off: the text reads as rendered, and Markdown shows only in the paragraph you're writing.",
    zuhd: "Zuhd mode",
    zuhdHint: "Focus on the current sentence or paragraph.",
    focusOn: "Focus on",
    granularities: { sentence: "Sentence", paragraph: "Paragraph" },
  },
  preview: {
    frontmatter: "Frontmatter",
    imageWeb: "Images from the web are never loaded.",
    imageMissing: "Image not shown: there's no image file at this address inside the library.",
  },
  links: {
    hint: "Ctrl+click to open",
    notWeb: "Only web and email links open from bismillah.",
    noApp: "Couldn't open the link: no app on this computer opens it.",
    none: "There's no link at the caret.",
  },
  folders: {
    show: "Show in file manager",
    unavailable: "That folder isn't available.",
    noApp: "Couldn't show the folder: no file manager opens it.",
  },
  copyRich: {
    done: "Copied as rich text.",
    doneSelection: "Copied the selection as rich text.",
    failed: "Couldn't copy as rich text: the clipboard didn't take it.",
  },
  lineEndings: {
    lf: "LF (Unix) line endings",
    crlf: "CRLF (Windows) line endings",
    cr: "CR line endings",
  },
} as const;

function unreadable(u: NonNullable<KeybindingsFile["unreadable"]>): string {
  if (u.kind === "too_large") return "is too large to read";
  if (u.kind === "syntax" && u.line !== null) return `couldn't be read (line ${u.line})`;
  return "couldn't be read";
}

const label = (id: CommandId) => commandById(id)?.label ?? id;

function shortcutProblem(p: ShortcutProblem): string {
  switch (p.kind) {
    case "unknown_command":
      return `${quote(p.command)} isn't a command.`;
    case "not_text":
      return `the shortcut for ${label(p.command)} needs quotes, like "Ctrl+D".`;
    case "unreadable":
      return `${quote(p.shortcut)} isn't a shortcut bismillah can read.`;
    case "kept":
      return `${shortcutLabel(p.shortcut)} is kept for ${p.shortcut === "F10" ? "the menu" : "the text"}, so ${label(p.command)} keeps its own shortcut.`;
    case "fixed":
      return `${label(p.command)} keeps its standard shortcut.`;
    case "repeated":
      return `${label(p.command)} is listed twice; the first line counts.`;
    case "twice":
      return `${shortcutLabel(p.shortcut)} is given to both ${label(p.commands[0])} and ${label(p.commands[1])}, so both keep their own.`;
  }
}

/** One sentence per theme problem (src-tauri/src/themes.rs), for Settings. */
function themeProblem(p: ThemeProblem): string {
  switch (p.kind) {
    case "unreadable":
      return p.line === null
        ? "It couldn't be read."
        : `It couldn't be read: it stops being TOML or JSON at line ${p.line}.`;
    case "too_large":
      return "It's too large to be a theme.";
    case "schema":
      return "It was made for another version of bismillah.";
    case "unknown_key":
      return `${quote(p.key)} isn't something a theme sets, so it's ignored.`;
    case "wrong_type":
      return p.key === "name"
        ? `${quote("name")} needs to be text.`
        : `${quote(p.key)} needs to be a table of colours.`;
    case "invalid_colour":
      return `${quote(p.key)} isn't a colour bismillah can read${p.value ? ` (${quote(p.value)})` : ""}; write it as #rrggbb.`;
    case "no_colours":
      return "It sets no colours.";
    case "same_name":
      return "Another theme has the same name; rename the file to use it.";
    case "contrast": {
      const variant = p.variant === "light" ? "Light" : "Dark";
      const what = p.needed >= 4.5 ? "text" : "a boundary";
      return `${variant}: ${p.foreground} on ${p.background} is ${p.ratio.toFixed(1)}:1, and ${what} needs ${p.needed}:1.`;
    }
  }
}

function themeProblems(problems: ThemeProblem[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of problems) {
    if (p.kind !== "contrast") {
      out.push(themeProblem(p));
      continue;
    }
    const key = `${p.variant} ${p.foreground}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const same = problems.filter(
      (q): q is Extract<ThemeProblem, { kind: "contrast" }> =>
        q.kind === "contrast" && q.variant === p.variant && q.foreground === p.foreground,
    );
    const on = same.map((q) => `${q.ratio.toFixed(1)}:1 on ${q.background}`);
    const list = on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on.at(-1)}` : on[0];
    const variant = p.variant === "light" ? "Light" : "Dark";
    const what = p.needed >= 4.5 ? "text" : "a boundary";
    out.push(`${variant}: ${p.foreground} is ${list}, and ${what} needs ${p.needed}:1.`);
  }
  return out;
}

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
