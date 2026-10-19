/**
 * Words the guide (docs/guide.md, Help › Guide) uses that the spelling checker doesn't
 * know: bismillah's own names and the names it mentions. They are ignored in the guide
 * only, as if the writer had chosen *Ignore* for each, so the guide opens without marks;
 * the writer's own files are checked as always. tests/e2e/guide.e2e.ts fails if the
 * guide shows a mark, so a new word in the guide is either rephrased or listed here.
 */
export const GUIDE_WORDS: readonly string[] = [
  "bismillah",
  "Zuhd",
  "Basmallah",
  "Qur’anic",
  "frontmatter",
  "Amiri",
  "Uthmani",
  "amanah",
  "iA",
];

/** The guide's file name, as Rust names the sample (src-tauri/src/app.rs). */
export const GUIDE_NAME = "guide.md";
