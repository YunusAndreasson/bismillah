//! The app's lock, as the helper keeps it (os/PLAN.md, *Processes and trust*).
//!
//! The app keeps one events connection open. Over it the helper asks for the lock view
//! ([`Event::Lock`]) and the app reports it painted ([`Report::Painted`]). Whenever
//! that connection drops while home is open, the helper assumes the lock must go up:
//! until a passphrase is verified it answers only status, verify and power.
//!
//! Before sleep the helper gives the app [`BEFORE_SLEEP`] to paint the lock. Without an
//! answer it switches to an empty VT, so the compositor loses the display and nothing
//! of the document is on screen while the machine sleeps (docs/spikes/os-suspend-lock.md).

use crate::{home, mark, tools, vt};
use bismillah_appliance::{Event, MAX_LINE, Report};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// How long the app has to paint its lock view before the system sleeps. logind waits
/// at most `InhibitDelayMaxSec=` (5 s) for the helper, so this leaves room to switch.
pub const BEFORE_SLEEP: Duration = Duration::from_millis(1500);
/// After a fallback, how long the app has on resume to paint its lock view before its
/// session is restarted (a restarted session always opens locked).
const AFTER_RESUME: Duration = Duration::from_secs(3);
/// How long a keyboard change may take to restart the session and resume.
const RESUME_WINDOW: Duration = Duration::from_secs(60);
/// The VT with no getty and nothing on it (`NAutoVTs=0`).
const EMPTY_VT: u16 = 8;
/// The session's VT (bismillah-session.service, tty1).
const SESSION_VT: u16 = 1;
const SESSION_UNIT: &str = "bismillah-session.service";
const WRITER_SLICE: &str = "/sys/fs/cgroup/user.slice/user-1000.slice";

#[derive(Default)]
struct Inner {
    /// The app's events connection, and its number (a new one replaces the old).
    app: Option<(u64, UnixStream)>,
    next: u64,
    /// Home is open, but the lock is up until a passphrase is verified.
    locked: bool,
    /// The lock view has been reported painted since the last request for it.
    painted: bool,
    /// A keyboard change is restarting the session: it may resume without the lock.
    resume_until: Option<Instant>,
    /// The last sleep fell back to the empty VT.
    fell_back: bool,
}

#[derive(Default)]
pub struct Session {
    inner: Mutex<Inner>,
    changed: Condvar,
}

impl Session {
    /// The lock starts up if home is already open: the helper itself was restarted.
    pub fn new() -> Arc<Self> {
        let session = Arc::new(Self::default());
        session.lock().locked = home::is_mounted();
        session
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn locked(&self) -> bool {
        self.lock().locked
    }

    #[cfg(test)]
    pub fn lock_for_test(&self) {
        self.lock().locked = true;
    }

    /// A passphrase opened or verified home: the lock comes down.
    pub fn unlocked(&self) {
        let mut inner = self.lock();
        inner.locked = false;
        inner.resume_until = None;
    }

    /// The layouts changed and the app is about to restart its session for them.
    pub fn allow_resume(&self) {
        let mut inner = self.lock();
        if !inner.locked {
            inner.resume_until = Some(Instant::now() + RESUME_WINDOW);
        }
    }

    pub fn may_resume(&self) -> bool {
        self.lock()
            .resume_until
            .is_some_and(|until| Instant::now() < until)
    }

    /// Resumes after a keyboard change, once.
    pub fn resume(&self) -> bool {
        let mut inner = self.lock();
        let allowed = inner
            .resume_until
            .take()
            .is_some_and(|until| Instant::now() < until);
        if allowed {
            inner.locked = false;
        }
        allowed
    }

    /// Takes the app's events connection (the `events` request). If the lock is up, the
    /// app is asked for it at once.
    pub fn connect(self: &Arc<Self>, stream: UnixStream) {
        let Ok(reader) = stream.try_clone() else {
            return;
        };
        let id = {
            let mut inner = self.lock();
            inner.next += 1;
            let id = inner.next;
            if let Some((_, old)) = inner.app.replace((id, stream)) {
                let _ = old.shutdown(std::net::Shutdown::Both);
            }
            if inner.locked {
                inner.painted = false;
                send(&mut inner, Event::Lock);
            }
            id
        };
        mark("app-connected");
        let session = Arc::clone(self);
        std::thread::spawn(move || session.read(id, reader));
    }

    /// Reads the app's reports until the connection ends.
    fn read(&self, id: u64, stream: UnixStream) {
        let mut lines = BufReader::new(stream);
        let mut line = Vec::new();
        loop {
            line.clear();
            let read = (&mut lines)
                .take(MAX_LINE as u64)
                .read_until(b'\n', &mut line);
            if !matches!(read, Ok(n) if n > 0) {
                break;
            }
            if let Ok(Report::Painted) = serde_json::from_slice(&line) {
                mark("app-painted");
                self.lock().painted = true;
                self.changed.notify_all();
            }
        }
        let mut inner = self.lock();
        if inner
            .app
            .as_ref()
            .is_some_and(|(current, _)| *current == id)
        {
            inner.app = None;
            // The app may no longer be able to lock, so the lock is up from here.
            inner.locked = home::is_mounted();
            drop(inner);
            mark("app-disconnected");
        }
    }

    /// Asks the app to lock, without waiting (the lid closed).
    pub fn ask_lock(&self) {
        let mut inner = self.lock();
        inner.locked = home::is_mounted();
        inner.painted = false;
        send(&mut inner, Event::Lock);
    }

    /// Asks the app to lock and waits up to `limit` for its lock view.
    fn lock_and_wait(&self, limit: Duration) -> bool {
        let mut inner = self.lock();
        inner.locked = home::is_mounted();
        inner.painted = false;
        if !send(&mut inner, Event::Lock) {
            return false;
        }
        let end = Instant::now() + limit;
        while !inner.painted {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            inner = match self.changed.wait_timeout(inner, left) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
        true
    }

    /// logind's `PrepareForSleep(true)`: the lock view, or the empty VT, before the
    /// inhibitor is released.
    pub fn before_sleep(&self) {
        mark("prepare-sleep");
        let locked = self.lock_and_wait(BEFORE_SLEEP);
        if locked {
            mark("locked-before-sleep");
        } else {
            mark("fallback");
            vt::switch(EMPTY_VT);
        }
        self.lock().fell_back = !locked;
    }

    /// logind's `PrepareForSleep(false)`. After a fallback the empty VT stays until the
    /// app paints its lock view, or its session has been restarted.
    pub fn after_resume(self: &Arc<Self>) {
        mark("resumed");
        if !std::mem::take(&mut self.lock().fell_back) {
            return;
        }
        let session = Arc::clone(self);
        std::thread::spawn(move || {
            if session.lock_and_wait(AFTER_RESUME) {
                mark("late-lock-painted");
            } else {
                mark("restart-session");
                restart_session();
            }
            vt::switch(SESSION_VT);
            if session.locked() {
                mark("session-vt-locked");
            }
        });
    }
}

/// Sends an event on the app's connection; whether there was one to send it on.
fn send(inner: &mut Inner, event: Event) -> bool {
    let Some((_, stream)) = inner.app.as_mut() else {
        return false;
    };
    let mut line = serde_json::to_vec(&event).unwrap_or_default();
    line.push(b'\n');
    let sent = stream.write_all(&line).is_ok();
    if !sent {
        inner.app = None;
    }
    sent
}

/// Ends the writer's session, frozen processes too, then starts a new one on the
/// session's VT. Stopping the service alone hangs with a frozen app: cage waits for
/// its client, which lives in PAM's session scope and is never continued.
fn restart_session() {
    let _ = tools::status("systemctl", &["stop", "--no-block", SESSION_UNIT]);
    let pids = || session_pids(WRITER_SLICE);
    for signal in [libc::SIGTERM, libc::SIGCONT] {
        for pid in pids() {
            signal_pid(pid, signal);
        }
    }
    let end = Instant::now() + Duration::from_secs(2);
    while !pids().is_empty() && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(100));
    }
    for pid in pids() {
        signal_pid(pid, libc::SIGKILL);
    }
    let _ = tools::status("systemctl", &["stop", SESSION_UNIT]);
    mark("session-ended");
    // wlroots won't start on an inactive VT. Nothing of the old session is left to
    // show, so the session's VT can come back first.
    vt::switch(SESSION_VT);
    let _ = tools::status("systemctl", &["start", "--no-block", SESSION_UNIT]);
    mark("session-started");
}

/// Every process in the writer's login sessions (`session-*.scope`).
fn session_pids(slice: &str) -> Vec<i32> {
    let Ok(entries) = std::fs::read_dir(slice) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("session-") && name.ends_with(".scope")
        })
        .flat_map(|e| {
            std::fs::read_to_string(e.path().join("cgroup.procs"))
                .unwrap_or_default()
                .split_whitespace()
                .filter_map(|p| p.parse().ok())
                .collect::<Vec<i32>>()
        })
        .collect()
}

fn signal_pid(pid: i32, signal: i32) {
    if pid > 1 {
        // SAFETY: kill(2) reads no memory of ours; a pid that has gone only fails.
        unsafe { libc::kill(pid, signal) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_processes_of_session_scopes_only() {
        let dir = std::env::temp_dir().join(format!("bismillah-slice-{}", std::process::id()));
        for (scope, procs) in [
            ("session-3.scope", "120\n121\n"),
            ("session-c1.scope", "200\n"),
            ("user@1000.service", "300\n"),
        ] {
            std::fs::create_dir_all(dir.join(scope)).unwrap();
            std::fs::write(dir.join(scope).join("cgroup.procs"), procs).unwrap();
        }
        let mut pids = session_pids(dir.to_str().unwrap());
        pids.sort_unstable();
        assert_eq!(pids, [120, 121, 200]);
        assert!(session_pids("/nonexistent/slice").is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn resuming_is_granted_once_and_only_while_unlocked() {
        let session = Session::default();
        assert!(!session.resume());
        session.allow_resume();
        assert!(session.may_resume());
        assert!(session.resume());
        assert!(!session.resume());

        session.lock().locked = true;
        session.allow_resume();
        assert!(!session.may_resume());
    }

    #[test]
    fn a_lock_without_an_app_is_not_painted() {
        let session = Session::default();
        assert!(!session.lock_and_wait(Duration::from_millis(10)));
    }

    #[test]
    fn the_app_paints_its_lock_over_the_connection() {
        let session = Arc::new(Session::default());
        let (ours, theirs) = UnixStream::pair().unwrap();
        session.connect(ours);
        let app = std::thread::spawn(move || {
            let mut reader = BufReader::new(theirs.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line, "{\"event\":\"lock\"}\n");
            (&theirs).write_all(b"{\"report\":\"painted\"}\n").unwrap();
            theirs
        });
        assert!(session.lock_and_wait(Duration::from_secs(5)));
        let theirs = app.join().unwrap();
        drop(theirs);
        // A dropped connection: no app to ask any more.
        for _ in 0..50 {
            if session.lock().app.is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(session.lock().app.is_none());
    }
}
