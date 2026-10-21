//! Appliance mode (os/PLAN.md): bismillah as the whole surface of the bismillah stick,
//! started by its session as `cage -d -- bismillah --appliance`. A desktop launch never
//! passes the flag, so none of this runs there.
//!
//! Phase OS-1 gives it the fixed library and the high-density scale. The unlock gate
//! (OS-2) still runs through the spike modules behind `BISMILLAH_SPIKE_*`.

use std::io::Write;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The flag the stick's session passes.
const FLAG: &str = "--appliance";

/// Whether this launch is the stick's session.
pub fn enabled(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == FLAG)
}

/// The library on the stick, `~/Texts`, made on the first start and private to the
/// writer whatever the session's umask (PAM's login session sets its own). `None` when
/// it can't be made: the app then starts with no library, as on the desktop.
pub fn library() -> Option<PathBuf> {
    let dir = Path::new(&std::env::var_os("HOME")?).join("Texts");
    match std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)
    {
        Ok(()) => Some(dir),
        Err(e) => {
            eprintln!("bismillah: no library folder: {:?}", e.kind());
            None
        }
    }
}

/// Whether boot marks are printed: in the stick's debug image (`BISMILLAH_MARKS=1`) and
/// in the OS-0 unlock spike. Release images print nothing.
pub fn marks() -> bool {
    std::env::var_os("BISMILLAH_MARKS").is_some()
        || std::env::var_os("BISMILLAH_SPIKE_UNLOCK").is_some()
}

/// Prints `BISMILLAH_MARK <name> <uptime seconds>`, for the OS boot-stage numbers.
/// Names and times only, never anything from a document.
pub fn mark(name: &str) {
    if !marks() {
        return;
    }
    let uptime = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    let seconds = uptime.split(' ').next().unwrap_or("?");
    // Not println!, which panics when stdout can't be written.
    let _ = writeln!(std::io::stdout(), "BISMILLAH_MARK {name} {seconds}");
}

/// Scales each high-density screen to 2x. cage always starts at scale 1, which makes
/// text tiny on a 4K laptop panel. The rule is GNOME's: 2x from 192 dots per inch.
/// Screens that report no physical size (VMs, projectors) stay at 1x.
pub fn scale_outputs() {
    let Ok(listing) = Command::new("wlr-randr").output() else {
        return;
    };
    for output in dense_outputs(&String::from_utf8_lossy(&listing.stdout)) {
        let _ = Command::new("wlr-randr")
            .args(["--output", &output, "--scale", "2"])
            .status();
    }
}

/// The outputs of a `wlr-randr` listing with at least 192 dots per inch.
fn dense_outputs(listing: &str) -> Vec<String> {
    let mut dense = Vec::new();
    let mut output: Option<(String, f64, f64)> = None; // name, width mm, width px
    let mut finish = |o: Option<(String, f64, f64)>| {
        if let Some((name, mm, px)) = o
            && mm > 0.0
            && px * 25.4 / mm >= 192.0
        {
            dense.push(name);
        }
    };
    for line in listing.lines() {
        if !line.starts_with(' ') && !line.is_empty() {
            finish(output.take());
            let name = line.split(' ').next().unwrap_or_default().to_owned();
            output = Some((name, 0.0, 0.0));
            continue;
        }
        let Some((_, mm, px)) = output.as_mut() else {
            continue;
        };
        let line = line.trim();
        if let Some(size) = line.strip_prefix("Physical size:") {
            // "Physical size: 346x194 mm"
            *mm = number_before(size.trim(), 'x');
        } else if line.contains(" px") && line.contains("current") {
            // "3840x2160 px, 60.000000 Hz (preferred, current)"
            *px = number_before(line, 'x');
        }
    }
    finish(output);
    dense
}

fn number_before(text: &str, separator: char) -> f64 {
    text.split(separator)
        .next()
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_the_flag_starts_appliance_mode() {
        assert!(enabled(&args(&["bismillah", "--appliance"])));
        assert!(!enabled(&args(&["bismillah"])));
        assert!(!enabled(&args(&["bismillah", "appliance.md"])));
        // The program name itself is never read as the flag.
        assert!(!enabled(&args(&["--appliance"])));
    }

    #[test]
    fn scales_only_high_density_screens() {
        let listing = "\
eDP-1 \"Sharp Corporation 0x1476 (eDP-1)\"
  Make: Sharp Corporation
  Physical size: 346x194 mm
  Enabled: yes
  Modes:
    3840x2160 px, 60.000000 Hz (preferred, current)
DP-1 \"Dell U2415\"
  Physical size: 518x324 mm
  Modes:
    1920x1200 px, 59.950001 Hz (preferred, current)
    1280x720 px, 60.000000 Hz
Virtual-1 \"QEMU Monitor\"
  Physical size: 0x0 mm
  Modes:
    1280x800 px, 60.000000 Hz (current)
";
        assert_eq!(dense_outputs(listing), vec!["eDP-1".to_owned()]);
        assert!(dense_outputs("").is_empty());
    }
}
