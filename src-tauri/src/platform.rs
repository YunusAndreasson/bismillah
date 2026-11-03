//! All platform-specific code lives here (ARCHITECTURE.md §12.3).

use std::fs::{self, Permissions};
use std::io;
use std::path::Path;

use crate::library::{LibraryError, Trash};

/// Per-platform window setup after the main window is created, before its page runs.
pub fn configure_main_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    let _ = window.with_webview(|webview| linux::quiet_webview(&webview.inner()));
    #[cfg(not(target_os = "linux"))]
    let _ = window;
}

/// The page under the light and dark themes (`--paper-50`, `--charcoal-950` in tokens.css):
/// the window's own colour before the page paints, so it never flashes another one.
#[cfg(any(target_os = "macos", test))]
const PAGE: [(u8, u8, u8); 2] = [(0xf7, 0xf6, 0xf2), (0x15, 0x15, 0x15)];

/// macOS: the title bar's traffic lights follow the writer's theme, and the window is the
/// page's colour from its first frame (DESIGN.md §7). The page keeps it current after
/// that, also for colour themes (`nativeWindow.ts`).
pub fn match_page(window: &tauri::WebviewWindow, theme: &str) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Theme;
        let chosen = match theme {
            "light" => Some(Theme::Light),
            "dark" => Some(Theme::Dark),
            _ => None,
        };
        let _ = window.set_theme(chosen);
        let dark = chosen.or_else(|| window.theme().ok()) == Some(Theme::Dark);
        let (r, g, b) = PAGE[usize::from(dark)];
        let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, theme);
}

/// macOS's dot in the close button: changes that aren't on disk yet. Runs on the main
/// thread, as AppKit requires.
pub fn show_edited(window: &tauri::WebviewWindow, edited: bool) {
    #[cfg(target_os = "macos")]
    if let Ok(ns) = window.ns_window() {
        // SAFETY: Tauri hands over the window's own NSWindow, which lives as long as
        // `window`; the caller runs this on the main thread, and the reference ends here.
        let ns = unsafe { &*ns.cast::<objc2_app_kit::NSWindow>() };
        ns.setDocumentEdited(edited);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, edited);
}

/// The file (or else the folder) Finder asks the app to open: Open, a double-click, or a
/// drop on the Dock icon. macOS sends these as events, never as a second launch.
pub fn opened_file(event: &tauri::RunEvent) -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { urls } = event {
        let paths: Vec<_> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
        let file = paths.iter().find(|p| p.is_file());
        return file.or_else(|| paths.iter().find(|p| p.is_dir())).cloned();
    }
    let _ = event;
    None
}

/// Shows the menu bar and puts keyboard focus on its first menu (Alt / F10 on Linux and
/// Windows). It hides itself again when it closes.
pub fn reveal_menu(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.show_menu()?;
    #[cfg(target_os = "linux")]
    linux::focus_menu_bar(window);
    Ok(())
}

/// Whether the menu bar is shown, and whether one of its menus is open or selected.
pub fn menu_state(window: &tauri::WebviewWindow) -> tauri::Result<(bool, bool)> {
    let visible = window.is_menu_visible()?;
    #[cfg(target_os = "linux")]
    let active = linux::menu_bar_active(window);
    #[cfg(not(target_os = "linux"))]
    let active = false;
    Ok((visible, active))
}

/// Whether a font family is installed, by its name, as the system's font list has it:
/// `None` when that can't be asked. The webview can't tell: WebKitGTK quietly draws an
/// unknown family in a substitute font, so the writer's "Another font" is checked here
/// and used only when it exists (DESIGN.md §8.2).
pub fn font_installed(family: &str) -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        // fontconfig's own list, never its substitutes; `-q` answers by exit status.
        // A pattern's `-`, `:`, `,` and `\` would otherwise be read as syntax.
        let pattern: String = family
            .chars()
            .flat_map(|c| {
                let escape = matches!(c, '\\' | '-' | ':' | ',').then_some('\\');
                escape.into_iter().chain(std::iter::once(c))
            })
            .collect();
        let status = std::process::Command::new("fc-list")
            .arg("-q")
            .arg(pattern)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()?;
        status.code().map(|code| code == 0)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = family;
        None
    }
}

/// The guide as this keyboard reads it. Its shortcuts are written as on Linux
/// (`Ctrl+S`, kept in step with the commands by `guide.test.ts`); on macOS Ctrl reads Cmd
/// and Alt reads Option, as the menus and Search show them there. In the guide both
/// words only ever name keys.
pub fn guide(text: &str) -> std::borrow::Cow<'_, str> {
    #[cfg(target_os = "macos")]
    return std::borrow::Cow::Owned(mac_keys(text));
    #[cfg(not(target_os = "macos"))]
    std::borrow::Cow::Borrowed(text)
}

#[cfg(any(target_os = "macos", test))]
fn mac_keys(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut word = String::new();
    for c in text.chars().map(Some).chain(std::iter::once(None)) {
        if let Some(c) = c.filter(|c| c.is_alphanumeric()) {
            word.push(c);
            continue;
        }
        out.push_str(match word.as_str() {
            "Ctrl" => "Cmd",
            "Alt" => "Option",
            word => word,
        });
        word.clear();
        out.extend(c);
    }
    out
}

/// Makes a rename in `dir` durable (ARCHITECTURE.md §5.2, step 5). Filesystems that
/// can't sync a directory say so with `EINVAL`, which is not a failure of the save.
pub fn sync_dir(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        match fs::File::open(dir)?.sync_all() {
            Err(e) if e.raw_os_error() == Some(libc_einval()) => Ok(()),
            other => other,
        }
    }
    #[cfg(not(unix))]
    {
        // Windows has no directory handles to sync; NTFS journals the rename itself.
        let _ = dir;
        Ok(())
    }
}

#[cfg(unix)]
const fn libc_einval() -> i32 {
    22
}

/// Renames `from` to `to`, refusing with `AlreadyExists` if `to` exists, so a rename can
/// never replace a file (ARCHITECTURE.md §5.8). On Linux the check and the rename are one
/// atomic step (`renameat2` with `RENAME_NOREPLACE`); file systems without it, and other
/// platforms, check first. A rename that only changes case on a case-insensitive file
/// system finds "itself" at the target and goes ahead.
pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let c = |p: &Path| {
            CString::new(p.as_os_str().as_bytes())
                .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
        };
        let (old, new) = (c(from)?, c(to)?);
        // SAFETY: both arguments are valid NUL-terminated paths that outlive the call.
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                old.as_ptr(),
                libc::AT_FDCWD,
                new.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::EINVAL | libc::ENOSYS) => {} // not supported here: check first
            Some(libc::EEXIST) if same_file(from, to) => return fs::rename(from, to),
            _ => return Err(error),
        }
    }
    if fs::symlink_metadata(to).is_ok() && !same_file(from, to) {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs::rename(from, to)
}

/// Whether two paths name the same entry (not following a final link).
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    }
}

/// The system trash: freedesktop.org's on Linux through the `trash` crate, and the Trash
/// through `NSFileManager` on macOS (`macos`). Moving to the trash is the only way
/// bismillah removes anything (ARCHITECTURE.md §5.8).
pub struct SystemTrash;

#[cfg(not(target_os = "macos"))]
fn trash_error(e: trash::Error) -> LibraryError {
    match e {
        // Only the freedesktop backend has this variant; macOS reports `Unknown` or `Os`.
        #[cfg(all(unix, not(target_os = "macos")))]
        trash::Error::FileSystem { source, .. } => LibraryError::from_io(&source),
        trash::Error::RestoreCollision { .. } => LibraryError::Exists,
        trash::Error::CouldNotAccess { .. } => LibraryError::PermissionDenied,
        trash::Error::CanonicalizePath { .. } => LibraryError::NotFound,
        trash::Error::TargetedRoot => LibraryError::InvalidPath,
        // Descriptions may name paths, so only the kind of failure is kept.
        trash::Error::Os { code, .. } => LibraryError::Other {
            detail: format!("trash: os error {code}"),
        },
        _ => LibraryError::Other {
            detail: "trash".into(),
        },
    }
}

impl Trash for SystemTrash {
    fn trash(&self, path: &Path) -> Result<(), LibraryError> {
        #[cfg(target_os = "macos")]
        return macos::trash(path);
        #[cfg(not(target_os = "macos"))]
        trash::delete(path).map_err(trash_error)
    }

    fn restore(&self, path: &Path, since_s: i64) -> Result<(), LibraryError> {
        #[cfg(any(windows, all(unix, not(target_os = "macos"))))]
        {
            let items = trash::os_limited::list().map_err(trash_error)?;
            let newest = items
                .into_iter()
                .filter(|item| item.original_path() == path && item.time_deleted >= since_s)
                .max_by_key(|item| item.time_deleted)
                .ok_or(LibraryError::NotFound)?;
            trash::os_limited::restore_all([newest]).map_err(trash_error)
        }
        #[cfg(target_os = "macos")]
        return macos::restore(path, since_s);
        #[cfg(not(any(windows, unix)))]
        {
            let _ = (path, since_s);
            Err(LibraryError::Other {
                detail: "trash: restore unsupported".into(),
            })
        }
    }
}

/// The raw bytes of a path, for stable identifiers.
pub fn path_bytes(path: &Path) -> Vec<u8> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        path.as_os_str().as_bytes().to_vec()
    }
    #[cfg(not(unix))]
    {
        path.to_string_lossy().as_bytes().to_vec()
    }
}

/// Permissions for files only the writer may read (the recovery journal). `None` where
/// the platform has no such bits: per-user app-data directories are private already.
pub fn owner_only() -> Option<Permissions> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Some(Permissions::from_mode(0o600))
    }
    #[cfg(not(unix))]
    {
        None
    }
}

/// Creates a directory only the writer can enter (the recovery journal).
pub fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Writes a file only the writer can read, without the cost of an fsync.
pub fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    if let Some(private) = owner_only() {
        // An entry written before may have looser permissions.
        file.set_permissions(private)?;
    }
    Ok(())
}

/// One running bismillah per user session (ARCHITECTURE.md §12.2): the first launch
/// listens on a socket in the user's private runtime directory, and a later launch hands
/// its command line to it and exits. A local socket only; nothing leaves the machine.
pub enum Instance {
    /// This is the running app. `None` where there's no runtime directory to listen in.
    Primary(Option<InstanceListener>),
    /// Another bismillah took the message; this process should exit.
    Forwarded,
}

#[cfg(unix)]
pub struct InstanceListener {
    listener: std::os::unix::net::UnixListener,
    path: std::path::PathBuf,
}
#[cfg(not(unix))]
pub struct InstanceListener;

/// The largest command line a later launch may hand over.
const MAX_INSTANCE_MESSAGE: u64 = 64 * 1024;

/// Where a later launch finds the running app: a socket in a directory only this user
/// may enter. `None` leaves each launch on its own.
#[cfg(unix)]
pub fn instance_socket() -> Option<std::path::PathBuf> {
    socket_in(
        std::env::var_os("XDG_RUNTIME_DIR"),
        std::env::var_os("TMPDIR"),
    )
}

/// macOS has no `XDG_RUNTIME_DIR`. Its `TMPDIR` is the user's own (`/var/folders/…`,
/// mode 0700), unlike the shared `/tmp` elsewhere, so only macOS falls back to it.
#[cfg(unix)]
fn socket_in(
    runtime: Option<std::ffi::OsString>,
    temp: Option<std::ffi::OsString>,
) -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    let dir = runtime.or(temp)?;
    #[cfg(not(target_os = "macos"))]
    let dir = {
        let _ = temp;
        runtime?
    };
    Some(Path::new(&dir).join("bismillah.sock"))
}

/// Becomes the running app, or hands `message` to the one already running.
#[cfg(unix)]
pub fn claim_instance(socket: Option<&Path>, message: &[u8]) -> Instance {
    use std::io::Write;
    use std::os::unix::net::{UnixListener, UnixStream};
    let Some(socket) = socket else {
        return Instance::Primary(None);
    };
    if let Ok(mut stream) = UnixStream::connect(socket)
        && stream.write_all(message).is_ok()
    {
        return Instance::Forwarded;
    }
    // Nobody listens: a socket left by an app that was killed, or none at all.
    let _ = fs::remove_file(socket);
    match UnixListener::bind(socket) {
        Ok(listener) => Instance::Primary(Some(InstanceListener {
            listener,
            path: socket.to_path_buf(),
        })),
        Err(e) => {
            eprintln!(
                "bismillah: couldn't listen for other launches: {:?}",
                e.kind()
            );
            Instance::Primary(None)
        }
    }
}

#[cfg(not(unix))]
pub fn instance_socket() -> Option<std::path::PathBuf> {
    None
}

#[cfg(not(unix))]
pub fn claim_instance(_socket: Option<&Path>, _message: &[u8]) -> Instance {
    // Windows builds come later (ARCHITECTURE.md §12.3); it will use a named pipe.
    Instance::Primary(None)
}

impl InstanceListener {
    /// Passes each later launch's message to `handle`, on a thread of its own.
    #[cfg(unix)]
    pub fn serve(self, handle: impl Fn(Vec<u8>) + Send + 'static) {
        use std::io::Read;
        std::thread::spawn(move || {
            for stream in self.listener.incoming().flatten() {
                let mut message = Vec::new();
                if stream
                    .take(MAX_INSTANCE_MESSAGE)
                    .read_to_end(&mut message)
                    .is_ok()
                {
                    handle(message);
                }
            }
        });
    }

    #[cfg(not(unix))]
    pub fn serve(self, _handle: impl Fn(Vec<u8>) + Send + 'static) {}

    /// Removes the socket when the app exits normally.
    pub fn cleanup_path(&self) -> Option<std::path::PathBuf> {
        #[cfg(unix)]
        return Some(self.path.clone());
        #[cfg(not(unix))]
        return None;
    }
}

/// Whether the process runs as root, which ignores permission bits (tests skip
/// permission checks then).
#[cfg(test)]
pub fn is_root() -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::metadata("/proc/self").is_ok_and(|m| m.uid() == 0)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// The keyboard as the toolkit sees it, for the unlock screen's indicator: the layout
/// group of the last key pressed, the direction of the active layout, and Caps Lock.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct KeyState {
    pub group: u8,
    pub rtl: bool,
    pub caps: bool,
}

/// Cancels every native dialog the app has open (a file chooser and any question it
/// asked). The stick's lock calls it: under cage a dialog is a window of its own and
/// would stay above the lock, listing the writer's files and still taking input. Runs on
/// the main thread.
pub fn cancel_dialogs() {
    #[cfg(target_os = "linux")]
    linux::cancel_dialogs();
}

/// No native caret blink (os/PLAN.md, *A calm shutdown and a quiet laptop*). WebKit
/// blinks its own caret even where it is transparent, under the editor's drawn one, and
/// each blink redraws the page and the compositor for as long as the stick is on. The
/// editor's caret blinks and rests by itself; field carets stay steady. Not by turning
/// blinking off: WebKitGTK then redraws without pause. Instead the longest cycle GTK
/// takes, so a field caret turns over about every twelve days. Set on GTK's settings
/// directly: under Wayland GSettings' default outranks settings.ini.
pub fn steady_native_caret() {
    #[cfg(target_os = "linux")]
    linux::steady_native_caret();
}

/// Calls `changed` on every key press in `window` and every change of layout group or
/// modifiers. GTK 3 reports the active group only with each key event; direction and
/// Caps Lock are live (docs/spikes/os-keyboard.md).
pub fn watch_keyboard(window: &tauri::WebviewWindow, changed: impl Fn(KeyState) + Clone + 'static) {
    #[cfg(target_os = "linux")]
    linux::watch_keyboard(window, changed);
    #[cfg(not(target_os = "linux"))]
    let _ = (window, changed);
}

/// The Trash through `NSFileManager`, which moves at once and asks nothing. The `trash`
/// crate's default asks Finder by AppleScript, so macOS first asks whether the app may
/// control Finder, and nothing moves until the writer answers. macOS has no API to list
/// the Trash, so Undo puts back what this run moved, from where `NSFileManager` put it.
#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use objc2_foundation::{NSError, NSFileManager, NSString, NSURL};

    use crate::library::LibraryError;

    struct Trashed {
        from: PathBuf,
        to: PathBuf,
        at_s: i64,
    }

    static TRASHED: Mutex<Vec<Trashed>> = Mutex::new(Vec::new());

    pub fn trash(path: &Path) -> Result<(), LibraryError> {
        // APFS and HFS+ names are UTF-8, so a path that isn't can't name a file here.
        let text = path.to_str().ok_or(LibraryError::InvalidPath)?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(text));
        let mut landed = None;
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, Some(&mut landed))
            .map_err(|e| error(&e))?;
        if let Some(to) = landed.and_then(|url| url.path()) {
            let at_s = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX));
            lock().push(Trashed {
                from: path.to_path_buf(),
                to: PathBuf::from(to.to_string()),
                at_s,
            });
        }
        Ok(())
    }

    pub fn restore(path: &Path, since_s: i64) -> Result<(), LibraryError> {
        let mut trashed = lock();
        let i = trashed
            .iter()
            .rposition(|t| t.from == path && t.at_s >= since_s)
            .ok_or(LibraryError::NotFound)?;
        super::rename_no_replace(&trashed[i].to, path).map_err(|e| LibraryError::from_io(&e))?;
        trashed.remove(i);
        Ok(())
    }

    fn lock() -> std::sync::MutexGuard<'static, Vec<Trashed>> {
        TRASHED.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Foundation's file error codes (`NSFileNoSuchFileError` and its neighbours). Its
    /// descriptions name paths, so only the code is kept.
    pub(super) fn error(e: &NSError) -> LibraryError {
        match e.code() {
            4 | 260 => LibraryError::NotFound,
            257 | 513 => LibraryError::PermissionDenied,
            516 => LibraryError::Exists,
            code => LibraryError::Other {
                detail: format!("trash: Cocoa error {code}"),
            },
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use gtk::prelude::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(false);

    fn menu_bar(window: &tauri::WebviewWindow) -> Option<gtk::MenuBar> {
        let vbox = window.default_vbox().ok()?;
        vbox.children()
            .into_iter()
            .find_map(|w| w.downcast::<gtk::MenuBar>().ok())
    }

    pub fn watch_keyboard(
        window: &tauri::WebviewWindow,
        changed: impl Fn(super::KeyState) + Clone + 'static,
    ) {
        use gtk::gdk;
        use std::cell::Cell;
        use std::rc::Rc;
        let Ok(toplevel) = window.gtk_window() else {
            return;
        };
        let keymap = || gdk::Display::default().and_then(|d| gdk::Keymap::for_display(&d));
        let group = Rc::new(Cell::new(0u8));
        let state = move |group: u8| {
            let keymap = keymap();
            super::KeyState {
                group,
                rtl: keymap
                    .as_ref()
                    .is_some_and(|k| k.direction() == gtk::pango::Direction::Rtl),
                caps: keymap.as_ref().is_some_and(gdk::Keymap::is_caps_locked),
            }
        };
        // The toplevel sees each key before WebKit does.
        let (on_key, last) = (changed.clone(), group.clone());
        toplevel.connect_key_press_event(move |_, event| {
            last.set(event.group());
            on_key(state(event.group()));
            gtk::glib::Propagation::Proceed
        });
        if let Some(map) = gdk::Display::default().and_then(|d| gdk::Keymap::for_display(&d)) {
            map.connect_state_changed(move |_| changed(state(group.get())));
        }
    }

    /// A typewriter's webview: no sound, media, microphone or camera, real-time
    /// connections or WebGL. The editor uses none of them; wry turns WebAudio and WebGL
    /// on, and WebKit allows HTML media by default.
    pub fn quiet_webview(webview: &webkit2gtk::WebView) {
        use webkit2gtk::{SettingsExt, WebViewExt};
        let Some(settings) = WebViewExt::settings(webview) else {
            return;
        };
        settings.set_enable_webaudio(false);
        settings.set_enable_media(false);
        settings.set_enable_mediasource(false);
        settings.set_enable_media_stream(false);
        settings.set_enable_encrypted_media(false);
        settings.set_enable_webrtc(false);
        settings.set_enable_webgl(false);
    }

    pub fn steady_native_caret() {
        if let Some(settings) = gtk::Settings::default() {
            settings.set_gtk_cursor_blink_time(i32::MAX);
        }
    }

    pub fn cancel_dialogs() {
        for window in gtk::Window::list_toplevels() {
            if let Ok(dialog) = window.downcast::<gtk::Dialog>() {
                dialog.response(gtk::ResponseType::Cancel);
            }
        }
    }

    pub fn focus_menu_bar(window: &tauri::WebviewWindow) {
        let Some(bar) = menu_bar(window) else { return };
        if !HIDE_ON_CLOSE.swap(true, Ordering::SeqCst) {
            let window = window.clone();
            bar.connect_deactivate(move |_| {
                // Closing the menu (Esc, a choice, a click elsewhere) hides the bar again.
                let _ = window.hide_menu();
            });
        }
        bar.select_first(true);
    }

    pub fn menu_bar_active(window: &tauri::WebviewWindow) -> bool {
        menu_bar(window).is_some_and(|bar| bar.selected_item().is_some())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::Duration;

    #[cfg(target_os = "linux")]
    #[test]
    fn knows_installed_fonts_by_name_and_never_their_substitutes() {
        // Where fontconfig is missing nothing can be said, which is an answer too.
        if font_installed("sans-serif").is_none() {
            return;
        }
        assert_eq!(font_installed("bismillah: no such font, ever"), Some(false));
        assert_eq!(font_installed("No-Such:Font"), Some(false));
    }

    #[test]
    fn a_second_launch_hands_its_message_to_the_first() {
        let scratch = Scratch::new();
        let socket = scratch.path().join("instance.sock");
        let Instance::Primary(Some(listener)) = claim_instance(Some(&socket), b"first") else {
            panic!("the first launch must listen");
        };
        let (tx, rx) = mpsc::channel();
        listener.serve(move |message| {
            let _ = tx.send(message);
        });
        assert!(matches!(
            claim_instance(Some(&socket), b"second launch"),
            Instance::Forwarded
        ));
        let got = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("message arrives");
        assert_eq!(got, b"second launch");
    }

    #[test]
    fn renames_never_replace_an_existing_entry() {
        let scratch = Scratch::new();
        let a = scratch.file("a.md", b"a");
        let b = scratch.file("b.md", b"b");
        let err = rename_no_replace(&a, &b).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&b).unwrap(), b"b");
        fs::create_dir(scratch.path().join("folder")).unwrap();
        assert_eq!(
            rename_no_replace(&a, &scratch.path().join("folder"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        let c = scratch.path().join("c.md");
        rename_no_replace(&a, &c).unwrap();
        assert_eq!(fs::read(&c).unwrap(), b"a");
        assert!(!a.exists());
    }

    #[test]
    fn takes_over_a_socket_left_by_a_killed_app() {
        let scratch = Scratch::new();
        let socket = scratch.path().join("instance.sock");
        // A socket file nobody listens on, as a killed app leaves behind.
        drop(std::os::unix::net::UnixListener::bind(&socket).unwrap());
        assert!(socket.exists());
        assert!(matches!(
            claim_instance(Some(&socket), b"x"),
            Instance::Primary(Some(_))
        ));
    }

    #[test]
    fn paints_the_window_in_the_pages_own_colours() {
        let tokens = include_str!("../../src/styles/tokens.css");
        for ((r, g, b), token) in PAGE.iter().zip(["--paper-50", "--charcoal-950"]) {
            assert!(
                tokens.contains(&format!("{token}: #{r:02x}{g:02x}{b:02x};")),
                "{token}"
            );
        }
    }

    #[test]
    fn reads_the_guides_shortcuts_with_macos_key_names() {
        assert_eq!(
            mac_keys("Save (`Ctrl+S`), go (`Ctrl+Alt+G`), `Ctrl`+`Q`; Alternatively, Control."),
            "Save (`Cmd+S`), go (`Cmd+Option+G`), `Cmd`+`Q`; Alternatively, Control."
        );
        assert_eq!(
            mac_keys("| `` ` `` | ʿ |\n\"a\" = \"Ctrl+Shift+D\""),
            "| `` ` `` | ʿ |\n\"a\" = \"Cmd+Shift+D\""
        );
        let guide = include_str!("../../docs/guide.md");
        let mac = mac_keys(guide);
        assert!(!mac.contains("Ctrl"));
        assert_eq!(mac.replace("Cmd", "Ctrl").replace("Option", "Alt"), guide);
    }

    #[cfg(unix)]
    #[test]
    fn finds_the_running_app_in_a_directory_of_the_users_own() {
        let runtime = Some("/run/user/1000".into());
        let temp = Some("/var/folders/ab/T/".into());
        assert_eq!(
            socket_in(runtime.clone(), temp.clone()),
            Some(PathBuf::from("/run/user/1000/bismillah.sock"))
        );
        assert_eq!(socket_in(None, None), None);
        #[cfg(target_os = "macos")]
        assert_eq!(
            socket_in(None, temp),
            Some(PathBuf::from("/var/folders/ab/T/bismillah.sock"))
        );
        // /tmp is shared there, so another user could answer for the app.
        #[cfg(not(target_os = "macos"))]
        assert_eq!(socket_in(None, temp), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn explains_macos_trash_failures_without_touching_the_trash() {
        use objc2_foundation::{NSCocoaErrorDomain, NSError};
        // SAFETY: Foundation's constant, initialised before any code of ours runs.
        let domain = unsafe { NSCocoaErrorDomain };
        let cocoa = |code| macos::error(&NSError::new(code, domain));
        assert_eq!(cocoa(4), LibraryError::NotFound);
        assert_eq!(cocoa(513), LibraryError::PermissionDenied);
        assert_eq!(cocoa(516), LibraryError::Exists);
        assert_eq!(
            cocoa(640),
            LibraryError::Other {
                detail: "trash: Cocoa error 640".into()
            }
        );
        let scratch = Scratch::new();
        let never = scratch.path().join("never-trashed.md");
        assert_eq!(SystemTrash.restore(&never, 0), Err(LibraryError::NotFound));
        assert_eq!(SystemTrash.trash(&never), Err(LibraryError::NotFound));
    }

    /// Uses the writer's real Trash (ARCHITECTURE.md §13 keeps unit tests off it), and
    /// leaves it as it was: `cargo test -- --ignored` on a Mac.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "uses the real Trash"]
    fn trashes_and_puts_back_on_macos_without_replacing_a_new_file() {
        let scratch = Scratch::new();
        let path = std::fs::canonicalize(scratch.file("gone.md", b"words\n")).unwrap();
        SystemTrash.trash(&path).unwrap();
        assert!(!path.exists());
        SystemTrash.restore(&path, 0).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"words\n");

        SystemTrash.trash(&path).unwrap();
        fs::write(&path, b"a new file").unwrap();
        assert_eq!(SystemTrash.restore(&path, 0), Err(LibraryError::Exists));
        assert_eq!(fs::read(&path).unwrap(), b"a new file");
        // Out of the way, the first one comes back, so the test leaves the Trash as it was.
        fs::remove_file(&path).unwrap();
        SystemTrash.restore(&path, 0).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"words\n");

        assert_eq!(SystemTrash.restore(&path, 0), Err(LibraryError::NotFound));
    }
}
