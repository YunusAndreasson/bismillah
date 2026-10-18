# Review of PLAN.md

I would keep the core stack, but revise the plugin architecture, design-system foundation, and file-safety requirements before implementation. The plan is strongest on product intent and typography; several implementation guarantees are more confident than the proposed architecture supports.

## Library choices

| Choice | Assessment |
|---|---|
| Tauri 2 | Keep. A sensible fit for a lightweight, offline desktop editor. Treat “10 MB” as a measurement target until fonts, dictionaries, and packaging are included. |
| Svelte 5 + TypeScript + Vite | Keep. Appropriate for a small interface without introducing a larger application framework. |
| CodeMirror 6 + Lezer | Keep. Well suited to editable Markdown with visible syntax. The custom typography still needs substantial interaction testing. |
| `harper-core` | Keep. Its offline English spelling/grammar focus matches this product closely. [Official project](https://github.com/Automattic/harper). |
| `spellbook` + Ayaspell | Conditional approval. The project explicitly describes itself as a work in progress. Keep the Hunspell fallback and benchmark correctness and suggestions against it. [Spellbook](https://github.com/helix-editor/spellbook). |
| `markdown-it` | Keep. Specify the exact extensions and Markdown dialect shared with the editor. Disable raw HTML initially. [Security guidance](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md). |
| UI primitives | Add Bits UI. Use its unstyled Svelte 5 components for menus, dialogs, popovers, and selection controls, styled through your own tokens. This reduces custom keyboard and focus-management work. [Documentation](https://bits-ui.com/docs/getting-started). |

I would use **Bits UI with plain CSS** here. A large styled component kit would add visual conventions this app would spend time overriding. If preview sanitization remains a requirement, name **DOMPurify** explicitly and sanitize after all rendering extensions have run. [DOMPurify](https://github.com/cure53/DOMPurify).

## Design-system references

Currently the design-system section is mainly a typography specification. A foundation also needs component states, interaction rules, accessibility, and platform behavior.

| Reference | What to adopt |
|---|---|
| [iA’s responsive typography](https://ia.net/topics/bringing-responsiveness-the-app-world) | Reading measure, restrained hierarchy, and how typography responds to window size. |
| [GNOME HIG](https://developer.gnome.org/hig/patterns/containers/header-bars.html) | Linux window behavior, draggable regions, discoverable controls, and desktop conventions. |
| [Adobe Spectrum tokens](https://spectrum.adobe.com/foundations/design-data) | Primitive and semantic token structure, including interaction states. |
| [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Measurable contrast requirements throughout the interface. |
| [W3C Arabic layout requirements](https://www.w3.org/TR/alreq/) | Arabic typography, diacritics, and mixed-script layout requirements. |

Use these as references for specific decisions while developing bismillah’s own visual identity.

I would change these design details:

- **Reduce the initial font collection.** Start with one writing family, one serif, and two Arabic pairings. The proposed thirteen families multiply download size, settings complexity, and visual testing.
- **Separate interface and document typography.** Sidebar labels and settings should remain stable when the writing font changes.
- **Define semantic tokens:** `text-primary`, `text-secondary`, `syntax-marker`, `surface-editor`, `surface-overlay`, `focus-ring`, `selection`, `diagnostic-spelling`, and `diagnostic-grammar`, plus hover, selected, disabled, and error states.
- **Correct the contrast requirement.** Meaningful normal-sized text generally needs **4.5:1**, including readable Markdown syntax. The stated 3:1 is insufficient for that use. [WCAG guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- **Make disappearing chrome optional.** Controls should remain visible while focused or in use. Saving failures and conflicts should remain visible until resolved.
- **Reconsider undecorated Linux windows as the default.** Preserve obvious move, resize, and close behavior; reserve complete visual minimalism for a deliberate focus/fullscreen mode.
- **Separate interface spacing from document rhythm.** A 4px interface scale and font-relative reading rhythm serve different purposes; requiring every gap to satisfy both is unnecessarily restrictive.

## Architectural priorities

### 1. The proposed plugins are not sandboxed

Importing plugins into the application’s JavaScript context lets them act with that context’s authority. Wrapping a few APIs cannot enforce per-plugin permissions. Tauri capabilities apply to windows/webviews, and custom commands also require explicit attention to permissions and backend validation. [Tauri capabilities](https://v2.tauri.app/security/capabilities/).

I recommend shipping declarative themes first and deferring third-party executable plugins. If sandboxed JavaScript is essential for v1, make isolation a Phase 0 architecture decision. Arbitrary CodeMirror extensions and `markdown-it` callbacks conflict with a tightly restricted plugin API.

### 2. CSP and dependency bans do not establish an absolute no-network guarantee

CSP is valuable webview protection, but it is not an operating-system network sandbox. Dependency names also cannot prove that application code cannot create sockets. Keep the policy, audit native features, control navigation/new windows, and test attempted network access. Distinguish “works without networking” from “cannot access networking.” [Tauri security boundaries](https://v2.tauri.app/security/capabilities/).

### 3. Autosave needs a stronger data-preservation contract

Specify serialized writes, document revisions, external-change checks before replacement, recovery after crashes, disk-full/read-only behavior, and preservation of permissions and line endings. Keep `Ctrl/Cmd-S` as “flush pending changes now,” even with autosave. Writers need a dependable save action and visible confirmation of failures.

## Arabic and editor correctness

The Arabic proposal needs more than paragraph-level language routing:

- Route mixed paragraphs by script runs or tokens; script alone does not establish language.
- Avoid unconditional alef normalization that could conceal spelling mistakes.
- Define range conversion between Rust offsets and JavaScript UTF-16 positions, including emoji and combining marks.
- Tag lint requests with document revisions and discard stale results.
- Test wrapped RTL headings, nested lists, punctuation, URLs, selection, mouse placement, undo, and IME composition.

CodeMirror specifically requires extensions to account for bidi isolation and keep cursor behavior consistent with decorated ranges. Logical CSS properties alone do not resolve all of this. [CodeMirror bidi guidance](https://codemirror.net/examples/bidi/).

Bring **settings, accessibility checks, save recovery, and real Tauri runtime testing** into the early phases. Browser screenshots are useful, but they cannot validate native window behavior, filesystem integration, or the installed webview.

## Recommended foundation

**Tauri 2 + Svelte 5 + CodeMirror 6 + Bits UI + semantic CSS tokens + Harper, with Arabic spelling behind a tested adapter.** Keep the typography ambitious, reduce the initial font scope, and settle plugin isolation before promising it.

## Islamic principles as practical design constraints

Islamic principles can give this product a clear ethical foundation through how it treats the writer, their work, and their attention. The strongest applications strengthen requirements already needed for a dependable editor. They require no additional runtime library, service, or architecture layer.

The software decisions below are proposed applications of the cited teachings. The verses establish ethical reference points; they do not prescribe these particular technical implementations.

| Principle and reference | Concrete application | Scope |
|---|---|---|
| **Amanah: trust and responsibility.** The Qur’an instructs returning trusts to their rightful owners. [4:58](https://legacy.quran.com/4/58). | Treat the writer’s words as entrusted data: reliable saves, visible failures, recoverable destructive actions, and portable Markdown files. | Strengthen the existing save and file-operation paths. |
| **Respect for privacy.** The Qur’an prohibits spying. [49:12](https://quran.com/49%3A12). | Keep writing and diagnostics local; omit document contents from logs; give file access only to explicitly selected locations. | Apply the existing offline policy and backend path validation. |
| **Justice and ihsan: fairness, care, and excellence.** These are encouraged in [16:90](https://quran.com/an-nahl/90). | Give keyboard access, readable contrast, and Arabic/Latin editing equal acceptance criteria. Refine a small set of dependable interactions. | Use the existing accessibility and mixed-script fixtures from Phase 0 onward. |
| **Restraint in consumption.** The warning against excess appears in the context of eating and drinking in [7:31](https://quran.com/en/araf/31). Applying it to software resource use is a design analogy. | Keep dependencies and bundled fonts small; lint changed content; avoid continuous background work and attention-seeking features. | Keep the reduced font set and existing incremental linting approach. |
| **Care in claims and knowledge.** [17:36](https://corpus.quran.com/translation.jsp?chapter=17&verse=36) cautions against following what one does not know. | Make privacy claims match tested boundaries, show “Saved” only after successful persistence, and present grammar results as fallible suggestions. | Tighten status behavior, documentation, and diagnostic copy. |

### Architecture decisions worth adopting

1. **Preserve the writer’s exact text.** Saving must not silently normalize Arabic, remove diacritics, change punctuation, or rewrite frontmatter. Any normalization used for spelling lookup stays in a temporary analysis representation with offsets mapped back to the original. This supports accurate quotation, including Qur’anic passages, without adding religious-text detection. Existing explicit, undoable editing actions remain available.
2. **Make recovery small and private.** Keep a bounded local recovery copy for unsaved changes in the platform application-data directory, with restrictive permissions where supported. Remove it after successful recovery or a clean save. Keep recovery behavior documented and distinguish recovery data from diagnostic logs. This is a narrowly scoped exception to “no hidden project files”: recovery lives outside the writing folder.
3. **Keep authority explicit.** Validate library boundaries in Rust, including traversal and symlink handling. Begin with declarative themes; implement executable plugins only after their isolation model is established. A theme should need only validated token values.
4. **Give every new dependency a concrete job.** Add one when it replaces difficult correctness, accessibility, or security work. Keep ordinary layout, tokens, and product state simple. No separate “Islamic architecture” package or policy engine is needed.

### Design decisions worth adopting

- **A calm first screen.** Open directly into writing or a simple open/create choice. Keep essential actions discoverable through a small menu and command palette. Put the project’s Islamic inspiration in a short About/documentation statement.
- **Respect the writer’s attention.** Keep word count informational. Omit streaks, engagement scores, celebratory interruptions, and unsolicited prompts. These are product choices consistent with the intended calm writing experience.
- **Exercise care with Arabic typography.** Preserve contextual shaping and diacritics, avoid letter-spacing on Arabic text, and test mixed-script punctuation and selection. Arabic support serves a broad language community; it should not require a religious mode.
- **Use clear, modest language.** Suggestions offer an explanation and an explicit action. Save errors say what failed and how to recover. Avoid judgmental productivity messages or claims that the editor can assess a writer’s intention or religious merit.

### Minimal implementation boundary

Document these principles in one short section of `DESIGN.md`, then reference existing implementation tasks. Add meaningful acceptance checks to the planned file-safety and mixed-script tests: failed writes preserve recoverable text, stale lint results cannot change a newer document, and saving round-trips vocalized Arabic and mixed-script text unchanged.

Keep prayer scheduling, Qur’an/hadith databases, religious-content classification, and automatic insertion of devotional text outside this editor’s initial scope. Each introduces a separate product responsibility without improving its core writing task.

**Recommended priority:** amanah in file safety, privacy in data handling, care in typography and accessibility, restraint in features and resource use, and honesty in status and promises. These principles should guide the existing components and release criteria.

## Wide screens and typography from the beginning

The writing surface should have a deliberate reading measure at every window size. A wider window provides room for comfortable margins and the existing library, while the prose column stays bounded. Empty space has a useful role in a focused editor.

### Starting typography profiles

Use a small static profile for each bundled writing family: default size, unitless line height, preferred measure, and its Arabic pairing. Keep these in the existing typography/token configuration. The following are proposed starting values for Phase 0, not measured conclusions or universal readability standards. Sizes are CSS pixels at normal application zoom; operating-system scaling still applies.

| Family / role | Initial font size | Initial line height | Initial maximum measure |
|---|---|---|---|
| iA Writer Duo, default writing | 20px | 1.6 / 32px | 66ch; check representative prose for roughly 60–72 characters per line |
| Source Serif 4, serif writing/preview | 21px | 1.6 / 33.6px | 34em / 714px; tune against actual prose toward roughly 60–72 characters per line |
| IBM Plex Sans Arabic, Arabic writing | 22px | 1.7 / 37.4px | 32em / 704px as an initial reading measure |
| Amiri, Arabic serif writing/preview | 24px | 1.8 / 43.2px | 30em / 720px as an initial reading measure |
| Interface labels and settings | 14px | 1.45 / approximately 20px | Determined by the control; independent of the writing font |

Make Source Serif 4 the first serif candidate from the existing list, paired with Amiri; keep IBM Plex Sans Arabic with Duo. This gives two considered writing styles before expanding the font collection. Verify visual size and density together: the same nominal size does not make different fonts appear equally large. IBM’s own Plex guidance adjusts typography by script, illustrating why a universal Arabic multiplier is insufficient. [IBM type guidance](https://www.ibm.com/design/language/typography/type-scale/).

For mixed-script paragraphs, preserve one column width and choose a line height that accommodates both families. Do not resize the entire document or change its width as the caret moves between languages. Keep direction, language, and typography profile as distinct decisions. A few Arabic words in an English paragraph must not switch the paragraph’s typography; line boxes must still have enough room for their marks.

**Correct the `ch` assumption in PLAN.md:** `ch` measures the advance width of the font’s zero glyph. It does not count average letters, Arabic characters, or shaped glyphs. Duo itself has multiple character widths. Use `ch` as a convenient width for the writer profile, validate it on real text, and use a tuned `em` measure where appropriate. No runtime character-counting or automatic width optimizer is needed. [CSS length definitions](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length), [iA font design](https://ia.net/topics/a-typographic-christmas).

Keep a way to achieve lines of at most 80 characters/glyphs and to enlarge text substantially. WCAG’s visual-presentation criterion provides this as Level AAA guidance, not a universal default or an AA requirement. Arabic measure needs visual assessment with actual joined and vocalized text. [W3C visual presentation](https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation).

### Window behavior

Define behavior by the available application content area in CSS pixels, including zoom, rather than the monitor’s physical resolution. Start with these rules and tune the thresholds against the chosen fonts:

| Available width | Proposed behavior |
|---|---|
| Below approximately 900px | Single writing surface; library opens as a temporary overlay. Reduce outer padding toward 16–24px and reflow prose. Preserve the chosen writing size. |
| Approximately 900–1440px | Center the bounded writing column. Allow a docked library only when its width, gutters, and a comfortable writing measure fit; otherwise use the overlay. |
| Above approximately 1440px | Keep the same column measure. Place the library in the spare margin where it fits, and retain generous space around the text. |
| Ultrawide windows | Continue the bounded layout. Let the writer use a normal-width window beside research material through the desktop’s existing tiling/window management. |

Reserve approximately 240px for a docked library, a 24px gap, and at least 24px of safety padding at the window edges. On sufficiently wide windows, balance the opposite margin so the writing stays near the window center. On intermediate widths, center within the remaining editor area. Use CSS Grid and a few container/media rules; no layout library is needed.

Chrome fading changes opacity and interactivity, not the width of the layout tracks. The document must not shift or rewrap every time the mouse moves. Explicitly opening or closing a docked library may reflow text; preserve the caret and scroll anchor. Keep a safe gutter for hanging Markdown marks, including nested lists and RTL, within the available content budget.

Keep the planned separate preview mode for v1. If side-by-side preview is added later, make it an explicit command and allow it only when both panes retain their minimum useful measures. Avoid shrinking two columns into an unreadable split merely because the window is wide enough to display two boxes.

### Font size and line height controls

- **Start with a stable writing size.** Replace viewport-driven body-font scaling with the profile defaults above. Window resizing should primarily change margins and wrapping. A larger monitor does not establish viewing distance or a need for larger text.
- **Preserve explicit preferences.** Font-size shortcuts adjust the writing surface, persist the choice, and use small predictable steps. Keep application zoom available for enlarging interface controls as well. A later window resize must not undo either choice.
- **Offer three simple measure choices:** Narrow, Standard, and Wide, backed by profile-specific widths. Standard is the table’s default; start with approximately 0.85× and 1.15× its measure for the other two. These are preferences, not guarantees of exact character counts.
- **Expose line height in Settings.** Use the family default initially and provide a simple adjustment with Reset. Permit generous spacing for accessibility and vocalized Arabic. Avoid adding separate controls for every variable-font axis.
- **Keep mixed lines safe.** Establish minimum line-box space from the selected pairing, then inspect stacked marks, emphasis, and fallback glyphs. Do not force short ascent/descent metrics to make baselines align at the cost of clipped or overlapping diacritics.

### Get the intended quality from each font

1. **Load the real styles.** Bundle regular and italic faces and the weights used for emphasis. Use `font-weight` and `font-style` normally, with correct `@font-face` ranges for variable files. Avoid synthetic italics or bold as a substitute for missing assets; use weight-based emphasis for Arabic families without a suitable italic.
2. **Enable optical sizing where supported.** Use `font-optical-sizing: auto`; Source Serif 4 provides an optical-size axis. Prefer standard CSS font properties over hardcoded variation settings. Do not assume every variable font has the same axes. [Source Serif release notes](https://github.com/adobe-fonts/source-serif/releases?after=3.001R), [CSS optical sizing](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-optical-sizing).
3. **Keep features specific to their role.** Preserve normal kerning, contextual shaping, and required ligatures. Start with the font’s standard ligature behavior, test caret placement through ligatures, and avoid discretionary ligatures in the editor. Use tabular numerals for counts and tables where supported; old-style figures can be a serif-preview choice. Apply small caps only where the font and script support them.
4. **Give the editor stable wrapping.** Use ordinary wrapping without automatic hyphenation in editable prose. Reserve optional hyphenation and `text-wrap: pretty` for preview, with correct language metadata and a normal-wrap fallback in webviews that lack support. Keep semantic heading levels even when visual styles differ.
5. **Preserve font coverage and shaping when subsetting.** Retain combining marks, shaping tables, and needed punctuation. Test the actual bundled files with vocalized Arabic, Qur’anic annotation marks where supported, extended Latin, numerals, and mixed punctuation. Use a documented fallback when the chosen family lacks a glyph. [Amiri project](https://aliftype.com/amiri/).
6. **Remeasure after fonts load or change.** Wait for the chosen face to be ready before final editor measurements. Notify CodeMirror when typography changes so selection, caret geometry, hanging marks, and scrolling agree with the rendered text. CSS feature support and font metrics must be checked in the real Tauri webviews.

### Early acceptance checks

Extend the existing specimen and visual checks with representative narrow, laptop, desktop, and ultrawide content widths, for example 640, 1280, 1920, and 2560 CSS pixels. Include a short-height window and increased application zoom. These are test conditions, not extra layout modes.

Verify the initial profiles on English, Arabic, mixed paragraphs, vocalized text, long links, nested lists, headings, tables, and code. Prose should reflow without horizontal page scrolling; wide tables/code may use their own overflow treatment. Check that increasing size or spacing remains usable, decorative hanging marks remain visible, diacritics have room, and opening the library or changing fonts preserves the writer’s place. Use a focused set of baselines plus manual interaction checks rather than a screenshot for every possible setting combination.

**Recommended default:** begin with Duo at 20px / 1.6 and a tuned 66ch maximum, preserve the selected size across window widths, and make wider windows useful through stable margins and the existing library. Validate the two Arabic pairings and Source Serif profile in Phase 0 before treating their numbers as final design tokens.

## Color structure and visual comfort

**Recommendation:** keep the planned warm off-white/light theme and charcoal/dark theme, with accessible text contrast and a small semantic palette. Offer System, Light, and Dark, with System as the initial setting. Preserve explicit user overrides. Pure black and white can remain available through a high-contrast token override; remove the categorical “never pure black” restriction from PLAN.md.

### Evidence and its limits

- Black on white has the maximum WCAG contrast ratio of 21:1. That makes it a valid accessibility choice, but the contrast ratio alone does not establish comfort for every reader or environment. WCAG defines contrast thresholds; it does not identify one medically optimal background color. [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Experimental research has found better proofreading performance for dark text on light backgrounds under its tested conditions. This supports taking the light theme seriously for a writing application; it does not prove that dark mode is harmful or inferior for every user. [Piepenbrock, Mayr, and Buchner, 2014](https://pubmed.ncbi.nlm.nih.gov/25135324/).
- Display brightness, lighting, glare, and personal visual needs also matter. Ophthalmology guidance includes adjusting brightness and contrast, with night/dark settings as an evening option. A warm hexadecimal background cannot establish an eye-health benefit by itself. [American Academy of Ophthalmology](https://aao.org/eye-health/tips-prevention/blue-light-digital-eye-strain).

Treat warm paper and charcoal as considered aesthetic defaults. Avoid claims that sepia, dark mode, reduced contrast, or a particular accent prevents eye damage. Support preferences through a few explicit settings, without ambient-light sensing, automatic color-temperature scheduling, or an additional theme engine.

### Minimal semantic palette

Use one neutral family, one blue accent, and two diagnostic colors. Components consume semantic tokens; light and dark themes supply separate values. Each color has a defined purpose, following the role-based approach used by [Spectrum](https://spectrum.adobe.com/foundations/color/color).

| Token / purpose | Light | Dark |
|---|---|---|
| `surface-editor` — continuous writing canvas | `#F7F6F2` | `#151515` |
| `surface-panel` — library and grouped settings | `#EEEDE8` | `#202020` |
| `text-primary` — prose and primary labels | `#1E1E1E` | `#D4D4D2` |
| `text-secondary` — paths and supporting labels | `#62625E` | `#A2A29B` |
| `syntax-marker` — visible Markdown punctuation | `#6B6B65` | `#94948D` |
| `accent` — caret, focus outline, active indicator | `#245FBA` | `#8AB4F8` |
| `selection-background` — selected text background | `#DCE7F7` | `#283C58` |
| `border-control` — necessary control boundaries | `#84847C` | `#74746E` |
| `diagnostic-spelling` — spelling underline/error detail | `#9F3C36` | `#F08B82` |
| `diagnostic-grammar` — grammar underline/detail | `#805D12` | `#D5B56A` |

Use the editor background for simple overlays initially, with a boundary and restrained shadow. Decorative separators may use a softer token if needed; do not reuse that softer color for a boundary needed to identify a control. Avoid a contrasting “paper card” and heavy shadow in the wide-screen writing view: keep the canvas visually continuous.

Calculated WCAG contrast ratios for these opaque sRGB pairs, rounded for reporting:

| Foreground on editor surface | Light | Dark |
|---|---|---|
| Primary text | 15.42:1 | 12.30:1 |
| Secondary text | 5.66:1 | 7.11:1 |
| Markdown markers | 4.96:1 | 5.98:1 |
| Accent | 5.68:1 | 8.67:1 |

These values establish useful contrast margins. They do not prove perceptual comfort or overall interface accessibility. Actual state combinations still need verification.

### Behavior and hierarchy

- **Keep readable text above the minimum.** Require at least 4.5:1 for normal-sized meaningful text on its actual background; aim above 7:1 for main prose in the default themes. The latter is a product target, not a universal comfort threshold. Never create quiet secondary text through arbitrary opacity.
- **Keep necessary indicators visible.** Require at least 3:1 against adjacent colors for meaningful control boundaries and graphical state indicators, including focus indicators where applicable. A minimum ratio alone does not make a very thin mark easy to perceive. [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
- **Use selection-specific text.** While selected, render prose and Markdown markers in `text-primary` over `selection-background`. The default marker colors do not all retain 4.5:1 on these selection fills. Do not allow syntax highlighting to override selection readability.
- **Make color meanings consistent.** Reserve diagnostic colors for problems and blue for interaction. Add distinct underline patterns and explicit suggestion labels for spelling versus grammar. Selected library items also need a shape/edge indicator or weight change plus accessible selected state; color alone is insufficient.
- **Preserve visible context in focus mode.** Start by rendering inactive prose with the verified secondary-text token. Stronger user-selected dimming needs an easy reset; it should not lower document readability silently.
- **Honor accessibility overrides.** Preserve system forced-color behavior where supported by the webview, keep focus visible, and allow a small high-contrast token override. Avoid blanket `forced-color-adjust: none` rules. Do not interpret OS color mode as a measurement of ambient light.

Add lightweight contrast assertions for the semantic foreground/background pairs and selected states. Visually inspect the actual fonts, thin marks, dark/light themes, and wide-screen canvas in the real app. The calculations above need no production dependency.

## Visual hierarchy, information architecture, and Gestalt principles

These must be standing design criteria from the first screen onward. Apply them to the editor, library, palette, settings, empty states, and failures. They guide the existing components and require no additional framework.

### Define the hierarchy by task

The normal writing state prioritizes the document and caret, followed by the current file/location and the tools relevant to the current task. Word count and other passive metadata remain secondary. When saving fails or a conflict needs resolution, the persistent recovery message becomes the most important interface element until handled. A universal rule that “all chrome must disappear” would undermine this hierarchy.

Use spacing, placement, alignment, and weight before adding color or making labels faint. Keep primary, supporting, and metadata treatments consistent. Within document content, preserve real heading levels and readable distinction between h4–h6; do not depend on small caps, italics, or color alone, especially across scripts. [Visual hierarchy reference](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/).

### Keep the information architecture small and explicit

| Area | Responsibility |
|---|---|
| Writing surface | Edit the current document and show local diagnostics. |
| Library | Browse directories and files; show the active file and its context. |
| Quick open | Find a file by name/path; show parent paths to distinguish duplicate names. |
| Command palette | Find actions with consistent names and visible shortcuts. |
| Settings | Adjust appearance, writing behavior, language/checking, and files/privacy; add extensions only when implemented. |
| File status | Communicate saving, failure, conflict, and recovery without obscuring the affected document. |

Use the same names and command IDs across menus, the palette, shortcuts, and Settings. Put settings into a few labeled sections on one screen initially. Keep filenames as the primary file identity; frontmatter titles may supplement them without disguising their paths. Show empty, loading, unavailable, and error states in their relevant area. Opening the palette must not be the only way a new user discovers essential actions.

This organization defines what belongs where; navigation is the means of reaching it. Keep the model stable when layout changes between narrow and wide windows. [Information architecture and navigation](https://www.nngroup.com/articles/ia-vs-navigation/?lm=navigation-you-are-here&pt=article).

### Apply a focused set of Gestalt principles

| Principle | Concrete rule for bismillah |
|---|---|
| **Proximity** | Keep a setting’s label, control, explanation, and error closer to each other than to the next setting. Place diagnostics near their text and filenames beside their paths. Start with 8px within a group and 24px between settings groups; use the typography rhythm for document content. |
| **Similarity** | Controls with the same role share shape, type treatment, spacing, and behavior. A destructive action must not resemble the default continuation action. |
| **Common region** | Give each overlay a clear boundary and group related settings through headings and spacing. Add a container only when its boundary conveys a useful relationship. |
| **Continuity and alignment** | Align prose to a consistent reading edge, hang Markdown marks in the reserved gutter, and use indentation to communicate directory nesting. Align RTL content logically while preserving the app’s chosen interface direction. |
| **Figure and ground** | Make the active document and foreground overlay clear through placement, restrained surfaces, and focus. A popup should not compete with the document through excessive shadows or decoration. |

These are perceptual grouping principles, not rigid numerical laws. The proposed gaps are local starting tokens. Check grouping with realistic long filenames, translated labels, Arabic content, and larger text. See the references on [proximity](https://www.nngroup.com/articles/gestalt-proximity/), [similarity](https://www.nngroup.com/articles/gestalt-similarity/), and [common region](https://www.nngroup.com/articles/common-region/?lm=principles-visual-design&pt=article).

### Lightweight review rule

For every new or changed screen, review five questions alongside the existing specimen checks:

1. Is the most important content or current recovery action apparent?
2. Can the writer identify the current file, mode, and relevant action?
3. Do proximity, alignment, and grouping show what belongs together?
4. Do keyboard order, accessible names, and semantic structure agree with the visible organization?
5. Does that organization survive narrow/wide windows, both themes, RTL/mixed content, and enlarged text?

Document these rules in `DESIGN.md` and apply them during implementation review. Keep the process short and tied to the actual screen; no separate design-governance system is needed.

## Arabic terminology and product identity

Use a small, intentional Arabic vocabulary for distinctive experiences. **Zuhd mode (زهد)** is the recommended name for the existing focus-mode feature. It expresses the product’s commitment to restraint and undistracted writing. In Islamic usage, zuhd concerns detachment from worldly attachment; using it here is a product metaphor, not a claim that enabling a writing mode fulfills the spiritual practice. [Reference on zuhd](https://seekersguidance.org/answers/living-religion/what-is-meant-by-detachment-from-the-dunya/).

### Recommended application

| Context | Proposed copy |
|---|---|
| Menu / Settings label | **Zuhd mode** |
| Supporting description | “Focus on the current sentence or paragraph.” |
| Command when inactive | “Enable Zuhd mode” |
| Command when active | “Disable Zuhd mode” |
| Granularity setting | “Focus on: Sentence / Paragraph” |
| About / terminology note | “Zuhd (زهد) inspires a quieter space for writing.” |

Keep the planned `Mod-D` shortcut and sentence/paragraph behavior. This is a name for the existing feature, requiring no new mode manager or configuration layer. Typewriter scrolling and fullscreen remain independently controlled; enabling Zuhd mode should not silently change them.

### Naming rules

- **Pair identity with a clear explanation.** Show the short description beside the setting and beneath the palette entry where needed. The writer should understand the action without opening a glossary. This follows the accessibility principle of clear visible labels. [W3C label guidance](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/).
- **Make familiar searches work.** Include “focus,” “distraction-free,” “sentence,” “paragraph,” “zuhd,” and “زهد” as palette search aliases for this same command. Keep one canonical label across menus, Settings, and documentation.
- **Keep ordinary operations familiar.** Open, Save, Rename, Undo, Preview, Library, and Settings should retain direct functional names in the interface language. Arabic localization can translate them naturally; the English interface need not transliterate every operation.
- **Choose future terms by meaning and usefulness.** Require a clear relationship between the term and the experience, a one-sentence functional explanation, and consistent usage. Add names only when the feature exists. Avoid religious terms that imply the app can assess intention, worship, or spiritual achievement.
- **Separate labels from implementation.** Keep stable functional command IDs and settings keys, such as `editor.toggleFocus` and `focus_mode`. Map “Zuhd mode” and its search aliases in the existing command registry. Use a consistent readable transliteration without requiring diacritics for typing or search.

**Scope:** adopt Zuhd mode now in the design vocabulary and carry it into the eventual implementation. Keep the rest of the interface concise and descriptive; a small number of meaningful names can establish identity without burdening information architecture.

## A centered Basmallah at the opening of every document

**Product requirement:** every document opens with a beautifully typeset, centered Basmallah:

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

Use this as a consistent opening in both the editor and preview, including an empty new document. Center it within the document’s reading column, so it remains aligned with the writing surface when the library opens or the window changes size.

### Typography and hierarchy

- Use the bundled Amiri regular face, with natural Arabic shaping and its standard OpenType behavior. Begin testing at 28px with a unitless line height of 1.8; adjust after checking the actual bundled font and diacritics. Scale with the document’s text-size preference.
- Set explicit Arabic language and RTL direction on the phrase. Keep its container centered and allow adequate height and inline padding for every mark and glyph.
- Use `text-primary` in both themes. Establish distinction through the Arabic letterforms, placement, and whitespace. Keep the existing restrained palette and avoid an additional decorative color or graphic asset.
- Start with one body-line of space above and one-and-a-half below. On short windows, reduce the surrounding space while preserving the phrase’s legibility. It scrolls naturally with the document and appears once at the top.
- Keep the document title and opening paragraph clearly grouped below it. The Basmallah is a separate opening element, not a heading in the document outline or a replacement for the filename/title.

### Preserve the file contract

The default implementation is a presentation element: do not prepend text to existing Markdown files, modify frontmatter, or create a document edit merely by opening a file. Keep it outside CodeMirror’s editable text model and implement the opening through a supported editor layout mechanism. Verify its height and scrolling with typewriter mode, caret placement, and document restoration.

Apply the same opening element to preview. Saving and copying document text preserve the actual source; copying the Basmallah itself should remain possible. Any future print/export feature must explicitly document whether it exports source content or the composed presentation.

If the actual first content block already contains the same standalone Basmallah, suppress the added presentation element so the opening appears once. Limit this to a narrow, tested comparison of that first block, allowing common vocalization and whitespace differences. Leave the source unchanged and avoid general religious-text detection. Custom calligraphic images or other spellings can remain outside this initial deduplication rule.

### Accessibility and scope

Render real Unicode text rather than a raster image. Expose it once in reading order with Arabic language metadata, without adding it to editable-text counts, spellchecking, grammar checking, or the document outline. Preserve comfortable contrast, diacritic clearance, and reflow at enlarged text sizes. In Zuhd mode, keep the opening visible when it is in view without making it sticky or interrupting writing.

This needs one shared opening component and a small editor integration, using the already selected Amiri font. Add editor/preview specimen checks for an empty file, English and Arabic files, an existing opening Basmallah, narrow/wide windows, and enlarged text. No additional font collection, calligraphy renderer, or content-rewriting pipeline is required.

## Designers and design houses to reference

Use a small set of references, each with a clear responsibility:

| Designer / house | What to learn | Application to bismillah |
|---|---|---|
| **Dieter Rams / Vitsœ / Braun** | Usefulness, honesty, restraint, longevity, and attention to detail. | Every feature earns its place; saving and recovery receive as much care as typography. [Ten principles](https://www.vitsoe.com/rw/about/good-design). |
| **iA — Information Architects** | Typography as the interface and deliberate limits on features. | Writing measure, responsive margins, visible Markdown, and a calm writing experience. [iA Writer](https://ia.net/writer/). |
| **MUJI** | Careful material selection, simplified processes, and reduced packaging. | Translate that discipline into a small font collection, restrained surfaces, and minimal dependencies. This is our software interpretation of its product philosophy. [MUJI’s approach](https://careers.muji.com/jp/story/package-material). |
| **IBM Design / Plex** | Systematic typography, grids, and coherent visual foundations. | Consistent spacing, interface hierarchy, and careful multilingual font treatment. [Design language](https://www.ibm.com/design/language/). |
| **Khaled Hosny / Alif Type** | Arabic type designed with its own shaping and typographic traditions. | The Basmallah, Amiri, diacritics, and Arabic prose deserve deliberate typesetting. [Alif Type](https://aliftype.com/). |
| **GOV.UK Design System** | Clear language, readable layouts, and tested interaction patterns. | Settings, errors, file recovery, and discoverability should be immediately understandable. [Design system](https://design-system.service.gov.uk/). |

**Primary references:** Rams for product principles, iA for the writing experience, and Alif Type for Arabic typography. IBM and GOV.UK provide supporting implementation discipline; MUJI informs restraint and resource choices.

The project’s Islamic principles guide decisions about trust, privacy, restraint, and respect for the writer. Develop bismillah’s own identity through a clear opening Basmallah, meaningful terminology such as Zuhd, and careful behavior throughout.

**Practical rule:** whenever a reference is cited in `DESIGN.md`, state which decision it informs and how the result will be judged. For example, iA informs the bounded writing measure, assessed with the actual fonts and specimen; Rams informs feature restraint, assessed by whether a proposed feature improves the core writing task. Referencing a house does not require adopting its entire visual language or component system.
