---
paths:
  - "src-tauri/src/documents.rs"
  - "src-tauri/src/recovery.rs"
  - "src-tauri/src/library.rs"
  - "src-tauri/src/watch.rs"
---

# File-safety code

This code holds the writer's words, which bismillah treats as a trust (amanah, ADR-0006). The contract is ARCHITECTURE.md §5–6. Read it before changing anything here.

- Every behaviour change comes with a failure-path test: disk full, read-only volume, rename failure, file changed externally, killed process mid-save, and path escape (`..`, absolute paths, symlinks out of the root).
- Saves are serialised per file and atomic (temp file in the same directory, fsync, rename, directory fsync). Preserve permissions, line endings, BOM and exact bytes.
- Check mtime, size and hash before replacing a file. On a mismatch with local edits, surface a conflict instead of overwriting.
- The UI may show "Saved" only for the revision that reached disk.
- Recovery files live only in the app-data directory, with restrictive permissions, bounded in size and age.
