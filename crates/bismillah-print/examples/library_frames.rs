//! *Print whole library* as a camera would read it, for `tests/mobile/receive.ts`: the real
//! `Playlist`, each frame drawn and read back from the picture, written out one a line.
//!
//! `library_frames <density> <folder> <from> <frames>`. The folder's files, sorted by path,
//! are the library, so a text's number is the same in every call.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

#[allow(dead_code)]
#[path = "../tests/reader/mod.rs"]
mod reader;

use std::path::{Path, PathBuf};

use bismillah_print::{DENSITIES, PhoneKey, PhoneSecret, Playlist, QUIET_MODULES};

fn files(folder: &Path, under: &str, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(folder).unwrap().flatten() {
        let name = entry.file_name().into_string().unwrap();
        let path = if under.is_empty() {
            name.clone()
        } else {
            format!("{under}/{name}")
        };
        if entry.file_type().unwrap().is_dir() {
            files(&entry.path(), &path, out);
        } else {
            out.push(path);
        }
    }
}

/// `BISMILLAH_SEAL_TO`: a phone's key, or `other` for a key no phone holds.
fn sealed_to() -> Option<PhoneKey> {
    match std::env::var("BISMILLAH_SEAL_TO").ok()?.as_str() {
        "" => None,
        "other" => Some(PhoneSecret::generate().public().clone()),
        key => Some(PhoneKey::parse(key).unwrap()),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [density, folder, from, frames] = args.as_slice() else {
        panic!("usage: library_frames <density> <folder> <from> <frames>");
    };
    let folder = PathBuf::from(folder);
    let mut names = Vec::new();
    files(&folder, "", &mut names);
    names.sort();
    let density = DENSITIES[density.parse::<usize>().unwrap()];
    let read = move |name: &str| std::fs::read(folder.join(name)).ok();
    let (playlist, _) = Playlist::new(names, density, sealed_to(), Box::new(read));
    let mut playlist = playlist.unwrap();
    playlist.go_to(from.parse().unwrap());
    for _ in 0..frames.parse::<usize>().unwrap() {
        let (frame, _) = playlist.next_frame().unwrap();
        let (image, side) = reader::draw(&frame, 3, QUIET_MODULES);
        println!("{}", reader::read_code(image, side));
    }
}
