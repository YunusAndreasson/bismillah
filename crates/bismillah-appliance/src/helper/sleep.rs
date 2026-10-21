//! Sleep: the helper holds a logind *delay* inhibitor, so before the system sleeps
//! logind waits (up to `InhibitDelayMaxSec=`) while the helper has the app lock, or
//! switches to the empty VT (session.rs). The inhibitor is taken again on resume.

use crate::mark;
use crate::session::Session;
use dbus::arg::OwnedFd;
use dbus::blocking::Connection;
use dbus::message::MatchRule;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const LOGIN1: &str = "org.freedesktop.login1";
const PATH: &str = "/org/freedesktop/login1";
const MANAGER: &str = "org.freedesktop.login1.Manager";

/// Runs for as long as the helper does, reconnecting if the system bus goes away.
pub fn watch(session: Arc<Session>) {
    loop {
        if let Err(e) = run(&session) {
            eprintln!(
                "bismillah-helper: sleep watch: {}",
                e.name().unwrap_or("dbus")
            );
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

fn run(session: &Arc<Session>) -> Result<(), dbus::Error> {
    let bus = Connection::new_system()?;
    let signal: Arc<Mutex<Option<bool>>> = Arc::default();
    let seen = Arc::clone(&signal);
    bus.add_match(
        MatchRule::new_signal(MANAGER, "PrepareForSleep").with_path(PATH),
        move |(starting,): (bool,), _, _| {
            if let Ok(mut seen) = seen.lock() {
                *seen = Some(starting);
            }
            true
        },
    )?;
    let mut held = Some(inhibit(&bus)?);
    loop {
        bus.process(Duration::from_secs(3600))?;
        let starting = signal.lock().ok().and_then(|mut s| s.take());
        match starting {
            Some(true) => {
                session.before_sleep();
                // Releasing the inhibitor lets the system sleep.
                held = None;
                mark("inhibitor-released");
            }
            Some(false) => {
                if held.is_none() {
                    held = Some(inhibit(&bus)?);
                }
                session.after_resume();
            }
            None => {}
        }
    }
}

/// A delay inhibitor for sleep; logind keeps it while the descriptor is open.
fn inhibit(bus: &Connection) -> Result<OwnedFd, dbus::Error> {
    let login = bus.with_proxy(LOGIN1, PATH, Duration::from_secs(5));
    let (fd,): (OwnedFd,) = login.method_call(
        MANAGER,
        "Inhibit",
        (
            "sleep",
            "bismillah",
            "Lock the screen before sleep",
            "delay",
        ),
    )?;
    mark("inhibitor-taken");
    Ok(fd)
}
