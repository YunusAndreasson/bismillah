//! The app's state and the commands the frontend may call (ARCHITECTURE.md §4).
//!
//! The frontend never names a path: files come from the command line, a native dialog,
//! a drop on the window or a second launch, and the frontend refers to the open document
//! by id. Rust decides what is read and written (AGENTS.md, "The writer's trust" rule 5).

use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::documents::{self, Document, LineEnding, NO_FAULTS, OpenError, SaveError};
use crate::recovery::{self, Recovery};
use crate::settings::{self, SetError};
use crate::state;

/// The bundled specimen, opened as a sample (never saved) in test mode.
const SPECIMEN: &str = include_str!("../../docs/specimen.md");

/// Locks a mutex even if a panic poisoned it: the data is still the best we have, and
/// refusing to save the writer's text over a poisoned lock would be worse.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

enum Source {
    File(Document),
    /// The bundled specimen; edits stay in memory.
    Sample,
}

struct Open {
    id: u64,
    source: Source,
}

pub struct AppState {
    pub test_mode: bool,
    document: Mutex<Option<Arc<Mutex<Open>>>>,
    next_id: AtomicU64,
    /// A file waiting to be opened: from the command line, a second launch or a drop.
    requested: Mutex<Option<PathBuf>>,
    /// Files with recovered text, by the token the frontend uses to open them.
    recovered: Mutex<Vec<PathBuf>>,
    recovery: Arc<Recovery>,
    settings: Mutex<settings::Store>,
    memory: Mutex<state::State>,
    memory_path: PathBuf,
    /// Test mode only: a failure injected into every save until cleared.
    fault: Arc<Mutex<Option<TestFault>>>,
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
    pub fn new(config_dir: &Path, data_dir: &Path, startup: Option<PathBuf>) -> Self {
        let recovery = Arc::new(Recovery::new(data_dir.join("recovery")));
        recovery.prune();
        let memory_path = data_dir.join("state.json");
        AppState {
            test_mode: std::env::var_os("BISMILLAH_TEST").is_some(),
            document: Mutex::new(None),
            next_id: AtomicU64::new(1),
            requested: Mutex::new(startup),
            recovered: Mutex::new(Vec::new()),
            recovery,
            settings: Mutex::new(settings::Store::load(config_dir.join("settings.toml"))),
            memory: Mutex::new(state::State::load(&memory_path)),
            memory_path,
            fault: Arc::new(Mutex::new(None)),
        }
    }

    pub fn memory(&self) -> state::State {
        lock(&self.memory).clone()
    }

    pub fn remember(&self, change: impl FnOnce(&mut state::State)) {
        let mut memory = lock(&self.memory);
        change(&mut memory);
        memory.save(&self.memory_path);
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
            Source::Sample => None,
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

    /// Makes `source` the open document and describes it for the frontend.
    fn install(&self, source: Source, decoded: documents::Decoded) -> Opened {
        // Text the writer leaves behind unsaved (its last save failed) stays on offer.
        if let Some(previous) = self.current_path() {
            self.recovery.retain_mirror(&previous);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (name, path, sample) = match &source {
            Source::File(doc) => (doc.name(), Some(doc.path.clone()), false),
            Source::Sample => ("specimen.md".to_string(), None, true),
        };
        let recovery = path.as_deref().and_then(|p| self.recovery.offer(p));
        if let Some(path) = path {
            self.remember(|m| m.last_document = Some(path));
        }
        *lock(&self.document) = Some(Arc::new(Mutex::new(Open { id, source })));
        Opened {
            id,
            name,
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
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        test_mode: state.test_mode,
        pid: std::process::id(),
    }
}

/// What to show at launch (DESIGN.md §15): the file named on the command line, else the
/// last document, else the first screen. Test mode opens the bundled specimen instead,
/// as a sample that is never saved.
#[tauri::command]
pub async fn startup(state: State<'_, AppState>) -> Result<Startup, ()> {
    let requested = lock(&state.requested).take();
    let with_pending = |mut document: Opened| {
        let current = state.current_path();
        document.pending_recovery = state.pending_recovery(current.as_deref());
        Startup::Document { document }
    };
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
            document: state.install(Source::Sample, decoded),
        });
    }
    if let Some(last) = state.memory().last_document
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

/// File › Open…: the native dialog, then the chosen file. `None` if cancelled.
#[tauri::command]
pub async fn doc_open_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Opened>, OpenError> {
    let mut dialog = markdown_filter(app.dialog().file()).set_title("Open");
    if let Some(dir) = dialog_dir(&state) {
        dialog = dialog.set_directory(dir);
    }
    let Some(chosen) = dialog.blocking_pick_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|_| OpenError::NotAFile)?;
    state.open_path(&path).map(Some)
}

/// File › New file…: the native save dialog, then a new empty file. `None` if
/// cancelled. Never replaces an existing file.
#[tauri::command]
pub async fn doc_new_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Opened>, SaveError> {
    let mut dialog = markdown_filter(app.dialog().file())
        .set_title("New file")
        .set_file_name("Untitled.md");
    if let Some(dir) = dialog_dir(&state) {
        dialog = dialog.set_directory(dir);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let mut path = chosen.into_path().map_err(|_| SaveError::Unavailable)?;
    if path.extension().is_none() {
        path.set_extension("md");
    }
    let (doc, decoded) = documents::create(&path)?;
    Ok(Some(state.install(Source::File(doc), decoded)))
}

/// Opens the file that a second launch or a drop asked for (after the frontend saved).
#[tauri::command]
pub async fn doc_open_requested(state: State<'_, AppState>) -> Result<Option<Opened>, OpenError> {
    let requested = lock(&state.requested).take();
    match requested {
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
            Source::Sample => Err(SaveError::NotAFile),
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
        Source::Sample => ("specimen.md".into(), LineEnding::Lf, false, None),
    };
    let mut dialog = markdown_filter(app.dialog().file())
        .set_title("Save as")
        .set_file_name(&name);
    if let Some(dir) = old_path.as_deref().and_then(Path::parent) {
        dialog = dialog.set_directory(dir);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|_| SaveError::Unavailable)?;
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

#[derive(Serialize)]
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
        Source::Sample => DiskStatus::Unchanged,
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
        Source::Sample => return Err(OpenError::NotAFile),
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

/// Re-reads `settings.toml` if it changed outside the app. `None` if it didn't.
#[tauri::command]
pub fn settings_reload(state: State<'_, AppState>) -> Option<settings::Snapshot> {
    lock(&state.settings).reload_if_changed()
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

/// Test mode only: makes every save fail at one step until called with `None`.
#[tauri::command]
pub fn test_fault(state: State<'_, AppState>, fault: Option<TestFault>) -> Result<(), OpenError> {
    if !test_hooks_allowed(&state) {
        return Err(OpenError::PermissionDenied);
    }
    *lock(&state.fault) = fault;
    Ok(())
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
