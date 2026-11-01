import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The phone app's frontend (ADR-0022). The editor, styles and fonts it shares live above
// this root, in ../src, ../fonts and ../docs.
export default defineConfig({
  plugins: [svelte()],
  root: import.meta.dirname,
  clearScreen: false,
  // TAURI_ENV_DEBUG is set for debug builds, which alone get the test hook.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: { fs: { allow: [resolve(import.meta.dirname, "..")] } },
  build: { target: "es2023", sourcemap: false, outDir: "dist", emptyOutDir: true },
});
