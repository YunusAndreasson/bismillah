# bismillah — Design

Because everybody needs some time, one their own. Yeah, everybody needs some time all alone.

> A typewriter, with only the best of the computer.

This document is the design foundation of bismillah. It defines what the product is, how it should look and behave, and how design work is judged. When a desi2zgn question is not answered here, decide in the spirit of this document and then add the answer here.

The architecture that supports these decisions lives in [ARCHITECTURE.md](ARCHITECTURE.md). Decisions with lasting consequences are recorded in [docs/decisions/](docs/decisions/).

---

## 1. Purpose

bismillah is a Markdown editor for people who want to write. It has no accounts, no subscriptions, no ads, no telemetry, no network features and no generative AI: nothing writes, rewrites or summarises for the writer, or does their thinking. Beyond typing, it offers two aids: **spelling** (English and Arabic) and **grammar suggestions** (English). Directories and filenames organise the writing, and YAML frontmatter is the only metadata.

Because the feature set is small, design is the product. Every pixel, word and interaction is held to a high standard.

**The first writer** is the author: long-form prose and Islamic studies, mostly in English with Arabic phrases and Qur'anic quotations (including Uthmani orthography) and IJMES transliteration. Design for that writer first; it serves many others too. The interface is in English for 1.0, with labels kept in one place so translations can come later.

## 2. Principles

Each principle states how it is judged. A principle that cannot be judged is decoration.

| # | Principle | Judged by |
|---|---|---|
| 1 | **The text comes first.** The document and the caret are the most important things on screen. | In the normal writing state, nothing competes with the prose for attention. |
| 2 | **Every feature earns its place.** (Rams) | A proposed feature must improve the core writing task. "Nice to have" is a no. |
| 3 | **The writer's words are a trust (amanah).** | Text is never lost, never silently changed, and failures are always visible. See §4 and ARCHITECTURE.md §5. |
| 4 | **Honest about what it does.** | "Saved" appears only after a durable write. Privacy claims match tested behaviour. Grammar results are worded as suggestions, not verdicts. |
| 5 | **Keyboard first, never keyboard only.** | Every action has a shortcut and a palette entry, and the essential actions can also be found without the palette. |
| 6 | **Arabic and Latin are equals.** | Mixed-script, RTL and vocalised Arabic text meet the same acceptance criteria as English, from Phase 0. |
| 7 | **Restraint in resources.** | Few dependencies, few fonts, no background work when idle. |
| 8 | **Calm, not clever.** | No streaks, scores, celebrations, nudges or unsolicited prompts. |

## 3. What bismillah will never have

Accounts or sign-in · sync services · telemetry, analytics or crash reporting · ads or upsells · generative AI or LLM features (grammar checking that only flags and suggests may use small local models, ADR-0004) · remote fonts, images or resources · auto-updaters that contact servers · engagement mechanics (streaks, goals that nag, badges) · a proprietary file format · prayer scheduling, Qur'an/hadith databases or religious-content classification (each is a separate product).

## 4. Islamic principles as design constraints

The project is inspired by Islamic ethics. These principles shape how the app treats the writer, their work and their attention. They strengthen requirements a dependable editor needs anyway, and they need no extra runtime code, service or "religious mode". The verses are ethical reference points; they do not prescribe these particular technical choices.

| Principle | Reference | What it means here |
|---|---|---|
| **Amanah** (trust) | Qur'an [4:58](https://quran.com/4/58) | Reliable saves, visible failures, recoverable destructive actions, portable plain-text files. Never silently normalise Arabic, remove diacritics, change punctuation or rewrite frontmatter. |
| **Privacy** | Qur'an [49:12](https://quran.com/49/12) | Writing and diagnostics stay on the device. Document contents never appear in logs. File access only to locations the writer chose. |
| **Justice and ihsan** (fairness, excellence) | Qur'an [16:90](https://quran.com/16/90) | Equal care for keyboard users, low-vision users, and Arabic and Latin writers. A small set of interactions, refined until dependable. |
| **Restraint** | Qur'an [7:31](https://quran.com/7/31) (an analogy from its context of eating and drinking) | Small dependency and font footprint, incremental work, no attention-seeking features. |
| **Care in claims** | Qur'an [17:36](https://quran.com/17/36) | Say only what is tested: status messages, privacy statements and suggestion wording. |

The app's inspiration is stated briefly in About and in the README. It does not appear as decoration in the interface.

## 5. References

Each reference informs a specific decision and is judged in a specific way. Citing a reference does not mean adopting its whole visual language.

| Reference | Informs | Judged by |
|---|---|---|
| **Dieter Rams** — [ten principles](https://www.vitsoe.com/rw/about/good-design) | Feature restraint, honesty, longevity | Does the feature improve the core writing task? |
| **iA** — [responsive typography](https://ia.net/topics/bringing-responsiveness-the-app-world), [iA Writer](https://ia.net/writer/) | Bounded measure, quiet Markdown, typography as interface | The specimen, with the real fonts, at every test width |
| **Khaled Hosny / Alif Type** — [Amiri](https://aliftype.com/amiri/) | Arabic typesetting, the Basmallah, diacritics | Vocalised Arabic renders without clipping, collisions or broken shaping |
| **W3C** — [Arabic layout requirements (alreq)](https://www.w3.org/TR/alreq/) | Mixed-script layout, diacritic space, no Arabic letter-spacing | The mixed-script fixtures |
| **IBM Design / Plex** — [type guidance](https://www.ibm.com/design/language/typography/type-scale/) | Systematic spacing, per-script type adjustments | Consistent interface hierarchy and per-profile type values |
| **GOV.UK Design System** — [design system](https://design-system.service.gov.uk/) | Plain language, error messages, settings layout | A first-time user understands each error and setting without help |
| **GNOME HIG** — [header bars](https://developer.gnome.org/hig/patterns/containers/header-bars.html) | Linux window behaviour, drag regions | Move, resize and close behave as users expect on Linux |
| **Adobe Spectrum** — [design data](https://spectrum.adobe.com/foundations/design-data) | Primitive → semantic token structure, interaction states | Components use only semantic tokens |
| **WCAG 2.2** — [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | Measurable contrast everywhere | The automated contrast assertions in §9 |
| **MUJI** | Discipline in materials | A small font set, restrained surfaces, minimal dependencies |

## 6. Information architecture

The interface has six areas. Each has one responsibility.

| Area | Responsibility |
|---|---|
| **Writing surface** | Edit the current document; show local diagnostics. |
| **Library** | Browse directories and files; show the active file and its context. |
| **Quick open** | Find a file by name or path; show parent paths so duplicate names can be told apart. |
| **Command palette** | Find any action by its canonical name, with its shortcut visible. |
| **Settings** | One screen, a few labelled sections: Appearance · Writing · Language & checking · Files & privacy (below). Add an Extensions section only once extensions exist. |
| **File status** | Saving, failure, conflict and recovery, shown without hiding the affected document. |

Rules:
- The same name and command ID is used in menus, the palette, shortcuts, Settings and the docs.
- **Filenames are the file's identity.** A frontmatter `title` may supplement the filename but never disguises the path.
- Empty, loading, unavailable and error states appear in the area they belong to.
- The palette is never the only way to find an essential action. The native application menu also lists them: always in the macOS menu bar, and on Linux and Windows hidden until `Alt` or `F10` (ARCHITECTURE.md §12.2).
- The information architecture stays the same at every window width; only the layout changes.

### Hierarchy by task

- **Normal writing:** document and caret → current file and location → tools for the current task → passive metadata (reading time).
- **When saving fails or a conflict needs resolving:** the recovery message becomes the most important element and stays visible until resolved.

Hierarchy is built with spacing, placement, alignment and weight before colour. Quiet text uses the `text-secondary` token, never arbitrary opacity.

### Settings and About (Phase 5)

- **One dialog, four sections**, with a row of links at the top that scroll to each and move focus to its heading; the title, the links and *Done* stay in view while the sections scroll. Every change applies at once and is saved; there is no *Apply*.
  - The dialog says **Changes apply immediately**. Size and line-height steppers disable at their limits; a line height following the writing profile says **font default**. A settings write failure appears inside the open dialog with **Try again**, which retries the current choices. In short windows the header/footer padding contracts, and focused controls scroll clear of both sticky boundaries.
  - Section links keep headings aligned consistently after reopening or resizing the dialog.
  - **Appearance:** Theme (System / Light / Dark) · Colours (§9.5) · High contrast · Writing font (with *Another font*, §8.2) · Text size · Line length · Line height · Fade the status line · Show the Basmallah opening.
  - **Writing:** Smart punctuation · Typewriter scrolling · Always show Markdown · Zuhd mode · Focus on · Other text (§11.1).
  - **Language & checking:** Check spelling · Grammar suggestions · English spelling.
  - **Files & privacy:** the library folder (*Open folder…*), keyboard shortcuts (§13: how many `keybindings.toml` changes, the lines it couldn't use, or *Create keybindings.toml*), where the writer's own files are, how unsaved text is kept, and the privacy statement in one sentence.
- **Problems are shown where they belong:** a theme file's below Colours, `keybindings.toml`'s under Keyboard shortcuts, each line by line in plain words. A notice in the notices row says only that something couldn't be used and offers **Show in Settings**, which opens Settings at that section.
- **About bismillah** (Help menu, the palette, and a button at the foot of Settings): the name, one line on what it is, the version, the inspiration in two short paragraphs (§4), and what it is made with under which licence (fonts, the dictionary and checkers, the software), grouped and listed in `text-secondary`. It opens at its start, with focus on *Close*, which stays visible while the credits scroll.
- **Guide** (Help menu, `F1`, the palette; Phase 6): the guide (`docs/guide.md`) opens in the writing surface as a sample, like any document but never saved (*Guide — changes aren't saved*), so the writer can try what it describes. `F1` opens it afresh. Its own vocabulary (the app's names) is ignored by the checker in the guide alone.
- **Settings › Files & privacy** offers *Show in file manager* for the library, the settings folder and the recovery folder (Phase 6), each button described by its setting's heading.

### The library, quick open and the palette (Phase 2)

- **The library is one folder** the writer opens (*Open folder…*, a folder on the command line or dropped on the window). Opening a file from elsewhere makes that file's folder the library.
- **Rows:** folders first, then files, in natural order. Numbers sort by value ("Chapter 2" before "Chapter 10", Arabic-Indic digits too). Letters sort by their base letter, with diacritics, vocalisation and the IJMES ʿ ʾ set aside, as a catalogue would ("ʿIlm" under I, "Ḥadīth" under H). Only `.md` and `.markdown` files are listed, with their ending in `text-secondary`; hidden names (a leading dot) are not.
- **The open file** is the selected row: a 3px `accent` edge bar, weight 600 and `aria-selected`. Keyboard focus is a separate ring, so the open file and the focused row can differ.
- **A link that leads outside the library** is listed in `text-secondary` with "· outside the library" and can't be opened.
- **Its own states, in its own area:** no folder open (*Open a folder…*), an empty folder (*New file…*), a folder that isn't available (*Try again* · *Choose another folder…*), and a listing cut short because the folder holds too many entries.
- **Quick open** finds files by name or folder and shows each file's folders beside its name, so files with the same name are told apart. Matching ignores case, Latin diacritics, Arabic vocalisation and ʿ ʾ ("hadith" finds "ḥadīth.md"). With nothing typed, recently opened files come first.
- **The palette** lists every command that can run now, with its shortcut, finds commands by their aliases too, says which switches are *On*, and shows a one-sentence description where the label alone isn't enough.
- Quick open and the palette have visible titles, **Close** buttons and a short keyboard hint. Switches explicitly say **On** or **Off**. Truncated file names, paths and descriptions expose their complete text on hover. An empty library offers **New file…** rather than claiming no file matches; an unavailable library offers **Choose another folder…** if it becomes unavailable while quick open is open. The overlay library has a visible **Close** button that returns focus to writing.
- **Names are asked for in a small dialog** (*Rename…*, *New folder…*). A rename starts with the name selected up to its ending. A name that can't be used is explained under the field and nothing changes; a file name without `.md` or `.markdown` gets `.md`, so the file stays in the library.
  - The form stays within short desktop windows. A long title is ellipsised with its full text available on hover; the name field retains the complete filename. Validation brings its explanation into view, and the controls remain reachable by keyboard.
- **Move to trash** never asks; it says *Moved “x” to the trash.* with **Undo**. The open document is saved first, and is never renamed or moved while its changes aren't on disk or while recovered text for it is still on offer.

## 7. Layout and window behaviour

The prose column always has a deliberate, bounded measure. Wider windows add margin, not line length. Empty space is useful.

bismillah is a desktop app (ADR-0009). The widths below are desktop windows: tiled halves, small laptops, large monitors. Pointer and keyboard are the only inputs, so there are no touch targets or gestures, but nothing may be reachable by hover alone. The minimum window size is 480×360.

Layout responds to the **available content width in CSS pixels** (zoom included), not to the monitor's resolution.

| Available width | Behaviour |
|---|---|
| < ~900px | Single writing surface. The library opens as a temporary overlay. Outer padding shrinks toward 16–24px. Writing size is preserved. |
| ~900–1440px | Centred, bounded column. A docked library only when the library, gutters and a comfortable measure all fit; otherwise the overlay. |
| > ~1440px | Same measure. The library docks in the spare margin. The text stays near the window centre (the opposite margin is balanced). |
| Ultrawide | The same bounded layout. The desktop's own tiling handles side-by-side work. |

- A docked library takes about 240px, plus a 24px gap and at least 24px of edge padding (288px in all; `src/core/layout.ts`).
- **Docked, the column never narrows.** The library docks only when the whole column (measure and hanging gutters) fits beside it. While the margin can hold it, the column stays centred in the window, so opening the library moves no text. When the margin is narrower, the column moves just far enough to clear it, which changes smoothly as the window is resized. Otherwise the library is an overlay.
- The docked library is shown or hidden by the writer, and that choice is remembered. The overlay opens only when asked, traps focus, and closes when a file is chosen, on `Esc` or on a click outside; it is never remembered.
- A safe gutter is always reserved for hanging Markdown marks, including nested lists and RTL lines.
- **Fading chrome changes opacity and interactivity only, never layout tracks.** The text must not reflow when the mouse moves. Explicitly opening or closing the docked library may reflow, but the caret and scroll anchor are preserved.
- Implemented with CSS Grid and a few container/media queries. No layout library.

### App icon

The letter bāʾ (ب), the first letter of the Basmallah, from Amiri Bold, in the light page colour (`#F7F6F2`) on the accent green (`#1E6B4A`), on a rounded tile (author's choice, 2026-10-19: "keep it as clean as possible"). The letter's ink is 60% of the tile wide and set a little low, so the bowl and its dot sit at the optical centre; it stays legible at 16 px. `fonts/tools/build_icon.py` draws `src-tauri/icons/source.svg`, the scalable icon the package installs; the bitmaps are made from it.

### Window decorations

- The default is the platform's normal window behaviour: obvious move, resize and close (native decorations on Linux, which tiling window managers such as Hyprland may hide anyway).
- Complete visual minimalism is reserved for fullscreen (`F11`) and Zuhd mode.
- macOS later: overlay titlebar with the traffic lights. Windows later: native caption buttons.

## 8. Typography

### 8.1 Two separate type systems

- **Document typography** is the writing surface, rendered and revealed alike. It follows the selected writing profile.
- **Interface typography** covers the library, palette, settings and status. It uses the platform UI font (`system-ui`) at 14px / 1.45, and it never changes when the writing font changes.

### 8.2 The font set (bundled, SIL OFL)

Start small; expand only after these are excellent.

| Role | Family | Arabic pairing |
|---|---|---|
| Writer (default) | **iA Writer Duo** (shipped as Bismillah Duo) | IBM Plex Sans Arabic; **Amiri for now** (ADR-0011) |
| Serif | **Source Serif 4** (optical-size axis) | Amiri |
| Basmallah opening | Amiri | — |
| Qur'anic (Uthmani) runs | Amiri Quran | — |

- Code spans and blocks use iA Writer Mono (shipped as Bismillah Mono), from the same family as Duo.
- **Bismillah Duo / Bismillah Mono** are iA Writer Duo / Mono with the missing IJMES letters added from their own outlines, renamed as the OFL requires (fonts/build/README.md).
- **Uthmani text:** an Arabic run that contains alef wasla (U+0671) or Qur'anic annotation marks (U+06D6–U+06ED, U+08D3–U+08FF: small high letters, waqf signs, rub' el hizb) is set in **Amiri Quran**, which is designed for Mushaf orthography. The whole run switches, never single characters, so shaping is never split across fonts.
- **Transliteration coverage:** the Latin fonts must have real glyphs for the IJMES set (ā ī ū ḥ ṣ ḍ ṭ ẓ ʿ ʾ and capitals). A gap is fixed with a matched fallback, never left to the system's fallback font. Duo and Mono's gap is closed by Bismillah Duo and Mono.
- **Known platform defect:** WebKitGTK 2.54 misplaces Arabic marks that fonts position with vertical offsets (ADR-0011). IBM Plex Sans Arabic is unusable for vocalised text until that is fixed, so Duo pairs with Amiri for now.
- Any installed system font can be chosen by name, as an unsupported "custom" profile: *Another font* in Settings › Appearance, with a *Font name* field. It borrows Duo's rhythm (20px, 1.6) with a measure of 32em, and Bismillah Duo supplies any letter it lacks. It is used only when the system's font list (fontconfig) has it: WebKitGTK would otherwise draw an unknown name in a substitute font, so the field says *No installed font is called “…”, so iA Writer Duo is used.*

### 8.3 Writing profiles

Measured in the real webview in Phase 0 (docs/spikes/font-profiles.md) and recorded as tokens in `src/styles/profiles.css`.

| Profile | Size | Line height | Standard measure |
|---|---|---|---|
| iA Writer Duo | 20px | 1.6 (32px) | 66ch, 61–65 characters per line |
| Source Serif 4 | 21px | 1.6 (33.6px) | 30em (630px), 60–68 characters per line |
| IBM Plex Sans Arabic (Arabic-primary documents) | 22px | 1.7 | 32em (704px) |
| Amiri (Arabic-primary documents, serif) | 24px | 1.8 | 30em (720px) |

- **Vocalised and Qur'anic runs** get a taller inline box (2–2.1× their own size) where stacked marks would otherwise reach the next row, so only rows that contain them grow; bare Arabic and Latin keep the profile's rhythm.
- **Measure choices:** Narrow (0.85×), Standard, Wide (1.15×). These are preferences, not exact character counts.
- **`ch` is the width of the "0" glyph,** not an average letter, so measures are always checked on real text.
- **Size is stable.** Resizing the window changes margins and wrapping, never the writing size; text size never scales with the viewport.
  - `Mod-=`/`Mod--`/`Mod-0` change the writing size in small steps, and the choice persists.
  - Application zoom stays available for enlarging the interface too.
- **Line height** can be adjusted in Settings (with Reset), including generous values for accessibility and vocalised Arabic.
- **Mixed-script paragraphs:** one column width and a line height that fits both families.
  - The document never resizes or reflows as the caret moves between languages.
  - Direction, language and typography profile are three separate decisions. A few Arabic words in an English paragraph do not switch the paragraph's profile.
- It must be possible to reach lines of ≤ 80 characters and to enlarge text substantially (WCAG 1.4.8, AAA guidance).

### 8.4 Heading hierarchy

Real heading levels are always preserved. Levels are told apart by size, weight and spacing. Small caps, italics or colour may support the distinction but never carry it alone (they fail across scripts).

Restrained, so the text still reads like a manuscript. The same scale applies with the Markdown hidden or shown, so revealing a heading moves nothing (ADR-0012):

| Level | Size | Weight | Space above / below |
|---|---|---|---|
| h1 | 1.40em | 700 | 2 lines / 0.5 line |
| h2 | 1.22em | 700 | 1.5 / 0.5 |
| h3 | 1.08em | 700 | 1.25 / 0.25 |
| h4 | 1.00em | 700 | 1 / 0.25 |
| h5 | 1.00em | 600 | 1 / 0 |
| h6 | 1.00em | 600 + `text-secondary` | 1 / 0 |

The space counts the blank line that usually stands before and after a heading. **A heading never needs an extra Enter** (2026-10-19): where text runs right up to it with no blank line, above or below, the heading's line takes the space that blank line would give, so it looks the same either way (`markdownStyling.ts`, `cm-h-joined-above` / `-below`).

More space above a heading than below it, so the heading belongs to the text that follows (proximity). The `#` marks hang in the gutter. Never any letter-spacing for Arabic headings.

### 8.5 Getting the intended quality from each font

1. **Bundle the real styles:** regular and italic faces and the weights actually used. No synthetic bold or italic. Arabic families without an italic use weight for emphasis.
2. **Optical sizing:** `font-optical-sizing: auto` (Source Serif 4 has an `opsz` axis). Use standard CSS properties, not hard-coded variation settings.
3. **Features by role:**
   - Editor: kerning, contextual shaping and required ligatures only, with no discretionary ligatures and caret placement tested through ligatures.
   - Counts and tables: `tnum`.
   - Old-style figures (`onum`): not used in the writing surface.
   - Small caps: only where the font and script support them.
4. **Stable wrapping:** no hyphenation and no `text-wrap: pretty`, so lines don't rebalance as you type.
5. **Subsetting preserves coverage:** combining marks, shaping tables (GSUB/GPOS), Qur'anic annotation marks where the font has them, extended Latin, numerals and punctuation. Test the actual shipped files.
6. **Remeasure after fonts load or change:** wait for `document.fonts` to be ready before measuring. Tell CodeMirror when typography changes so the caret, selection, hanging marks and scrolling agree with what is rendered.

### 8.6 Arabic typography rules

- Never apply letter-spacing to Arabic. Preserve contextual shaping and every diacritic.
- Line boxes always leave room for stacked marks. Never shorten ascent or descent metrics just to align baselines.
- Test mixed-script punctuation, selection, caret movement and mouse placement on every relevant change.
- Arabic support is for everyone who writes Arabic. It is not a religious feature and needs no mode.

## 9. Colour

### 9.1 Structure

Primitive values (raw colours) feed **semantic tokens**. Components may use only semantic tokens; hex values in component CSS are a review failure. The Light and Dark themes each supply their own values. Offer **System** (the default), **Light** and **Dark**; an explicit choice is always respected.

### 9.2 Semantic tokens

| Token | Purpose | Light | Dark |
|---|---|---|---|
| `surface-editor` | Writing canvas; default overlay surface | `#F7F6F2` | `#151515` |
| `surface-panel` | Library, grouped settings, hover fill | `#EEEDE8` | `#202020` |
| `surface-code` | Ground of rendered code: `text-primary` at the alpha that draws `surface-panel` on the editor, so a selection drawn behind the text shows through | `#1E1E1E` at 4.3 % | `#D4D4D2` at 5.9 % |
| `text-primary` | Prose, primary labels | `#1E1E1E` | `#D4D4D2` |
| `text-secondary` | Paths, supporting labels, inactive Zuhd text | `#62625E` | `#A2A29B` |
| `syntax-marker` | Visible Markdown punctuation | `#6B6B65` | `#94948D` |
| `text-faint` | The status line's routine parts (§12) and the Basmallah wordmark (§11.2): `text-secondary` 40 % of the way toward `surface-editor`, in any theme; `text-secondary` in high contrast | `#9E9D99` | `#6A6A65` |
| `accent` | Caret, focus ring, active indicator (deep green) | `#1E6B4A` | `#6FBF95` |
| `selection-background` | Selected text | `#D6EADF` | `#23432F` |
| `border-control` | Boundaries needed to identify a control | `#84847C` | `#74746E` |
| `diagnostic-spelling` | Spelling underline and detail | `#9F3C36` | `#F08B82` |
| `diagnostic-grammar` | Grammar underline and detail | `#805D12` | `#D5B56A` |
| `status-error` | Save failures, invalid input | = `diagnostic-spelling` | = `diagnostic-spelling` |
| `focus-ring` | Keyboard focus outline | = `accent` | = `accent` |

A softer `border-decorative` may be added for separators that carry no meaning. It must never be used for a control boundary.

### 9.3 Verified contrast (WCAG 2.x, opaque sRGB)

| Foreground | on editor (L / D) | on panel (L / D) |
|---|---|---|
| `text-primary` | 15.42 / 12.30 | 14.22 / 10.98 |
| `text-secondary` | 5.66 / 7.11 | 5.23 / 6.34 |
| `syntax-marker` | 4.96 / 5.98 | 4.57 / 5.34 |
| `text-faint` | 2.51 / 3.36 | — (drawn on the editor only) |
| `accent` | 5.96 / 8.32 | 5.50 / 7.42 |
| `border-control` | 3.48 / 3.88 | 3.21 / 3.46 |
| `diagnostic-spelling` | 6.12 / 7.58 | 5.64 / 6.77 |
| `diagnostic-grammar` | 5.56 / 9.26 | 5.13 / 8.26 |
| `text-primary` on `selection-background` | 13.25 / 7.39 | — |

The accent is a deep green, the project's identity colour, chosen in the 2026-10-18 interview.

### 9.4 Rules

- Meaningful normal-size text is **≥ 4.5:1** against its actual background. Main prose aims for **> 7:1** in the default themes. Markdown marks count as meaningful text.
- Meaningful control boundaries and state indicators (focus included) are **≥ 3:1** against adjacent colours. A thin mark also needs enough size to be perceived.
- **One deliberate exception:** the status line's routine parts (the *Library* toggle, file name, *Saved*, reading time) and the Basmallah wordmark are `text-faint`, about 2.5:1 in light themes, so they don't pull the eye from the writing (author's request, 2026-10-19: "dimmed even more"). A save failure is never faint: it is `status-error` at full contrast. Hover and keyboard focus raise the toggle to `text-primary`, and high contrast keeps `text-secondary`.
- **Selected text is rendered in `text-primary`** (marks included), because `syntax-marker` falls to 4.29:1 (light) and 3.66:1 (dark) on the selection colour. Syntax styling never overrides selection readability.
- Colour meanings are fixed: green means interaction, the diagnostic colours mean problems. Green and red can be confused under red-green colour blindness, so colour is never the only signal:
  - spelling and grammar use different underline patterns and labels
  - a selected library item also gets a leading edge bar and heavier weight, and is exposed as selected to assistive technology.
- Automated assertions check every semantic foreground/background pair, including selected and hover states.
- A high-contrast override (pure black and white) is built in (§9.5). The system's forced-colours mode is respected, and `forced-color-adjust: none` is never applied wholesale.
- **No health claims.** Warm paper and charcoal are aesthetic defaults. We never claim that a theme prevents eye strain. No ambient-light sensing, no colour-temperature scheduling.

### 9.5 Colour themes and high contrast (Phase 5)

- **Colours** (Settings › Appearance) chooses a colour theme: **bismillah** (the colours above, the default) or another. **Theme** (System / Light / Dark) still chooses which variant shows; a theme without colours for that variant leaves it to bismillah's own.
- **Built-in themes** are *Sepia* (brown ink on warm paper) and *Slate* (cool grey), a deliberately small first set: the author plans a set of their own. They are theme files like the writer's (`src-tauri/themes/`), and `cargo test` holds each to the rules above, prose above 7:1.
- **A theme is a file** of semantic token values (§9.2) for light and/or dark, nothing else (ADR-0005, ARCHITECTURE.md §8). The writer's go in `~/.config/bismillah/themes/` and apply as soon as they are saved. Green stays the interaction colour and the diagnostic colours stay problems: a theme changes shades, not meanings.
- **Contrast is checked, not enforced.** A theme below a floor in §9.4 still applies, because it is the writer's choice; Settings lists each colour that falls short ("Dark: text-secondary is 2.2:1 on surface-editor, 1.9:1 on surface-panel…, and text needs 4.5:1."). A file that can't be read or sets no colour is listed with the reason and can't be chosen; if the chosen theme becomes unusable, bismillah's colours apply and a notice says so.
- **High contrast** (Settings › Appearance) is black and white, `#000` on `#FFF` and `#FFF` on `#000`, with every text pair at 7:1 or more, in both variants (`src/styles/tokens.css`, `tokens.test.ts`). It overrides any colour theme.

## 10. Spacing

There are two separate systems with separate purposes:

- **Interface spacing:** a 4px scale of `4 · 8 · 12 · 16 · 24 · 32 · 48`. Within a group 8px, between settings groups 24px.
- **Document rhythm:** font-relative units (`em`, `lh`) derived from the active profile's line height. Interface gaps do not have to land on the document rhythm.

## 11. The writing surface

- **Live preview** (ADR-0012, Phase 4). The document reads as rendered text: emphasis without its marks, links as their text, bullets for list markers, a bar for quotes, a rule for `---`, folded frontmatter, local images below their line.
  - **The block with the caret shows its Markdown** in `syntax-marker`. The `#` of headings, `>` of quotes and list markers hang in the reserved gutter, so text starts on one reading edge and revealing them moves nothing. This mirrors on RTL lines.
  - **What stands in for the marks**, all in `text-secondary` and drawn where the marks stand: a dot for `-`, `*` and `+`; the number of an ordered item as written; an outlined box for `[ ]`, with a filled centre for `[x]`; a 2px bar on the place of every `>`, through every row of the quote; a short centred rule (6em) for `---`. Inline code gets a `surface-code` ground in place of its backticks, a link's text a thin `text-secondary` underline (solid, so it never reads as a diagnostic), a footnote reference is raised and small. Raw HTML, entities and link definitions keep their Markdown in both states.
  - **A code block** (fenced or indented) sits on a `surface-code` ground that reaches a little into the gutters, so the code stays where the revealed block has it. Its fences are painted out, leaving a band of ground above and below, and the info string (`rust`) is a quiet `text-secondary` label at the end of the top band. In a quote the bars carry it, without a ground.
  - **A table** is drawn as a grid: no pipes or delimiter row, columns aligned as the delimiter row says, the header in bold over a `text-secondary` rule, rows and columns set apart by space alone, tabular figures. Each row is one line high and the rule stands in the delimiter row's line, so a table whose cells don't wrap reveals without moving. Cells are drawn as the text around them (emphasis, links, code, Arabic runs), keep their own direction, and the table takes its direction from its first strong letter, so an Arabic table reads from the right. Wide tables wrap their cells within the measure. A click puts the caret on the clicked character in the source and ↑ ↓ step into a table rather than over it. Tables inside quotes and list items keep their Markdown.
  - **Brackets mean what CommonMark says.** `[text](url)` is a link; `[text][label]` and `[label]` are links only when the label is defined in the document, and `[^1]` is a footnote only when its note exists, so a scholarly `[sic]` or `[emphasis added]` keeps its brackets.
  - **The frontmatter** folds to one quiet line of its keys (`title: Specimen · lang: en`); a newly opened document puts the caret on its first line of text, below it.
  - **Images** appear below their line, within the measure: a file inside the library (Rust checks every image path as it does every other, ARCHITECTURE.md §6), or one embedded as `data:`. An image from the web is never loaded: a quiet note says so and shows its address. So does a note for a file that is missing, outside the library or not an image.
  - **Reveal follows the caret, never the mouse,** so text never moves under the pointer. A press of the mouse button reveals nothing until its release; then the clicked block reveals and the caret's row keeps its height on screen. A double-click selects the word that was clicked, although the first click moved it. Hovering a link or image shows its address in a tooltip (`surface-editor`, `border-control`), which moves nothing, with *Ctrl+click to open* in `text-secondary` under a web or email link; the same address is in the source once the caret is in the block.
  - **Links open on Ctrl+click** (Cmd on macOS), and *Open link* opens the one at the caret, from the keyboard (Phase 6, ADR-0003). They go to the writer's browser, or mail app for an email address, and only web and email addresses go (Rust checks each): a link to a file, a script or another program's scheme says *Only web and email links open from bismillah.* in the status line. A plain click always puts the caret in the text. While Ctrl is held over a link the pointer is a hand. Rendered and shown links alike, in tables and Arabic text too.
  - **Always show Markdown** (Settings › Writing, View menu, `Mod-R`) keeps every mark visible, iA-style, exactly as Phase 1 draws it.
- **Caret:** 2px wide, in `accent`. **Selection:** `selection-background` with `text-primary` text.
- **Enter starts a paragraph** (2026-10-19). In a paragraph or heading at the top level, `Enter` inserts the blank line Markdown needs between paragraphs, so one press does what took two; at the end of a line whose paragraph runs on below, that rest becomes its own paragraph too. `Backspace` straight after takes the whole break back. `Shift+Enter` inserts a single line break. Lists and quotes keep their own `Enter` (the next item, the next quoted line); code, tables, frontmatter, blank lines and a caret at the start of a line keep the plain newline. It is a command at the caret, never a rewrite of what was typed (AGENTS.md rule 3). `src/editor/paragraphs.ts`.
- **Escape puts the pen down** (2026-10-19). The caret hides, the block it was in folds back to its rendered look, and Zuhd mode lights no sentence or paragraph, so the page reads as a whole. A selection collapses to its head; the text never changes. Typing, a key that moves the caret, a click, or the text taking focus back (from the palette, a menu or the library) carries on where the caret was. Escape inside a menu, dialog or the library keeps its own meaning. `src/editor/rest.ts`.
- **The caret** blinks on a 1.2-second cycle using discrete visibility updates, not an infinite CSS animation. It rests visibly after eight cycles (about ten idle seconds); typing, caret movement and regained focus show it immediately and restart blinking. Blinking stops when the editor loses focus, the page is hidden or read-only, and under reduced motion.
- **Typewriter scrolling** is on by default (`Mod-T`). The caret line sits slightly above centre, about 42% from the top of the writing area. Typing and keyboard motion keep it there; a mouse click doesn't scroll, so text never jumps away from the pointer. A document opens at its top, not with its first line pushed down to 42% (2026-10-19): lines above that line stay where they are, and the page starts following the caret once the text reaches it.
- **Diagnostics** are shown as you write by default; both can be switched off (Settings › Language & checking, the menu and the palette). Spelling uses a **wavy** underline in `diagnostic-spelling`; grammar uses a **dotted** underline in `diagnostic-grammar`. The underline sits below descenders and Arabic dots (lower still under an Arabic word) and never moves the text. Each marked word carries `aria-invalid="spelling"` or `"grammar"`.
  - They are hidden while the caret is inside the word being typed, and appear once typing pauses (about 300 ms) or the caret leaves. Nothing pops up unasked.
  - **What is checked:** English spelling (British by default; Settings › Language & checking › English spelling, or `lang: en-US` in a document's frontmatter), Arabic spelling with and without vocalisation, and English grammar. Never checked: Qur'anic runs (recognised by their characters, ADR-0004), IJMES transliteration (words with ʿ ʾ, macrons or dots below), other scripts, code, URLs and Markdown marks. Plain Latin names (*Ibn*, *Taymiyya*) are unknown words until added to the dictionary.
  - Grammar suggestions are about grammar: no advice on style (title case, the Oxford comma, long sentences, "very good" → "excellent"), and nothing smart punctuation already does.
  - **The suggestions menu** opens on `Mod-.` (the issue at the caret), `F7` / `Shift-F7` (the next or previous issue, selected and scrolled into view, wrapping round the document) or a right-click on a marked word. It is placed against the word and names the kind ("Possible spelling mistake" / "Grammar suggestion", underlined in the kind's own pattern), explains it in one sentence, then lists the corrections under *Replace with* (set in the writing font) and *Ignore*, plus *Add to dictionary* for spelling. The menu scrolls within the available window height. The first action has focus; arrows, `Enter` and type-ahead work as in any menu; `F7` / `Shift-F7` move on from inside it; `Esc` returns to the text with the word still selected.
  - *Replace* is one undoable edit, the caret after the new text. A correction that would delete a Markdown mark is never offered. *Ignore* lasts for this document and session and writes nothing; *Add to dictionary* writes the word to the writer's own `dictionary.txt`, which they may also edit by hand.
  - Asked where there is nothing to find, the status line says so for a moment (*No spelling or grammar issues.*, *Nothing to suggest here.*, *Spelling and grammar checking are off.*), announced politely to screen readers.
- **Frontmatter:** shown in `text-secondary`; folded to one quiet line outside the caret, never rewritten.
- **No separate preview mode.** *Copy as rich text* (`Mod-Shift-C`) puts the selection, or the whole document without its frontmatter, on the clipboard as HTML and as plain text (paragraphs apart, list markers kept), and says so for a moment in the status line. Local images paste as their description, since the paste target can't reach them; nothing typographic is changed.

### 11.1 Zuhd mode (زهد) — focus mode

Zuhd mode is the name of the focus feature. It reflects the product's commitment to restraint and undistracted writing. It is a product metaphor; it makes no claim that a writing mode fulfils the spiritual practice.

| Context | Copy |
|---|---|
| Menu / Settings label | **Zuhd mode** |
| Description | Focus on the current sentence or paragraph. |
| Commands | Enable Zuhd mode · Disable Zuhd mode |
| Granularity setting | Focus on: Sentence / Paragraph (default: **Paragraph**, which suits long-form revision) |
| About note | Zuhd (زهد) inspires a quieter space for writing. |

- Command ID `editor.toggleFocus`, setting key `focus_mode`, shortcut `Mod-D`.
- Palette search aliases: focus, distraction-free, sentence, paragraph, zuhd, زهد.
- Inactive text uses `text-secondary` by default, never an opacity hack. Stronger dimming is a user choice with an easy reset: Settings › Writing › **Other text**: *Quiet* (`text-secondary`, the default) or *Faint* (`text-secondary` 55% of the way to the page, a measurable colour of about 2.3:1 in light and 3:1 in dark, below the text floor by the writer's choice; the hint says *Faint is harder to read*).
- Zuhd mode does not silently turn on typewriter scrolling or fullscreen; each is controlled separately.

### 11.2 The Basmallah opening

Every document opens with a centred Basmallah, drawn as a quiet calligraphic wordmark:

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

It is **on by default** and can be turned off in Settings › Appearance (*Show the Basmallah opening*, key `basmallah_opening`). The off switch exists out of respect for an open-source audience of any faith or none.

- **A presentation element, never file content.**
  - It is not written to disk, not in CodeMirror's editable text, and not counted, spellchecked or grammar-checked. Opening a file never creates an edit.
  - It is not a heading and not in the outline.
  - Saving and copying document text preserve the real source; the Basmallah itself can still be selected and copied, and copying it gives exactly the text above.
- **Typesetting:**
  - **A wordmark, not a heading** (author's request, 2026-10-19): Amiri's Basmallah ligature ﷽, the traditional composition with the long sīn, starting at 17px / 1.8 (about 195px wide) and scaling with the writing-size preference; `text-faint` colour (§9.4), so it sits back from the writing; `lang="ar" dir="rtl"`; centred in the reading column.
  - **Drawn from pre-shaped outlines** (ADR-0011): the ligature shaped by HarfBuzz with Amiri, every mark at its true height (`fonts/tools/build_basmallah.py` → `src/editor/basmallahInk.ts`). It is laid over the real text on the same baseline and advance box; the text stays in the page, transparent, and is what is selected, copied and read by screen readers. Selecting it shows `selection-background` behind the ink.
  - Always one line: in a narrow window at a large writing size it shrinks to fit the column instead of wrapping.
  - One body line of space above and one and a half below (less on short windows); enough block and inline padding for every mark.
  - No decorative colour, ornament or image.
- **Placement:** it scrolls with the document and appears once, at the top. It stays visible in Zuhd mode while in view, without being sticky.
- **Deduplication:** if the document's first content block (after any frontmatter) is already a standalone Basmallah, the presentation element is suppressed, and it returns as soon as that block changes. The comparison is narrow and tested (`src/editor/basmallah.test.ts`):
  - the block is a paragraph, an ATX heading or a setext heading containing only the Basmallah; more text in the same block, a quote, a list item or code doesn't count
  - vocalisation, Qur'anic annotation marks, tatweel, alef wasla (ٱ for ا), whitespace and direction marks are ignored, the ligature ﷽ counts, and one trailing full stop or Arabic comma is allowed
  - there is no general religious-text detection, and the source is never changed.
- **Accessibility:** real Unicode text exposed once in reading order with Arabic language metadata; the drawn outlines are hidden from assistive technology. It grows with the writing size and keeps room for diacritics.

### 11.3 Typing aids

Two aids transform characters **as you type them**. Rule 3 of AGENTS.md ("save exactly what the writer typed") still holds, because each aid:
- acts only on the characters just typed, visibly, at the caret
- can be undone by pressing `Backspace` immediately, which restores the typed sequence; `Mod-Z` also works as a separate undo step
- never runs inside inline code, code blocks, frontmatter, URLs or link targets
- never runs on open, paste or save.

**Smart punctuation** (on by default; setting `smart_punctuation`):

| You type | In Latin text | In an Arabic run |
|---|---|---|
| `"` | “ or ” (by position) | « or » |
| `'` | ‘ or ’ (apostrophe ’) | ’ |
| `--` (inside a line) | – | – |
| `---` (inside a line) | — | — |
| `...` | … | … |

Dashes convert only after a non-space, non-dash character on the same line and never in a table row, so a `---` at the start of a line (a rule, frontmatter, a setext underline) stays Markdown. Arabic commas and question marks come from the Arabic keyboard layout and are never converted.

**Transliteration mode** (`Mod-Shift-T`, off by default; follows **IJMES**). While it is on, a small *Transliteration* indicator stays visible in the status line (it never fades), and these sequences convert:

| Type | Gets | Type | Gets |
|---|---|---|---|
| `a=` `i=` `u=` | ā ī ū | `A=` `I=` `U=` | Ā Ī Ū |
| `.h` `.s` `.d` `.t` `.z` | ḥ ṣ ḍ ṭ ẓ | `.H` `.S` `.D` `.T` `.Z` | Ḥ Ṣ Ḍ Ṭ Ẓ |
| `` ` `` | ʿ (ʿayn) | `''` | ʾ (hamza) |

- `=` reads as the bar of the macron. (`a-` was rejected: it collides with IJMES's own hyphenated particles, *wa-l-ʿilm*, *bi-llāh*.)
- The dot comes **before** the letter so that sentence ends ("Allāh.") never convert. An upper-case dot sequence directly after a letter doesn't convert, so abbreviations like A.H., U.S. and Ph.D. stay intact.
- A backtick right after a backtick stays a backtick, and a second backtick after a just-made ʿ turns the pair back into ` `` `, so inline code and fences still type.
- Sequences match only whole, just-typed keys (an ellipsis made by smart punctuation never supplies a dot), and keys restored by Backspace never convert again.
- IJMES writes th, kh, dh, sh and gh as two letters, so they need no sequences.

The table was chosen on 1.8M words of English and Islamic-studies prose (docs/spikes/transliteration.md).

## 12. Chrome, status and motion

- Chrome (library toggle, status line) may fade while typing. **Fading is optional** (a setting) and never applies to an element that:
  - has focus or is being used
  - shows a save failure, conflict or recovery notice; these stay until resolved.
- **Status line:** the *Library* toggle at the start; file name · save state · reading time at the end, all in `text-faint` (§9.4) so they stay out of the writing's way. No word count (author's request, 2026-10-19); the reading time is derived from it. A passing message sits just before the file's details, so they never shift, and the *Transliteration* indicator after them. Save state is honest: *Saving…* from the first unsaved edit until Rust confirms the durable write, then *Saved*; *Not saved — [reason]* on failure, which stays (in `status-error`) until a save succeeds. Routine saves are not announced to screen readers; failures are, by their notice.
  - A truncated filename exposes its full name on hover. The Library button's shortcut hint and accessible shortcut follow `keybindings.toml`, including removal of a binding.
- **Notices** (failure, conflict, recovered text) sit in a row above the writing surface, never over the text, inside a `surface-panel` region with a `border-control` boundary; errors add a `status-error` edge. Each says what happened and how the text is protected, and offers its actions as buttons (§14). They never fade.
  - Long, unbroken filenames wrap within the notice; they cannot widen the page or push recovery controls out of the window.
- **Motion:** opacity and small transforms only, 120–180ms ease-out. All of it is removed under `prefers-reduced-motion`. Nothing animates while you type.

## 13. Keyboard and commands

`Mod` = Ctrl on Linux and Windows, Cmd on macOS. Every command has a stable ID, one canonical label, a palette entry and a rebindable shortcut (`keybindings.toml`).

| Command ID | Label | Default |
|---|---|---|
| `file.save` | Save now | `Mod-S` (flushes pending changes; confirms visibly) |
| `file.new` | New file… | `Mod-N` (native save dialog, starting in the selected library folder; never replaces a file) |
| `library.newFolder` | New folder… | `Mod-Shift-N` (in the selected folder) |
| `file.open` | Open… | `Mod-O` (native dialog) |
| `library.openFolder` | Open folder… | `Mod-Shift-O` (native dialog; the folder becomes the library) |
| `file.quickOpen` | Quick open… | `Mod-P` (find a file in the library) |
| `file.rename` | Rename… | `F2` (the focused library entry, else the open document) |
| `file.trash` | Move to trash | `Delete` in the library (undoable; also from the menu and palette for the open document) |
| `app.commandPalette` | Command palette | `Mod-Shift-P` |
| `view.toggleLibrary` | Library | `Mod-\` (shows the library and moves focus to it; pressed in the library, hides it) |
| `view.toggleMarkdown` | Always show Markdown | `Mod-R` (a switch; the same name as the setting, §6) |
| `editor.toggleFocus` | Zuhd mode | `Mod-D` |
| `editor.toggleTypewriter` | Typewriter scrolling | `Mod-T` |
| `view.textBigger` / `textSmaller` / `textReset` | Bigger / Smaller / Default text size | `Mod-=` / `Mod--` / `Mod-0` |
| `view.cycleTheme` | Theme: System / Light / Dark | `Mod-Shift-L` |
| `check.suggestions` | Show suggestions | `Mod-.` |
| `check.next` / `check.previous` | Next / Previous issue | `F7` / `Shift-F7` |
| `check.toggleSpelling` / `check.toggleGrammar` | Check spelling / Grammar suggestions | none (switches in the Edit menu, the palette and Settings) |
| `app.settings` | Settings | `Mod-,` |
| `app.about` | About bismillah | none (the Help menu, the palette, and Settings) |
| `view.fullscreen` | Fullscreen | `F11` |
| `editor.toggleTransliteration` | Transliteration mode | `Mod-Shift-T` |
| `edit.find` / `edit.replace` | Find… / Replace… | `Mod-F` / `Mod-H` |
| `edit.findNext` / `edit.findPrevious` | Find next / Find previous | `F3` / `Shift-F3` |
| `edit.goToLine` | Go to line… | `Mod-Alt-G` (line, relative offset, percentage of lines, or line:column) |
| `edit.copyRich` | Copy as rich text | `Mod-Shift-C` |
| `edit.openLink` | Open link | none (the link at the caret; `Mod`-click opens the one clicked) |
| `app.guide` | Guide | `F1` (Help menu: the guide as a sample document) |
| `app.showMenu` | Show menu bar (Linux and Windows) | `Alt` / `F10` |
| `app.quit` | Quit (flushes pending saves first) | `Mod-Q` |

- `Esc` closes the topmost overlay and returns focus to where it came from. In the docked library it returns focus to the text.
- The overlay library supports the same file and navigation shortcuts as the docked library. Choosing or creating a document closes the overlay and puts focus in the writing surface, including when the panel was opened with its button.
- Native menu items are disabled when their commands cannot run. Undo and Redo follow the current document's editable history, in the menu and palette alike.
- **`keybindings.toml`** (Phase 5) changes shortcuts. Each line gives a command its shortcut, written as the menus show it (`"editor.toggleFocus" = "Ctrl+Shift+D"`; CodeMirror's `Mod-Shift-d` is read too); a command not listed keeps its own, and `""` leaves one without. It applies as soon as it is saved, everywhere at once: the editor, the menu's accelerators, the palette, the first screen and the library's menu.
  - A shortcut needs `Ctrl` or `Alt` with a letter, digit or punctuation key, or is a function key. Keys that edit or move through text (Backspace, Delete, Enter, Tab, Escape, Space, the arrows, Home, End, Page Up/Down, Insert), the clipboard's and the standard editing keys (`Ctrl+C`, `V`, `X`, `Z`, `Shift+Z`, `Y`, `A`) and `F10` (the menu) stay where they are. *Move to trash*, which works only in the library, may also take Delete with a modifier.
  - Undo, Redo and Select all keep their standard keys.
  - A shortcut given to one command is taken from the command that had it. One shortcut given to two commands in the file goes to neither: both keep their own.
  - A line that can't be used changes nothing, and Settings › Files & privacy says why, by line number. *Create keybindings.toml* writes a starting file listing every command with its shortcut, commented out; it never replaces a file.
- **No shortcut that edits text elsewhere may act on files.** `Mod-Backspace` deletes the previous word in every Linux text field, so *Move to trash* is `Delete`, and only while the library has focus (changed 2026-10-18 from `Mod-Backspace`; macOS may add `Cmd-Backspace` in the library, as Finder has it).
- The library follows the WAI-ARIA tree pattern: `↑`/`↓` move, `→` opens a folder or steps into it, `←` closes it or goes to its folder, `Home`/`End`, typing a name's first letters finds it, `Enter` opens a file (and puts the caret in it) or opens and closes a folder.
- Focus rings appear for keyboard navigation (`:focus-visible`) in `focus-ring`, ≥ 3:1.
- Tab order follows the visual organisation. Overlays trap focus while open and restore it on close (Bits UI handles this).
- Ordinary operations keep plain functional names: Open, Save, Rename, Undo, Library, Settings. Arabic terms are used sparingly and only where they carry meaning (Zuhd).

Search and line navigation use CodeMirror’s keyboard-accessible editor panels, with interface typography and semantic colours. Search offers case, word and regex options; replacements are explicit and undoable. Escape closes a panel before the editor’s pen-down action. Search compares Unicode-equivalent forms on a temporary copy and preserves Arabic marks. Find works in read-only documents; replacement does not. `Mod-D` and `Mod-Shift-L` retain Zuhd and Theme.

Search shows a quiet field description explaining how to begin, whether a match exists, or what to try when none exists. Invalid regular expressions get a plain explanation, an error boundary on the field and `aria-invalid`; the message is its accessible description and a polite status region. Search and replacement inputs follow the direction of their own text.

Go to line shows examples of the supported forms, including the zero-based column convention. Invalid or empty input keeps the panel open, identifies the field and explains that the position has not changed. The writer can correct it or press Escape. Surrounding whitespace in this navigation field is ignored; document text is never changed.

## 14. Writing the interface (copy)

- Plain, modest, specific. Say what happened and what to do next.
- An explicit **Save now** request gets a polite **Saved now.** only after the current revision is durably saved. Autosave stays quiet. That passing feedback clears on the next edit or document change. Asking to save a sample explains how to keep its text in a real file; asking to save a read-only file repeats its encoding explanation. Neither claims success.
- **Errors:** what failed, why (if known), and how the text is protected. Example:
  > Couldn't save "letter.md" — the disk is full. Your text is kept in recovery. **Try again** · **Save elsewhere…**
- **Suggestions:** "Possible spelling mistake" / "Grammar suggestion", one sentence of explanation, explicit actions (*Replace with …*, *Add to dictionary*, *Ignore*). Never "wrong" or "error" for grammar.
- Never judge the writer, their productivity, intentions or religious merit.
- New terms (like Zuhd) are added only when the feature exists, with a one-sentence functional explanation, used consistently. Stable command IDs and setting keys stay functional and English (`editor.toggleFocus`, `focus_mode`).

## 15. First screen and attention

- The app opens straight into writing: the last document, or a simple choice: *Open a folder…*, *Open a file…*, *New file…*.
- The first screen also offers a quiet **Guide** button with its current shortcut, so help can be found without knowing the hidden menu or palette.
- Word count is information, not a target. No streaks, scores, celebrations, nudges or unsolicited prompts.

## 16. Accessibility requirements

- Contrast as in §9.4. Visible keyboard focus everywhere.
- Every control has an accessible name; the visible label and the accessible name agree.
- The library, palette and suggestion lists use correct roles and selected or expanded states.
- Usable at 200% text size and application zoom without loss of content (prose reflows; wide tables and code may scroll on their own).
- Respect reduced motion and forced colours.
- Screen readers announce headings, diagnostics (on request) and save failures. Test with Orca on Linux, and later with VoiceOver and NVDA.
- **Checked automatically** (Phase 6): `pnpm a11y` reads the accessibility tree as Orca gets it (AT-SPI) in every screen and state, and fails on a control or dialog without a name, a missing heading, a library that isn't a tree with its open file selected, palette entries that aren't options, or a save failure that isn't an alert. The writing surface is named by its file name. Headings drawn in capitals (Settings' sections, About's) carry their name as written, since WebKit hands the transformed text to screen readers. What Orca says aloud is still a manual check.

## 17. Gestalt rules

| Principle | Rule |
|---|---|
| **Proximity** | A setting's label, control, explanation and error sit closer to each other than to the next setting (8px within, 24px between). Diagnostics sit near their text; filenames sit beside their paths. |
| **Similarity** | Controls with the same role share shape, type, spacing and behaviour. A destructive action never looks like the default action. |
| **Common region** | Each overlay has a clear boundary. A container is added only when its boundary conveys a relationship. |
| **Continuity and alignment** | Prose shares one reading edge; marks hang in the gutter; indentation shows directory nesting. RTL content aligns logically within the app's interface direction. |
| **Figure and ground** | The active document and the foreground overlay are clear through placement, restrained surfaces and focus, not heavy shadows. Popovers use `surface-editor` with a `border-control` boundary and a restrained shadow. No "paper card" on the writing canvas; the canvas stays continuous. |

## 18. Design review

Every new or changed screen answers five questions before it merges:

1. Is the most important content, or the current recovery action, apparent?
2. Can the writer tell the current file, mode and relevant action?
3. Do proximity, alignment and grouping show what belongs together?
4. Do keyboard order, accessible names and semantic structure match the visible organisation?
5. Does it hold up at narrow and wide widths, in both themes, with RTL/mixed content and enlarged text?

It is also checked against [docs/specimen.md](docs/specimen.md) at content widths of **640, 1280, 1920 and 2560 px**, in a short window, and at increased zoom, both in the real Tauri app and in the visual-regression suite.

## 19. The bismillah stick

On the stick bismillah is the whole screen (os/PLAN.md). The same principles hold; these are the differences.

- **First screens:** Setup, Unlock, Finish setup and the trouble screens share one frame: the ﷽ wordmark in `text-secondary` above one centred column, with *Power off* as a quiet button below. Wrong passphrases get a calm sentence, never a countdown or lockout.
- **The lock view** is the Unlock screen titled *Locked*, drawn over everything. Focus starts in the passphrase field; nothing behind it takes keys.
- **The status line** ends with the battery and a 24-hour clock in faint text, and fades with the rest of the quiet chrome. A low battery is a notice that stays until the battery charges.
- **Commands:** *Power off* takes Quit's place and key (`Ctrl+Q`), beside *Lock*, *Suspend* and *Restart* in the File menu and the palette. Commands that need another app, a file outside the library or a window manager are left out rather than shown disabled.
- **Settings › This stick:** keyboard layouts are chosen and then applied with one button, because applying restarts the app; everything else there applies immediately, like the rest of Settings.
- **The pointer** hides while the writer types, and returns when the mouse moves.

