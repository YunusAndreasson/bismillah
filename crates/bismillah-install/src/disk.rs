//! The stick, or a file standing in for one in the tests: reads and writes at sector
//! offsets, through buffers aligned for uncached I/O.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};

use sha2::{Digest, Sha256};

use crate::gpt::SECTOR;
use crate::{Error, platform};

/// How much is read or written at once.
pub const CHUNK: usize = 4 * 1024 * 1024;
const ALIGN: usize = 4096;

/// A zeroed buffer whose start is aligned to 4096 bytes, as uncached I/O needs.
pub struct Aligned {
    raw: Vec<u8>,
    start: usize,
    len: usize,
}

impl Aligned {
    pub fn new(len: usize) -> Self {
        let raw = vec![0u8; len + ALIGN];
        let start = (ALIGN - raw.as_ptr() as usize % ALIGN) % ALIGN;
        Self { raw, start, len }
    }

    pub fn bytes(&mut self) -> &mut [u8] {
        &mut self.raw[self.start..self.start + self.len]
    }
}

pub struct Disk {
    file: File,
    pub size: u64,
    pub name: String,
    scratch: Aligned,
}

impl Disk {
    /// A disk the scripts chose, of `size` bytes as the OS reported it.
    pub fn device(path: &str, size: u64, write: bool) -> Result<Self, Error> {
        let mut file = platform::open_device(path, write)?;
        // Linux reports a block device's size; a raw disk on macOS and Windows may not.
        if let Ok(end) = file.seek(SeekFrom::End(0))
            && end != 0
            && end != size
        {
            return Err(Error::Refused(format!(
                "{path} has {end} bytes, not the {size} expected"
            )));
        }
        Self::new(file, size, path)
    }

    /// A file standing in for a stick (the tests).
    pub fn file(path: &str, write: bool) -> Result<Self, Error> {
        let file = OpenOptions::new()
            .read(true)
            .write(write)
            .open(path)
            .map_err(|e| Error::Refused(format!("{path}: {e}")))?;
        let meta = file.metadata()?;
        if !meta.is_file() {
            return Err(Error::Refused(format!("{path} isn't a file")));
        }
        Self::new(file, meta.len(), path)
    }

    fn new(file: File, size: u64, name: &str) -> Result<Self, Error> {
        if size == 0 || !size.is_multiple_of(SECTOR) {
            return Err(Error::Refused(format!(
                "{name}: {size} bytes isn't a whole number of 512-byte sectors"
            )));
        }
        Ok(Self {
            file,
            size,
            name: name.to_owned(),
            scratch: Aligned::new(CHUNK),
        })
    }

    fn check(&self, offset: u64, len: usize) -> Result<(), Error> {
        if !offset.is_multiple_of(SECTOR)
            || !(len as u64).is_multiple_of(SECTOR)
            || offset + len as u64 > self.size
        {
            return Err(Error::Failed(format!(
                "{}: {len} bytes at {offset} is outside the disk or not whole sectors",
                self.name
            )));
        }
        Ok(())
    }

    /// `len` bytes at `offset`, both whole sectors.
    pub fn read_at(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, Error> {
        self.check(offset, len)?;
        let mut out = Vec::with_capacity(len);
        let mut at = 0;
        while at < len {
            let n = (len - at).min(CHUNK);
            let buf = &mut self.scratch.bytes()[..n];
            self.file.seek(SeekFrom::Start(offset + at as u64))?;
            self.file.read_exact(buf)?;
            out.extend_from_slice(buf);
            at += n;
        }
        Ok(out)
    }

    /// Writes `data` (whole sectors) at `offset`.
    pub fn write_at(&mut self, offset: u64, data: &[u8]) -> Result<(), Error> {
        self.check(offset, data.len())?;
        for (i, piece) in data.chunks(CHUNK).enumerate() {
            let buf = &mut self.scratch.bytes()[..piece.len()];
            buf.copy_from_slice(piece);
            self.file
                .seek(SeekFrom::Start(offset + (i * CHUNK) as u64))?;
            self.file.write_all(buf)?;
        }
        Ok(())
    }

    /// The sha256 of `len` bytes at `offset`, as the stick gives them back.
    pub fn hash(&mut self, offset: u64, len: u64) -> Result<[u8; 32], Error> {
        let mut hash = Sha256::new();
        let mut at = 0;
        while at < len {
            let n = (len - at).min(CHUNK as u64) as usize;
            hash.update(self.read_at(offset + at, n)?);
            at += n as u64;
        }
        Ok(hash.finalize().into())
    }

    pub fn sync(&mut self) -> Result<(), Error> {
        self.file.flush()?;
        platform::sync(&self.file)?;
        Ok(())
    }
}
