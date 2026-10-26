//! What bismillah remembers between runs that isn't a setting: the last document, the
//! library folder, whether the library is shown, recently opened files and the window's
//! size (ARCHITECTURE.md §12.2). Kept in `<data>/state.json`; losing it costs nothing but
//! convenience, so read errors fall back to empty.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::documents::{self, NO_FAULTS};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    /// Logical (CSS) pixels, so the size survives a change of display scale.
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

/// How many recently opened files are remembered (quick open lists them first).
const RECENT: usize = 20;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    #[serde(default)]
    pub last_document: Option<PathBuf>,
    #[serde(default)]
    pub window: Option<WindowState>,
    /// The library folder, canonicalised.
    #[serde(default)]
    pub library: Option<PathBuf>,
    /// Recently opened files, newest first.
    #[serde(default)]
    pub recent: Vec<PathBuf>,
}

impl State {
    /// Records an opened file as the last document and the most recent one.
    pub fn opened(&mut self, path: &Path) {
        self.last_document = Some(path.to_path_buf());
        self.recent.retain(|p| p != path);
        self.recent.insert(0, path.to_path_buf());
        self.recent.truncate(RECENT);
    }

    /// A file or folder was renamed or moved: remembered paths below it follow.
    pub fn moved(&mut self, from: &Path, to: &Path) {
        let follow = |p: &mut PathBuf| {
            if let Ok(rest) = p.strip_prefix(from) {
                *p = if rest.as_os_str().is_empty() {
                    to.to_path_buf()
                } else {
                    to.join(rest)
                };
            }
        };
        if let Some(last) = &mut self.last_document {
            follow(last);
        }
        self.recent.iter_mut().for_each(follow);
    }

    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> bool {
        let result = (|| {
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir)?;
            }
            let json = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
            documents::write_atomic(path, &json, None, NO_FAULTS)
        })();
        if let Err(e) = result {
            eprintln!(
                "bismillah: couldn't remember the window state: {:?}",
                e.kind()
            );
            return false;
        }
        true
    }
}

/// Remembered metadata, with the last successfully written snapshot. Opening the
/// same document/library at launch needn't fsync identical state again. A failed
/// write remains pending and is retried even if the next change is a no-op.
pub struct Store {
    value: State,
    saved: Option<State>,
    path: PathBuf,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let value = State::load(&path);
        Self {
            saved: Some(value.clone()),
            value,
            path,
        }
    }

    pub fn snapshot(&self) -> State {
        self.value.clone()
    }

    pub fn change(&mut self, change: impl FnOnce(&mut State)) {
        change(&mut self.value);
        if self.saved.as_ref() != Some(&self.value) {
            // Failure may happen after rename (directory fsync). No snapshot can
            // then stand for the disk, even if the next change restores an old value.
            self.saved = self.value.save(&self.path).then(|| self.value.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;

    #[test]
    fn skips_identical_state_but_persists_real_changes() {
        let scratch = Scratch::new();
        let path = scratch.path().join("state.json");
        let mut store = Store::load(path.clone());
        store.change(|m| m.opened(Path::new("/lib/a.md")));
        let timestamp = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(10);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(timestamp)
            .unwrap();
        store.change(|m| m.opened(Path::new("/lib/a.md")));
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), timestamp);
        store.change(|m| m.opened(Path::new("/lib/b.md")));
        assert_eq!(State::load(&path), store.snapshot());
        assert_eq!(State::load(&path).last_document, Some("/lib/b.md".into()));
    }

    #[test]
    fn retries_a_failed_state_write_even_when_the_next_change_is_identical() {
        let scratch = Scratch::new();
        let parent = scratch.file("data", b"not a directory");
        let path = parent.join("state.json");
        let mut store = Store::load(path.clone());
        store.change(|m| m.opened(Path::new("/lib/a.md")));
        assert!(!path.exists());
        assert_eq!(store.snapshot().last_document, Some("/lib/a.md".into()));
        fs::remove_file(&parent).unwrap();
        fs::create_dir(&parent).unwrap();
        store.change(|m| m.opened(Path::new("/lib/a.md")));
        assert_eq!(State::load(&path), store.snapshot());
    }

    #[test]
    fn a_failed_write_invalidates_the_previous_snapshot_too() {
        let scratch = Scratch::new();
        let parent = scratch.file("data", b"not a directory");
        let path = parent.join("state.json");
        let mut store = Store::load(path.clone());
        store.change(|m| m.opened(Path::new("/lib/a.md")));
        fs::remove_file(&parent).unwrap();
        fs::create_dir(&parent).unwrap();
        store.change(|m| *m = State::default());
        assert!(
            path.is_file(),
            "reverting to the initial state must still retry"
        );
        assert_eq!(State::load(&path), State::default());
    }

    #[test]
    fn round_trips_and_tolerates_a_damaged_file() {
        let scratch = Scratch::new();
        let path = scratch.path().join("data/state.json");
        assert_eq!(State::load(&path), State::default());
        let state = State {
            last_document: Some("/home/writer/letter.md".into()),
            window: Some(WindowState {
                width: 1100.0,
                height: 800.0,
                maximized: false,
            }),
            library: Some("/home/writer".into()),
            recent: vec!["/home/writer/letter.md".into()],
        };
        state.save(&path);
        assert_eq!(State::load(&path), state);
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(State::load(&path), State::default());
        // A file from before the library existed still loads.
        fs::write(&path, br#"{"last_document":"/a.md"}"#).unwrap();
        assert_eq!(State::load(&path).last_document, Some("/a.md".into()));
        // So does one from when the library could be docked (ADR-0016).
        fs::write(&path, br#"{"library":"/lib","library_open":true}"#).unwrap();
        assert_eq!(State::load(&path).library, Some("/lib".into()));
    }

    #[test]
    fn remembers_recent_files_and_follows_renames() {
        let mut state = State::default();
        for name in ["a", "b", "a"] {
            state.opened(Path::new(&format!("/lib/essays/{name}.md")));
        }
        assert_eq!(
            state.recent,
            [PathBuf::from("/lib/essays/a.md"), "/lib/essays/b.md".into()]
        );
        state.moved(Path::new("/lib/essays"), Path::new("/lib/مقالات"));
        assert_eq!(state.last_document, Some("/lib/مقالات/a.md".into()));
        assert_eq!(state.recent[1], PathBuf::from("/lib/مقالات/b.md"));
        for i in 0..30 {
            state.opened(Path::new(&format!("/{i}.md")));
        }
        assert_eq!(state.recent.len(), RECENT);
    }
}
