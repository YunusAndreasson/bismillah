//! Putting the bismillah stick's published image on a USB stick, or updating one, the way
//! os/scripts/flash.sh and stick.ts do it from a build (os/README.md, ADR-0017).
//!
//! - **install**: a first flash. The whole image, with the stick's own disk, ESP and home
//!   GUIDs in its GPT and its ESP's stick-id, and the backup GPT at the stick's end
//!   (some firmware drops a stick from its boot list otherwise).
//! - **update**: the ESP, the root and its verity hashes from the new image; home, its
//!   partition and the disk's own GUIDs stay as they are. The stick vouches for itself:
//!   its GPT and its stick-id must name the same three GUIDs.
//!
//! Each checks the whole download before it writes a byte, and reads back what it wrote.

pub mod bundle;
pub mod disk;
pub mod gpt;
mod platform;
pub mod stickid;

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use bundle::Bundle;
use disk::{CHUNK, Disk};
use gpt::{Entry, Guid, Layout, SECTOR, Table};
use sha2::{Digest, Sha256};
use stickid::{Id, Identity};

#[derive(Debug)]
pub enum Error {
    /// Nothing was written, and why.
    Refused(String),
    /// The download doesn't match its manifest.
    Damaged(String),
    /// Something failed after writing began.
    Failed(String),
}

impl From<io::Error> for Error {
    fn from(e: io::Error) -> Self {
        Self::Failed(e.to_string())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(why) | Self::Failed(why) => f.write_str(why),
            Self::Damaged(why) => write!(f, "the download is damaged: {why}"),
        }
    }
}

/// The image's first MiB holds its GPT.
const HEAD: usize = 1024 * 1024;
/// How much of home is compared before and after an update.
const HOME_HEAD: u64 = 1024 * 1024;

/// What pass 1 learns about the image while checking it.
struct Image {
    table: Table,
    layout: Layout,
    /// Sector 0: the protective MBR.
    mbr: Vec<u8>,
}

/// Inflates and checks the whole download, writing nothing: the image's GPT and layout,
/// and its stick-id placeholder.
fn check(bundle: &Bundle, log: &mut dyn FnMut(&str)) -> Result<Image, Error> {
    log("checking the download");
    let m = &bundle.manifest;
    let mut head = Vec::new();
    let mut id = Vec::new();
    bundle
        .check_parts()
        .and_then(|()| {
            bundle.stream(&mut |offset, buf| {
                if offset < HEAD as u64 {
                    let take = (HEAD - offset as usize).min(buf.len());
                    head.extend_from_slice(&buf[..take]);
                }
                let end = offset + buf.len() as u64;
                if (offset..end).contains(&m.stickid_offset) {
                    let at = (m.stickid_offset - offset) as usize;
                    id.extend_from_slice(&buf[at..(at + stickid::BYTES).min(buf.len())]);
                }
                Ok(())
            })
        })
        .map_err(|e| match e {
            Error::Damaged(why) => Error::Refused(format!("the download is damaged: {why}")),
            other => other,
        })?;
    let table = Table::read("the image", &mut |offset, len| {
        head.get(offset as usize..offset as usize + len)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| Error::Refused("the image's GPT isn't in its first MiB".into()))
    })?;
    let layout = Layout::of("the image", &table)?;
    let (esp, end) = (
        layout.esp.offset(),
        layout.esp.offset() + layout.esp.bytes(),
    );
    if layout.home.is_none() {
        return Err(Error::Refused("the image has no home partition".into()));
    }
    if !(esp..end).contains(&m.stickid_offset) || stickid::parse(&id) != Some(Id::Unflashed) {
        return Err(Error::Refused(
            "the image's ESP has no stick-id placeholder where the manifest says".into(),
        ));
    }
    if layout.last() * SECTOR + SECTOR > m.raw_size {
        return Err(Error::Refused(
            "the image's partitions run past its end".into(),
        ));
    }
    let mbr = head
        .get(..SECTOR as usize)
        .map(<[u8]>::to_vec)
        .unwrap_or_default();
    Ok(Image { table, layout, mbr })
}

/// The protective MBR, covering the whole stick as the UEFI spec asks (as sfdisk
/// --relocate leaves it): its one 0xEE entry runs from sector 1 to the last, or as far
/// as 32 bits reach.
fn protective(mbr: &[u8], last: u64) -> Option<Vec<u8>> {
    let mut m = mbr.to_vec();
    if m.len() != SECTOR as usize || m[510..512] != [0x55, 0xaa] || m[446 + 4] != 0xee {
        return None;
    }
    let sectors = u32::try_from(last).unwrap_or(u32::MAX);
    m[446 + 12..446 + 16].copy_from_slice(&sectors.to_le_bytes());
    Some(m)
}

/// After writing began, a download that changed since it was checked is a failure: the
/// stick is half written.
fn while_writing(e: Error) -> Error {
    match e {
        Error::Damaged(why) => Error::Failed(format!(
            "the download changed while it was written ({why}); the stick is half written"
        )),
        other => other,
    }
}

/// Copies each patch's bytes over the part of `buf` (at `offset`) that it covers.
fn apply(patches: &[(u64, Vec<u8>)], offset: u64, buf: &mut [u8]) {
    let end = offset + buf.len() as u64;
    for (at, data) in patches {
        let (from, to) = ((*at).max(offset), (at + data.len() as u64).min(end));
        if from < to {
            buf[(from - offset) as usize..(to - offset) as usize]
                .copy_from_slice(&data[(from - at) as usize..(to - at) as usize]);
        }
    }
}

/// Prints how far a write has come, every tenth.
fn progress<'a>(log: &'a mut dyn FnMut(&str), what: &'a str, total: u64) -> impl FnMut(u64) + 'a {
    let mut shown = 0;
    move |done| {
        let tenth = done * 10 / total.max(1);
        if tenth > shown {
            shown = tenth;
            log(&format!("{what}: {}%", tenth * 10));
        }
    }
}

/// A first flash: the whole image, with this stick's own identity. Returns it.
pub fn install(
    bundle: &Bundle,
    disk: &mut Disk,
    log: &mut dyn FnMut(&str),
) -> Result<Identity, Error> {
    let image = check(bundle, log)?;
    let m = &bundle.manifest;
    let sectors = image.table.entry_sectors();
    let last = disk.size / SECTOR - 1;
    let needed = (image.layout.last() + 1 + sectors + 1) * SECTOR;
    if disk.size < needed.max(m.raw_size) {
        return Err(Error::Refused(format!(
            "{} is too small: it has {} MB, and bismillah needs {} MB",
            disk.name,
            disk.size / 1_000_000,
            needed.max(m.raw_size).div_ceil(1_000_000)
        )));
    }
    let Some(home) = image.layout.home else {
        return Err(Error::Refused("the image has no home partition".into()));
    };
    let id = Identity {
        disk: Guid::random()?,
        esp: Guid::random()?,
        home: Guid::random()?,
    };
    let mut table = image.table.clone();
    table.disk = id.disk;
    table.set_uuid(image.layout.esp.index, id.esp);
    table.set_uuid(home.index, id.home);
    table.last_usable = last - sectors - 1;
    let entries = table.entries_sectors();
    let primary = table.header(1, last, table.entries_lba);
    let backup = table.header(last, 1, last - sectors);

    let mbr = protective(&image.mbr, last)
        .ok_or_else(|| Error::Refused("the image has no protective MBR".into()))?;
    let mut patches = vec![
        (0, mbr),
        (SECTOR, primary.clone()),
        (table.entries_lba * SECTOR, entries.clone()),
        (m.stickid_offset, stickid::file(&id)),
    ];
    // The image's own backup GPT would be left in the middle of a larger stick.
    let old = image.table.alternate;
    if old > sectors && (old + 1) * SECTOR <= m.raw_size {
        let from = (old - sectors) * SECTOR;
        patches.push((from, vec![0; ((sectors + 1) * SECTOR) as usize]));
    }

    log(&format!("writing bismillah to {}", disk.name));
    let mut written = Sha256::new();
    let mut shown = progress(log, "writing", m.raw_size);
    bundle
        .stream(&mut |offset, buf| {
            apply(&patches, offset, buf);
            written.update(&*buf);
            disk.write_at(offset, buf)?;
            shown(offset + buf.len() as u64);
            Ok(())
        })
        .map_err(while_writing)?;
    drop(shown);
    disk.write_at((last - sectors) * SECTOR, &entries)?;
    disk.write_at(last * SECTOR, &backup)?;
    disk.sync()?;

    log("reading it back");
    if disk.hash(0, m.raw_size)? != <[u8; 32]>::from(written.finalize()) {
        return Err(Error::Failed(
            "the stick reads back differently from what was written: it may be failing".into(),
        ));
    }
    let mut tail = entries;
    tail.extend_from_slice(&backup);
    if disk.read_at((last - sectors) * SECTOR, tail.len())? != tail {
        return Err(Error::Failed(
            "the stick's backup GPT reads back differently".into(),
        ));
    }
    let name = disk.name.clone();
    let again = Table::read(&name, &mut |o, l| disk.read_at(o, l))?;
    let layout = Layout::of(&name, &again)?;
    if again.disk != id.disk
        || layout.esp.uuid != id.esp
        || layout.home.map(|h| h.uuid) != Some(id.home)
    {
        return Err(Error::Failed(
            "the stick's GPT reads back with other GUIDs".into(),
        ));
    }
    Ok(id)
}

/// What kind of stick the disk holds, by its GPT alone.
pub enum Kind {
    /// An ESP, root, verity and home and nothing else: update it, or erase it.
    Bismillah(Identity),
    /// Anything else: only a first flash, erasing it.
    Other,
}

pub fn inspect(disk: &mut Disk) -> Kind {
    let name = disk.name.clone();
    let Ok(table) = Table::read(&name, &mut |o, l| disk.read_at(o, l)) else {
        return Kind::Other;
    };
    match Layout::of(&name, &table) {
        Ok(Layout {
            esp,
            home: Some(home),
            ..
        }) => Kind::Bismillah(Identity {
            disk: table.disk,
            esp: esp.uuid,
            home: home.uuid,
        }),
        _ => Kind::Other,
    }
}

/// Interrupted updates, on the computer that ran them: one file per stick while its
/// update writes, as os/sticks.toml's `updating` does for flash.sh. A rerun may finish
/// an update whose stick-id was cut off only when this says it was updating.
pub struct Journal {
    dir: PathBuf,
}

impl Journal {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_owned(),
        }
    }

    fn path(&self, id: &Identity) -> PathBuf {
        self.dir.join(format!("{}.updating", id.disk))
    }

    fn text(id: &Identity) -> String {
        format!("esp {}\nhome {}\n", id.esp, id.home)
    }

    pub fn updating(&self, id: &Identity) -> bool {
        fs::read_to_string(self.path(id)).is_ok_and(|t| t == Self::text(id))
    }

    /// Durable before the first byte of the stick changes.
    fn begin(&self, id: &Identity) -> Result<(), Error> {
        let fail = |e: io::Error| {
            Error::Refused(format!(
                "can't note the update in {} ({e}), so an interrupted one couldn't be finished",
                self.dir.display()
            ))
        };
        fs::create_dir_all(&self.dir).map_err(fail)?;
        let file = fs::File::create(self.path(id)).map_err(fail)?;
        io::Write::write_all(&mut &file, Self::text(id).as_bytes()).map_err(fail)?;
        file.sync_all().map_err(fail)?;
        #[cfg(unix)]
        fs::File::open(&self.dir)
            .and_then(|d| d.sync_all())
            .map_err(fail)?;
        Ok(())
    }

    fn finish(&self, id: &Identity) -> Result<(), Error> {
        fs::remove_file(self.path(id))?;
        Ok(())
    }
}

/// Every 512-byte block in the ESP that starts with the stick-id head.
fn stick_ids(disk: &mut Disk, esp: &Entry) -> Result<Vec<Id>, Error> {
    let mut found = Vec::new();
    let mut at = 0;
    while at < esp.bytes() {
        let n = (esp.bytes() - at).min(CHUNK as u64) as usize;
        let chunk = disk.read_at(esp.offset() + at, n)?;
        for block in chunk.chunks(stickid::BYTES) {
            if let Some(id) = stickid::parse(block) {
                found.push(id);
            }
        }
        at += n as u64;
    }
    Ok(found)
}

/// Rewrites the stick's ESP, root and verity from the image, keeping home.
pub fn update(
    bundle: &Bundle,
    disk: &mut Disk,
    journal: &Journal,
    log: &mut dyn FnMut(&str),
) -> Result<(), Error> {
    let name = disk.name.clone();
    let stick = Table::read(&name, &mut |o, l| disk.read_at(o, l))?;
    let target = Layout::of(&name, &stick)?;
    let Some(home) = target.home else {
        return Err(Error::Refused(format!(
            "{name} has no home partition: not a bismillah stick"
        )));
    };
    let id = Identity {
        disk: stick.disk,
        esp: target.esp.uuid,
        home: home.uuid,
    };
    let sectors = stick.entry_sectors();
    let alternate = stick.alternate;
    if alternate * SECTOR + SECTOR > disk.size
        || alternate < sectors
        || alternate - sectors <= stick.last_usable
    {
        return Err(Error::Refused(format!(
            "{name}: its backup GPT is out of place"
        )));
    }

    log("reading the stick's identity");
    let ids = stick_ids(disk, &target.esp)?;
    let interrupted = journal.updating(&id);
    let vouched = match ids.as_slice() {
        [Id::Flashed(file)] => *file == id,
        _ if interrupted => ids.iter().all(|f| *f == Id::Flashed(id)),
        [] => {
            return Err(Error::Refused(format!(
                "{name}: its ESP has no stick-id. If an update to it was cut off on another computer, finish it there, or erase the stick"
            )));
        }
        _ => {
            return Err(Error::Refused(format!(
                "{name}: its ESP's stick-id is unflashed, damaged or repeated"
            )));
        }
    };
    if !vouched {
        return Err(Error::Refused(format!(
            "{name}: its ESP's stick-id names other GUIDs than its partitions"
        )));
    }

    let image = check(bundle, log)?;
    let source = image.layout;
    let pairs = [
        ("root", source.root, target.root),
        ("root verity", source.verity, target.verity),
        ("ESP", source.esp, target.esp),
    ];
    for (what, s, t) in pairs {
        if s.bytes() > t.bytes() {
            return Err(Error::Refused(format!(
                "the new {what} ({} bytes) is bigger than the stick's slot ({}): erase the stick and install afresh",
                s.bytes(),
                t.bytes()
            )));
        }
    }
    let before = disk.hash(home.offset(), HOME_HEAD.min(home.bytes()))?;

    journal.begin(&id)?;
    let m = &bundle.manifest;
    let patch = [(m.stickid_offset, stickid::file(&id))];
    let mut hashes = Vec::new();
    // root and verity first: until the ESP is written, the old system's boot entry still
    // names the old root hash, so a cut-off update leaves a stick a rerun can finish.
    for group in [&pairs[..2], &pairs[2..]] {
        let total: u64 = group.iter().map(|(_, s, _)| s.bytes()).sum();
        let names: Vec<&str> = group.iter().map(|(w, _, _)| *w).collect();
        let what = format!("writing the {}", names.join(" and "));
        log(&what);
        let mut sums: Vec<Sha256> = group.iter().map(|_| Sha256::new()).collect();
        let mut done = 0;
        let mut shown = progress(log, &what, total);
        bundle
            .stream(&mut |offset, buf| {
                let end = offset + buf.len() as u64;
                for ((_, s, t), sum) in group.iter().zip(sums.iter_mut()) {
                    let (from, to) = (offset.max(s.offset()), end.min(s.offset() + s.bytes()));
                    if from >= to {
                        continue;
                    }
                    let piece = &mut buf[(from - offset) as usize..(to - offset) as usize];
                    apply(&patch, from, piece);
                    sum.update(&*piece);
                    disk.write_at(t.offset() + (from - s.offset()), piece)?;
                    done += to - from;
                    shown(done);
                }
                Ok(())
            })
            .map_err(while_writing)?;
        drop(shown);
        disk.sync()?;
        for ((what, s, t), sum) in group.iter().zip(sums) {
            hashes.push((
                *what,
                t.offset(),
                s.bytes(),
                <[u8; 32]>::from(sum.finalize()),
            ));
        }
    }

    // The boot finds root and verity by the root hash their GUIDs come from.
    let mut table = stick.clone();
    table.set_uuid(target.root.index, source.root.uuid);
    table.set_uuid(target.verity.index, source.verity.uuid);
    let entries = table.entries_sectors();
    disk.write_at(table.entries_lba * SECTOR, &entries)?;
    disk.write_at(SECTOR, &table.header(1, alternate, table.entries_lba))?;
    disk.write_at((alternate - sectors) * SECTOR, &entries)?;
    disk.write_at(
        alternate * SECTOR,
        &table.header(alternate, 1, alternate - sectors),
    )?;
    disk.sync()?;

    log("reading it back");
    for (what, offset, bytes, hash) in hashes {
        if disk.hash(offset, bytes)? != hash {
            return Err(Error::Failed(format!(
                "the {what} reads back differently from what was written: the stick may be failing"
            )));
        }
    }
    let after = Table::read(&name, &mut |o, l| disk.read_at(o, l))?;
    let layout = Layout::of(&name, &after)?;
    if layout.root.uuid != source.root.uuid || layout.verity.uuid != source.verity.uuid {
        return Err(Error::Failed(
            "the stick's partition table didn't take the new root's GUIDs".into(),
        ));
    }
    if disk.hash(home.offset(), HOME_HEAD.min(home.bytes()))? != before {
        return Err(Error::Failed("home changed during the update".into()));
    }
    journal.finish(&id)?;
    log(&format!("updated to {}; home untouched", m.version));
    Ok(())
}
