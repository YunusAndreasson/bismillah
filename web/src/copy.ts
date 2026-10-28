// Every word on the site that GUIDELINES.md hasn't approved, in one place. Every word
// here is the author's to write: a ⟨…⟩ is a placeholder that shows on the page until
// it is replaced (web/AGENTS.md: never write copy, leave a visible placeholder and ask).
// The approved lines (bismillah, "These words are mine.") are used where they appear;
// the lines below without ⟨…⟩ are the author's own, chosen on 2026-10-28.

export const copy = {
  /** For search results and link previews. From the README. */
  description: "Nothing writes for you.",

  header: {
    stick: "⟨the link to the stick⟩",
  },

  film: {
    /** The player's name for screen readers. */
    label: "⟨the film's name⟩",
    /** The player's controls have no visible words; these are their names for screen
     * readers. Proposed plainly, awaiting the author's approval. */
    controls: {
      group: "Film",
      play: "Play",
      pause: "Pause",
      position: "Position",
      mute: "Sound off",
      unmute: "Sound on",
      captions: "Captions",
      fullscreen: "Full screen",
      /** The captions track's name in the browser's own menu. */
      captionsTrack: "English",
    },
  },

  /** A second document after the manifesto, if the author writes one about the editor. */
  editor: "⟨a manifesto that describes the editor⟩",

  close: {
    /** The line under bismillah that says what it is. From the README. */
    what: "Nothing writes for you.",
  },

  stick: {
    heading: "⟨the stick: its heading⟩",
    /** The stick's README (os/README.md), its opening paragraph split into what it is
     * and its promises. */
    about: "A USB stick that starts a laptop straight into bismillah and nothing else.",
    claims: [
      "No network, no shell and no other program.",
      "Your texts are encrypted on it.",
      "The laptop it boots on is left untouched.",
      "Secure Boot stays on.",
    ],
    steps: ["⟨the first step⟩", "⟨the second step⟩", "⟨the third step⟩"],
    needs: "⟨what you need: the stick's size and the computers it starts on⟩",
    download: "⟨the download link⟩",
    details: "⟨the image's size and checksum⟩",
  },

  footer: {
    /** From PRIVACY.md. */
    privacy: "bismillah is built so that your writing stays yours.",
    colophon: "⟨the colophon: the typefaces⟩",
  },
} as const;
