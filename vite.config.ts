import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri serves the built files from dist/ through its own protocol; the dev server is
// only used by `pnpm tauri dev`. Desktop only (ADR-0009): no web build target.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    // os/out and os/cache hold the stick's build output and extracted images, whose
    // udev symlinks loop; none of it is the app's source.
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        "**/spikes/**",
        "**/os/out/**",
        "**/os/cache/**",
      ],
    },
    fs: { allow: [".", "fonts", "docs"] },
  },
  // WebKitGTK 2.4x and current WKWebView/WebView2 all support ES2023.
  build: { target: "es2023", sourcemap: false },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
  },
});
