//! A print as a camera would read it, for `tests/mobile/receive.ts`: each frame drawn by
//! the real `Printer`, read back from the picture, and written out one a line.
//!
//! `frames <density> <name> <whole|selection|wrong-digest> <count> <file>`

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

#[allow(dead_code)]
#[path = "../tests/reader/mod.rs"]
mod reader;

use bismillah_print::{DENSITIES, PhoneKey, PhoneSecret, Printer, QUIET_MODULES, envelope, seal};

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
    let [density, name, kind, count, file] = args.as_slice() else {
        panic!("usage: frames <density> <name> <whole|selection|wrong-digest> <count> <file>");
    };
    let density = DENSITIES[density.parse::<usize>().unwrap()];
    let bytes = std::fs::read(file).unwrap();
    let mut message = envelope(name, kind == "selection", &bytes).unwrap();
    if kind == "wrong-digest" {
        // The text is whole and every checksum around it holds, but the SHA-256 disagrees.
        let digest_at = message.windows(2).position(|w| w == [0x58, 0x20]).unwrap() + 2;
        message[digest_at] ^= 0xff;
    }
    if let Some(key) = sealed_to() {
        message = seal(&key, &message).unwrap();
    }
    let mut printer = Printer::new(&message, density).unwrap();
    // `count` is per fragment: a reader never needs them all.
    for _ in 0..printer.fragments() * count.parse::<usize>().unwrap() {
        let frame = printer.next_frame().unwrap();
        let (image, side) = reader::draw(&frame, 3, QUIET_MODULES);
        println!("{}", reader::read_code(image, side));
    }
}
