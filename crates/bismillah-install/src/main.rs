//! bismillah-install: run by web/public/install.sh and install.ps1, which download the
//! bundle, choose and check the disk and unmount it (ADR-0017).
//!
//!   bismillah-install inspect <disk> --size <bytes>
//!   bismillah-install install <bundle> <disk> --size <bytes>
//!   bismillah-install update <bundle> <disk> --size <bytes> --journal <dir>
//!   bismillah-install --version
//!
//! `--file` takes a file standing in for the disk (the tests), with its own size.
//! Exit codes: 0 done, 2 usage, 3 refused (nothing was written), 1 failed while writing.

use std::path::Path;
use std::process::ExitCode;

use bismillah_install::bundle::Bundle;
use bismillah_install::disk::Disk;
use bismillah_install::{Error, Journal, Kind, inspect, install, update};

const USAGE: &str = "usage: bismillah-install inspect <disk> --size <bytes> | install <bundle> <disk> --size <bytes> | update <bundle> <disk> --size <bytes> --journal <dir> [--file]";

fn main() -> ExitCode {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut option = |flag: &str| -> Option<String> {
        let at = args.iter().position(|a| a == flag)?;
        args.remove(at);
        (at < args.len()).then(|| args.remove(at))
    };
    let size = option("--size");
    let journal = option("--journal");
    let file = match args.iter().position(|a| a == "--file") {
        Some(at) => {
            args.remove(at);
            true
        }
        None => false,
    };
    let mut log = |line: &str| eprintln!("  {line}");
    let open = |path: &str, write: bool| -> Result<Disk, Error> {
        if file {
            return Disk::file(path, write);
        }
        let size = size
            .as_deref()
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| Error::Refused("the disk's size (--size) is needed".into()))?;
        Disk::device(path, size, write)
    };
    let result = match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["--version"] => {
            println!("bismillah-install {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        ["inspect", disk] => open(disk, false).map(|mut d| match inspect(&mut d) {
            Kind::Bismillah(id) => println!("bismillah {}", id.disk),
            Kind::Other => println!("other"),
        }),
        ["install", bundle, disk] => Bundle::open(Path::new(bundle)).and_then(|b| {
            let mut d = open(disk, true)?;
            install(&b, &mut d, &mut log).map(|id| println!("installed {}", id.disk))
        }),
        ["update", bundle, disk] => match &journal {
            None => Err(Error::Refused(
                "the journal's folder (--journal) is needed".into(),
            )),
            Some(dir) => Bundle::open(Path::new(bundle)).and_then(|b| {
                let mut d = open(disk, true)?;
                update(&b, &mut d, &Journal::new(Path::new(dir)), &mut log)
                    .map(|()| println!("updated"))
            }),
        },
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e @ (Error::Refused(_) | Error::Damaged(_))) => {
            eprintln!("Refused: {e}. Nothing was written.");
            ExitCode::from(3)
        }
        Err(e) => {
            eprintln!("Failed: {e}.");
            ExitCode::from(1)
        }
    }
}
