//! The recovery journal (ARCHITECTURE.md §5.7).
//!
//! Before every save, the text being saved is mirrored to `<data>/recovery/`, with a
//! small JSON sidecar naming the file it belongs to. A clean save removes the mirror; a
//! failed save makes it durable. A successful recovery write protects against failed or
//! refused saves. If recovery also fails, app.rs reports that fact so the frontend keeps
//! the text open instead of claiming that a recovery copy exists.
//!
//! Entries are kept per app session, so the running session's mirrors can never
//! overwrite text left by an earlier one: that text is offered when its file is opened,
//! and stays until the writer restores or discards it (or it ages out). Entries are
//! private to the user and bounded in size and age.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::documents::{self, NO_FAULTS};
use crate::platform;

/// Entries larger than this are not written; the save itself still runs.
const MAX_ENTRY_BYTES: usize = 16 * 1024 * 1024;
/// When the journal grows beyond this, the oldest entries go first.
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Sidecar {
    /// The file the text belongs to. Shown to the writer; never logged.
    path: PathBuf,
    revision: u64,
    saved_at_ms: u64,
    /// Precise ordering for copies written within a single millisecond. Optional
    /// so entries written by earlier versions remain readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    saved_at_ns: Option<u64>,
}

impl Sidecar {
    fn timestamp_ns(&self) -> u128 {
        self.saved_at_ns
            .map_or_else(|| u128::from(self.saved_at_ms) * 1_000_000, u128::from)
    }
}

/// A recovered text, offered to the writer when its file is opened.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Entry {
    pub text: String,
    pub saved_at_ms: u64,
}

/// Another file with recovered text, mentioned on launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending {
    pub path: PathBuf,
    pub saved_at_ms: u64,
}

pub struct Recovery {
    dir: PathBuf,
    /// This run's prefix; mirror generations and deliberately kept entries extend it.
    session: String,
    kept: AtomicU64,
    /// One document is open at a time. Leaving it retires its mirror key without
    /// moving either journal file; future writes use a fresh generation.
    generation: AtomicU64,
}

fn now_ms() -> u64 {
    ms(SystemTime::now())
}

fn ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().try_into().unwrap_or(u64::MAX))
}

/// One entry on disk: `<file id>.<key>.md` plus `<file id>.<key>.json`.
struct Found {
    text_path: PathBuf,
    sidecar_path: PathBuf,
    key: String,
    sidecar: Sidecar,
}

impl Found {
    fn remove(&self) {
        let _ = fs::remove_file(&self.sidecar_path);
        let _ = fs::remove_file(&self.text_path);
    }
}

impl Recovery {
    pub fn new(dir: PathBuf) -> Self {
        static SESSIONS: AtomicU64 = AtomicU64::new(0);
        let session = format!(
            "{}-{}-{}",
            now_ms(),
            std::process::id(),
            SESSIONS.fetch_add(1, Ordering::Relaxed)
        );
        Recovery {
            dir,
            session,
            kept: AtomicU64::new(0),
            generation: AtomicU64::new(0),
        }
    }

    /// A stable name for a file's entries, from its canonical path.
    fn file_id(path: &Path) -> String {
        format!(
            "{:016x}",
            documents::content_hash(&platform::path_bytes(path))
        )
    }

    fn entry_paths(&self, path: &Path, key: &str) -> (PathBuf, PathBuf) {
        let stem = format!("{}.{key}", Self::file_id(path));
        (
            self.dir.join(format!("{stem}.md")),
            self.dir.join(format!("{stem}.json")),
        )
    }

    fn write_entry(
        &self,
        path: &Path,
        key: &str,
        text: &str,
        revision: u64,
        durable: bool,
    ) -> io::Result<()> {
        if text.len() > MAX_ENTRY_BYTES {
            return Err(io::Error::from(io::ErrorKind::FileTooLarge));
        }
        platform::create_private_dir(&self.dir)?;
        let (text_path, sidecar_path) = self.entry_paths(path, key);
        let now = SystemTime::now();
        let sidecar = Sidecar {
            path: path.to_path_buf(),
            revision,
            saved_at_ms: ms(now),
            saved_at_ns: now
                .duration_since(UNIX_EPOCH)
                .ok()
                .and_then(|duration| u64::try_from(duration.as_nanos()).ok()),
        };
        let json = serde_json::to_vec(&sidecar).map_err(io::Error::other)?;
        if durable {
            let private = platform::owner_only();
            documents::write_atomic(&text_path, text.as_bytes(), private.clone(), NO_FAULTS)?;
            documents::write_atomic(&sidecar_path, &json, private, NO_FAULTS)
        } else {
            platform::write_private(&text_path, text.as_bytes())?;
            platform::write_private(&sidecar_path, &json)
        }
    }

    fn mirror_key(&self) -> String {
        format!(
            "{}-m{}",
            self.session,
            self.generation.load(Ordering::Relaxed)
        )
    }

    /// Mirrors the text about to be saved. `durable` also fsyncs it, after a failed save.
    pub fn mirror(&self, path: &Path, text: &str, revision: u64, durable: bool) -> io::Result<()> {
        self.write_entry(path, &self.mirror_key(), text, revision, durable)
    }

    /// Removes this session's mirror after a clean save.
    pub fn clear_mirror(&self, path: &Path) {
        let (text_path, sidecar_path) = self.entry_paths(path, &self.mirror_key());
        let _ = fs::remove_file(sidecar_path);
        let _ = fs::remove_file(text_path);
    }

    /// Retires the open document's mirror so it is offered when the writer returns.
    /// Its completed files stay untouched: two renames could fail partway through,
    /// or fail on a read-only/full recovery volume and hide the only saved copy.
    pub fn retain_mirror(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    fn kept_key(&self) -> String {
        format!(
            "{}-k{}",
            self.session,
            self.kept.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// Keeps a text durably for later ("Load theirs" puts the writer's version here).
    /// It is offered the next time the file is opened.
    pub fn keep(&self, path: &Path, text: &str) -> io::Result<()> {
        self.write_entry(path, &self.kept_key(), text, 0, true)
    }

    fn entries(&self) -> Vec<Found> {
        let Ok(dir) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        dir.flatten()
            .map(|e| e.path())
            .filter_map(|sidecar_path| {
                let name = sidecar_path.file_name()?.to_str()?;
                let stem = name.strip_suffix(".json")?;
                let (_, key) = stem.split_once('.')?;
                let sidecar = serde_json::from_slice(&fs::read(&sidecar_path).ok()?).ok()?;
                Some(Found {
                    text_path: sidecar_path.with_extension("md"),
                    key: key.to_string(),
                    sidecar,
                    sidecar_path,
                })
            })
            .collect()
    }

    /// Entries for `path` left by earlier sessions or kept on purpose, newest first.
    fn earlier(&self, path: &Path) -> Vec<Found> {
        let current = self.mirror_key();
        let mut found: Vec<Found> = self
            .entries()
            .into_iter()
            .filter(|f| f.key != current && f.sidecar.path == path)
            .collect();
        found.sort_by_key(|f| std::cmp::Reverse(f.sidecar.timestamp_ns()));
        found
    }

    /// The newest earlier text for `path`, if it is newer than the file and differs
    /// from it. An entry identical to the file is removed: it was saved after all.
    pub fn offer(&self, path: &Path) -> Option<Entry> {
        let file_mtime = fs::metadata(path).and_then(|m| m.modified()).ok();
        let on_disk = documents::read(path)
            .ok()
            .map(|bytes| documents::decode(&bytes).text);
        for found in self.earlier(path) {
            let Ok(text) = fs::read_to_string(&found.text_path) else {
                continue;
            };
            if on_disk.as_deref() == Some(text.as_str()) {
                found.remove();
                continue;
            }
            if file_mtime.is_some_and(|modified| match found.sidecar.saved_at_ns {
                Some(saved) => modified
                    .duration_since(UNIX_EPOCH)
                    .is_ok_and(|time| time.as_nanos() >= u128::from(saved)),
                // Equal milliseconds cannot establish which legacy write came
                // first. Offer the differing text instead of hiding it.
                None => found.sidecar.saved_at_ms < ms(modified),
            }) {
                continue;
            }
            return Some(Entry {
                text,
                saved_at_ms: found.sidecar.saved_at_ms,
            });
        }
        None
    }

    /// The writer restored or discarded the offer: every earlier entry for `path` goes.
    pub fn settle(&self, path: &Path) {
        for found in self.earlier(path) {
            found.remove();
        }
    }

    /// A file, or a folder of files, was renamed in the library: its entries follow it,
    /// so recovered text is still offered under the new name. Times are kept.
    pub fn moved(&self, from: &Path, to: &Path) {
        for found in self.entries() {
            let Ok(rest) = found.sidecar.path.strip_prefix(from) else {
                continue;
            };
            let path = if rest.as_os_str().is_empty() {
                to.to_path_buf()
            } else {
                to.join(rest)
            };
            if path == found.sidecar.path {
                continue;
            }
            let (text_path, sidecar_path) = self.entry_paths(&path, &found.key);
            let sidecar = Sidecar {
                path,
                ..found.sidecar
            };
            let result = (|| {
                let json = serde_json::to_vec(&sidecar).map_err(io::Error::other)?;
                let text = fs::read(&found.text_path)?;
                let private = platform::owner_only();
                // Keep the old pair until both replacements are durable. Moving the
                // text first would orphan it if writing its new sidecar failed.
                documents::write_atomic(&text_path, &text, private.clone(), NO_FAULTS)?;
                documents::write_atomic(&sidecar_path, &json, private, NO_FAULTS)?;
                fs::remove_file(&found.sidecar_path)?;
                fs::remove_file(&found.text_path)
            })();
            if let Err(e) = result {
                eprintln!(
                    "bismillah: couldn't move recovered text with its file: {:?}",
                    e.kind()
                );
            }
        }
    }

    /// Other files with text waiting in recovery, newest first.
    pub fn pending(&self, except: Option<&Path>) -> Vec<Pending> {
        let current = self.mirror_key();
        let mut paths: Vec<PathBuf> = self
            .entries()
            .into_iter()
            .filter(|f| f.key != current && Some(f.sidecar.path.as_path()) != except)
            .map(|f| f.sidecar.path)
            .collect();
        paths.sort();
        paths.dedup();
        let mut out: Vec<Pending> = paths
            .into_iter()
            .filter_map(|path| {
                let entry = self.offer(&path)?;
                Some(Pending {
                    path,
                    saved_at_ms: entry.saved_at_ms,
                })
            })
            .collect();
        out.sort_by_key(|p| std::cmp::Reverse(p.saved_at_ms));
        out
    }

    /// Removes entries past the maximum age, then the oldest until the journal fits.
    pub fn prune(&self) {
        let now = now_ms();
        let max_age_ms = u64::try_from(MAX_AGE.as_millis()).unwrap_or(u64::MAX);
        let mut kept: Vec<(u128, u64, Found)> = Vec::new();
        for found in self.entries() {
            if now.saturating_sub(found.sidecar.saved_at_ms) > max_age_ms {
                found.remove();
                continue;
            }
            let size = fs::metadata(&found.text_path).map_or(0, |m| m.len());
            kept.push((found.sidecar.timestamp_ns(), size, found));
        }
        kept.sort_by_key(|k| std::cmp::Reverse(k.0));
        let mut total = 0u64;
        for (_, size, found) in kept {
            total += size;
            if total > MAX_TOTAL_BYTES {
                found.remove();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use std::os::unix::fs::PermissionsExt;

    fn age(path: &Path, seconds: i64) {
        let time = if seconds >= 0 {
            SystemTime::now() + Duration::from_secs(seconds.unsigned_abs())
        } else {
            SystemTime::now() - Duration::from_secs(seconds.unsigned_abs())
        };
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(time)
            .unwrap();
    }

    fn setup() -> (Scratch, PathBuf, PathBuf) {
        let scratch = Scratch::new();
        let dir = scratch.path().join("recovery");
        let file = scratch.file("letter.md", b"on disk\n");
        // Make the file clearly older than anything written to the journal.
        age(&file, -60);
        (scratch, dir, file)
    }

    fn set_time(found: &Found, milliseconds: u64, nanoseconds: Option<u64>) {
        let mut json: serde_json::Value =
            serde_json::from_slice(&fs::read(&found.sidecar_path).unwrap()).unwrap();
        json["saved_at_ms"] = serde_json::json!(milliseconds);
        if let Some(ns) = nanoseconds {
            json["saved_at_ns"] = serde_json::json!(ns);
        } else {
            json.as_object_mut().unwrap().remove("saved_at_ns");
        }
        fs::write(&found.sidecar_path, serde_json::to_vec(&json).unwrap()).unwrap();
    }

    #[test]
    fn same_millisecond_recovery_entries_offer_the_newest_text_after_restart() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir.clone());
        recovery.keep(&file, "one").unwrap();
        recovery.keep(&file, "two").unwrap();
        let found = recovery.entries();
        assert_eq!(found.len(), 2);
        let at = now_ms() + 1000;
        // Give the first directory entry the older precise timestamp. Directory
        // enumeration order must not decide which unsaved text is restored.
        fs::write(&found[0].text_path, "older local text").unwrap();
        fs::write(&found[1].text_path, "newer حَدِيث\n").unwrap();
        set_time(&found[0], at, Some(at * 1_000_000 + 100));
        set_time(&found[1], at, Some(at * 1_000_000 + 900));
        assert_eq!(
            Recovery::new(dir).offer(&file).map(|e| e.text),
            Some("newer حَدِيث\n".into())
        );
    }

    #[test]
    fn a_recovery_copy_newer_than_the_file_in_the_same_millisecond_is_not_hidden() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir);
        recovery.keep(&file, "protected text").unwrap();
        let at = now_ms();
        let modified = UNIX_EPOCH + Duration::from_millis(at) + Duration::from_nanos(500);
        fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), modified);
        let entry = recovery.entries().remove(0);
        set_time(&entry, at, Some(at * 1_000_000 + 900));
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("protected text".into())
        );
        set_time(&entry, at, Some(at * 1_000_000 + 100));
        assert_eq!(
            recovery.offer(&file),
            None,
            "an older copy stays suppressed"
        );
    }

    #[test]
    fn legacy_recovery_with_ambiguous_equal_milliseconds_remains_available() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir);
        recovery.keep(&file, "legacy text").unwrap();
        let at = now_ms();
        let modified = UNIX_EPOCH + Duration::from_millis(at) + Duration::from_nanos(500);
        fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        let entry = recovery.entries().remove(0);
        set_time(&entry, at, None);
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("legacy text".into())
        );
        set_time(&entry, at - 1, None);
        assert_eq!(recovery.offer(&file), None);
    }

    #[test]
    fn pruning_same_millisecond_entries_keeps_the_newest_copies() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir);
        for _ in 0..17 {
            recovery.keep(&file, "text").unwrap();
        }
        let found = recovery.entries();
        assert_eq!(found.len(), 17);
        let at = now_ms() + 1000;
        for (i, entry) in found.iter().enumerate() {
            // Sparse files exceed the total budget without allocating 272 MiB.
            fs::File::options()
                .write(true)
                .open(&entry.text_path)
                .unwrap()
                .set_len(MAX_ENTRY_BYTES as u64)
                .unwrap();
            set_time(entry, at, Some(at * 1_000_000 + i as u64));
        }
        recovery.prune();
        assert!(
            !found[0].text_path.exists(),
            "the oldest copy is pruned first"
        );
        assert!(found[16].text_path.exists(), "the newest copy survives");
        assert_eq!(recovery.entries().len(), 16);
    }

    #[test]
    fn offers_text_from_an_earlier_session_that_never_saved() {
        let (_s, dir, file) = setup();
        let crashed = Recovery::new(dir.clone());
        crashed.mirror(&file, "unsaved ḥadīth\n", 3, false).unwrap();
        // The crashed session's own mirror is not offered to itself...
        assert_eq!(crashed.offer(&file), None);
        // ...but the next session offers it.
        let next = Recovery::new(dir);
        assert_eq!(
            next.offer(&file).map(|e| e.text),
            Some("unsaved ḥadīth\n".into())
        );
        // Saving in the new session doesn't touch it; settling does.
        next.mirror(&file, "new session text\n", 1, false).unwrap();
        next.clear_mirror(&file);
        assert!(next.offer(&file).is_some());
        next.settle(&file);
        assert_eq!(next.offer(&file), None);
    }

    #[test]
    fn keeps_entries_private() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir.clone());
        recovery.mirror(&file, "private\n", 1, false).unwrap();
        recovery.keep(&file, "kept\n").unwrap();
        for entry in fs::read_dir(&dir).unwrap() {
            let mode = entry.unwrap().metadata().unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn a_clean_save_clears_the_mirror() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir.clone());
        recovery.mirror(&file, "text\n", 1, false).unwrap();
        recovery.clear_mirror(&file);
        assert!(fs::read_dir(&dir).unwrap().next().is_none());
    }

    #[test]
    fn a_failed_mirror_is_offered_again_after_switching_away_in_the_same_session() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir);
        recovery.mirror(&file, "never saved\n", 4, true).unwrap();
        assert_eq!(
            recovery.offer(&file),
            None,
            "still the open document's own mirror"
        );
        recovery.retain_mirror();
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("never saved\n".into())
        );
    }

    #[test]
    fn retaining_a_mirror_does_not_need_a_writable_journal() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir.clone());
        recovery.mirror(&file, "never saved\n", 4, true).unwrap();
        let names = || {
            let mut names: Vec<_> = fs::read_dir(&dir)
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .collect();
            names.sort();
            names
        };
        let before = names();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        recovery.retain_mirror();
        let after = names();
        let offered = recovery.offer(&file);
        let restarted = Recovery::new(dir.clone()).offer(&file);
        // Restore permission before assertions so Scratch can clean up on failure.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            before, after,
            "retention must leave both journal files in place"
        );
        assert_eq!(offered.map(|e| e.text), Some("never saved\n".into()));
        assert_eq!(restarted.map(|e| e.text), Some("never saved\n".into()));
    }

    #[test]
    fn new_mirrors_never_overwrite_or_clear_retired_text() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir);
        recovery.mirror(&file, "retained text\n", 4, true).unwrap();
        // Keys remain bounded even after many document switches.
        for _ in 0..1000 {
            recovery.retain_mirror();
        }
        recovery.mirror(&file, "current edits\n", 5, false).unwrap();
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("retained text\n".into())
        );
        assert_eq!(recovery.pending(None).len(), 1);
        recovery.clear_mirror(&file);
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("retained text\n".into())
        );
        recovery.settle(&file);
        assert_eq!(recovery.offer(&file), None);
    }

    #[test]
    fn kept_text_is_offered_when_the_file_is_next_opened() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir);
        recovery.keep(&file, "my version\n").unwrap();
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("my version\n".into())
        );
    }

    #[test]
    fn does_not_offer_text_the_file_already_has_or_that_is_older() {
        let (_s, dir, file) = setup();
        Recovery::new(dir.clone())
            .mirror(&file, "on disk\n", 1, false)
            .unwrap();
        let next = Recovery::new(dir.clone());
        assert_eq!(next.offer(&file), None, "same text as the file");
        assert!(
            fs::read_dir(&dir).unwrap().next().is_none(),
            "and it is removed"
        );

        Recovery::new(dir.clone())
            .mirror(&file, "older\n", 1, false)
            .unwrap();
        age(&file, 60);
        assert_eq!(
            Recovery::new(dir).offer(&file),
            None,
            "the file changed after it"
        );
    }

    #[test]
    fn offers_text_for_a_file_that_is_gone() {
        let (_s, dir, file) = setup();
        Recovery::new(dir.clone())
            .mirror(&file, "only copy\n", 1, true)
            .unwrap();
        fs::remove_file(&file).unwrap();
        let next = Recovery::new(dir);
        assert_eq!(
            next.offer(&file).map(|e| e.text),
            Some("only copy\n".into())
        );
    }

    #[test]
    fn lists_other_files_with_recovered_text() {
        let (scratch, dir, file) = setup();
        let other = scratch.file("other.md", b"x\n");
        age(&other, -60);
        let crashed = Recovery::new(dir.clone());
        crashed.mirror(&file, "a\n", 1, false).unwrap();
        crashed.mirror(&other, "b\n", 1, false).unwrap();
        let pending = Recovery::new(dir).pending(Some(&file));
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].path, other);
    }

    #[test]
    fn prunes_old_entries() {
        let (_s, dir, file) = setup();
        let recovery = Recovery::new(dir.clone());
        recovery.mirror(&file, "ancient\n", 1, false).unwrap();
        let (_, sidecar_path) = recovery.entry_paths(&file, &recovery.mirror_key());
        let stale = Sidecar {
            path: file.clone(),
            revision: 1,
            saved_at_ms: 1,
            saved_at_ns: None,
        };
        fs::write(&sidecar_path, serde_json::to_vec(&stale).unwrap()).unwrap();
        recovery.prune();
        assert!(fs::read_dir(&dir).unwrap().next().is_none());
    }

    #[test]
    fn recovered_text_follows_a_renamed_file_or_folder() {
        let (scratch, dir, file) = setup();
        Recovery::new(dir.clone())
            .mirror(&file, "unsaved\n", 2, true)
            .unwrap();
        let renamed = scratch.path().join("Letter to Ḥasan.md");
        fs::rename(&file, &renamed).unwrap();
        let next = Recovery::new(dir.clone());
        next.moved(&file, &renamed);
        assert_eq!(next.offer(&file), None);
        assert_eq!(
            next.offer(&renamed).map(|e| e.text),
            Some("unsaved\n".into())
        );

        let inside = scratch.path().join("old/inner.md");
        fs::create_dir(scratch.path().join("old")).unwrap();
        fs::write(&inside, b"disk\n").unwrap();
        age(&inside, -60);
        Recovery::new(dir.clone())
            .mirror(&inside, "inner unsaved\n", 1, true)
            .unwrap();
        fs::rename(scratch.path().join("old"), scratch.path().join("new")).unwrap();
        next.moved(&scratch.path().join("old"), &scratch.path().join("new"));
        assert_eq!(
            next.offer(&scratch.path().join("new/inner.md"))
                .map(|e| e.text),
            Some("inner unsaved\n".into())
        );
        for entry in fs::read_dir(&dir).unwrap() {
            let mode = entry.unwrap().metadata().unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "moved entries stay private");
        }
    }

    #[test]
    fn failed_recovery_move_preserves_the_original_pair_for_retry() {
        let (scratch, dir, file) = setup();
        let previous = Recovery::new(dir.clone());
        previous
            .mirror(&file, "unsaved ḥadīth — حَدِيث\n", 2, true)
            .unwrap();
        let renamed = scratch.path().join("renamed.md");
        fs::rename(&file, &renamed).unwrap();
        let next = Recovery::new(dir.clone());
        // Fail the metadata replacement after the text transfer completed.
        let (_, blocked) = next.entry_paths(&renamed, &previous.mirror_key());
        fs::create_dir(&blocked).unwrap();
        next.moved(&file, &renamed);
        let restarted = Recovery::new(dir);
        assert_eq!(
            restarted.offer(&file).map(|e| e.text),
            Some("unsaved ḥadīth — حَدِيث\n".into()),
            "a failed move must leave a discoverable original pair after restart"
        );
        fs::remove_dir(&blocked).unwrap();
        restarted.moved(&file, &renamed);
        assert_eq!(restarted.offer(&file), None);
        assert_eq!(
            restarted.offer(&renamed).map(|e| e.text),
            Some("unsaved ḥadīth — حَدِيث\n".into())
        );
    }

    #[test]
    fn refuses_oversized_entries() {
        let (_s, dir, file) = setup();
        let huge = "x".repeat(MAX_ENTRY_BYTES + 1);
        assert!(Recovery::new(dir).mirror(&file, &huge, 1, false).is_err());
    }
}
