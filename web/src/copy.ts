// Every word on the site that isn't fixed in GUIDELINES.md (the film's lines, which
// her page carries), in one place, so the author can review and change it here. Lines with a
// source say where they come from; the rest were drafted for the author's review
// (2026-10-29: "fix all, I review").

export const copy = {
  /** For search results and link previews: what it is, then what it promises. Both
   * from the README. */
  description: "A typewriter, with only the best of the computer. Nothing writes for you.",

  header: {
    /** Beside the name on the first screen: what it is, then what it promises. The README
     * calls it a writing app, and promises that nothing writes for you (2026-10-29; until
     * then the film's "These words are mine.", which the end card keeps). */
    what: "A writing app that never writes for you.",
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
   * the words that change them. The heading is the README's own, shown over the laptop
   * as the answer to her page's question (2026-10-29). */
  screens: {
    heading: "A typewriter, with only the best of the computer",
    /** The accessible name of the five words. */
    label: "What the screen shows",
    states: [
      {
        picture: "page",
        label: "Write",
        line: "The page, and nothing else.",
        alt: "Her laptop on the table, the editor open on it: her page, How will we think? and the six lines under it on a plain page, a quiet status line below.",
      },
      {
        picture: "zuhd",
        label: "Zuhd",
        line: "The paragraph you are writing. The rest falls quiet.",
        /** The manifesto's first section (os/scripts/shots.ts), as her page's one-line
         * paragraphs can't show a whole paragraph kept in ink (2026-10-29). */
        alt: "The laptop in Zuhd mode on a longer text of hers, Attention: the paragraph with the caret, Fast forward into the digital era and everything became fluid, in dark ink, the paragraphs above and below it in grey.",
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
      {
        picture: "files",
        label: "Files",
        /** Files (ADR-0016) finds a text by letters of its name; the screen types "memo"
         * among the manifesto's sections (os/scripts/shots.ts). Drafted 2026-10-29. */
        line: "Any text, found by a few letters of its name.",
        alt: "The laptop with Files open over her page: memo typed in its search, and the one text it finds, Memory.md, in her Manifesto folder.",
      },
    ],
  },

  stick: {
    /** The stick README's title (os/README.md). */
    heading: "The bismillah stick",
    /** The stick's README (os/README.md), its opening paragraph said as what happens to
     * the laptop, which becomes the typewriter the editor's heading promises (2026-10-29,
     * drafted for review), and that it costs nothing (README.md: "a free, open-source
     * writing app"); Secure Boot stays in the README. */
    about: [
      "Start a laptop from it, and the laptop becomes a typewriter: bismillah, with no internet and no other apps.",
      "It's free. Your texts are kept encrypted on the stick, and when you take it out, the laptop is as it was.",
    ],
    /** Three steps, plain enough for someone who has never opened a terminal. Each
     * has a picture beside it (src/assets/steps/), so its words can stay short. */
    steps: [
      {
        title: "Get a USB stick",
        /** os/README.md, on the stick and on the first flash, shortened. */
        detail: "2 GB or more. Everything on it is erased.",
      },
      {
        title: "Put bismillah on it with one command",
        /** Said under each command instead, for the computer it is for. */
        detail: "",
      },
      {
        title: "Start your laptop from the stick",
        /** os/README.md, "When a laptop won't boot it", shortened to the usual keys. "A PC
         * laptop": the stick is made and tested for PCs, never for a Mac, although a Mac
         * can make one (drafted 2026-10-29, for the author to confirm). */
        detail:
          "On a PC laptop, tap its boot-menu key as it starts (F12 on most, Esc or F9 on others) and pick the stick.",
      },
    ],
    /** One command for each kind of computer, which downloads bismillah and puts it on
     * the stick, or updates a bismillah stick (web/public/install.sh and install.ps1,
     * ADR-0017). Stick.astro writes the commands on the site's address; these are the
     * label above each (shown only when both are) and where to paste it. */
    commands: {
      unix: {
        label: "macOS and Linux",
        paste: "Open Terminal (Applications › Utilities on a Mac), paste it and press Enter.",
      },
      windows: {
        label: "Windows",
        paste: "Open PowerShell from the Start menu, paste it and press Enter.",
      },
    },
    /** That the same command updates a stick and keeps its texts. os/README.md,
     * "Updating a stick, keeping its texts". */
    update: "Run it again to update a stick; your texts stay.",
    /** The copy button's word, and the word it shows once the command is copied. */
    copy: "Copy",
    copied: "Copied",
    /** The published image's size (os/scripts/publish.ts prints it): set it again when a new
     * image is published. */
    details: "About 350 MB, all checked before anything is written.",
  },
} as const;
