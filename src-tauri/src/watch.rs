//! Watching the library for changes other programs make (ARCHITECTURE.md §5.4, §6).
//!
//! `notify` uses the platform's change notifications (inotify on Linux), and the thread
//! that settles them blocks until something happens, so an idle library costs nothing:
//! no polling (ARCHITECTURE.md §14). Bursts of events, like the several a single save
//! makes, are gathered until the folder has been quiet for a moment and reported once.

use crate::library;
use notify::event::{AccessKind, AccessMode};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
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

/// Whether a changed path is visible: inside the root and not hidden (`.git`, our save
/// temporaries). The configuration folder's watch reports these.
pub fn visible(root: &Path, path: &Path) -> bool {
    let Ok(rest) = path.strip_prefix(root) else {
        return false;
    };
    !rest.iter().any(|name| {
        let name = name.to_string_lossy();
        name.starts_with('.') || name.contains(SAVE_TEMPORARY)
    })
}

/// Whether a changed path can change what the library lists: visible, and a Markdown
/// file or a folder. Other files are never listed, so a build or an install writing
/// thousands of them in a library folder costs no listing (ARCHITECTURE.md §14). A path
/// that is gone counts when its name has no ending, as a folder's usually hasn't.
pub fn listed(root: &Path, path: &Path) -> bool {
    if !visible(root, path) {
        return false;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    if library::is_markdown(&name) {
        return true;
    }
    match std::fs::symlink_metadata(path) {
        Ok(meta) => meta.is_dir() || meta.file_type().is_symlink(),
        Err(_) => path.extension().is_none(),
    }
}

/// Whether an event changed something. Reading isn't changing: `notify` also reports a
/// file or folder being opened and closed unwritten, and the library's own listing
/// opens every folder, so counting those would make each listing set off the next,
/// for as long as the library is open. A file closed after writing is a change.
fn changes(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        _ => true,
    }
}

impl Watch {
    /// Watches `root` and everything below it. `changed` gets the paths touched by each
    /// settled burst of changes that `wanted` keeps (`visible` or `listed`), on a thread
    /// of its own.
    pub fn start(
        root: &Path,
        wanted: fn(&Path, &Path) -> bool,
        changed: impl Fn(Vec<PathBuf>) + Send + 'static,
    ) -> notify::Result<Watch> {
        let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
        let handler = move |event: notify::Result<Event>| {
            if let Ok(event) = event
                && changes(&event.kind)
            {
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
                paths.retain(|p| wanted(&root, p));
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
        for wanted in [visible, listed] {
            assert!(wanted(root, Path::new("/lib/a.md")));
            assert!(wanted(root, Path::new("/lib/essays/ʿilm.md")));
            assert!(!wanted(root, Path::new("/lib/.git/index")));
            assert!(!wanted(root, Path::new("/lib/.a.md.bismillah-save-1-0")));
            assert!(!wanted(root, Path::new("/elsewhere/a.md")));
        }
        // The configuration folder's files are visible.
        assert!(visible(root, Path::new("/lib/settings.toml")));
    }

    #[test]
    fn ignores_files_the_library_never_lists() {
        let scratch = Scratch::new();
        let root = scratch.path();
        fs::create_dir(root.join("essays")).unwrap();
        let other = scratch.file("build.o", b"x");
        assert!(listed(root, &root.join("essays")));
        assert!(listed(root, &root.join("Notes.MARKDOWN")));
        assert!(!listed(root, &other));
        assert!(!listed(root, &root.join("node_modules/pkg/index.js")));
        // Gone: a folder's name, or a file's.
        assert!(listed(root, &root.join("old-folder")));
        assert!(!listed(root, &root.join("old.rlib")));
    }

    #[test]
    fn counts_writes_and_never_reads() {
        use notify::event::{CreateKind, ModifyKind};
        assert!(changes(&EventKind::Create(CreateKind::File)));
        assert!(changes(&EventKind::Modify(ModifyKind::Any)));
        assert!(changes(&EventKind::Access(AccessKind::Close(
            AccessMode::Write
        ))));
        assert!(!changes(&EventKind::Access(AccessKind::Open(
            AccessMode::Any
        ))));
        assert!(!changes(&EventKind::Access(AccessKind::Close(
            AccessMode::Read
        ))));
        assert!(!changes(&EventKind::Access(AccessKind::Read)));
    }

    #[test]
    fn listing_the_library_sets_off_nothing() {
        let scratch = Scratch::new();
        let root = fs::canonicalize(scratch.path()).unwrap();
        fs::create_dir_all(root.join("essays/drafts")).unwrap();
        fs::write(root.join("essays/a.md"), "a").unwrap();
        let (tx, rx) = mpsc::channel();
        let watch = Watch::start(&root, listed, move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        // Reading every folder and file, as a listing and an open do.
        let library = crate::library::Library::open(&root).unwrap();
        library.tree().unwrap();
        fs::read_to_string(root.join("essays/a.md")).unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "reading the library reported a change"
        );
        // A write still does.
        fs::write(root.join("essays/b.md"), "b").unwrap();
        let seen = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("a write is reported");
        assert!(seen.contains(&root.join("essays/b.md")), "{seen:?}");
        drop(watch);
    }

    #[test]
    fn reports_a_settled_burst_of_changes_once() {
        let scratch = Scratch::new();
        let root = fs::canonicalize(scratch.path()).unwrap();
        let (tx, rx) = mpsc::channel();
        let watch = Watch::start(&root, listed, move |paths| {
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
