//! Sealing (ADR-0023): what a camera that isn't the phone gets, and typing the key.

#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use bismillah_print::{
    DENSITIES, PhoneKey, PhoneSecret, Playlist, Printer, Receiver, Refusal, Step, envelope, open,
    open_with, seal,
};
use std::collections::BTreeMap;

const TEXT: &str = "بِسْمِ ٱللَّهِ the secret word أَمَانَةٌ\r\n";
const NAME: &str = "private-name.md";

fn sealed_message(key: &PhoneKey) -> Vec<u8> {
    seal(key, &envelope(NAME, false, TEXT.as_bytes()).unwrap()).unwrap()
}

fn has(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Every frame until one finishes, through a phone's receiver.
fn receive(receiver: &mut Receiver, message: &[u8]) -> Result<Step, Refusal> {
    let mut printer = Printer::new(message, DENSITIES[2]).unwrap();
    for _ in 0..printer.fragments() * 4 + 4 {
        let step = receiver.receive(&printer.next_text().unwrap())?;
        if matches!(step, Step::Complete(_)) {
            return Ok(step);
        }
    }
    Ok(Step::Ignored)
}

#[test]
fn only_the_phones_key_opens_a_print_byte_for_byte() {
    let phone = PhoneSecret::generate();
    let message = sealed_message(phone.public());
    let opened = open_with(&message, Some(&phone)).unwrap();
    assert_eq!(opened.bytes, TEXT.as_bytes());
    assert_eq!(opened.name, NAME);
    assert!(opened.sealed);
    let plain = open(&envelope(NAME, false, TEXT.as_bytes()).unwrap()).unwrap();
    assert!(!plain.sealed);
}

#[test]
fn someone_filming_the_screen_gets_nothing() {
    let phone = PhoneSecret::generate();
    let message = sealed_message(phone.public());
    assert_eq!(open(&message), Err(Refusal::OtherKey));
    let other = PhoneSecret::generate();
    assert_eq!(open_with(&message, Some(&other)), Err(Refusal::OtherKey));
    // The compressed text would hide the words anyway, so a short name is what shows it.
    assert!(!has(&message, NAME.as_bytes()));
    let inner = envelope(NAME, false, TEXT.as_bytes()).unwrap();
    assert!(has(&inner, NAME.as_bytes()), "the check itself can find it");
}

/// The stick holds only `PhoneKey`, which has no way to open anything, and a seal's own
/// key is gone once it's made: two prints of one text share nothing to work from.
#[test]
fn each_print_is_sealed_afresh() {
    let key = PhoneSecret::generate();
    assert_ne!(sealed_message(key.public()), sealed_message(key.public()));
}

#[test]
fn a_print_altered_anywhere_is_refused() {
    let phone = PhoneSecret::generate();
    let message = sealed_message(phone.public());
    for at in 0..message.len() {
        let mut altered = message.clone();
        altered[at] ^= 0x40;
        assert!(open_with(&altered, Some(&phone)).is_err(), "byte {at}");
    }
    let mut longer = message;
    longer.push(0);
    assert_eq!(open_with(&longer, Some(&phone)), Err(Refusal::Damaged));
}

#[test]
fn a_seal_inside_a_seal_is_refused() {
    let phone = PhoneSecret::generate();
    let twice = seal(phone.public(), &sealed_message(phone.public())).unwrap();
    assert_eq!(open_with(&twice, Some(&phone)), Err(Refusal::Version));
}

#[test]
fn another_phones_print_is_refused_and_the_next_still_arrives() {
    let phone = PhoneSecret::generate();
    let mut receiver = Receiver::default();
    receiver.set_secret(PhoneSecret::from_bytes(&phone.to_bytes()).unwrap());
    let other = PhoneSecret::generate();
    assert_eq!(
        receive(&mut receiver, &sealed_message(other.public())),
        Err(Refusal::OtherKey)
    );
    let Step::Complete(received) = receive(&mut receiver, &sealed_message(phone.public())).unwrap()
    else {
        panic!("the print didn't arrive");
    };
    assert_eq!(received.bytes, TEXT.as_bytes());
}

#[test]
fn a_saved_key_is_the_same_key() {
    let phone = PhoneSecret::generate();
    let again = PhoneSecret::from_bytes(&phone.to_bytes()).unwrap();
    assert_eq!(again.public().text(), phone.public().text());
    assert!(PhoneSecret::from_bytes(b"short").is_none());
}

#[test]
fn a_key_reads_back_however_it_was_typed() {
    let key = PhoneSecret::generate().public().clone();
    let text = key.text();
    assert_eq!(text.len(), 61);
    assert!(text.starts_with("bk1"));
    let words = key.check_words();
    assert_eq!(words.split(' ').count(), 4);
    for typed in [
        text.clone(),
        text.to_uppercase(),
        key.grouped(),
        key.grouped().replace(' ', "-"),
        format!("  {}\n", key.grouped()),
    ] {
        assert_eq!(PhoneKey::parse(&typed).unwrap().text(), text, "{typed}");
    }
    assert_eq!(PhoneKey::parse(&text).unwrap().check_words(), words);
}

/// Every single slip: each character wrong, each neighbouring pair swapped, each one
/// dropped or doubled. A key that passes with a slip seals to nobody, and the text is lost.
#[test]
fn every_typing_slip_is_caught() {
    let text = PhoneSecret::generate().public().text();
    let alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    let chars: Vec<char> = text.chars().collect();
    let attempt = |slipped: Vec<char>| {
        let slipped: String = slipped.into_iter().collect();
        if slipped != text {
            assert!(PhoneKey::parse(&slipped).is_err(), "{slipped}");
        }
    };
    for at in 0..chars.len() {
        for letter in alphabet.chars() {
            let mut slipped = chars.clone();
            slipped[at] = letter;
            attempt(slipped);
        }
        let mut dropped = chars.clone();
        dropped.remove(at);
        attempt(dropped);
        let mut doubled = chars.clone();
        doubled.insert(at, chars[at]);
        attempt(doubled);
        if at + 1 < chars.len() {
            let mut swapped = chars.clone();
            swapped.swap(at, at + 1);
            attempt(swapped);
        }
    }
    for wrong in ["", "bk1", "hello", "age1qqqq", "bk1qqqqqqqqqqqqq"] {
        assert!(PhoneKey::parse(wrong).is_err(), "{wrong}");
    }
}

#[test]
fn a_whole_library_arrives_sealed_and_a_camera_without_the_key_gets_none_of_it() {
    let texts: BTreeMap<String, Vec<u8>> = [
        ("a/one.md".to_owned(), b"first text\r\n".to_vec()),
        ("b/نص.md".to_owned(), "أَمَانَةٌ\n".as_bytes().to_vec()),
    ]
    .into();
    let names = texts.keys().cloned().collect();
    let shelf = texts.clone();
    let phone = PhoneSecret::generate();
    let (list, _) = Playlist::new(
        names,
        DENSITIES[2],
        Some(phone.public().clone()),
        Box::new(move |name| shelf.get(name).cloned()),
    );
    let mut list = list.unwrap();

    let mut ours = Receiver::default();
    ours.set_secret(PhoneSecret::from_bytes(&phone.to_bytes()).unwrap());
    let mut theirs = Receiver::default();
    let mut got = BTreeMap::new();
    let mut refused = 0;
    for _ in 0..400 {
        let part = list.next_text().unwrap();
        if let Ok(Step::Complete(received)) = ours.receive(&part) {
            assert!(received.sealed);
            got.insert(received.name, received.bytes);
        }
        match theirs.receive(&part) {
            Ok(Step::Complete(_)) => panic!("a camera without the key read a text"),
            Err(Refusal::OtherKey) => refused += 1,
            _ => {}
        }
    }
    assert_eq!(got, texts);
    assert!(refused > 0);
}
