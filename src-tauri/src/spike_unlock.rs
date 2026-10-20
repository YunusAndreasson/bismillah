//! OS-0 spike "Unlock in the app" (os/PLAN.md). Not product code.
//!
//! With `BISMILLAH_SPIKE_UNLOCK` naming the helper's socket, the app starts before the
//! writer's home is mounted. Everything that reads home (state, settings, recovery,
//! the dictionary, the watchers) waits in `Gate` until the helper has unlocked it, then
//! runs in this same process. `BISMILLAH_SPIKE_RESTART=1` measures the alternative:
//! the app exits after the unlock and the session starts it again.
//! Marks go to stdout as `BISMILLAH_MARK <name> <uptime seconds>`.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

type Start = Box<dyn FnOnce(&AppHandle) -> Result<(), String> + Send>;

pub struct Gate {
    socket: PathBuf,
    start: Mutex<Option<Start>>,
}

impl Gate {
    pub(crate) fn socket(&self) -> &PathBuf {
        &self.socket
    }

    pub fn new(socket: PathBuf, start: Start) -> Self {
        Self {
            socket,
            start: Mutex::new(Some(start)),
        }
    }
}

/// Exit code that asks the session launcher to start the app again inside cage.
const RESTART: i32 = 75;

pub fn socket() -> Option<PathBuf> {
    std::env::var_os("BISMILLAH_SPIKE_UNLOCK").map(PathBuf::from)
}

pub fn mark(name: &str) {
    let uptime = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    let seconds = uptime.split(' ').next().unwrap_or("?");
    // Not println!, which panics when stdout (the serial port here) can't be written.
    let _ = writeln!(std::io::stdout(), "BISMILLAH_MARK {name} {seconds}");
}

/// One request to the helper: each line sent, then its one-line answer.
pub(crate) fn ask(socket: &PathBuf, lines: &[&str]) -> Result<String, String> {
    let mut stream = UnixStream::connect(socket).map_err(|e| format!("connect: {}", e.kind()))?;
    let mut request = String::new();
    for line in lines {
        request.push_str(line);
        request.push('\n');
    }
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("write: {}", e.kind()))?;
    let mut answer = String::new();
    BufReader::new(stream)
        .read_line(&mut answer)
        .map_err(|e| format!("read: {}", e.kind()))?;
    Ok(answer.trim().to_owned())
}

/// The helper's state (`setup`, `locked` or `unlocked`), or null when the app isn't
/// gated or has already started.
#[tauri::command]
pub fn spike_gate(app: AppHandle) -> Result<Option<String>, String> {
    let Some(gate) = app.try_state::<Gate>() else {
        return Ok(None);
    };
    if gate.start.lock().map(|s| s.is_none()).unwrap_or(true) {
        return Ok(None);
    }
    ask(&gate.socket, &["status"]).map(Some)
}

/// Asks the helper to set up or unlock home; on `ok`, runs the deferred startup.
#[tauri::command]
pub async fn spike_unlock(
    app: AppHandle,
    verb: String,
    passphrase: String,
) -> Result<String, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let gate = handle.try_state::<Gate>().ok_or("not gated")?;
        if verb != "setup" && verb != "unlock" {
            return Err("unknown verb".to_owned());
        }
        mark("app-unlock-sent");
        // A restarted app finds home unlocked and asks with no passphrase.
        let typed = !passphrase.is_empty();
        let answer = ask(&gate.socket, &[&verb, &passphrase])?;
        drop(passphrase);
        mark("app-unlock-answered");
        if answer != "ok" {
            return Ok(answer);
        }
        if typed && std::env::var_os("BISMILLAH_SPIKE_RESTART").is_some() {
            mark("app-exit-for-restart");
            std::process::exit(RESTART);
        }
        let start = gate.start.lock().ok().and_then(|mut s| s.take());
        if let Some(start) = start {
            start(&handle)?;
        }
        mark("app-started");
        Ok(answer)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lets the page put its own marks next to the helper's and Rust's.
#[tauri::command]
pub fn spike_mark(name: String) {
    if socket().is_some() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        mark(&format!("page-{name}"));
    }
}
