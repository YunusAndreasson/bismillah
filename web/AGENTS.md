# AGENTS.md: the website

The site that promotes **bismillah**, the editor in the repo root ([../AGENTS.md](../AGENTS.md)).
It is built with Astro 7, fully static, and served by Cloudflare as the `bismillah` Worker:
static assets only, no Worker script. Until the site has its own address it lives at
https://bismillah.jonas-268.workers.dev.

**Status:** the design is built (2026-10-28) and waits for the author's review, with
every unwritten word as a visible ⟨placeholder⟩ in `src/copy.ts`. One page, in five
scenes: the film (our own player, the tower loop as its picture), her screen (the
camera pushes into her laptop and its light becomes the page), the manifesto set as
the editor sets a document (Zuhd mode follows the reader), the dawn, and the close
with the stick, which is the call to action.

## Read first

| Read | Before |
|---|---|
| [GUIDELINES.md](GUIDELINES.md) | Any design, copy, image, motion or sound work: the intention, the two worlds, the palette, type, words, pictures, and what the site must never do |
| [../DESIGN.md](../DESIGN.md) | Anything that shows the editor itself, which must look as the app does |

## Rules

- **The site keeps the editor's promises.** No trackers, analytics, ads, pop-ups,
  cookie walls, chat, or requests to third parties: fonts, images and scripts are
  served from this site.
- **Every word on the site is written by a person.** Reuse the approved lines in
  GUIDELINES.md exactly. Never write copy yourself: leave a visible placeholder and ask.
- The name is always lowercase: **bismillah**.
- **Static by default.** No adapter, no Worker script, no request-time code. Anything
  live runs in the browser. Adding `@astrojs/cloudflare` or a `main` script is a
  decision: say why first.
- `.astro` first. Client JavaScript only where a page truly needs it: today one module,
  `src/scripts/site.ts` (the player, the push, Zuhd mode, the caret and the dawn).
  Everything reads and plays without it.
- **Words that aren't approved live in `src/copy.ts`**, as ⟨placeholders⟩ until the
  author writes them. Accessible names there are proposals awaiting approval.
- **Motion is slow and one thing at a time** (GUIDELINES.md): the loops play once and
  rest (WCAG 2.2.2's five seconds), the caret blinks four times, and
  `prefers-reduced-motion` turns the loops and the push into stills.
- Colours come from the tokens in `src/layouts/Base.astro`, which hold the palette in
  GUIDELINES.md. Never a literal colour in a component.
- Prefer retrieval over memory for Astro and Cloudflare APIs, because both move fast
  (the `docs-lookup` skill and the `astro-docs` MCP; the global `wrangler` and
  `cloudflare` skills).

## Layout

- `src/layouts/Base.astro`: the document shell, the palette tokens, the fonts and base
  type, and the link preview.
- `src/pages/index.astro`: the page, built from `src/components/`: `Film` (the player),
  `Screen` (her screen), `Document` and `Basmallah` (a document as the editor sets it),
  `Close` (the dawn, the close, the stick, the footer). `404.astro` is served with
  status 404 for any unknown path.
- `src/content/manifesto.md`: a byte-for-byte copy of `../MANIFESTO.md`. Markdown is
  rendered by Sätteri with smart punctuation off, so it shows exactly as typed.
- `src/assets/`: the stills (Astro makes AVIF and WebP), the fonts (`scripts/fonts.sh`)
  and the Basmallah outline (`scripts/basmallah.sh`, copied from the app).
- `public/media/`: the film as HLS and one AV1 file, the loops, and the captions, in
  versioned folders (`scripts/media.sh`). Encoded from the director project's master;
  committed, so a build needs nothing outside `web/`.
- `public/favicon.svg`: the app's bāʾ icon, copied from `../src-tauri/icons/source.svg`.
  Copy it again when the icon changes.
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
- `public/_headers`: `X-Robots-Tag: noindex` until launch, `nosniff`, `no-referrer`, a
  same-origin `Content-Security-Policy` (no inline script or style, so Astro writes
  stylesheets as files: `inlineStylesheets: "never"`), and `/_astro/*` and `/media/*`
  cached for a year, `immutable`.
- **Video and Range:** static assets ignore `Range` and answer 200 with the whole file,
  and Safari won't play an MP4 that way, and no file may exceed 25 MiB. So the film is
  HLS (Safari, Chrome 142+) with one progressive AV1 file under 24 MiB for Firefox and
  Zen, and each loop has a one-segment HLS before its MP4s.
- **At launch**, when the address is chosen: remove the `noindex` header, and change
  the URL in `astro.config.mjs` (`site`) and `scripts/ship.sh` (`URL`).
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
