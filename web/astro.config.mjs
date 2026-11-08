// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";

// The browsers the site is built for: Baseline Widely Available, the versions Vite 8
// targets by default, with features every major browser has shipped for at least 30
// months. Lightning CSS lowers newer CSS and adds the vendor prefixes these need, and
// the script is lowered to them. Astro builds for `esnext` instead, which lowers and
// prefixes nothing, so the floor is set here. Older browsers still get the page:
// the film with the browser's own controls, her screen as a still, the text in ink.
const browsers = ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"];

export default defineConfig({
  // The site's own address (wrangler.jsonc). Canonical URLs, the install commands
  // (Commands.astro) and a future sitemap come from it.
  site: "https://bismillah.ink",
  // Every page is a flat file (`about.html`, not `about/index.html`), and its URL
  // has no trailing slash. Cloudflare's assets layer serves `/about` from
  // `about.html` directly, so no URL ever answers with a redirect.
  trailingSlash: "never",
  // Stylesheets are files, never inlined, so the CSP in public/_headers can allow only
  // the site's own (`style-src 'self'`).
  build: { format: "file", inlineStylesheets: "never" },
  markdown: {
    // Her page shows exactly as it was typed: no smart quotes, dashes or
    // ellipses added (AGENTS.md: save, and show, exactly what the writer typed).
    processor: satteri({ features: { smartPunctuation: false } }),
  },
  // The dev toolbar would sit over the film in every local preview.
  devToolbar: { enabled: false },
  integrations: [
    {
      // The script is built by Vite's client environment, whose target Astro sets to
      // `esnext` over any in `vite`. This hook, after Astro's config, is the place to
      // change it (Astro's v6 upgrade guide). Fail rather than lose the floor quietly.
      name: "browsers",
      hooks: {
        "astro:build:setup": ({ vite }) => {
          const client = vite.environments?.client?.build;
          if (!client) throw new Error("astro.config.mjs: no client build to target");
          client.target = browsers;
        },
      },
    },
  ],
  vite: {
    // The stylesheets are built by the prerender environment, which takes this.
    build: { cssTarget: browsers },
    // Without a named tsconfig, Vite looks up the one that governs each file, and for
    // a file web/tsconfig.json doesn't include (anything in node_modules) it climbs
    // out of web/ to the app's root tsconfig. That extends @tsconfig/svelte, which
    // only the app installs, so a clean checkout (CI) failed to build. The site has no
    // business reading the app's config either way.
    tsconfig: "./tsconfig.json",
  },
});
