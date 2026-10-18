---
name: design-review
description: Review a new or changed bismillah screen, component, or typography/editor change against DESIGN.md before it merges — specimen check in the real app, the five design-review questions, contrast, keyboard and RTL.
when_to_use: After any change to UI, copy, typography, colour, layout or editor decorations; when asked to "review the design", "check the specimen", or before marking UI work done.
---

# Design review

Review the change against the product's design foundation. Report findings; do not silently restyle unrelated things.

## 1. Load the standard
Read the DESIGN.md sections relevant to the change. These are always relevant: §2 Principles, §9 Colour, §17 Gestalt rules, §18 Design review. For editor or typography work also read §8 and §11; for layout, §7; for copy, §14.

## 2. Look at it in the real app
Run `pnpm tauri dev` and open `docs/specimen.md`. Browser-only checks are not enough, because WebKitGTK, WKWebView and WebView2 render differently. Check:
- content widths **640, 1280, 1920, 2560** CSS px, a short window, and 200% zoom
- **Light and Dark** themes
- **Arabic, vocalised Arabic and mixed lines**: no clipped diacritics, correct caret movement, selection and mouse placement, hanging marks mirrored on RTL lines
- the Basmallah opening: centred, not editable, not duplicated
- no reflow when chrome fades; the caret and scroll are kept when the library opens.

If the change is covered by visual regression, also run `pnpm test:visual` and inspect the diffs.

## 3. Answer the five questions (DESIGN.md §18)
1. Is the most important content, or the current recovery action, apparent?
2. Can the writer tell the current file, mode and relevant action?
3. Do proximity, alignment and grouping show what belongs together?
4. Do keyboard order, accessible names and semantic structure match the visible organisation?
5. Does it hold up at narrow and wide widths, in both themes, with RTL/mixed content and enlarged text?

## 4. Mechanical checks
- Components use semantic tokens only: no raw colours, no opacity-dimmed text.
- Contrast: text ≥ 4.5:1 on its actual background (including hover and selected states); control boundaries and focus indicators ≥ 3:1. Run the contrast unit test.
- Every action works from the keyboard. `Esc` closes overlays and restores focus. Focus is visible.
- Copy follows DESIGN.md §14: plain, specific, modest; canonical command labels.
- Motion is limited to opacity and transform, and disabled under reduced motion.

## 5. Report
Give a short verdict (pass / pass with notes / needs changes), then findings ordered by severity, each with the DESIGN.md section it relates to and a concrete fix. Attach or reference screenshots for visual findings.
