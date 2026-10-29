// Every word on the site that isn't fixed in GUIDELINES.md (the film's lines, the
// manifesto), in one place, so the author can review and change it here. Lines with a
// source say where they come from; the rest were drafted for the author's review
// (2026-10-29: "fix all, I review").

export const copy = {
  /** For search results and link previews. From the README. */
  description: "Nothing writes for you.",

  header: {
    /** The author's words ("get bismillah editor", 2026-10-28), with "the" added. */
    stick: "Get the bismillah editor",
  },

  film: {
    /** The player's name for screen readers: the film's title (GUIDELINES.md). */
    label: "Prompting is not thinking, writing is.",
    /** The small label over the film's title: what it is and how long (the cut is
     * 2:15), never "promo". */
    kicker: "a short film · 2:15",
    /** The player's controls have no visible words; these are their names for screen
     * readers. Proposed plainly, awaiting the author's approval. */
    controls: {
      group: "Film",
      play: "Play",
      pause: "Pause",
      position: "Position",
      mute: "Sound off",
      unmute: "Sound on",
      fullscreen: "Full screen",
      /** The captions track's name in the browser's own menu. */
      captionsTrack: "English",
    },
  },

  /** The editor, shown: the stick's real screens on her laptop (Screens.astro), and
   * the words that change them. The heading is the README's own. */
  screens: {
    heading: "A typewriter, with only the best of the computer",
    /** The accessible name of the four words. */
    label: "What the screen shows",
    states: [
      {
        picture: "page",
        label: "Write",
        line: "The page, and nothing else.",
        alt: "Her laptop on the table, the editor open on it: an essay's title, a heading and paragraphs on a plain page, a quiet status line below.",
      },
      {
        picture: "zuhd",
        label: "Zuhd",
        line: "The paragraph you are writing. The rest falls quiet.",
        alt: "The laptop in Zuhd mode: the paragraph with the caret in dark ink, the headings and the next paragraph in grey.",
      },
      {
        picture: "arabic",
        label: "Arabic",
        line: "Arabic as Arabic, vocalised and right to left.",
        alt: "The laptop showing a document titled al-Fātiḥa: a vocalised Arabic verse set right to left, its transliteration and a line mixing Arabic and English.",
      },
      {
        picture: "suggestion",
        label: "Check",
        line: "Spelling and grammar, checked on your own computer.",
        alt: "The laptop showing a misspelled word, teh, with its suggestions open: the, tea, tech, tee and tel.",
      },
    ],
  },

  close: {
    /** The line under bismillah that says what it is. From the README. */
    what: "Nothing writes for you.",
  },

  stick: {
    /** The stick README's title (os/README.md). */
    heading: "The bismillah stick",
    /** The stick's README (os/README.md), its opening paragraph split into what it is
     * and its promises. */
    about: "A USB stick that starts a laptop straight into bismillah and nothing else.",
    claims: [
      "No network, no shell and no other program.",
      "Your texts are encrypted on it.",
      "The laptop it boots on is left untouched.",
      "Secure Boot stays on.",
    ],
    /** Three steps, plain enough for someone who has never opened a terminal. Each
     * has a picture beside it (src/assets/steps/), so its words can stay short. */
    steps: [
      {
        title: "Get a USB stick",
        /** os/README.md, on the stick and on the first flash. */
        detail: "Any USB stick of 2 GB or more will do. Everything on it will be erased.",
      },
      {
        title: "Put bismillah on it with one command",
        /** Said under each command instead, for the computer it is for. */
        detail: "",
      },
      {
        title: "Start your laptop from the stick",
        /** os/README.md, "When a laptop won't boot it". */
        detail:
          "Turn the laptop on while tapping its boot-menu key (F12 on a Dell; on others F9, F10, F11, F12 or Esc), and pick the stick.",
      },
    ],
    /** One command for each kind of computer, which downloads bismillah and puts it on
     * the stick, or updates a bismillah stick (web/public/install.sh and install.ps1,
     * ADR-0017). Stick.astro writes the commands on the site's address; these are the
     * label above each (shown only when both are) and where to paste it. */
    commands: {
      unix: {
        label: "macOS and Linux",
        paste:
          "Open Terminal (on a Mac, it is in Applications › Utilities), paste the command and press Enter.",
      },
      windows: {
        label: "Windows",
        paste: "Open PowerShell from the Start menu, paste the command and press Enter.",
      },
    },
    /** That the same command updates a stick and keeps its texts. os/README.md,
     * "Updating a stick, keeping its texts". */
    update: "Run it again on a bismillah stick to update it. Your texts stay.",
    /** The copy button's word, and the word it shows once the command is copied. */
    copy: "Copy",
    copied: "Copied",
    /** The published image's size (os/scripts/publish.ts prints it): set it again when
     * a new image is published. */
    details: "About 350 MB to download, all of it checked before anything is written to the stick.",
  },

  footer: {
    /** From PRIVACY.md. */
    privacy: "bismillah is built so that your writing stays yours.",
    /** The site's one typeface (Base.astro), as DESIGN.md §8 describes it. */
    colophon:
      "Set in Bismillah Duo, the editor's own typeface: iA Writer Duo with the IJMES letters added.",
  },
} as const;
