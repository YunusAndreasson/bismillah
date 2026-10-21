//! The helper's protocol: one JSON request line, one JSON answer line, per connection.
//!
//! Requests carry the protocol version `v`; the helper refuses any other. Passphrases
//! travel as [`Secret`]s, which never print and are cleared when dropped.

use crate::passphrase::Secret;
use serde::{Deserialize, Serialize};

/// The version both sides speak.
pub const PROTOCOL: u32 = 1;

/// Where the helper listens (bismillah-helper.socket), owned by the writer, mode 0600.
pub const SOCKET: &str = "/run/bismillah/helper.sock";

/// The longest line either side accepts, so a confused peer can't grow a buffer.
pub const MAX_LINE: usize = 16 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "verb", rename_all = "snake_case")]
pub enum Request {
    /// What state home is in, and the keyboard layouts.
    Status,
    /// Blank home only: format it with this passphrase, then unlock it.
    Setup {
        passphrase: Secret,
    },
    /// Initialising home only: complete an interrupted setup, then unlock it.
    Finish {
        passphrase: Secret,
    },
    /// Initialising home only: erase the half-made setup, back to Blank.
    StartOver,
    /// Ready home: open and mount it.
    Unlock {
        passphrase: Secret,
    },
    /// Unlocked home: check the passphrase (the lock screen) without reopening.
    Verify {
        passphrase: Secret,
    },
    /// Stores the XKB layouts (comma-separated) and options, e.g. `se,ara` and
    /// `grp:alt_shift_toggle`. They apply when the session next starts.
    SetKeyboard {
        layouts: String,
        options: String,
    },
    Power {
        action: PowerAction,
    },
    /// Keeps the connection open for the lock handshake: the helper sends [`Event`]
    /// lines, the app answers with [`Report`] lines. One such connection at a time; a
    /// new one replaces the old.
    Events,
    /// After a keyboard change restarted the session: reopen the app on home without
    /// asking for the passphrase again. Granted once, shortly after `set_keyboard`.
    Resume,
}

/// What the helper tells the app on the events connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    /// Show the lock view now (the lid closed, the system is about to sleep, or the
    /// connection was lost while home was open), then report it painted.
    Lock,
}

/// What the app tells the helper on the events connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "report", rename_all = "snake_case")]
pub enum Report {
    /// The lock view is on screen: nothing of the document shows.
    Painted,
}

/// A request line: the version, then the request itself.
#[derive(Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    #[serde(flatten)]
    pub request: Request,
}

impl Request {
    /// The line to send, with its newline. Built in one buffer sized up front, so a
    /// passphrase isn't left behind in reallocated memory; the caller clears it.
    pub fn to_line(self) -> zeroize::Zeroizing<Vec<u8>> {
        let mut line = zeroize::Zeroizing::new(Vec::with_capacity(MAX_LINE));
        let envelope = Envelope {
            v: PROTOCOL,
            request: self,
        };
        if serde_json::to_writer(&mut *line, &envelope).is_err() || line.len() >= MAX_LINE {
            line.clear();
        }
        line.push(b'\n');
        line
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PowerAction {
    Off,
    Reboot,
    Suspend,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "answer", rename_all = "snake_case")]
pub enum Answer {
    Status {
        home: Home,
        keyboard: Keyboard,
        /// A keyboard change restarted the session: `resume` reopens home.
        #[serde(default)]
        resume: bool,
    },
    /// Done. For setup, finish and unlock: home is mounted at `/home/writer`.
    Ok,
    WrongPassphrase,
    /// Setup refused a passphrase below the strength the stick requires.
    TooWeak,
    /// The request doesn't fit home's state (e.g. setup on a stick that is set up).
    /// Nothing was changed.
    Refused {
        state: Home,
    },
    /// A step failed. `step` names it (e.g. `mount`); nothing that held text was erased.
    Failed {
        step: String,
    },
    /// A layout or option outside what XKB knows.
    InvalidKeyboard,
    /// The lock is up: only the passphrase (`verify`), status and power are answered.
    Locked,
}

/// The home partition's state (os/PLAN.md, *The home partition's state*). Formatting
/// is reachable from `Blank` only, and erasing from `Initialising` only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Home {
    /// Nothing on it but zeros, as flash left it: setup.
    Blank,
    /// Setup began but didn't finish, so it holds no texts: finish or start over.
    Initialising,
    /// Set up and locked: unlock.
    Ready,
    /// Open and mounted.
    Unlocked,
    /// Something the helper won't touch: damaged, foreign or unknown.
    Unreadable { reason: Trouble },
    /// The helper can't tell which partition is this stick's home, so it touches none.
    NotFound { reason: Trouble },
}

/// Why home is unreadable or not found. Kinds only, for the screen to explain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trouble {
    /// Not zeros, not LUKS: something else was written there.
    Foreign,
    /// A LUKS header the helper can't read.
    DamagedHeader,
    /// A LUKS header without bismillah's state token, or with a state it doesn't know.
    UnknownToken,
    /// The passphrase opened it, but its file system won't check or mount.
    DamagedFileSystem,
    /// Two bismillah sticks of the same build are attached.
    TwoSticks,
    /// No home partition on the disk the system started from.
    NoHome,
    /// The system's disk couldn't be worked out.
    NoBootDisk,
}

/// The keyboard layouts cage was started with, and where they came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Keyboard {
    pub layouts: String,
    pub options: String,
    pub source: KeyboardSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyboardSource {
    /// The LUKS2 token in home's header.
    Token,
    /// Chosen during setup, held in RAM until home is formatted.
    Pending,
    /// None chosen yet: cage's default (`us`).
    Default,
    /// The token couldn't be read, so cage uses `us`; the unlock screen says so.
    Damaged,
}

/// Whether `layouts` and `options` are plausible XKB names: letters, digits and the
/// few punctuation marks XKB uses. Up to four layouts. The helper also checks them
/// against the installed XKB rules.
pub fn keyboard_names_valid(layouts: &str, options: &str) -> bool {
    let name = |s: &str| {
        !s.is_empty()
            && s.len() <= 64
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "_-()".contains(c))
    };
    let parts: Vec<&str> = layouts.split(',').collect();
    let option_ok = |o: &str| {
        o.split_once(':')
            .is_some_and(|(group, value)| name(group) && name(value))
    };
    (1..=4).contains(&parts.len())
        && parts.iter().all(|l| name(l))
        && (options.is_empty() || options.split(',').all(option_ok))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(line: &[u8]) -> Envelope {
        serde_json::from_slice(line).expect("valid request")
    }

    #[test]
    fn requests_carry_the_version_and_the_exact_passphrase() {
        // Swedish and Arabic letters, a space and a trailing newline-like character:
        // the helper must hand cryptsetup exactly these bytes.
        let typed = "åäö بلا 7\u{2028}";
        let line = Request::Unlock {
            passphrase: Secret::new(typed.to_owned()),
        }
        .to_line();
        assert_eq!(line.last(), Some(&b'\n'));
        let envelope = parse(&line);
        assert_eq!(envelope.v, PROTOCOL);
        match envelope.request {
            Request::Unlock { passphrase } => assert_eq!(passphrase.expose(), typed),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn a_passphrase_never_prints() {
        let request = Request::Setup {
            passphrase: Secret::new("hunter2-secret".to_owned()),
        };
        assert!(!format!("{request:?}").contains("hunter2"));
    }

    #[test]
    fn answers_round_trip() {
        for answer in [
            Answer::Ok,
            Answer::Refused {
                state: Home::Unreadable {
                    reason: Trouble::UnknownToken,
                },
            },
            Answer::Status {
                home: Home::NotFound {
                    reason: Trouble::TwoSticks,
                },
                keyboard: Keyboard {
                    layouts: "se,ara".into(),
                    options: "grp:alt_shift_toggle".into(),
                    source: KeyboardSource::Token,
                },
                resume: true,
            },
            Answer::Locked,
        ] {
            let json = serde_json::to_string(&answer).expect("serialises");
            assert_eq!(serde_json::from_str::<Answer>(&json).ok(), Some(answer));
        }
        assert_eq!(
            serde_json::to_string(&Answer::WrongPassphrase)
                .ok()
                .as_deref(),
            Some(r#"{"answer":"wrong_passphrase"}"#)
        );
    }

    #[test]
    fn events_and_reports_are_tagged_lines() {
        assert_eq!(
            serde_json::to_string(&Event::Lock).ok().as_deref(),
            Some(r#"{"event":"lock"}"#)
        );
        assert_eq!(
            serde_json::from_str::<Report>(r#"{"report":"painted"}"#).ok(),
            Some(Report::Painted)
        );
        assert!(serde_json::from_str::<Report>(r#"{"report":"unlocked"}"#).is_err());
        // An older helper's status, without `resume`, still reads.
        let old = r#"{"answer":"status","home":{"state":"ready"},"keyboard":{"layouts":"us","options":"","source":"default"}}"#;
        assert!(matches!(
            serde_json::from_str::<Answer>(old),
            Ok(Answer::Status { resume: false, .. })
        ));
    }

    #[test]
    fn unknown_verbs_and_fields_are_errors() {
        assert!(serde_json::from_str::<Envelope>(r#"{"v":1,"verb":"format"}"#).is_err());
        assert!(serde_json::from_str::<Envelope>(r#"{"v":1}"#).is_err());
        assert!(serde_json::from_str::<Envelope>(r#"{"verb":"status"}"#).is_err());
    }

    #[test]
    fn keyboard_names() {
        assert!(keyboard_names_valid("se", ""));
        assert!(keyboard_names_valid("se,ara", "grp:alt_shift_toggle"));
        assert!(keyboard_names_valid(
            "us,ara(qwerty),se,de",
            "grp:win_space_toggle"
        ));
        assert!(!keyboard_names_valid("", ""));
        assert!(!keyboard_names_valid("se,", ""));
        assert!(!keyboard_names_valid("a,b,c,d,e", ""));
        assert!(!keyboard_names_valid("se\nXKB_X=1", ""));
        assert!(!keyboard_names_valid("se", "grp"));
        assert!(!keyboard_names_valid("se", "grp:a b"));
        assert!(!keyboard_names_valid("se\"", ""));
    }
}
