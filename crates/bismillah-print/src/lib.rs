//! Print to Phone (ADR-0021, docs/print-format.md): a document as an endless stream of
//! fountain-coded QR frames. One-way and optical; nothing here touches a network, a
//! file or a log.

#![forbid(unsafe_code)]

use std::io::Write as _;

use flate2::{Compression, write::DeflateEncoder};
use minicbor::Encoder as Cbor;
use qrcode::{Color, EcLevel, QrCode, Version};
use sha2::{Digest as _, Sha256};

mod receive;
mod run;
mod seal;

pub use receive::{Received, Receiver, Refusal, Step, digest, open, open_with};
pub use run::{Playlist, Position, Skipped};
pub use seal::{NotAKey, PhoneKey, PhoneSecret, SEALED_VERSION, seal};

/// The UR type, so a reader knows a bismillah code from any other.
pub const UR_TYPE: &str = "bismillah-print";
/// The envelope's first field. A reader refuses versions it doesn't know.
pub const FORMAT_VERSION: u8 = 2;
/// Modules of blank paper on each side of every code, as the QR standard asks.
pub const QUIET_MODULES: u32 = 4;
/// The most fragments a print may have: three hours at today's frame rate. Readers refuse
/// any more, because a part's claim of a size costs memory before anything can check it.
pub const MAX_FRAGMENTS: usize = 1 << 16;
/// The longest text a print may hold. A reader stops inflating here.
pub const MAX_TEXT_BYTES: usize = 64 << 20;

/// Provisional until a real phone has read them (ADR-0021): frames shown per second.
pub const FRAMES_PER_SECOND: u32 = 6;
/// Provisional: how many frames a reader needs, per fragment. Misses and the fountain's
/// overhead together; it only feeds the "about" the writer is shown.
const FRAMES_NEEDED_PER_FRAGMENT: f64 = 1.3;

/// A QR size and what fits in it, densest first. Every fragment fits with room for the
/// longest header a part can have; a test below proves that.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Density {
    pub qr_version: i16,
    /// Modules on a side, without the quiet zone.
    pub modules: u32,
    pub fragment_bytes: usize,
}

pub const DENSITIES: [Density; 4] = [
    Density {
        qr_version: 20,
        modules: 97,
        fragment_bytes: 570,
    },
    Density {
        qr_version: 15,
        modules: 77,
        fragment_bytes: 325,
    },
    Density {
        qr_version: 10,
        modules: 57,
        fragment_bytes: 140,
    },
    Density {
        qr_version: 6,
        modules: 41,
        fragment_bytes: 45,
    },
];

/// What went wrong, by kind only: nothing here carries the writer's text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("nothing to print")]
    Empty,
    #[error("unknown density")]
    Density,
    #[error("too long to print")]
    TooLong,
    #[error("could not encode")]
    Encode,
}

/// Where a text belongs in a *Print whole library* run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Place {
    /// The same texts give the same run, so an interrupted run can simply be shown again.
    pub run: [u8; 16],
    pub index: u32,
    pub count: u32,
}

/// The message every frame carries a piece of: a CBOR array of the format version, the
/// document's name, whether this is a selection rather than the whole document, the
/// SHA-256 of `bytes`, `bytes` as raw DEFLATE, and its place in a run or null. The bytes
/// are never altered, only compressed.
pub fn envelope(name: &str, selection: bool, bytes: &[u8]) -> Result<Vec<u8>, Error> {
    write_envelope(name, selection, None, bytes)
}

/// One text of a run: always whole, under its path in the library.
pub fn envelope_in_run(name: &str, place: Place, bytes: &[u8]) -> Result<Vec<u8>, Error> {
    write_envelope(name, false, Some(place), bytes)
}

fn write_envelope(
    name: &str,
    selection: bool,
    place: Option<Place>,
    bytes: &[u8],
) -> Result<Vec<u8>, Error> {
    if bytes.is_empty() {
        return Err(Error::Empty);
    }
    if bytes.len() > MAX_TEXT_BYTES {
        return Err(Error::TooLong);
    }
    let mut deflate = DeflateEncoder::new(Vec::new(), Compression::best());
    deflate.write_all(bytes).map_err(|_| Error::Encode)?;
    let deflated = deflate.finish().map_err(|_| Error::Encode)?;
    let digest = Sha256::digest(bytes);

    let mut cbor = Cbor::new(Vec::with_capacity(deflated.len() + name.len() + 48));
    cbor.array(6)
        .and_then(|c| c.u8(FORMAT_VERSION))
        .and_then(|c| c.str(name))
        .and_then(|c| c.bool(selection))
        .and_then(|c| c.bytes(digest.as_slice()))
        .and_then(|c| c.bytes(&deflated))
        .map_err(|_| Error::Encode)?;
    match place {
        None => cbor.null().map(|_| ()),
        Some(place) => cbor
            .array(3)
            .and_then(|c| c.bytes(&place.run))
            .and_then(|c| c.u32(place.index))
            .and_then(|c| c.u32(place.count))
            .map(|_| ()),
    }
    .map_err(|_| Error::Encode)?;
    Ok(cbor.into_writer())
}

/// One QR code, row by row from the top: `true` is a dark module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Modules on a side, without the quiet zone.
    pub size: u32,
    pub dark: Vec<bool>,
}

/// An endless stream of frames for one message.
pub struct Printer {
    encoder: ur::Encoder<'static>,
    density: Density,
}

impl Printer {
    pub fn new(message: &[u8], density: Density) -> Result<Self, Error> {
        if !DENSITIES.contains(&density) {
            return Err(Error::Density);
        }
        let encoder = ur::Encoder::new(message, density.fragment_bytes, UR_TYPE)
            .map_err(|_| Error::Encode)?;
        if encoder.fragment_count() > MAX_FRAGMENTS {
            return Err(Error::TooLong);
        }
        Ok(Self { encoder, density })
    }

    /// How many fragments the message became. With one, a single still frame holds it.
    pub fn fragments(&self) -> usize {
        self.encoder.fragment_count()
    }

    /// The next part as a QR code's text. Uppercase: every character of a part is then
    /// in QR's alphanumeric set, and it survives phone APIs that only return strings.
    pub fn next_text(&mut self) -> Result<String, Error> {
        let part = self.encoder.next_part().map_err(|_| Error::Encode)?;
        Ok(part.to_ascii_uppercase())
    }

    pub fn next_frame(&mut self) -> Result<Frame, Error> {
        let text = self.next_text()?;
        self.frame(&text)
    }

    fn frame(&self, text: &str) -> Result<Frame, Error> {
        qr(text, self.density)
    }

    /// About how long a reader takes, in seconds, never less than one.
    pub fn seconds(&self) -> u32 {
        seconds(self.fragments())
    }
}

fn qr(text: &str, density: Density) -> Result<Frame, Error> {
    let code = QrCode::with_version(
        text.as_bytes(),
        Version::Normal(density.qr_version),
        EcLevel::L,
    )
    .map_err(|_| Error::Encode)?;
    Ok(Frame {
        size: density.modules,
        dark: code.to_colors().iter().map(|c| *c == Color::Dark).collect(),
    })
}

fn seconds(fragments: usize) -> u32 {
    #[expect(
        clippy::cast_precision_loss,
        reason = "an estimate of a few thousand frames at most"
    )]
    seconds_of(fragments as f64 * FRAMES_NEEDED_PER_FRAGMENT)
}

/// Seconds to show this many frames, rounded up, never less than one.
fn seconds_of(frames: f64) -> u32 {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a small positive estimate, rounded up"
    )]
    let seconds = (frames / f64::from(FRAMES_PER_SECOND)).ceil() as u32;
    seconds.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The longest part a fragment can make: CBOR's largest header and the CRC as
    /// bytewords, the type, and the largest sequence numbers.
    #[test]
    fn every_density_holds_its_longest_possible_part() {
        for density in DENSITIES {
            let prefix = "UR:BISMILLAH-PRINT/4294967295-4294967295/";
            let body = "A".repeat(2 * (density.fragment_bytes + 28));
            let frame = qr(&format!("{prefix}{body}"), density).unwrap();
            assert_eq!(frame.dark.len() as u32, density.modules * density.modules);
        }
    }

    #[test]
    fn refuses_nothing_and_foreign_sizes() {
        assert_eq!(envelope("a.md", false, b""), Err(Error::Empty));
        let density = Density {
            fragment_bytes: 1,
            ..DENSITIES[0]
        };
        assert!(matches!(
            Printer::new(b"text", density),
            Err(Error::Density)
        ));
    }

    /// Whatever a reader would refuse, the stick must not spend hours showing.
    #[test]
    fn refuses_what_a_reader_would_refuse() {
        assert_eq!(
            envelope("a.md", false, &vec![b'a'; MAX_TEXT_BYTES + 1]),
            Err(Error::TooLong)
        );
        let fragment = DENSITIES[3].fragment_bytes;
        let longest = vec![0u8; MAX_FRAGMENTS * fragment];
        assert!(Printer::new(&longest, DENSITIES[3]).is_ok());
        let too_long = vec![0u8; MAX_FRAGMENTS * fragment + 1];
        assert!(matches!(
            Printer::new(&too_long, DENSITIES[3]),
            Err(Error::TooLong)
        ));
    }

    #[test]
    fn estimates_rise_with_length_and_never_reach_zero() {
        assert_eq!(seconds(1), 1);
        assert!(seconds(100) > seconds(10));
    }
}
