//! The recovery journal (ARCHITECTURE.md §5.7).
//!
//! Before every save, the text being saved is mirrored to `<data>/recovery/`, with a
//! small JSON sidecar naming the file it belongs to. A clean save removes the mirror; a
//! failed save makes it durable. So a failed save, a refused save (conflict) or a process
//! killed in the middle of saving always leaves the writer's text here.
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
    /// This run's key; entries with any other key come from earlier sessions.
    session: String,
    kept: AtomicU64,
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
        }
    }

    /// The folder the journal keeps its entries in (Settings › Files & privacy).
    pub fn dir(&self) -> &Path {
        &self.dir
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
        let sidecar = Sidecar {
            path: path.to_path_buf(),
            revision,
            saved_at_ms: now_ms(),
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

    /// Mirrors the text about to be saved. `durable` also fsyncs it, after a failed save.
    pub fn mirror(&self, path: &Path, text: &str, revision: u64, durable: bool) -> io::Result<()> {
        self.write_entry(path, &self.session, text, revision, durable)
    }

    /// Removes this session's mirror after a clean save.
    pub fn clear_mirror(&self, path: &Path) {
        let (text_path, sidecar_path) = self.entry_paths(path, &self.session);
        let _ = fs::remove_file(sidecar_path);
        let _ = fs::remove_file(text_path);
    }

    /// Turns this session's mirror for `path`, if any, into a kept entry: the writer is
    /// leaving a document whose last save failed, and its text must be offered when
    /// they come back to it, even in this session.
    pub fn retain_mirror(&self, path: &Path) {
        let (text_path, sidecar_path) = self.entry_paths(path, &self.session);
        if !sidecar_path.exists() {
            return;
        }
        let key = self.kept_key();
        let (kept_text, kept_sidecar) = self.entry_paths(path, &key);
        let moved = fs::rename(&text_path, kept_text)
            .and_then(|()| fs::rename(&sidecar_path, kept_sidecar));
        if let Err(e) = moved {
            eprintln!("bismillah: couldn't keep recovered text: {:?}", e.kind());
        }
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
        let mut found: Vec<Found> = self
            .entries()
            .into_iter()
            .filter(|f| f.key != self.session && f.sidecar.path == path)
            .collect();
        found.sort_by_key(|f| std::cmp::Reverse(f.sidecar.saved_at_ms));
        found
    }

    /// The newest earlier text for `path`, if it is newer than the file and differs
    /// from it. An entry identical to the file is removed: it was saved after all.
    pub fn offer(&self, path: &Path) -> Option<Entry> {
        let file_mtime = fs::metadata(path).and_then(|m| m.modified()).ok().map(ms);
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
            if file_mtime.is_some_and(|m| found.sidecar.saved_at_ms <= m) {
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
            let (text_path, sidecar_path) = self.entry_paths(&path, &found.key);
            let sidecar = Sidecar {
                path,
                ..found.sidecar
            };
            let result = (|| {
                let json = serde_json::to_vec(&sidecar).map_err(io::Error::other)?;
                fs::rename(&found.text_path, &text_path)?;
                documents::write_atomic(&sidecar_path, &json, platform::owner_only(), NO_FAULTS)?;
                fs::remove_file(&found.sidecar_path)
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
        let mut paths: Vec<PathBuf> = self
            .entries()
            .into_iter()
            .filter(|f| f.key != self.session && Some(f.sidecar.path.as_path()) != except)
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
        let mut kept: Vec<(u64, u64, Found)> = Vec::new();
        for found in self.entries() {
            if now.saturating_sub(found.sidecar.saved_at_ms) > max_age_ms {
                found.remove();
                continue;
            }
            let size = fs::metadata(&found.text_path).map_or(0, |m| m.len());
            kept.push((found.sidecar.saved_at_ms, size, found));
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
        recovery.retain_mirror(&file);
        assert_eq!(
            recovery.offer(&file).map(|e| e.text),
            Some("never saved\n".into())
        );
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
        let (_, sidecar_path) = recovery.entry_paths(&file, &recovery.session);
        let stale = Sidecar {
            path: file.clone(),
            revision: 1,
            saved_at_ms: 1,
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
    fn refuses_oversized_entries() {
        let (_s, dir, file) = setup();
        let huge = "x".repeat(MAX_ENTRY_BYTES + 1);
        assert!(Recovery::new(dir).mirror(&file, &huge, 1, false).is_err());
    }
}
