//! The system tools the helper runs (cryptsetup, e2fsprogs, util-linux). Their output
//! goes to the helper's own stdout and stderr (the debug image's journal, or nowhere in
//! release), never to the socket. A passphrase reaches cryptsetup only on stdin.

use bismillah_appliance::Secret;
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn command<S: AsRef<OsStr>>(program: &str, args: &[S]) -> Command {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null());
    command
}

/// Runs a tool; its exit code, or `None` if it couldn't run or was killed.
pub fn code<S: AsRef<OsStr>>(program: &str, args: &[S]) -> Option<i32> {
    command(program, args).status().ok()?.code()
}

pub fn status<S: AsRef<OsStr>>(program: &str, args: &[S]) -> bool {
    code(program, args) == Some(0)
}

/// A tool's stdout, when it succeeds.
pub fn output<S: AsRef<OsStr>>(program: &str, args: &[S]) -> Option<Vec<u8>> {
    let out = command(program, args).stderr(Stdio::null()).output().ok()?;
    out.status.success().then_some(out.stdout)
}

/// Runs a tool with `input` on stdin.
pub fn run_input<S: AsRef<OsStr>>(program: &str, args: &[S], input: &[u8]) -> bool {
    feed(program, args, input) == Some(0)
}

/// Runs cryptsetup with the passphrase's exact bytes on stdin (`--key-file=-`); its
/// exit code. Code 2 is cryptsetup's "no key available with this passphrase".
pub fn run_secret(program: &str, args: &[OsString], passphrase: &Secret) -> Option<i32> {
    feed(program, args, passphrase.expose().as_bytes())
}

fn feed<S: AsRef<OsStr>>(program: &str, args: &[S], input: &[u8]) -> Option<i32> {
    let mut child = command(program, args).stdin(Stdio::piped()).spawn().ok()?;
    let written = child.stdin.take().map(|mut stdin| stdin.write_all(input));
    // stdin is closed here, so cryptsetup sees the end of the key.
    let status = child.wait().ok()?;
    match written {
        Some(Ok(())) => status.code(),
        _ => None,
    }
}

/// The type blkid's low-level probe finds on `device` (`crypto_LUKS`, `ext4`, …), or
/// `None` only when it is sure there is nothing. Two signatures at once, or a probe
/// that fails, count as something.
pub fn probe(device: &Path) -> Option<String> {
    let args: [&OsStr; 6] = [
        "--probe".as_ref(),
        "--match-tag".as_ref(),
        "TYPE".as_ref(),
        "--output".as_ref(),
        "value".as_ref(),
        device.as_os_str(),
    ];
    let Ok(out) = command("blkid", &args).stderr(Stdio::null()).output() else {
        return Some("unknown".into());
    };
    match out.status.code() {
        Some(2) => None,
        Some(0) => {
            let kind = String::from_utf8_lossy(&out.stdout).trim().to_owned();
            Some(if kind.is_empty() {
                "unknown".into()
            } else {
                kind
            })
        }
        _ => Some("unknown".into()),
    }
}

/// Makes everything written so far durable, then flushes the stick's own cache for
/// `device`.
pub fn flush(device: &Path) {
    sync();
    if let Ok(file) = std::fs::File::open(device) {
        let _ = file.sync_all();
    }
}

pub fn sync() {
    // SAFETY: sync(2) takes no arguments, touches no memory of ours and cannot fail.
    unsafe { libc::sync() };
}
