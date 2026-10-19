//! The configuration folder (`$XDG_CONFIG_HOME/bismillah/`): which of its files
//! changed, and how its folders are named to the writer (ARCHITECTURE.md §9).
//!
//! The folder is watched like the library (watch.rs): a theme, a shortcut or a setting
//! edited in another program applies as soon as it is saved, without polling.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// What changed in the configuration folder, sent with `config-changed`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Changed {
    pub settings: bool,
    pub keybindings: bool,
    pub themes: bool,
    pub dictionary: bool,
}

impl Changed {
    pub fn any(&self) -> bool {
        self.settings || self.keybindings || self.themes || self.dictionary
    }
}

/// Sorts the paths of a settled burst of changes by the file they belong to.
pub fn classify(root: &Path, paths: &[PathBuf]) -> Changed {
    let mut changed = Changed::default();
    for path in paths {
        let Ok(rest) = path.strip_prefix(root) else {
            continue;
        };
        let mut parts = rest.iter();
        match parts.next().and_then(|p| p.to_str()) {
            Some("settings.toml") => changed.settings = true,
            Some("keybindings.toml") => changed.keybindings = true,
            Some("dictionary.txt") => changed.dictionary = true,
            Some("themes") => changed.themes = true,
            _ => {}
        }
    }
    changed
}

/// A folder as the writer reads it: their home folder as `~`.
pub fn display(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|h| path.strip_prefix(h).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".into(),
        Some(rest) => format!("~/{}", rest.display()),
        None => path.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_changes_by_file() {
        let root = Path::new("/c/bismillah");
        let changed = classify(
            root,
            &[
                root.join("themes/sepia.toml"),
                root.join("keybindings.toml"),
                root.join("notes.txt"),
                PathBuf::from("/elsewhere/settings.toml"),
            ],
        );
        assert_eq!(
            changed,
            Changed {
                settings: false,
                keybindings: true,
                themes: true,
                dictionary: false,
            }
        );
        assert!(classify(root, &[root.join("themes")]).themes);
        assert!(!classify(root, &[root.join("other.toml")]).any());
    }

    #[test]
    fn names_folders_from_home() {
        let home = Path::new("/home/writer");
        assert_eq!(
            display(&home.join(".config/bismillah"), Some(home)),
            "~/.config/bismillah"
        );
        assert_eq!(display(home, Some(home)), "~");
        assert_eq!(display(Path::new("/srv/x"), Some(home)), "/srv/x");
        assert_eq!(display(Path::new("/srv/x"), None), "/srv/x");
    }
}
