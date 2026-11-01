//! The phone's side of docs/print-format.md. A camera sees whatever is in front of it,
//! so every frame is untrusted, and nothing leaves here until SHA-256 has agreed.

use std::io::Read as _;

use flate2::read::DeflateDecoder;
use minicbor::Decoder as Cbor;
use sha2::{Digest as _, Sha256};
use ur::fountain::Error as FountainError;
use ur::ur::Error as UrError;

use crate::seal::unseal;
use crate::{
    FORMAT_VERSION, MAX_FRAGMENTS, MAX_TEXT_BYTES, PhoneSecret, Place, SEALED_VERSION, UR_TYPE,
};

/// A frame from another print is a stray until this many arrive in a row. Then the writer
/// has started something else, or resized the window, and this reader follows them.
const FOREIGN_BEFORE_SWITCHING: u32 = 3;

/// Why a complete message was refused, by kind only. Whatever it is, nothing is stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    #[error("the frames did not make a whole message")]
    Damaged,
    #[error("the message is in a format this reader doesn't know")]
    Version,
    #[error("the text is longer than a reader accepts")]
    TooLong,
    #[error("the message is sealed to another key")]
    OtherKey,
}

/// A verified document. `bytes` hash to `digest`, as the sender said they would.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Received {
    /// For showing only: it came through the air, so it never becomes a path.
    pub name: String,
    pub selection: bool,
    pub digest: [u8; 32],
    pub bytes: Vec<u8>,
    /// Its place in a *Print whole library* run, if it's part of one.
    pub place: Option<Place>,
    /// It came sealed to this reader's key, so a camera alone couldn't have read it.
    pub sealed: bool,
}

/// The digest a stored text is checked against, whenever it's about to be called *Exact*.
pub fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// Opens a complete message that isn't sealed, or says why not.
pub fn open(message: &[u8]) -> Result<Received, Refusal> {
    open_with(message, None)
}

/// Opens a complete message with this reader's key, if it has one. Nothing is returned
/// unverified.
pub fn open_with(message: &[u8], secret: Option<&PhoneSecret>) -> Result<Received, Refusal> {
    let mut cbor = Cbor::new(message);
    let items = cbor.array().map_err(|_| Refusal::Damaged)?;
    let version = cbor.u8().map_err(|_| Refusal::Damaged)?;
    if version == SEALED_VERSION {
        let inner = unseal(message, items, &mut cbor, secret)?;
        // An envelope inside, never another seal, so this can't recurse.
        return open_envelope(&inner, true);
    }
    open_envelope(message, false)
}

fn open_envelope(message: &[u8], sealed: bool) -> Result<Received, Refusal> {
    let mut cbor = Cbor::new(message);
    let items = cbor.array().map_err(|_| Refusal::Damaged)?;
    if cbor.u8().map_err(|_| Refusal::Damaged)? != FORMAT_VERSION {
        return Err(Refusal::Version);
    }
    // After the version: another version may well have another shape.
    if items != Some(6) {
        return Err(Refusal::Damaged);
    }
    let name = cbor.str().map_err(|_| Refusal::Damaged)?.to_owned();
    let selection = cbor.bool().map_err(|_| Refusal::Damaged)?;
    let digest: [u8; 32] = cbor
        .bytes()
        .map_err(|_| Refusal::Damaged)?
        .try_into()
        .map_err(|_| Refusal::Damaged)?;
    let deflated = cbor.bytes().map_err(|_| Refusal::Damaged)?;
    let place = read_place(&mut cbor).map_err(|_| Refusal::Damaged)?;
    if selection && place.is_some() {
        return Err(Refusal::Damaged);
    }
    if cbor.position() != message.len() {
        return Err(Refusal::Damaged);
    }

    // A few kilobytes can claim to inflate to gigabytes, so it stops one byte past the limit.
    let mut bytes = Vec::new();
    DeflateDecoder::new(deflated)
        .take(MAX_TEXT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Refusal::Damaged)?;
    if bytes.len() > MAX_TEXT_BYTES {
        return Err(Refusal::TooLong);
    }
    if bytes.is_empty() || Sha256::digest(&bytes).as_slice() != digest {
        return Err(Refusal::Damaged);
    }
    Ok(Received {
        name,
        selection,
        digest,
        bytes,
        place,
        sealed,
    })
}

/// Null, or a run's ID and a place inside it.
fn read_place(cbor: &mut Cbor<'_>) -> Result<Option<Place>, minicbor::decode::Error> {
    let shape = || minicbor::decode::Error::message("not a place in a run");
    if cbor.datatype()? == minicbor::data::Type::Null {
        cbor.null()?;
        return Ok(None);
    }
    if cbor.array()? != Some(3) {
        return Err(shape());
    }
    let run: [u8; 16] = cbor.bytes()?.try_into().map_err(|_| shape())?;
    let index = cbor.u32()?;
    let count = cbor.u32()?;
    if index >= count {
        return Err(shape());
    }
    Ok(Some(Place { run, index, count }))
}

/// What one frame did.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// Not one of ours, damaged, or a stray from another print. It changed nothing.
    Ignored,
    Receiving {
        resolved: usize,
        total: usize,
    },
    Complete(Box<Received>),
}

/// Gathers one print's frames, in any order, with any of them missing.
#[derive(Default)]
pub struct Receiver {
    decoder: ur::Decoder,
    foreign: u32,
    secret: Option<PhoneSecret>,
}

impl Receiver {
    /// The key sealed prints are opened with. It stays through every print.
    pub fn set_secret(&mut self, secret: PhoneSecret) {
        self.secret = Some(secret);
    }

    pub fn has_secret(&self) -> bool {
        self.secret.is_some()
    }

    fn restart(&mut self) {
        self.decoder = ur::Decoder::default();
        self.foreign = 0;
    }

    /// Takes one QR code's text. After a complete or refused message it starts afresh, so
    /// one bad print never blocks the next.
    pub fn receive(&mut self, text: &str) -> Result<Step, Refusal> {
        let Some(part) = ours(text) else {
            return Ok(Step::Ignored);
        };
        match self.decoder.receive(&part) {
            Ok(()) => self.foreign = 0,
            Err(UrError::Fountain(FountainError::InconsistentPart)) => {
                self.foreign += 1;
                if self.foreign < FOREIGN_BEFORE_SWITCHING {
                    return Ok(Step::Ignored);
                }
                self.restart();
                if self.decoder.receive(&part).is_err() {
                    return Ok(Step::Ignored);
                }
            }
            Err(_) => return Ok(Step::Ignored),
        }
        if !self.decoder.complete() {
            return Ok(Step::Receiving {
                resolved: self.decoder.resolved_fragment_count().unwrap_or(0),
                total: self.decoder.fragment_count(),
            });
        }
        let message = self.decoder.message();
        self.restart();
        match message {
            Ok(Some(message)) => Ok(Step::Complete(Box::new(open_with(
                &message,
                self.secret.as_ref(),
            )?))),
            _ => Err(Refusal::Damaged),
        }
    }
}

/// The part in the form the decoder reads, if it's ours and claims a sane size. The `ur`
/// crate allocates by the fragment count a part claims, before anything has checked it.
fn ours(text: &str) -> Option<String> {
    let part = text.to_ascii_lowercase();
    let rest = part.strip_prefix("ur:")?.strip_prefix(UR_TYPE)?;
    let (indices, _) = rest.strip_prefix('/')?.split_once('/')?;
    let (_, total) = indices.split_once('-')?;
    (total.parse::<usize>().ok()? <= MAX_FRAGMENTS).then_some(part)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_type_at_a_sane_size_reaches_the_decoder() {
        assert!(ours("UR:BISMILLAH-PRINT/1-2/LPAD").is_some());
        assert!(ours("https://example.com/1-2/x").is_none());
        assert!(ours("ur:bytes/1-2/lpad").is_none());
        assert!(ours("ur:bismillah-printer/1-2/lpad").is_none());
        assert!(ours("ur:bismillah-print/lpad").is_none());
        assert!(ours("ur:bismillah-print/4000000000-4000000000/lpad").is_none());
        assert!(ours("ur:bismillah-print/1-x/lpad").is_none());
        assert!(ours("").is_none());
    }
}
