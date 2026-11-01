//! Writes tests/fixtures/print/: `cargo run -p bismillah-print --example vectors`.
//! Only for a new format version; `the_shared_vectors_still_hold` guards the old ones.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fmt::Write as _;

use bismillah_print::{DENSITIES, Printer, envelope};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

fn main() {
    let long = format!(
        "\u{feff}{}",
        "بِسْمِ ٱللَّهِ\r\nThe word أَمَانَةٌ sits in an English line. ".repeat(40)
    );
    #[allow(clippy::type_complexity)] // A table of test cases, read once, just below.
    let cases: [(&str, &str, bool, usize, &[u8], usize); 3] = [
        ("short", "Note.md", false, 0, b"One short note.\n", 1),
        (
            "vocalised-selection",
            "نص.md",
            true,
            1,
            "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\n".as_bytes(),
            1,
        ),
        ("bom-crlf-many", "Chapter.md", false, 3, long.as_bytes(), 30),
    ];
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/print");
    for (file, name, selection, density, bytes, parts) in cases {
        let message = envelope(name, selection, bytes).unwrap();
        let mut printer = Printer::new(&message, DENSITIES[density]).unwrap();
        let mut out = format!(
            "name: {name}\nselection: {selection}\ndensity: {density}\nbytes: {}\nmessage: {}\n",
            hex(bytes),
            hex(&message)
        );
        for _ in 0..parts.max(printer.fragments() * 2) {
            writeln!(out, "part: {}", printer.next_text().unwrap()).unwrap();
        }
        std::fs::write(format!("{dir}/{file}.txt"), out).unwrap();
    }
}
