//! What bismillah remembers between runs that isn't a setting: the last document and
//! the window's size (ARCHITECTURE.md §12.2). Kept in `<data>/state.json`; losing it
//! costs nothing but convenience, so read errors fall back to empty.

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

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    #[serde(default)]
    pub last_document: Option<PathBuf>,
    #[serde(default)]
    pub window: Option<WindowState>,
}

impl State {
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
        };
        state.save(&path);
        assert_eq!(State::load(&path), state);
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(State::load(&path), State::default());
    }
}
