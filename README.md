# bismillah

بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

**A calm Markdown editor. Just you and your words.**

bismillah is a free, open-source writing app in the spirit of the original iA Writer: a typewriter, with only the best of the computer.

- **Plain Markdown files** in folders you choose. Filenames are the organisation; frontmatter is optional.
- **Typography first.** A bounded reading measure, carefully chosen fonts, and a document that reads as rendered text: the Markdown shows only in the paragraph you're writing (or everywhere, if you prefer).
- **Spelling** in English and Arabic, and **grammar suggestions** in English, all computed on your device.
- **Arabic and right-to-left writing** treated as equals to Latin.
- **Zuhd mode (زهد):** focus on the current sentence or paragraph.
- **Keyboard first.** Every action has a shortcut and a place in the command palette.

And just as deliberately, it has **no** accounts, subscriptions, ads, telemetry, cloud sync, generative AI, or networking features. Nothing writes for you. See [PRIVACY.md](PRIVACY.md).

## Status

**Pre-alpha, private.** For now bismillah is a personal project that runs only on its author's Linux machine. Phase 1 (the writing core: safe saving with recovery, settings), Phase 2 (the library: a folder of files, quick open, the command palette, rename, new folder and move to trash with undo), Phase 3 (spelling in English and Arabic, grammar suggestions in English, a personal dictionary) Phase 4 (live preview: the text reads rendered and shows its Markdown only where you write, with *Always show Markdown* on `Ctrl+R`; Copy as rich text) and Phase 5 (colour themes as plain files, High contrast, the full Settings screen, your own shortcuts in `keybindings.toml`, About) are built; Phase 6 (a personal 1.0 for daily use) is next. See the [roadmap](PLAN.md). Publishing, and macOS and Windows builds, come later.

To install it on Arch Linux from this repository: `cd packaging/arch && makepkg -si`. Some GPU and driver combinations need `WEBKIT_DISABLE_DMABUF_RENDERER=1` in the environment.

## Inspiration

bismillah is inspired by Islamic ethics: treating the writer's words as a trust (*amanah*), respecting privacy, and practising restraint. These shape how the app saves, what it refuses to collect, and how little it asks of your attention. Read more in [DESIGN.md](DESIGN.md#4-islamic-principles-as-design-constraints).

## For contributors

- [DESIGN.md](DESIGN.md): principles, typography, colour, interaction
- [ARCHITECTURE.md](ARCHITECTURE.md): how it is built and the contracts it keeps
- [PLAN.md](PLAN.md): roadmap and phase acceptance criteria
- [docs/decisions/](docs/decisions/): architecture decision records
- [CONTRIBUTING.md](CONTRIBUTING.md): how to help
- [AGENTS.md](AGENTS.md): instructions for AI coding agents

## Licence

[GPL-3.0-or-later](LICENSE). Bundled fonts are under the SIL Open Font License; the Arabic dictionary is under its own licence (see `fonts/` and `dictionaries/`).
