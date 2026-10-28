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
});
