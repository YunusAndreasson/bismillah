//! A reader's whole path, checked against what the writer typed: frames drawn as QR
//! images, read back, reassembled, verified and inflated, byte for byte.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::cast_possible_truncation
)]

mod reader;

use bismillah_print::{
    DENSITIES, Printer, QUIET_MODULES, Received, Receiver, Step, envelope, open,
};
use reader::{draw, read_code};

const ARABIC: &str = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\nوَمَا تَوْفِيقِي إِلَّا بِٱللَّهِ\n";
const MIXED: &str = "The word أَمَانَةٌ sits in an English line.\n";

/// Prose that doesn't compress to nothing, so documents really span many frames.
fn long_text(bytes: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes + 64);
    let mut seed = 0x2545_f491_u32;
    while out.len() < bytes {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        let word = ["أَمَانَة", "trust", "زهد", "writer", "ٱللَّهِ", "page"][seed as usize % 6];
        out.extend_from_slice(word.as_bytes());
        out.extend_from_slice(if seed.is_multiple_of(11) {
            b"\r\n"
        } else {
            b" "
        });
        out.extend_from_slice(
            &seed.to_le_bytes()[..1]
                .iter()
                .map(|b| b'a' + b % 26)
                .collect::<Vec<_>>(),
        );
    }
    out
}

/// Feeds the receiver until a whole document comes out.
fn complete(receiver: &mut Receiver, part: &str) -> Option<Received> {
    match receiver.receive(part).unwrap() {
        Step::Complete(received) => Some(*received),
        _ => None,
    }
}

/// Prints `bytes` and reassembles them from the parts `keep` lets through.
fn through(name: &str, bytes: &[u8], density: usize, keep: impl Fn(usize) -> bool) -> Vec<u8> {
    let message = envelope(name, false, bytes).unwrap();
    let mut printer = Printer::new(&message, DENSITIES[density]).unwrap();
    let mut receiver = Receiver::default();
    for sequence in 0..100_000 {
        let part = printer.next_text().unwrap();
        if keep(sequence)
            && let Some(received) = complete(&mut receiver, &part)
        {
            assert_eq!(received.name, name);
            return received.bytes;
        }
    }
    panic!("never completed");
}

#[test]
fn every_kind_of_text_arrives_exactly() {
    let bom_crlf = b"\xef\xbb\xbfline one\r\nline two\r\n".to_vec();
    let cases: [&[u8]; 6] = [
        b"One word.",
        ARABIC.as_bytes(),
        MIXED.as_bytes(),
        &bom_crlf,
        // Lone CR, trailing spaces, a NUL and the marks that a normaliser would reorder.
        "a\rb  \n\0\u{0651}\u{064e}\u{064e}\u{0651}".as_bytes(),
        "e\u{0301} é".as_bytes(),
    ];
    for bytes in cases {
        for density in 0..DENSITIES.len() {
            assert_eq!(through("نص.md", bytes, density, |_| true), bytes);
        }
    }
}

#[test]
fn survives_a_camera_missing_three_frames_in_ten() {
    let text = long_text(50_000);
    assert_eq!(through("Chapter.md", &text, 1, |n| n % 10 >= 3), text);
}

#[test]
fn a_long_document_spans_many_frames_and_says_how_long() {
    let message = envelope("Chapter.md", false, &long_text(50_000)).unwrap();
    let printer = Printer::new(&message, DENSITIES[1]).unwrap();
    assert!(printer.fragments() > 10, "{}", printer.fragments());
    assert!(printer.seconds() > 1);
}

#[test]
fn short_text_is_one_frame() {
    let message = envelope("Verse.md", true, ARABIC.as_bytes()).unwrap();
    let printer = Printer::new(&message, DENSITIES[0]).unwrap();
    assert_eq!(printer.fragments(), 1);
    let received = open(&message).unwrap();
    assert!(received.selection);
}

#[test]
fn frames_read_back_as_drawn_at_every_density() {
    let text = long_text(4_000);
    let message = envelope("Chapter.md", false, &text).unwrap();
    for density in DENSITIES {
        let mut printer = Printer::new(&message, density).unwrap();
        let mut receiver = Receiver::default();
        let mut received = None;
        for _ in 0..20_000 {
            let frame = printer.next_frame().unwrap();
            // Three pixels a module, the smallest the dialog draws.
            let (image, side) = draw(&frame, 3, QUIET_MODULES);
            let part = read_code(image, side);
            assert!(part.starts_with("UR:BISMILLAH-PRINT/"), "{part}");
            received = complete(&mut receiver, &part);
            if received.is_some() {
                break;
            }
        }
        assert_eq!(
            received.expect("never completed").bytes,
            text,
            "{density:?}"
        );
    }
}

#[test]
fn a_corrupted_message_is_refused() {
    let mut message = envelope("a.md", false, ARABIC.as_bytes()).unwrap();
    // The last byte is deflated text.
    let last = message.len() - 1;
    message[last] ^= 0xff;
    assert!(open(&message).is_err());

    // The text is intact, but the digest doesn't match it.
    let mut message = envelope("a.md", false, b"Text that is long enough.").unwrap();
    let digest_at = message.windows(2).position(|w| w == [0x58, 0x20]).unwrap() + 2;
    message[digest_at] ^= 0xff;
    assert!(open(&message).is_err());
}

#[test]
fn a_garbled_frame_is_ignored_without_harming_the_rest() {
    let text = long_text(4_000);
    let message = envelope("a.md", false, &text).unwrap();
    let mut printer = Printer::new(&message, DENSITIES[2]).unwrap();
    let mut receiver = Receiver::default();
    let mut garbled = false;
    let received = loop {
        let part = printer.next_text().unwrap();
        if !garbled {
            let bad = part.replacen('/', "/X", 2);
            assert_eq!(receiver.receive(&bad), Ok(Step::Ignored));
            garbled = true;
        }
        if let Some(received) = complete(&mut receiver, &part) {
            break received;
        }
    };
    assert_eq!(received.bytes, text);
}

/// The vectors a phone reader is built against (tests/fixtures/print/) still describe
/// this encoder. Change them only with a new format version.
#[test]
fn the_shared_vectors_still_hold() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/print");
    let mut seen = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "txt") {
            continue;
        }
        seen += 1;
        let vector = reader::Vector::parse(&std::fs::read_to_string(&path).unwrap());
        let mut printer = Printer::new(&vector.message, DENSITIES[vector.density]).unwrap();
        for part in &vector.parts {
            assert_eq!(&printer.next_text().unwrap(), part, "{}", path.display());
        }
        let received = open(&vector.message).unwrap();
        assert_eq!(received.name, vector.name);
        assert_eq!(received.selection, vector.selection);
        assert_eq!(received.bytes, vector.bytes);
    }
    assert!(seen >= 3);
}
