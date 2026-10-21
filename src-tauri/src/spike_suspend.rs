//! OS-0 spike "Suspend lock fallback" (os/PLAN.md). Not product code.
//!
//! With `BISMILLAH_SPIKE_EVENTS` naming the sleep daemon's socket, the app keeps one
//! connection open. The daemon writes `lock` before sleep; the page shows the lock view
//! and, once it has been painted, the app answers `painted`. If the connection drops,
//! the daemon assumes the app can't lock and falls back to an empty VT.

use crate::spike_unlock::mark;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

struct Events(Mutex<UnixStream>);

/// Connects to the sleep daemon and forwards its `lock` requests to the page.
pub fn connect(app: &AppHandle) {
    let Some(path) = std::env::var_os("BISMILLAH_SPIKE_EVENTS") else {
        return;
    };
    let stream = match UnixStream::connect(&path) {
        Ok(stream) => stream,
        Err(e) => {
            mark(&format!("events-connect-failed-{:?}", e.kind()));
            return;
        }
    };
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    app.manage(Events(Mutex::new(stream)));
    mark("events-connected");
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) if line == "lock" => {
                    mark("app-lock-requested");
                    let _ = handle.emit("spike-lock", ());
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        mark("events-closed");
    });
}

/// The page has painted the lock view: tell the sleep daemon.
#[tauri::command]
pub fn spike_lock_painted(app: AppHandle) {
    mark("app-lock-painted");
    if let Some(events) = app.try_state::<Events>()
        && let Ok(mut stream) = events.0.lock()
    {
        let _ = stream.write_all(b"painted\n");
    }
}
