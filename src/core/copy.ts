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
  outside: "only the library is kept on the stick",
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

const protection = (recovered: boolean) =>
  recovered
    ? "Your text is kept in recovery."
    : "Your text is only in this window. Save it elsewhere before closing.";

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
    minutes: (n: number) => `${n} min read`,
    transliteration: "Transliteration",
    region: "Document status",
  },
  save: {
    confirmed: "Saved now.",
    sample:
      "This is a sample, so changes aren't saved. To keep them, copy the text into a new file.",
  },
  failure: (name: string, error: SaveError, recovered = false) =>
    `Couldn't save ${quote(name)} — ${saveReason(error)}. ${protection(recovered)}`,
  conflict: (name: string, recovered = false) =>
    `${quote(name)} changed on disk while you were editing it. ${protection(recovered)}`,
  removed: (name: string, recovered = false) =>
    `${quote(name)} was moved or deleted while you were editing it. ${protection(recovered)}`,
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
  /** The bismillah stick's first screens (os/PLAN.md, OS-2): setup, unlock, trouble. */
  appliance: {
    wordmark: "bismillah",
    powerOff: "Power off",
    restart: "Restart",
    poweringOff: "Powering off…",
    restarting: "Restarting…",
    showPassphrase: "Show passphrase",
    passphrase: "Passphrase",
    keyboard: (layout: string, rtl: boolean) =>
      `Keyboard: ${layout} · ${rtl ? "right to left" : "left to right"}`,
    capsLock: "Caps Lock is on",
    keyboardDamaged: "Your keyboard layouts couldn't be read, so this screen uses English (US).",
    helperDown:
      "The stick isn't answering. Turn the computer off with its power button, then start it again.",
    failed: "That didn't finish, and nothing that holds texts was erased. Try again, or power off.",
    setup: {
      step: (n: number) => `Step ${String(n)} of 3`,
      keyboardTitle: "Choose your keyboard",
      keyboardHint:
        "The layout you type with. You can add a second one, such as Arabic, and switch between them with Alt+Shift.",
      firstLayout: "Keyboard layout",
      secondLayout: "Second layout",
      noSecond: "None",
      applying: "Applying the layout… The screen reloads in a moment.",
      passphraseTitle: "Choose a passphrase",
      passphraseHint:
        "It encrypts your texts, and you'll type it each time you start the stick. Several unrelated words are easier to remember than symbols.",
      again: "Type it again",
      suggest: "Suggest a passphrase",
      suggested: "Write it down and keep it apart from the stick.",
      noRecovery: "There is no way to recover your texts without this passphrase.",
      weak: "Too easy to guess. Try more words, or a suggested passphrase.",
      enough: "Strong enough.",
      mismatch: "The two passphrases are different.",
      empty: "Type a passphrase first.",
      againEmpty: "Type the passphrase again to confirm it.",
      changeKeyboard: "Change keyboard",
      timeTitle: "Choose your time zone",
      timeHint: "For the clock and the times shown next to your files.",
      timeZone: "Time zone",
      continue: "Continue",
      back: "Back",
      create: "Set up the stick",
      working: "Setting up the stick… This takes a few seconds.",
    },
    unlock: {
      submit: "Unlock",
      working: "Unlocking…",
      wrong:
        "That passphrase didn't unlock your texts. Check the keyboard layout and Caps Lock, then try again.",
      lockedTitle: "Locked",
      lockedHint: "Type your passphrase to return to your texts.",
    },
    finish: {
      title: "Setup didn't finish",
      hint: "Type the passphrase you chose, and bismillah completes the setup.",
      submit: "Finish setup",
      working: "Finishing setup…",
      startOver: "Start over…",
      confirmHint:
        "This stick holds no texts yet. Starting over erases the unfinished setup, so you can choose a new passphrase.",
      confirmWord: "start over",
      confirmLabel: (word: string) => `Type “${word}” to confirm`,
      confirm: "Erase and start over",
      cancel: "Cancel",
    },
    unreadable: {
      title: "This stick's texts can't be opened",
      body: "Your texts are not deleted, and nothing on this stick will change. Take the stick to the computer it was made on.",
    },
    twoSticks: {
      title: "Two bismillah sticks are attached",
      body: "Remove the one you didn't start from, then restart.",
    },
    notFound: {
      title: "bismillah can't find this stick's texts",
      body: "Nothing on this stick or this computer will change. Restart from the stick, or take it to the computer it was made on.",
    },
  },
  /** The bismillah stick once it is open (os/PLAN.md, OS-3). */
  stick: {
    battery: (percent: number, charging: boolean) =>
      charging ? `${String(percent)}% charging` : `${String(percent)}%`,
    batteryTitle: (percent: number, charging: boolean) =>
      `Battery ${String(percent)}%${charging ? ", charging" : ""}`,
    batteryLow: (percent: number) =>
      `The battery is at ${String(percent)}%. Plug the computer in: at 3% bismillah saves and powers off.`,
    powerFailed: "The stick didn't answer, so the computer is still on.",
    resuming: "Applying the keyboard layouts…",
    keyboardUnsaved: "Your text isn't saved yet, so the layouts weren't changed. Save first.",
    keyboardInvalid: "That keyboard layout isn't one this stick knows.",
  },
  welcome: {
    title: "Nothing open",
    openFolder: "Open a folder…",
    open: "Open a file…",
    create: "New file…",
    drop: "Or drop a Markdown file or folder here.",
    guide: "Guide",
  },
  library: {
    none: "No folder is open.",
    openFolder: "Open a folder…",
    unavailable: (name: string) =>
      `${quote(name)} isn't available. It may be on a disk that isn't connected.`,
    tryAgain: "Try again",
    chooseFolder: "Choose another folder…",
    empty: (name: string) => `No Markdown files in ${quote(name)} yet.`,
    newFile: "New file…",
    truncated: "Only part of this folder is shown: it holds too many entries.",
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
  /** Search: one palette for files, commands and settings (DESIGN.md §6, ADR-0018). */
  panels: {
    /** The palette and its field, by scope, as screen readers name them. */
    names: {
      all: "Search",
      files: "Search files",
      commands: "Search commands",
      settings: "Search settings",
    },
    /** A scope as the chip in the field, the key line and the menu name it. */
    scopes: { all: "Everything", files: "Files", commands: "Commands", settings: "Settings" },
    widen: (scope: string) => `${scope}: search everything instead`,
    placeholders: {
      all: "Search files, commands and settings",
      files: "Find a file or folder",
      commands: "Find a command",
      settings: "Find a setting — changes apply immediately",
    },
    empty: {
      all: "Nothing matches.",
      files: "No file or folder matches.",
      commands: "No command matches.",
      settings: "No setting matches.",
    },
    groups: {
      recent: "Recent",
      all: "All files",
      files: "Files",
      folders: "Folders",
      commands: "Commands",
      settings: "Settings",
    },
    /** A file's or folder's place, under the list. */
    inFolder: (folder: string) => `In ${quote(folder)}`,
    sections: { File: "File", Edit: "Edit", Format: "Format", View: "View", Help: "Help" },
    on: "On",
    off: "Off",
    noneYet: "None yet",
    allFiles: (n: number) => `The first ${String(n)} files are listed. Type to find the others.`,
    emptyFolder: (name: string) => `No Markdown files in ${quote(name)} yet.`,
    shortcuts: {
      none: "Not changed",
      unreadable: "Couldn't be read",
      changed: (n: number) => (n === 0 ? "Not changed" : `${String(n)} changed`),
      problems: (n: number) => (n === 1 ? "1 line not used" : `${String(n)} lines not used`),
    },
    /** The line above the tabs: each key, then what it does now. */
    keys: {
      open: "Enter open",
      show: "Enter look inside",
      run: "Enter run",
      toggle: "Enter on or off",
      choose: "← → change · Enter all choices",
      step: "← → change · Enter open",
      type: "Enter type a name",
      read: "Enter show",
      library: "Enter open another folder",
      about: "Enter open",
      /** An opened row's own keys. */
      openedChoice: "← → change · Enter or Esc done",
      openedStep: "← → change · Backspace reset · Enter or Esc done",
      openedName: "Enter use this name · Esc done",
      openedOther: "Esc done",
      rename: (key: string) => `${key} rename`,
      trash: (key: string) => `${key} move to the trash`,
      next: (scope: string) => `Tab ${scope} · Esc close`,
    },
  },
  search: {
    prompt: "Type text to find in this document.",
    noMatches: "No matches. Try different text or turn off a search option.",
    matchFound: "Match found. Enter for next · Shift+Enter for previous.",
    invalidExpression:
      "Invalid regular expression. Check the pattern or turn off Regular expression.",
  },
  navigation: {
    hint: "Enter a line (12), relative move (+10 or -10), percentage (50%), or line:column (12:4; columns start at 0).",
    invalid: "Enter a number, such as 12, +10, 50%, or 12:4. Your position hasn't changed.",
  },
  /** The bar over a selection (ADR-0019). */
  format: {
    label: "Formatting",
    marks: { bold: "Bold", italic: "Italic", strike: "Strikethrough", code: "Code" },
    turnInto: "Turn into",
    blocks: {
      text: "Text",
      h1: "Heading 1",
      h2: "Heading 2",
      h3: "Heading 3",
      quote: "Quote",
      bullet: "Bulleted list",
      numbered: "Numbered list",
    },
    font: "Writing font",
    fontHint: "Changes the writing font of every document, not only these words.",
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
  pair: {
    title: "Pair with phone",
    key: "Key",
    hint: "On your phone, open Search and choose Pair with a stick, then type the key it shows. Spaces and capitals don't matter.",
    action: "Pair",
    notAKey: "That isn't the whole key, or a character is wrong. Check it against your phone.",
    notSaved: "The key couldn't be saved. Prints stay as they were.",
    done: (words: string) =>
      `Paired. Your phone should show the same four words: ${words}. Prints are now sealed so that only it can read them.`,
  },
  print: {
    title: "Print to phone",
    whole: "whole document",
    selection: "selection",
    words: (n: number) => `${n.toLocaleString("en")} ${n === 1 ? "word" : "words"}`,
    instruction: "Open bismillah Reader on your phone and point it at the code.",
    time: (seconds: number) => {
      if (seconds < 60) return `About ${Math.max(5, Math.ceil(seconds / 5) * 5)} seconds.`;
      const minutes = Math.ceil(seconds / 60);
      return minutes === 1 ? "About a minute." : `About ${minutes} minutes.`;
    },
    until: "Your phone will say when it has the text.",
    library: "whole library",
    texts: (n: number) => `${n.toLocaleString("en")} ${n === 1 ? "text" : "texts"}`,
    round: "For the first round.",
    untilLibrary:
      "Your phone counts the texts it has and says which it still lacks. The codes go round again, more slowly, until you press Done, and you can stop and come back: it keeps what it has.",
    showing: "Now showing text",
    goTo: "Go to text number",
    of: (n: number) => `of ${n.toLocaleString("en")}`,
    unsaved: "The open document's latest edits couldn't be saved, so they aren't in this print.",
    leftOutTitle: "Left out",
    leftOut: { empty: "empty", unreadable: "can't be read", too_long: "too long" },
    truncated: "The library is too large to list in full, so some texts may be missing here.",
    restedLibrary: "Paused after going round several times, so the computer stays quiet.",
    nothing: "The library holds nothing to print.",
    code: (name: string) => `A code holding ${name}, for your phone to read`,
    sealed: (words: string) => `Sealed to your phone: ${words}.`,
    unsealed:
      "Not sealed. Anyone who films this code can read it. To seal it, use Pair with phone first.",
    pause: "Pause",
    resume: "Resume",
    start: "Start",
    done: "Done",
    paused: "Paused.",
    rested: "Paused after 5 minutes, so the computer stays quiet.",
    tooSmall: "Make the window larger to show the code.",
    failed: "The code couldn't be made. Your document hasn't changed.",
  },
  about: {
    title: "About bismillah",
    tagline: "A calm Markdown editor. Just you and your words.",
    version: (v: string) => `Version ${v}`,
    /** The stick's system: its Debian snapshot ("20261021T083704Z") and commit. */
    stick: (snapshot: string, commit: string) => {
      const day = /^(\d{4})(\d{2})(\d{2})/.exec(snapshot);
      const date = day ? `${day[1]}-${day[2]}-${day[3]}` : "an unknown date";
      return `The stick: Debian 13 as of ${date}, built from ${commit ? commit.slice(0, 12) : "an unknown commit"}.`;
    },
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
    sectionNames: {
      appearance: "Appearance",
      writing: "Writing",
      checking: "Language & checking",
      files: "Files & privacy",
      stick: "This stick",
    },
    fontDefault: "font default",
    stick: {
      keyboard: "Keyboard",
      keyboardHint:
        "Up to four layouts. Applying them restarts bismillah, which saves first and comes back to where you were.",
      layout: (n: number) => `Layout ${String(n)}`,
      noLayout: "None",
      switchKey: "Switch layouts with",
      switches: {
        "grp:alt_shift_toggle": "Alt+Shift",
        "grp:ctrl_shift_toggle": "Ctrl+Shift",
        "grp:win_space_toggle": "Super+Space",
        "grp:caps_toggle": "Caps Lock",
      } as Record<string, string>,
      apply: "Apply layouts",
      applying: "Applying… bismillah restarts in a moment.",
      timeZone: "Time zone",
      localClock: "This computer's clock keeps local time",
      localClockHint:
        "Turn this on if the clock is off by whole hours, as on computers that also run Windows. The computer's own clock is never changed.",
      privacyText:
        "This stick has no network, so nothing leaves it. Your texts and settings are encrypted, and only your passphrase opens them. The names of your keyboard layouts are the one thing kept unencrypted, so the unlock screen can use them.",
    },
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
    focusDimmingHint:
      "In Zuhd mode, the text outside the focus. Faint is harder to read; Quiet keeps every line easy to read.",
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
    fadeChrome: "Fade the status line while typing",
    basmallah: "Show the Basmallah opening",
    basmallahHint: "Shown above every document, centred. It is never part of the file.",
    smartPunctuation: "Smart punctuation",
    smartPunctuationHint:
      "Typed quotes, dashes and ellipses become “ ” ‘ ’ – — …, and « » in Arabic.",
    formatBar: "Formatting bar",
    formatBarHint: "Shows the formatting bar above text you select.",
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
