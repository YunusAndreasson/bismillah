//! The file recorder for the stick's allowlist (os/PLAN.md, OS-4). Built only with the
//! `trace` feature and installed only in the debug image, where a unit starts it at
//! boot when the VM harness asks (the `bismillah.trace` credential).
//!
//! It watches the root file system with fanotify (`FAN_OPEN`, `FAN_OPEN_EXEC`, the
//! whole file system, so the WebKit sandbox's bind mounts count too) and writes each
//! file the first time it is opened, as `TRACE /path`, to the file named on its
//! command line: the VM's third serial port, which survives power cuts. Files opened
//! before it started are taken from the running processes' maps. Opens by the debug
//! command line (the tests' own commands) aren't recorded.
//!
//!   bismillah-trace /dev/ttyS2

use std::collections::HashSet;
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};

/// What isn't the system: RAM, the writer's home and the kernel's own trees.
const NOT_SYSTEM: [&str; 6] = ["/run/", "/home/", "/proc/", "/sys/", "/dev/", "/tmp/"];
/// The cgroup of the debug image's root command line.
const DEBUG_CONSOLE: &str = "bismillah-debug-console.service";

fn main() {
    let Some(target) = std::env::args_os().nth(1) else {
        eprintln!("usage: bismillah-trace <output>");
        std::process::exit(2);
    };
    if let Err(error) = run(Path::new(&target)) {
        eprintln!("bismillah-trace: {error}");
        std::process::exit(1);
    }
}

fn run(target: &Path) -> std::io::Result<()> {
    let mut out = OpenOptions::new().append(true).open(target)?;
    let notify = init()?;
    let root = File::open("/")?;
    let mut recorded: HashSet<PathBuf> = HashSet::new();
    let mut seen: HashSet<Vec<u8>> = HashSet::new();
    let mut record = |path: PathBuf, out: &mut File| -> std::io::Result<()> {
        let text = path.to_string_lossy();
        if !NOT_SYSTEM.iter().any(|p| text.starts_with(p)) && recorded.insert(path.clone()) {
            writeln!(out, "TRACE {text}")?;
        }
        Ok(())
    };
    for path in mapped() {
        record(path, &mut out)?;
    }
    ready();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        // SAFETY: reads into a buffer we own, of the length we pass.
        let n = unsafe { libc::read(notify.as_raw_fd(), buffer.as_mut_ptr().cast(), buffer.len()) };
        if n < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        let mut at = 0usize;
        let end = usize::try_from(n).unwrap_or(0);
        while let Some(event) = Event::parse(&buffer[at..end]) {
            at += event.length;
            if event.overflow {
                writeln!(out, "TRACE-OVERFLOW")?;
                continue;
            }
            let Some(handle) = event.handle else { continue };
            if seen.contains(&handle) || from_debug_console(event.pid) {
                continue;
            }
            seen.insert(handle.clone());
            if let Some(path) = resolve(&root, &handle) {
                record(path, &mut out)?;
            }
        }
    }
}

/// A fanotify group for opens anywhere on the root's file system, reporting file handles.
fn init() -> std::io::Result<OwnedFd> {
    // SAFETY: plain syscalls with constant arguments; the result is checked.
    let fd = unsafe {
        libc::fanotify_init(
            libc::FAN_CLASS_NOTIF | libc::FAN_CLOEXEC | libc::FAN_REPORT_FID,
            libc::O_RDONLY as u32 | libc::O_LARGEFILE as u32,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: fanotify_init returned a new descriptor that nothing else owns.
    let notify = unsafe { OwnedFd::from_raw_fd(fd) };
    let root = CString::new("/").unwrap_or_default();
    // SAFETY: a valid descriptor and a NUL-terminated path.
    let marked = unsafe {
        libc::fanotify_mark(
            notify.as_raw_fd(),
            libc::FAN_MARK_ADD | libc::FAN_MARK_FILESYSTEM,
            libc::FAN_OPEN | libc::FAN_OPEN_EXEC,
            libc::AT_FDCWD,
            root.as_ptr(),
        )
    };
    if marked < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(notify)
}

/// One event from the buffer: its length, the opener and the opened file's handle.
struct Event {
    length: usize,
    pid: i32,
    overflow: bool,
    /// `handle_bytes`, `handle_type` and the handle, as `open_by_handle_at` takes them.
    handle: Option<Vec<u8>>,
}

impl Event {
    fn parse(b: &[u8]) -> Option<Event> {
        // struct fanotify_event_metadata: event_len u32, vers u8, reserved u8,
        // metadata_len u16, mask u64, fd i32, pid i32 (24 bytes).
        let u32_at = |i: usize| {
            b.get(i..i + 4)
                .map(|s| u32::from_ne_bytes([s[0], s[1], s[2], s[3]]))
        };
        let length = usize::try_from(u32_at(0)?).ok()?;
        if length < 24 || length > b.len() {
            return None;
        }
        let meta = usize::from(u16::from_ne_bytes([b[6], b[7]]));
        let mask = u64::from(u32_at(8)?) | (u64::from(u32_at(12)?) << 32);
        let pid = i32::from_ne_bytes(u32_at(20)?.to_ne_bytes());
        // The info record: header (type u8, pad u8, len u16), fsid (8 bytes), then
        // struct file_handle (handle_bytes u32, handle_type i32, f_handle[]).
        let info = b.get(meta..length)?;
        let handle = (info.first() == Some(&libc::FAN_EVENT_INFO_TYPE_FID) && info.len() > 20)
            .then(|| {
                let bytes = u32::from_ne_bytes([info[12], info[13], info[14], info[15]]);
                info.get(12..20 + usize::try_from(bytes).ok()?)
                    .map(<[u8]>::to_vec)
            })
            .flatten();
        Some(Event {
            length,
            pid,
            overflow: mask & libc::FAN_Q_OVERFLOW != 0,
            handle,
        })
    }
}

/// The handle's path under our root.
fn resolve(root: &File, handle: &[u8]) -> Option<PathBuf> {
    let mut owned = handle.to_vec();
    // SAFETY: `owned` holds a struct file_handle as the kernel reported it (its header
    // and `handle_bytes` of handle); open_by_handle_at only reads it.
    let fd = unsafe {
        libc::open_by_handle_at(
            root.as_raw_fd(),
            owned.as_mut_ptr().cast(),
            libc::O_PATH | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return None;
    }
    // SAFETY: a new descriptor that nothing else owns.
    let file = unsafe { OwnedFd::from_raw_fd(fd) };
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).ok()
}

fn from_debug_console(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/cgroup")).is_ok_and(|c| c.contains(DEBUG_CONSOLE))
}

/// The files the running processes have mapped or run: opened before we started.
fn mapped() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return paths;
    };
    for entry in procs.flatten() {
        let dir = entry.path();
        if let Ok(exe) = std::fs::read_link(dir.join("exe")) {
            paths.push(exe);
        }
        let maps = std::fs::read_to_string(dir.join("maps")).unwrap_or_default();
        for line in maps.lines() {
            if let Some(at) = line.find(" /") {
                let path = line[at + 1..].trim_end_matches(" (deleted)");
                paths.push(PathBuf::from(path));
            }
        }
    }
    paths
}

/// Tells systemd the recorder is watching (Type=notify), so later units are seen.
fn ready() {
    if let Some(socket) = std::env::var_os("NOTIFY_SOCKET")
        && let Ok(datagram) = UnixDatagram::unbound()
    {
        let _ = datagram.send_to(b"READY=1", socket);
    }
}
