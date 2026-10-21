//! `bismillah-helper`: the stick's one privileged process (os/PLAN.md, *Processes and
//! trust*). It runs as root and owns the home partition.
//!
//! - `bismillah-helper` serves the app on the socket systemd passes it
//!   (bismillah-helper.socket), one request at a time, to uid 1000 only.
//! - `bismillah-helper keyboard-env` writes cage's layouts before the session starts.
//! - `bismillah-helper status` prints home's state (the debug image's console).
//!
//! Nothing it prints names a passphrase or a text.

mod disk;
mod home;
mod keyboard;
mod tools;

use bismillah_appliance::protocol::Envelope;
use bismillah_appliance::{
    Answer, Home, Keyboard, KeyboardSource, MAX_LINE, PROTOCOL, PowerAction, Request,
};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::FromRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use zeroize::Zeroizing;

/// The only user the helper answers: the session's `writer`.
const WRITER: u32 = 1000;
/// The first file descriptor systemd passes (sd_listen_fds).
const LISTEN_FD: i32 = 3;

fn main() {
    match std::env::args().nth(1).as_deref() {
        None => serve(),
        Some("keyboard-env") => {
            let (_, keyboard) = state();
            if keyboard::write_env(&keyboard).is_err() {
                std::process::exit(1);
            }
        }
        Some("status") => {
            let (home, keyboard) = state();
            println!(
                "{}",
                serde_json::to_string(&Answer::Status { home, keyboard }).unwrap_or_default()
            );
        }
        Some(_) => {
            eprintln!("usage: bismillah-helper [status|keyboard-env]");
            std::process::exit(2);
        }
    }
}

/// Home's state, or why the helper won't name a partition.
fn state() -> (Home, Keyboard) {
    match disk::home() {
        Ok(device) => home::status(&device),
        Err(reason) => (
            Home::NotFound { reason },
            Keyboard {
                layouts: "us".into(),
                options: String::new(),
                source: KeyboardSource::Default,
            },
        ),
    }
}

/// Whether the debug image asked for marks (`BISMILLAH_MARKS`, set by its drop-in).
fn marks() -> bool {
    std::env::var_os("BISMILLAH_MARKS").is_some()
}

/// Marks the end of a setup or unlock step: `BISMILLAH_MARK helper-<name> <uptime>`.
/// In the debug image a test can stop the helper here (`/run/bismillah/test-halt`
/// naming the step) and then cut the power, to prove each step leaves a safe state.
pub fn step(name: &str) {
    if !marks() {
        return;
    }
    let uptime = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    let seconds = uptime.split(' ').next().unwrap_or("?").to_owned();
    let _ = writeln!(std::io::stdout(), "BISMILLAH_MARK helper-{name} {seconds}");
    let halt = std::fs::read_to_string("/run/bismillah/test-halt").unwrap_or_default();
    if halt.trim() == name {
        let _ = writeln!(
            std::io::stdout(),
            "BISMILLAH_MARK helper-halted-{name} {seconds}"
        );
        let _ = std::io::stdout().flush();
        loop {
            std::thread::park();
        }
    }
}

fn serve() {
    let ours = std::env::var("LISTEN_PID").ok() == Some(std::process::id().to_string());
    let count: i32 = std::env::var("LISTEN_FDS")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    if !ours || count != 1 {
        eprintln!("bismillah-helper: start me through bismillah-helper.socket");
        std::process::exit(2);
    }
    // SAFETY: systemd passed exactly one socket (LISTEN_FDS=1, for this process), at
    // fd 3, and nothing else in this process owns or closes that descriptor.
    let listener = unsafe { UnixListener::from_raw_fd(LISTEN_FD) };
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        if peer_uid(&stream) != Some(WRITER) {
            continue;
        }
        handle(stream);
    }
}

fn peer_uid(stream: &UnixStream) -> Option<u32> {
    use std::os::fd::AsRawFd;
    let mut credentials = libc::ucred {
        pid: 0,
        uid: u32::MAX,
        gid: u32::MAX,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: the descriptor is the open socket `stream` owns; `credentials` and
    // `length` are valid for writes of the size passed, and outlive the call.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&raw mut credentials).cast(),
            &raw mut length,
        )
    };
    (result == 0).then_some(credentials.uid)
}

fn handle(stream: UnixStream) {
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    let mut line = Zeroizing::new(Vec::with_capacity(MAX_LINE));
    let read = BufReader::new(reader.take(MAX_LINE as u64)).read_until(b'\n', &mut line);
    let (answer, power) = match read {
        Ok(_) => match serde_json::from_slice::<Envelope>(&line) {
            Ok(envelope) if envelope.v == PROTOCOL => answer(envelope.request),
            _ => (
                Answer::Failed {
                    step: "protocol".into(),
                },
                None,
            ),
        },
        Err(_) => return,
    };
    drop(line);
    let mut text = serde_json::to_vec(&answer).unwrap_or_default();
    text.push(b'\n');
    let mut stream = stream;
    let _ = stream.write_all(&text);
    drop(stream);
    if let Some(action) = power {
        let verb = match action {
            PowerAction::Off => "poweroff",
            PowerAction::Reboot => "reboot",
        };
        let _ = tools::status("systemctl", &[verb]);
    }
}

/// The answer to a request, and a power action to take once it has been sent.
fn answer(request: Request) -> (Answer, Option<PowerAction>) {
    if let Request::Power { action } = request {
        return (Answer::Ok, Some(action));
    }
    let device: PathBuf = match disk::home() {
        Ok(device) => device,
        Err(reason) => {
            let refused = Answer::Refused {
                state: Home::NotFound { reason },
            };
            return match request {
                Request::Status => (state_answer(), None),
                _ => (refused, None),
            };
        }
    };
    let answer = match request {
        Request::Status => state_answer(),
        Request::Setup { passphrase } => home::setup(&device, &passphrase, keyboard::pending()),
        Request::Finish { passphrase } => home::finish(&device, &passphrase),
        Request::StartOver => home::start_over(&device),
        Request::Unlock { passphrase } => home::unlock(&device, &passphrase),
        Request::Verify { passphrase } => home::verify(&device, &passphrase),
        Request::SetKeyboard { layouts, options } => {
            home::set_keyboard(&device, keyboard::Layouts { layouts, options })
        }
        Request::Power { .. } => Answer::Ok,
    };
    (answer, None)
}

fn state_answer() -> Answer {
    let (home, keyboard) = state();
    Answer::Status { home, keyboard }
}
