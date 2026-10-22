//! The bismillah stick's appliance layer (os/PLAN.md, Phases OS-2 and OS-3).
//!
//! The helper (`bismillah-helper`, root) owns the stick's home partition: it sets it
//! up, unlocks it and keeps the keyboard layouts in its LUKS2 header. It also locks the
//! app before the system sleeps, and powers the system off. The app asks it over a
//! Unix socket, one JSON line per request and one per answer. This library holds what
//! both sides share: the protocol and the passphrase rules.

/// Damaged request lines, for the parser's tests and the debug image's probe.
#[cfg(any(test, feature = "trace"))]
pub mod fuzz;
pub mod passphrase;
pub mod protocol;

pub use passphrase::{Secret, Strength};
pub use protocol::{
    Answer, Event, Home, Keyboard, KeyboardSource, MAX_LINE, PROTOCOL, PowerAction, Report,
    Request, SOCKET, Trouble,
};
