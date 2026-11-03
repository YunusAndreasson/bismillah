---
name: see-site
description: Build the bismillah website and look at it as a visitor would, served by workerd with the production headers and 404, and screenshotted headless in Zen (Gecko, the author's browser) and Chromium at phone and desktop widths. Use after any change to pages, styles, images, fonts or headers, when asked to "look at", "screenshot" or "check" the site, and before calling site work done.
---

# See the site

`astro dev` skips what Cloudflare does: `_headers`, the 404 status and flat-file
URLs. Look at the built site served by workerd instead, the way production serves it.
Work from `web/`. Screenshots go in the session's scratchpad, never the repo.

## 1. Build and serve

```bash
pnpm verify    # or `pnpm build` when only looking
WRANGLER_SEND_METRICS=false pnpm exec wrangler pages dev --port 8787 --ip 127.0.0.1   # in the background
```

Wait until `curl -s -o /dev/null http://127.0.0.1:8787/` succeeds. Then check the
responses before the pictures:

```bash
scripts/smoke-test.sh http://127.0.0.1:8787    # the site serves; an unknown path is a 404
curl -sI http://127.0.0.1:8787/                # the headers from public/_headers
```

## 2. Screenshot in both engines

Gecko comes first, because it is the author's browser (Zen). Chromium is a second data
point, never the only one. Each command captures the viewport at `--window-size`.

```bash
S=<scratchpad>
# Zen, headless, with a throwaway profile, so it never touches the author's running Zen.
zen-browser --headless --no-remote --profile "$S/zen-profile" \
  --window-size=390,844 --screenshot "$S/zen-390.png" http://127.0.0.1:8787/<path>
chromium --headless=new --hide-scrollbars \
  --window-size=390,844 --screenshot="$S/chromium-390.png" http://127.0.0.1:8787/<path>
```

Take 390×844 (phone) and 1440×900 (desktop) for every change. Add 1920 and 2560 wide
when the layout changes. Create `$S/zen-profile` first, and reuse it.

Read every PNG and look at it against GUIDELINES.md: the two worlds, the palette's
places, one thought per line, nothing that shouts. Say what you saw, including what
is wrong.

## 3. Stop the server

Stop the background `wrangler pages dev` when you are done.

## Limits

- Headless shows layout, type and colour. It doesn't show motion, sound, or the
  author's extensions and privacy defaults. For something the author reports seeing
  in Zen, or for script and CSP failures, use the Zen probe page in
  `~/.claude/rules/browser.md`.
- Never open a window or a tab on the author's desktop unless they ask.
