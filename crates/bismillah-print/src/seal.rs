//! Sealing (ADR-0023, docs/print-format.md): a print only one phone can open. The phone
//! makes a key pair and the writer types its public half into the stick. The stick holds
//! nothing that can open its own prints: each seal uses a fresh key that is gone at once.
//!
//! This keeps a text from whoever films the screen. It doesn't say who made a print,
//! because a public key isn't secret, so a seal never counts as proof of the sender.

use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable as _, Kem as _, OpModeR, OpModeS, Serializable as _};
use minicbor::{Decoder as Cbor, Encoder};
use rand_core::{OsRng, TryRngCore as _};
use sha2::{Digest as _, Sha256};

use crate::{Error, Refusal};

/// The sealed form's version in the outer array. What's inside is an ordinary envelope.
pub const SEALED_VERSION: u8 = 3;
/// Ties a seal to this use of it, as RFC 9180 asks.
const INFO: &[u8] = b"bismillah-print sealed 3";
/// Short, since it's typed by hand, and not a word in any layout's way.
const KEY_PREFIX: bech32::Hrp = bech32::Hrp::parse_unchecked("bk");
const KEY_BYTES: usize = 32;
const CHECK_WORDS: usize = 4;

type Kem = X25519HkdfSha256;
type Open = <Kem as hpke::Kem>::PrivateKey;
type Public = <Kem as hpke::Kem>::PublicKey;
type Encapped = <Kem as hpke::Kem>::EncappedKey;

/// The text typed into the stick didn't make a key. Bech32m's checksum finds any typing
/// slip of up to four characters, and nearly all larger ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("that isn't a phone's key")]
pub struct NotAKey;

/// The half that seals. It can't open anything, so the stick may keep it in plain sight.
#[derive(Clone)]
pub struct PhoneKey(Public);

impl PhoneKey {
    /// Takes the key as typed: any case, with any spaces or dashes between its groups.
    pub fn parse(text: &str) -> Result<Self, NotAKey> {
        let text: String = text
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .map(|c| c.to_ascii_lowercase())
            .collect();
        let checked = bech32::primitives::decode::CheckedHrpstring::new::<bech32::Bech32m>(&text)
            .map_err(|_| NotAKey)?;
        if checked.hrp() != KEY_PREFIX {
            return Err(NotAKey);
        }
        let bytes: Vec<u8> = checked.byte_iter().collect();
        if bytes.len() != KEY_BYTES {
            return Err(NotAKey);
        }
        Public::from_bytes(&bytes).map(Self).map_err(|_| NotAKey)
    }

    /// The key as the phone shows it, without spaces.
    pub fn text(&self) -> String {
        // Encoding a fixed 32 bytes under a fixed prefix has nothing that can fail.
        bech32::encode::<bech32::Bech32m>(KEY_PREFIX, self.0.to_bytes().as_slice())
            .unwrap_or_default()
    }

    /// The key in groups of four, to read off a screen and type.
    pub fn grouped(&self) -> String {
        self.text()
            .as_bytes()
            .chunks(4)
            .filter_map(|group| std::str::from_utf8(group).ok())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Four words both sides show, to compare at a glance. They're BC-UR's bytewords, which
    /// the print format already carries, so no second word list comes with this.
    pub fn check_words(&self) -> String {
        let hash = Sha256::new()
            .chain_update(b"bismillah phone key")
            .chain_update(self.0.to_bytes())
            .finalize();
        let encoded = ur::bytewords::encode(
            hash.get(..CHECK_WORDS).unwrap_or_default(),
            ur::bytewords::Style::Standard,
        );
        encoded
            .split_whitespace()
            .take(CHECK_WORDS)
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// The half that opens, which never leaves the phone. Nothing here prints or logs it.
pub struct PhoneSecret {
    secret: Open,
    public: PhoneKey,
}

impl PhoneSecret {
    pub fn generate() -> Self {
        let (secret, public) = Kem::gen_keypair(&mut OsRng.unwrap_err());
        Self {
            secret,
            public: PhoneKey(public),
        }
    }

    /// `None` if these aren't the bytes of a key, as a damaged file's wouldn't be.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let secret = Open::from_bytes(bytes).ok()?;
        let public = Kem::sk_to_pk(&secret);
        Some(Self {
            secret,
            public: PhoneKey(public),
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        self.secret.to_bytes().to_vec()
    }

    pub fn public(&self) -> &PhoneKey {
        &self.public
    }
}

/// Wraps an envelope so only `key`'s phone can read any of it: the name, the digest, the
/// place in a run and the text. Every call differs, so two showings don't combine.
pub fn seal(key: &PhoneKey, envelope: &[u8]) -> Result<Vec<u8>, Error> {
    let (encapped, sealed) = hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, Kem, _>(
        &OpModeS::Base,
        &key.0,
        INFO,
        envelope,
        b"",
        &mut OsRng.unwrap_err(),
    )
    .map_err(|_| Error::Encode)?;
    let mut cbor = Encoder::new(Vec::with_capacity(sealed.len() + 48));
    cbor.array(3)
        .and_then(|c| c.u8(SEALED_VERSION))
        .and_then(|c| c.bytes(encapped.to_bytes().as_slice()))
        .and_then(|c| c.bytes(&sealed))
        .map_err(|_| Error::Encode)?;
    Ok(cbor.into_writer())
}

/// Opens a sealed message's outer array, whose version has been read. A message sealed to
/// another key and a damaged one look the same from here, so both are refused alike.
pub(crate) fn unseal(
    message: &[u8],
    items: Option<u64>,
    cbor: &mut Cbor<'_>,
    secret: Option<&PhoneSecret>,
) -> Result<Vec<u8>, Refusal> {
    let secret = secret.ok_or(Refusal::OtherKey)?;
    if items != Some(3) {
        return Err(Refusal::Damaged);
    }
    let encapped = cbor.bytes().map_err(|_| Refusal::Damaged)?;
    let encapped = Encapped::from_bytes(encapped).map_err(|_| Refusal::Damaged)?;
    let sealed = cbor.bytes().map_err(|_| Refusal::Damaged)?;
    if cbor.position() != message.len() {
        return Err(Refusal::Damaged);
    }
    hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, Kem>(
        &OpModeR::Base,
        &secret.secret,
        &encapped,
        INFO,
        sealed,
        b"",
    )
    .map_err(|_| Refusal::OtherKey)
}
