//! The bismillah stick's appliance layer (os/PLAN.md, Phase OS-2).
//!
//! The helper (`bismillah-helper`, root) owns the stick's home partition: it sets it
//! up, unlocks it and keeps the keyboard layouts in its LUKS2 header. The app asks it
//! over a Unix socket, one JSON line per request and one per answer. This library
//! holds what both sides share: the protocol and the passphrase rules.

pub mod passphrase;
pub mod protocol;

pub use passphrase::{Secret, Strength};
pub use protocol::{
    Answer, Home, Keyboard, KeyboardSource, MAX_LINE, PROTOCOL, PowerAction, Request, SOCKET,
    Trouble,
};
