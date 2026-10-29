/**
 * What About lists (DESIGN.md §4): what bismillah is made with, and each part's licence.
 * `about.test.ts` checks that every package the app ships appears here, so the list
 * can't fall behind ARCHITECTURE.md §2.
 */

export interface Credit {
  name: string;
  /** What it does in bismillah, in a few words. */
  role: string;
  licence: string;
  /** The packages (npm and Rust) it stands for. */
  packages: readonly string[];
}

export const FONTS: readonly Credit[] = [
  {
    name: "Bismillah Duo and Bismillah Mono",
    role: "iA Writer Duo and Mono by Information Architects, after IBM Plex, with the IJMES letters added",
    licence: "SIL Open Font License 1.1",
    packages: [],
  },
  {
    name: "Source Serif 4",
    role: "by Adobe",
    licence: "SIL Open Font License 1.1",
    packages: [],
  },
  {
    name: "Amiri and Amiri Quran",
    role: "by the Amiri Project Authors",
    licence: "SIL Open Font License 1.1",
    packages: [],
  },
  {
    name: "IBM Plex Sans Arabic",
    role: "by IBM",
    licence: "SIL Open Font License 1.1",
    packages: [],
  },
];

export const LANGUAGE: readonly Credit[] = [
  {
    name: "Ayaspell",
    role: "the Arabic dictionary",
    licence: "GPL 2.0 or later, LGPL 2.1 or later, or MPL 1.1 or later",
    packages: [],
  },
  {
    name: "Harper",
    role: "English spelling and grammar",
    licence: "Apache 2.0",
    packages: ["harper-core"],
  },
  {
    name: "Spellbook",
    role: "Arabic spelling",
    licence: "MPL 2.0",
    packages: ["spellbook"],
  },
];

export const SOFTWARE: readonly Credit[] = [
  {
    name: "Tauri",
    role: "the desktop app",
    licence: "MIT or Apache 2.0",
    packages: ["tauri", "tauri-plugin-dialog", "@tauri-apps/api"],
  },
  {
    name: "gtk-rs",
    role: "the menu bar and the keyboard layout",
    licence: "MIT",
    packages: ["gtk"],
  },
  {
    name: "webkit2gtk-rs",
    role: "a webview without sound or media",
    licence: "MIT",
    packages: ["webkit2gtk"],
  },
  {
    name: "CodeMirror and Lezer",
    role: "the editor",
    licence: "MIT",
    packages: [
      "@codemirror/commands",
      "@codemirror/lang-markdown",
      "@codemirror/language",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/markdown",
    ],
  },
  { name: "Svelte", role: "the interface", licence: "MIT", packages: ["svelte"] },
  { name: "Bits UI", role: "dialogs and menus", licence: "MIT", packages: ["bits-ui"] },
  { name: "notify", role: "noticing changed files", licence: "CC0 1.0", packages: ["notify"] },
  { name: "trash", role: "Move to trash", licence: "MIT", packages: ["trash"] },
  {
    name: "ICU4X",
    role: "the library's sort order",
    licence: "Unicode 3.0",
    packages: ["icu_normalizer"],
  },
  {
    name: "Serde, toml_edit, thiserror, libc",
    role: "files and settings",
    licence: "MIT or Apache 2.0",
    packages: ["serde", "serde_json", "toml_edit", "thiserror", "libc"],
  },
];
