---
paths:
  - "src-tauri/**/*.rs"
  - "crates/**/*.rs"
  - "**/Cargo.toml"
---

# Rust conventions

- Keep `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check` clean.
- Return errors as `thiserror` enums, serialised to the frontend as typed errors the UI can explain in plain words (DESIGN.md §14). `unwrap`/`expect` belong in tests or provably infallible spots with a comment, because a panic in the backend can lose a writer's unsaved text.
- Put every `cfg(target_os)` branch in `src-tauri/src/platform.rs`, so platform behaviour stays reviewable in one place.
- `crates/bismillah-lint` stays free of Tauri dependencies, so it can be tested and benchmarked on its own.
- Convert text offsets to UTF-16 code units only in the shared conversion module, with tests covering emoji, combining marks, Arabic diacritics and CRLF.
- Before adding a crate, check that it opens no network connections and fits `deny.toml`'s licence list, then record its job in ARCHITECTURE.md §2.
