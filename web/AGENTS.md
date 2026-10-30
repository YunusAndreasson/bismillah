# AGENTS.md: the website

The site that promotes **bismillah**, the editor in the repo root ([../AGENTS.md](../AGENTS.md)).
It is built with Astro 7, fully static, and served by Cloudflare as the `bismillah` Worker:
static assets only, no Worker script. Until the site has its own address it lives at
https://bismillah.jonas-268.workers.dev.

**Status:** the design is built (2026-10-28) and waits for the author's review, with
its words in `src/copy.ts` (drafted 2026-10-29 for the author to review). One page, one
story, in six scenes (the opening's camera move and the last two beats below came with the
storytelling pass of 2026-10-30): the film (our own player, the tower loop as its picture,
under the name and what it is, a writing app that never writes for you, with a label, the
film's title and the play button as one group on the picture, so the first screen says what
this is), the opening shot (scrolling holds the first screen: the name, title and play button
leave, which uncovers her in the window they were on, the tower's lights go out until hers is
the only one, the camera goes to it), her room and her screen (the film's second and third
shots; the camera pushes into her laptop and its light becomes the page, with nothing
blank in between), her page: the film's own lines set as the editor sets a document and
written as they are read, in the editor's typewriter mode, one line or sentence to a stretch
of scrolling with the page held still and the caret after them (Zuhd mode follows); they are
the manifesto, said as the film says it, so the site links to no other. At
"Prompting is not thinking," the machine offers to finish her line, in the film's own words
and the machine's dark, and at the next stretch it is gone and she writes "writing is.".
Then her laptop with the app's real screens under the README's line that names it, the
answer to her page's first question (scrolling changes what it shows, the laptop held
still), and the close: the stick, which is the call to action (three numbered steps, side by
side on a wide screen, each with a picture: a USB stick, one command that puts bismillah on
it, the laptop started from it), and last the page's one ending: "These words are mine." in
the editor's type with its caret after it, on a page of its own, and the caret is real: the
visitor can write there (click, or just start typing), left to right or right to left, and
nothing is kept or sent. Two quiet lines say what the name means and that, and go at the first
word, so the page's last words are the visitor's. No footer. (2026-10-29: the story, then what
it is, then how to get it; the same day the close moved after the stick, so nothing dark
stands between seeing the editor and getting it, and the dawn loop, then the boy's notebook,
left the ending, as both needed the film to mean anything.)
"Get the bismillah app" stays pinned in the top corner over every scene (the
author's request, 2026-10-28), so the way to the stick is always in reach, and steps
aside while the stick itself is on the screen.

## Read first

| Read | Before |
|---|---|
| [GUIDELINES.md](GUIDELINES.md) | Any design, copy, image, motion or sound work: the intention, the two worlds, the palette, type, words, pictures, and what the site must never do |
| [../DESIGN.md](../DESIGN.md) | Anything that shows the editor itself, which must look as the app does |

## Rules

- **The site keeps the editor's promises.** No trackers, analytics, ads, pop-ups,
  cookie walls, chat, or requests to third parties: fonts, images and scripts are
  served from this site.
- **The film's lines and the manifesto are fixed.** Reuse the lines in GUIDELINES.md
  exactly. Other words may be drafted, plainly and in the site's voice (GUIDELINES.md,
  Words), for the author to review.
- The name is always lowercase: **bismillah**.
- **Static by default.** No adapter, no Worker script, no request-time code. Anything
  live runs in the browser. Adding `@astrojs/cloudflare` or a `main` script is a
  decision: say why first.
- `.astro` first. Client JavaScript only where a page truly needs it: today one module,
  `src/scripts/site.ts` (the player, the opening shot, the push, her page written as it is
  read, Zuhd mode, the caret, the visitor's line, the corner button's ground, and the
  commands' copy buttons and the choice of the visitor's own).
  Everything reads and plays without it.
- **Every other word lives in `src/copy.ts`**, each line with its source when it has
  one, so the author can review and change the words in one place.
- **Motion is slow and one thing at a time** (GUIDELINES.md): the loops play once and
  rest (WCAG 2.2.2's five seconds), the caret blinks four times, and
  `prefers-reduced-motion` turns the loops, the opening shot and the push into stills
  and her page into plain text; one rule in
  `Base.astro` ends every transition and blink, so components don't repeat it (a
  range slider's parts escape it, so the playhead blinks only under `no-preference`).
- Colours come from the tokens in `src/layouts/Base.astro`, which hold the colours of
  the palette in GUIDELINES.md that the site uses (add one there when a scene needs
  it). Never a literal colour in a component. The sizes are tokens too: the writing
  size, the title step (`--size-title`) and one line of writing (`--L`), the unit of
  every vertical space.
- Shared pieces live once in `Base.astro`: the two worlds (`.night`, `.page`, which
  sets the writing size), the editor's caret on any `[data-caret]` text and, at rest,
  after the name (`[data-wordmark]`, the logo), and a `[hidden]` that wins over a
  component's `display`.
- Prefer retrieval over memory for Astro and Cloudflare APIs, because both move fast
  (the `docs-lookup` skill and the `astro-docs` MCP; the global `wrangler` and
  `cloudflare` skills).

## Layout

- `src/layouts/Base.astro`: the document shell, the palette and size tokens, the fonts
  and base type, the caret, the reduced-motion rule, and the link preview.
- `src/pages/index.astro`: the page, built from `src/components/`: `Film` (the player),
  `Screen` (her screen), `Document` and `Basmallah` (a document as the editor sets it),
  `Screens` (her laptop with the editor's real screens, one screen after another as
  the page scrolls), `Close` (the stick, and her last line with the caret; no footer) and
  `Stick` (the three steps) with `Commands` (the install command, inside step 2 when the
  steps stand one under another, and on one line under all three when they stand side
  by side). `404.astro` is served with status 404 for any unknown path.
- `src/content/her-page.md`: the film's own lines (GUIDELINES.md, Words), as she writes
  them in the film, without "These words are mine.", which ends the page. They took the
  place of the site's 256-word cut of `../MANIFESTO.md` on 2026-10-29 (in git history);
  the full text stays in `../MANIFESTO.md`. Markdown is rendered by Sätteri with smart
  punctuation off, so it shows exactly as typed.
- `src/assets/`: the stills (Astro makes AVIF and WebP), the fonts (`scripts/fonts.sh`;
  Amiri only for Arabic a visitor writes, fetched when such a character is drawn)
  and the Basmallah outline (`scripts/basmallah.sh`, copied from the app).
  `src/assets/screens/`: the stick's real screens, taken in a VM by `../os/scripts/shots.ts`
  (her page, `src/content/her-page.md`, is the document they show first; the manifesto,
  `../MANIFESTO.md`, fills her library one section to a file: Zuhd mode is shown on
  its first section, whose paragraphs run for lines, and Files finds its Memory by
  four letters)
  (`pnpm os:shots`) and copied by `scripts/screens.sh`. `src/assets/scenes/`: the
  moments the laptop scene moves through, one idea each, generated with Codex, and
  `PROMPTS.md`, how and what the rounds taught.
  `src/assets/tower.ts`: the tower still's bays and her window, measured by hand, for the
  lights going out. `src/assets/laptop/`: each moment, the real screens laid on where it shows one, by
  `scripts/laptop.py`, at twice the photograph's size, as a wide strip and a square
  for phones. Every picture of the app on the site is one of these, never a mock-up.
  `src/assets/steps/`: the three step pictures, generated with Codex, and
  `PROMPTS.md`, how they were made; step 3's screen is the stick's real setup screen
  (`src/assets/screens/setup-passphrase.png`), laid on with `scripts/screen.py`.
- `public/media/`: the film as HLS and one AV1 file, the loops, and the captions, in
  versioned folders (`scripts/media.sh`). Encoded from the director project's master;
  committed, so a build needs nothing outside `web/`.
- `public/favicon.svg`: the app's bāʾ icon, copied from `../src-tauri/icons/source.svg`.
  Copy it again when the icon changes.
- `public/install.sh`, `public/install.ps1`: the stick's install commands (macOS and
  Linux; Windows), served as text and run by `curl … | sh` and `irm … | iex`
  (../docs/decisions/0017-published-stick.md). `Stick.astro` writes the commands on the
  `site` address; with the script only the visitor's own computer's shows (both
  without it, or on a phone or tablet). They download from
  `/stick/<version>/`, named by `public/stick/current`, which reads `none` until an image
  is published (hosting, likely R2, is decided later). The app's
  `os/tests/install.test.ts` runs `install.sh` end to end.
- `public/_headers`: response headers (see Delivery).
- `GUIDELINES.md`, `moodboard.jpg`, `palette.jpg`, `media/`: the design brief and the
  film's frames and loops. These are inputs: move what a page uses into `src/assets/`
  (processed and fingerprinted by Astro) or `public/`.
- `scripts/ship.sh`, `scripts/smoke-test.sh`: deploying (see CI and deploy).
- `scripts/media.sh`, `scripts/fonts.sh`, `scripts/basmallah.sh`: run by hand when the
  film, the fonts or the app's Basmallah change; their output is committed.

## Delivery

- `astro build` writes flat files to `dist/` (`build.format: "file"`, `trailingSlash:
  "never"`), so Cloudflare serves `/about` from `about.html` with no redirect.
- `wrangler.jsonc`: assets only, `not_found_handling: "404-page"`, workers.dev on,
  per-version preview URLs off.
- **Browsers:** Baseline Widely Available, set as `browsers` in `astro.config.mjs`
  (Chrome and Edge 111, Firefox 114, Safari 16.4), because Astro alone builds for
  `esnext`. Lightning CSS lowers and prefixes the CSS for them, so write standard,
  unprefixed CSS; only the range slider's `::-webkit-`/`::-moz-` parts stay by hand.
  Astro's `<Font />` and responsive image layouts write inline styles, which the CSP
  refuses, so the fonts are `@font-face` in `Base.astro` and images list their widths.
  The push stays in `site.ts` until Gecko has scroll-driven animations (Firefox 159;
  Zen was on 157 on 2026-10-28).
- `public/_headers`: `X-Robots-Tag: noindex` until launch, `nosniff`, `no-referrer`,
  a `same-origin` opener policy, a same-origin `Content-Security-Policy` (no inline
  script or style, so Astro writes stylesheets as files: `inlineStylesheets: "never"`;
  Trusted Types, so no string reaches `innerHTML`, `eval` or another sink), and
  `/_astro/*` and `/media/*` cached for a year, `immutable`. The install scripts and
  `stick/current` are `text/plain` and `no-cache`; each `/stick/:version/*` folder is
  `immutable` (overlapping rules join their values, so that pattern must not match
  `current`).
- **Video and Range:** static assets ignore `Range` and answer 200 with the whole file,
  and Safari won't play an MP4 that way, and no file may exceed 25 MiB. So the film is
  HLS (Safari, Chrome 142+) with one progressive AV1 file under 24 MiB for Firefox and
  Zen, and each loop has a one-segment HLS before its MP4s.
- **At launch**, when the address is chosen: remove the `noindex` header, and change
  the URL in `astro.config.mjs` (`site`), `scripts/ship.sh` (`URL`), and `BASE` and
  the usage line in `public/install.sh` and `public/install.ps1` (and in
  `../os/README.md`).
- The site builds from `web/` alone; nothing reads from `../`. If it ever must (the
  editor's fonts in `../fonts/`), copy what it needs in, or widen `ship.sh`'s
  clean-tree check to that path.

## Commands

Run them from `web/`. It is its own pnpm root (pnpm 12, its own lockfile), apart from
the app's.

```bash
pnpm install        # pnpm switches itself to the version in packageManager
pnpm dev            # astro dev
pnpm build          # astro build → dist/
pnpm preview        # build, then serve dist/ in workerd with production headers and 404 (port 8787)
pnpm check          # Biome lint + format (pnpm check:fix writes the fixes)
pnpm typecheck      # astro check
pnpm verify         # check + typecheck + build: the gate before every commit, the same as CI
pnpm ship           # deploy to production, only when the author asks (see below)
```

## CI and deploy

- **CI** (`../.github/workflows/web.yml`) runs `pnpm verify` on every push to main and
  every pull request that touches `web/`. It never deploys, so no Cloudflare credential
  lives in GitHub.
- **Deploy**: `pnpm ship` from the author's machine is the only path. It refuses unless
  `web/` is clean and on main, then runs `pnpm verify`, `wrangler deploy` (the
  logged-in OAuth session, no API token) with the last site commit as the message, and
  the smoke test against the live URL. Never run `wrangler deploy` directly, and ship
  only when the author asks.

## Dependencies

- Latest releases, pinned exactly. pnpm holds back releases younger than a day
  (`minimumReleaseAge`). Exclude a fresh version in `pnpm-workspace.yaml` only when we
  need it now, and remove the entry once it has aged.
- TypeScript stays on 6.x: `@astrojs/check` (Volar) does not support TypeScript 7 yet.
- Add a dependency only for a real problem, and say what it is for.

## Skills and tools

- Third-party skills are tracked in `skills-lock.json`. The files are gitignored:
  restore them with `npx skills experimental_install` and update them with
  `npx skills update`. They are the incluud Astro set: `astro-best-practices`,
  `docs-lookup`, `create-component`, `content-collection`, `add-integration`, `migrate`.
- Written here: `see-site`, which looks at the built site in Zen and Chromium.
- `.mcp.json` registers Astro's documentation server (`astro-docs`), which
  `docs-lookup` uses for current API answers.
- Global skills that apply: `frontend-design`, `web-perf`, `wrangler`, `cloudflare`.
- Start Claude Code in `web/` for site work, so `.mcp.json` applies.
