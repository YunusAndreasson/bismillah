---
paths:
  - "src/**/*.ts"
  - "src/**/*.svelte"
  - "packages/**/*.ts"
  - "tests/**/*.ts"
---

# TypeScript and Svelte conventions

- Use TypeScript `strict` mode with precise types. Where a type is unknown, use `unknown` and narrow it, so mistakes surface at compile time instead of in a writer's session. A non-null `!` needs a comment explaining why it is safe.
- Keep exact optional properties, checked returns/indexing and type-aware ESLint clean. Await promises, handle their rejection, or mark deliberately detached work with `void`; don't disable the unsafe-value rules to cross an untyped library boundary. In Svelte, keep reactive `let` bindings (`svelte/prefer-const` understands them).
- Use Svelte 5 runes (`$state`, `$derived`, `$effect`). Keep components small and presentational; logic lives in `src/core/` or `src/editor/`, where it can be unit-tested.
- Call Rust through the typed bridge in `src/core/ipc.ts`. It keeps command names and payloads checked on both sides of the boundary.
- Build dialogs, popovers, menus and listboxes on Bits UI primitives, styled with our CSS. They provide focus management and keyboard behaviour that is easy to get subtly wrong by hand.
- Define user-facing labels once, in the command registry (`src/core/commands.ts`), and reference them by command ID (`area.verbNoun`, e.g. `file.save`). This keeps menus, palette, shortcuts and Settings consistent (DESIGN.md §13–14).
- State text offsets with their unit in names or types (`fromUtf16`). Offsets crossing IPC are UTF-16 code units relative to a block (ARCHITECTURE.md §7.1).
