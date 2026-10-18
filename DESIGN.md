# bismillah — Design

> A typewriter, with only the best of the computer.

This document is the design foundation of bismillah. It defines what the product is, how it should look and behave, and how design work is judged. When a design question is not answered here, decide in the spirit of this document and then add the answer here.

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
| **iA** — [responsive typography](https://ia.net/topics/bringing-responsiveness-the-app-world), [iA Writer](https://ia.net/writer/) | Bounded measure, visible Markdown, typography as interface | The specimen, with the real fonts, at every test width |
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
| **Settings** | One screen, a few labelled sections: Appearance · Writing · Language & checking · Files & privacy. Add an Extensions section only once extensions exist. |
| **File status** | Saving, failure, conflict and recovery, shown without hiding the affected document. |

Rules:
- The same name and command ID is used in menus, the palette, shortcuts, Settings and the docs.
- **Filenames are the file's identity.** A frontmatter `title` may supplement the filename but never disguises the path.
- Empty, loading, unavailable and error states appear in the area they belong to.
- The palette is never the only way to find an essential action. The native application menu also lists them: always in the macOS menu bar, and on Linux and Windows hidden until `Alt` or `F10` (ARCHITECTURE.md §12.2).
- The information architecture stays the same at every window width; only the layout changes.

### Hierarchy by task

- **Normal writing:** document and caret → current file and location → tools for the current task → passive metadata (word count).
- **When saving fails or a conflict needs resolving:** the recovery message becomes the most important element and stays visible until resolved.

Hierarchy is built with spacing, placement, alignment and weight before colour. Quiet text uses the `text-secondary` token, never arbitrary opacity.

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

- A docked library takes about 240px, plus a 24px gap and at least 24px of edge padding.
- A safe gutter is always reserved for hanging Markdown marks, including nested lists and RTL lines.
- **Fading chrome changes opacity and interactivity only, never layout tracks.** The text must not reflow when the mouse moves. Explicitly opening or closing the docked library may reflow, but the caret and scroll anchor are preserved.
- Implemented with CSS Grid and a few container/media queries. No layout library.

### Window decorations

- The default is the platform's normal window behaviour: obvious move, resize and close (native decorations on Linux, which tiling window managers such as Hyprland may hide anyway).
- Complete visual minimalism is reserved for fullscreen (`F11`) and Zuhd mode.
- macOS later: overlay titlebar with the traffic lights. Windows later: native caption buttons.

## 8. Typography

### 8.1 Two separate type systems

- **Document typography** is the writing surface and preview. It follows the selected writing profile.
- **Interface typography** covers the library, palette, settings and status. It uses the platform UI font (`system-ui`) at 14px / 1.45, and it never changes when the writing font changes.

### 8.2 The font set (bundled, SIL OFL)

Start small; expand only after these are excellent.

| Role | Family | Arabic pairing |
|---|---|---|
| Writer (default) | **iA Writer Duo** (shipped as Bismillah Duo) | IBM Plex Sans Arabic; **Amiri for now** (ADR-0011) |
| Serif (writing + preview) | **Source Serif 4** (optical-size axis) | Amiri |
| Basmallah opening | Amiri | — |
| Qur'anic (Uthmani) runs | Amiri Quran | — |

- Code spans and blocks use iA Writer Mono (shipped as Bismillah Mono), from the same family as Duo.
- **Bismillah Duo / Bismillah Mono** are iA Writer Duo / Mono with the missing IJMES letters added from their own outlines, renamed as the OFL requires (fonts/build/README.md).
- **Uthmani text:** an Arabic run that contains alef wasla (U+0671) or Qur'anic annotation marks (U+06D6–U+06ED, U+08D3–U+08FF: small high letters, waqf signs, rub' el hizb) is set in **Amiri Quran**, which is designed for Mushaf orthography. The whole run switches, never single characters, so shaping is never split across fonts.
- **Transliteration coverage:** the Latin fonts must have real glyphs for the IJMES set (ā ī ū ḥ ṣ ḍ ṭ ẓ ʿ ʾ and capitals). A gap is fixed with a matched fallback, never left to the system's fallback font. Duo and Mono's gap is closed by Bismillah Duo and Mono.
- **Known platform defect:** WebKitGTK 2.54 misplaces Arabic marks that fonts position with vertical offsets (ADR-0011). IBM Plex Sans Arabic is unusable for vocalised text until that is fixed, so Duo pairs with Amiri for now.
- Any installed system font can be chosen by name, as an unsupported "custom" profile.

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

**Editor** (restrained; the text still reads like a manuscript):

| Level | Size | Weight | Space above / below |
|---|---|---|---|
| h1 | 1.40em | 700 | 2 lines / 0.5 line |
| h2 | 1.22em | 700 | 1.5 / 0.5 |
| h3 | 1.08em | 700 | 1.25 / 0.25 |
| h4 | 1.00em | 700 | 1 / 0.25 |
| h5 | 1.00em | 600 | 1 / 0 |
| h6 | 1.00em | 600 + `text-secondary` | 1 / 0 |

More space above a heading than below it, so the heading belongs to the text that follows (proximity). The `#` marks hang in the gutter.

**Preview** (fuller):
- A perfect fourth (1.333) scale for the serif profile and a major third (1.25) for Duo.
- h1 large, with tight but not negative tracking for Latin and **never any letter-spacing for Arabic**.
- h3–h6 step down by size and weight; serif italic is an optional extra cue for h3 in Latin text only.

### 8.5 Getting the intended quality from each font

1. **Bundle the real styles:** regular and italic faces and the weights actually used. No synthetic bold or italic. Arabic families without an italic use weight for emphasis.
2. **Optical sizing:** `font-optical-sizing: auto` (Source Serif 4 has an `opsz` axis). Use standard CSS properties, not hard-coded variation settings.
3. **Features by role:**
   - Editor: kerning, contextual shaping and required ligatures only, with no discretionary ligatures and caret placement tested through ligatures.
   - Counts and tables: `tnum`.
   - Old-style figures (`onum`): optional, serif preview only.
   - Small caps: only where the font and script support them.
4. **Stable wrapping in the editor:** no hyphenation and no `text-wrap: pretty`. Preview may use `hyphens: auto` and `text-wrap: pretty`, with correct `lang`, falling back gracefully.
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
| `text-primary` | Prose, primary labels | `#1E1E1E` | `#D4D4D2` |
| `text-secondary` | Paths, supporting labels, inactive Zuhd text | `#62625E` | `#A2A29B` |
| `syntax-marker` | Visible Markdown punctuation | `#6B6B65` | `#94948D` |
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
| `accent` | 5.96 / 8.32 | 5.50 / 7.42 |
| `border-control` | 3.48 / 3.88 | 3.21 / 3.46 |
| `diagnostic-spelling` | 6.12 / 7.58 | 5.64 / 6.77 |
| `diagnostic-grammar` | 5.56 / 9.26 | 5.13 / 8.26 |
| `text-primary` on `selection-background` | 13.25 / 7.39 | — |

The accent is a deep green, the project's identity colour, chosen in the 2026-10-18 interview.

### 9.4 Rules

- Meaningful normal-size text is **≥ 4.5:1** against its actual background. Main prose aims for **> 7:1** in the default themes. Markdown marks count as meaningful text.
- Meaningful control boundaries and state indicators (focus included) are **≥ 3:1** against adjacent colours. A thin mark also needs enough size to be perceived.
- **Selected text is rendered in `text-primary`** (marks included), because `syntax-marker` falls to 4.29:1 (light) and 3.66:1 (dark) on the selection colour. Syntax styling never overrides selection readability.
- Colour meanings are fixed: green means interaction, the diagnostic colours mean problems. Green and red can be confused under red-green colour blindness, so colour is never the only signal:
  - spelling and grammar use different underline patterns and labels
  - a selected library item also gets a leading edge bar and heavier weight, and is exposed as selected to assistive technology.
- Automated assertions check every semantic foreground/background pair, including selected and hover states.
- A high-contrast override (pure black and white) is allowed. The system's forced-colours mode is respected, and `forced-color-adjust: none` is never applied wholesale.
- **No health claims.** Warm paper and charcoal are aesthetic defaults. We never claim that a theme prevents eye strain. No ambient-light sensing, no colour-temperature scheduling.

## 10. Spacing

There are two separate systems with separate purposes:

- **Interface spacing:** a 4px scale of `4 · 8 · 12 · 16 · 24 · 32 · 48`. Within a group 8px, between settings groups 24px.
- **Document rhythm:** font-relative units (`em`, `lh`) derived from the active profile's line height. Interface gaps do not have to land on the document rhythm.

## 11. The writing surface

- **Visible Markdown, iA-style.** Marks stay visible in `syntax-marker`. The `#` of headings, `>` of quotes and list markers hang in the reserved gutter, so text starts on one reading edge. This mirrors on RTL lines.
- **Caret:** 2px wide, in `accent`. **Selection:** `selection-background` with `text-primary` text.
- **Typewriter scrolling** is on by default (`Mod-T`). The caret line sits slightly above centre, about 42% from the top of the writing area. Typing and keyboard motion keep it there; a mouse click doesn't scroll, so text never jumps away from the pointer.
- **Diagnostics** are shown as you write by default; both can be switched off. Spelling uses a **wavy** underline in `diagnostic-spelling`; grammar uses a **dotted** underline in `diagnostic-grammar`.
  - They are hidden while the caret is inside the word being typed. Nothing pops up unasked.
  - The detail popover names the kind ("Spelling" / "Grammar suggestion"), explains it in one sentence, and offers explicit actions.
- **Frontmatter:** shown in `text-secondary`, collapsible, never rewritten.
- **Preview** (`Mod-R`): a separate mode in the same column with the fuller typographic hierarchy. Side-by-side preview may come later, only as an explicit command and only when both panes keep a useful measure.

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
- Inactive text uses `text-secondary` by default, never an opacity hack. Stronger dimming is a user choice with an easy reset.
- Zuhd mode does not silently turn on typewriter scrolling or fullscreen; each is controlled separately.

### 11.2 The Basmallah opening

Every document opens with a centred, carefully typeset Basmallah:

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

It is **on by default** and can be turned off in Settings › Appearance (*Show the Basmallah opening*, key `basmallah_opening`). The off switch exists out of respect for an open-source audience of any faith or none.

- **A presentation element, never file content.**
  - It is not written to disk, not in CodeMirror's editable text, and not counted, spellchecked or grammar-checked. Opening a file never creates an edit.
  - It is not a heading and not in the outline.
  - Saving and copying document text preserve the real source; the Basmallah itself can still be selected and copied.
- **Typesetting:**
  - Amiri regular, natural shaping, starting at 28px / 1.8 and scaling with the writing-size preference; `text-primary` colour; `lang="ar" dir="rtl"`; centred in the reading column.
  - One body line of space above and one and a half below (less on short windows); enough block and inline padding for every mark.
  - No decorative colour, ornament or image.
- **Placement:** it scrolls with the document and appears once, at the top, in both editor and preview. It stays visible in Zuhd mode while in view, without being sticky.
- **Deduplication:** if the document's first content block is already a standalone Basmallah, the presentation element is suppressed. The comparison is narrow and tested, allowing for common vocalisation and whitespace differences. There is no general religious-text detection, and the source is never changed.
- **Accessibility:** real Unicode text exposed once in reading order with Arabic language metadata. It reflows at enlarged sizes and keeps room for diacritics.

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
- **Status line:** file name · save state · word count · reading time. Save state is honest: *Saving…* → *Saved* only after a durable write; *Not saved — [reason]* on failure.
- **Motion:** opacity and small transforms only, 120–180ms ease-out. All of it is removed under `prefers-reduced-motion`. Nothing animates while you type.

## 13. Keyboard and commands

`Mod` = Ctrl on Linux and Windows, Cmd on macOS. Every command has a stable ID, one canonical label, a palette entry and a rebindable shortcut (`keybindings.toml`).

| Command ID | Label | Default |
|---|---|---|
| `file.save` | Save now | `Mod-S` (flushes pending changes; confirms visibly) |
| `file.new` | New file | `Mod-N` |
| `file.quickOpen` | Open file… | `Mod-P` |
| `file.rename` | Rename file | `F2` |
| `file.trash` | Move to trash | `Mod-Backspace` (undoable) |
| `app.commandPalette` | Command palette | `Mod-Shift-P` |
| `view.toggleLibrary` | Library | `Mod-\` |
| `view.togglePreview` | Preview | `Mod-R` |
| `editor.toggleFocus` | Zuhd mode | `Mod-D` |
| `editor.toggleTypewriter` | Typewriter scrolling | `Mod-T` |
| `view.textBigger` / `textSmaller` / `textReset` | Bigger / Smaller / Default text size | `Mod-=` / `Mod--` / `Mod-0` |
| `view.cycleTheme` | Theme: System / Light / Dark | `Mod-Shift-L` |
| `check.suggestions` | Show suggestions | `Mod-.` |
| `check.next` / `check.previous` | Next / Previous issue | `F7` / `Shift-F7` |
| `app.settings` | Settings | `Mod-,` |
| `view.fullscreen` | Fullscreen | `F11` |
| `editor.toggleTransliteration` | Transliteration mode | `Mod-Shift-T` |
| `edit.copyRich` | Copy as rich text | `Mod-Shift-C` |
| `app.showMenu` | Show menu bar (Linux and Windows) | `Alt` / `F10` |
| `app.quit` | Quit (flushes pending saves first) | `Mod-Q` |

- `Esc` closes the topmost overlay and returns focus to where it came from.
- Focus rings appear for keyboard navigation (`:focus-visible`) in `focus-ring`, ≥ 3:1.
- Tab order follows the visual organisation. Overlays trap focus while open and restore it on close (Bits UI handles this).
- Ordinary operations keep plain functional names: Open, Save, Rename, Undo, Preview, Library, Settings. Arabic terms are used sparingly and only where they carry meaning (Zuhd).

## 14. Writing the interface (copy)

- Plain, modest, specific. Say what happened and what to do next.
- **Errors:** what failed, why (if known), and how the text is protected. Example:
  > Couldn't save "letter.md" — the disk is full. Your text is kept in recovery. **Try again** · **Save elsewhere…**
- **Suggestions:** "Possible spelling mistake" / "Grammar suggestion", one sentence of explanation, explicit actions (*Replace with …*, *Add to dictionary*, *Ignore*). Never "wrong" or "error" for grammar.
- Never judge the writer, their productivity, intentions or religious merit.
- New terms (like Zuhd) are added only when the feature exists, with a one-sentence functional explanation, used consistently. Stable command IDs and setting keys stay functional and English (`editor.toggleFocus`, `focus_mode`).

## 15. First screen and attention

- The app opens straight into writing: the last document, or a simple choice to open a folder or create a file.
- Word count is information, not a target. No streaks, scores, celebrations, nudges or unsolicited prompts.

## 16. Accessibility requirements

- Contrast as in §9.4. Visible keyboard focus everywhere.
- Every control has an accessible name; the visible label and the accessible name agree.
- The library, palette and suggestion lists use correct roles and selected or expanded states.
- Usable at 200% text size and application zoom without loss of content (prose reflows; wide tables and code may scroll on their own).
- Respect reduced motion and forced colours.
- Screen readers announce headings, diagnostics (on request) and save failures. Test with Orca on Linux, and later with VoiceOver and NVDA.

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
