---
paths:
  - "src/**/*.css"
  - "src/**/*.svelte"
---

# CSS conventions

- Use plain CSS with custom properties from `src/styles/tokens.css`. Components reference **semantic** tokens (`--text-secondary`, `--surface-panel`) and never raw colours, so themes, high contrast and the contrast tests all keep working.
- Make text quieter by choosing `text-secondary` or `syntax-marker`, never with `opacity`, because opacity makes contrast unmeasurable (DESIGN.md §9.4).
- Use logical properties (`margin-inline-start`, `padding-block`, `inset-inline-end`) so layouts mirror correctly for RTL.
- Interface spacing comes from the 4px scale (`4 8 12 16 24 32 48`). Document spacing uses `em`/`lh` from the active writing profile (DESIGN.md §10).
- Interface text uses `system-ui` at the interface size; document text uses the writing-profile variables. Keep them separate so the interface stays stable when the writing font changes.
- Animate only `opacity` and small `transform`s, 120–180ms ease-out, and remove motion under `prefers-reduced-motion`. Fading chrome never changes layout tracks (DESIGN.md §7, §12).
- Never apply `letter-spacing` to Arabic text.
