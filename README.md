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
- **Links** open in your browser only when you `Ctrl`+click them.

And just as deliberately, it has **no** accounts, subscriptions, ads, telemetry, cloud sync, generative AI, or networking features. Nothing writes for you. See [PRIVACY.md](PRIVACY.md).

## Status

**1.0, personal.** bismillah is its author's everyday writing tool on Linux, and stays private for now: it runs on one machine, installed from this repository. Everything on the [roadmap](PLAN.md) up to the personal 1.0 is built: safe saving with recovery, the library, spelling in English and Arabic and grammar suggestions in English, live preview, colour themes and your own shortcuts, links, and a guide inside the app. Publishing, and macOS and Windows builds, come later.

## Install (Arch Linux)

```sh
cd packaging/arch && makepkg -si
```

This builds the committed version and installs `bismillah` with its icon and desktop entry, so Markdown files offer *Open with › bismillah*. Start it from your launcher, or from a terminal with `bismillah [file | folder]`. Some GPU and driver combinations need `WEBKIT_DISABLE_DMABUF_RENDERER=1` in the environment.

## Using it

Everything bismillah does is in [the guide](docs/guide.md), which is also inside the app: *Help › Guide*, or `F1`. It opens as a sample you can try things in.

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
