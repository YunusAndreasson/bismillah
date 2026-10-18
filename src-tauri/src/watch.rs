//! Watching the library for changes other programs make (ARCHITECTURE.md §5.4, §6).
//!
//! `notify` uses the platform's change notifications (inotify on Linux), and the thread
//! that settles them blocks until something happens, so an idle library costs nothing:
//! no polling (ARCHITECTURE.md §14). Bursts of events, like the several a single save
//! makes, are gathered until the folder has been quiet for a moment and reported once.

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// How long the folder must be quiet before a burst of changes is reported.
const QUIET: Duration = Duration::from_millis(150);

/// Our own save temporaries (documents.rs) come and go with every save.
const SAVE_TEMPORARY: &str = ".bismillah-save-";

/// Watches until dropped.
pub struct Watch {
    _watcher: RecommendedWatcher,
}

/// Whether a changed path is one the library shows: inside the root and not hidden
/// (hidden names, like `.git` or our save temporaries, aren't listed).
fn relevant(root: &Path, path: &Path) -> bool {
    let Ok(rest) = path.strip_prefix(root) else {
        return false;
    };
    !rest.iter().any(|name| {
        let name = name.to_string_lossy();
        name.starts_with('.') || name.contains(SAVE_TEMPORARY)
    })
}

impl Watch {
    /// Watches `root` and everything below it. `changed` gets the paths touched by each
    /// settled burst of changes, on a thread of its own.
    pub fn start(
        root: &Path,
        changed: impl Fn(Vec<PathBuf>) + Send + 'static,
    ) -> notify::Result<Watch> {
        let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
        let handler = move |event: notify::Result<Event>| {
            if let Ok(event) = event {
                let _ = tx.send(event.paths);
            }
        };
        // Links are listed but not followed: a link to a folder outside the library
        // must not make us watch that folder.
        let mut watcher =
            RecommendedWatcher::new(handler, Config::default().with_follow_symlinks(false))?;
        watcher.watch(root, RecursiveMode::Recursive)?;
        let root = root.to_path_buf();
        std::thread::spawn(move || {
            // Ends when the watcher is dropped, which drops the sender.
            while let Ok(first) = rx.recv() {
                let mut paths = first;
                while let Ok(more) = rx.recv_timeout(QUIET) {
                    paths.extend(more);
                }
                paths.retain(|p| relevant(&root, p));
                paths.sort();
                paths.dedup();
                if !paths.is_empty() {
                    changed(paths);
                }
            }
        });
        Ok(Watch { _watcher: watcher })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use std::fs;

    #[test]
    fn ignores_hidden_names_and_save_temporaries() {
        let root = Path::new("/lib");
        assert!(relevant(root, Path::new("/lib/a.md")));
        assert!(relevant(root, Path::new("/lib/essays/ʿilm.md")));
        assert!(!relevant(root, Path::new("/lib/.git/index")));
        assert!(!relevant(root, Path::new("/lib/.a.md.bismillah-save-1-0")));
        assert!(!relevant(root, Path::new("/elsewhere/a.md")));
    }

    #[test]
    fn reports_a_settled_burst_of_changes_once() {
        let scratch = Scratch::new();
        let root = fs::canonicalize(scratch.path()).unwrap();
        let (tx, rx) = mpsc::channel();
        let watch = Watch::start(&root, move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        fs::write(root.join(".hidden"), "x").unwrap();
        fs::write(root.join("new.md"), "a").unwrap();
        fs::write(root.join("new.md"), "ab").unwrap();
        let mut seen = Vec::new();
        while let Ok(paths) = rx.recv_timeout(Duration::from_secs(5)) {
            seen.extend(paths);
            if seen.contains(&root.join("new.md")) {
                break;
            }
        }
        assert!(seen.contains(&root.join("new.md")), "{seen:?}");
        assert!(!seen.iter().any(|p| p.ends_with(".hidden")));
        drop(watch);
    }
}
