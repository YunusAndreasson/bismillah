// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  // The workers.dev address until the site's own is chosen (GUIDELINES.md,
  // "Still to decide"). Canonical URLs and a future sitemap come from it.
  site: "https://bismillah.jonas-268.workers.dev",
  // Every page is a flat file (`about.html`, not `about/index.html`), and its URL
  // has no trailing slash. Cloudflare's assets layer serves `/about` from
  // `about.html` directly, so no URL ever answers with a redirect.
  trailingSlash: "never",
  build: { format: "file" },
  vite: {
    // Without a named tsconfig, Vite looks up the one that governs each file, and for
    // a file web/tsconfig.json doesn't include (anything in node_modules) it climbs
    // out of web/ to the app's root tsconfig. That extends @tsconfig/svelte, which
    // only the app installs, so a clean checkout (CI) failed to build. The site has no
    // business reading the app's config either way.
    tsconfig: "./tsconfig.json",
  },
});
