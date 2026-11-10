// Every word on the site that isn't fixed in GUIDELINES.md (the film's lines, which
// her page carries), in one place, so the author can review and change it here. Lines with a
// source say where they come from; the rest were drafted for the author's review
// (2026-10-29: "fix all, I review").

export const copy = {
  /** For search results and link previews: what it is, then what it promises. Both
   * from the README. */
  description: "A typewriter, with only the best of the computer. Nothing writes for you.",

  /** The page's title, in search results and link previews: the name and what it is. */
  title: "bismillah: a writing app that never writes for you",

  header: {
    /** Beside the name on the first screen: what it is, then what it promises. The README
     * calls it a writing app, and promises that nothing writes for you (2026-10-29; until
     * then the film's "These words are mine.", which the end card keeps). */
    what: "A writing app that never writes for you.",
    /** The author's words ("get bismillah editor", 2026-10-28), with "the" added, and
     * "app" for "editor" (2026-10-29): a writer reads "editor" as a person who changes
     * their text, and the README and the tagline call it a writing app. */
    stick: "Get the bismillah app",
  },

  film: {
    /** The film's title (GUIDELINES.md), on the picture and as the player's name for screen
     * readers. */
    label: "Prompting is not thinking, writing is.",
    /** The small label over the film's title: what it is and how long (the cut is
     * 2:15), never "promo". */
    kicker: "a short film · 2:15",
    /** Under the picture, for a visitor who won't press play: the page tells it too
     * (drafted 2026-10-30 for the author's review). */
    orScroll: "Or scroll, and read it.",
    /** In its place, when this browser can play none of the film's sources (drafted
     * 2026-10-30 for the author's review). */
    cannotPlay: "The film won't play here. Scroll, and read it.",
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

  /** Her page (src/content/her-page.md, the film's lines) as it is written. In the film she
   * asks the machine to finish her line, "Prompting is not thinking," and these are its
   * first words back (still 10-the-offer); she turns it face down and writes the rest. On
   * her page it offers them, between the two halves of her line, and is gone. Its words
   * are the film's. (The author kept it, 2026-10-30.) */
  page: {
    offer: {
      after: "Prompting is not thinking,",
      words: "but it can be a powerful starting point for deeper reflection.",
    },
  },

  /** The editor, shown: the stick's real screens on her laptop (Screens.astro), one
   * after another as the page scrolls, each with its name and line. The heading is the README's own, shown over the laptop
   * as the answer to her page's question (2026-10-29). */
  screens: {
    heading: "A typewriter, with only the best of the computer",
    /** What the app is for, one idea to a moment, as an Apple commercial shows it: her
     * own words first, then the app close on her screen, then what it keeps out, where
     * she can take it, and that it goes with her (the author, 2026-10-29: "think Apple",
     * "the writer's own words, no AI, a strong message", Arabic and Latin as equals,
     * privacy). Lines drafted 2026-10-29 for
     * the author's review. */
    states: [
      {
        picture: "words",
        label: "Your own words",
        line: "No AI. Nothing writes for you. Every word is yours.",
        alt: "At night, over her shoulder, her eyes on her screen: her page, How will we think? and the lines she wrote under it.",
      },
      {
        picture: "zuhd",
        label: "Zuhd",
        line: "The paragraph you are writing. The rest falls quiet.",
        /** The manifesto's first section (os/scripts/shots.ts), as her page's one-line
         * paragraphs can't show a whole paragraph kept in ink (2026-10-29). */
        alt: "Her hands still on the keys, her screen in Zuhd mode: the paragraph she is writing in dark ink, the ones around it in grey.",
      },
      {
        picture: "arabic",
        label: "Arabic and English",
        line: "Both on one page, as equals, every mark kept.",
        alt: "Morning light and the shadow of a carved window lattice across her desk; on her screen, al-Fātiḥa: a vocalised Arabic verse set right to left, its transliteration, and a line mixing Arabic and English.",
      },
      {
        picture: "private",
        label: "Private",
        /** "A trust": the README's amanah (2026-10-30, for the author's review). */
        line: "Your words are a trust. No internet, no camera, no microphone. No company reads them.",
        alt: "Close on the top of her laptop's screen: she peels away the old scrap of tape that covered its camera.",
      },
      {
        picture: "anywhere",
        label: "Anywhere",
        line: "Your writing lives on the stick, locked. Any PC laptop becomes yours.",
        alt: "In a public reading room, she pushes her stick into a shared laptop, and her own page is on its screen.",
      },
    ],
  },

  stick: {
    /** The stick README's title (os/README.md). */
    heading: "The bismillah stick",
    /** The stick's README (os/README.md), its opening paragraph said as what happens to
     * the laptop, which becomes the typewriter the editor's heading promises (2026-10-29,
     * drafted for review), and that it costs nothing (README.md: "a free, open-source
     * writing app"); Secure Boot stays in the README. "A PC laptop" from the first line,
     * as the stick never starts a Mac, although step 2 offers a Mac the command
     * (2026-10-29). */
    about: [
      "Start a PC laptop from it, and the laptop becomes a typewriter: bismillah, with no internet and no other apps.",
      "It's free, with no account. Your texts are kept encrypted on the stick, and when you take it out, the laptop is as it was.",
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

  /** The page that isn't there. */
  notFound: "This page was never written.",

  /** What the page leaves open, each answer folded under its question (the author,
   * 2026-10-31, in place of the line a visitor could write on). Drafted for the author's
   * review, in the plain voice of ia.net: the answer, and only what the asker wants to know
   * (the author: "user doesn't bother" with the details). The details stay where someone
   * goes for them: os/README.md and PRIVACY.md. None explains the name or the Islamic
   * foundations, which the site expects its readers to know. "Nothing that writes" comes
   * last, so it leads to her last line. */
  questions: {
    heading: "Questions",
    items: [
      {
        /** os/README.md, "Tested laptops": best effort beyond the few tried. */
        q: "Will it start on my laptop?",
        a: "It should, on most PC laptops, though it hasn't been tried on many. Try it.",
      },
      {
        /** os/PLAN.md, Hardware. */
        q: "And on a Mac?",
        a: "No. A Mac can make the stick, but can't start from it.",
      },
      {
        /** README.md, Install. */
        q: "Can I use it without the stick?",
        a: "Not yet.",
      },
      {
        /** os/README.md, "Getting a stick without building one". */
        q: "Is it safe to paste that command?",
        a: "It writes only to the stick you choose, and only after you type its name back.",
      },
      {
        /** os/README.md, tested: it never mounts or writes to the laptop's disks. The question
         * asks about files, as one boot does change firmware variables (disclosed there). */
        q: "Will it touch my files?",
        a: "No. It never opens the laptop's disks.",
      },
      {
        /** os/README.md, encrypted at rest; its limits are under "Not protected". */
        q: "Someone finds my stick. Can they read it?",
        a: "Not without your passphrase.",
      },
      {
        /** os/README.md: "There is no recovery". */
        q: "What if I forget my passphrase?",
        a: "Your texts are gone. There is no reset.",
      },
      {
        /** No backup exists; one is only listed under os/PLAN.md, "Later". */
        q: "What if I lose the stick?",
        a: "Same. It holds the only copy.",
      },
      {
        /** os/PLAN.md, "Out of scope"; docs/guide.md. */
        q: "How do I get my writing off the stick?",
        a: "Not easily. The stick can't send or print anything. That's on purpose.",
      },
      {
        /** README.md. */
        q: "What does it cost?",
        a: "Nothing, apart from the USB stick.",
      },
      {
        /** PRIVACY.md, "What bismillah never does", which also names the grammar checker's
         * small model. */
        q: "Is there AI in it?",
        a: "Nothing that writes. Spelling and grammar checks only suggest, and you accept each change.",
      },
      {
        /** contact@ forwards to the maker (Cloudflare Email Routing); the GitHub is his. */
        q: "Who makes it?",
        a: [
          "Yunus Andreasson. Write to ",
          { text: "contact@bismillah.ink", href: "mailto:contact@bismillah.ink" },
          ", or find him on ",
          { text: "GitHub", href: "https://github.com/YunusAndreasson" },
          ".",
        ],
      },
    ],
  },
} as const;
