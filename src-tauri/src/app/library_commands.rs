//! The library's state and commands (ARCHITECTURE.md §4, §6): choosing the folder,
//! listing it, keeping the listing current while other programs change it, and the file
//! actions (new folder, rename, move to trash and undo). Paths from the frontend are
//! relative to the library root and checked by `Library` before anything is touched.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::{AppState, DiskStatus, Opened, Source, lock, test_hooks_allowed};
use crate::documents::{self, OpenError};
use crate::images::{self, ImageError};
use crate::library::{Library, LibraryError, Node, Tree};
use crate::watch::{self, Watch};

/// The library as the app holds it.
pub enum Shelf {
    None,
    Ready {
        library: Library,
        tree: Tree,
        /// `None` if the platform refused to watch (then focus checks still apply).
        _watch: Option<Watch>,
    },
    /// The remembered folder is missing: a disk that isn't connected, a folder removed.
    Unavailable {
        path: PathBuf,
    },
}

/// An entry moved to the trash this session, so it can be put back.
#[derive(Clone)]
pub struct Trashed {
    path: PathBuf,
    /// When it was trashed, a little early: the trash records whole seconds.
    since_s: i64,
}

/// The library as the frontend sees it.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryView {
    None,
    Ready {
        /// Changes whenever a different folder becomes the library, so the panel starts
        /// afresh (no folders open, no focus) rather than carrying over the last one's.
        generation: u64,
        /// The folder's own name.
        name: String,
        nodes: Vec<Node>,
        truncated: bool,
        /// Recently opened files in the library, newest first (quick open).
        recent: Vec<String>,
        /// Where the open document is in the library; `None` outside it.
        active: Option<String>,
    },
    Unavailable {
        name: String,
    },
}

#[derive(Serialize)]
pub struct LibraryPanel {
    view: LibraryView,
    /// Whether the writer left the library shown.
    open: bool,
}

#[derive(Clone, Serialize)]
struct DocumentChanged {
    id: u64,
    status: DiskStatus,
}

/// The open document after a rename moved it.
#[derive(Serialize)]
pub struct DocumentMoved {
    name: String,
    library_path: Option<String>,
}

#[derive(Serialize)]
pub struct RenameOutcome {
    path: String,
    /// Set when the rename moved the open document.
    document: Option<DocumentMoved>,
}

#[derive(Serialize)]
pub struct TrashOutcome {
    /// Undoes the move with `library_untrash`.
    token: usize,
    name: String,
    /// The open document was (inside) what went to the trash, and is now closed.
    closed: bool,
}

fn now_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

fn open_error(e: LibraryError) -> OpenError {
    match e {
        // A path that isn't a plain path inside the library ("../x", "/etc/x") is an
        // attempt to leave it, like a link that leads outside.
        LibraryError::Outside | LibraryError::InvalidPath => OpenError::Outside,
        LibraryError::NotFound | LibraryError::Unavailable => OpenError::NotFound,
        LibraryError::PermissionDenied => OpenError::PermissionDenied,
        LibraryError::InvalidName { .. } => OpenError::NotAFile,
        other => OpenError::Other {
            detail: other.to_string(),
        },
    }
}

impl AppState {
    /// Makes `folder` the library: lists it, watches it and tells the frontend.
    pub(super) fn set_library(&self, folder: &Path) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let shelf = match Library::open(folder) {
            Ok(library) => {
                self.remember(|m| m.library = Some(library.root().to_path_buf()));
                match library.tree() {
                    Ok(tree) => {
                        let handle = self.handle.clone();
                        let watch = Watch::start(library.root(), watch::listed, move |paths| {
                            if let Some(state) = handle.try_state::<AppState>() {
                                state.disk_changed(generation, &paths);
                            }
                        })
                        .map_err(|e| eprintln!("bismillah: can't watch the library: {e:?}"))
                        .ok();
                        Shelf::Ready {
                            library,
                            tree,
                            _watch: watch,
                        }
                    }
                    Err(_) => Shelf::Unavailable {
                        path: library.root().to_path_buf(),
                    },
                }
            }
            Err(_) => Shelf::Unavailable {
                path: folder.to_path_buf(),
            },
        };
        *lock(&self.shelf) = shelf;
        self.announce();
    }

    /// The library remembered from the last run, if there was one.
    pub fn restore_library(&self) {
        if let Some(root) = self.memory().library {
            self.set_library(&root);
        }
    }

    fn view(&self) -> LibraryView {
        let recent = self.memory().recent;
        let open = self.current_path();
        match &*lock(&self.shelf) {
            Shelf::None => LibraryView::None,
            Shelf::Ready { library, tree, .. } => LibraryView::Ready {
                generation: self.generation.load(Ordering::SeqCst),
                name: library.name(),
                nodes: tree.nodes.clone(),
                truncated: tree.truncated,
                recent: recent.iter().filter_map(|p| library.relative(p)).collect(),
                active: open
                    .as_deref()
                    .and_then(|p| library.relative(p))
                    .filter(|r| !r.is_empty()),
            },
            Shelf::Unavailable { path } => LibraryView::Unavailable {
                name: documents::display_name(path),
            },
        }
    }

    fn announce(&self) {
        if let Err(e) = self.handle.emit("library-changed", self.view()) {
            eprintln!("bismillah: couldn't announce the library: {e}");
        }
    }

    /// The library, if it is available (a copy: it is only a path).
    pub(super) fn library(&self) -> Result<Library, LibraryError> {
        match &*lock(&self.shelf) {
            Shelf::Ready { library, .. } => Ok(library.clone()),
            _ => Err(LibraryError::Unavailable),
        }
    }

    /// A local image for live preview: `src` as the open document `id` writes it,
    /// resolved against that document and checked against the library (images.rs).
    pub fn image(&self, id: u64, src: &str) -> Result<(Vec<u8>, &'static str), ImageError> {
        let open = self.current(id).ok_or(ImageError::NotFound)?;
        let document = match &lock(&open).source {
            Source::File(doc) => doc.path.clone(),
            Source::Sample(_) => return Err(ImageError::NotFound),
        };
        let library = self.library().map_err(|_| ImageError::NotFound)?;
        images::read(&images::resolve(&library, &document, src)?)
    }

    /// Where `path` (canonical) is in the library; `None` outside it.
    pub(super) fn library_path_of(&self, path: &Path) -> Option<String> {
        match &*lock(&self.shelf) {
            Shelf::Ready { library, .. } => library.relative(path).filter(|r| !r.is_empty()),
            _ => None,
        }
    }

    /// Whether `path` may open with the current library (anything does when there's
    /// no library to belong to).
    pub(super) fn library_accepts(&self, path: &Path) -> bool {
        match &*lock(&self.shelf) {
            Shelf::Ready { library, .. } => library.contains(path),
            _ => true,
        }
    }

    pub(super) fn library_folder(&self, rel: &str) -> Option<PathBuf> {
        self.library().ok()?.folder(rel).ok()
    }

    /// Lists the library again and tells the frontend if anything changed. A library
    /// that has gone missing becomes unavailable.
    fn rescan(&self) {
        let mut shelf = lock(&self.shelf);
        let gone = match &mut *shelf {
            Shelf::Ready { library, tree, .. } => match library.tree() {
                Ok(new) if new == *tree => return,
                Ok(new) => {
                    *tree = new;
                    None
                }
                Err(_) => Some(library.root().to_path_buf()),
            },
            _ => return,
        };
        if let Some(path) = gone {
            *shelf = Shelf::Unavailable { path };
        }
        drop(shelf);
        self.announce();
    }

    /// Like `rescan`, and an unavailable library is tried again (window focus).
    fn refresh(&self) {
        let missing = match &*lock(&self.shelf) {
            Shelf::Unavailable { path } => Some(path.clone()),
            _ => None,
        };
        match missing {
            Some(path) if path.is_dir() => self.set_library(&path),
            Some(_) => {}
            None => self.rescan(),
        }
    }

    /// The watcher saw changes (ARCHITECTURE.md §5.4): the listing is brought up to
    /// date, and if the open file changed on disk the frontend is told, exactly as when
    /// the window regains focus. Our own saves leave the file as we last wrote it, so
    /// they are never reported.
    fn disk_changed(&self, generation: u64, paths: &[PathBuf]) {
        if generation != self.generation.load(Ordering::SeqCst) {
            return;
        }
        self.rescan();
        let Some(open) = lock(&self.document).clone() else {
            return;
        };
        let mut open = lock(&open);
        let id = open.id;
        let Source::File(doc) = &mut open.source else {
            return;
        };
        if !paths.iter().any(|p| doc.path.starts_with(p)) {
            return;
        }
        let status = match documents::check_disk(doc) {
            documents::DiskCheck::Unchanged => return,
            documents::DiskCheck::Changed => DiskStatus::Changed,
            documents::DiskCheck::Removed => DiskStatus::Removed,
        };
        drop(open);
        if let Err(e) = self
            .handle
            .emit("document-changed", DocumentChanged { id, status })
        {
            eprintln!("bismillah: couldn't announce a changed file: {e}");
        }
    }

    /// After a rename: the open document follows if it was the entry or inside it.
    fn follow_rename(&self, from: &Path, to: &Path) -> Option<DocumentMoved> {
        let open = lock(&self.document).clone()?;
        let mut open = lock(&open);
        let Source::File(doc) = &mut open.source else {
            return None;
        };
        let rest = doc.path.strip_prefix(from).ok()?.to_path_buf();
        doc.path = if rest.as_os_str().is_empty() {
            to.to_path_buf()
        } else {
            to.join(rest)
        };
        let (name, path) = (doc.name(), doc.path.clone());
        drop(open);
        Some(DocumentMoved {
            name,
            library_path: self.library_path_of(&path),
        })
    }

    /// After a move to the trash: the open document closes if it went too.
    fn close_if_inside(&self, path: &Path) -> bool {
        let mut document = lock(&self.document);
        let inside = document
            .as_ref()
            .is_some_and(|open| match &lock(open).source {
                Source::File(doc) => doc.path.starts_with(path),
                Source::Sample(_) => false,
            });
        if inside {
            *document = None;
        }
        inside
    }
}

/// The library for the panel. With `refresh`, it is listed again first (window focus,
/// or the writer asked to try an unavailable folder again).
#[tauri::command]
pub fn library_get(state: State<'_, AppState>, refresh: bool) -> LibraryPanel {
    if refresh {
        state.refresh();
    }
    LibraryPanel {
        view: state.view(),
        open: state.memory().library_open,
    }
}

/// Remembers whether the writer left the library shown.
#[tauri::command]
pub fn library_remember_open(state: State<'_, AppState>, open: bool) {
    state.remember(|m| m.library_open = open);
}

/// File › Open folder…: the native folder dialog; the chosen folder becomes the
/// library. `None` if cancelled.
#[tauri::command]
pub async fn library_open_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<LibraryView>, LibraryError> {
    let chosen = match state.dialog_answer() {
        Some(answer) => answer,
        None => {
            let mut dialog = app.dialog().file().set_title("Open folder");
            if let Ok(library) = state.library()
                && let Some(parent) = library.root().parent()
            {
                dialog = dialog.set_directory(parent);
            }
            dialog
                .blocking_pick_folder()
                .and_then(|chosen| chosen.into_path().ok())
        }
    };
    let Some(folder) = chosen else {
        return Ok(None);
    };
    state.set_library(&folder);
    state.remember(|m| m.library_open = true);
    Ok(Some(state.view()))
}

/// Opens a document from the library by its relative path.
#[tauri::command]
pub async fn library_open_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<Opened, OpenError> {
    let real = state
        .library()
        .and_then(|library| library.resolve(&path))
        .map_err(open_error)?;
    if !real.is_file() {
        return Err(OpenError::NotAFile);
    }
    state.open_path(&real)
}

/// Creates a folder inside the library folder `parent` ("" for the top). Returns its
/// relative path.
#[tauri::command]
pub async fn library_new_folder(
    state: State<'_, AppState>,
    parent: String,
    name: String,
) -> Result<String, LibraryError> {
    let created = state.library()?.create_folder(&parent, &name)?;
    state.rescan();
    Ok(created)
}

/// Renames a library entry in place, never replacing anything. The open document,
/// recovered text and remembered files follow it. The frontend saves the open document
/// first and doesn't ask while its changes aren't on disk.
#[tauri::command]
pub async fn library_rename(
    state: State<'_, AppState>,
    path: String,
    name: String,
) -> Result<RenameOutcome, LibraryError> {
    let renamed = state.library()?.rename(&path, &name)?;
    let document = state.follow_rename(&renamed.from, &renamed.to);
    state.recovery.moved(&renamed.from, &renamed.to);
    state.remember(|m| m.moved(&renamed.from, &renamed.to));
    state.rescan();
    Ok(RenameOutcome {
        path: renamed.path,
        document,
    })
}

/// Moves a library entry to the system trash. If the open document went with it, it
/// closes. The frontend saves the open document first.
#[tauri::command]
pub async fn library_trash(
    state: State<'_, AppState>,
    path: String,
) -> Result<TrashOutcome, LibraryError> {
    let library = state.library()?;
    let since_s = now_s() - 2;
    let trashed = library.trash(&path, &*state.trash)?;
    let closed = state.close_if_inside(&trashed);
    let token = {
        let mut list = lock(&state.trashed);
        list.push(Trashed {
            path: trashed.clone(),
            since_s,
        });
        list.len() - 1
    };
    state.rescan();
    Ok(TrashOutcome {
        token,
        name: documents::display_name(&trashed),
        closed,
    })
}

/// Undo for "Move to trash": puts the entry back where it was, unless something new
/// took its name. Returns its relative path in the library.
#[tauri::command]
pub async fn library_untrash(
    state: State<'_, AppState>,
    token: usize,
) -> Result<Option<String>, LibraryError> {
    let item = lock(&state.trashed)
        .get(token)
        .cloned()
        .ok_or(LibraryError::NotFound)?;
    state.trash.restore(&item.path, item.since_s)?;
    state.rescan();
    Ok(state.library_path_of(&item.path))
}

/// Test mode only: makes `path` the library, standing in for the folder dialog.
#[tauri::command]
pub fn test_library(state: State<'_, AppState>, path: PathBuf) -> Result<LibraryView, OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    state.set_library(&path);
    Ok(state.view())
}
