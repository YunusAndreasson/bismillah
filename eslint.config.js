import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import svelteConfig from "./svelte.config.js";

export default defineConfig(
  {
    ignores: [
      "dist/",
      "target/",
      "src-tauri/",
      "spikes/",
      "os/",
      "node_modules/",
      "fonts/",
      "coverage/",
      "test-results/",
      "packaging/arch/src/",
      "packaging/arch/pkg/",
      "packaging/arch/bismillah/",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...ts.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["src/**/*.ts", "src/**/*.svelte", "tests/**/*.ts", "scripts/**/*.ts", "vite.config.ts"],
    extends: [ts.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  ...svelte.configs.recommended,
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: [".svelte"], svelteConfig },
    },
    // The Svelte rule understands reactive let bindings and $props().
    rules: { "prefer-const": "off", "svelte/prefer-const": "error" },
  },
);
