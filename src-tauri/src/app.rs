//! The app's state and the commands the frontend may call (ARCHITECTURE.md §4).
//!
//! The frontend never names a path: files come from the command line, a native dialog,
//! a drop on the window or a second launch, and the frontend refers to the open document
//! by id. Inside the library it names entries by their path relative to the library
//! root, which Rust validates (library.rs). Rust decides what is read and written
//! (AGENTS.md, "The writer's trust" rule 5).

mod library_commands;
pub use library_commands::*;

use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::config;
use crate::documents::{self, Document, LineEnding, NO_FAULTS, OpenError, SaveError};
use crate::keybindings::{self, Keybindings};
use crate::library::Trash;
use crate::links::{self, LinkError};
use crate::lint::{AddWordError, Checking, LintError};
use crate::platform;
use crate::recovery::{self, Recovery};
use crate::settings::{self, SetError};
use crate::state;
use crate::themes::{self, Themes};
use library_commands::{Shelf, Trashed};

/// The bundled specimen, opened as a sample (never saved) in test mode.
const SPECIMEN: &str = include_str!("../../docs/specimen.md");

/// The guide (Help › Guide), opened as a sample: edits stay in memory.
const GUIDE: &str = include_str!("../../docs/guide.md");

/// Locks a mutex even if a panic poisoned it: the data is still the best we have, and
/// refusing to save the writer's text over a poisoned lock would be worse.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

enum Source {
    File(Document),
    /// A document bundled with the app (the guide, or the specimen in test mode), by
    /// its file name; edits stay in memory and are never saved.
    Sample(&'static str),
}

struct Open {
    id: u64,
    source: Source,
}

pub struct AppState {
    pub test_mode: bool,
    handle: AppHandle,
    document: Mutex<Option<Arc<Mutex<Open>>>>,
    next_id: AtomicU64,
    /// A file waiting to be opened: from the command line, a second launch or a drop.
    requested: Mutex<Option<PathBuf>>,
    /// Files with recovered text, by the token the frontend uses to open them.
    recovered: Mutex<Vec<PathBuf>>,
    recovery: Arc<Recovery>,
    settings: Mutex<settings::Store>,
    memory: Mutex<state::Store>,
    /// Test mode only: a failure injected into every save until cleared.
    fault: Arc<Mutex<Option<TestFault>>>,
    /// Test mode only: what the next native file dialog answers, without showing it.
    dialog_answer: Mutex<Option<Option<PathBuf>>>,
    /// Test mode: links and folders handed to other apps, recorded instead of opened.
    handed: Mutex<Vec<String>>,
    /// The library folder, its listing and its watcher (library_commands.rs).
    shelf: Mutex<Shelf>,
    /// The thread opening the remembered library at launch, until something waits for
    /// it (`library_ready`).
    restoring: Mutex<Option<std::thread::JoinHandle<()>>>,
    /// Bumped whenever the library changes, so a watcher of an older one is ignored.
    generation: AtomicU64,
    trash: Arc<dyn Trash>,
    /// Entries moved to the trash this session, by the token the frontend undoes with.
    trashed: Mutex<Vec<Trashed>>,
    /// Spelling and grammar: the checker's thread and the personal dictionary.
    checking: Checking,
    /// `$XDG_CONFIG_HOME/bismillah/`: settings, shortcuts, themes, the dictionary.
    config_dir: PathBuf,
    /// The configuration and data folders as the writer reads them (`~/.config/…`).
    folders: Folders,
}

#[derive(Clone, Serialize)]
pub struct Folders {
    config: String,
    data: String,
}

/// A save failure the e2e tests inject into the real app (ARCHITECTURE.md §13).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestFault {
    DiskFull,
    RenameFails,
}

impl TestFault {
    fn at(self, step: documents::Step) -> std::io::Result<()> {
        use documents::Step;
        use std::io::{Error, ErrorKind};
        match (self, step) {
            (TestFault::DiskFull, Step::Write) => Err(Error::from(ErrorKind::StorageFull)),
            (TestFault::RenameFails, Step::Rename) => Err(Error::from(ErrorKind::Other)),
            _ => Ok(()),
        }
    }
}

impl AppState {
    pub fn new(
        handle: AppHandle,
        config_dir: &Path,
        data_dir: &Path,
        startup: Option<PathBuf>,
    ) -> Self {
        let home = handle.path().home_dir().ok();
        let folders = Folders {
            config: config::display(config_dir, home.as_deref()),
            data: config::display(data_dir, home.as_deref()),
        };
        let recovery = Arc::new(Recovery::new(data_dir.join("recovery")));
        recovery.prune();
        let memory_path = data_dir.join("state.json");
        let settings = settings::Store::load(config_dir.join("settings.toml"));
        let checking = Checking::start(config_dir.join("dictionary.txt"));
        AppState {
            test_mode: std::env::var_os("BISMILLAH_TEST").is_some(),
            handle,
            document: Mutex::new(None),
            next_id: AtomicU64::new(1),
            requested: Mutex::new(startup),
            recovered: Mutex::new(Vec::new()),
            recovery,
            settings: Mutex::new(settings),
            memory: Mutex::new(state::Store::load(memory_path)),
            fault: Arc::new(Mutex::new(None)),
            dialog_answer: Mutex::new(None),
            handed: Mutex::new(Vec::new()),
            shelf: Mutex::new(Shelf::None),
            restoring: Mutex::new(None),
            generation: AtomicU64::new(0),
            trash: Arc::new(platform::SystemTrash),
            trashed: Mutex::new(Vec::new()),
            checking,
            config_dir: config_dir.to_path_buf(),
            folders,
        }
    }

    /// Hands a checked URI to the app the desktop opens it with: the default browser,
    /// mail app or file manager (links.rs). Under the test harness nothing is opened:
    /// the URI is recorded for the tests instead.
    fn hand_on(&self, window: &tauri::WebviewWindow, uri: String) -> Result<(), LinkError> {
        if self.test_mode {
            lock(&self.handed).push(uri);
            return Ok(());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(platform::open_uri(&uri));
            })
            .map_err(|_| LinkError::NoApp)?;
        // The address is the document's: never logged (AGENTS.md, rule 2).
        rx.recv()
            .map_err(|_| LinkError::NoApp)?
            .map_err(|()| LinkError::NoApp)
    }

    /// Test mode only: the answer queued for the next native file dialog, if any.
    fn dialog_answer(&self) -> Option<Option<PathBuf>> {
        if !test_hooks_allowed(self) {
            return None;
        }
        lock(&self.dialog_answer).take()
    }

    pub fn memory(&self) -> state::State {
        lock(&self.memory).snapshot()
    }

    pub fn remember(&self, change: impl FnOnce(&mut state::State)) {
        lock(&self.memory).change(change);
    }

    /// Queues a file to open and tells the frontend, which saves first and then asks.
    pub fn request_open(&self, app: &AppHandle, path: PathBuf) {
        let name = documents::display_name(&path);
        *lock(&self.requested) = Some(path);
        if let Err(e) = app.emit("open-requested", name) {
            eprintln!("bismillah: couldn't announce a file to open: {e}");
        }
    }

    fn current(&self, id: u64) -> Option<Arc<Mutex<Open>>> {
        let current = lock(&self.document).clone()?;
        let matches = lock(&current).id == id;
        matches.then_some(current)
    }

    fn current_path(&self) -> Option<PathBuf> {
        let current = lock(&self.document).clone()?;
        let open = lock(&current);
        match &open.source {
            Source::File(doc) => Some(doc.path.clone()),
            Source::Sample(_) => None,
        }
    }

    /// Other files with text waiting in recovery. The frontend gets tokens, not paths.
    fn pending_recovery(&self, except: Option<&Path>) -> Vec<PendingRecovery> {
        let pending = self.recovery.pending(except);
        let mut tokens = lock(&self.recovered);
        *tokens = pending.iter().map(|p| p.path.clone()).collect();
        pending
            .iter()
            .enumerate()
            .map(|(token, p)| PendingRecovery {
                token,
                name: documents::display_name(&p.path),
                saved_at_ms: p.saved_at_ms,
            })
            .collect()
    }

    /// Makes `source` the open document and describes it for the frontend. A file
    /// outside the library makes its folder the library, so every open file has a root
    /// to check paths against (ARCHITECTURE.md §12.2).
    fn install(&self, source: Source, decoded: documents::Decoded) -> Opened {
        // Where the document is in the library needs the library.
        self.library_ready();
        // Text the writer leaves behind unsaved (its last save failed) stays on offer.
        if let Some(previous) = self.current_path() {
            self.recovery.retain_mirror(&previous);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (name, path, sample) = match &source {
            Source::File(doc) => (doc.name(), Some(doc.path.clone()), false),
            Source::Sample(name) => (name.to_string(), None, true),
        };
        let recovery = path.as_deref().and_then(|p| self.recovery.offer(p));
        if let Some(path) = &path {
            self.remember(|m| m.opened(path));
        }
        let adopt = path
            .as_deref()
            .filter(|p| self.library_path_of(p).is_none())
            .and_then(Path::parent)
            .map(Path::to_path_buf);
        *lock(&self.document) = Some(Arc::new(Mutex::new(Open { id, source })));
        // After the document is in place, so the new library's first listing already
        // names it as the open file.
        if let Some(folder) = adopt {
            self.set_library(&folder);
        }
        let library_path = path.as_deref().and_then(|p| self.library_path_of(p));
        Opened {
            id,
            name,
            library_path,
            text: decoded.text,
            line_ending: decoded.line_ending,
            mixed_line_endings: decoded.mixed_line_endings,
            read_only: !decoded.utf8,
            sample,
            recovery,
            pending_recovery: Vec::new(),
        }
    }

    fn open_path(&self, path: &Path) -> Result<Opened, OpenError> {
        let (doc, decoded) = documents::open(path)?;
        Ok(self.install(Source::File(doc), decoded))
    }
}

/// A file with recovered text from an earlier session, mentioned on launch.
#[derive(Serialize)]
pub struct PendingRecovery {
    token: usize,
    name: String,
    saved_at_ms: u64,
}

/// An opened document, as the frontend sees it.
#[derive(Serialize)]
pub struct Opened {
    id: u64,
    /// The file name only, never the full path.
    name: String,
    /// Where the file is in the library (relative, `/`-separated), so the library can
    /// show it as the open file. `None` outside the library.
    library_path: Option<String>,
    /// The text with `\n` line breaks.
    text: String,
    line_ending: LineEnding,
    mixed_line_endings: bool,
    /// The file isn't UTF-8 and opened for reading only.
    read_only: bool,
    sample: bool,
    /// Text from an earlier session that never reached this file.
    recovery: Option<recovery::Entry>,
    /// Other files with recovered text: filled at launch only, so the writer is told
    /// once rather than on every open.
    pending_recovery: Vec<PendingRecovery>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Startup {
    Document {
        document: Opened,
    },
    /// Nothing to open: show the first screen.
    Welcome {
        pending_recovery: Vec<PendingRecovery>,
    },
    Failed {
        name: String,
        error: OpenError,
    },
}

#[derive(Serialize)]
pub struct AppInfo {
    /// Set by the test harness (`BISMILLAH_TEST=1`) so the frontend exposes its test
    /// hooks and disables caret blinking for deterministic screenshots.
    test_mode: bool,
    /// Lets the e2e suite kill exactly this process (the recovery test).
    pid: u32,
    /// For About.
    version: &'static str,
    /// Where bismillah keeps its files, for Settings › Files & privacy.
    folders: Folders,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        test_mode: state.test_mode,
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION"),
        folders: state.folders.clone(),
    }
}

/// What to show at launch (DESIGN.md §15): the file named on the command line, else the
/// last document, else the first screen. Test mode opens the bundled specimen instead,
/// as a sample that is never saved.
#[tauri::command]
pub async fn startup(state: State<'_, AppState>) -> Result<Startup, ()> {
    // The remembered library decides whether the last document still belongs to it.
    state.library_ready();
    let mut requested = lock(&state.requested).take();
    let with_pending = |mut document: Opened| {
        let current = state.current_path();
        document.pending_recovery = state.pending_recovery(current.as_deref());
        Startup::Document { document }
    };
    // `bismillah folder/` opens the folder as the library, and the last document only
    // if it belongs to it.
    let folder = requested.take_if(|p| p.is_dir());
    if let Some(folder) = &folder {
        state.set_library(folder);
    }
    if let Some(path) = requested {
        return Ok(match state.open_path(&path) {
            Ok(document) => with_pending(document),
            Err(error) => Startup::Failed {
                name: documents::display_name(&path),
                error,
            },
        });
    }
    if state.test_mode {
        let decoded = documents::decode(SPECIMEN.as_bytes());
        return Ok(Startup::Document {
            document: state.install(Source::Sample("specimen.md"), decoded),
        });
    }
    if let Some(last) = state.memory().last_document
        && (folder.is_none() || state.library_accepts(&last))
        && let Ok(document) = state.open_path(&last)
    {
        return Ok(with_pending(document));
    }
    let pending_recovery = state.pending_recovery(None);
    Ok(Startup::Welcome { pending_recovery })
}

fn markdown_filter(
    builder: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    builder
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All files", &["*"])
}

fn dialog_dir(state: &AppState) -> Option<PathBuf> {
    state
        .current_path()
        .or_else(|| state.memory().last_document)
        .and_then(|p| p.parent().map(Path::to_path_buf))
}

/// Help › Guide: the guide bundled with the app, as a sample that is never saved, so the
/// writer can try what it describes.
#[tauri::command]
pub fn doc_open_guide(state: State<'_, AppState>) -> Opened {
    state.install(
        Source::Sample("guide.md"),
        documents::decode(GUIDE.as_bytes()),
    )
}

/// File › Open…: the native dialog, then the chosen file. `None` if cancelled.
#[tauri::command]
pub async fn doc_open_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Opened>, OpenError> {
    let chosen = match state.dialog_answer() {
        Some(answer) => answer,
        None => {
            let mut dialog = markdown_filter(app.dialog().file()).set_title("Open");
            if let Some(dir) = dialog_dir(&state) {
                dialog = dialog.set_directory(dir);
            }
            match dialog.blocking_pick_file() {
                Some(chosen) => Some(chosen.into_path().map_err(|_| OpenError::NotAFile)?),
                None => None,
            }
        }
    };
    match chosen {
        Some(path) => state.open_path(&path).map(Some),
        None => Ok(None),
    }
}

/// File › New file…: the native save dialog, then a new empty file. `None` if
/// cancelled. Never replaces an existing file. `folder` is a library folder to start
/// the dialog in (the one selected in the library).
#[tauri::command]
pub async fn doc_new_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
    folder: Option<String>,
) -> Result<Option<Opened>, SaveError> {
    let chosen = match state.dialog_answer() {
        Some(answer) => answer,
        None => {
            let mut dialog = markdown_filter(app.dialog().file())
                .set_title("New file")
                .set_file_name("Untitled.md");
            let start = folder
                .as_deref()
                .and_then(|rel| state.library_folder(rel))
                .or_else(|| dialog_dir(&state));
            if let Some(dir) = start {
                dialog = dialog.set_directory(dir);
            }
            match dialog.blocking_save_file() {
                Some(chosen) => Some(chosen.into_path().map_err(|_| SaveError::Unavailable)?),
                None => None,
            }
        }
    };
    let Some(mut path) = chosen else {
        return Ok(None);
    };
    if path.extension().is_none() {
        path.set_extension("md");
    }
    let (doc, decoded) = documents::create(&path)?;
    Ok(Some(state.install(Source::File(doc), decoded)))
}

/// Opens the file that a second launch or a drop asked for (after the frontend saved).
/// A folder becomes the library instead, and the open document stays.
#[tauri::command]
pub async fn doc_open_requested(state: State<'_, AppState>) -> Result<Option<Opened>, OpenError> {
    let requested = lock(&state.requested).take();
    match requested {
        Some(folder) if folder.is_dir() => {
            state.set_library(&folder);
            state.remember(|m| m.library_open = true);
            Ok(None)
        }
        Some(path) => state.open_path(&path).map(Some),
        None => Ok(None),
    }
}

/// Opens a file that has text waiting in recovery, by its token from `pending_recovery`.
#[tauri::command]
pub async fn doc_open_recovered(
    state: State<'_, AppState>,
    token: usize,
) -> Result<Opened, OpenError> {
    let path = lock(&state.recovered).get(token).cloned();
    let path = path.ok_or(OpenError::NotFound)?;
    state.open_path(&path)
}

/// Saves the open document (ARCHITECTURE.md §5). The text is mirrored to the recovery
/// journal first; a clean save clears the mirror, a failed one makes it durable.
/// Returns the revision now on disk.
#[tauri::command]
pub async fn doc_save(
    state: State<'_, AppState>,
    id: u64,
    text: String,
    revision: u64,
    force: bool,
) -> Result<u64, SaveError> {
    let open = state.current(id).ok_or(SaveError::Closed)?;
    let recovery = Arc::clone(&state.recovery);
    let fault = Arc::clone(&state.fault);
    // File I/O and fsync block, so they run off the async runtime. Saves for one
    // document are serialised by its lock.
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut open = lock(&open);
        match &mut open.source {
            Source::Sample(_) => Err(SaveError::NotAFile),
            Source::File(doc) => {
                let fault = *lock(&fault);
                let faults = move |step| fault.map_or(Ok(()), |f| f.at(step));
                save_with_recovery(&recovery, doc, &text, revision, force, &faults)
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        Err(SaveError::Other {
            detail: "Interrupted".into(),
        })
    });
    if let Err(e) = &result {
        eprintln!("bismillah: save failed: {e}");
    }
    result
}

fn save_with_recovery(
    recovery: &Recovery,
    doc: &mut Document,
    text: &str,
    revision: u64,
    force: bool,
    faults: documents::Faults<'_>,
) -> Result<u64, SaveError> {
    if revision <= doc.saved_revision {
        return Ok(doc.saved_revision);
    }
    if let Err(e) = recovery.mirror(&doc.path, text, revision, false) {
        eprintln!("bismillah: couldn't mirror to recovery: {:?}", e.kind());
    }
    match documents::save(doc, text, revision, force, faults) {
        Ok(saved) => {
            recovery.clear_mirror(&doc.path);
            Ok(saved)
        }
        Err(error) => {
            if let Err(e) = recovery.mirror(&doc.path, text, revision, true) {
                eprintln!("bismillah: couldn't keep text in recovery: {:?}", e.kind());
            }
            Err(error)
        }
    }
}

/// "Save mine as…" after a conflict: writes the text to a file the writer chooses and
/// makes that the open document. `None` if cancelled.
#[tauri::command]
pub async fn doc_save_as(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
    text: String,
) -> Result<Option<Opened>, SaveError> {
    let open = state.current(id).ok_or(SaveError::Closed)?;
    let (name, line_ending, bom, old_path) = match &lock(&open).source {
        Source::File(doc) => (doc.name(), doc.line_ending, doc.bom, Some(doc.path.clone())),
        Source::Sample(name) => (name.to_string(), LineEnding::Lf, false, None),
    };
    let chosen = match state.dialog_answer() {
        Some(answer) => answer,
        None => {
            let mut dialog = markdown_filter(app.dialog().file())
                .set_title("Save as")
                .set_file_name(&name);
            if let Some(dir) = old_path.as_deref().and_then(Path::parent) {
                dialog = dialog.set_directory(dir);
            }
            match dialog.blocking_save_file() {
                Some(chosen) => Some(chosen.into_path().map_err(|_| SaveError::Unavailable)?),
                None => None,
            }
        }
    };
    let Some(path) = chosen else {
        return Ok(None);
    };
    // The dialog has asked before replacing an existing file.
    let bytes = documents::encode(&text, line_ending, bom);
    let permissions = std::fs::metadata(&path).ok().map(|m| m.permissions());
    documents::write_atomic(&path, &bytes, permissions, NO_FAULTS)
        .map_err(|e| SaveError::from_io(&e))?;
    if let Some(old) = &old_path {
        state.recovery.clear_mirror(old);
    }
    let (doc, decoded) = documents::open(&path).map_err(|_| SaveError::Unavailable)?;
    Ok(Some(state.install(Source::File(doc), decoded)))
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiskStatus {
    Unchanged,
    Changed,
    Removed,
}

/// Whether the open file changed on disk since we last read or wrote it (checked when
/// the window regains focus; the save-time check is the authority).
#[tauri::command]
pub async fn doc_check(state: State<'_, AppState>, id: u64) -> Result<DiskStatus, SaveError> {
    let open = state.current(id).ok_or(SaveError::Closed)?;
    let mut open = lock(&open);
    Ok(match &mut open.source {
        Source::Sample(_) => DiskStatus::Unchanged,
        Source::File(doc) => match documents::check_disk(doc) {
            documents::DiskCheck::Unchanged => DiskStatus::Unchanged,
            documents::DiskCheck::Changed => DiskStatus::Changed,
            documents::DiskCheck::Removed => DiskStatus::Removed,
        },
    })
}

/// Reloads the open file from disk ("Load theirs", or a quiet reload when there are no
/// local edits). Local text, if given, is kept in recovery first.
#[tauri::command]
pub async fn doc_reload(
    state: State<'_, AppState>,
    id: u64,
    local_text: Option<String>,
) -> Result<Opened, OpenError> {
    let open = state.current(id).ok_or(OpenError::NotFound)?;
    let path = match &lock(&open).source {
        Source::File(doc) => doc.path.clone(),
        Source::Sample(_) => return Err(OpenError::NotAFile),
    };
    if let Some(text) = local_text {
        state
            .recovery
            .keep(&path, &text)
            .map_err(|e| OpenError::Other {
                detail: format!("{:?}", e.kind()),
            })?;
        state.recovery.clear_mirror(&path);
    }
    state.open_path(&path)
}

/// The writer restored or discarded the recovered text for the open file.
#[tauri::command]
pub async fn recovery_settle(state: State<'_, AppState>, id: u64) -> Result<(), SaveError> {
    let open = state.current(id).ok_or(SaveError::Closed)?;
    if let Source::File(doc) = &lock(&open).source {
        state.recovery.settle(&doc.path);
    }
    Ok(())
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> settings::Snapshot {
    lock(&state.settings).snapshot()
}

#[tauri::command]
pub fn settings_set(
    state: State<'_, AppState>,
    patch: Map<String, Value>,
) -> Result<settings::Snapshot, SetError> {
    lock(&state.settings).set(&patch)
}

/// bismillah's colour themes and the writer's, each checked (themes.rs).
#[tauri::command]
pub async fn themes_list(state: State<'_, AppState>) -> Result<Themes, ()> {
    Ok(themes::list(&state.config_dir.join("themes")))
}

/// Whether the writer's "Another font" is installed (platform.rs); `None` if unknown.
#[tauri::command]
pub async fn font_installed(family: String) -> Result<Option<bool>, ()> {
    if family.is_empty() || family.len() > 400 || family.chars().any(char::is_control) {
        return Ok(Some(false));
    }
    Ok(platform::font_installed(&family))
}

/// The lines of `keybindings.toml`, for the frontend to check against its commands.
#[tauri::command]
pub fn keybindings_get(state: State<'_, AppState>) -> Keybindings {
    keybindings::read(&state.config_dir.join("keybindings.toml"))
}

/// Writes a starting `keybindings.toml` (the frontend's text), never over an existing one.
#[tauri::command]
pub fn keybindings_create(
    state: State<'_, AppState>,
    text: String,
) -> Result<Keybindings, SaveError> {
    keybindings::create(&state.config_dir.join("keybindings.toml"), &text)
}

/// Re-reads `settings.toml` if it changed outside the app. `None` if it didn't.
#[tauri::command]
pub fn settings_reload(state: State<'_, AppState>) -> Option<settings::Snapshot> {
    lock(&state.settings).reload_if_changed()
}

/// The English dialect setting.
fn dialect(settings: &settings::Store) -> bismillah_lint::Dialect {
    settings
        .value("english_dialect")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Blocks of the open document to check (ARCHITECTURE.md §7.1), with the editor's
/// revision and the document's frontmatter `lang:`.
#[derive(serde::Deserialize)]
pub struct LintRequest {
    revision: u64,
    lang: Option<String>,
    blocks: Vec<bismillah_lint::Block>,
}

/// One list of diagnostics per block, in the request's order, for `revision`.
#[derive(Serialize)]
pub struct LintResponse {
    revision: u64,
    blocks: Vec<Vec<bismillah_lint::Diagnostic>>,
}

impl AppState {
    fn lint_options(&self, lang: Option<String>) -> bismillah_lint::Options {
        let settings = lock(&self.settings);
        let on = |key: &str| settings.value(key).and_then(Value::as_bool).unwrap_or(true);
        bismillah_lint::Options {
            spelling: on("check_spelling"),
            grammar: on("check_grammar"),
            dialect: dialect(&settings),
            lang,
        }
    }
}

/// Checks spelling and grammar in some blocks of the open document, as the settings
/// say. Off the async runtime: the checker's thread answers.
#[tauri::command]
pub async fn lint_check(
    state: State<'_, AppState>,
    request: LintRequest,
) -> Result<LintResponse, LintError> {
    let options = state.lint_options(request.lang);
    let count = request.blocks.len();
    if !options.spelling && !options.grammar {
        return Ok(LintResponse {
            revision: request.revision,
            blocks: vec![Vec::new(); count],
        });
    }
    let answer = state.checking.check(request.blocks, options)?;
    let blocks = tauri::async_runtime::spawn_blocking(move || answer.recv())
        .await
        .map_err(|_| LintError::Unavailable)?
        .map_err(|_| LintError::Unavailable)?;
    Ok(LintResponse {
        revision: request.revision,
        blocks,
    })
}

/// Corrections for a misspelled word, found only when the writer asks (an Arabic
/// search stops after about 300 ms). `doc_lang` is the document's frontmatter `lang:`,
/// which may choose the English dialect.
#[tauri::command]
pub async fn lint_suggest(
    state: State<'_, AppState>,
    word: String,
    lang: bismillah_lint::Lang,
    doc_lang: Option<String>,
) -> Result<Vec<String>, LintError> {
    let options = state.lint_options(doc_lang);
    let dialect = bismillah_lint::routing::routes(options.lang.as_deref(), options.dialect)
        .latin
        .unwrap_or(options.dialect);
    let answer = state.checking.suggest(word, lang, dialect)?;
    tauri::async_runtime::spawn_blocking(move || answer.recv())
        .await
        .map_err(|_| LintError::Unavailable)?
        .map_err(|_| LintError::Unavailable)
}

/// Adds a word to the personal dictionary (`dictionary.txt`, ARCHITECTURE.md §7.4).
#[tauri::command]
pub async fn lint_add_word(state: State<'_, AppState>, word: String) -> Result<(), AddWordError> {
    state.checking.add_word(&word)
}

/// Re-reads `dictionary.txt` if the writer edited it elsewhere (on window focus). True
/// if its words changed, so the editor checks the document again.
#[tauri::command]
pub fn lint_refresh(state: State<'_, AppState>) -> bool {
    state.checking.refresh()
}

/// Opens a link from the document in the writer's default browser or mail app, on an
/// explicit Ctrl+click or *Open link* (ADR-0003). Only web and email addresses leave
/// (links.rs); bismillah itself requests nothing.
#[tauri::command]
pub async fn link_open(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    address: String,
) -> Result<(), LinkError> {
    let uri = links::web_address(&address)?;
    state.hand_on(&window, uri)
}

/// The folders Settings › Files & privacy names.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Folder {
    /// Settings, shortcuts, themes and the dictionary.
    Settings,
    /// The recovery journal.
    Recovery,
    /// The library's root.
    Library,
}

/// Shows one of bismillah's folders, or the library, in the writer's file manager. The
/// frontend names which; Rust knows where it is. bismillah's own folders are created
/// if they aren't there yet.
#[tauri::command]
pub async fn folder_show(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    folder: Folder,
) -> Result<(), LinkError> {
    let path = match folder {
        Folder::Settings => {
            std::fs::create_dir_all(&state.config_dir).map_err(|_| LinkError::Unavailable)?;
            state.config_dir.clone()
        }
        Folder::Recovery => {
            let dir = state.recovery.dir().to_path_buf();
            platform::create_private_dir(&dir).map_err(|_| LinkError::Unavailable)?;
            dir
        }
        Folder::Library => state
            .library()
            .map_err(|_| LinkError::Unavailable)?
            .root()
            .to_path_buf(),
    };
    if !path.is_dir() {
        return Err(LinkError::Unavailable);
    }
    let uri = links::folder_uri(&path).ok_or(LinkError::Unavailable)?;
    state.hand_on(&window, uri)
}

/// Test-only commands exist in debug builds under the test harness only, never in the
/// release build the writer installs.
fn test_hooks_allowed(state: &AppState) -> bool {
    cfg!(debug_assertions) && state.test_mode
}

/// Test mode only: opens a file by path, standing in for the native dialog, which
/// WebDriver can't drive. Refused outside the test harness.
#[tauri::command]
pub async fn test_open(state: State<'_, AppState>, path: PathBuf) -> Result<Opened, OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    state.open_path(&path)
}

/// Test mode only: the next native file dialog answers `path` (`None`: cancelled)
/// without being shown, since WebDriver can't drive it.
#[tauri::command]
pub fn test_dialog(state: State<'_, AppState>, path: Option<PathBuf>) -> Result<(), OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    *lock(&state.dialog_answer) = Some(path);
    Ok(())
}

/// Test mode only: makes every save fail at one step until called with `None`.
#[tauri::command]
pub fn test_fault(state: State<'_, AppState>, fault: Option<TestFault>) -> Result<(), OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    *lock(&state.fault) = fault;
    Ok(())
}

/// Test mode only: the links and folders handed to other apps since the last call, in
/// order (recorded, never opened, under the harness).
#[tauri::command]
pub fn test_handed(state: State<'_, AppState>) -> Result<Vec<String>, OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    Ok(std::mem::take(&mut *lock(&state.handed)))
}

/// Test mode only: what the clipboard holds under `target` (`text/html`,
/// `UTF8_STRING`), read back through GTK, for the Copy as rich text tests.
#[tauri::command]
pub async fn test_clipboard(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    target: String,
) -> Result<Option<String>, OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(platform::read_clipboard(&target));
        })
        .map_err(|_| OpenError::PermissionDenied)?;
    Ok(rx.recv().ok().flatten())
}

/// What `bismillah --help` and `--version` print, or `None` to start the app. Either
/// answers in the terminal and exits before any window or instance socket exists.
pub fn cli_answer(args: &[String]) -> Option<String> {
    let version = env!("CARGO_PKG_VERSION");
    args.iter().skip(1).find_map(|arg| match arg.as_str() {
        "-V" | "--version" => Some(format!("bismillah {version}")),
        "-h" | "--help" => Some(format!(
            "bismillah {version}: a calm, offline Markdown editor\n\
             \n\
             Usage: bismillah [FILE | FOLDER]\n\
             \n\
             \x20 FILE     opens a Markdown file; a file outside the library makes its folder\n\
             \x20          the library\n\
             \x20 FOLDER   opens a folder as the library\n\
             \n\
             If bismillah is already running, the file or folder opens there.\n\
             \n\
             \x20 -h, --help      shows this and exits\n\
             \x20 -V, --version   shows the version and exits\n\
             \n\
             The guide is in the app (Help > Guide, F1) and in /usr/share/doc/bismillah/."
        )),
        _ => None,
    })
}

/// Resolves a path given on the command line of this or a second launch.
pub fn cli_path(args: &[String], cwd: &Path) -> Option<PathBuf> {
    let arg = args.iter().skip(1).find(|a| !a.starts_with('-'))?;
    let path = PathBuf::from(arg);
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

/// The directory bismillah keeps settings in (`$XDG_CONFIG_HOME/bismillah/` on Linux)
/// and the one for recovery and window state (`$XDG_DATA_HOME/bismillah/`).
pub fn dirs(app: &AppHandle) -> tauri::Result<(PathBuf, PathBuf)> {
    let paths = app.path();
    Ok((
        paths.config_dir()?.join("bismillah"),
        paths.data_dir()?.join("bismillah"),
    ))
}
