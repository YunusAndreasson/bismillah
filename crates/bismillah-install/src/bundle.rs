//! A published image as the install scripts download it (os/scripts/publish.ts): a
//! line-based `manifest` and the gzip of the raw image, split into parts. The parts are
//! read as one stream; each one is checked against its sha256 as it ends, and the
//! inflated image against its own size and sha256.

use std::fs::File;
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};

use crate::Error;
use crate::disk::{Aligned, CHUNK};

/// The manifest's format, its first line.
pub const FORMAT: &str = "bismillah-stick 1";

pub struct Part {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}

pub struct Manifest {
    pub version: String,
    pub raw_size: u64,
    pub raw_sha256: String,
    /// Where the ESP's stick-id placeholder is in the raw image.
    pub stickid_offset: u64,
    pub parts: Vec<Part>,
}

fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// A part's name may only name a file in the bundle's own folder.
fn is_name(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('.')
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
}

impl Manifest {
    pub fn parse(text: &str) -> Result<Self, Error> {
        let bad = |why: &str| Error::Refused(format!("the download's manifest is damaged: {why}"));
        let mut lines = text.lines();
        if lines.next() != Some(FORMAT) {
            return Err(bad("not a bismillah stick manifest, or a newer one"));
        }
        let (mut version, mut raw_size, mut raw_sha256, mut stickid_offset) =
            (None, None, None, None);
        let mut parts = Vec::new();
        for line in lines {
            let words: Vec<&str> = line.split_whitespace().collect();
            match words.as_slice() {
                [] => {}
                ["version", v] => version = Some((*v).to_owned()),
                ["raw-size", n] => raw_size = n.parse().ok(),
                ["raw-sha256", h] if is_hash(h) => raw_sha256 = Some((*h).to_owned()),
                ["stickid-offset", n] => stickid_offset = n.parse().ok(),
                ["part", name, bytes, h] if is_name(name) && is_hash(h) => parts.push(Part {
                    name: (*name).to_owned(),
                    bytes: bytes.parse().map_err(|_| bad("a part's size"))?,
                    sha256: (*h).to_owned(),
                }),
                ["part", ..] => return Err(bad("a part's name, size or sha256")),
                // Lines for the scripts (the tools) and lines from later versions.
                _ => {}
            }
        }
        let m = Self {
            version: version.ok_or_else(|| bad("no version"))?,
            raw_size: raw_size.ok_or_else(|| bad("no raw-size"))?,
            raw_sha256: raw_sha256.ok_or_else(|| bad("no raw-sha256"))?,
            stickid_offset: stickid_offset.ok_or_else(|| bad("no stickid-offset"))?,
            parts,
        };
        if m.parts.is_empty() {
            return Err(bad("no parts"));
        }
        if !m.raw_size.is_multiple_of(512) || !m.stickid_offset.is_multiple_of(512) {
            return Err(bad("sizes that aren't whole sectors"));
        }
        Ok(m)
    }
}

/// What a pass does with each piece of the image: its offset, and its bytes.
pub type Sink<'a> = dyn FnMut(u64, &mut [u8]) -> Result<(), Error> + 'a;

pub struct Bundle {
    dir: PathBuf,
    pub manifest: Manifest,
}

type Reading = (File, Sha256, u64);

/// The parts, one after another, each checked as it ends.
struct Parts<'a> {
    bundle: &'a Bundle,
    next: usize,
    /// The part being read, its hash so far and its length so far.
    file: Option<Reading>,
}

impl Read for Parts<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            if let Some((file, hash, read)) = &mut self.file {
                let n = file.read(buf)?;
                if n > 0 {
                    hash.update(&buf[..n]);
                    *read += n as u64;
                    return Ok(n);
                }
                let part = &self.bundle.manifest.parts[self.next - 1];
                let digest = hex(&std::mem::take(hash).finalize());
                if *read != part.bytes || digest != part.sha256 {
                    return Err(io::Error::other(format!(
                        "{} isn't the file the manifest names",
                        part.name
                    )));
                }
                self.file = None;
            }
            let Some(part) = self.bundle.manifest.parts.get(self.next) else {
                return Ok(0);
            };
            let path = self.bundle.dir.join(&part.name);
            let file = File::open(&path)
                .map_err(|e| io::Error::other(format!("{}: {e}", path.display())))?;
            self.file = Some((file, Sha256::new(), 0));
            self.next += 1;
        }
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl Bundle {
    pub fn open(dir: &Path) -> Result<Self, Error> {
        let text = std::fs::read_to_string(dir.join("manifest"))
            .map_err(|e| Error::Refused(format!("no manifest in {}: {e}", dir.display())))?;
        Ok(Self {
            dir: dir.to_owned(),
            manifest: Manifest::parse(&text)?,
        })
    }

    /// Checks each part against its size and sha256, so a damaged one is named before
    /// inflating can trip over it.
    pub fn check_parts(&self) -> Result<(), Error> {
        for part in &self.manifest.parts {
            let path = self.dir.join(&part.name);
            let mut hash = Sha256::new();
            let bytes = File::open(&path)
                .and_then(|mut f| io::copy(&mut f, &mut hash))
                .map_err(|e| Error::Damaged(format!("{}: {e}", path.display())))?;
            if bytes != part.bytes || hex(&hash.finalize()) != part.sha256 {
                return Err(Error::Damaged(format!(
                    "{} isn't the file the manifest names",
                    part.name
                )));
            }
        }
        Ok(())
    }

    /// Inflates the whole image once, giving `sink` each 4 MiB of it at its offset (the
    /// sink may change the bytes; the check is on the image as published). Fails with
    /// `Damaged` when a part or the image doesn't match the manifest. The sink sees the
    /// damaged image's bytes up to that point, so a pass that writes must come after a
    /// pass that only checks.
    pub fn stream(&self, sink: &mut Sink<'_>) -> Result<(), Error> {
        let damaged = |why: String| Error::Damaged(why);
        let parts = Parts {
            bundle: self,
            next: 0,
            file: None,
        };
        let mut gz = GzDecoder::new(BufReader::with_capacity(1 << 20, parts));
        let mut buf = Aligned::new(CHUNK);
        let mut hash = Sha256::new();
        let mut offset = 0u64;
        loop {
            let b = buf.bytes();
            let mut n = 0;
            while n < b.len() {
                match gz.read(&mut b[n..]) {
                    Ok(0) => break,
                    Ok(k) => n += k,
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                    Err(e) => return Err(damaged(e.to_string())),
                }
            }
            if n == 0 {
                break;
            }
            if offset + n as u64 > self.manifest.raw_size {
                return Err(damaged("the image is larger than the manifest says".into()));
            }
            hash.update(&b[..n]);
            sink(offset, &mut b[..n])?;
            offset += n as u64;
        }
        // Whatever follows the gzip stream is read too, so every part is checked.
        let mut rest = gz.into_inner();
        let mut trailing = Vec::new();
        rest.read_to_end(&mut trailing)
            .map_err(|e| damaged(e.to_string()))?;
        if !trailing.is_empty() {
            return Err(damaged("there is data after the image".into()));
        }
        if offset != self.manifest.raw_size {
            return Err(damaged(format!(
                "the image is {offset} bytes, not the {} the manifest says",
                self.manifest.raw_size
            )));
        }
        if hex(&hash.finalize()) != self.manifest.raw_sha256 {
            return Err(damaged("the image doesn't match its sha256".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn manifests_are_read_and_checked() {
        let text = format!(
            "bismillah-stick 1\nversion 20261029-abc\nraw-size 1024\nraw-sha256 {H}\nstickid-offset 512\npart image-000.gz 10 {H}\ntool linux-x86_64 bismillah-install {H}\nfuture line\n"
        );
        let m = Manifest::parse(&text).unwrap();
        assert_eq!(m.version, "20261029-abc");
        assert_eq!(m.parts.len(), 1);
        assert!(Manifest::parse(&text.replace("bismillah-stick 1", "bismillah-stick 2")).is_err());
        assert!(Manifest::parse(&text.replace("raw-size 1024", "raw-size 1000")).is_err());
        // A part can't name a file outside the bundle.
        let escape = text.replace("image-000.gz", "../../etc/passwd");
        assert!(Manifest::parse(&escape).is_err());
    }
}
