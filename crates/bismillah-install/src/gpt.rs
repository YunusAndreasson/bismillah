//! The GPT of an image or a stick, in 512-byte sectors, checked against its CRCs, and
//! the one layout a bismillah stick has: an ESP, a root, its verity hashes and a home
//! (os/mkosi/mkosi.repart/). The same rules as os/scripts/image.ts and stick.ts.

use std::fmt;

use crate::Error;

pub const SECTOR: u64 = 512;

/// The partition types, as os/scripts/image.ts names them.
pub const ESP: &str = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
pub const ROOT: &str = "4f68bce3-e8cd-4db1-96e7-fbcaf984b709"; // root, x86-64
pub const ROOT_VERITY: &str = "2c7357ed-ebd2-46d9-aec1-23d437ec2bf5"; // root verity, x86-64
pub const HOME: &str = "933ac7e1-2eb4-4f13-b844-0e14e2aef915";

/// A GUID as the GPT stores it: the first three fields little-endian.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Guid([u8; 16]);

/// Between the disk's byte order and the written one, both ways.
fn swap(mut b: [u8; 16]) -> [u8; 16] {
    b[0..4].reverse();
    b[4..6].reverse();
    b[6..8].reverse();
    b
}

impl Guid {
    /// A random version 4 GUID, from the OS.
    pub fn random() -> Result<Self, Error> {
        let mut b = [0u8; 16];
        getrandom::fill(&mut b)
            .map_err(|e| Error::Refused(format!("this computer gave no random numbers ({e})")))?;
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        Ok(Self(swap(b)))
    }

    /// From its written form, `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
    pub fn parse(text: &str) -> Option<Self> {
        let groups: Vec<&str> = text.split('-').collect();
        if groups.iter().map(|g| g.len()).collect::<Vec<_>>() != [8, 4, 4, 4, 12] {
            return None;
        }
        let hex: String = groups.concat();
        let mut b = [0u8; 16];
        for (i, byte) in b.iter_mut().enumerate() {
            *byte = u8::from_str_radix(hex.get(2 * i..2 * i + 2)?, 16).ok()?;
        }
        Some(Self(swap(b)))
    }

    /// As the GPT stores it.
    pub fn bytes(&self) -> [u8; 16] {
        self.0
    }

    fn from_slice(b: &[u8]) -> Self {
        let mut g = [0u8; 16];
        g.copy_from_slice(&b[..16]);
        Self(g)
    }

    fn is_zero(&self) -> bool {
        self.0 == [0; 16]
    }
}

impl fmt::Display for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let b = swap(self.0);
        for (i, byte) in b.iter().enumerate() {
            if matches!(i, 4 | 6 | 8 | 10) {
                f.write_str("-")?;
            }
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    let mut n = [0u8; 4];
    n.copy_from_slice(&b[at..at + 4]);
    u32::from_le_bytes(n)
}

fn u64_at(b: &[u8], at: usize) -> u64 {
    let mut n = [0u8; 8];
    n.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(n)
}

/// One used entry: its index in the table (partition number - 1), type, GUID and place.
#[derive(Clone, Copy, Debug)]
pub struct Entry {
    pub index: usize,
    pub kind: Guid,
    pub uuid: Guid,
    pub first: u64,
    pub last: u64,
}

impl Entry {
    pub fn offset(&self) -> u64 {
        self.first * SECTOR
    }

    pub fn bytes(&self) -> u64 {
        (self.last - self.first + 1) * SECTOR
    }
}

/// Reads `bytes` at an offset: from an image's first MiB, or from a disk.
pub type Reader<'a> = dyn FnMut(u64, usize) -> Result<Vec<u8>, Error> + 'a;

/// A primary GPT header and its partition table.
#[derive(Clone)]
pub struct Table {
    /// The header's whole sector, so its reserved bytes are kept as they were.
    sector: Vec<u8>,
    header_size: usize,
    pub disk: Guid,
    pub alternate: u64,
    pub last_usable: u64,
    pub entries_lba: u64,
    count: u32,
    size: u32,
    entries: Vec<u8>,
}

/// The largest partition table read, as in image.ts: the images have 128 entries.
const MAX_TABLE: u64 = 16 * 1024 * 1024;

impl Table {
    /// The primary GPT, read with `read(offset, bytes)`. `what` names the disk in refusals.
    pub fn read(what: &str, read: &mut Reader<'_>) -> Result<Self, Error> {
        let refuse = |why: &str| Error::Refused(format!("{what}: {why}"));
        let sector = read(SECTOR, SECTOR as usize)?;
        if sector.get(0..8) != Some(b"EFI PART".as_slice()) {
            return Err(refuse("no GPT"));
        }
        let header_size = u32_at(&sector, 12) as usize;
        if !(92..=SECTOR as usize).contains(&header_size) {
            return Err(refuse("invalid GPT header size"));
        }
        let mut zeroed = sector.clone();
        zeroed[16..20].fill(0);
        if crc32fast::hash(&zeroed[..header_size]) != u32_at(&sector, 16) {
            return Err(refuse("invalid GPT header checksum"));
        }
        let entries_lba = u64_at(&sector, 72);
        let count = u32_at(&sector, 80);
        let size = u32_at(&sector, 84);
        let table_bytes = u64::from(count) * u64::from(size);
        if entries_lba < 2
            || count == 0
            || size < 128
            || !size.is_multiple_of(128)
            || table_bytes > MAX_TABLE
            || entries_lba.checked_mul(SECTOR).is_none()
        {
            return Err(refuse("invalid GPT table size or offset"));
        }
        let padded = table_bytes.div_ceil(SECTOR) * SECTOR;
        let mut entries = read(entries_lba * SECTOR, padded as usize)?;
        entries.truncate(table_bytes as usize);
        if crc32fast::hash(&entries) != u32_at(&sector, 88) {
            return Err(refuse("invalid GPT partition table checksum"));
        }
        Ok(Self {
            disk: Guid::from_slice(&sector[56..72]),
            alternate: u64_at(&sector, 32),
            last_usable: u64_at(&sector, 48),
            entries_lba,
            count,
            size,
            header_size,
            sector,
            entries,
        })
    }

    /// The used entries, in table order.
    pub fn entries(&self) -> Vec<Entry> {
        self.entries
            .chunks(self.size as usize)
            .enumerate()
            .filter_map(|(index, e)| {
                let kind = Guid::from_slice(&e[0..16]);
                (!kind.is_zero()).then(|| Entry {
                    index,
                    kind,
                    uuid: Guid::from_slice(&e[16..32]),
                    first: u64_at(e, 32),
                    last: u64_at(e, 40),
                })
            })
            .collect()
    }

    /// How many sectors the partition table takes.
    pub fn entry_sectors(&self) -> u64 {
        (u64::from(self.count) * u64::from(self.size)).div_ceil(SECTOR)
    }

    pub fn set_uuid(&mut self, index: usize, uuid: Guid) {
        let at = index * self.size as usize + 16;
        self.entries[at..at + 16].copy_from_slice(&uuid.0);
    }

    /// The partition table, padded to whole sectors.
    pub fn entries_sectors(&self) -> Vec<u8> {
        let mut e = self.entries.clone();
        e.resize((self.entry_sectors() * SECTOR) as usize, 0);
        e
    }

    /// A header sector for this table at `my`, naming its other copy and its entries.
    pub fn header(&self, my: u64, alternate: u64, entries_lba: u64) -> Vec<u8> {
        let mut s = self.sector.clone();
        s[24..32].copy_from_slice(&my.to_le_bytes());
        s[32..40].copy_from_slice(&alternate.to_le_bytes());
        s[48..56].copy_from_slice(&self.last_usable.to_le_bytes());
        s[56..72].copy_from_slice(&self.disk.0);
        s[72..80].copy_from_slice(&entries_lba.to_le_bytes());
        s[88..92].copy_from_slice(&crc32fast::hash(&self.entries).to_le_bytes());
        s[16..20].fill(0);
        let crc = crc32fast::hash(&s[..self.header_size]);
        s[16..20].copy_from_slice(&crc.to_le_bytes());
        s
    }
}

/// A bismillah stick's partitions: one of each type and nothing else.
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub esp: Entry,
    pub root: Entry,
    pub verity: Entry,
    pub home: Option<Entry>,
}

impl Layout {
    pub fn of(what: &str, table: &Table) -> Result<Self, Error> {
        let entries = table.entries();
        let known = [ESP, ROOT, ROOT_VERITY, HOME];
        if let Some(other) = entries
            .iter()
            .find(|e| !known.contains(&e.kind.to_string().as_str()))
        {
            return Err(Error::Refused(format!(
                "{what} has a partition of another type ({})",
                other.kind
            )));
        }
        let all = |kind: &str| -> Vec<Entry> {
            entries
                .iter()
                .filter(|e| e.kind.to_string() == kind)
                .copied()
                .collect()
        };
        let one = |kind: &str, name: &str| -> Result<Entry, Error> {
            match all(kind).as_slice() {
                [e] => Ok(*e),
                found => Err(Error::Refused(format!(
                    "{what} has {} {name} partitions, not one",
                    found.len()
                ))),
            }
        };
        let home = if all(HOME).is_empty() {
            None
        } else {
            Some(one(HOME, "home")?)
        };
        Ok(Self {
            esp: one(ESP, "ESP")?,
            root: one(ROOT, "root")?,
            verity: one(ROOT_VERITY, "root verity")?,
            home,
        })
    }

    /// The last sector any partition uses.
    pub fn last(&self) -> u64 {
        [
            Some(self.esp),
            Some(self.root),
            Some(self.verity),
            self.home,
        ]
        .into_iter()
        .flatten()
        .map(|e| e.last)
        .max()
        .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guids_round_trip_in_their_mixed_byte_order() {
        let text = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
        let g = Guid::parse(text).unwrap();
        assert_eq!(g.0[..4], [0x28, 0x73, 0x2a, 0xc1]);
        assert_eq!(g.0[8..], [0xba, 0x4b, 0x00, 0xa0, 0xc9, 0x3e, 0xc9, 0x3b]);
        assert_eq!(g.to_string(), text);
        assert!(Guid::parse("c12a7328f81f11d2ba4b00a0c93ec93b").is_none());
        assert!(Guid::parse("c12a7328-f81f-11d2-ba4b-00a0c93ec93z").is_none());
    }

    #[test]
    fn random_guids_are_version_4_and_differ() {
        let a = Guid::random().unwrap();
        let b = Guid::random().unwrap();
        assert_ne!(a, b);
        let text = a.to_string();
        assert_eq!(&text[14..15], "4");
        assert!("89ab".contains(&text[19..20]));
        assert_eq!(Guid::parse(&text), Some(a));
    }
}
