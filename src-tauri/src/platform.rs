//! All platform-specific code lives here (ARCHITECTURE.md §12.3).

use std::fs::{self, Permissions};
use std::io;
use std::path::Path;

use crate::library::{LibraryError, Trash};

/// Per-platform window setup after the main window is created.
pub fn configure_main_window(_window: &tauri::WebviewWindow) {}

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

/// Puts `html` and its plain-text alternative on the system clipboard (Copy as rich
/// text). Must run on the main thread.
pub fn write_clipboard(html: String, text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return linux::write_clipboard(html, text);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (html, text);
        Err("rich text copying isn't available on this platform yet".into())
    }
}

/// What the clipboard holds under `target`, as UTF-8 (the test hooks read back what
/// Copy as rich text offered). Must run on the main thread.
pub fn read_clipboard(target: &str) -> Option<String> {
    #[cfg(target_os = "linux")]
    return linux::read_clipboard(target);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = target;
        None
    }
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

/// The system trash (freedesktop.org trash on Linux), through the `trash` crate.
/// Moving to the trash is the only way bismillah removes anything (ARCHITECTURE.md §5.8).
pub struct SystemTrash;

fn trash_error(e: trash::Error) -> LibraryError {
    match e {
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
        #[cfg(not(any(windows, all(unix, not(target_os = "macos")))))]
        {
            // macOS builds come later (ARCHITECTURE.md §12.3); its trash has no listing API.
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

#[cfg(unix)]
pub fn instance_socket() -> Option<std::path::PathBuf> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")?;
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
    // Windows and macOS builds come later (ARCHITECTURE.md §12.3); they will use a
    // named pipe and the system's open-file events.
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

    pub fn read_clipboard(target: &str) -> Option<String> {
        let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        let data = clipboard.wait_for_contents(&gtk::gdk::Atom::intern(target))?;
        String::from_utf8(data.data()).ok()
    }

    const HTML: u32 = 0;
    const TEXT: u32 = 1;

    /// Offers the HTML as `text/html` and the text under the usual text targets, on X11
    /// and Wayland alike, until something else is copied.
    pub fn write_clipboard(html: String, text: String) -> Result<(), String> {
        let entry = |name: &str, info| gtk::TargetEntry::new(name, gtk::TargetFlags::empty(), info);
        let targets = [
            entry("text/html", HTML),
            entry("UTF8_STRING", TEXT),
            entry("text/plain;charset=utf-8", TEXT),
            entry("text/plain", TEXT),
            entry("STRING", TEXT),
            entry("TEXT", TEXT),
        ];
        // Paste targets read text/html as UTF-8 only when it says so.
        let html = format!("<meta charset=\"utf-8\">{html}");
        let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        let offered = clipboard.set_with_data(&targets, move |_, selection, info| {
            if info == HTML {
                selection.set(&gtk::gdk::Atom::intern("text/html"), 8, html.as_bytes());
            } else {
                selection.set_text(&text);
            }
        });
        if offered {
            Ok(())
        } else {
            Err("the clipboard refused the text".into())
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use std::sync::mpsc;
    use std::time::Duration;

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
}
