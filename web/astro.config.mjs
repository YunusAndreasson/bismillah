// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";

export default defineConfig({
  // The workers.dev address until the site's own is chosen (GUIDELINES.md,
  // "Still to decide"). Canonical URLs and a future sitemap come from it.
  site: "https://bismillah.jonas-268.workers.dev",
  // Every page is a flat file (`about.html`, not `about/index.html`), and its URL
  // has no trailing slash. Cloudflare's assets layer serves `/about` from
  // `about.html` directly, so no URL ever answers with a redirect.
  trailingSlash: "never",
  // Stylesheets are files, never inlined, so the CSP in public/_headers can allow only
  // the site's own (`style-src 'self'`).
  build: { format: "file", inlineStylesheets: "never" },
  markdown: {
    // The manifesto shows exactly as its author typed it: no smart quotes, dashes or
    // ellipses added (AGENTS.md: save, and show, exactly what the writer typed).
    processor: satteri({ features: { smartPunctuation: false } }),
  },
  // The dev toolbar would sit over the film in every local preview.
  devToolbar: { enabled: false },
  vite: {
    // Without a named tsconfig, Vite looks up the one that governs each file, and for
    // a file web/tsconfig.json doesn't include (anything in node_modules) it climbs
    // out of web/ to the app's root tsconfig. That extends @tsconfig/svelte, which
    // only the app installs, so a clean checkout (CI) failed to build. The site has no
    // business reading the app's config either way.
    tsconfig: "./tsconfig.json",
  },
});
