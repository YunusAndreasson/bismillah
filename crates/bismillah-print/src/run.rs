//! *Print whole library* (docs/print-format.md, ADR-0021): every text as its own print,
//! one after another, round and round until the writer stops. Nothing comes back from the
//! phone, so the run can't wait for it. Each text is shown for long enough, and each round
//! for longer, so a camera that missed one gets it the next time round. A text the phone
//! holds is safely on its disk, which is what makes a run resumable: show it again, and
//! go straight to the texts the phone says it still lacks.

use sha2::{Digest as _, Sha256};

use crate::receive::digest;
use crate::{
    Density, Error, Frame, PhoneKey, Place, Printer, envelope_in_run, qr, seal, seconds_of,
};

/// Each text takes this many frames per fragment in the first round, one more in the next.
const FIRST_ROUND_FRAMES_PER_FRAGMENT: usize = 2;
/// A short text still stays long enough for a camera to find it: two seconds at 6 fps.
const MIN_FRAMES_PER_TEXT: usize = 12;

/// Reads a text's bytes by its name, afresh each time it's shown. `None` if it can't be.
type Read = Box<dyn FnMut(&str) -> Option<Vec<u8>> + Send>;

/// A text that won't be in the run, and why. The writer must be told: this is a backup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skipped {
    Empty,
    Unreadable,
    TooLong,
}

/// What's on the screen now, for the writer: the phone reports the same numbers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Position {
    /// From 0; the screens count from 1.
    pub index: usize,
    pub count: usize,
    pub name: String,
    /// From 1.
    pub round: u32,
}

/// Every text, in a fixed order, as frames.
pub struct Playlist {
    names: Vec<String>,
    run: [u8; 16],
    density: Density,
    sealed_to: Option<PhoneKey>,
    read: Read,
    at: usize,
    round: u32,
    /// Frames this text has left on the screen in this round.
    left: usize,
    printer: Option<Printer>,
    seconds: u32,
}

/// One text as a printer, sealed if there's a key. Sealed afresh each time it's shown.
fn printer_for(
    name: &str,
    place: Place,
    bytes: &[u8],
    density: Density,
    sealed_to: Option<&PhoneKey>,
) -> Result<Printer, Error> {
    let message = envelope_in_run(name, place, bytes)?;
    match sealed_to {
        Some(key) => Printer::new(&seal(key, &message)?, density),
        None => Printer::new(&message, density),
    }
}

fn frames_for(fragments: usize, round: u32) -> usize {
    let per_fragment = FIRST_ROUND_FRAMES_PER_FRAGMENT + round as usize - 1;
    (fragments * per_fragment).max(MIN_FRAMES_PER_TEXT)
}

impl Playlist {
    /// Reads and compresses everything once, to know what the run holds and how long a
    /// round takes. Returns the run, or nothing if no text could go in it, and the texts
    /// left out.
    pub fn new(
        names: Vec<String>,
        density: Density,
        sealed_to: Option<PhoneKey>,
        mut read: Read,
    ) -> (Option<Self>, Vec<(String, Skipped)>) {
        let mut kept = Vec::new();
        let mut skipped = Vec::new();
        let mut identity = Sha256::new();
        let mut frames = 0;
        let blank = Place {
            run: [0; 16],
            index: 0,
            count: 1,
        };
        for name in names {
            let Some(bytes) = read(&name) else {
                skipped.push((name, Skipped::Unreadable));
                continue;
            };
            let printer = printer_for(&name, blank, &bytes, density, sealed_to.as_ref());
            let printer = match printer {
                Ok(printer) => printer,
                Err(Error::Empty) => {
                    skipped.push((name, Skipped::Empty));
                    continue;
                }
                Err(_) => {
                    skipped.push((name, Skipped::TooLong));
                    continue;
                }
            };
            frames += frames_for(printer.fragments(), 1);
            identity.update((name.len() as u64).to_be_bytes());
            identity.update(name.as_bytes());
            identity.update(digest(&bytes));
            kept.push(name);
        }
        if kept.is_empty() {
            return (None, skipped);
        }
        let mut run = [0; 16];
        run.copy_from_slice(&identity.finalize()[..16]);
        #[expect(
            clippy::cast_precision_loss,
            reason = "an estimate of a few million frames at most"
        )]
        let seconds = seconds_of(frames as f64);
        let playlist = Self {
            names: kept,
            run,
            density,
            sealed_to,
            read,
            at: 0,
            round: 1,
            left: 0,
            printer: None,
            seconds,
        };
        (Some(playlist), skipped)
    }

    pub fn count(&self) -> usize {
        self.names.len()
    }

    pub fn run(&self) -> [u8; 16] {
        self.run
    }

    /// How long one first round takes, in seconds. Provisional, as the frame rate is.
    pub fn seconds(&self) -> u32 {
        self.seconds
    }

    /// Goes straight to a text, as the phone asks for it. Past the end, it goes to the last.
    pub fn go_to(&mut self, index: usize) {
        self.at = index.min(self.names.len().saturating_sub(1));
        self.printer = None;
        self.left = 0;
    }

    pub fn next_frame(&mut self) -> Result<(Frame, Position), Error> {
        let text = self.next_text()?;
        let frame = qr(&text, self.density)?;
        Ok((frame, self.position()))
    }

    pub fn position(&self) -> Position {
        Position {
            index: self.at,
            count: self.names.len(),
            name: self.names.get(self.at).cloned().unwrap_or_default(),
            round: self.round,
        }
    }

    /// The next part, moving on to the next text when this one has had its time. A text
    /// that has become unreadable is passed over; if none can be read, it's an error.
    pub fn next_text(&mut self) -> Result<String, Error> {
        if self.left == 0 || self.printer.is_none() {
            // After `go_to` or at the start nothing is loaded, and this text is next.
            if self.printer.take().is_some() {
                self.advance();
            }
            let mut tries = 0;
            while !self.load() {
                tries += 1;
                if tries >= self.names.len() {
                    return Err(Error::Encode);
                }
                self.advance();
            }
        }
        self.left -= 1;
        self.printer.as_mut().ok_or(Error::Encode)?.next_text()
    }

    fn advance(&mut self) {
        self.at += 1;
        if self.at >= self.names.len() {
            self.at = 0;
            self.round = self.round.saturating_add(1);
        }
    }

    /// Reads the current text afresh. It may have changed or gone since the run began.
    fn load(&mut self) -> bool {
        let Some(name) = self.names.get(self.at) else {
            return false;
        };
        let Some(bytes) = (self.read)(name) else {
            return false;
        };
        let place = Place {
            run: self.run,
            index: u32::try_from(self.at).unwrap_or(u32::MAX),
            count: u32::try_from(self.names.len()).unwrap_or(u32::MAX),
        };
        let printer = printer_for(name, place, &bytes, self.density, self.sealed_to.as_ref());
        let Ok(printer) = printer else {
            return false;
        };
        self.left = frames_for(printer.fragments(), self.round);
        self.printer = Some(printer);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DENSITIES, Receiver, Step};
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};

    fn noise(bytes: usize, mut seed: u32) -> Vec<u8> {
        let mut out = Vec::with_capacity(bytes);
        while out.len() < bytes {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            out.extend_from_slice(format!("{seed:x} ").as_bytes());
        }
        out
    }

    type Shelf = Arc<Mutex<BTreeMap<String, Vec<u8>>>>;

    fn shelf(texts: &[(&str, Vec<u8>)]) -> Shelf {
        Arc::new(Mutex::new(
            texts
                .iter()
                .map(|(name, bytes)| ((*name).to_owned(), bytes.clone()))
                .collect(),
        ))
    }

    fn playlist(shelf: &Shelf) -> (Option<Playlist>, Vec<(String, Skipped)>) {
        let names = shelf.lock().unwrap().keys().cloned().collect();
        let reading = Arc::clone(shelf);
        Playlist::new(
            names,
            DENSITIES[2],
            None,
            Box::new(move |name| reading.lock().unwrap().get(name).cloned()),
        )
    }

    fn library() -> Vec<(&'static str, Vec<u8>)> {
        vec![
            ("a/one.md", noise(3_000, 1)),
            ("a/two.md", "بِسْمِ ٱللَّهِ\r\n".as_bytes().to_vec()),
            ("three.md", noise(9_000, 3)),
            ("نص.md", b"\xef\xbb\xbfline\r\n".to_vec()),
        ]
    }

    /// Plays frames at a receiver, `keep` choosing which the camera catches.
    fn scan(
        list: &mut Playlist,
        frames: usize,
        mut keep: impl FnMut(usize) -> bool,
    ) -> BTreeMap<String, (Vec<u8>, Place)> {
        let mut receiver = Receiver::default();
        let mut got = BTreeMap::new();
        for frame in 0..frames {
            let text = list.next_text().unwrap();
            if !keep(frame) {
                continue;
            }
            if let Ok(Step::Complete(received)) = receiver.receive(&text) {
                let place = received.place.unwrap();
                got.insert(received.name, (received.bytes, place));
            }
        }
        got
    }

    #[test]
    fn one_round_brings_every_text_with_its_path_and_place() {
        let texts = shelf(&library());
        let mut list = playlist(&texts).0.unwrap();
        let got = scan(&mut list, 1_600, |_| true);
        assert_eq!(got.len(), 4);
        for (index, (name, bytes)) in texts.lock().unwrap().iter().enumerate() {
            let (kept, place) = &got[name];
            assert_eq!(kept, bytes, "{name}");
            assert_eq!((place.index as usize, place.count), (index, 4));
        }
    }

    #[test]
    fn a_camera_that_misses_most_frames_still_gets_everything_in_later_rounds() {
        let texts = shelf(&library());
        let mut list = playlist(&texts).0.unwrap();
        let mut seed = 0x1234_5678u32;
        let got = scan(&mut list, 40_000, |_| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed % 10 < 3
        });
        assert_eq!(got.len(), 4);
        assert!(list.round > 1);
    }

    #[test]
    fn the_same_texts_make_the_same_run_and_a_changed_text_another() {
        let texts = shelf(&library());
        let first = playlist(&texts).0.unwrap().run();
        assert_eq!(playlist(&texts).0.unwrap().run(), first);
        texts
            .lock()
            .unwrap()
            .insert("three.md".into(), b"changed".to_vec());
        assert_ne!(playlist(&texts).0.unwrap().run(), first);
    }

    #[test]
    fn it_goes_straight_to_a_text_and_stays_in_range() {
        let texts = shelf(&library());
        let mut list = playlist(&texts).0.unwrap();
        list.go_to(2);
        list.next_text().unwrap();
        assert_eq!(list.position().name, "three.md");
        list.go_to(99);
        list.next_text().unwrap();
        assert_eq!(list.position().index, 3);
    }

    #[test]
    fn what_cant_go_in_is_named_and_the_rest_still_goes() {
        let mut texts = library();
        texts.push(("empty.md", Vec::new()));
        let texts = shelf(&texts);
        let names = {
            let mut names: Vec<String> = texts.lock().unwrap().keys().cloned().collect();
            names.push("gone.md".into());
            names
        };
        let reading = Arc::clone(&texts);
        let (list, skipped) = Playlist::new(
            names,
            DENSITIES[2],
            None,
            Box::new(move |name| reading.lock().unwrap().get(name).cloned()),
        );
        assert_eq!(list.unwrap().count(), 4);
        assert!(skipped.contains(&("empty.md".to_owned(), Skipped::Empty)));
        assert!(skipped.contains(&("gone.md".to_owned(), Skipped::Unreadable)));
    }

    #[test]
    fn a_text_that_goes_during_the_run_is_passed_over_and_none_left_is_an_error() {
        let texts = shelf(&library());
        let mut list = playlist(&texts).0.unwrap();
        texts.lock().unwrap().remove("a/one.md");
        list.next_text().unwrap();
        assert_eq!(list.position().name, "a/two.md");
        texts.lock().unwrap().clear();
        list.go_to(1);
        assert_eq!(list.next_text(), Err(Error::Encode));
    }

    #[test]
    fn nothing_to_print_makes_no_run() {
        let (list, skipped) = playlist(&shelf(&[("empty.md", Vec::new())]));
        assert!(list.is_none());
        assert_eq!(skipped.len(), 1);
    }
}
