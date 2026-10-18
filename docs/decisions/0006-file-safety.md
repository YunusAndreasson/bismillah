# 0006 — File-safety contract (amanah)

- **Status:** Accepted
- **Date:** 2026-10-18

## Context
Autosave without a precise contract risks lost or overwritten text, silent re-encoding, and dishonest "Saved" indicators. The writer's words are a trust (amanah).

## Decision
The contract in ARCHITECTURE.md §5:
- revisions and serialised writes
- durable atomic writes (temp file in the same directory, fsync, rename, directory fsync)
- preservation of permissions, line endings, BOM and exact text
- UTF-8 only, with non-UTF-8 files opened read-only
- external-change checks before replacing a file, and a persistent conflict bar
- typed failures that stay visible
- `Mod-S` as "save now"
- a bounded, private recovery journal in the app-data directory
- trash instead of delete.

## Consequences
- Fault-injection tests (disk full, read-only, rename failure, killed process) are mandatory.
- The recovery journal is the one documented exception to "no hidden files". It lives outside the writing folder and is covered in PRIVACY.md.
