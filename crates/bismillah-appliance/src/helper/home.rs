//! The home partition: its state, and the steps between states (os/PLAN.md,
//! *The home partition's state*).
//!
//! - **Blank** (zeros, as flash left it) is the only state that can be formatted.
//! - **Initialising** has bismillah's state token from the moment the header exists:
//!   the header is made in RAM with both tokens and written to the stick in one step.
//!   It holds no texts, because the app only gets home once the token says `ready`.
//! - **Ready** is never formatted or erased, whatever is typed.
//! - Anything else is **Unreadable**, and nothing on the stick changes.

use crate::keyboard::{self, Layouts};
use crate::{step, tools};
use bismillah_appliance::passphrase::{self, Secret};
use bismillah_appliance::{Answer, Home, Keyboard, KeyboardSource, Trouble};
use std::ffi::OsString;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// The LUKS2 token type that holds the setup state, in token slot 0.
const STATE_TOKEN: &str = "bismillah-state";
const STATE_ID: &str = "0";
/// The device-mapper name of the open home.
const MAPPER: &str = "bismillah-home";
const MAPPED: &str = "/dev/mapper/bismillah-home";
const MOUNT: &str = "/home/writer";
const WRITER: u32 = 1000;
/// Written last before `ready`, so a finished setup can be told from a started one.
const MARKER: &str = ".bismillah-home";
/// The header is built here, in RAM, before it is written to the stick.
const HEADER: &str = "/run/bismillah/setup-header";
/// LUKS2's default header: two 16 KiB metadata copies and the keyslot area. Data
/// starts right after it, as with an attached header.
const HEADER_BYTES: u64 = 16 * 1024 * 1024;
const MIB: u64 = 1024 * 1024;

/// What the first and last MiB checks read: the primary and secondary LUKS2 headers
/// (the secondary sits at most 4 MiB in), and the end, where a GPT or md would be.
const BLANK_HEAD: u64 = 8 * MIB;
const BLANK_TAIL: u64 = MIB;

/// The state of the partition at `device`, and its keyboard layouts.
pub fn status(device: &Path) -> (Home, Keyboard) {
    let (home, metadata) = classify(device);
    let keyboard = match metadata.as_ref().and_then(keyboard::from_metadata) {
        Some(Ok(layouts)) => layouts.into_keyboard(KeyboardSource::Token),
        Some(Err(())) => default_keyboard(KeyboardSource::Damaged),
        None => match keyboard::pending() {
            Some(layouts) if home == Home::Blank => layouts.into_keyboard(KeyboardSource::Pending),
            _ => default_keyboard(KeyboardSource::Default),
        },
    };
    (home, keyboard)
}

fn default_keyboard(source: KeyboardSource) -> Keyboard {
    Keyboard {
        layouts: "us".into(),
        options: String::new(),
        source,
    }
}

/// The partition's state and, for a LUKS2 partition, its header's JSON metadata.
fn classify(device: &Path) -> (Home, Option<serde_json::Value>) {
    if is_mounted() && Path::new(MAPPED).exists() {
        return (Home::Unlocked, header_metadata(device).ok());
    }
    match tools::probe(device) {
        Some(kind) if kind == "crypto_LUKS" => match header_metadata(device) {
            Ok(metadata) => (state_of(&metadata), Some(metadata)),
            Err(()) => (unreadable(Trouble::DamagedHeader), None),
        },
        Some(_) => (unreadable(Trouble::Foreign), None),
        None if zeros(device).unwrap_or(false) => (Home::Blank, None),
        None => (unreadable(Trouble::Foreign), None),
    }
}

fn unreadable(reason: Trouble) -> Home {
    Home::Unreadable { reason }
}

/// The state token's verdict on a LUKS2 header.
pub fn state_of(metadata: &serde_json::Value) -> Home {
    let Some(tokens) = metadata.get("tokens").and_then(|t| t.as_object()) else {
        return unreadable(Trouble::UnknownToken);
    };
    let states: Vec<Option<&str>> = tokens
        .values()
        .filter(|t| t.get("type").and_then(|v| v.as_str()) == Some(STATE_TOKEN))
        .map(|t| t.get("state").and_then(|v| v.as_str()))
        .collect();
    match states.as_slice() {
        [Some("initialising")] => Home::Initialising,
        [Some("ready")] => Home::Ready,
        _ => unreadable(Trouble::UnknownToken),
    }
}

fn state_token(state: &str) -> String {
    serde_json::json!({ "type": STATE_TOKEN, "keyslots": [], "state": state, "version": 1 })
        .to_string()
}

fn header_metadata(device: &Path) -> Result<serde_json::Value, ()> {
    let json = tools::output(
        "cryptsetup",
        &with_device(&["luksDump", "--dump-json-metadata"], device),
    )
    .ok_or(())?;
    serde_json::from_slice(&json).map_err(|_| ())
}

/// Whether the partition's first 8 MiB and last MiB are all zeros.
fn zeros(device: &Path) -> std::io::Result<bool> {
    let mut file = std::fs::File::open(device)?;
    let size = file.seek(SeekFrom::End(0))?;
    let mut buffer = vec![0u8; MIB as usize];
    let mut all_zero =
        |file: &mut std::fs::File, from: u64, length: u64| -> std::io::Result<bool> {
            file.seek(SeekFrom::Start(from))?;
            let mut left = length;
            while left > 0 {
                let chunk = left.min(MIB) as usize;
                let part = buffer.get_mut(..chunk).unwrap_or_default();
                file.read_exact(part)?;
                if part.iter().any(|&b| b != 0) {
                    return Ok(false);
                }
                left -= chunk as u64;
            }
            Ok(true)
        };
    let head = BLANK_HEAD.min(size);
    Ok(all_zero(&mut file, 0, head)?
        && all_zero(
            &mut file,
            size.saturating_sub(BLANK_TAIL),
            BLANK_TAIL.min(size),
        )?)
}

/// Whether home is mounted at `/home/writer`.
pub fn is_mounted() -> bool {
    std::fs::read_to_string("/proc/self/mountinfo")
        .map(|m| m.lines().any(|l| l.split(' ').nth(4) == Some(MOUNT)))
        .unwrap_or(false)
}

/// Blank → formatted, unlocked and Ready.
pub fn setup(device: &Path, passphrase: &Secret, layouts: Option<Layouts>) -> Answer {
    if let Some(refused) = require(device, &Home::Blank) {
        return refused;
    }
    if !passphrase::strength(passphrase.expose()).enough {
        return Answer::TooWeak;
    }
    step("setup-start");
    if let Err(answer) = write_header(device, passphrase, layouts.as_ref()) {
        return answer;
    }
    keyboard::clear_pending();
    step("formatted");
    complete(device, passphrase, true)
}

/// Initialising → Ready: the same steps, each done only if it is missing.
pub fn finish(device: &Path, passphrase: &Secret) -> Answer {
    if let Some(refused) = require(device, &Home::Initialising) {
        return refused;
    }
    step("finish-start");
    complete(device, passphrase, false)
}

/// Builds the header in RAM, with the state token (`initialising`) and the layouts,
/// then writes it to the stick in one step.
fn write_header(
    device: &Path,
    passphrase: &Secret,
    layouts: Option<&Layouts>,
) -> Result<(), Answer> {
    let failed = |step: &str| Answer::Failed { step: step.into() };
    let header = Path::new(HEADER);
    let _ = std::fs::remove_file(header);
    let made = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(header)
        .and_then(|f| f.set_len(HEADER_BYTES));
    if made.is_err() {
        return Err(failed("header-file"));
    }
    let memory = kdf_memory_kib().to_string();
    let offset = (HEADER_BYTES / 512).to_string();
    let format = tools::run_secret(
        "cryptsetup",
        &with_device(
            &[
                "luksFormat",
                "--batch-mode",
                "--type",
                "luks2",
                "--pbkdf",
                "argon2id",
                "--pbkdf-memory",
                &memory,
                "--pbkdf-parallel",
                "4",
                "--iter-time",
                "1000",
                "--label",
                "bismillah",
                "--header",
                HEADER,
                "--offset",
                &offset,
                "--key-file=-",
            ],
            device,
        ),
        passphrase,
    );
    let tokens = format == Some(0)
        && import_token(header, STATE_ID, &state_token("initialising"))
        && layouts.is_none_or(|l| import_token(header, keyboard::TOKEN_ID, &l.token()));
    let restored = tokens
        && tools::status(
            "cryptsetup",
            &with_device(
                &[
                    "luksHeaderRestore",
                    "--batch-mode",
                    "--header-backup-file",
                    HEADER,
                ],
                device,
            ),
        );
    let _ = std::fs::remove_file(header);
    if !restored {
        return Err(failed(if format == Some(0) {
            "header"
        } else {
            "format"
        }));
    }
    tools::flush(device);
    Ok(())
}

/// Argon2id's memory: 1 GiB, or a quarter of the RAM on a smaller machine (KiB).
fn kdf_memory_kib() -> u64 {
    let total = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|m| {
            m.lines()
                .find_map(|l| l.strip_prefix("MemTotal:"))
                .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
        })
        .unwrap_or(0);
    (total / 4).clamp(64 * 1024, 1024 * 1024)
}

fn import_token(device: &Path, id: &str, json: &str) -> bool {
    let args = with_device(
        &[
            "token",
            "import",
            "--token-id",
            id,
            "--token-replace",
            "--json-file=-",
        ],
        device,
    );
    tools::run_input("cryptsetup", &args, json.as_bytes())
}

/// Opens home, makes its file system and folders where they are missing, marks it
/// ready and leaves it mounted. `fresh`: the volume was formatted just now.
fn complete(device: &Path, passphrase: &Secret, fresh: bool) -> Answer {
    let failed = |step: &str| Answer::Failed { step: step.into() };
    if let Err(answer) = open(device, passphrase) {
        return answer;
    }
    // Only Initialising volumes reach here, and they never held a text, so an
    // unusable file system is simply made again.
    let has_fs = !fresh && tools::probe(Path::new(MAPPED)).is_some();
    if !has_fs && !make_filesystem() {
        return close_after(failed("mkfs"));
    }
    if !has_fs {
        step("filesystem");
    }
    if !mount() {
        if fresh || !make_filesystem() || !mount() {
            return close_after(failed("mount"));
        }
        step("filesystem");
    }
    if prepare_folders().is_err() {
        return unmount_after(failed("folders"));
    }
    step("marker");
    if !import_token(device, STATE_ID, &state_token("ready")) {
        return unmount_after(failed("ready"));
    }
    tools::flush(device);
    step("ready");
    Answer::Ok
}

/// Initialising → Blank. The layouts are kept for the next setup.
pub fn start_over(device: &Path) -> Answer {
    let (home, metadata) = classify(device);
    if home != Home::Initialising {
        return Answer::Refused { state: home };
    }
    if let Some(Ok(layouts)) = metadata.as_ref().and_then(keyboard::from_metadata) {
        let _ = keyboard::set_pending(&layouts);
    }
    let _ = tools::status("umount", &[MOUNT]);
    let _ = tools::status("cryptsetup", &["close", MAPPER]);
    if erase(device).is_err() {
        return Answer::Failed {
            step: "erase".into(),
        };
    }
    tools::flush(device);
    match classify(device).0 {
        Home::Blank => Answer::Ok,
        _ => Answer::Failed {
            step: "erase".into(),
        },
    }
}

/// Zeros the header area and the partition's last MiB: what flash left there.
fn erase(device: &Path) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new().write(true).open(device)?;
    let size = file.seek(SeekFrom::End(0))?;
    let zeros = vec![0u8; MIB as usize];
    let zero = |file: &mut std::fs::File, from: u64, length: u64| -> std::io::Result<()> {
        file.seek(SeekFrom::Start(from))?;
        for _ in 0..length / MIB {
            file.write_all(&zeros)?;
        }
        Ok(())
    };
    zero(&mut file, 0, (HEADER_BYTES).min(size))?;
    zero(&mut file, size.saturating_sub(MIB), MIB.min(size))?;
    file.sync_all()
}

/// Ready → Unlocked.
pub fn unlock(device: &Path, passphrase: &Secret) -> Answer {
    if let Some(refused) = require(device, &Home::Ready) {
        return refused;
    }
    step("unlock-start");
    if let Err(answer) = open(device, passphrase) {
        return answer;
    }
    step("opened");
    // After a power cut: replay the journal and repair what preening may repair.
    // Anything worse is left alone, unmounted, for the dev machine.
    let check = tools::code("e2fsck", &["-p", MAPPED]);
    if check.is_none_or(|code| code >= 4) || !mount() {
        return close_after(Answer::Refused {
            state: unreadable(Trouble::DamagedFileSystem),
        });
    }
    // A Ready home always has its folders; recreate them if the writer's were lost.
    if prepare_folders().is_err() {
        return unmount_after(Answer::Failed {
            step: "folders".into(),
        });
    }
    step("unlocked");
    Answer::Ok
}

/// The lock screen's check: is this home's passphrase? Nothing is reopened.
pub fn verify(device: &Path, passphrase: &Secret) -> Answer {
    if let Some(refused) = require(device, &Home::Unlocked) {
        return refused;
    }
    let args = with_device(&["open", "--test-passphrase", "--key-file=-"], device);
    match tools::run_secret("cryptsetup", &args, passphrase) {
        Some(0) => Answer::Ok,
        Some(2) => Answer::WrongPassphrase,
        _ => Answer::Failed {
            step: "verify".into(),
        },
    }
}

/// Stores the layouts: in the header once there is one, in RAM before.
pub fn set_keyboard(device: &Path, layouts: Layouts) -> Answer {
    if !keyboard::valid(&layouts.layouts, &layouts.options) {
        return Answer::InvalidKeyboard;
    }
    match classify(device).0 {
        Home::Blank => match keyboard::set_pending(&layouts) {
            Ok(()) => Answer::Ok,
            Err(_) => Answer::Failed {
                step: "keyboard".into(),
            },
        },
        Home::Initialising | Home::Ready | Home::Unlocked => {
            if import_token(device, keyboard::TOKEN_ID, &layouts.token()) {
                tools::flush(device);
                Answer::Ok
            } else {
                Answer::Failed {
                    step: "keyboard".into(),
                }
            }
        }
        state => Answer::Refused { state },
    }
}

fn require(device: &Path, wanted: &Home) -> Option<Answer> {
    let state = classify(device).0;
    (state != *wanted).then_some(Answer::Refused { state })
}

/// Opens the volume as `bismillah-home`, closing a mapping left by an earlier helper.
fn open(device: &Path, passphrase: &Secret) -> Result<(), Answer> {
    if Path::new(MAPPED).exists() {
        let _ = tools::status("umount", &[MOUNT]);
        let _ = tools::status("cryptsetup", &["close", MAPPER]);
    }
    let mut args = with_device(&["open", "--type", "luks2", "--key-file=-"], device);
    args.push(MAPPER.into());
    match tools::run_secret("cryptsetup", &args, passphrase) {
        Some(0) => Ok(()),
        Some(2) => Err(Answer::WrongPassphrase),
        _ => Err(Answer::Failed {
            step: "open".into(),
        }),
    }
}

/// `args`, then the device.
fn with_device(args: &[&str], device: &Path) -> Vec<OsString> {
    let mut all: Vec<OsString> = args.iter().map(OsString::from).collect();
    all.push(device.as_os_str().to_owned());
    all
}

fn make_filesystem() -> bool {
    // -m 0: one writer, so no blocks are reserved for root.
    tools::status("mkfs.ext4", &["-q", "-F", "-m", "0", "-L", "texts", MAPPED])
}

fn mount() -> bool {
    tools::status(
        "mount",
        &["-t", "ext4", "-o", "nodev,nosuid,noatime", MAPPED, MOUNT],
    )
}

fn close_after(answer: Answer) -> Answer {
    let _ = tools::status("cryptsetup", &["close", MAPPER]);
    answer
}

fn unmount_after(answer: Answer) -> Answer {
    let _ = tools::status("umount", &[MOUNT]);
    close_after(answer)
}

/// The writer's folders on the mounted home, private to them, then the marker.
fn prepare_folders() -> std::io::Result<()> {
    let root = Path::new(MOUNT);
    let folders: Vec<PathBuf> = [
        "",
        "Texts",
        ".config",
        ".config/bismillah",
        ".local",
        ".local/share",
        ".local/share/bismillah",
    ]
    .iter()
    .map(|f| root.join(f))
    .collect();
    for folder in &folders {
        std::fs::create_dir_all(folder)?;
        std::os::unix::fs::chown(folder, Some(WRITER), Some(WRITER))?;
    }
    std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))?;
    std::fs::set_permissions(root.join("Texts"), std::fs::Permissions::from_mode(0o700))?;
    let lost = root.join("lost+found");
    if lost.exists() {
        std::fs::set_permissions(&lost, std::fs::Permissions::from_mode(0o700))?;
    }
    let marker = root.join(MARKER);
    if !marker.exists() {
        let mut file = std::fs::File::create(&marker)?;
        file.write_all(b"bismillah home 1\n")?;
        file.sync_all()?;
    }
    tools::sync();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(tokens: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "keyslots": { "0": {} }, "tokens": tokens })
    }

    #[test]
    fn the_state_token_decides() {
        let token =
            |s: &str| serde_json::from_str::<serde_json::Value>(&state_token(s)).expect("JSON");
        assert_eq!(
            state_of(&tokens(serde_json::json!({ "0": token("initialising") }))),
            Home::Initialising
        );
        assert_eq!(
            state_of(&tokens(serde_json::json!({ "0": token("ready") }))),
            Home::Ready
        );
        let keyboard = serde_json::json!({ "type": "bismillah-keyboard", "keyslots": [] });
        assert_eq!(
            state_of(&tokens(
                serde_json::json!({ "0": token("ready"), "1": keyboard })
            )),
            Home::Ready
        );
    }

    #[test]
    fn anything_else_is_unreadable() {
        let unknown = unreadable(Trouble::UnknownToken);
        // A LUKS header without bismillah's token: someone else's volume.
        assert_eq!(state_of(&tokens(serde_json::json!({}))), unknown);
        assert_eq!(state_of(&serde_json::json!({ "keyslots": {} })), unknown);
        // A state bismillah doesn't know, a missing one, or two tokens.
        let odd = serde_json::json!({ "type": STATE_TOKEN, "state": "formatting" });
        assert_eq!(state_of(&tokens(serde_json::json!({ "0": odd }))), unknown);
        let none = serde_json::json!({ "type": STATE_TOKEN });
        assert_eq!(state_of(&tokens(serde_json::json!({ "0": none }))), unknown);
        let ready = serde_json::json!({ "type": STATE_TOKEN, "state": "ready" });
        let twice = serde_json::json!({ "0": ready.clone(), "2": ready });
        assert_eq!(state_of(&tokens(twice)), unknown);
    }

    #[test]
    fn blank_means_zeros_at_both_ends() {
        let dir = std::env::temp_dir().join(format!("bismillah-blank-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("home.img");
        let file = std::fs::File::create(&path).expect("image");
        file.set_len(32 * MIB).expect("size");
        assert!(zeros(&path).expect("reads"));
        // A byte in the secondary header area, or in the last MiB, isn't blank.
        for offset in [16 * 1024, 4 * MIB, 32 * MIB - 1] {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("open");
            file.seek(SeekFrom::Start(offset)).expect("seek");
            file.write_all(&[1]).expect("write");
            assert!(!zeros(&path).expect("reads"), "byte at {offset}");
            erase(&path).expect("erase");
            assert!(zeros(&path).expect("reads"), "erased at {offset}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_kdf_memory_is_capped() {
        let kib = kdf_memory_kib();
        assert!((64 * 1024..=1024 * 1024).contains(&kib));
    }
}
