//! What a phone's camera can do to a print: any order, gaps, other prints, other codes,
//! and damage that a QR code's own error correction can't see. It costs time, or it's
//! refused. It never yields wrong bytes.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::Write as _;

use bismillah_print::{
    DENSITIES, FORMAT_VERSION, Printer, Receiver, Refusal, Step, envelope, open,
};
use flate2::{Compression, write::DeflateEncoder};
use minicbor::Encoder as Cbor;
use sha2::{Digest as _, Sha256};

/// Text that doesn't compress away, so that it takes many frames.
fn noise(bytes: usize, mut seed: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes);
    while out.len() < bytes {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        out.extend_from_slice(&seed.to_le_bytes());
    }
    out
}

fn parts(bytes: &[u8], name: &str, density: usize, count_per_fragment: usize) -> Vec<String> {
    let message = envelope(name, false, bytes).unwrap();
    let mut printer = Printer::new(&message, DENSITIES[density]).unwrap();
    (0..printer.fragments() * count_per_fragment)
        .map(|_| printer.next_text().unwrap())
        .collect()
}

/// A message built by hand: what a broken or hostile sender could make.
fn message(version: u8, digest: &[u8], deflated: &[u8]) -> Vec<u8> {
    let mut cbor = Cbor::new(Vec::new());
    cbor.array(6)
        .and_then(|c| c.u8(version))
        .and_then(|c| c.str("a.md"))
        .and_then(|c| c.bool(false))
        .and_then(|c| c.bytes(digest))
        .and_then(|c| c.bytes(deflated))
        .and_then(|c| c.null())
        .unwrap();
    cbor.into_writer()
}

fn deflate(bytes: &[u8]) -> Vec<u8> {
    let mut deflate = DeflateEncoder::new(Vec::new(), Compression::best());
    deflate.write_all(bytes).unwrap();
    deflate.finish().unwrap()
}

fn first_complete(receiver: &mut Receiver, parts: &[String]) -> Option<Vec<u8>> {
    parts.iter().find_map(|part| match receiver.receive(part) {
        Ok(Step::Complete(received)) => Some(received.bytes),
        _ => None,
    })
}

#[test]
fn frames_arrive_in_any_order() {
    let text = noise(8_000, 0x2545_f491);
    let mut all = parts(&text, "a.md", 2, 4);
    all.reverse();
    assert_eq!(first_complete(&mut Receiver::default(), &all), Some(text));
}

#[test]
fn half_the_frames_can_be_lost() {
    let text = noise(8_000, 0x2545_f491);
    let all = parts(&text, "a.md", 2, 6);
    let kept: Vec<String> = all.into_iter().step_by(2).collect();
    assert_eq!(first_complete(&mut Receiver::default(), &kept), Some(text));
}

#[test]
fn repeats_change_nothing() {
    let text = noise(4_000, 0x2545_f491);
    let all = parts(&text, "a.md", 2, 3);
    let mut receiver = Receiver::default();
    let first = all.first().unwrap();
    let once = receiver.receive(first).unwrap();
    assert_eq!(receiver.receive(first).unwrap(), once);
    assert_eq!(first_complete(&mut receiver, &all), Some(text));
}

#[test]
fn strays_from_another_print_cost_nothing() {
    let text = noise(8_000, 0x2545_f491);
    let other = noise(8_000, 0x1234_5678);
    let ours = parts(&text, "a.md", 2, 3);
    let theirs = parts(&other, "b.md", 2, 3);
    let mut receiver = Receiver::default();
    let mut got = None;
    for (part, stray) in ours.iter().zip(theirs.iter().cycle()) {
        if let Ok(Step::Complete(received)) = receiver.receive(part) {
            got = Some(received.bytes);
            break;
        }
        // Two strays in a row, every time: never enough to take over.
        assert_eq!(receiver.receive(stray), Ok(Step::Ignored));
        assert_eq!(receiver.receive(stray), Ok(Step::Ignored));
    }
    assert_eq!(got, Some(text));
}

#[test]
fn a_new_print_takes_over_from_an_unfinished_one() {
    let abandoned = noise(8_000, 0x2545_f491);
    let wanted = noise(8_000, 0x1234_5678);
    let mut receiver = Receiver::default();
    for part in parts(&abandoned, "a.md", 2, 1).iter().take(10) {
        assert!(matches!(
            receiver.receive(part),
            Ok(Step::Receiving { .. } | Step::Complete(_))
        ));
    }
    let got = first_complete(&mut receiver, &parts(&wanted, "b.md", 2, 3));
    assert_eq!(got, Some(wanted));
}

#[test]
fn the_same_text_at_another_density_starts_over_and_still_arrives() {
    // The writer resized the window, so the dialog chose another QR size.
    let text = noise(8_000, 0x2545_f491);
    let mut receiver = Receiver::default();
    for part in parts(&text, "a.md", 1, 1).iter().take(3) {
        let _ = receiver.receive(part);
    }
    let got = first_complete(&mut receiver, &parts(&text, "a.md", 2, 3));
    assert_eq!(got, Some(text));
}

#[test]
fn other_codes_and_nonsense_are_ignored() {
    let mut receiver = Receiver::default();
    for text in [
        "",
        "https://example.com",
        "UR:BYTES/1-2/LPADAOCSKBCYTKFHSAGHHDFD",
        "UR:BISMILLAH-PRINT/1-2/NOTBYTEWORDS",
        "UR:BISMILLAH-PRINT/0-0/LPAD",
        "UR:BISMILLAH-PRINT/4294967295-4000000000/LPAD",
        "UR:BISMILLAH-PRINT/LPAD",
        "نص",
    ] {
        assert_eq!(receiver.receive(text), Ok(Step::Ignored), "{text}");
    }
}

/// A flipped letter passes the QR code only if its own correction missed it; the part's
/// checksum then stops it. No frame, however damaged, may panic or change the result.
#[test]
fn every_single_letter_of_damage_is_harmless() {
    let text = b"Exact text \xd8\xa8\xd9\x90.\n";
    let good = parts(text, "a.md", 3, 2);
    let part = good.first().unwrap();
    let start = part.rfind('/').unwrap() + 1;
    for at in 0..part.len() {
        for letter in *b"AZ0/-" {
            let mut bad = part.clone().into_bytes();
            if bad[at] == letter {
                continue;
            }
            bad[at] = letter;
            let bad = String::from_utf8(bad).unwrap();
            if let Ok(Step::Complete(received)) = Receiver::default().receive(&bad) {
                assert!(at < start, "the body was damaged at {at}: {bad}");
                assert_eq!(received.bytes, text);
            }
        }
    }
}

#[test]
fn a_message_is_refused_for_each_way_it_can_be_wrong() {
    let text = b"The text.\n";
    let digest = Sha256::digest(text);
    let deflated = deflate(text);
    assert!(open(&message(FORMAT_VERSION, &digest, &deflated)).is_ok());

    let wrong = Sha256::digest(b"Other text.\n");
    let damaged = [
        // A digest for other text, a short digest, and deflate that isn't.
        message(FORMAT_VERSION, &wrong, &deflated),
        message(FORMAT_VERSION, &digest[..31], &deflated),
        message(FORMAT_VERSION, &digest, b"\xff\xff\xff"),
        // Inflates to nothing: a print always holds text.
        message(FORMAT_VERSION, &Sha256::digest(b""), &deflate(b"")),
        // Not the array it should be.
        vec![0x84, FORMAT_VERSION],
        vec![],
    ];
    for bytes in &damaged {
        assert_eq!(open(bytes), Err(Refusal::Damaged), "{bytes:02x?}");
    }

    let mut trailing = message(FORMAT_VERSION, &digest, &deflated);
    trailing.push(0);
    assert_eq!(open(&trailing), Err(Refusal::Damaged));

    assert_eq!(
        // One past the sealed form, which is `FORMAT_VERSION + 1`.
        open(&message(FORMAT_VERSION + 2, &digest, &deflated)),
        Err(Refusal::Version)
    );
}

#[test]
fn a_small_message_cannot_inflate_without_limit() {
    let mut deflate = DeflateEncoder::new(Vec::new(), Compression::fast());
    deflate
        .write_all(&vec![0u8; bismillah_print::MAX_TEXT_BYTES + 1])
        .unwrap();
    let bomb = message(FORMAT_VERSION, &[0; 32], &deflate.finish().unwrap());
    assert!(bomb.len() < 1 << 20, "{}", bomb.len());
    assert_eq!(open(&bomb), Err(Refusal::TooLong));
}

#[test]
fn a_refused_print_stores_nothing_and_blocks_nothing() {
    let wrong = message(
        FORMAT_VERSION,
        &Sha256::digest(b"Other text.\n"),
        &deflate(b"The text.\n"),
    );
    let mut printer = Printer::new(&wrong, DENSITIES[0]).unwrap();
    let mut receiver = Receiver::default();
    assert_eq!(
        receiver.receive(&printer.next_text().unwrap()),
        Err(Refusal::Damaged)
    );

    let good = parts(b"The next print.\n", "a.md", 0, 1);
    assert_eq!(
        first_complete(&mut receiver, &good),
        Some(b"The next print.\n".to_vec())
    );
}
