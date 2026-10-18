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
    /// Whether the writer left the library shown.
    #[serde(default)]
    pub library_open: bool,
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

    pub fn save(&self, path: &Path) {
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;

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
            library_open: true,
            recent: vec!["/home/writer/letter.md".into()],
        };
        state.save(&path);
        assert_eq!(State::load(&path), state);
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(State::load(&path), State::default());
        // A file from before the library existed still loads.
        fs::write(&path, br#"{"last_document":"/a.md"}"#).unwrap();
        assert_eq!(State::load(&path).last_document, Some("/a.md".into()));
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
