//! The debug image's probe of the helper's socket (os/PLAN.md, OS-5). Built only with
//! the `trace` feature and installed only in the debug image, whose root command line
//! runs it for the VM scenarios.
//!
//!   bismillah-probe [--uid N] send <line>    one request; prints the answer or why none
//!   bismillah-probe [--uid N] fuzz <count>   that many damaged lines (fuzz.rs), one per
//!                                             connection; prints what came back
//!   bismillah-probe [--uid N] stall          holds a connection open without a request,
//!                                             and times a status request meanwhile
//!
//! `--uid` drops to that user (and its group) before connecting; without it the probe
//! connects as root, whom the helper must not answer either.

use bismillah_appliance::SOCKET;
use bismillah_appliance::fuzz::Lines;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--uid") {
        let Some(uid) = args.get(1).and_then(|n| n.parse::<u32>().ok()) else {
            usage();
        };
        become_user(uid);
        args.drain(..2);
    }
    match (args.first().map(String::as_str), args.get(1)) {
        (Some("send"), Some(line)) => println!("{}", send(line.as_bytes())),
        (Some("stall"), None) => {
            let held = UnixStream::connect(SOCKET);
            let started = std::time::Instant::now();
            let answer = send(br#"{"v":1,"verb":"status"}"#);
            println!("{answer}");
            println!("after {:.1} s", started.elapsed().as_secs_f64());
            drop(held);
        }
        (Some("fuzz"), Some(count)) => {
            let Ok(count) = count.parse::<u64>() else {
                usage();
            };
            fuzz(count);
        }
        _ => usage(),
    }
}

fn usage() -> ! {
    eprintln!("usage: bismillah-probe [--uid N] send <line> | fuzz <count> | stall");
    std::process::exit(2);
}

fn become_user(uid: u32) {
    // SAFETY: plain system calls with integer arguments; nothing else runs in this
    // process yet, and a failure is checked and ends it.
    let dropped = unsafe {
        libc::setgroups(0, std::ptr::null()) == 0
            && libc::setresgid(uid, uid, uid) == 0
            && libc::setresuid(uid, uid, uid) == 0
    };
    if !dropped {
        eprintln!("bismillah-probe: can't drop privileges");
        std::process::exit(1);
    }
}

/// Sends one line and returns the helper's answer, or `connect-refused` (the socket's
/// permissions), `no-answer` (the helper closed the connection) or `timeout`.
fn send(line: &[u8]) -> String {
    let mut stream = match UnixStream::connect(SOCKET) {
        Ok(stream) => stream,
        Err(e) => return format!("connect-refused {:?}", e.kind()),
    };
    if stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .is_err()
    {
        return "timeout".into();
    }
    // A long line may be cut off by the helper part-way; what it answers still counts.
    let _ = stream
        .write_all(line)
        .and_then(|()| stream.write_all(b"\n"));
    let mut answer = String::new();
    match BufReader::new(stream).read_line(&mut answer) {
        Ok(0) => "no-answer".into(),
        Ok(_) => answer.trim().to_owned(),
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => "timeout".into(),
        Err(_) => "no-answer".into(),
    }
}

/// Sends `count` damaged lines and prints a count of each kind of answer, one JSON
/// object, then a status request's answer to show the helper still serves.
fn fuzz(count: u64) {
    let mut kinds = std::collections::BTreeMap::<String, u64>::new();
    let mut lines = Lines::new(count);
    for _ in 0..count {
        let answer = send(&lines.line());
        let kind = serde_json::from_str::<serde_json::Value>(&answer)
            .ok()
            .and_then(|v| v.get("answer").and_then(|a| a.as_str()).map(str::to_owned))
            .unwrap_or(answer);
        *kinds.entry(kind).or_default() += 1;
    }
    println!("{}", serde_json::to_string(&kinds).unwrap_or_default());
    println!("{}", send(br#"{"v":1,"verb":"status"}"#));
}
